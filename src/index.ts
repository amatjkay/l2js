import path from 'path';
import { createLogger } from './core/Logger';
import { loadSettings } from './core/Config';
import { captureOnce } from './core/Capture';
import fs from 'fs';
import { StateMachine } from './spoiler/StateMachine';
import { BootState } from './spoiler/states/BootState';
import type { IStateContext } from './spoiler/State';
import { initCV } from './core/CV';
import { smokeTestContours } from './core/SmokeTest';
import { Actions } from './core/Actions';
import { startOverlayServer } from './server/OverlayServer';

// Keep FSM reference for graceful shutdown
let _fsm: StateMachine | null = null;
let _shuttingDown = false;
let _running = false;
let _settings = loadSettings();

function getStateName(): string | undefined { return _fsm?.getCurrentStateName(); }

function setupShutdown(logger: ReturnType<typeof createLogger>) {
  const shutdown = (signal: string) => {
    if (_shuttingDown) return;
    _shuttingDown = true;
    try { logger.info(`Shutdown requested (${signal}). Stopping FSM...`); } catch {}
    try { _fsm?.stop(); } catch {}
    // give a short grace period for the current step to complete
    setTimeout(() => {
      try { logger.info('Exit now.'); } catch {}
      process.exit(0);
    }, 500);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  // skip pruneOldLogs to avoid file conflicts in parallel runs
  const logger = createLogger();

  logger.info('Starting app (overlay first)...');
  setupShutdown(logger);

  // Overlay server
  const overlay = startOverlayServer(3000, logger, {
    getStatus: () => ({ running: _running, state: getStateName() }),
    start: async () => { if (!_running) { await runFSM(overlay.logger); overlay.notifyStatus(); } },
    stop: async () => { _fsm?.stop(); overlay.notifyStatus(); },
    softExit: () => { _fsm?.stop(); setTimeout(()=>process.exit(0), 200); },
    runTest: async (name: string) => { await runTest(name, overlay.logger); },
    getConfig: () => _settings,
    setConfig: async (partial: any) => { _settings = { ..._settings, ...partial }; },
  });

  const log = overlay.logger; // UI-visible logger

  log.info('Overlay ready. Click Start to launch FSM.');
}

async function runFSM(logger: ReturnType<typeof createLogger> | { info: (m:any)=>void; error: (m:any)=>void; warn?: (m:any)=>void }) {
  const settings = _settings; // snapshot at start
  // Init OpenCV.js (WebAssembly)
  try {
    await initCV((m) => logger.info(m));
  } catch (e: any) {
    logger.error(`OpenCV.js init failed: ${e?.message || e}`);
  }
  // Run CV smoke test
  try {
    await smokeTestContours();
  } catch (e: any) {
    logger.error(`Smoke test failed: ${e?.message || e}`);
  }
  // Ensure capture output dir exists
  const outDir = path.resolve(process.cwd(), settings.capture.outputDir);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  try {
    const saved = await captureOnce({
      outputDir: outDir,
      format: settings.capture.format,
      saveLastFrame: settings.capture.saveLastFrame,
    });
    if (saved) { logger.info(`Captured frame saved to: ${saved}`); }
  } catch (e: any) { logger.error(`Capture failed: ${e?.message || e}`); }

  // Arduino diagnostics on demand at start
  try {
    const actCfg = settings.actions || ({} as any);
    if (actCfg.enableActions && (actCfg.mode || 'powershell') === 'arduino') {
      const actions = new Actions(actCfg);
      logger.info('==> PING');
      const pong = await actions.ping(); if (pong) logger.info(pong);
      logger.info('==> STATUS');
      const st = await actions.status(); if (st) logger.info(st);
    }
  } catch (e: any) { logger.error(`Diagnostics failed: ${e?.message || e}`); }

  const ctx: IStateContext = {
    log: (msg: string) => logger.info(msg),
    targets: [],
  };
  const initial = new BootState();
  const fsm = new StateMachine(initial, ctx);
  _fsm = fsm;
  _running = true;
  try {
    await fsm.start(200);
  } finally {
    _running = false;
  }
}

async function runTest(name: string, logger: { info: (m:any)=>void; error: (m:any)=>void }) {
  const settings = _settings;
  if (name === 'capture') {
    const outDir = path.resolve(process.cwd(), settings.capture.outputDir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    try {
      const saved = await captureOnce({ outputDir: outDir, format: settings.capture.format, saveLastFrame: settings.capture.saveLastFrame });
      logger.info(saved ? `Capture saved: ${saved}` : 'Capture done.');
    } catch (e: any) { logger.error(`Capture failed: ${e?.message || e}`); }
    return;
  }
  if (name === 'smoke') {
    try { await smokeTestContours(); logger.info('Smoke test OK'); }
    catch (e: any) { logger.error(`Smoke test failed: ${e?.message || e}`); }
    return;
  }
  if (name === 'ping') {
    try {
      const actCfg = settings.actions || ({} as any);
      if (actCfg.enableActions && (actCfg.mode || 'powershell') === 'arduino') {
        const actions = new Actions(actCfg);
        const pong = await actions.ping(); logger.info(pong || '');
        const st = await actions.status(); logger.info(st || '');
      } else {
        logger.info('Diagnostics skipped (actions disabled or non-arduino mode).');
      }
    } catch (e: any) { logger.error(`Diagnostics failed: ${e?.message || e}`); }
    return;
  }
  logger.info(`Unknown test: ${name}`);
}

main().catch((e) => {
  // Last-chance error log to console
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

import path from 'path';
import { createLogger, pruneOldLogs } from './core/Logger';
import { loadSettings } from './core/Config';
import { captureOnce } from './core/Capture';
import fs from 'fs';
import { StateMachine } from './spoiler/StateMachine';
import { BootState } from './spoiler/states/BootState';
import type { IStateContext } from './spoiler/State';
import { initCV } from './core/CV';
import { smokeTestContours } from './core/SmokeTest';
import { Actions } from './core/Actions';

// Keep FSM reference for graceful shutdown
let _fsm: StateMachine | null = null;
let _shuttingDown = false;

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
  process.on('beforeExit', () => shutdown('beforeExit'));
}

async function main() {
  pruneOldLogs(10);
  const logger = createLogger();
  const settings = loadSettings();

  logger.info('Starting app...');
  setupShutdown(logger);

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
    if (saved) {
      logger.info(`Captured frame saved to: ${saved}`);
    } else {
      logger.info('Captured frame (not saved by config).');
    }
  } catch (e: any) {
    logger.error(`Capture failed: ${e?.message || e}`);
  }

  // Arduino diagnostics (ping/status) before FSM scan — только если реально включены действия и режим arduino
  try {
    const actCfg = settings.actions || {} as any;
    if (actCfg.enableActions && (actCfg.mode || 'powershell') === 'arduino') {
      const actions = new Actions(actCfg);
      logger.info('==> PING');
      const pong = await actions.ping();
      if (pong) logger.info(pong);
      logger.info('==> STATUS');
      const st = await actions.status();
      if (st) logger.info(st);
    } else {
      logger.info('Diagnostics skipped (actions disabled or non-arduino mode).');
    }
  } catch (e: any) {
    logger.error(`Diagnostics failed: ${e?.message || e}`);
  }

  // Demo: run simple state machine
  const ctx: IStateContext = {
    log: (msg: string) => logger.info(msg),
    targets: [],
  };
  const initial = new BootState();
  const fsm = new StateMachine(initial, ctx);
  _fsm = fsm;
  await fsm.start(200);

  logger.info('Done.');
}

main().catch((e) => {
  // Last-chance error log to console
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

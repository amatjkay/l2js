import fs from 'fs';
import path from 'path';
import { initCV } from '../core/CV';
import { createLogger } from '../core/Logger';
import { scanForTargets } from '../core/Scan';

// Глобально гасим неожиданные ошибки от worker_threads (иногда всплывают из сторонних бандлов)
process.on('uncaughtException', (e) => {
  // eslint-disable-next-line no-console
  console.warn('[warn] uncaughtException:', (e as any)?.message || e);
});
process.on('unhandledRejection', (e) => {
  // eslint-disable-next-line no-console
  console.warn('[warn] unhandledRejection:', (e as any)?.message || e);
});

function listImageRunDirs(base: string): string[] {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .map((name) => path.join(base, name))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
}

async function runOnce(label: string, patch: (cfg: any) => void) {
  const logger = createLogger();
  const base = path.resolve('logs', 'images');
  const before = new Set(listImageRunDirs(base));

  const settingsPath = path.resolve('settings.json');
  const original = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  const cfg = JSON.parse(JSON.stringify(original));

  // Ensure debug saving is on
  cfg.capture = cfg.capture || {};
  cfg.capture.debug = true;
  cfg.cv = cfg.cv || {};
  cfg.cv.ocr = cfg.cv.ocr || {};

  // Apply patch for preset
  patch(cfg);

  // Disable actions for safety
  cfg.actions = cfg.actions || {};
  cfg.actions.enableActions = false;
  cfg.actions.mode = 'powershell';

  fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2), 'utf-8');

  logger.info(`[${label}] init OpenCV`);
  try {
    await initCV((m) => logger.info(m));
  } catch (e: any) {
    logger.warn(`[${label}] OpenCV init warning: ${e?.message || e}`);
  }

  logger.info(`[${label}] scanForTargets()`);
  const targets = await scanForTargets();
  logger.info(`[${label}] targets=${targets.length}`);

  // restore settings
  fs.writeFileSync(settingsPath, JSON.stringify(original, null, 2), 'utf-8');

  // find new run dir
  const after = new Set(listImageRunDirs(base));
  const added = [...after].filter((p) => !before.has(p));
  // pick newest by mtime
  const newest = added.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (newest) {
    logger.info(`[${label}] images dir: ${newest}`);
  } else {
    logger.warn(`[${label}] images dir not found`);
  }
}

async function main() {
  // Пропускаем чистку логов в утилите пресетов, чтобы избежать конфликтов файловых дескрипторов
  // Preset A
  await runOnce('OCR preset A', (cfg) => {
    cfg.cv.ocr.enabled = true;
    cfg.cv.ocr.engine = 'native';
    if (process.env.TESSERACT_PATH) cfg.cv.ocr.tesseractPath = process.env.TESSERACT_PATH;
    cfg.cv.ocr.source = 'binary';
    cfg.cv.ocr.psm = 8;
    cfg.cv.ocr.padding = 4;
    cfg.cv.ocr.minConfidence = 65;
    cfg.cv.ocr.whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    cfg.cv.ocr.debugSaveCrops = true;
    cfg.cv.ocr.maxPerFrame = 6;
  });

  // Preset B
  await runOnce('OCR preset B', (cfg) => {
    cfg.cv.ocr.enabled = true;
    cfg.cv.ocr.engine = 'native';
    if (process.env.TESSERACT_PATH) cfg.cv.ocr.tesseractPath = process.env.TESSERACT_PATH;
    cfg.cv.ocr.source = 'binary';
    cfg.cv.ocr.psm = 7;
    cfg.cv.ocr.padding = 4;
    cfg.cv.ocr.minConfidence = 65;
    cfg.cv.ocr.whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    cfg.cv.ocr.debugSaveCrops = true;
    cfg.cv.ocr.maxPerFrame = 6;
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

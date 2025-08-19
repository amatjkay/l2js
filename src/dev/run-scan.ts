import { initCV } from '../core/CV';
import { createLogger } from '../core/Logger';
import { loadSettings } from '../core/Config';
import { scanForTargets } from '../core/Scan';

async function main() {
  // skip pruneOldLogs to avoid file conflicts in parallel runs
  const logger = createLogger();
  const settings = loadSettings();
  logger.info('run-scan: init OpenCV...');
  try {
    await initCV((m) => logger.info(m));
  } catch (e: any) {
    logger.warn(`run-scan: OpenCV init warning: ${e?.message || e}`);
  }
  logger.info('run-scan: starting scanForTargets()');
  const targets = await scanForTargets();
  logger.info(`run-scan: targets=${targets.length}`);
  logger.info('run-scan: done');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

(async () => {
  try {
    const { initCV } = require('../dist/core/CV');
    const { scanForTargets } = require('../dist/core/Scan');
    await initCV();
    await scanForTargets();
    process.exit(0);
  } catch (e) {
    console.error('run-scan failed:', (e && e.stack) || e);
    process.exit(1);
  }
})();

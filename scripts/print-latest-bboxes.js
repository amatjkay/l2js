const fs = require('fs');
const path = require('path');

(function main() {
  try {
    const base = path.resolve('logs/images');
    if (!fs.existsSync(base)) {
      console.log('NO_LOGS_DIR');
      process.exit(0);
    }
    const dirs = fs.readdirSync(base)
      .map(name => ({ name, full: path.join(base, name), stat: fs.statSync(path.join(base, name)) }))
      .filter(x => x.stat.isDirectory())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    if (!dirs.length) {
      console.log('NO_DIR');
      process.exit(0);
    }
    const latest = dirs[0].full;
    const p = path.join(latest, 'bboxes.json');
    if (!fs.existsSync(p)) {
      console.log('NO_BBOX');
      process.exit(0);
    }
    const txt = fs.readFileSync(p, 'utf8');
    console.log(txt);
  } catch (e) {
    console.error('ERR', e && e.stack || e);
    process.exit(1);
  }
})();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function stripJsonComments(str) {
  // Грубое удаление комментариев JSONC: сначала блочные, затем построчно // ...
  // Предполагаем отсутствие строковых литералов с // внутри (валидно для settings.jsonc).
  const noBlocks = str.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = noBlocks.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const idx = lines[i].indexOf('//');
    if (idx !== -1) lines[i] = lines[i].slice(0, idx);
  }
  return lines.join('\n').trim();
}

function readSettingsJsonc(file) {
  const raw = fs.readFileSync(file, 'utf-8');
  const clean = stripJsonComments(raw);
  return JSON.parse(clean);
}

function writeSettingsJsonc(file, obj) {
  // Пишем без комментариев с отступами
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf-8');
}

function runScan() {
  const res = spawnSync(process.execPath, [path.resolve('scripts', 'run-scan.js')], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  if (res.status !== 0) {
    throw new Error('run-scan failed with code ' + res.status);
  }
}

function withPatchedSettings(label, patch, runs) {
  const cfgPath = path.resolve('settings.jsonc');
  if (!fs.existsSync(cfgPath)) throw new Error('settings.jsonc not found');
  const original = fs.readFileSync(cfgPath, 'utf-8');
  const base = readSettingsJsonc(cfgPath);

  // safety toggles
  base.capture = base.capture || {}; base.capture.debug = true;
  base.actions = base.actions || {}; base.actions.enableActions = false; base.actions.mode = 'powershell';
  base.cv = base.cv || {}; base.cv.ocr = base.cv.ocr || {};

  // apply patch
  patch(base);

  // write
  writeSettingsJsonc(cfgPath, base);

  try {
    for (let i = 0; i < runs; i += 1) {
      console.log(`[${label}] run ${i+1}/${runs}`);
      runScan();
    }
  } finally {
    // restore
    fs.writeFileSync(cfgPath, original, 'utf-8');
  }
}

function variantA() {
  withPatchedSettings('VariantA(minConf=65)', (cfg) => {
    cfg.cv.ocr.enabled = true;
    cfg.cv.ocr.engine = 'native';
    cfg.cv.ocr.minConfidence = 65;
    cfg.cv.ocr.whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ';
  }, 5);
}

function variantB() {
  const minConfs = [50, 60, 65];
  const kernels = [[1,3], [1,5]];
  for (const mc of minConfs) {
    for (const k of kernels) {
      withPatchedSettings(`VariantB(minConf=${mc},k=[${k}])`, (cfg) => {
        cfg.cv.morphKernelSize = k;
        cfg.cv.ocr.enabled = true;
        cfg.cv.ocr.engine = 'native';
        cfg.cv.ocr.minConfidence = mc;
        cfg.cv.ocr.whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ';
      }, 3);
    }
  }
}

(async () => {
  const mode = process.argv[2];
  if (mode === 'A') {
    variantA();
  } else if (mode === 'B') {
    variantB();
  } else {
    console.log('Usage: node scripts/batch-tests.js A|B');
    process.exit(1);
  }
})();

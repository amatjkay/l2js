try {
  const m = require('tesseract.js');
  console.log('[tesseract.js] keys=', Object.keys(m||{}));
  console.log('[tesseract.js] has createWorker:', !!(m && (m.createWorker || (m.default && m.default.createWorker))));
} catch(e){ console.log('[tesseract.js] require failed:', e && e.message); }

try {
  const m2 = require('tesseract.js/dist/tesseract.cjs.js');
  console.log('[tesseract.cjs] keys=', Object.keys(m2||{}));
  console.log('[tesseract.cjs] has createWorker:', !!(m2 && (m2.createWorker || (m2.default && m2.default.createWorker))));
} catch(e){ console.log('[tesseract.cjs] require failed:', e && e.message); }

try {
  const r1 = require.resolve('tesseract.js/dist/worker.min.js');
  console.log('[resolve] worker.min.js ->', r1);
} catch(e){ console.log('[resolve] worker.min.js failed:', e && e.message); }

try {
  const r2 = require.resolve('tesseract.js-core/tesseract-core.wasm');
  console.log('[resolve] tesseract-core.wasm ->', r2);
} catch(e){ console.log('[resolve] tesseract-core.wasm failed:', e && e.message); }

// @ts-nocheck
// Shim to run tesseract.js worker.min.js under Node worker_threads
const { parentPort } = require('worker_threads');
const path = require('path');
const BASE_DIR = __dirname;
// Track last script directory globally for locateFile/fetch resolution
let lastScriptDir = BASE_DIR;

const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof global !== 'undefined' ? global : this);
const self = g;
if (!g.self) g.self = g;
// Global fs patch: redirect raw 'tesseract-core.wasm' reads to Module.wasmBinaryFile if available
try {
  const __fs = require('fs');
  const __rfSync = __fs.readFileSync;
  const __rf = __fs.readFile;
  const __mapWasm = (p) => {
    try {
      const s = String(p || '');
      if (/tesseract-core\.wasm$/i.test(s) && g.Module && typeof g.Module.wasmBinaryFile === 'string') {
        return g.Module.wasmBinaryFile;
      }
    } catch {}
    return p;
  };
  __fs.readFileSync = function(p, options) { return __rfSync.call(this, __mapWasm(p), options); };
  __fs.readFile = function(p, options, cb) {
    if (typeof options === 'function') { cb = options; options = undefined; }
    return __rf.call(this, __mapWasm(p), options, cb);
  };
  try { console.log('[shim] global fs.readFile* redirect active'); } catch {}
} catch {}
// Early universal fetch shim: overrides any existing global fetch to ensure Response-like
try { g.__nativeFetch = (typeof g.fetch === 'function') ? g.fetch : null; } catch {}
g.fetch = async function universalFetch(url, init) {
  try {
    if (typeof __innerFetch === 'function') {
      return await __innerFetch(url, init);
    }
  } catch {}
  // Minimal Response-like helper
  const makeResp = (ok, status, buf, headersObj) => ({
    ok: !!ok,
    status: status || (ok ? 200 : 500),
    statusText: ok ? 'OK' : 'Error',
    headers: new (g.Headers || class { constructor(obj){ this._obj=obj||{}; } get(n){ return this._obj[n]||this._obj[n?.toLowerCase()]; } }) (headersObj||{}),
    async arrayBuffer(){ const b = Buffer.isBuffer(buf)?buf:Buffer.from(buf||''); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
    async text(){ const b = Buffer.isBuffer(buf)?buf:Buffer.from(buf||''); return b.toString('utf8'); },
    async json(){ try { const b = Buffer.isBuffer(buf)?buf:Buffer.from(buf||''); return JSON.parse(b.toString('utf8')||'{}'); } catch { return {}; } },
  });
  try {
    // Handle ArrayBuffer/TypedArray/Buffer directly
    if (url instanceof ArrayBuffer) return makeResp(true, 200, Buffer.from(new Uint8Array(url)), { 'Content-Type': 'application/octet-stream' });
    if (ArrayBuffer.isView && ArrayBuffer.isView(url)) return makeResp(true, 200, Buffer.from(url.buffer, url.byteOffset, url.byteLength));
    if (Buffer.isBuffer && Buffer.isBuffer(url)) return makeResp(true, 200, url);
    // data: URL support
    if (typeof url === 'string' && url.startsWith('data:')) {
      const m = url.match(/^data:([^;,]*)(;base64)?,(.*)$/);
      if (m) {
        const mime = m[1] || 'application/octet-stream';
        const isB64 = !!m[2];
        const dataStr = m[3];
        const buf = isB64 ? Buffer.from(dataStr, 'base64') : Buffer.from(decodeURIComponent(dataStr), 'utf8');
        return makeResp(true, 200, buf, { 'Content-Type': mime });
      }
    }
    // If http(s) and native fetch exists, delegate to it but ensure Response-like
    if (typeof url === 'string' && /^https?:/i.test(url) && typeof g.__nativeFetch === 'function') {
      try {
        const r = await g.__nativeFetch(url, init);
        if (!r) return makeResp(false, 502, Buffer.alloc(0));
        if (typeof r.ok === 'boolean' && typeof r.arrayBuffer === 'function') return r;
        const txt = typeof r.text === 'function' ? await r.text() : '';
        return makeResp(r.status >= 200 && r.status < 300, r.status || 200, Buffer.from(txt||''));
      } catch (e) {
        try { console.warn('[shim] universalFetch native delegate error:', e && e.message); } catch {}
        return makeResp(false, 502, Buffer.alloc(0));
      }
    }
    // Local file path fallback
    if (typeof url === 'string') {
      let p = url.replace(/^file:\/\//, '');
      const fs = require('fs');
      const path = require('path');
      if (!path.isAbsolute(p)) p = path.resolve(__dirname, p);
      const data = fs.readFileSync(p);
      const mime = /\.wasm$/i.test(p) ? 'application/wasm' : 'application/octet-stream';
      return makeResp(true, 200, data, { 'Content-Type': mime });
    }
  } catch (e) {
    try { console.warn('[shim] universalFetch error:', e && e.message); } catch {}
  }
  return makeResp(false, 503, Buffer.alloc(0));
};
// Diagnostic: capture crashes inside worker
try {
  if (typeof process !== 'undefined' && process && process.on) {
    process.on('uncaughtException', (e) => {
      try { console.error('[shim] uncaughtException:', e && e.stack ? e.stack : e); } catch {}
    });
    process.on('unhandledRejection', (r) => {
      try { console.error('[shim] unhandledRejection:', r && r.stack ? r.stack : r); } catch {}
    });
  }
} catch {}
// Expose Node globals that Emscripten/wasm.js may probe
if (!g.require && typeof require === 'function') g.require = require;
if (!g.process && typeof process !== 'undefined') g.process = process;
if (!g.__filename) g.__filename = __filename;
if (!g.__dirname) g.__dirname = __dirname;
// Ensure Module with locateFile exists for Emscripten loader
if (!g.Module) g.Module = {};
if (typeof g.Module.locateFile !== 'function') {
  g.Module.locateFile = (p, prefix) => {
    try {
      if (typeof p === 'string' && path.isAbsolute(p)) return p;
      const fname = String(p);
      // Special handling for tesseract core wasm files
      if (/tesseract-core(.*)\.wasm$/i.test(fname)) {
        try {
          // Try resolve alongside whichever core js is present
          let coreJs;
          try { coreJs = require.resolve('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'); } catch {}
          if (!coreJs) { try { coreJs = require.resolve('tesseract.js-core/tesseract-core.js'); } catch {}
          }
          if (coreJs) {
            const dir = path.dirname(coreJs);
            const fs = require('fs');
            const candidates = [];
            candidates.push(path.join(dir, fname));
            // Map plain name to simd-lstm variant
            if (!/-simd-lstm\.wasm$/i.test(fname)) {
              candidates.push(path.join(dir, fname.replace(/tesseract-core/i, 'tesseract-core-simd-lstm')));
            }
            // Derive from the .wasm.js next to it
            const jsBase = path.basename(coreJs);
            if (/\.wasm\.js$/i.test(jsBase)) {
              candidates.push(path.join(dir, jsBase.replace(/\.wasm\.js$/i, '.wasm')));
            }
            for (const c of candidates) {
              try { if (fs.existsSync(c)) return c; } catch {}
            }
            // Fall back to first candidate (likely correct dir, different name)
            return candidates[0];
          }
        } catch {}
      }
      const base = (lastScriptDir || BASE_DIR).replace(/\\/g, '/');
      return base + '/' + fname;
    } catch { return String(p); }
  };
  // fetch assignment moved below after __innerFetch is defined
}

// Disable streaming APIs to force Emscripten fallback path (more reliable for file:// in Node)
if (g.WebAssembly) {
  try { g.WebAssembly.instantiateStreaming = undefined; } catch (e) {}
  try { g.WebAssembly.compileStreaming = undefined; } catch (e) {}
}

// Bridge events between worker_threads and web-worker API if missing
if (typeof g.postMessage !== 'function') {
  g.postMessage = (data) => parentPort.postMessage(data);
}
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = (type, handler) => {
    if (type === 'message') parentPort.on('message', (evt) => handler({ data: evt }));
  };
  // Bind global fetch to the safe implementation
  try { g.fetch = __innerFetch; console.log('[shim] global fetch bound to __innerFetch'); } catch {}
}
if (typeof g.removeEventListener !== 'function') {
  g.removeEventListener = (type, handler) => {
    if (type === 'message') parentPort.off && parentPort.off('message', handler);
  };
}

// Basic message event polyfill
if (typeof g.addEventListener !== 'function') {
  const listeners = new Map();
  g.addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  };
  g.removeEventListener = (type, listener) => {
    const set = listeners.get(type);
    if (set) set.delete(listener);
  };
  const emit = (type, data) => {
    const set = listeners.get(type);
    if (set) for (const fn of set) try { fn({ data }); } catch {}
  };
  if (parentPort) parentPort.on('message', (data) => emit('message', data));
}

if (typeof g.postMessage !== 'function') {
  g.postMessage = (data) => { if (parentPort) parentPort.postMessage(data); };
}

if (typeof g.self === 'undefined') {
  g.self = g;
}

// Provide Emscripten-style file readers to avoid relying on fetch inside wasm.js
try {
  const fs = require('fs');
  const pathMod = require('path');
  const resolvePath = (u) => {
    try {
      let p = u;
      if (typeof p !== 'string') p = String(p);
      if (p.startsWith('file://')) p = p.replace(/^file:\/\//, '');
      if (!pathMod.isAbsolute(p)) {
        try {
          const Module = g.Module || g.TesseractCore || g.__TESS_MODULE__;
          if (Module && typeof Module.locateFile === 'function') {
            const located = Module.locateFile(p, (lastScriptDir || BASE_DIR).replace(/\\/g, '/') + '/');
            if (located && typeof located === 'string') p = located.replace(/^file:\/\//, '');
          }
        } catch {}
        if (!pathMod.isAbsolute(p)) p = pathMod.resolve(lastScriptDir || BASE_DIR, p);
      }
      return p;
    } catch { return String(u); }
  };
  if (typeof g.readBinary !== 'function') {
    g.readBinary = (u) => {
      const p = resolvePath(u);
      const buf = fs.readFileSync(p);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    };
  }
  if (typeof g.readAsync !== 'function') {
    g.readAsync = (u, onload, onerror) => {
      try {
        const p = resolvePath(u);
        fs.readFile(p, (err, data) => {
          if (err) return onerror && onerror(err);
          const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          onload && onload(view);
        });
      } catch (e) { onerror && onerror(e); }
    };
  }
} catch {}

// importScripts polyfill -> execute file in global and remember its dir
if (typeof g.importScripts !== 'function') {
  const fs = require('fs');
  const vm = require('vm');
  // use outer lastScriptDir
  g.importScripts = (...urls) => {
    for (let url of urls) {
      try {
        console.log('[shim] importScripts request:', url);
        let target = url;
        if (typeof target === 'string' && target.startsWith('file://')) {
          target = target.replace(/^file:\/\//, '');
        }
        if (typeof target === 'string' && !path.isAbsolute(target)) {
          // Resolve relative to base dir
          target = path.resolve(BASE_DIR, target);
        }
        if (typeof target === 'string') {
          // Set location.href so Emscripten can resolve locateFile relative paths
          if (!g.location || typeof g.location !== 'object') {
            g.location = { href: 'file://' + target.replace(/\\/g, '/') };
          } else {
            g.location.href = 'file://' + target.replace(/\\/g, '/');
          }
          lastScriptDir = path.dirname(target);
        }
        console.log('[shim] importScripts resolved path:', target);
        // Execute file contents in current global context to emulate real importScripts
        const code = fs.readFileSync(target, 'utf8');
        vm.runInThisContext(code, { filename: target });
      } catch (e) {
        console.error('[shim] importScripts failed:', url, e && e.stack ? e.stack : e);
        throw e;
      }
    }
  };
}

// Override fetch to support local files even on Node 20 (where global fetch exists but doesn't handle file paths)
{
  let fetchMod;
  let NFResponse, NFHeaders, NFRequest, nodeFetch;
  try {
    fetchMod = require('node-fetch');
    // node-fetch@2 exposes properties on the function, @3 exposes named exports
    nodeFetch = typeof fetchMod === 'function' ? fetchMod : (fetchMod.default || fetchMod);
    NFResponse = fetchMod.Response || (fetchMod.default && fetchMod.default.Response);
    NFHeaders  = fetchMod.Headers  || (fetchMod.default && fetchMod.default.Headers);
    NFRequest  = fetchMod.Request  || (fetchMod.default && fetchMod.default.Request);
  } catch {}
  const Response = g.Response || NFResponse;
  const Headers = g.Headers || NFHeaders;
  const Request = g.Request || NFRequest;
  if (!g.Response && Response) g.Response = Response;
  if (!g.Headers && Headers) g.Headers = Headers;
  if (!g.Request && Request) g.Request = Request;
  const fs = require('fs');
  const ensureResponseLike = (res, fallbackStatus=200) => {
    try {
      if (!res) throw new Error('no response');
      if (typeof res.ok === 'boolean' && typeof res.arrayBuffer === 'function') return res;
      const headers = new (g.Headers || class {})();
      return {
        ok: typeof res.ok === 'boolean' ? res.ok : (res.status ? (res.status >= 200 && res.status < 300) : (fallbackStatus>=200 && fallbackStatus<300)),
        status: res.status || fallbackStatus,
        statusText: res.statusText || (res.status && String(res.status)) || 'OK',
        headers,
        async arrayBuffer() { return typeof res.arrayBuffer === 'function' ? res.arrayBuffer() : new ArrayBuffer(0); },
        async text() { return typeof res.text === 'function' ? res.text() : ''; },
        async json() { try { return typeof res.json === 'function' ? res.json() : {}; } catch { return {}; } },
      };
    } catch {
      return new (class MinimalResponse { constructor(){ this.ok=false; this.status=502; this.statusText='Bad Gateway'; this.headers=new (g.Headers||class {})(); } async arrayBuffer(){ return new ArrayBuffer(0);} async text(){ return ''; } async json(){ return {}; } })();
    }
  };
  const __innerFetch = async (url, init) => {
    try { console.log('[shim] fetch in:', typeof url, url && (url.url || url.href || (url.constructor && url.constructor.name)), 'value=', url, '| typeof Response=', typeof Response); } catch {}
    try {
      let original = url;
      if (url == null) {
        try { console.warn && console.warn('[shim] fetch: null/undefined url, returning MinimalResponse'); } catch {}
        return new (class MinimalResponse { constructor(){ this.ok=false; this.status=400; this.statusText='Bad Request'; this.headers=new (g.Headers||class {})(); } async arrayBuffer(){ return new ArrayBuffer(0);} async text(){ return ''; } async json(){ return {}; } })();
      }
      // Coerce boxed String objects to primitive string
      if (url && typeof url === 'object' && url.constructor === String && typeof url.valueOf === 'function') {
        url = url.valueOf();
      }
      // If ArrayBuffer/Uint8Array/Buffer passed, wrap into Response
      if (url instanceof ArrayBuffer) {
        if (typeof Response === 'function') { console.log('[shim] fetch: returning Response from ArrayBuffer'); return ensureResponseLike(new Response(Buffer.from(url), { status: 200 }), 200); }
        const b = Buffer.from(url);
        return ensureResponseLike({ ok: true, status: 200, statusText: 'OK', headers: new (g.Headers || class {})(), async arrayBuffer(){ return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }, async text(){ return b.toString('utf8'); } }, 200);
      }
      if (ArrayBuffer.isView(url)) {
        const view = url;
        const buf = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
        if (typeof Response === 'function') { console.log('[shim] fetch: returning Response from TypedArray'); return ensureResponseLike(new Response(buf, { status: 200 }), 200); }
        return ensureResponseLike({ ok: true, status: 200, statusText: 'OK', headers: new (g.Headers || class {})(), async arrayBuffer(){ return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }, async text(){ return buf.toString('utf8'); } }, 200);
      }
      if (Buffer.isBuffer && Buffer.isBuffer(url)) {
        if (typeof Response === 'function') { console.log('[shim] fetch: returning Response from Buffer'); return ensureResponseLike(new Response(url, { status: 200 }), 200); }
        const buf = url;
        return ensureResponseLike({ ok: true, status: 200, statusText: 'OK', headers: new (g.Headers || class {})(), async arrayBuffer(){ return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }, async text(){ return buf.toString('utf8'); } }, 200);
      }
      // Support data: URLs (e.g., data:application/wasm;base64,....)
      if (typeof url === 'string' && url.startsWith('data:')) {
        const m = url.match(/^data:([^;,]*)(;base64)?,(.*)$/);
        if (m) {
          const mime = m[1] || 'application/octet-stream';
          const isB64 = !!m[2];
          const dataStr = m[3];
          const buf = isB64 ? Buffer.from(dataStr, 'base64') : Buffer.from(decodeURIComponent(dataStr), 'utf8');
          if (typeof Response === 'function') { console.log('[shim] fetch: returning Response from data: URL'); return ensureResponseLike(new Response(buf, { status: 200, headers: { 'Content-Type': mime } }), 200); }
          return ensureResponseLike({ ok: true, status: 200, statusText: 'OK', headers: new (g.Headers || class { constructor(obj){ this._obj=obj||{}; } get(name){ return this._obj[name]||this._obj[name?.toLowerCase()]; } }) ({ 'Content-Type': mime }), async arrayBuffer(){ return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }, async text(){ return buf.toString('utf8'); } }, 200);
        }
      }
      // Normalize Request/URL/Response to string or passthrough
      if (url && typeof url === 'object') {
        // True Response-like object: has ok or body methods
        const isResponseLike = (typeof url.ok === 'boolean') || (typeof url.arrayBuffer === 'function' && typeof url.text === 'function');
        if (isResponseLike) {
          try { console.debug && console.debug('[shim] fetch: passthrough Response-like'); } catch {}
          return url;
        }
        // Request-like
        if (typeof url.url === 'string') { url = url.url; try { console.debug && console.debug('[shim] fetch: Request-like →', url); } catch {} }
        else if (typeof url.href === 'string') { url = url.href; try { console.debug && console.debug('[shim] fetch: URL-like →', url); } catch {} }
        else {
          if (typeof nodeFetch === 'function') {
            const res = await nodeFetch(original, init);
            try { console.debug && console.debug('[shim] fetch: delegated unknown object to node-fetch, got', typeof res, res && res.status); } catch {}
            return ensureResponseLike(res, res && res.status ? res.status : 200);
          }
          // Fallback: stringify unknown object
          url = String(url);
        }
      }
      try { console.log('[shim] fetch request raw:', url); } catch {}
      // console.log('[shim] fetch request:', url, 'originalType=', typeof original);
      if (typeof url === 'string' && !(function(u){ try { return /^https?:/i.test(u); } catch { return false; } })(url)) {
        let p = url;
        if (p.startsWith('file://')) p = p.replace(/^file:\/\//, '');
        if (!path.isAbsolute(p)) {
          // Honor Emscripten locateFile if present
          try {
            const Module = g.Module || g.TesseractCore || g.__TESS_MODULE__;
            if (Module && typeof Module.locateFile === 'function') {
              const located = Module.locateFile(p, (lastScriptDir || BASE_DIR).replace(/\\/g, '/') + '/');
              if (located && typeof located === 'string') {
                p = located.replace(/^file:\/\//, '');
              }
            }
          } catch {}
          if (!path.isAbsolute(p)) p = path.resolve(lastScriptDir || BASE_DIR, p);
        }
        try { console.log('[shim] fetch resolved local path:', p); } catch {}
        try { console.log('[shim] fetch: local file path →', p); } catch {}
        const buf = fs.readFileSync(p);
        const contentType = /\.wasm$/i.test(p) ? 'application/wasm' : 'application/javascript; charset=utf-8';
        // Return a minimal Response-like object to satisfy Emscripten's checks
        const headersObj = { 'Content-Type': contentType };
        const resp = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new (g.Headers || class { constructor(obj){ this._obj=obj||{}; } get(name){ return this._obj[name]||this._obj[name?.toLowerCase()]; } }) (headersObj),
          async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
          async text() { return buf.toString('utf8'); },
          async json() { try { return JSON.parse(buf.toString('utf8')); } catch { return {}; } },
        };
        try { console.log('[shim] fetch: returning local Response-like with bytes=', buf.byteLength); } catch {}
        console.log('[shim] fetch: return local resp.ok=', resp.ok, 'status=', resp.status);
        return ensureResponseLike(resp, resp.status || 200);
      }
      if (typeof nodeFetch === 'function') {
        const res = await nodeFetch(url, init);
        try { console.log('[shim] fetch: node-fetch response', res && res.status, res && typeof res.ok); } catch {}
        // Ensure we never return undefined
        if (!res) {
          try { console.warn && console.warn('[shim] fetch: node-fetch returned undefined, returning MinimalResponse'); } catch {}
          return new (class MinimalResponse { constructor(){ this.ok=false; this.status=502; this.statusText='Bad Gateway'; this.headers=new (g.Headers||class {})(); } async arrayBuffer(){ return new ArrayBuffer(0);} async text(){ return ''; } async json(){ return {}; } })();
        }
        console.log('[shim] fetch: return node-fetch res.ok=', typeof res.ok === 'boolean' ? res.ok : '(no ok)', 'status=', res.status);
        return ensureResponseLike(res, res.status || 200);
      }
      // Final fallback using http(s) module if node-fetch is unavailable
      // Provide minimal Response-like object
      const m = new (class MinimalResponse {
        constructor() { this.ok = false; this.status = 501; this.statusText = 'Not Implemented'; this.headers = new (g.Headers || class {} )(); }
        async arrayBuffer() { return new ArrayBuffer(0); }
        async text() { return ''; }
        async json() { return {}; }
      })();
      console.log('[shim] fetch: final fallback MinimalResponse');
      return ensureResponseLike(m, m.status || 501);
    } catch (e) {
      console.error('[shim] fetch error:', e && e.stack ? e.stack : e);
      // Do not throw; return a Response-like so callers can check .ok
      const m = new (class MinimalResponse {
        constructor() { this.ok = false; this.status = 500; this.statusText = 'Internal Error'; this.headers = new (g.Headers || class {} )(); }
        async arrayBuffer() { return new ArrayBuffer(0); }
        async text() { return ''; }
        async json() { return {}; }
      })();
      console.log('[shim] fetch: returning MinimalResponse from catch');
      return ensureResponseLike(m, m.status || 500);
    }
  };
}

// Load original tesseract worker
try {
  const ModuleCtor = require('module');
  const modPath = (() => { try { return require.resolve('node-fetch'); } catch { return null; } })();
  if (modPath) {
    const real = require(modPath);
    const realFn = (typeof real === 'function') ? real : (real && (real.default || real.fetch) || real);
    const NFResponse = real.Response || (real.default && real.default.Response);
    const NFHeaders  = real.Headers  || (real.default && real.default.Headers);
    const NFRequest  = real.Request  || (real.default && real.default.Request);
    const makeSafe = (rf) => {
      const safe = async (...args) => {
        try {
          const r = await rf(...args);
          if (!r) {
            return new (class MinimalResponse { constructor(){ this.ok=false; this.status=502; this.statusText='Bad Gateway'; this.headers=new (g.Headers||class {})(); } async arrayBuffer(){ return new ArrayBuffer(0);} async text(){ return ''; } async json(){ return {}; } })();
          }
          if (typeof r.ok === 'boolean' && typeof r.arrayBuffer === 'function') return r;
          // Wrap plain object
          const headers = new (g.Headers || NFHeaders || class {})();
          return {
            ok: typeof r.ok === 'boolean' ? r.ok : (r.status ? (r.status >= 200 && r.status < 300) : false),
            status: r.status || 200,
            statusText: r.statusText || 'OK',
            headers,
            async arrayBuffer(){ return typeof r.arrayBuffer === 'function' ? r.arrayBuffer() : new ArrayBuffer(0); },
            async text(){ return typeof r.text === 'function' ? r.text() : ''; },
            async json(){ try { return typeof r.json === 'function' ? r.json() : {}; } catch { return {}; } },
          };
        } catch (e) {
          try { console.error('[shim] node-fetch safe wrapper error:', e && e.stack ? e.stack : e); } catch {}
          return new (class MinimalResponse { constructor(){ this.ok=false; this.status=500; this.statusText='Fetch Error'; this.headers=new (g.Headers||class {})(); } async arrayBuffer(){ return new ArrayBuffer(0);} async text(){ return ''; } async json(){ return {}; } })();
        }
      };
      // Re-export classes to satisfy code paths referencing fetch.Response
      safe.Response = NFResponse || g.Response || class {};
      safe.Headers = NFHeaders || g.Headers || class {};
      safe.Request = NFRequest || g.Request || class {};
      return safe;
    };
    const wrapped = makeSafe(realFn);
    require.cache[modPath] = { id: modPath, filename: modPath, loaded: true, exports: wrapped };
    try { console.log('[shim] node-fetch wrapped at', modPath); } catch {}
  }
} catch (e) { try { console.warn('[shim] failed to wrap node-fetch:', e && e.stack ? e.stack : e); } catch {} }

// Ensure a robust fetch/Response exists BEFORE loading the worker bundle, so wasm.js uses it
try {
  // Unify globals
  try { g.self = g; } catch {}
  try { g.window = g; } catch {}
  try { g.globalThis = g; } catch {}
  if (typeof g.Response !== 'function') {
    g.Response = function(body, init) {
      const buf = Buffer.isBuffer(body) ? body : (body instanceof ArrayBuffer ? Buffer.from(new Uint8Array(body)) : Buffer.from(String(body||'')));
      const status = (init && init.status) || 200;
      const statusText = (init && init.statusText) || 'OK';
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        text: async () => buf.toString('utf8'),
        json: async () => JSON.parse(buf.toString('utf8') || 'null'),
        headers: (init && init.headers) || {},
        url: (init && init.url) || ''
      };
    };
  }
  if (typeof g.fetch !== 'function') {
    const fs = require('fs');
    const localFetch = async (url, init) => {
      try {
        if (typeof url === 'string') {
          let p = url.replace(/^file:\/\//, '');
          if (/^https?:/i.test(p)) {
            // Fallback minimal HTTP fetch using node-fetch if available, else return 404 Response
            try {
              const nf = require('node-fetch');
              const r = await nf(url, init);
              return r || new g.Response('', { status: 502, statusText: 'Bad Gateway' });
            } catch {
              return new g.Response('', { status: 404, statusText: 'Not Found' });
            }
          }
          if (!path.isAbsolute(p)) p = path.resolve(BASE_DIR, p);
          const data = fs.readFileSync(p);
          return new g.Response(data, { status: 200, statusText: 'OK', url });
        }
        if (url && url.byteLength != null) {
          return new g.Response(Buffer.from(url.buffer ? new Uint8Array(url.buffer) : url), { status: 200 });
        }
        return new g.Response('', { status: 200 });
      } catch (e) {
        try { console.warn('[shim] pre-fetch error:', e && e.message); } catch {}
        return new g.Response('', { status: 500, statusText: 'Error' });
      }
    };
    g.fetch = (...args) => { try { console.log('[shim] fetch called pre-bundle with', typeof args[0] === 'string' ? args[0] : Object.prototype.toString.call(args[0])); } catch {} return localFetch(...args); };
  }
  // Mirror fetch on common global aliases to avoid scope resolution issues inside imported scripts
  try { if (!g.self.fetch || g.self.fetch === undefined) g.self.fetch = g.fetch; } catch {}
  try { if (!g.window.fetch || g.window.fetch === undefined) g.window.fetch = g.fetch; } catch {}
  try { if (!g.globalThis.fetch || g.globalThis.fetch === undefined) g.globalThis.fetch = g.fetch; } catch {}
} catch {}

// Force Emscripten wasm loader to avoid instantiateStreaming(fetch(...)) path that inspects response.ok
try { if (g.WebAssembly && typeof g.WebAssembly === 'object') { g.WebAssembly.instantiateStreaming = undefined; } } catch {}

// Надёжный путь: всегда использовать dist/web-воркер Tesseract
try {
  require('tesseract.js/dist/worker.min.js');
  console.log('[shim] loaded dist/worker.min.js');
} catch (e) {
  console.warn('[shim] failed to load dist/worker.min.js:', e && e.message);
  throw e;
}

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
      const base = (lastScriptDir || BASE_DIR).replace(/\\/g, '/');
      return base + '/' + String(p);
    } catch { return String(p); }
  };
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
  const nodeFetch = require('node-fetch');
  const { Response, Headers, Request } = nodeFetch;
  if (!g.Response) g.Response = Response;
  if (!g.Headers) g.Headers = Headers;
  if (!g.Request) g.Request = Request;
  const fs = require('fs');
  g.fetch = async (url, init) => {
    try {
      let original = url;
      // If ArrayBuffer/Uint8Array/Buffer passed, wrap into Response
      if (url instanceof ArrayBuffer) {
        return new Response(Buffer.from(url), { status: 200 });
      }
      if (ArrayBuffer.isView(url)) {
        const view = url;
        const buf = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
        return new Response(buf, { status: 200 });
      }
      if (Buffer.isBuffer && Buffer.isBuffer(url)) {
        return new Response(url, { status: 200 });
      }
      // Support data: URLs (e.g., data:application/wasm;base64,....)
      if (typeof url === 'string' && url.startsWith('data:')) {
        const m = url.match(/^data:([^;,]*)(;base64)?,(.*)$/);
        if (m) {
          const mime = m[1] || 'application/octet-stream';
          const isB64 = !!m[2];
          const dataStr = m[3];
          const buf = isB64 ? Buffer.from(dataStr, 'base64') : Buffer.from(decodeURIComponent(dataStr), 'utf8');
          return new Response(buf, { status: 200, headers: { 'Content-Type': mime } });
        }
      }
      // Normalize Request/URL/Response to string or passthrough
      if (url && typeof url === 'object') {
        if (typeof url.arrayBuffer === 'function' && typeof url.text === 'function') {
          // Likely a Response already; passthrough
          return url;
        }
        if (typeof url.url === 'string') url = url.url; // Request
        else if (typeof url.href === 'string') url = url.href; // URL
        else {
          // Unknown object -> delegate to node-fetch
          return nodeFetch(original, init);
        }
      }
      // console.log('[shim] fetch request:', url, 'originalType=', typeof original);
      if (typeof url === 'string' && !/^https?:/i.test(url)) {
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
        // console.log('[shim] fetch resolved local path:', p);
        const buf = fs.readFileSync(p);
        const contentType = /\.wasm$/i.test(p) ? 'application/wasm' : 'application/javascript; charset=utf-8';
        return new Response(buf, { status: 200, headers: { 'Content-Type': contentType } });
      }
      return nodeFetch(url, init);
    } catch (e) {
      console.error('[shim] fetch error:', e && e.stack ? e.stack : e);
      throw e;
    }
  };
}

// Load original tesseract worker
require('tesseract.js/dist/worker.min.js');

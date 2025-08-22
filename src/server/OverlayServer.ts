import http, { IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { AppLogger } from '../core/Logger';

type Controls = {
  getStatus: () => { running: boolean; state?: string };
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  softExit: () => void;
  runTest?: (name: string) => Promise<void> | void;
  getConfig?: () => any;
  setConfig?: (partial: any) => Promise<void> | void;
};

export function startOverlayServer(port: number, logger: AppLogger, controls: Controls) {
  const clients: ServerResponse[] = [];
  const buildTag = new Date().toISOString().replace(/[:.]/g, '-');

  function sendEvent(data: any) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    for (const res of clients.slice()) {
      try {
        res.write(`data: ${str}\n\n`);
      } catch {
        try { res.end(); } catch {}
      }
    }
  }
  // Lightweight log forwarder without monkey-patching methods
  function emitLog(level: 'info'|'warn'|'error', message: any) {
    const st = controls.getStatus();
    const msg = typeof message === 'string' ? message : String(message);
    const withState = `[${st.state || '-'}] ${msg}`;
    try { sendEvent({ type: 'log', level, message: withState }); } catch {}
    try { (logger as any).log({ level, message }); } catch { /* ignore */ }
  }

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = parse(req.url || '/', true);
    const { pathname, query } = url;

    // CORS for convenience
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

    if (pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(htmlPageWrapped());
      return;
    }
    if (pathname === '/app.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(appJs());
      return;
    }

    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      clients.push(res);
      // send initial status
      res.write(`data: ${JSON.stringify({ type: 'status', ...controls.getStatus() })}\n\n`);
      req.on('close', () => {
        const i = clients.indexOf(res);
        if (i >= 0) clients.splice(i, 1);
      });
      return;
    }

    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(controls.getStatus()));
      return;
    }

    if (pathname === '/api/start' && req.method === 'POST') {
      try { await controls.start(); } catch (e: any) { logger.error(e?.message || String(e)); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      sendEvent({ type: 'status', ...controls.getStatus() });
      return;
    }

    if (pathname === '/api/stop' && req.method === 'POST') {
      try { await controls.stop(); } catch (e: any) { logger.error(e?.message || String(e)); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      sendEvent({ type: 'status', ...controls.getStatus() });
      return;
    }

    if (pathname === '/api/exit' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      setTimeout(() => controls.softExit(), 50);
      return;
    }

    if (pathname === '/api/tests/run' && req.method === 'POST') {
      const name = String((query as any).name || '').toLowerCase();
      try {
        await (controls.runTest?.(name) || Promise.resolve());
        emitLog('info', `Test '${name}' finished.`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) {
        emitLog('error', `Test '${name}' failed: ${e?.message || e}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
      }
      return;
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      const cfg = controls.getConfig?.() ?? {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cfg));
      return;
    }
    if (pathname === '/api/config' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', async () => {
        try {
          const json = body ? JSON.parse(body) : {};
          await (controls.setConfig?.(json) || Promise.resolve());
          emitLog('info', 'Config updated (runtime overrides).');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e: any) {
          emitLog('error', `Config update failed: ${e?.message || e}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, () => {
    emitLog('info', `Overlay server listening on http://localhost:${port}`);
  });

  function htmlPage() {
    return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"/><title>Overlay</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;background:#0b0f14;color:#e6eef8;margin:0;padding:16px}
.card{background:#111826;border:1px solid #1d2a3a;border-radius:8px;padding:16px;max-width:1000px;margin:0 auto 16px}
.btn{background:#1e90ff;border:none;color:#fff;padding:8px 12px;margin:6px 8px 6px 0;border-radius:6px;cursor:pointer}
.btn.stop{background:#ff4757}
.btn.exit{background:#ffa502}
.status{margin-top:12px;font-size:14px;color:#9fb3c8}
.row{display:flex;gap:12px;flex-wrap:wrap}
.field{display:flex;flex-direction:column;min-width:160px}
.field input,.field select{background:#0a121d;color:#e6eef8;border:1px solid #1d2a3a;border-radius:6px;padding:6px}
.log{margin-top:16px;background:#0a121d;border:1px solid #1d2a3a;border-radius:6px;padding:8px;height:300px;overflow:auto;font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap}
</style></head><body>
<div class="card">
<h2>Control Overlay</h2>
<div>
  <button class="btn" id="start">Start</button>
  <button class="btn stop" id="stop">Stop</button>
  <button class="btn exit" id="exit">Soft Exit</button>
<div style="margin-top:12px;font-size:12px;color:#8aa0b2">Overlay build: ${buildTag}</div>
</div>
<div class="status" id="status">—</div>
<div class="log" id="log"></div>
<div id="notes" class="status" style="margin-top:8px;"></div>
</div>

<div class="card">
  <h3>Tests</h3>
  <div>
    <button class="btn" data-test="capture">Capture</button>
    <button class="btn" data-test="smoke">Smoke</button>
    <button class="btn" data-test="ping">Ping/Status</button>
  </div>
</div>

<div class="card">
  <h3>Config</h3>
  <div class="row">
    <div class="field"><label>scrollPerStep</label><select id="cfg_scrollPerStep"><option value="true">true</option><option value="false">false</option></select></div>
    <div class="field"><label>stepPauseMultiplier</label><input id="cfg_stepPauseMultiplier" type="number" step="0.1" min="0"/></div>
    <div class="field"><label>tiltDyMax</label><input id="cfg_tiltDyMax" type="number" step="1"/></div>
    <div class="field"><label>scrollMin</label><input id="cfg_scrollMin" type="number" step="1"/></div>
    <div class="field"><label>scrollMax</label><input id="cfg_scrollMax" type="number" step="1"/></div>
  </div>
  <div><button class="btn" id="cfg_load">Load</button><button class="btn" id="cfg_save">Save</button></div>
</div>
<script src="/app.js"></script>
</body></html>`;
  }

  function appJs() {
    const lines: string[] = [];
    lines.push('(function(){');
    lines.push('  "use strict";');
    lines.push('  var statusEl=document.getElementById("status");');
    lines.push('  var logEl=document.getElementById("log");');
    lines.push('  var notesEl=document.getElementById("notes");');
    lines.push('  function setStatus(s){ statusEl.textContent = "Status: "+(s.running?"running":"idle")+(s.state?(" | state: "+s.state):""); }');
    lines.push('  function post(path){ return fetch(path,{method:"POST"}); }');
    lines.push('  function refresh(){ return fetch("/api/status").then(function(r){return r.json();}).then(function(s){ setStatus(s); }); }');
    lines.push('  refresh();');
    lines.push('  var es=new EventSource("/api/events");');
    lines.push('  var lastRunning=null, lastState=null;');
    lines.push('  function note(t){ if(!notesEl) return; var p=document.createElement("div"); p.textContent=t; notesEl.prepend(p); setTimeout(function(){ if(p.parentNode) p.parentNode.removeChild(p); }, 5000); }');
    lines.push('  es.onmessage=function(e){');
    lines.push('    try {');
    lines.push('      var m = JSON.parse(e.data);');
    lines.push('      if (m.type === "status") {');
    lines.push('        setStatus(m);');
    lines.push('        if (lastRunning !== null) {');
    lines.push('          if (!lastRunning && m.running) { note("Started: "+(m.state||"")); }');
    lines.push('          if (lastRunning && !m.running) { note("Stopped"); }');
    lines.push('          if (lastState !== m.state && m.running) { note("State: "+(m.state||"")); }');
    lines.push('        }');
    lines.push('        lastRunning = m.running;');
    lines.push('        lastState = m.state || null;');
    lines.push('        loadCfg();');
    lines.push('      }');
    lines.push('      if (m.type === "log") {');
    lines.push('        var raw = m.message || "";');
    lines.push('        var level = String(m.level || "info").toUpperCase();');
    lines.push('        var mState = null;');
    lines.push('        var rest = raw;');
    lines.push('        var mt = raw.match(/^\\[(.*?)\\]\\s*(.*)$/);');
    lines.push('        if (mt) { mState = mt[1]; rest = mt[2]; }');
    lines.push('        if (lastRunning && lastState) {');
    lines.push('          if (mState && mState !== lastState) return;');
    lines.push('        }');
    lines.push('        var line = "["+level+"] "+(mState?("["+mState+"] "):"")+rest;');
    lines.push('        logEl.textContent += (logEl.textContent ? "\\n" : "") + line;');
    lines.push('        logEl.scrollTop = logEl.scrollHeight;');
    lines.push('      }');
    lines.push('    } catch (err) { console.error(err); }');
    lines.push('  };');
    lines.push('  document.getElementById("start").addEventListener("click", function(){ post("/api/start").then(refresh); });');
    lines.push('  document.getElementById("stop").addEventListener("click", function(){ post("/api/stop").then(refresh); });');
    lines.push('  document.getElementById("exit").addEventListener("click", function(){ post("/api/exit"); });');
    lines.push('  Array.prototype.forEach.call(document.querySelectorAll("[data-test]"), function(btn){ btn.addEventListener("click", function(){ var name=btn.getAttribute("data-test"); fetch("/api/tests/run?name="+encodeURIComponent(name), { method:"POST" }).then(function(){ refresh(); }); }); });');
    lines.push('  function loadCfg(){ return fetch("/api/config").then(function(r){ return r.json(); }).then(function(cfg){ var cam=(cfg&&cfg.camera)?cfg.camera:cfg; document.getElementById("cfg_scrollPerStep").value=String((cam&&cam.scrollPerStep) || false); document.getElementById("cfg_stepPauseMultiplier").value=String((cam&&cam.stepPauseMultiplier) || 1); document.getElementById("cfg_tiltDyMax").value=String((cam&&cam.tiltDyMax) || 0); document.getElementById("cfg_scrollMin").value=String((cam&&cam.scrollMin) || 0); document.getElementById("cfg_scrollMax").value=String((cam&&cam.scrollMax) || 0); }); }');
    lines.push('  function saveCfg(){ var payload={ camera: { scrollPerStep: document.getElementById("cfg_scrollPerStep").value === "true", stepPauseMultiplier: Number(document.getElementById("cfg_stepPauseMultiplier").value), tiltDyMax: Number(document.getElementById("cfg_tiltDyMax").value), scrollMin: Number(document.getElementById("cfg_scrollMin").value), scrollMax: Number(document.getElementById("cfg_scrollMax").value) } }; return fetch("/api/config", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) }).then(function(){ refresh(); }); }');
    lines.push('  document.getElementById("cfg_load").addEventListener("click", function(){ loadCfg(); });');
    lines.push('  document.getElementById("cfg_save").addEventListener("click", function(){ saveCfg(); });');
    lines.push('  loadCfg();');
    lines.push('})();');
    lines.push('  // cache-busting handled by query string');
    return lines.join('\n');
  }

  // Inject script tag with cache-busting in the final HTML string
  const originalHtmlPage = htmlPage;
  function htmlPageWrapped() {
    const html = originalHtmlPage();
    // ensure script tag exists with version param; if not present, append at end of body
    if (html.includes('/app.js')) {
      return html.replace('/app.js', '/app.js?v=' + encodeURIComponent(buildTag));
    }
    return html.replace('</body>', `<script src="/app.js?v=${encodeURIComponent(buildTag)}"></script></body>`);
  }

  // Start HTTP server and keep the process alive (idempotent)
  try {
    if (!server.listening) {
      server.listen(port, '0.0.0.0', () => {
        try { emitLog('info', `Overlay server listening on http://localhost:${port}`); } catch {}
      });
    } else {
      try { emitLog('info', `Overlay server already listening on http://localhost:${port}`); } catch {}
    }
  } catch (e: any) {
    try { emitLog('error', `Failed to start overlay server: ${e?.message || String(e)}`); } catch {}
    // Do not rethrow to avoid crashing app if dev reload hits twice
  }

  return {
    server,
    logger: {
      info: (msg: any) => emitLog('info', msg),
      warn: (msg: any) => emitLog('warn', msg),
      error: (msg: any) => emitLog('error', msg),
    },
    notifyStatus: () => sendEvent({ type: 'status', ...controls.getStatus() }),
  } as const;
}

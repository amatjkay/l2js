import http, { IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { AppLogger } from '../core/Logger';

type Controls = {
  getStatus: () => { running: boolean; state?: string };
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  softExit: () => void;
};

export function startOverlayServer(port: number, logger: AppLogger, controls: Controls) {
  const clients: ServerResponse[] = [];

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
    try { sendEvent({ type: 'log', level, message: typeof message === 'string' ? message : String(message) }); } catch {}
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

    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage());
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

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, () => {
    logger.info(`Overlay server listening on http://localhost:${port}`);
  });

  function htmlPage() {
    return `<!doctype html><html><head><meta charset="utf-8"/><title>Overlay</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;background:#0b0f14;color:#e6eef8;margin:0;padding:16px}
.card{background:#111826;border:1px solid #1d2a3a;border-radius:8px;padding:16px;max-width:900px;margin:0 auto}
.btn{background:#1e90ff;border:none;color:#fff;padding:8px 12px;margin-right:8px;border-radius:6px;cursor:pointer}
.btn.stop{background:#ff4757}
.btn.exit{background:#ffa502}
.status{margin-top:12px;font-size:14px;color:#9fb3c8}
.log{margin-top:16px;background:#0a121d;border:1px solid #1d2a3a;border-radius:6px;padding:8px;height:300px;overflow:auto;font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap}
</style></head><body>
<div class="card">
<h2>Control Overlay</h2>
<div>
  <button class="btn" id="start">Start</button>
  <button class="btn stop" id="stop">Stop</button>
  <button class="btn exit" id="exit">Soft Exit</button>
</div>
<div class="status" id="status">—</div>
<div class="log" id="log"></div>
</div>
<script>
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
function setStatus(s){ statusEl.textContent = 'Status: ' + (s.running?'running':'idle') + (s.state?(' | state: '+s.state):''); }
async function call(path){ await fetch(path,{method:'POST'}); }
async function refresh(){ const s = await fetch('/api/status').then(r=>r.json()); setStatus(s); }
refresh();
const es = new EventSource('/api/events');
es.onmessage = (e)=>{ try{ const m = JSON.parse(e.data); if(m.type==='status'){ setStatus(m);} if(m.type==='log'){ const line='['+m.level.toUpperCase()+'] '+m.message; logEl.textContent += (logEl.textContent?'\n':'')+line; logEl.scrollTop=logEl.scrollHeight; } }catch{} };

document.getElementById('start').onclick = ()=> call('/api/start').then(refresh);
document.getElementById('stop').onclick = ()=> call('/api/stop').then(refresh);
document.getElementById('exit').onclick = ()=> call('/api/exit');
</script>
</body></html>`;
  }

  return server;
}

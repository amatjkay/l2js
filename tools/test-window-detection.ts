import { execFile } from 'child_process';
import { createLogger } from '../src/core/Logger';
import { loadSettings } from '../src/core/Config';

const log = createLogger();

type ActiveInfo = { found: boolean; hwnd?: string; title?: string; className?: string; processName?: string };
type WinInfo = { hwnd: string; title: string; className: string; processName: string };
type FindCriteria = { titleContains?: string; classEquals?: string; processNameContains?: string; hwndEquals?: number };

function runPs(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/find-window.ps1', ...args];
    execFile('powershell', psArgs, { cwd: process.cwd(), windowsHide: true }, (_err, stdout) => resolve(String(stdout || '')));
  });
}

async function psEnum(): Promise<WinInfo[]> {
  const out = await runPs(['-Mode', 'enum']);
  try { return JSON.parse(out.trim()); } catch { return []; }
}
async function psActive(): Promise<ActiveInfo | null> {
  const out = await runPs(['-Mode', 'active']);
  try { return JSON.parse(out.trim()); } catch { return null; }
}
async function psFind(c: FindCriteria): Promise<ActiveInfo | null> {
  const args: string[] = ['-Mode', 'find'];
  if (c.titleContains) args.push('-TitleContains', c.titleContains);
  if (c.classEquals) args.push('-ClassEquals', c.classEquals);
  if (c.processNameContains) args.push('-ProcessNameContains', c.processNameContains);
  if (c.hwndEquals && c.hwndEquals > 0) args.push('-HwndHex', '0x' + (c.hwndEquals >>> 0).toString(16).padStart(8, '0'));
  const out = await runPs(args);
  try { return JSON.parse(out.trim()); } catch { return null; }
}

(async () => {
  log.info('[Detect] Enumerating visible top-level windows...');
  const list = await psEnum();
  for (const w of list) {
    log.info(`[Win] hwnd=${w.hwnd} title="${w.title}" class=${w.className} file=${w.processName}`);
  }

  const active = await psActive();
  if (active?.found) {
    log.info(`[Active] hwnd=${active.hwnd} title="${active.title}" class=${active.className} file=${active.processName}`);
  } else {
    log.info('[Active] null');
  }

  const settings = loadSettings();
  const fc = (settings as any).actions?.focusCheck ?? {};
  const criteria: FindCriteria = { ...(fc.criteria || {}) };
  if (!criteria.titleContains) criteria.titleContains = 'LU4';
  if (!criteria.classEquals) criteria.classEquals = 'UnrealWindow';
  if (!criteria.processNameContains) criteria.processNameContains = 'lu4';

  const res = await psFind(criteria);
  if (res?.found) {
    const reasons: string[] = [];
    if ((res.title || '').includes(criteria.titleContains!)) reasons.push('title');
    if ((res.className || '') === criteria.classEquals) reasons.push('class');
    if ((res.processName || '').toLowerCase().includes((criteria.processNameContains || '').toLowerCase())) reasons.push('process');
    log.info(`Game window found (reasons=${reasons.join('+')}): hwnd=${res.hwnd} title="${res.title}" class=${res.className} file=${res.processName}`);
    process.exit(0);
  } else {
    log.warn('Game window not found');
    process.exit(1);
  }
})();

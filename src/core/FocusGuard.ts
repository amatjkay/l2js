import { execFile } from 'child_process';
import { loadSettings } from './Config';
import { createLogger } from './Logger';

const log = createLogger();
let lastKnownHwnd: string | number | null = null;

// Универсальные критерии поиска окна (ИЛИ)
const DEFAULT_CRITERIA = {
  titleContains: 'LU4',
  classEquals: 'UnrealWindow',
  processNameContains: 'lu4',
  hwndEquals: 0x00040686,
};

export async function ensureGameActive(): Promise<boolean> {
  const settings = loadSettings();
  const focusCheck = ((settings as any).actions?.focusCheck ?? {}) as { retryAttempts?: number; intervalMs?: number; autoActivate?: boolean; activateTitle?: string; criteria?: any };
  const attempts = Math.max(1, Number(focusCheck.retryAttempts ?? 10));
  const waitMs = Math.max(50, Number(focusCheck.intervalMs ?? 500));
  const criteria: FindCriteria = {
    ...(focusCheck.criteria ?? {}),
  } as FindCriteria;
  // подставляем дефолты, если не заданы в settings
  if (!criteria.titleContains) criteria.titleContains = DEFAULT_CRITERIA.titleContains;
  if (!criteria.classEquals) criteria.classEquals = DEFAULT_CRITERIA.classEquals;
  if (!criteria.processNameContains) criteria.processNameContains = DEFAULT_CRITERIA.processNameContains;
  if (!criteria.hwndEquals) criteria.hwndEquals = DEFAULT_CRITERIA.hwndEquals;

  for (let i = 0; i < attempts; i++) {
    const active = await psActive();
    if (active?.found) {
      const byTitle = (active.title || '').includes(criteria.titleContains);
      const byClass = (active.className || '') === criteria.classEquals;
      const byProc = (active.processName || '').toLowerCase().includes(criteria.processNameContains);
      const byHwnd = active.hwnd ? (parseHwnd(active.hwnd) === criteria.hwndEquals) : false;
      if (byTitle || byClass || byProc || byHwnd) {
        const reasons: string[] = [];
        if (byTitle) reasons.push('title');
        if (byClass) reasons.push('class');
        if (byProc) reasons.push('process');
        if (byHwnd) reasons.push('hwnd');
        log.info(`Game window active (reasons=${reasons.join('+')}): hwnd=${active.hwnd}, title="${active.title}", class=${active.className}, proc=${active.processName}`);
        return true;
      }
    }
    // автоактивация по найденному окну среди всех
    if (focusCheck.autoActivate) {
      // 1) Попытка AppActivate по точному заголовку, если задан
      if (focusCheck.activateTitle && focusCheck.activateTitle.trim().length > 0) {
        const okTitle = await appActivateByTitle(focusCheck.activateTitle);
        log.debug(`AppActivate("${focusCheck.activateTitle}") => ${okTitle}`);
        if (okTitle) {
          const recheck = await psActive();
          if (recheck?.found) {
            const okNow = (recheck.title || '') === focusCheck.activateTitle;
            log.debug(`Recheck after AppActivate: titleNow="${recheck?.title}" matchExact=${okNow}`);
            if (okNow) return true;
          }
        }
      }
      // 2) Поиск и SetForegroundWindow через PowerShell-бэкенд
      const found = await psFind(criteria);
      if (found?.found && found.hwnd) {
        lastKnownHwnd = found.hwnd;
        const ok = await psActivate(found.hwnd);
        log.debug(`Auto-activate try: hwnd=${found.hwnd} result=${ok}`);
        if (ok) return true;
      }
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  const active = await psActive();
  log.warn(`Game window not found. Active: ${active?.found ? `{title="${active.title}", class=${active.className}, file=${active.processName || ''}, hwnd=${active.hwnd}}` : 'null'}`);
  return false;
}

export async function guard<T>(actionName: string, fn: () => Promise<T>): Promise<T | null> {
  const ok = await ensureGameActive();
  if (!ok) {
    // Быстрый JIT-рекавери: попробуем ре-активировать последнее найденное окно
    if (lastKnownHwnd) {
      const activated = await psActivate(lastKnownHwnd);
      log.debug(`JIT re-activate before action "${actionName}": hwnd=${lastKnownHwnd} -> ${activated}`);
      if (activated) {
        // небольшой ре-чек активного окна
        await new Promise((r) => setTimeout(r, 100));
        const again = await ensureGameActive();
        if (again) {
          try {
            return await fn();
          } catch (e) {
            log.error(`Action "${actionName}" failed after JIT activation: ${(e as Error).message}`);
            throw e;
          }
        }
      }
    }
    log.warn(`Skip action "${actionName}" because game window is not active`);
    return null;
  }
  try {
    return await fn();
  } catch (e) {
    log.error(`Action "${actionName}" failed: ${(e as Error).message}`);
    throw e;
  }
}

async function appActivateByTitle(title: string): Promise<boolean> {
  const ps = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Add-Type -AssemblyName Microsoft.VisualBasic; $t = '${title.replace(/'/g, "''")}'; $r = [Microsoft.VisualBasic.Interaction]::AppActivate($t); if ($r) { 'True' } else { 'False' }`
  ];
  return new Promise<boolean>((resolve) => {
    execFile('powershell', ps, { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      const out = String(stdout || '').trim().toLowerCase();
      resolve(out.includes('true'));
    });
  });
}

async function appActivateByHwnd(hwnd: string | number): Promise<boolean> {
  const hwndNum = parseHwnd(hwnd);
  const ps = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Add-Type @"\nusing System; using System.Runtime.InteropServices;\npublic static class Fg { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); }\n"@; $h=[IntPtr]${hwndNum}; if ([Fg]::SetForegroundWindow($h)) { 'True' } else { 'False' }`
  ];
  return new Promise<boolean>((resolve) => {
    execFile('powershell', ps, { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      const out = String(stdout || '').trim().toLowerCase();
      resolve(out.includes('true'));
    });
  });
}

function parseHwnd(h: string | number): number {
  if (typeof h === 'number') return h;
  const s = String(h);
  if (/^0x/i.test(s)) return parseInt(s.replace(/^0x/i, ''), 16);
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

// --- PowerShell backend wrappers ---
type ActiveInfo = { found: boolean; hwnd?: string; title?: string; className?: string; processName?: string };
type FindCriteria = { titleContains?: string; classEquals?: string; processNameContains?: string; hwndEquals?: number };

function runPsFindWindow(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/find-window.ps1', ...args];
    execFile('powershell', psArgs, { cwd: process.cwd(), windowsHide: true }, (_err, stdout) => {
      resolve(String(stdout || ''));
    });
  });
}

async function psActive(): Promise<ActiveInfo | null> {
  try {
    const out = await runPsFindWindow(['-Mode', 'active']);
    const j = JSON.parse(out.trim());
    return j as ActiveInfo;
  } catch {
    return null;
  }
}

async function psFind(criteria: FindCriteria): Promise<ActiveInfo | null> {
  const args: string[] = ['-Mode', 'find'];
  if (criteria.titleContains) args.push('-TitleContains', criteria.titleContains);
  if (criteria.classEquals) args.push('-ClassEquals', criteria.classEquals);
  if (criteria.processNameContains) args.push('-ProcessNameContains', criteria.processNameContains);
  if (criteria.hwndEquals && criteria.hwndEquals > 0) args.push('-HwndHex', '0x' + (criteria.hwndEquals >>> 0).toString(16).padStart(8, '0'));
  try {
    const out = await runPsFindWindow(args);
    const j = JSON.parse(out.trim());
    return j as ActiveInfo;
  } catch {
    return null;
  }
}

async function psActivate(hwnd: string | number): Promise<boolean> {
  const h = typeof hwnd === 'string' ? hwnd : '0x' + (hwnd >>> 0).toString(16).padStart(8, '0');
  const out = await runPsFindWindow(['-Mode', 'activate', '-HwndHex', h]);
  try {
    const j = JSON.parse(out.trim());
    return !!j.ok;
  } catch {
    // В редких случаях логгер или вывод может содержать префиксы; находим "ok":true как подстроку
    return /"ok"\s*:\s*true/i.test(out);
  }
}

import { spawn } from 'child_process';
import { createLogger } from './Logger';
import { ensureGameActive } from './FocusGuard';

const Logger = createLogger();

export interface ActionsConfig {
  enableActions?: boolean;
  moveDelayMs?: number;
  clickDelayMs?: number;
  mode?: 'powershell' | 'arduino';
  serial?: {
    port?: string;
    baudRate?: number;
    writeTimeoutMs?: number;
    readTimeoutMs?: number;
    retries?: number;
  };
}

// Helpers for cursor and screen bounds via PowerShell
async function getCursorPos(): Promise<{ x: number; y: number }> {
  const ps = `Add-Type @"\nusing System;using System.Runtime.InteropServices;public class U{[DllImport("user32.dll")]public static extern bool GetCursorPos(out POINT p);public struct POINT{public int X;public int Y;}}\n"@;$p=New-Object U+POINT;[U]::GetCursorPos([ref]$p)|Out-Null;Write-Output "${'$'}($p.X),${'$'}($p.Y)"`;
  return new Promise((resolve, reject) => {
    const psProc = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', ps], { windowsHide: true });
    let out=''; let err='';
    psProc.stdout.on('data', d=> out += d.toString());
    psProc.stderr.on('data', d=> err += d.toString());
    psProc.on('error', reject);
    psProc.on('close', code => {
      if (code===0) {
        const [x,y] = out.trim().split(',').map(n=>parseInt(n,10));
        resolve({ x: x||0, y: y||0 });
      } else reject(new Error(err||`pwsh exited ${code}`));
    });
  });
}

async function getPrimaryScreenBounds(): Promise<{ x: number; y: number; width: number; height: number }> {
  const ps = `Add-Type -AssemblyName System.Windows.Forms;[void][System.Windows.Forms.Application]::EnableVisualStyles();${'$'}b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;Write-Output "${'$'}($b.X),${'$'}($b.Y),${'$'}($b.Width),${'$'}($b.Height)"`;
  return new Promise((resolve, reject) => {
    const psProc = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', ps], { windowsHide: true });
    let out=''; let err='';
    psProc.stdout.on('data', d=> out += d.toString());
    psProc.stderr.on('data', d=> err += d.toString());
    psProc.on('error', reject);
    psProc.on('close', code => {
      if (code===0) {
        const [x,y,w,h] = out.trim().split(',').map(n=>parseInt(n,10));
        resolve({ x: x||0, y: y||0, width: w||0, height: h||0 });
      } else reject(new Error(err||`pwsh exited ${code}`));
    });
  });
}

function runPwsh(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      windowsHide: true,
    });
    ps.on('error', reject);
    ps.stderr.on('data', (d) => Logger.debug(`[pwsh stderr] ${d.toString()}`));
    ps.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PowerShell exited with code ${code}`));
    });
  });
}

let _serialInitialized = false;

// PowerShell: write single line to SerialPort
function runPwshSerialWrite(opts: Required<NonNullable<ActionsConfig['serial']>>, line: string): Promise<void> {
  const port = opts.port;
  const baud = opts.baudRate ?? 115200;
  const timeout = opts.writeTimeoutMs ?? 300;
  const ps = `
Add-Type -AssemblyName System.IO.Ports;
$sp = New-Object System.IO.Ports.SerialPort '${port}', ${baud}, 'None', 8, 'One';
$sp.NewLine = [Environment]::NewLine;
$sp.WriteTimeout = ${timeout};
try { $sp.Open(); ${_serialInitialized ? '' : 'Start-Sleep -Milliseconds 2500;'} $sp.WriteLine('${line}'); Start-Sleep -Milliseconds 20 } finally { if ($sp -and $sp.IsOpen) { $sp.Close() } }
`;
  // Guard: send only when game window is active
  return ensureGameActive().then((ok) => {
    if (!ok) {
      Logger.warn(`Skip serial "${line}" because game window is not active`);
      return;
    }
    if (!_serialInitialized) { Logger.info('serial: cold-open 2.5s'); }
    _serialInitialized = true;
    return runPwsh(ps);
  });
}

// PowerShell: write line and read one response line
function runPwshSerialQuery(opts: Required<NonNullable<ActionsConfig['serial']>>, line: string, readTimeoutMs = 800): Promise<string> {
  const port = opts.port;
  const baud = opts.baudRate ?? 115200;
  const timeout = opts.writeTimeoutMs ?? 300;
  const ps = `
Add-Type -AssemblyName System.IO.Ports;
$sp = New-Object System.IO.Ports.SerialPort '${port}', ${baud}, 'None', 8, 'One';
$sp.NewLine = [Environment]::NewLine;
$sp.WriteTimeout = ${timeout};
$sp.ReadTimeout = ${readTimeoutMs};
try {
  $sp.Open(); ${_serialInitialized ? '' : 'Start-Sleep -Milliseconds 2500;'}
  $sp.WriteLine('${line}'); Start-Sleep -Milliseconds 30;
  $resp = ''
  try { $resp = $sp.ReadLine() } catch {}
  if (-not $resp) { try { $resp = $sp.ReadExisting() } catch {} }
  Write-Output $resp
} finally { if ($sp -and $sp.IsOpen) { $sp.Close() } }
`;
  return new Promise((resolve, reject) => {
    ensureGameActive().then((ok) => {
      if (!ok) { Logger.warn(`Skip serial query "${line}" because game window is not active`); return resolve(''); }
      if (!_serialInitialized) { Logger.info('serial: cold-open 2.5s'); }
      _serialInitialized = true;
      const psProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
      let out = '';
      let err = '';
      psProc.stdout.on('data', (d) => (out += d.toString()));
      psProc.stderr.on('data', (d) => (err += d.toString()));
      psProc.on('error', reject);
      psProc.on('close', (code) => {
        if (code === 0) resolve(out.trim()); else reject(new Error(err || `pwsh exited ${code}`));
      });
    });
  });
}

// PowerShell helpers using user32.dll
const psSetCursorPos = (x: number, y: number) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class User32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@;
[void][User32]::SetCursorPos(${Math.round(x)}, ${Math.round(y)});
`;

const psMouseClick = `
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;public static class Mouse{
  [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  const uint MOUSEEVENTF_LEFTDOWN=0x02; const uint MOUSEEVENTF_LEFTUP=0x04;
  public static void LeftClick(){ mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,UIntPtr.Zero); mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,UIntPtr.Zero);} }
"@;
[Mouse]::LeftClick();
`;

export class Actions {
  constructor(private cfg: ActionsConfig) {}

  async moveMouseSmooth(x: number, y: number): Promise<void> {
    if (!this.cfg.enableActions) { Logger.info(`[dry-run] moveMouseSmooth -> (${x},${y})`); return; }
    // Clamp to primary screen bounds to prevent cursor from flying off
    const b = await getPrimaryScreenBounds();
    const clampedX = Math.max(b.x, Math.min(b.x + b.width - 1, Math.round(x)));
    const clampedY = Math.max(b.y, Math.min(b.y + b.height - 1, Math.round(y)));
    // Safety: ensure game window is active
    const ok = await ensureGameActive();
    if (!ok) { Logger.warn('moveMouseSmooth: game window not active, skipping'); return; }
    await runPwsh(psSetCursorPos(clampedX, clampedY));
    if (this.cfg.moveDelayMs) await new Promise(r => setTimeout(r, this.cfg.moveDelayMs));
  }

  async mouseClick(): Promise<void> {
    if (!this.cfg.enableActions) { Logger.info('[dry-run] mouseClick'); return; }
    if (this.cfg.mode === 'arduino') {
      const serial = this.cfg.serial;
      if (!serial?.port) {
        Logger.error('Actions(mouseClick): actions.mode=arduino, но не задан actions.serial.port');
        return;
      }
      const opts = {
        port: serial.port,
        baudRate: serial.baudRate ?? 115200,
        writeTimeoutMs: serial.writeTimeoutMs ?? 300,
        retries: serial.retries ?? 1,
      } as Required<NonNullable<ActionsConfig['serial']>>;
      let lastErr: unknown = null;
      for (let i = 0; i < (opts.retries || 1); i++) {
        try { await runPwshSerialWrite(opts, 'LCLICK'); lastErr = null; break; }
        catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 50)); }
      }
      if (lastErr) {
        Logger.error(`Actions(mouseClick): не удалось отправить LCLICK на ${opts.port}: ${(lastErr as Error).message}`);
      }
    } else {
      await runPwsh(psMouseClick);
    }
    if (this.cfg.clickDelayMs) await new Promise(r => setTimeout(r, this.cfg.clickDelayMs));
  }

  /** Alias for mouseClick() */
  async click(): Promise<void> { return this.mouseClick(); }

  /** Arduino: rotate camera by dx,dy (relative) */
  async cameraRotate(dx: number, dy: number): Promise<void> {
    if (!this.cfg.enableActions) { Logger.info(`[dry-run] CAMERA ${dx} ${dy}`); return; }
    if (this.cfg.mode !== 'arduino') { Logger.info('[noop] cameraRotate: not arduino mode'); return; }
    const serial = this.cfg.serial; if (!serial?.port) { Logger.error('cameraRotate: no serial.port'); return; }
    const opts = { port: serial.port, baudRate: serial.baudRate ?? 115200, writeTimeoutMs: serial.writeTimeoutMs ?? 300, readTimeoutMs: serial.readTimeoutMs ?? 800, retries: serial.retries ?? 1 } as Required<NonNullable<ActionsConfig['serial']>>;
    let lastErr: unknown = null;
    Logger.info(`cameraRotate: request dx=${Math.round(dx)} dy=${Math.round(dy)} port=${opts.port}`);
    for (let i = 1; i <= (opts.retries || 1); i++) {
      try { await runPwshSerialWrite(opts, `CAMERA ${Math.round(dx)} ${Math.round(dy)}`); lastErr = null; break; }
      catch (e) { lastErr = e; Logger.warn(`serial write failed (attempt ${i}/${opts.retries}): ${(e as Error).message}`); await new Promise(r=>setTimeout(r,50)); }
    }
    if (lastErr) Logger.error(`cameraRotate: failed after ${opts.retries} attempts`);
    else Logger.info('cameraRotate: sent successfully');
  }

  /** Arduino: large relative mouse move */
  async bigMove(dx: number, dy: number): Promise<void> {
    if (!this.cfg.enableActions) { Logger.info(`[dry-run] BIGMOVE ${dx} ${dy}`); return; }
    if (this.cfg.mode !== 'arduino') {
      // Fallback: emulate relative move using absolute SetCursorPos from current cursor
      const cur = await getCursorPos();
      const tx = cur.x + Math.round(dx);
      const ty = cur.y + Math.round(dy);
      Logger.info(`bigMove(fallback): cur=(${cur.x},${cur.y}) -> abs=(${tx},${ty})`);
      await this.moveMouseSmooth(tx, ty);
      return;
    }
    const serial = this.cfg.serial; if (!serial?.port) { Logger.error('bigMove: no serial.port'); return; }
    const opts = { port: serial.port, baudRate: serial.baudRate ?? 115200, writeTimeoutMs: serial.writeTimeoutMs ?? 300, readTimeoutMs: serial.readTimeoutMs ?? 800, retries: serial.retries ?? 1 } as Required<NonNullable<ActionsConfig['serial']>>;
    let lastErr: unknown = null;
    for (let i = 1; i <= (opts.retries || 1); i++) {
      try { await runPwshSerialWrite(opts, `BIGMOVE ${Math.round(dx)} ${Math.round(dy)}`); lastErr = null; break; }
      catch (e) { lastErr = e; Logger.warn(`serial write failed (attempt ${i}/${opts.retries}): ${(e as Error).message}`); await new Promise(r=>setTimeout(r,50)); }
    }
    if (lastErr) Logger.error(`bigMove: failed after ${opts.retries} attempts`);
  }

  /** Arduino: scroll */
  async scroll(amount: number): Promise<void> {
    if (!this.cfg.enableActions) { Logger.info(`[dry-run] SCROLL ${amount}`); return; }
    if (this.cfg.mode !== 'arduino') { Logger.info('[noop] scroll: not arduino mode'); return; }
    const serial = this.cfg.serial; if (!serial?.port) { Logger.error('scroll: no serial.port'); return; }
    const opts = { port: serial.port, baudRate: serial.baudRate ?? 115200, writeTimeoutMs: serial.writeTimeoutMs ?? 300, readTimeoutMs: serial.readTimeoutMs ?? 800, retries: serial.retries ?? 1 } as Required<NonNullable<ActionsConfig['serial']>>;
    let lastErr: unknown = null;
    for (let i = 1; i <= (opts.retries || 1); i++) {
      try { await runPwshSerialWrite(opts, `SCROLL ${Math.round(amount)}`); lastErr = null; break; }
      catch (e) { lastErr = e; Logger.warn(`serial write failed (attempt ${i}/${opts.retries}): ${(e as Error).message}`); await new Promise(r=>setTimeout(r,50)); }
    }
    if (lastErr) Logger.error(`scroll: failed after ${opts.retries} attempts`);
  }

  /** Arduino: press key (F1..F12, ESC, ENTER, SPACE, TAB) */
  async pressKey(name: string): Promise<void> {
    if (!this.cfg.enableActions) { Logger.info(`[dry-run] KEY ${name}`); return; }
    if (this.cfg.mode !== 'arduino') { Logger.info('[noop] pressKey: not arduino mode'); return; }
    const serial = this.cfg.serial; if (!serial?.port) { Logger.error('pressKey: no serial.port'); return; }
    const opts = { port: serial.port, baudRate: serial.baudRate ?? 115200, writeTimeoutMs: serial.writeTimeoutMs ?? 300, readTimeoutMs: serial.readTimeoutMs ?? 800, retries: serial.retries ?? 1 } as Required<NonNullable<ActionsConfig['serial']>>;
    let lastErr: unknown = null;
    for (let i = 1; i <= (opts.retries || 1); i++) {
      try { await runPwshSerialWrite(opts, name.toUpperCase()); lastErr = null; break; }
      catch (e) { lastErr = e; Logger.warn(`serial write failed (attempt ${i}/${opts.retries}): ${(e as Error).message}`); await new Promise(r=>setTimeout(r,50)); }
    }
    if (lastErr) Logger.error(`pressKey: failed after ${opts.retries} attempts`);
  }

  async ping(): Promise<string> {
    const serial = this.cfg.serial; if (!serial?.port) { return ''; }
    const opts = { port: serial.port, baudRate: serial.baudRate ?? 115200, writeTimeoutMs: serial.writeTimeoutMs ?? 300, readTimeoutMs: serial.readTimeoutMs ?? 800, retries: serial.retries ?? 1 } as Required<NonNullable<ActionsConfig['serial']>>;
    let lastErr: unknown = null; let resp = '';
    for (let i = 1; i <= (opts.retries || 1); i++) {
      try { resp = await runPwshSerialQuery(opts, 'PING', opts.readTimeoutMs); lastErr = null; break; }
      catch (e) { lastErr = e; Logger.warn(`serial read failed (attempt ${i}/${opts.retries}): ${(e as Error).message}`); await new Promise(r=>setTimeout(r,50)); }
    }
    if (lastErr) Logger.error(`ping: failed after ${opts.retries} attempts`);
    return resp;
  }

  async status(): Promise<string> {
    const serial = this.cfg.serial; if (!serial?.port) { return ''; }
    const opts = { port: serial.port, baudRate: serial.baudRate ?? 115200, writeTimeoutMs: serial.writeTimeoutMs ?? 300, readTimeoutMs: serial.readTimeoutMs ?? 800, retries: serial.retries ?? 1 } as Required<NonNullable<ActionsConfig['serial']>>;
    let lastErr: unknown = null; let resp = '';
    for (let i = 1; i <= (opts.retries || 1); i++) {
      try { resp = await runPwshSerialQuery(opts, 'STATUS', opts.readTimeoutMs); lastErr = null; break; }
      catch (e) { lastErr = e; Logger.warn(`serial read failed (attempt ${i}/${opts.retries}): ${(e as Error).message}`); await new Promise(r=>setTimeout(r,50)); }
    }
    if (lastErr) Logger.error(`status: failed after ${opts.retries} attempts`);
    return resp;
  }

  async setMGain(n: number): Promise<void> {
    const serial = this.cfg.serial; if (!serial?.port) { return; }
    const opts = { port: serial.port, baudRate: serial.baudRate ?? 115200, writeTimeoutMs: serial.writeTimeoutMs ?? 300, retries: serial.retries ?? 1 } as Required<NonNullable<ActionsConfig['serial']>>;
    await runPwshSerialWrite(opts, `MGAIN ${Math.round(n)}`);
  }

  async setMRepeat(n: number): Promise<void> {
    const serial = this.cfg.serial; if (!serial?.port) { return; }
    const opts = { port: serial.port, baudRate: serial.baudRate ?? 115200, writeTimeoutMs: serial.writeTimeoutMs ?? 300, retries: serial.retries ?? 1 } as Required<NonNullable<ActionsConfig['serial']>>;
    await runPwshSerialWrite(opts, `MREPEAT ${Math.round(n)}`);
  }

  async setSmoothness(n: number): Promise<void> {
    const serial = this.cfg.serial; if (!serial?.port) { return; }
    const opts = { port: serial.port, baudRate: serial.baudRate ?? 115200, writeTimeoutMs: serial.writeTimeoutMs ?? 300, retries: serial.retries ?? 1 } as Required<NonNullable<ActionsConfig['serial']>>;
    await runPwshSerialWrite(opts, `SMOOTHNESS ${Math.round(n)}`);
  }
}

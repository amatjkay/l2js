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
    retries?: number;
  };
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
try { $sp.Open(); $sp.WriteLine('${line}'); Start-Sleep -Milliseconds 20 } finally { if ($sp -and $sp.IsOpen) { $sp.Close() } }
`;
  // Guard: send only when game window is active
  return ensureGameActive().then((ok) => {
    if (!ok) {
      Logger.warn('Skip serial "%s" because game window is not active', line);
      return;
    }
    return runPwsh(ps);
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
    await runPwsh(psSetCursorPos(x, y));
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
}

import { spawn } from 'child_process';
import { createLogger } from './Logger';

const Logger = createLogger();

export interface ActionsConfig {
  enableActions?: boolean;
  moveDelayMs?: number;
  clickDelayMs?: number;
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
    await runPwsh(psMouseClick);
    if (this.cfg.clickDelayMs) await new Promise(r => setTimeout(r, this.cfg.clickDelayMs));
  }
}

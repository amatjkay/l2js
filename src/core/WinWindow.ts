import { spawn } from 'child_process';
import os from 'os';

export interface GameWindowMatch {
  titleEquals?: string;
  titleRegex?: string;
  processName?: string; // e.g. 'lu4.bin'
}

export interface ActiveWindowInfo {
  title: string;
  processName: string | null;
  pid: number | null;
}

/**
 * Get active window info on Windows using PowerShell (no native addons).
 */
export async function getActiveWindowInfo(): Promise<ActiveWindowInfo> {
  if (os.platform() !== 'win32') {
    return { title: '', processName: null, pid: null };
  }
  // PowerShell script to get foreground window title and process name
  const ps = `
  Add-Type @"
  using System; using System.Runtime.InteropServices;
  public class FWin { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
  }
  "@;
  $h = [FWin]::GetForegroundWindow();
  $pid = 0; [FWin]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null;
  $sb = New-Object System.Text.StringBuilder 512; [FWin]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null;
  $title = $sb.ToString();
  $p = $null; try { $p = Get-Process -Id $pid -ErrorAction Stop } catch {}
  $name = if ($p) { $p.ProcessName + (if ($p.Path) { '' } else { '' }) } else { '' };
  # Emit as: <pid>|<name>|<title>
  "$pid|$($p.ProcessName)|$title"
  `;

  const result = await runPwsh(ps);
  const line = (result || '').trim();
  const [pidStr, name, ...titleParts] = line.split('|');
  const title = titleParts.join('|');
  const pid = pidStr && /^\d+$/.test(pidStr) ? parseInt(pidStr, 10) : null;
  return { title, processName: name || null, pid };
}

export function matchGameWindow(info: ActiveWindowInfo, match: GameWindowMatch): boolean {
  const title = info.title || '';
  const proc = (info.processName || '').toLowerCase();
  if (match.processName && proc !== match.processName.toLowerCase()) return false;
  if (match.titleEquals && title !== match.titleEquals) return false;
  if (match.titleRegex) {
    try {
      const rx = new RegExp(match.titleRegex);
      if (!rx.test(title)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function isGameActive(match: GameWindowMatch): Promise<boolean> {
  const info = await getActiveWindowInfo();
  return matchGameWindow(info, match);
}

function runPwsh(script: string): Promise<string> {
  return new Promise((resolve) => {
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d.toString()));
    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('close', () => resolve(out || err));
    ps.stdin.write(script);
    ps.stdin.end();
  });
}

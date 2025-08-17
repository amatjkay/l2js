import { spawn } from 'child_process';
import os from 'os';

export interface GameWindowMatch {
  titleEquals?: string;
  titleRegex?: string;
  processName?: string; // e.g. 'lu4' (ProcessName without extension)
  processFileExact?: string; // e.g. 'lu4.bin'
  classNameEquals?: string; // e.g. 'UnrealWindow'
  classNameRegex?: string;
}

export interface ActiveWindowInfo {
  title: string;
  processName: string | null;
  pid: number | null;
  processFile?: string | null; // file name from process Path (if available)
  className?: string | null;
  hwnd?: number | null;
}

/**
 * Get active window info on Windows using PowerShell (no native addons).
 */
export async function getActiveWindowInfo(): Promise<ActiveWindowInfo> {
  if (os.platform() !== 'win32') {
    return { title: '', processName: null, pid: null } as ActiveWindowInfo;
  }
  // PowerShell script to get foreground window title, process name and file path
  const ps = `
  Add-Type @"
  using System; using System.Runtime.InteropServices;
  public class FWin { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
    [DllImport("user32.dll", SetLastError=true)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
  }
  "@;
  $h = [FWin]::GetForegroundWindow();
  $pid = 0; [FWin]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null;
  $sb = New-Object System.Text.StringBuilder 512; [FWin]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null;
  $title = $sb.ToString();
  $csb = New-Object System.Text.StringBuilder 256; [FWin]::GetClassName($h, $csb, $csb.Capacity) | Out-Null;
  $cls = $csb.ToString();
  $p = $null; try { $p = Get-Process -Id $pid -ErrorAction Stop } catch {}
  $name = if ($p) { $p.ProcessName } else { '' };
  $path = '';
  try { if ($p -and $p.Path) { $path = $p.Path } } catch {}
  if (-not $path) { try { $path = $p.MainModule.FileName } catch {} }
  $file = '';
  if ($path) { try { $file = [System.IO.Path]::GetFileName($path) } catch {} }
  # Emit as: <pid>|<name>|<file>|<class>|<hwnd>|<title>
  "$pid|$name|$file|$cls|$([Int64]$h)|$title"
  `;

  const result = await runPwsh(ps);
  const line = (result || '').trim();
  const [pidStr, name, file, cls, hwndStr, ...titleParts] = line.split('|');
  const title = titleParts.join('|');
  const pid = pidStr && /^\d+$/.test(pidStr) ? parseInt(pidStr, 10) : null;
  const hwnd = hwndStr && /^-?\d+$/.test(hwndStr) ? parseInt(hwndStr, 10) : null;
  return { title, processName: name || null, pid, processFile: file || null, className: cls || null, hwnd };
}

export function matchGameWindow(info: ActiveWindowInfo, match: GameWindowMatch): boolean {
  const title = info.title || '';
  const proc = (info.processName || '').toLowerCase();
  if (match.processName && proc !== match.processName.toLowerCase()) return false;
  if (match.processFileExact) {
    const file = (info.processFile || '').toLowerCase();
    if (file !== match.processFileExact.toLowerCase()) return false;
  }
  if (match.classNameEquals && (info.className || '') !== match.classNameEquals) return false;
  if (match.classNameRegex) {
    try { if (!(new RegExp(match.classNameRegex)).test(info.className || '')) return false; } catch {}
  }
  if (match.titleEquals && title !== match.titleEquals) return false;
  if (match.titleRegex) {
    try {
      if (!(new RegExp(match.titleRegex)).test(title)) return false;
    } catch {}
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

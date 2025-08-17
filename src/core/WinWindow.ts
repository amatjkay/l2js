import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';

export interface GameWindowMatch {
  titleEquals?: string;
  titleRegex?: string;
  processName?: string; // e.g. 'lu4' (ProcessName without extension)
  processFileExact?: string; // e.g. 'lu4.bin'
  classNameEquals?: string; // e.g. 'UnrealWindow'
  classNameRegex?: string;
  hwnd?: string | number; // e.g. '0x00040686' or numeric
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
  $procId = 0; [FWin]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null;
  $sb = New-Object System.Text.StringBuilder 512; [FWin]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null;
  $title = $sb.ToString();
  $csb = New-Object System.Text.StringBuilder 256; [FWin]::GetClassName($h, $csb, $csb.Capacity) | Out-Null;
  $cls = $csb.ToString();
  $p = $null; try { $p = Get-Process -Id $procId -ErrorAction Stop } catch {}
  $name = if ($p) { $p.ProcessName } else { '' };
  $path = '';
  try { if ($p -and $p.Path) { $path = $p.Path } } catch {}
  if (-not $path) { try { $path = $p.MainModule.FileName } catch {} }
  # Fallback via CIM/WMI if path is still empty
  if (-not $path -and $procId -ne 0) {
    try {
      $c = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction Stop;
      if ($c -and $c.ExecutablePath) { $path = $c.ExecutablePath }
    } catch {}
  }
  $file = '';
  if ($path) { try { $file = [System.IO.Path]::GetFileName($path) } catch {} }
  # Emit as: <pid>|<name>|<file>|<class>|<hwnd>|<title>
  "$procId|$name|$file|$cls|$([Int64]$h)|$title"
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
  return matchGameWindowVerbose(info, match).ok;
}

export async function isGameActive(match: GameWindowMatch): Promise<boolean> {
  const info = await getActiveWindowInfo();
  return matchGameWindow(info, match);
}

export function matchGameWindowVerbose(info: ActiveWindowInfo, match: GameWindowMatch): { ok: boolean; reason: string } {
  const title = info.title || '';
  const proc = (info.processName || '').toLowerCase();
  // hwnd compare (hex string or number). Accept match if equal.
  if (typeof match.hwnd !== 'undefined') {
    const want = typeof match.hwnd === 'string' ? parseInt((match.hwnd as string).replace(/^0x/i, ''), 16) : Number(match.hwnd);
    if (info.hwnd != null && info.hwnd === want) {
      return { ok: true, reason: `hwnd==${formatHwnd(want)}` };
    }
  }
  if (match.titleEquals && title === match.titleEquals) {
    return { ok: true, reason: `titleEquals("${match.titleEquals}")` };
  }
  if (match.titleRegex) {
    try { if ((new RegExp(match.titleRegex)).test(title)) return { ok: true, reason: `titleRegex~/${match.titleRegex}/` }; } catch {}
  }
  if (match.classNameEquals && (info.className || '') === match.classNameEquals) {
    return { ok: true, reason: `classNameEquals(${match.classNameEquals})` };
  }
  if (match.classNameRegex) {
    try { if ((new RegExp(match.classNameRegex)).test(info.className || '')) return { ok: true, reason: `classNameRegex~/${match.classNameRegex}/` }; } catch {}
  }
  if (match.processName && proc === match.processName.toLowerCase()) {
    return { ok: true, reason: `processName(${match.processName.toLowerCase()})` };
  }
  if (match.processFileExact) {
    const file = (info.processFile || '').toLowerCase();
    if (file === match.processFileExact.toLowerCase()) return { ok: true, reason: `processFileExact(${match.processFileExact.toLowerCase()})` };
  }
  return { ok: false, reason: 'no-criteria-matched' };
}

function formatHwnd(n: number): string {
  const hex = (n >>> 0).toString(16).padStart(8, '0');
  return '0x' + hex;
}

export async function findWindowByMatch(match: GameWindowMatch): Promise<ActiveWindowInfo | null> {
  const list = await enumAllWindows();
  for (const w of list) {
    if (matchGameWindow(w, match)) return w;
  }
  return null;
}

async function enumAllWindows(): Promise<ActiveWindowInfo[]> {
  if (os.platform() !== 'win32') return [];
  const ps = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
}
"@;
$lines = New-Object System.Collections.Generic.List[string];
[WinEnum]::EnumWindows({ param($h,$l)
  if (-not [WinEnum]::IsWindowVisible($h)) { return $true }
  $sb = New-Object System.Text.StringBuilder 512; [WinEnum]::GetWindowText($h,$sb,$sb.Capacity) | Out-Null; $title=$sb.ToString();
  $csb = New-Object System.Text.StringBuilder 256; [WinEnum]::GetClassName($h,$csb,$csb.Capacity) | Out-Null; $cls=$csb.ToString();
  $pid=0; [WinEnum]::GetWindowThreadProcessId($h,[ref]$pid) | Out-Null;
  $name=''; $path='';
  try { $p = Get-Process -Id $pid -ErrorAction Stop; $name = $p.ProcessName } catch {}
  try { if ($p -and $p.Path) { $path=$p.Path } } catch {}
  if (-not $path -and $p) { try { $path=$p.MainModule.FileName } catch {} }
  if (-not $path -and $pid -ne 0) { try { $c=Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction Stop; if ($c -and $c.ExecutablePath){ $path=$c.ExecutablePath } } catch {} }
  $file=''; if ($path) { try { $file=[System.IO.Path]::GetFileName($path) } catch {} }
  $lines.Add("$pid|$name|$file|$cls|$([Int64]$h)|$title") | Out-Null;
  return $true
}, [IntPtr]::Zero) | Out-Null;
$lines -join [Environment]::NewLine
`;
  const raw = await runPwsh(ps);
  const lines = (raw || '').split(/\r?\n/).filter(Boolean);
  const out: ActiveWindowInfo[] = [];
  for (const line of lines) {
    const [pidStr, name, file, cls, hwndStr, ...titleParts] = line.split('|');
    const title = titleParts.join('|');
    const pid = pidStr && /^\d+$/.test(pidStr) ? parseInt(pidStr, 10) : null;
    const hwnd = hwndStr && /^-?\d+$/.test(hwndStr) ? parseInt(hwndStr, 10) : null;
    out.push({ title, processName: name || null, pid, processFile: file || null, className: cls || null, hwnd });
  }
  return out;
}

function runPwsh(script: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const tmpDir = os.tmpdir();
      const file = path.join(tmpDir, `winwindow_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
      fs.writeFileSync(file, script, { encoding: 'utf-8' });
      const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
      let out = '';
      let err = '';
      ps.stdout.on('data', (d) => (out += d.toString()));
      ps.stderr.on('data', (d) => (err += d.toString()));
      ps.on('close', () => {
        try { fs.unlinkSync(file); } catch {}
        resolve((out || err).toString());
      });
    } catch {
      resolve('');
    }
  });
}

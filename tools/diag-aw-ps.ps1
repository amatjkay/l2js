$ErrorActionPreference = 'Continue'
Add-Type @"
using System; using System.Runtime.InteropServices;
public class FWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
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
$file = '';
if ($path) { try { $file = [System.IO.Path]::GetFileName($path) } catch {} }
Write-Host "HWND=$([Int64]$h) PID=$procId TITLE=$title CLASS=$cls NAME=$name FILE=$file"

$ErrorActionPreference = 'Stop'
# Find LU4 window
$json = powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot/find-window.ps1" -Mode find -TitleContains 'LU4' -ClassEquals 'UnrealWindow' -ProcessNameContains 'lu4'
try { $w = $json | ConvertFrom-Json } catch { Write-Output '{"ok":false,"reason":"parse_failed"}'; exit 1 }
if (-not $w.found) { Write-Output '{"ok":false,"reason":"not_found"}'; exit 1 }
$hwndHex = $w.hwnd
if (-not $hwndHex -or ($hwndHex -notmatch '^0x')) { Write-Output '{"ok":false,"reason":"bad_hwnd_format"}'; exit 1 }
$hwndInt = [int]::Parse($hwndHex.Substring(2), [System.Globalization.NumberStyles]::HexNumber)
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class FGAct {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$ok = [FGAct]::SetForegroundWindow([IntPtr]$hwndInt)
if ($ok) { Write-Output '{"ok":true,"hwnd":"'+$hwndHex+'"}' } else { Write-Output '{"ok":false,"reason":"SetForegroundWindow_failed","hwnd":"'+$hwndHex+'"}'; exit 1 }

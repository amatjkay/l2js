param(
  [Parameter(Mandatory=$true)][string]$TitleExact,
  [int]$Retries = 5,
  [int]$DelayMs = 200
)
$ErrorActionPreference = 'Stop'
try {
  $wshell = New-Object -ComObject WScript.Shell
} catch {
  Write-Output '{"ok":false,"reason":"com_failed"}'
  exit 1
}
$ok = $false
for ($i=0; $i -lt $Retries; $i++) {
  try {
    if ($wshell.AppActivate($TitleExact)) { $ok = $true; break }
  } catch {}
  Start-Sleep -Milliseconds $DelayMs
}
if ($ok) { Write-Output '{"ok":true}'; exit 0 } else { Write-Output '{"ok":false,"reason":"not_found"}'; exit 1 }

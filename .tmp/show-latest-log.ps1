$ErrorActionPreference = 'SilentlyContinue'
$root = Get-Location
Write-Output ("CWD: " + $root)
$portFile = Join-Path $root '.tmp/arduino-port.txt'
if (Test-Path $portFile) {
  Write-Output 'ArduinoPortFile:'
  Get-Content -Path $portFile
} else {
  Write-Output 'ArduinoPortFile: (missing)'
}
$logs = Join-Path $root 'logs'
if (Test-Path $logs) {
  $files = Get-ChildItem $logs -File | Sort-Object LastWriteTime -Descending
  if ($files -and $files.Count -ge 1) {
    $f = $files[0]
    Write-Output ("LatestLog: " + $f.FullName)
    Write-Output ("Size: " + $f.Length + " bytes; Updated: " + $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss.fff'))
    try {
      Write-Output '--- Tail(400) ---'
      Get-Content -Path $f.FullName -Tail 400
    } catch {
      Write-Output 'Tail failed, dumping entire file:'
      Get-Content -Path $f.FullName
    }
    Write-Output '--- Grep: Serial/CAMERA/targets ---'
    try { Select-String -Path $f.FullName -Pattern 'Serial|CAMERA|Target' -SimpleMatch } catch {}
  } else {
    Write-Output 'No log files found.'
  }
} else {
  Write-Output 'logs folder not found.'
}

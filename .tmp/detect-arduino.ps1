param([string]$OutFile)
$ErrorActionPreference = 'Stop'

function Ensure-Dir($d){ if(-not (Test-Path -LiteralPath $d)){ New-Item -ItemType Directory -Path $d | Out-Null } }

$root = Get-Location
$tmp = Join-Path $root '.tmp'
Ensure-Dir $tmp
if (-not $OutFile) { $OutFile = Join-Path $tmp 'arduino-port.txt' }
if (Test-Path $OutFile) { Remove-Item $OutFile -Force -ErrorAction SilentlyContinue }

# Collect candidates from PnP with COM pattern
$candidates = @()
try {
  $ports = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'COM' }
  foreach ($p in $ports) {
    $m = [regex]::Match($p.Name,'\(COM\d+\)')
    if ($m.Success) {
      $port = $m.Value.Trim('()')
      # PowerShell 5 compatible scoring (no ternary operator)
      $score = 1
      if ($p.Name -match 'Arduino|USB-SERIAL|CH340|CH910|Silicon Labs|CP210|FTDI') { $score = 2 }
      $candidates += [pscustomobject]@{ Port=$port; Score=$score; Name=$p.Name; Id=$p.PNPDeviceID }
    }
  }
} catch { Write-Host "PnP query failed: $($_.Exception.Message)" }

# Fallback: add any ports from SerialPort API if empty
if ($candidates.Count -eq 0) {
  try {
    [string[]]$sp = [System.IO.Ports.SerialPort]::GetPortNames()
    foreach ($p in ($sp | Sort-Object)) { $candidates += [pscustomobject]@{ Port=$p; Score=0; Name=$p; Id='' } }
  } catch { Write-Host "SerialPort enum failed: $($_.Exception.Message)" }
}

$chosen = $candidates | Sort-Object -Property Score -Descending | Select-Object -First 1
if ($null -ne $chosen) {
  $chosen.Port | Out-File -FilePath $OutFile -Encoding ascii
  Write-Output ('ChosenPort: ' + $chosen.Port)
  Write-Output ('DeviceName: ' + $chosen.Name)
  if ($chosen.Id) { Write-Output ('PNPDeviceID: ' + $chosen.Id) }
} else {
  Write-Output 'ChosenPort: (none)'
}

param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Command
)

$ErrorActionPreference = 'Stop'

# Force UTF-8 for logs and console pipeline to avoid mojibake
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}
if ($PSVersionTable.PSVersion.Major -ge 6) {
  $OutputEncoding = [System.Text.Encoding]::UTF8
}

function Ensure-Dir($dir) {
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
}

# Paths
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$logs = Join-Path $root 'logs'
Ensure-Dir $logs

# Prune logs older than 10 minutes
try {
  Get-ChildItem -Path $logs -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-10) } | Remove-Item -Force -ErrorAction SilentlyContinue
} catch {}

# Build log file name
$cmdLine = ($Command -join ' ')
if (-not $cmdLine) {
  Write-Host "Usage: terminal-logger.ps1 -- <command to run>" -ForegroundColor Yellow
  exit 1
}

$ts = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss-fff'
# Build a compact, safe filename: <ts>__<base>__<hash>.log
$baseToken = ($cmdLine -split '\s+')[0]
if (-not $baseToken) { $baseToken = 'cmd' }
$baseLeaf = Split-Path $baseToken -Leaf
$baseSafe = ($baseLeaf -replace '[\\/:*?"<>|]', '_')
if ($baseSafe.Length -gt 40) { $baseSafe = $baseSafe.Substring(0,40) }
$md5 = New-Object -TypeName System.Security.Cryptography.MD5CryptoServiceProvider
$hash = [BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($cmdLine))).Replace('-', '').Substring(0,8)
$fileName = "${ts}__${baseSafe}__${hash}.log"
$logFile = Join-Path $logs $fileName

# Header
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')] COMMAND: $cmdLine" | Out-File -FilePath $logFile -Encoding utf8
"--------------------------------------------------------------------------------" | Out-File -FilePath $logFile -Append -Encoding utf8

# Execute and tee output
try {
  # Use cmd.exe with UTF-8 codepage in the session, capture stderr as stdout
  $wrapped = "chcp 65001 >nul & $cmdLine"
  & cmd /c $wrapped 2>&1 | Tee-Object -FilePath $logFile
  $exitCode = $LASTEXITCODE
} catch {
  $_ | Out-String | Tee-Object -FilePath $logFile -Append | Write-Host
  $exitCode = 1
}

# Footer
"--------------------------------------------------------------------------------" | Out-File -FilePath $logFile -Append -Encoding utf8
"ExitCode: $exitCode" | Out-File -FilePath $logFile -Append -Encoding utf8

exit $exitCode

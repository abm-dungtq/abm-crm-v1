<#
.SYNOPSIS
  Starts the Zalo bridge sidecar unless it is already running.

.DESCRIPTION
  - Exits 0 without starting anything when a node process already runs apps/zalo-bridge/src/main.ts.
  - Loads apps/zalo-bridge/.env (KEY=VALUE lines) into this process only; values are never printed.
    Empty values are skipped so the sidecar's defaults apply.
  - Runs `pnpm -F @abm/zalo-bridge start` from the repository root and appends its output to
    apps/zalo-bridge/logs/bridge.log (rotated to bridge.log.1 above 10 MB).
  - Stays in the foreground and exits with the sidecar's exit code, so a scheduled task can restart it.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $appDir '..\..')).Path

# tsx runs the entry as `node ...\apps\zalo-bridge\node_modules\.bin\..\tsx\dist\cli.mjs src/main.ts`.
$running = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'zalo-bridge[\\/].*src[\\/]main\.ts' })
if ($running.Count -gt 0) {
  Write-Output ("zalo-bridge is already running (PID {0}); not starting another." -f (($running | ForEach-Object { $_.ProcessId }) -join ', '))
  exit 0
}

$envFile = Join-Path $appDir '.env'
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($value -ne '') { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
  }
}

$logDir = Join-Path $appDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'bridge.log'
if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 10MB) {
  Move-Item -LiteralPath $logFile -Destination "$logFile.1" -Force
}

# Only a .cmd or .exe can be run by cmd.exe; `Get-Command pnpm` may resolve to pnpm.ps1.
$pnpm = Get-Command -Name 'pnpm.cmd', 'pnpm.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$pnpmPath = if ($pnpm) { $pnpm.Source } else { Join-Path $env:APPDATA 'npm\pnpm.cmd' }
if (-not (Test-Path -LiteralPath $pnpmPath)) {
  Write-Error 'pnpm not found on PATH or in %APPDATA%\npm.'
  exit 1
}

Add-Content -LiteralPath $logFile -Value ("{0} start-zalo-bridge: starting" -f (Get-Date).ToString('o'))
Set-Location -LiteralPath $repoRoot
# cmd.exe does the redirection so stderr lines are written as plain text, not turned into PowerShell errors.
# A single ArgumentList string reaches cmd.exe verbatim; /s strips only the outer pair of quotes.
$cmdLine = '/d /s /c ""{0}" -F @abm/zalo-bridge start >> "{1}" 2>&1"' -f $pnpmPath, $logFile
$process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList $cmdLine -NoNewWindow -PassThru
$null = $process.Handle  # keeps the handle so ExitCode is available after the process ends
$process.WaitForExit()
$exitCode = $process.ExitCode
Add-Content -LiteralPath $logFile -Value ("{0} start-zalo-bridge: exited with code {1}" -f (Get-Date).ToString('o'), $exitCode)
exit $exitCode

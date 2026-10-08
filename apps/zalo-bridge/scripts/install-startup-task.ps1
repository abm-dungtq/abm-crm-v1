<#
.SYNOPSIS
  Registers the Windows scheduled task "ABM Zalo Bridge" that runs start-zalo-bridge.ps1 when the machine starts.

.DESCRIPTION
  Changes machine configuration: run it only after the operator has agreed, from an elevated PowerShell,
  as the Windows account that owns the repository checkout and the Zalo sessions.
  The task starts at boot whether or not anyone is logged on (S4U, no password stored), never times out,
  ignores a second start while running, and restarts one minute after a failed run.
  Re-running the script replaces the task.

  -AtLogOn needs no elevation: the task starts when this Windows account logs on and runs in its
  session (hidden window), so it stops at log off. Use it when no elevated PowerShell is available.

.EXAMPLE
  .\install-startup-task.ps1 -AtLogOn
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'ABM Zalo Bridge',
  [switch]$AtLogOn
)

$ErrorActionPreference = 'Stop'

$startScript = Join-Path $PSScriptRoot 'start-zalo-bridge.ps1'
if (-not (Test-Path -LiteralPath $startScript)) {
  Write-Error "Missing $startScript"
  exit 1
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path

$shell = Get-Command pwsh -ErrorAction SilentlyContinue
$shellPath = if ($shell) { $shell.Source } else { Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' }

$account = "{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME
$action = New-ScheduledTaskAction -Execute $shellPath `
  -Argument ("-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"{0}`"" -f $startScript) `
  -WorkingDirectory $repoRoot
$trigger = if ($AtLogOn) { New-ScheduledTaskTrigger -AtLogOn -User $account } else { New-ScheduledTaskTrigger -AtStartup }
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$logonType = if ($AtLogOn) { 'Interactive' } else { 'S4U' }
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType $logonType -RunLevel Limited
$when = if ($AtLogOn) { 'at log on' } else { 'at startup' }

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Runs the ABM CRM Zalo bridge sidecar (apps/zalo-bridge) $when." -Force -ErrorAction Stop | Out-Null

Write-Output ("Registered scheduled task '{0}' ({1}) -> {2}" -f $TaskName, $when, $startScript)

<#
.SYNOPSIS
  Registers the Windows scheduled task "ABM Zalo Bridge" that runs start-zalo-bridge.ps1 at log on.

.DESCRIPTION
  No administrator rights. Re-running this script replaces the task.
  The task starts when this Windows account logs on, in a hidden window (conhost --headless),
  and repeats every 5 minutes for as long as the account stays logged on. MultipleInstances
  is IgnoreNew, and start-zalo-bridge.ps1 exits immediately when a bridge is already running,
  so the repetition does not start a second copy. When the wrapper exits, its node child exits too.

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps\zalo-bridge\scripts\install-startup-task.ps1
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'ABM Zalo Bridge'
)

$ErrorActionPreference = 'Stop'

$startScript = Join-Path $PSScriptRoot 'start-zalo-bridge.ps1'
if (-not (Test-Path -LiteralPath $startScript)) {
  Write-Error "Missing $startScript"
  exit 1
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$account = "{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME

$action = New-ScheduledTaskAction -Execute $conhost `
  -Argument ("--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"{0}`"" -f $startScript) `
  -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
# AtLogOn leaves Repetition null, so copy one from a one-shot trigger. An empty
# duration means the 5-minute interval continues for as long as the account stays logged on.
$repetitionSeed = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 1)
$trigger.Repetition = $repetitionSeed.Repetition
$trigger.Repetition.Duration = ''
$trigger.Repetition.StopAtDurationEnd = $false
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Runs the ABM CRM Zalo bridge sidecar at log on, hidden, and again every 5 minutes while this account is logged on." -Force -ErrorAction Stop | Out-Null

Write-Output ("Registered scheduled task '{0}' (at log on, hidden, every 5 minutes) -> {1}" -f $TaskName, $startScript)

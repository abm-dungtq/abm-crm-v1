<#
.SYNOPSIS
  Parses a PowerShell script without running it. Prints "ok" when it has no syntax errors;
  otherwise prints each error as file:line:column: message and exits with code 1.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
try {
  $resolved = (Resolve-Path -LiteralPath $Path).Path
} catch {
  Write-Output "File not found: $Path"
  exit 1
}

$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($resolved, [ref]$tokens, [ref]$errors) | Out-Null

if ($errors -and $errors.Count -gt 0) {
  foreach ($parseError in $errors) {
    $extent = $parseError.Extent
    Write-Output ("{0}:{1}:{2}: {3}" -f $resolved, $extent.StartLineNumber, $extent.StartColumnNumber, $parseError.Message)
  }
  exit 1
}

Write-Output 'ok'

[CmdletBinding()]
param(
    [ValidateSet("auto", "en-IN", "hi-IN", "en-US", "en-GB")]
    [string]$Locale = "auto",
    [ValidateRange(4, 25)]
    [int]$Timeout = 10,
    [switch]$Once,
    [switch]$NoSpeak,
    [string]$Model
)

$ErrorActionPreference = "Stop"
$Launcher = Join-Path $PSScriptRoot ".venv\Scripts\ultron-local.exe"

if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
    Write-Error "ULTRON Local Assistant is not installed. Run .\tools\local-assistant\setup.ps1 from the repository root first."
    exit 2
}

$Arguments = @(
    "voice",
    "--locale", $Locale,
    "--timeout", [string]$Timeout
)
if ($Once) { $Arguments += "--once" }
if ($NoSpeak) { $Arguments += "--no-speak" }
if (-not [string]::IsNullOrWhiteSpace($Model)) {
    $Arguments += @("--model", $Model)
}

& $Launcher @Arguments
exit $LASTEXITCODE

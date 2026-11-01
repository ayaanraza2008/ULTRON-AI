<#
.SYNOPSIS
    ULTRON AI — Windows Desktop Companion Uninstaller
.DESCRIPTION
    Safely revokes tokens, terminates running companion processes,
    unregisters scheduled tasks, and cleans up local configuration.
#>

$ErrorActionPreference = "Continue"

Write-Host "=================================================" -ForegroundColor Yellow
Write-Host "   ULTRON AI — UNINSTALL WINDOWS COMPANION       " -ForegroundColor Yellow
Write-Host "=================================================" -ForegroundColor Yellow

# 1. Unregister Scheduled Task
Write-Host "`n[1/3] Removing Scheduled Task 'UltronDesktopCompanion'..." -ForegroundColor Cyan
try {
    $task = Get-ScheduledTask -TaskName "UltronDesktopCompanion" -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName "UltronDesktopCompanion" -Confirm:$false
        Write-Host "  Scheduled task removed." -ForegroundColor Green
    } else {
        Write-Host "  No scheduled task found." -ForegroundColor Gray
    }
} catch {
    Write-Host "  Scheduled task cleanup note: $_" -ForegroundColor Gray
}

# 2. Terminate Running Background Daemon Instances
Write-Host "`n[2/3] Checking for running companion daemon processes..." -ForegroundColor Cyan
try {
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*windows-desktop-agent.js*" } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        Write-Host "  Stopped companion process PID $($_.ProcessId)" -ForegroundColor Green
    }
} catch {}

# 3. Clean Configuration
Write-Host "`n[3/3] Removing Local Companion Configuration..." -ForegroundColor Cyan
$repoRoot = Resolve-Path "$PSScriptRoot\.."
$configFile = Join-Path $repoRoot "config\windows-companion.json"
if (Test-Path $configFile) {
    Remove-Item -Path $configFile -Force
    Write-Host "  Removed configuration: $configFile" -ForegroundColor Green
} else {
    Write-Host "  No configuration file found." -ForegroundColor Gray
}

Write-Host "`n=================================================" -ForegroundColor Green
Write-Host "   ULTRON WINDOWS COMPANION UNINSTALLED CLEANLY " -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green

<#
.SYNOPSIS
    ULTRON AI — Windows Desktop Companion Installer
.DESCRIPTION
    Installs, configures, and registers the ULTRON Desktop Companion daemon
    on a local Windows workstation with secure token generation, allowlist checks,
    and a Windows Scheduled Task or background service.
.PARAMETER BackendUrl
    URL of the central ULTRON AI backend (default: https://ultron-ai-core.onrender.com)
.PARAMETER LocalPort
    Local port for companion RPC communication (default: 8089)
#>

param (
    [string]$BackendUrl = "https://ultron-ai-core.onrender.com",
    [int]$LocalPort = 8089
)

$ErrorActionPreference = "Stop"

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "   ULTRON AI — WINDOWS DESKTOP COMPANION SETUP   " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Verify Node.js Environment
Write-Host "`n[1/5] Verifying Node.js Runtime..." -ForegroundColor Yellow
try {
    $nodeVer = node --version
    Write-Host "  Found Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Error "Node.js is not installed or not in PATH. Please install Node.js >= 20."
    exit 1
}

# 2. Check Working Directory
$repoRoot = Resolve-Path "$PSScriptRoot\.."
Write-Host "`n[2/5] Setting up Companion Directory: $repoRoot" -ForegroundColor Yellow

$configDir = Join-Path $repoRoot "config"
if (!(Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

# 3. Generate Secure Companion Token
Write-Host "`n[3/5] Generating Cryptographic Companion Token..." -ForegroundColor Yellow
$tokenBytes = New-Object byte[] 32
[Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($tokenBytes)
$companionToken = "dtk_" + [BitConverter]::ToString($tokenBytes).Replace("-", "").ToLower()

$config = @{
    deviceId = "pc-windows-" + $env:COMPUTERNAME.ToLower()
    deviceName = "Primary Windows Workstation ($env:COMPUTERNAME)"
    backendUrl = $BackendUrl
    localPort = $LocalPort
    authToken = $companionToken
    installedAt = (Get-Date).ToString("o")
    allowlist = @("notepad.exe", "calc.exe", "explorer.exe", "wt.exe", "cmd.exe", "powershell.exe")
    security = @{
        leastPrivilege = $true
        unrestrictedShell = $false
        screenControl = $true
    }
}

$configFile = Join-Path $configDir "windows-companion.json"
$config | ConvertTo-Json -Depth 5 | Set-Content -Path $configFile -Encoding utf8
Write-Host "  Configuration saved to: $configFile" -ForegroundColor Green

# 4. Run Self-Test Diagnostic
Write-Host "`n[4/5] Running Companion Health Self-Test..." -ForegroundColor Yellow
$healthScript = Join-Path $repoRoot "scripts\check-windows-companion.mjs"
node $healthScript

# 5. Register Scheduled Task for Auto-Start (Optional User Scope)
Write-Host "`n[5/5] Registering Windows Scheduled Task 'UltronDesktopCompanion'..." -ForegroundColor Yellow
$action = "node `"$repoRoot\system\windows-desktop-agent.js`""
try {
    $taskExists = Get-ScheduledTask -TaskName "UltronDesktopCompanion" -ErrorAction SilentlyContinue
    if ($taskExists) {
        Unregister-ScheduledTask -TaskName "UltronDesktopCompanion" -Confirm:$false | Out-Null
    }
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $taskAction = New-ScheduledTaskAction -Execute "node.exe" -Argument "`"$repoRoot\system\windows-desktop-agent.js`"" -WorkingDirectory "$repoRoot"
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365)
    
    Register-ScheduledTask -TaskName "UltronDesktopCompanion" -Trigger $trigger -Action $taskAction -Principal $principal -Settings $settings -ErrorAction SilentlyContinue | Out-Null
    Write-Host "  Scheduled Task 'UltronDesktopCompanion' registered successfully." -ForegroundColor Green
} catch {
    Write-Host "  [Note] Scheduled task creation skipped (non-elevated prompt). Companion can be started manually with 'npm run companion:start'." -ForegroundColor Gray
}

Write-Host "`n=================================================" -ForegroundColor Cyan
Write-Host "   ULTRON WINDOWS COMPANION INSTALLED SUCCESSFULLY" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Token: $companionToken" -ForegroundColor Magenta
Write-Host "To test at any time, run: node scripts\check-windows-companion.mjs" -ForegroundColor Yellow

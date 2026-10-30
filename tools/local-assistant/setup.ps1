[CmdletBinding()]
param(
    [switch]$WithGoogle,
    [switch]$WithDocuments,
    [switch]$InstallOllama,
    [switch]$PullModel,
    [string]$Model = "qwen2.5:1.5b"
)

$ErrorActionPreference = "Stop"
$AssistantDir = $PSScriptRoot
$VenvDir = Join-Path $AssistantDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$Launcher = Join-Path $VenvDir "Scripts\ultron-local.exe"

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE : $Executable"
    }
}

$PyLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($PyLauncher) {
    $BasePython = "py"
    $BaseArgs = @("-3")
} else {
    $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $PythonCommand) {
        throw "Python 3.10+ is required. Install from https://www.python.org/downloads/windows/ and run this script again."
    }
    $BasePython = $PythonCommand.Source
    $BaseArgs = @()
}

$VersionArgs = $BaseArgs + @("-c", "import sys; print('.'.join(map(str, sys.version_info[:3]))); raise SystemExit(0 if sys.version_info >= (3,10) else 1)")
try {
    $PythonVersion = & $BasePython @VersionArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.10 or newer is required."
    }
} catch {
    throw "Could not run a compatible Python interpreter. Install Python 3.10+ and retry."
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating an isolated Python environment..."
    $VenvArgs = $BaseArgs + @("-m", "venv", ".venv")
    Push-Location $AssistantDir
    try {
        Invoke-Checked -Executable $BasePython -Arguments $VenvArgs
    } finally {
        Pop-Location
    }
}

$Extras = @()
if ($WithGoogle) { $Extras += "google" }
if ($WithDocuments) { $Extras += "documents" }
$InstallSpec = "."
if ($Extras.Count -gt 0) {
    $InstallSpec = ".[" + ($Extras -join ",") + "]"
}

Write-Host "Installing ULTRON Local Assistant into its private virtual environment..."
Push-Location $AssistantDir
try {
    Invoke-Checked -Executable $VenvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip")
    Invoke-Checked -Executable $VenvPython -Arguments @("-m", "pip", "install", "-e", $InstallSpec)
} finally {
    Pop-Location
}

$OllamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $OllamaCommand -and $InstallOllama) {
    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($Winget) {
        $answer = Read-Host "This will install Ollama on this PC. Type INSTALL OLLAMA to continue"
        if ($answer -ceq "INSTALL OLLAMA") {
            Invoke-Checked -Executable $Winget.Source -Arguments @("install", "--id", "Ollama.Ollama", "--exact", "--accept-package-agreements", "--accept-source-agreements")
            $OllamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
        } else {
            Write-Host "Ollama installation cancelled. The Python CLI was still installed."
        }
    } else {
        Write-Host "winget was not found. Install Ollama from https://ollama.com/download/windows, then run this script again."
    }
}

Write-Host ""
Write-Host "Running a local hardware/model doctor. This does not download models or access Google."
Invoke-Checked -Executable $VenvPython -Arguments @("-m", "ultron_local_assistant", "doctor")
Write-Host ""
Write-Host "Installed command: $Launcher"
Write-Host "Start local chat:  $Launcher chat"
Write-Host "Start local voice: .\tools\local-assistant\start-voice.ps1"
Write-Host "Hindi voice mode:  .\tools\local-assistant\start-voice.ps1 -Locale hi-IN"
Write-Host "List agents:       $Launcher agents"
Write-Host "Desktop actions:   $Launcher desktop list"

if ($PullModel) {
    Write-Host ""
    Write-Host "You explicitly requested a model download. Review disk use, memory needs, and the model license."
    Invoke-Checked -Executable $Launcher -Arguments @("model", "pull", $Model)
} else {
    Write-Host "No model was downloaded. To download one later, run:"
    Write-Host "  $Launcher model pull $Model"
}

if ($WithGoogle) {
    Write-Host ""
    Write-Host "Google integration dependencies are installed, but account access is not enabled yet."
    Write-Host 'Create a Google Desktop OAuth client, enable Gmail/Calendar APIs, then run:'
    Write-Host '  ultron-local google setup --credentials "C:\path\to\client_secret.json"'
}
if ($WithDocuments) {
    Write-Host "Optional local PDF/DOCX readers are installed."
}
Write-Host ""
Write-Host "No cloud LLM keys were configured. Local Ollama is the only model target in this assistant."

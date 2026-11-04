@echo off
setlocal enabledelayedexpansion
title ULTRON AI — Next-Gen Autonomous Desktop Intelligence

echo ====================================================================
echo        ULTRON AI — UNIFIED AUTONOMOUS DESKTOP ECOSYSTEM
echo ====================================================================
echo [1/3] Detecting Host Environment & Runtime...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js executable not found in PATH.
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo  - Detected Node.js Runtime: %NODE_VERSION%

echo [2/3] Checking Configuration & Environment...
if not exist .env (
    if exist .env.example (
        echo  - No .env found, creating default template from .env.example...
        copy .env.example .env >nul
    ) else (
        echo  - Creating minimal .env configuration...
        echo PORT=3000 > .env
        echo NODE_ENV=development >> .env
    )
)

echo [3/3] Launching ULTRON AI Central Server & Desktop Companion...
echo  - Access URL: http://localhost:3000
echo  - Desktop Companion: http://localhost:3000/floating-core.html
echo  - Press Ctrl+C in this console to shut down cleanly.
echo ====================================================================

node scripts/start-ultron.mjs
if %errorlevel% neq 0 (
    echo.
    echo [NOTE] Fallback to direct server entry...
    node server.js
)

pause

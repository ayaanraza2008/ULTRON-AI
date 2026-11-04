@echo off
setlocal
title ULTRON AI — Graceful Shutdown

echo ====================================================================
echo        ULTRON AI — GRACEFUL SYSTEM SHUTDOWN
echo ====================================================================
echo Terminating running ULTRON server processes...

taskkill /F /IM node.exe /FI "WINDOWTITLE eq ULTRON AI*" >nul 2>nul
taskkill /F /IM Ultron.Companion.exe >nul 2>nul

echo [SUCCESS] ULTRON background services stopped cleanly.
timeout /t 2 >nul
exit /b 0

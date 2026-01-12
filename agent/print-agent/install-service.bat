@echo off
REM Install Podo Improve Print Agent as Windows Service
REM Requires: node-windows package (npm install -g node-windows)
REM This runs the agent as a background service

echo ========================================
echo Podo Improve Print Agent - Service Installer
echo ========================================
echo.

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0

REM Check if node-windows is installed
where nssm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo NSSM (Non-Sucking Service Manager) is required.
    echo.
    echo Please download NSSM from: https://nssm.cc/download
    echo Extract it and add to PATH, or place nssm.exe in this folder.
    echo.
    pause
    exit /b 1
)

REM Check if agent.mjs exists
if not exist "%SCRIPT_DIR%agent.mjs" (
    echo ERROR: agent.mjs not found in: %SCRIPT_DIR%
    pause
    exit /b 1
)

echo Installing as Windows Service...
echo.

REM Install service using NSSM
nssm install "PodoImproveAgent" "node" "%SCRIPT_DIR%agent.mjs --url %WEB_APP_URL% --token %AGENT_TOKEN%"
nssm set "PodoImproveAgent" AppDirectory "%SCRIPT_DIR%"
nssm set "PodoImproveAgent" Description "Podo Improve Print Agent - Handles local IdeaMaker slicing"
nssm set "PodoImproveAgent" Start SERVICE_AUTO_START
nssm set "PodoImproveAgent" AppStdout "%SCRIPT_DIR%agent.log"
nssm set "PodoImproveAgent" AppStderr "%SCRIPT_DIR%agent-error.log"

echo.
echo ✓ Service installed!
echo.
echo To start: nssm start PodoImproveAgent
echo To stop: nssm stop PodoImproveAgent
echo To remove: nssm remove PodoImproveAgent confirm
echo.

pause

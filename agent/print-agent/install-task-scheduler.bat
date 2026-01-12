@echo off
REM Install Podo Improve Print Agent using Windows Task Scheduler
REM This runs the agent automatically on user login

echo ========================================
echo Podo Improve Print Agent - Task Scheduler Installer
echo ========================================
echo.

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0

REM Check if agent.mjs exists
if not exist "%SCRIPT_DIR%agent.mjs" (
    echo ERROR: agent.mjs not found in: %SCRIPT_DIR%
    pause
    exit /b 1
)

echo Creating scheduled task...
echo.

REM Create task that runs on user login
schtasks /Create /TN "Podo Improve Agent" /TR "cmd.exe /c \"cd /d \"%SCRIPT_DIR%\" && node agent.mjs --url %WEB_APP_URL% --token %AGENT_TOKEN%\"" /SC ONLOGON /RU "%USERNAME%" /F

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✓ Task created successfully!
    echo.
    echo The agent will start automatically when you log in.
    echo.
    echo To remove: schtasks /Delete /TN "Podo Improve Agent" /F
    echo To run now: schtasks /Run /TN "Podo Improve Agent"
    echo.
) else (
    echo.
    echo ✗ Failed to create task. You may need to run as Administrator.
    echo.
)

pause

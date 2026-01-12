@echo off
REM Install Podo Improve Print Agent to Windows Startup
REM This will make the agent start automatically when you log in

echo ========================================
echo Podo Improve Print Agent - Startup Installer
echo ========================================
echo.

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

REM Check if agent.mjs exists
if not exist "%SCRIPT_DIR%agent.mjs" (
    echo ERROR: agent.mjs not found in: %SCRIPT_DIR%
    echo Please run this script from the agent/print-agent folder.
    pause
    exit /b 1
)

REM Create a shortcut in Startup folder
echo Creating startup shortcut...
echo.

REM Use PowerShell to create shortcut
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_DIR%\Podo Improve Agent.lnk'); $Shortcut.TargetPath = 'cmd.exe'; $Shortcut.Arguments = '/c \"cd /d \"%SCRIPT_DIR%\" && node agent.mjs --url %WEB_APP_URL% --token %AGENT_TOKEN%\"'; $Shortcut.WorkingDirectory = '%SCRIPT_DIR%'; $Shortcut.WindowStyle = 1; $Shortcut.Save()"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✓ Success! The agent will now start automatically when you log in.
    echo.
    echo To remove auto-start: Delete the shortcut from:
    echo %STARTUP_DIR%
    echo.
) else (
    echo.
    echo ✗ Failed to create startup shortcut.
    echo Please check the error above.
    echo.
)

pause

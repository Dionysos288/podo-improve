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
set HIDDEN_VBS=%SCRIPT_DIR%start-agent-hidden.vbs

REM Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if "%WEB_APP_URL%"=="" (
    echo ERROR: WEB_APP_URL environment variable is not set.
    echo Example: set WEB_APP_URL=https://your-app-url
    pause
    exit /b 1
)

if "%AGENT_TOKEN%"=="" (
    echo ERROR: AGENT_TOKEN environment variable is not set.
    echo Please generate an agent token in the web app first.
    pause
    exit /b 1
)

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

REM Create hidden launcher script
> "%HIDDEN_VBS%" echo Set shell = CreateObject("WScript.Shell")
>> "%HIDDEN_VBS%" echo shell.CurrentDirectory = "%SCRIPT_DIR%"
>> "%HIDDEN_VBS%" echo shell.Run "node ""%SCRIPT_DIR%agent.mjs"" --url %WEB_APP_URL% --token %AGENT_TOKEN%", 0, False

REM Use PowerShell to create shortcut
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_DIR%\Podo Improve Agent.lnk'); $Shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'; $Shortcut.Arguments = '""%HIDDEN_VBS%""'; $Shortcut.WorkingDirectory = '%SCRIPT_DIR%'; $Shortcut.IconLocation = Join-Path $env:SystemRoot 'System32\shell32.dll,137'; $Shortcut.Save(); Write-Host 'Shortcut created successfully!'"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✓ Success! The agent will now start automatically when you log in.
    echo.
    echo The agent will run hidden in the background.
    echo.
    echo To remove auto-start: Delete the shortcut from:
    echo %STARTUP_DIR%
    echo.
    echo Starting agent now...
    wscript.exe "%HIDDEN_VBS%"
) else (
    echo.
    echo ✗ Failed to create startup shortcut.
    echo Please check the error above.
    echo.
)

pause

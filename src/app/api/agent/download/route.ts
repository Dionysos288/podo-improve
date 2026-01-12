import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';

/**
 * GET /api/agent/download
 * Downloads a launcher script for the Print Agent with token embedded
 */
export async function GET(req: NextRequest) {
	try {
		const session = await requireSession();
		const user = await prisma.user.findUnique({
			where: { id: session.user.id },
			select: { settings: true },
		});

		const settings = (user?.settings as Record<string, unknown>) ?? {};
		const agentToken = settings.agentToken as string | undefined;

		if (!agentToken) {
			return NextResponse.json(
				{ error: 'Agent token not found. Please save your settings first.' },
				{ status: 400 }
			);
		}

		// Get the web app URL from the request
		const origin = req.headers.get('origin') || req.nextUrl.origin;
		const webAppUrl = origin;

		// Detect OS from User-Agent (basic detection)
		const userAgent = req.headers.get('user-agent') || '';
		const isWindows = userAgent.includes('Windows');

		// Check if user wants an installer (query param: ?type=installer)
		const type = req.nextUrl.searchParams.get('type');
		const isInstaller = type === 'installer';

		// Generate launcher script
		let scriptContent: string;
		let filename: string;
		let contentType: string;

		if (isWindows) {
			if (isInstaller) {
				// Windows installer that sets up auto-start
				filename = 'install-auto-start.bat';
				contentType = 'application/x-msdownload';
				scriptContent = `@echo off
REM Podo Improve Print Agent - Auto-Start Installer
REM This will make the agent start automatically when you log in

echo ========================================
echo Podo Improve Print Agent - Auto-Start Setup
echo ========================================
echo.

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set STARTUP_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup
set AGENT_FILE=%SCRIPT_DIR%agent.mjs

REM Check if agent.mjs exists, if not download it
if not exist "%AGENT_FILE%" (
    echo Agent file not found. Downloading from server...
    echo.
    
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -Uri '${webAppUrl}/api/agent/files/agent.mjs' -OutFile '%AGENT_FILE%'; Write-Host 'Downloaded successfully!' } catch { Write-Host 'Download failed:' $_.Exception.Message; exit 1 }"
    
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo ERROR: Failed to download agent file.
        echo Please check your internet connection and try again.
        pause
        exit /b 1
    )
    
    echo.
)

echo Creating startup shortcut...
echo.

REM Create shortcut using PowerShell (runs the launcher script, which will download agent.mjs if needed)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_DIR%\\Podo Improve Agent.lnk'); $Shortcut.TargetPath = 'cmd.exe'; $Shortcut.Arguments = '/c \"cd /d \"%SCRIPT_DIR%\" && if not exist agent.mjs (powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-WebRequest -Uri \\\"${webAppUrl}/api/agent/files/agent.mjs\\\" -OutFile agent.mjs\") && start /min node agent.mjs --url ${webAppUrl} --token ${agentToken}\"'; $Shortcut.WorkingDirectory = '%SCRIPT_DIR%'; $Shortcut.WindowStyle = 7; $Shortcut.IconLocation = 'shell32.dll,137'; $Shortcut.Save(); Write-Host 'Shortcut created successfully!'"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✓ Success! The agent will now start automatically when you log in.
    echo.
    echo The agent will run minimized in the background.
    echo.
    echo To remove auto-start: Delete "Podo Improve Agent" from:
    echo %STARTUP_DIR%
    echo.
    echo Starting agent now...
    start /min node "%AGENT_FILE%" --url ${webAppUrl} --token ${agentToken}
) else (
    echo.
    echo ✗ Failed to create startup shortcut.
    echo You can still run the agent manually using start-agent.bat
    echo.
)

pause
`;
			} else {
				// Windows batch file (regular launcher)
				filename = 'start-agent.bat';
				contentType = 'application/x-msdownload';
				scriptContent = `@echo off
REM Podo Improve Print Agent Launcher
REM This script automatically downloads and runs the Print Agent

echo ========================================
echo Podo Improve Print Agent
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set AGENT_FILE=%SCRIPT_DIR%agent.mjs

REM Check if agent.mjs exists, if not download it
if not exist "%AGENT_FILE%" (
    echo Agent file not found. Downloading from server...
    echo.
    
    REM Download agent.mjs from server
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -Uri '${webAppUrl}/api/agent/files/agent.mjs' -OutFile '%AGENT_FILE%'; Write-Host 'Downloaded successfully!' } catch { Write-Host 'Download failed:' $_.Exception.Message; exit 1 }"
    
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo ERROR: Failed to download agent file.
        echo Please check your internet connection and try again.
        pause
        exit /b 1
    )
    
    echo.
)

REM Start the agent
echo Starting agent...
echo.
cd /d "%SCRIPT_DIR%"
node agent.mjs --url ${webAppUrl} --token ${agentToken}

pause
`;
			}
		} else {
			// Unix shell script
			filename = 'start-agent.sh';
			contentType = 'application/x-sh';
			scriptContent = `#!/bin/bash
# Podo Improve Print Agent Launcher
# This script starts the Print Agent with your token embedded.

echo "Starting Podo Improve Print Agent..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed or not in PATH."
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_FILE="$SCRIPT_DIR/agent.mjs"

# Check if agent.mjs exists, if not download it
if [ ! -f "$AGENT_FILE" ]; then
    echo ""
    echo "Agent file not found. Downloading from server..."
    echo ""
    
    if command -v curl &> /dev/null; then
        curl -o "$AGENT_FILE" "${webAppUrl}/api/agent/files/agent.mjs"
    elif command -v wget &> /dev/null; then
        wget -O "$AGENT_FILE" "${webAppUrl}/api/agent/files/agent.mjs"
    else
        echo "ERROR: Neither curl nor wget is installed."
        echo "Please install curl or wget, or download agent.mjs manually."
        exit 1
    fi
    
    if [ ! -f "$AGENT_FILE" ]; then
        echo "ERROR: Failed to download agent file."
        exit 1
    fi
    
    chmod +x "$AGENT_FILE"
    echo "Downloaded successfully!"
    echo ""
fi

# Start the agent
cd "$SCRIPT_DIR"
node agent.mjs --url ${webAppUrl} --token ${agentToken}
`;
		}

		return new NextResponse(scriptContent, {
			headers: {
				'Content-Type': contentType,
				'Content-Disposition': `attachment; filename="${filename}"`,
			},
		});
	} catch (error) {
		console.error('Error generating agent launcher:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Failed to generate launcher script',
			},
			{ status: 500 }
		);
	}
}

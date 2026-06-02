import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';

/**
 * GET /api/agent/download
 * Returns a one-click Windows setup script that downloads the Print Agent
 * executable and installs it (config + auto-start) with the user's token.
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

		const webAppUrl = req.headers.get('origin') || req.nextUrl.origin;

		const script = `@echo off
setlocal
title Podo Improve Print Agent - Setup
echo ============================================
echo   Podo Improve Print Agent - Installatie
echo ============================================
echo.

set "EXE=%TEMP%\\podo-print-agent-setup.exe"

echo [1/2] Agent downloaden...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '${webAppUrl}/api/agent/download/exe' -OutFile '%EXE%' -UseBasicParsing } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
	echo.
	echo FOUT: Downloaden mislukt. Controleer je internetverbinding en probeer opnieuw.
	pause
	exit /b 1
)

echo [2/2] Installeren en starten...
"%EXE%" install --url "${webAppUrl}" --token "${agentToken}"
if errorlevel 1 (
	echo.
	echo FOUT: Installatie mislukt. Zie de melding hierboven.
	pause
	exit /b 1
)

echo.
echo Klaar! De Print Agent start nu automatisch bij het inloggen
echo en draait in de achtergrond (zie het pictogram rechtsonder).
echo.
echo Je kunt dit venster sluiten.
pause
`;

		return new NextResponse(script, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': 'attachment; filename="Podo-Print-Agent-Setup.cmd"',
			},
		});
	} catch (error) {
		console.error('Error generating agent setup script:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : 'Failed to generate setup script',
			},
			{ status: 500 }
		);
	}
}

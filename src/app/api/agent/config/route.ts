import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/shared/core/db/prisma';

function getBearerToken(req: NextRequest) {
	const auth = req.headers.get('authorization') ?? '';
	const match = auth.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() ?? null;
}

/**
 * GET /api/agent/config
 * Returns the agent's configuration for local PrusaSlicer slicing.
 * Authenticated via Bearer token
 */
export async function GET(req: NextRequest) {
	const token = getBearerToken(req);
	if (!token) {
		return NextResponse.json(
			{ error: 'Missing bearer token' },
			{ status: 401 }
		);
	}

	// Find user by agentToken
	const user = await prisma.user.findFirst({
		where: {
			settings: {
				path: ['agentToken'],
				equals: token,
			},
		},
		select: { id: true, settings: true },
	});

	if (!user) {
		return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
	}

	const settings = (user.settings as Record<string, unknown>) ?? {};
	const prusaSlicerPath = settings.prusaSlicerPath as string | undefined;

	return NextResponse.json({
		slicerEngine: 'prusaslicer',
		prusaSlicerPath: prusaSlicerPath || null,
		// Always emit ASCII G-code: some PrusaSlicer builds mishandle the
		// --binary-gcode flag. The checkbox was removed from the UI.
		disableBinaryGcode: true,
		userId: user.id,
	});
}

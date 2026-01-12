import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/shared/core/db/prisma';

function getBearerToken(req: NextRequest) {
	const auth = req.headers.get('authorization') ?? '';
	const match = auth.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() ?? null;
}

/**
 * GET /api/agent/jobs/next
 * Agent polls this to get the next slicing job
 * Returns: { jobId, stlData (base64), printerSettings, ... } or null if no jobs
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
		select: { id: true, orgId: true },
	});

	if (!user) {
		return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
	}

	// TODO: Implement actual job queue (for now, return null = no jobs)
	// In the future, this would query a jobs table:
	// const job = await prisma.slicingJob.findFirst({
	//   where: { userId: user.id, status: 'PENDING' },
	//   include: { design: true, printer: true }
	// });

	return NextResponse.json({ job: null });
}

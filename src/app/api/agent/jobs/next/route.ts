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

	const prismaAny = prisma as unknown as {
		slicingJob: {
			updateMany: (args: {
				where: Record<string, unknown>;
				data: Record<string, unknown>;
			}) => Promise<{ count: number }>;
			findFirst: (args: {
				where: Record<string, unknown>;
				orderBy?: Record<string, 'asc' | 'desc'>;
				select: Record<string, boolean>;
			}) => Promise<
				| {
						id: string;
						stlBase64: string;
						stlFilename: string | null;
						printerSettings: Record<string, unknown> | null;
						status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
					  }
				| null
			>;
		};
	};

	const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
	await prismaAny.slicingJob.updateMany({
		where: {
			orgId: user.orgId,
			status: 'RUNNING',
			updatedAt: { lt: staleBefore },
		},
		data: {
			status: 'FAILED',
			errorMessage: 'Automatisch afgebroken: timeout (agent niet teruggekoppeld).',
		},
	});

	const candidate = await prismaAny.slicingJob.findFirst({
		where: { orgId: user.orgId, status: 'PENDING' },
		orderBy: { createdAt: 'asc' },
		select: {
			id: true,
			stlBase64: true,
			stlFilename: true,
			printerSettings: true,
			status: true,
		},
	});

	if (!candidate) {
		return NextResponse.json({ job: null });
	}

	const lock = await prismaAny.slicingJob.updateMany({
		where: { id: candidate.id, status: 'PENDING' },
		data: { status: 'RUNNING', errorMessage: null },
	});

	if (!lock.count) {
		return NextResponse.json({ job: null });
	}

	return NextResponse.json({
		job: {
			jobId: candidate.id,
			stlData: candidate.stlBase64,
			filename: candidate.stlFilename ?? 'insole.stl',
			printerSettings: candidate.printerSettings ?? {},
		},
	});
}

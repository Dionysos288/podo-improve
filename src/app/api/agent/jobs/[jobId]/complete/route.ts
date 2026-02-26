import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/src/shared/core/db/prisma';

function getBearerToken(req: NextRequest) {
	const auth = req.headers.get('authorization') ?? '';
	const match = auth.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() ?? null;
}

export async function POST(
	req: NextRequest,
	ctx: { params: Promise<{ jobId: string }> }
) {
	const token = getBearerToken(req);
	if (!token) {
		return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
	}

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

	const { jobId } = await ctx.params;
	const body = (await req.json()) as {
		gcodeBase64?: string;
		filename?: string;
		slicerMeta?: Record<string, unknown>;
	};
	if (!body.gcodeBase64) {
		return NextResponse.json({ error: 'gcodeBase64 is verplicht.' }, { status: 400 });
	}

	const prismaAny = prisma as unknown as {
		slicingJob: {
			updateMany: (args: {
				where: Record<string, unknown>;
				data: Record<string, unknown>;
			}) => Promise<{ count: number }>;
		};
	};

	const updated = await prismaAny.slicingJob.updateMany({
		where: {
			id: jobId,
			orgId: user.orgId,
			status: 'RUNNING',
		},
		data: {
			status: 'DONE',
			gcodeBase64: body.gcodeBase64,
			gcodeFilename: body.filename || 'insole.gcode',
			slicerMeta: (body.slicerMeta ?? {}) as Prisma.InputJsonValue,
			errorMessage: null,
		},
	});

	if (!updated.count) {
		return NextResponse.json({ error: 'Job niet gevonden of niet RUNNING.' }, { status: 404 });
	}

	return NextResponse.json({ ok: true });
}

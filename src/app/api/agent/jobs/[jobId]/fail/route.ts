import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/shared/core/db/prisma';
import { assertOrganizationIsActive, OrganizationClosedError } from '@/src/shared/core/auth/organization-access';

function getBearerToken(req: NextRequest) {
	const auth = req.headers.get('authorization') ?? '';
	const match = auth.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() ?? null;
}

export async function POST(
	req: NextRequest,
	ctx: { params: Promise<{ jobId: string }> }
) {
	try {
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
		if (!user.orgId) {
			return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
		}

		await assertOrganizationIsActive(user.orgId);

		const { jobId } = await ctx.params;
		const body = (await req.json()) as { errorMessage?: string };

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
			status: 'FAILED',
			errorMessage: body.errorMessage || 'Slicer fout zonder melding.',
		},
	});

		if (!updated.count) {
			return NextResponse.json({ error: 'Job niet gevonden of niet RUNNING.' }, { status: 404 });
		}

		return NextResponse.json({ ok: true });
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: error instanceof OrganizationClosedError ? 403 : 500 }
		);
	}
}

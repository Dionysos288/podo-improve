import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/shared/core/db/prisma';
import { assertOrganizationIsActive, OrganizationClosedError } from '@/src/shared/core/auth/organization-access';

function getBearerToken(req: NextRequest) {
	const auth = req.headers.get('authorization') ?? '';
	const match = auth.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() ?? null;
}

export async function POST(req: NextRequest) {
	try {
		const token = getBearerToken(req);
		if (!token) {
			return NextResponse.json(
				{ error: 'Missing bearer token' },
				{ status: 401 }
			);
		}

		// Agent authenticates via a per-user token stored in User.settings.agentToken
		// Use Prisma's JSON filtering (PostgreSQL supports this)
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

		const now = new Date().toISOString();

		// Optional status body sent by the agent (legacy pings send nothing).
		let status: Record<string, unknown> = {};
		try {
			const body = await req.json();
			if (body && typeof body === 'object') status = body as Record<string, unknown>;
		} catch {
			status = {};
		}

		const agentVersion = typeof status.version === 'string' ? status.version : undefined;
		const agentSlicerOk = typeof status.slicerOk === 'boolean' ? status.slicerOk : undefined;
		const agentSlicerPath = typeof status.slicerPath === 'string' ? status.slicerPath : null;
		const agentPlatform = typeof status.platform === 'string' ? status.platform : undefined;

		// Merge write for settings
		const existing = await prisma.user.findUnique({
			where: { id: user.id },
			select: { settings: true },
		});
		const merged = {
			...(typeof existing?.settings === 'object' && existing?.settings
				? (existing.settings as Record<string, unknown>)
				: {}),
			agentLastSeenAt: now,
			...(agentVersion !== undefined ? { agentVersion } : {}),
			...(agentSlicerOk !== undefined ? { agentSlicerOk } : {}),
			...(agentSlicerOk !== undefined ? { agentSlicerPath } : {}),
			...(agentPlatform !== undefined ? { agentPlatform } : {}),
		};
		await prisma.user.update({
			where: { id: user.id },
			data: { settings: merged },
		});

		return NextResponse.json({
			ok: true,
			userId: user.id,
			orgId: user.orgId,
			now,
		});
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: error instanceof OrganizationClosedError ? 403 : 500 }
		);
	}
}

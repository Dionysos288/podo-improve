import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/shared/core/db/prisma';

function getBearerToken(req: NextRequest) {
	const auth = req.headers.get('authorization') ?? '';
	const match = auth.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() ?? null;
}

export async function POST(req: NextRequest) {
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

	const now = new Date().toISOString();

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
}

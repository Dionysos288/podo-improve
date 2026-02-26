import { NextResponse } from 'next/server';
import fs from 'fs';
import { requireSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';

/**
 * GET /api/printer/config
 * Returns the printer configuration status (whether ideaMaker and RaiseCloud are configured)
 */
export async function GET() {
	const session = await requireSession();
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
		select: { settings: true },
	});
	const settings = (user?.settings ?? {}) as Record<string, unknown>;
	const ideaMakerPath =
		typeof settings.ideamakerPath === 'string' ? settings.ideamakerPath : '';
	const agentLastSeenAt =
		typeof settings.agentLastSeenAt === 'string' ? settings.agentLastSeenAt : null;
	const raiseCloudApiKey = process.env.RAISECLOUD_API_KEY || '';
	const raiseCloudApiSecret = process.env.RAISECLOUD_API_SECRET || '';

	// Check if ideaMaker executable exists
	let ideaMakerConfigured = false;
	if (ideaMakerPath) {
		try {
			ideaMakerConfigured = fs.existsSync(ideaMakerPath);
		} catch {
			ideaMakerConfigured = false;
		}
	}

	// Check if RaiseCloud credentials are set
	const raiseCloudConfigured = Boolean(raiseCloudApiKey && raiseCloudApiSecret);
	const lastSeenMs = agentLastSeenAt ? Date.parse(agentLastSeenAt) : NaN;
	const agentOnline = Number.isFinite(lastSeenMs)
		? Date.now() - lastSeenMs <= 90_000
		: false;

	return NextResponse.json({
		ideaMaker: {
			configured: ideaMakerConfigured,
			path: ideaMakerPath ? '(configured)' : '(not set)',
			agentOnline,
			agentLastSeenAt,
		},
		raiseCloud: {
			configured: raiseCloudConfigured,
		},
	});
}

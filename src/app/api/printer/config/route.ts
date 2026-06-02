import { NextResponse } from 'next/server';
import { requireSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';
import {
	AGENT_VERSION,
	isAgentOnline,
	isUpdateAvailable,
} from '@/src/shared/core/agent/release';

/**
 * GET /api/printer/config
 * Returns the printer configuration status (PrusaSlicer + RaiseCloud).
 *
 * IMPORTANT: PrusaSlicer runs on the user's PC, not the server. So slicer
 * availability is whatever the agent last reported (agentSlicerOk), never a
 * server-side filesystem check.
 */
export async function GET() {
	const session = await requireSession();
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
		select: { settings: true },
	});
	const settings = (user?.settings ?? {}) as Record<string, unknown>;

	const agentLastSeenAt =
		typeof settings.agentLastSeenAt === 'string' ? settings.agentLastSeenAt : null;
	const agentVersion =
		typeof settings.agentVersion === 'string' ? settings.agentVersion : null;
	const agentSlicerPath =
		typeof settings.agentSlicerPath === 'string' ? settings.agentSlicerPath : null;

	const agentOnline = isAgentOnline(agentLastSeenAt);
	// Trust the agent's report; default true when online but unreported (older
	// agents that only send heartbeats).
	const slicerOk =
		typeof settings.agentSlicerOk === 'boolean' ? settings.agentSlicerOk : agentOnline;
	const slicerConfigured = agentOnline && slicerOk;

	const raiseCloudApiKey = process.env.RAISECLOUD_API_KEY || '';
	const raiseCloudApiSecret = process.env.RAISECLOUD_API_SECRET || '';
	const raiseCloudConfigured = Boolean(raiseCloudApiKey && raiseCloudApiSecret);

	return NextResponse.json({
		slicer: {
			engine: 'prusaslicer',
			configured: slicerConfigured,
			agentOnline,
			agentLastSeenAt,
			agentVersion,
			agentSlicerOk: slicerOk,
			agentSlicerPath,
			latestVersion: AGENT_VERSION,
			updateAvailable: isUpdateAvailable(agentVersion),
		},
		prusaSlicer: {
			configured: slicerConfigured,
			path: agentSlicerPath ? '(detected by agent)' : '(not detected)',
			usingBuiltInDefaultProfile: true,
		},
		raiseCloud: {
			configured: raiseCloudConfigured,
		},
	});
}

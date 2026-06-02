import { NextResponse } from 'next/server';
import { AGENT_VERSION, AGENT_EXE_URL, AGENT_EXE_SHA256 } from '@/src/shared/core/agent/release';

/**
 * GET /api/agent/version
 * Advertises the latest agent build so running agents can self-update and the
 * settings UI can show "update available".
 */
export async function GET() {
	return NextResponse.json({
		version: AGENT_VERSION,
		url: AGENT_EXE_URL || null,
		sha256: AGENT_EXE_SHA256 || null,
	});
}

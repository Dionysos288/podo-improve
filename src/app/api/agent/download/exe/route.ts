import { NextResponse } from 'next/server';
import { AGENT_EXE_URL } from '@/src/shared/core/agent/release';

/**
 * GET /api/agent/download/exe
 * Redirects to the hosted Print Agent executable. Hosting URL is configured via
 * the AGENT_EXE_URL env var (e.g. a GitHub Release asset or Vercel Blob URL).
 */
export async function GET() {
	if (!AGENT_EXE_URL) {
		return NextResponse.json(
			{ error: 'Agent download is not configured (AGENT_EXE_URL is unset).' },
			{ status: 503 }
		);
	}
	return NextResponse.redirect(AGENT_EXE_URL, 302);
}

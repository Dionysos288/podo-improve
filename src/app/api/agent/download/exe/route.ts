import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { AGENT_EXE_URL } from '@/src/shared/core/agent/release';

/**
 * GET /api/agent/download/exe
 * Serves the local built exe when AGENT_LOCAL_EXE_PATH is set (local dev).
 * Otherwise redirects to AGENT_EXE_URL (GitHub Release, etc.).
 */
export async function GET() {
	const localRel = process.env.AGENT_LOCAL_EXE_PATH?.trim();
	if (localRel) {
		const resolved = path.isAbsolute(localRel)
			? localRel
			: path.join(process.cwd(), localRel);
		try {
			const buf = await fs.readFile(resolved);
			return new NextResponse(buf, {
				headers: {
					'Content-Type': 'application/octet-stream',
					'Content-Disposition': 'attachment; filename="podo-print-agent.exe"',
					'Content-Length': String(buf.byteLength),
				},
			});
		} catch {
			return NextResponse.json(
				{
					error:
						'Local agent exe not found. Run: npm run agent:build',
					path: resolved,
				},
				{ status: 503 }
			);
		}
	}

	if (!AGENT_EXE_URL) {
		return NextResponse.json(
			{ error: 'Agent download is not configured (AGENT_EXE_URL is unset).' },
			{ status: 503 }
		);
	}
	return NextResponse.redirect(AGENT_EXE_URL, 302);
}

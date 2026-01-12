import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/agent/files/agent.mjs
 * Serves the agent.mjs file to end users
 */
export async function GET() {
	try {
		// Path to agent.mjs in the repository
		const agentPath = path.join(process.cwd(), 'agent', 'print-agent', 'agent.mjs');

		if (!fs.existsSync(agentPath)) {
			return NextResponse.json(
				{ error: 'Agent file not found on server' },
				{ status: 404 }
			);
		}

		const fileContent = fs.readFileSync(agentPath, 'utf-8');

		return new NextResponse(fileContent, {
			headers: {
				'Content-Type': 'application/javascript',
				'Content-Disposition': 'attachment; filename="agent.mjs"',
			},
		});
	} catch (error) {
		console.error('Error serving agent file:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Failed to serve agent file',
			},
			{ status: 500 }
		);
	}
}

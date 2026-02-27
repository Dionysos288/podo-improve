import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/src/shared/core/db/prisma';
import { gunzipSync } from 'zlib';

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

		const { jobId } = await ctx.params;

		// Read body as text to avoid Next.js default JSON size limit
		const rawBody = await req.text();
		let body: {
			gcodeBase64?: string;
			gcodeGzipBase64?: string;
			filename?: string;
			slicerMeta?: Record<string, unknown>;
		};
		try {
			body = JSON.parse(rawBody);
		} catch {
			return NextResponse.json(
				{ error: `Invalid JSON body (length=${rawBody.length})` },
				{ status: 400 }
			);
		}

		// Accept either gzip-compressed or raw base64 gcode
		let gcodeBase64 = body.gcodeBase64;
		if (body.gcodeGzipBase64) {
			try {
				const gzBuffer = Buffer.from(body.gcodeGzipBase64, 'base64');
				const rawBuffer = gunzipSync(gzBuffer);
				gcodeBase64 = rawBuffer.toString('base64');
			} catch (decompressErr) {
				return NextResponse.json(
					{ error: `Failed to decompress gcodeGzipBase64: ${decompressErr instanceof Error ? decompressErr.message : 'unknown'}` },
					{ status: 400 }
				);
			}
		}

		if (!gcodeBase64) {
			return NextResponse.json(
				{ error: 'gcodeBase64 of gcodeGzipBase64 is verplicht.' },
				{ status: 400 }
			);
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
				gcodeBase64,
				gcodeFilename: body.filename || 'insole.gcode',
				slicerMeta: (body.slicerMeta ?? {}) as Prisma.InputJsonValue,
				errorMessage: null,
			},
		});

		if (!updated.count) {
			return NextResponse.json(
				{ error: 'Job niet gevonden of niet RUNNING.' },
				{ status: 404 }
			);
		}

		return NextResponse.json({ ok: true });
	} catch (err) {
		console.error('[agent/jobs/complete] Unhandled error:', err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : 'Internal server error' },
			{ status: 500 }
		);
	}
}

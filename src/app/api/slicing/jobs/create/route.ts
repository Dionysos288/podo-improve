import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';
import { recordUsageEvent } from '@/src/shared/core/platform/usage';
import {
	assertStlQuotaAndRecordExport,
	StlQuotaExceededError,
} from '@/src/shared/core/platform/stlQuota';

// Prevent Next.js from caching / cloning the Response body internally
export const dynamic = 'force-dynamic';

/** Helper – build a plain JSON Response (avoids NextResponse.json body-lock bug in Next 16) */
function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

type CreateSlicingJobBody = {
	stlBase64?: string;
	filename?: string;
	printerSettings?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
	try {
		const { session, orgId } = await requireOrganization();
		const contentType = (req.headers.get('content-type') ?? '').toLowerCase();

		let stlBase64 = '';
		let filename = 'insole.stl';
		let printerSettings: Record<string, unknown> = {};

		if (contentType.includes('application/octet-stream')) {
			let arr: ArrayBuffer;
			try {
				arr = await req.arrayBuffer();
			} catch (bodyErr) {
				// Body stream can be "disturbed or locked" when the STL exceeds
				// the proxy body-size limit (proxyClientMaxBodySize in next.config).
				console.error('Failed to read request body:', bodyErr);
				return jsonResponse(
					{ error: 'STL-upload mislukt: bestand is te groot of verbinding is verbroken. Maximaal 50 MB.' },
					413,
				);
			}
			if (!arr || arr.byteLength === 0) {
				return jsonResponse({ error: 'Leeg STL-bestand ontvangen.' }, 400);
			}
			stlBase64 = Buffer.from(arr).toString('base64');
			filename = req.headers.get('x-filename') || filename;
			const rawSettings = req.headers.get('x-printer-settings');
			if (rawSettings) {
				try {
					printerSettings = JSON.parse(rawSettings) as Record<string, unknown>;
				} catch {
					printerSettings = {};
				}
			}
		} else {
			const body = (await req.json()) as CreateSlicingJobBody;
			stlBase64 = body.stlBase64?.trim() || '';
			filename = body.filename || filename;
			printerSettings = (body.printerSettings ?? {}) as Record<string, unknown>;
		}

		if (!stlBase64) {
			return jsonResponse({ error: 'stlBase64 is verplicht.' }, 400);
		}

		const projectIdHeader = req.headers.get('x-project-id');

		try {
			await assertStlQuotaAndRecordExport({
				orgId,
				userId: session.user.id,
				exportKind: 'gcode',
				projectId: projectIdHeader,
				resourceId: null,
			});
		} catch (error) {
			if (error instanceof StlQuotaExceededError) {
				return jsonResponse({ error: error.message }, 403);
			}
			throw error;
		}

		const prismaAny = prisma as unknown as {
			slicingJob: {
				create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
			};
		};

		const job = await prismaAny.slicingJob.create({
			data: {
				userId: session.user.id,
				orgId,
				status: 'PENDING',
				stlBase64,
				stlFilename: filename,
				printerModel:
					typeof printerSettings.printer === 'string' ? printerSettings.printer : 'Raise3D Pro3',
				nozzleSize:
					typeof printerSettings.nozzle === 'string' ? printerSettings.nozzle : '0.4',
				material:
					typeof printerSettings.material === 'string' ? printerSettings.material : 'TPU 95A',
				slicerProfileName:
					typeof printerSettings.profileName === 'string'
						? printerSettings.profileName
						: 'raise3d-pro3-default',
				printerSettings: printerSettings as Prisma.InputJsonValue,
			},
		});

		const printerLabel = typeof printerSettings.printer === 'string' ? printerSettings.printer : null;
		const materialLabel = typeof printerSettings.material === 'string' ? printerSettings.material : null;

		await recordUsageEvent({
			orgId,
			userId: session.user.id,
			eventType: 'PRINT_STARTED',
			resourceId: job.id,
			metadata: {
				filename,
				...(printerLabel ? { printer: printerLabel } : {}),
				...(materialLabel ? { material: materialLabel } : {}),
			},
		});

		return jsonResponse({ jobId: job.id });
	} catch (error) {
		return jsonResponse(
			{
				error: error instanceof Error ? error.message : 'Slicing job aanmaken mislukt.',
			},
			400,
		);
	}
}

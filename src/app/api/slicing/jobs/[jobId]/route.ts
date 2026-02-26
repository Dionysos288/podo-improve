import { NextResponse } from 'next/server';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';

export async function GET(
	_req: Request,
	ctx: { params: Promise<{ jobId: string }> }
) {
	try {
		const { orgId } = await requireOrganization();
		const { jobId } = await ctx.params;
		const prismaAny = prisma as unknown as {
			slicingJob: {
				findFirst: (args: {
					where: Record<string, unknown>;
					select: Record<string, boolean>;
				}) => Promise<
					| {
							id: string;
							status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
							gcodeBase64: string | null;
							gcodeFilename: string | null;
							errorMessage: string | null;
							updatedAt: Date;
					  }
					| null
				>;
			};
		};

		const job = await prismaAny.slicingJob.findFirst({
			where: { id: jobId, orgId },
			select: {
				id: true,
				status: true,
				gcodeBase64: true,
				gcodeFilename: true,
				errorMessage: true,
				updatedAt: true,
			},
		});

		if (!job) {
			return NextResponse.json({ error: 'Job niet gevonden.' }, { status: 404 });
		}

		return NextResponse.json({
			jobId: job.id,
			status: job.status,
			gcodeBase64: job.gcodeBase64,
			filename: job.gcodeFilename,
			errorMessage: job.errorMessage,
			updatedAt: job.updatedAt,
		});
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Job status ophalen mislukt.' },
			{ status: 400 }
		);
	}
}

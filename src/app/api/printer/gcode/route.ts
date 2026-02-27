import { NextResponse } from 'next/server';

/**
 * POST /api/printer/gcode
 * Legacy endpoint removed.
 * Use /api/slicing/jobs/create and /api/slicing/jobs/[jobId] instead.
 */
export async function POST() {
	return NextResponse.json(
		{
			success: false,
			error:
				'Legacy endpoint removed. Use /api/slicing/jobs/create and poll /api/slicing/jobs/[jobId].',
		},
		{ status: 410 }
	);
}

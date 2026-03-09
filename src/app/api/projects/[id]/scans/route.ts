import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/shared/core/db/prisma';
import {
	requireSession,
	requireOrganization,
} from '@/src/shared/core/auth/get-session';
import { uploadFile } from '@/src/shared/core/db/supabase';
import { FootSide } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * POST /api/projects/[id]/scans
 *
 * Upload a scan STL file for a project.
 * Expects multipart/form-data with:
 *   - file: STL file
 *   - footSide: "LEFT" | "RIGHT"
 *   - name: scan pair name (e.g. "Eerste scan")
 *   - pairId: shared id to group left+right together
 */
export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const session = await requireSession();
		const { orgId } = await requireOrganization();
		const { id: projectId } = await params;

		// Verify the project belongs to this org
		const project = await prisma.project.findFirst({
			where: { id: projectId, patient: { orgId }, deletedAt: null },
		});
		if (!project) {
			return NextResponse.json(
				{ error: 'Project niet gevonden' },
				{ status: 404 }
			);
		}

		const formData = await request.formData();
		const file = formData.get('file') as File | null;
		const footSide = formData.get('footSide') as string | null;
		const name = (formData.get('name') as string | null) || '';
		const pairId = (formData.get('pairId') as string | null) || randomUUID();

		if (!file) {
			return NextResponse.json(
				{ error: 'Geen bestand geselecteerd' },
				{ status: 400 }
			);
		}

		if (!footSide || !['LEFT', 'RIGHT'].includes(footSide)) {
			return NextResponse.json(
				{ error: 'Ongeldige voetzijde (LEFT of RIGHT verwacht)' },
				{ status: 400 }
			);
		}

		// Convert File to buffer for upload
		const buffer = Buffer.from(await file.arrayBuffer());
		const timestamp = Date.now();
		const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
		const storagePath = `${orgId}/${projectId}/${footSide}_${timestamp}_${safeName}`;

		const publicUrl = await uploadFile('scans', storagePath, buffer, 'model/stl');

		// Create scan record
		const scan = await prisma.scan.create({
			data: {
				projectId,
				name,
				pairId,
				footSide: footSide as FootSide,
				stlUrl: publicUrl,
				uploadedBy: session.user.id,
				metadata: {
					originalFilename: file.name,
					fileSize: file.size,
					uploadedAt: new Date().toISOString(),
				},
			},
		});

		return NextResponse.json(scan, { status: 201 });
	} catch (error) {
		console.error('Error uploading scan:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Scan uploaden mislukt',
			},
			{ status: 500 }
		);
	}
}

/**
 * DELETE /api/projects/[id]/scans?pairId=xxx
 *
 * Delete a scan pair (both left and right) from a project.
 */
export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { orgId } = await requireOrganization();
		const { id: projectId } = await params;
		const pairId = request.nextUrl.searchParams.get('pairId');

		if (!pairId) {
			return NextResponse.json(
				{ error: 'pairId parameter is verplicht' },
				{ status: 400 }
			);
		}

		// Verify ownership
		const scansInPair = await prisma.scan.findMany({
			where: {
				pairId,
				projectId,
				project: { patient: { orgId } },
			},
		});

		if (scansInPair.length === 0) {
			return NextResponse.json(
				{ error: 'Scan niet gevonden' },
				{ status: 404 }
			);
		}

		await prisma.scan.deleteMany({ where: { pairId, projectId } });

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error deleting scan:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Scan verwijderen mislukt',
			},
			{ status: 500 }
		);
	}
}

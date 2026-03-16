import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import { recordUsageEvent } from '@/src/shared/core/platform/usage';

/**
 * POST /api/projects/[id]/designs
 *
 * Create a new design for a project.
 * Body (JSON): { parameters?, elements?, landmarks?, scanMetadata?, matchTransform? }
 */
export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { session, orgId } = await requireOrganization();
		const { id: projectId } = await params;

		const project = await prisma.project.findFirst({
			where: { id: projectId, patient: { orgId }, deletedAt: null },
		});
		if (!project) {
			return NextResponse.json(
				{ error: 'Project niet gevonden' },
				{ status: 404 }
			);
		}

		const body = await request.json().catch(() => ({}));

		// Get the latest version number for this project
		const latestDesign = await prisma.design.findFirst({
			where: { projectId, deletedAt: null },
			orderBy: { version: 'desc' },
			select: { version: true },
		});
		const nextVersion = (latestDesign?.version ?? 0) + 1;

		const design = await prisma.design.create({
			data: {
				projectId,
				version: nextVersion,
				parameters: body.parameters ?? {},
				elements: body.elements ?? [],
				landmarks: body.landmarks ?? {},
				scanMetadata: body.scanMetadata ?? {},
				matchTransform: body.matchTransform ?? null,
				clientSettings: body.clientSettings ?? {},
			},
		});

		await recordUsageEvent({
			orgId,
			userId: session.user.id,
			eventType: 'DESIGN_CREATED',
			resourceId: design.id,
			metadata: { projectId, version: design.version },
		});

		// Update project status to IN_PROGRESS when a design is started
		if (project.status === 'DRAFT') {
			await prisma.project.update({
				where: { id: projectId },
				data: { status: 'IN_PROGRESS' },
			});
		}

		return NextResponse.json(design, { status: 201 });
	} catch (error) {
		console.error('Error creating design:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Ontwerp aanmaken mislukt',
			},
			{ status: 500 }
		);
	}
}

/**
 * GET /api/projects/[id]/designs?designId=xxx
 *
 * Get a specific design, or list all designs for a project.
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { orgId } = await requireOrganization();
		const { id: projectId } = await params;
		const designId = request.nextUrl.searchParams.get('designId');

		const project = await prisma.project.findFirst({
			where: { id: projectId, patient: { orgId }, deletedAt: null },
		});
		if (!project) {
			return NextResponse.json(
				{ error: 'Project niet gevonden' },
				{ status: 404 }
			);
		}

		if (designId) {
			const design = await prisma.design.findFirst({
				where: { id: designId, projectId, deletedAt: null },
			});
			if (!design) {
				return NextResponse.json(
					{ error: 'Ontwerp niet gevonden' },
					{ status: 404 }
				);
			}
			return NextResponse.json(design);
		}

		const designs = await prisma.design.findMany({
			where: { projectId, deletedAt: null },
			orderBy: { version: 'desc' },
		});

		return NextResponse.json(designs);
	} catch (error) {
		console.error('Error fetching designs:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Ontwerpen ophalen mislukt',
			},
			{ status: 500 }
		);
	}
}

/**
 * PUT /api/projects/[id]/designs
 *
 * Update an existing design (autosave).
 * Body (JSON): { designId, parameters?, elements?, landmarks?, scanMetadata?, matchTransform?, stlUrl?, gcodeUrl? }
 */
export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { orgId } = await requireOrganization();
		const { id: projectId } = await params;

		const project = await prisma.project.findFirst({
			where: { id: projectId, patient: { orgId }, deletedAt: null },
		});
		if (!project) {
			return NextResponse.json(
				{ error: 'Project niet gevonden' },
				{ status: 404 }
			);
		}

		const body = await request.json();
		const { designId, ...updateData } = body;

		if (!designId) {
			return NextResponse.json(
				{ error: 'designId is verplicht' },
				{ status: 400 }
			);
		}

		const existing = await prisma.design.findFirst({
			where: { id: designId, projectId, deletedAt: null },
		});
		if (!existing) {
			return NextResponse.json(
				{ error: 'Ontwerp niet gevonden' },
				{ status: 404 }
			);
		}

		// Only update provided fields
		const design = await prisma.design.update({
			where: { id: designId },
			data: {
				...(updateData.parameters !== undefined && {
					parameters: updateData.parameters,
				}),
				...(updateData.elements !== undefined && {
					elements: updateData.elements,
				}),
				...(updateData.landmarks !== undefined && {
					landmarks: updateData.landmarks,
				}),
				...(updateData.scanMetadata !== undefined && {
					scanMetadata: updateData.scanMetadata,
				}),
				...(updateData.matchTransform !== undefined && {
					matchTransform: updateData.matchTransform,
				}),
				...(updateData.clientSettings !== undefined && {
					clientSettings: updateData.clientSettings,
				}),
				...(updateData.stlUrl !== undefined && {
					stlUrl: updateData.stlUrl,
				}),
				...(updateData.gcodeUrl !== undefined && {
					gcodeUrl: updateData.gcodeUrl,
				}),
			},
		});

		return NextResponse.json(design);
	} catch (error) {
		console.error('Error updating design:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Ontwerp opslaan mislukt',
			},
			{ status: 500 }
		);
	}
}

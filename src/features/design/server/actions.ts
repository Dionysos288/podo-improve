'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import type { Prisma } from '@prisma/client';

/**
 * Create a new design for a project.
 */
export async function createDesign(
	projectId: string,
	data?: {
		parameters?: Record<string, unknown>;
		elements?: unknown[];
		landmarks?: Record<string, unknown>;
		scanMetadata?: Record<string, unknown>;
		matchTransform?: Record<string, unknown> | null;
	}
) {
	const { orgId } = await requireOrganization();

	const project = await prisma.project.findFirst({
		where: { id: projectId, patient: { orgId }, deletedAt: null },
	});
	if (!project) throw new Error('Project niet gevonden');

	// Get the latest version number
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
			parameters: (data?.parameters ?? {}) as Prisma.InputJsonValue,
			elements: (data?.elements ?? []) as Prisma.InputJsonValue,
			landmarks: (data?.landmarks ?? {}) as Prisma.InputJsonValue,
			scanMetadata: (data?.scanMetadata ?? {}) as Prisma.InputJsonValue,
			matchTransform: (data?.matchTransform ?? undefined) as Prisma.InputJsonValue | undefined,
		},
	});

	// Update project status to IN_PROGRESS
	if (project.status === 'DRAFT') {
		await prisma.project.update({
			where: { id: projectId },
			data: { status: 'IN_PROGRESS' },
		});
	}

	return design;
}

/**
 * Get a design by ID.
 */
export async function getDesign(designId: string) {
	const { orgId } = await requireOrganization();

	const design = await prisma.design.findFirst({
		where: {
			id: designId,
			deletedAt: null,
			project: { patient: { orgId }, deletedAt: null },
		},
	});

	if (!design) throw new Error('Ontwerp niet gevonden');
	return design;
}

/**
 * Get the latest design for a project, or null if none exist.
 */
export async function getLatestDesign(projectId: string) {
	const { orgId } = await requireOrganization();

	const design = await prisma.design.findFirst({
		where: {
			projectId,
			deletedAt: null,
			project: { patient: { orgId }, deletedAt: null },
		},
		orderBy: { version: 'desc' },
	});

	return design;
}

/**
 * Update a design (used for autosave).
 */
export async function updateDesign(
	designId: string,
	data: {
		parameters?: Record<string, unknown>;
		elements?: unknown[];
		landmarks?: Record<string, unknown>;
		scanMetadata?: Record<string, unknown>;
		matchTransform?: Record<string, unknown> | null;
		stlUrl?: string | null;
		gcodeUrl?: string | null;
	}
) {
	const { orgId } = await requireOrganization();

	const existing = await prisma.design.findFirst({
		where: {
			id: designId,
			deletedAt: null,
			project: { patient: { orgId }, deletedAt: null },
		},
	});
	if (!existing) throw new Error('Ontwerp niet gevonden');

	const design = await prisma.design.update({
		where: { id: designId },
		data: {
			...(data.parameters !== undefined && {
				parameters: data.parameters as Prisma.InputJsonValue,
			}),
			...(data.elements !== undefined && {
				elements: data.elements as Prisma.InputJsonValue,
			}),
			...(data.landmarks !== undefined && {
				landmarks: data.landmarks as Prisma.InputJsonValue,
			}),
			...(data.scanMetadata !== undefined && {
				scanMetadata: data.scanMetadata as Prisma.InputJsonValue,
			}),
			...(data.matchTransform !== undefined && {
				matchTransform: data.matchTransform as Prisma.InputJsonValue,
			}),
			...(data.stlUrl !== undefined && { stlUrl: data.stlUrl }),
			...(data.gcodeUrl !== undefined && { gcodeUrl: data.gcodeUrl }),
		},
	});

	return design;
}

/**
 * List all designs for a project.
 */
export async function getDesigns(projectId: string) {
	const { orgId } = await requireOrganization();

	const project = await prisma.project.findFirst({
		where: { id: projectId, patient: { orgId }, deletedAt: null },
	});
	if (!project) throw new Error('Project niet gevonden');

	return prisma.design.findMany({
		where: { projectId, deletedAt: null },
		orderBy: { version: 'desc' },
	});
}

/**
 * Soft-delete a design.
 */
export async function deleteDesign(designId: string) {
	const { orgId } = await requireOrganization();

	const existing = await prisma.design.findFirst({
		where: {
			id: designId,
			deletedAt: null,
			project: { patient: { orgId }, deletedAt: null },
		},
	});
	if (!existing) throw new Error('Ontwerp niet gevonden');

	await prisma.design.update({
		where: { id: designId },
		data: { deletedAt: new Date() },
	});

	return { success: true };
}

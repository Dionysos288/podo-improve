'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';

export interface ProductionLibraryVersion {
	designId: string;
	version: number;
	updatedAt: string;
	hasStl: boolean;
}

export interface ProductionLibraryProject {
	projectId: string;
	projectName: string;
	patientName: string;
	versions: ProductionLibraryVersion[];
}

/**
 * Compact catalog of every project in the org that has at least one saved
 * design version, used by the "Productie -> Toevoegen" picker. Returns only the
 * fields the picker needs (no heavy design JSON), in a single round-trip.
 */
export async function getProductionLibrary(): Promise<ProductionLibraryProject[]> {
	const { orgId } = await requireOrganization();

	const projects = await prisma.project.findMany({
		where: {
			patient: { orgId },
			deletedAt: null,
			designs: { some: { deletedAt: null } },
		},
		select: {
			id: true,
			name: true,
			patient: { select: { firstName: true, lastName: true } },
			designs: {
				where: { deletedAt: null },
				orderBy: { version: 'desc' },
				select: { id: true, version: true, updatedAt: true, stlUrl: true },
			},
		},
		orderBy: { createdAt: 'desc' },
	});

	return projects.map((project) => ({
		projectId: project.id,
		projectName: project.name,
		patientName: `${project.patient.firstName} ${project.patient.lastName}`.trim(),
		versions: project.designs.map((design) => ({
			designId: design.id,
			version: design.version,
			updatedAt: design.updatedAt.toISOString(),
			hasStl: Boolean(design.stlUrl),
		})),
	}));
}

export interface RegenScan {
	footSide: string;
	stlUrl: string;
}

export interface DesignForRegen {
	designId: string;
	projectId: string;
	parameters: Record<string, unknown>;
	elements: unknown[];
	landmarks: Record<string, unknown> | null;
	scanMetadata: Record<string, unknown> | null;
	matchTransform: Record<string, unknown> | null;
	clientSettings: Record<string, unknown> | null;
	scans: RegenScan[];
}

/**
 * Full saved state of one design version plus its project's scans, used to
 * regenerate the insole geometry off the live editing session for a batch
 * milling run. Org-scoped.
 */
export async function getDesignForRegen(designId: string): Promise<DesignForRegen> {
	const { orgId } = await requireOrganization();

	const design = await prisma.design.findFirst({
		where: {
			id: designId,
			deletedAt: null,
			project: { patient: { orgId }, deletedAt: null },
		},
		include: {
			project: {
				select: {
					id: true,
					scans: {
						orderBy: { createdAt: 'desc' },
						select: { footSide: true, stlUrl: true },
					},
				},
			},
		},
	});
	if (!design) throw new Error('Ontwerp niet gevonden');

	return {
		designId: design.id,
		projectId: design.projectId,
		parameters: (design.parameters as Record<string, unknown>) ?? {},
		elements: (design.elements as unknown[]) ?? [],
		landmarks: (design.landmarks as Record<string, unknown> | null) ?? null,
		scanMetadata: (design.scanMetadata as Record<string, unknown> | null) ?? null,
		matchTransform: (design.matchTransform as Record<string, unknown> | null) ?? null,
		clientSettings: (design.clientSettings as Record<string, unknown> | null) ?? null,
		scans: design.project.scans.map((s) => ({
			footSide: String(s.footSide),
			stlUrl: s.stlUrl,
		})),
	};
}

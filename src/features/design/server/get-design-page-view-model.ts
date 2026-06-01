import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import type {
	InitialDesign,
	OrgPrinter,
	ProjectDetail,
} from '@/src/app/[orgSlug]/design/[projectId]/DesignPageClient';
import type { PrinterSettings as OrgPrinterSettings } from '@/src/features/printers/types/printers';

type DesignPageInput = {
	params: Promise<{ orgSlug: string; projectId: string }>;
	searchParams: Promise<{ designId?: string }>;
};

type DesignOpenedUsageEvent = {
	orgId: string;
	userId: string;
	eventType: 'DESIGN_OPENED';
	resourceId: string;
	metadata: Prisma.InputJsonValue;
};

export type DesignPageViewModel = {
	clientProps: {
		project: ProjectDetail;
		orgSlug: string;
		initialDesign: InitialDesign | null;
		orgPrinters: OrgPrinter[];
	};
	usageEvent: DesignOpenedUsageEvent;
};

export const getDesignProjectMetadata = cache(async (projectId: string) => {
	return prisma.project.findUnique({
		where: { id: projectId },
		select: { name: true },
	});
});

export async function getDesignPageViewModel({
	params,
	searchParams,
}: DesignPageInput): Promise<DesignPageViewModel> {
	const [{ orgSlug, projectId }, { designId }] = await Promise.all([
		params,
		searchParams,
	]);
	const { session, orgId } = await requireOrganization();

	const projectPromise = prisma.project.findFirst({
		where: {
			id: projectId,
			deletedAt: null,
			patient: { orgId },
		},
		include: {
			patient: {
				select: {
					firstName: true,
					lastName: true,
				},
			},
			scans: {
				select: {
					id: true,
					name: true,
					pairId: true,
					footSide: true,
					stlUrl: true,
				},
			},
		},
	});
	const slugOrgPromise = prisma.organization.findUnique({
		where: { slug: orgSlug },
		select: { id: true },
	});
	const printersPromise = prisma.printer.findMany({
		where: { orgId },
		orderBy: { createdAt: 'asc' },
		select: { id: true, name: true, brand: true, model: true, settings: true },
	});
	const designPromise = designId
		? prisma.design.findFirst({
				where: { id: designId, projectId, deletedAt: null },
			})
		: prisma.design.findFirst({
				where: { projectId, deletedAt: null },
				orderBy: { version: 'desc' },
			});

	const [project, slugOrg, orgPrintersRaw, initialDesign] = await Promise.all([
		projectPromise,
		slugOrgPromise,
		printersPromise,
		designPromise,
	]);

	if (!project || slugOrg?.id !== orgId) {
		notFound();
	}

	const projectData: ProjectDetail = {
		id: project.id,
		name: project.name,
		patient: {
			firstName: project.patient.firstName,
			lastName: project.patient.lastName,
		},
		scans: project.scans.map((scan) => ({
			id: scan.id,
			name: scan.name,
			pairId: scan.pairId,
			footSide: scan.footSide,
			stlUrl: scan.stlUrl,
		})),
	};

	const orgPrinters = orgPrintersRaw.map((printer) => ({
		id: printer.id,
		name: printer.name,
		brand: printer.brand,
		model: printer.model,
		settings: (printer.settings ?? {}) as OrgPrinterSettings,
	}));

	const serializedDesign: InitialDesign | null = initialDesign
		? {
				id: initialDesign.id,
				projectId: initialDesign.projectId,
				version: initialDesign.version,
				parameters: initialDesign.parameters as Record<string, unknown>,
				elements: initialDesign.elements as unknown[],
				landmarks: initialDesign.landmarks as Record<string, unknown> | null,
				scanMetadata: initialDesign.scanMetadata as Record<string, unknown> | null,
				matchTransform: initialDesign.matchTransform as Record<string, unknown> | null,
				clientSettings: initialDesign.clientSettings as Record<string, unknown> | null,
				stlUrl: initialDesign.stlUrl,
				gcodeUrl: initialDesign.gcodeUrl,
				createdAt: initialDesign.createdAt.toISOString(),
				updatedAt: initialDesign.updatedAt.toISOString(),
			}
		: null;

	return {
		clientProps: {
			project: projectData,
			orgSlug,
			initialDesign: serializedDesign,
			orgPrinters,
		},
		usageEvent: {
			orgId,
			userId: session.user.id,
			eventType: 'DESIGN_OPENED',
			resourceId: initialDesign?.id ?? projectId,
			metadata: {
				projectId,
				designId: initialDesign?.id ?? null,
				openedVersion: initialDesign?.version ?? null,
			},
		},
	};
}

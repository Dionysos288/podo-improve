import { notFound } from 'next/navigation';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireSession } from '@/src/shared/core/auth/get-session';
import { DesignPageClient, type ProjectDetail } from './DesignPageClient';
import type { PrinterSettings as OrgPrinterSettings } from '@/src/features/printers/types/printers';

interface DesignPageProps {
	params: Promise<{ orgSlug: string; projectId: string }>;
	searchParams: Promise<{ designId?: string }>;
}

/**
 * Server Component - prefetches project data before rendering
 * This eliminates the loading spinner and enables SEO
 */
export default async function DesignPage({ params, searchParams }: DesignPageProps) {
	const { orgSlug, projectId } = await params;
	const { designId } = await searchParams;

	// Verify authentication
	await requireSession();

	// Prefetch project data on the server
	const project = await prisma.project.findUnique({
		where: { id: projectId },
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

	if (!project) {
		notFound();
	}

	// Fetch organization printers for default settings
	const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
	const orgPrintersRaw = org
		? await prisma.printer.findMany({
				where: { orgId: org.id },
				orderBy: { createdAt: 'asc' },
				select: { id: true, name: true, brand: true, model: true, settings: true },
			})
		: [];
	const orgPrinters = orgPrintersRaw.map((p) => ({
		id: p.id,
		name: p.name,
		brand: p.brand,
		model: p.model,
		settings: (p.settings ?? {}) as OrgPrinterSettings,
	}));

	// Transform to match client component interface
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

	// Fetch the design if a designId was provided, otherwise get the latest
	let initialDesign = null;
	if (designId) {
		initialDesign = await prisma.design.findFirst({
			where: { id: designId, projectId, deletedAt: null },
		});
	} else {
		// Auto-load the latest design for this project
		initialDesign = await prisma.design.findFirst({
			where: { projectId, deletedAt: null },
			orderBy: { version: 'desc' },
		});
	}

	// Serialize design for client (convert Date objects)
	const serializedDesign = initialDesign
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

	return (
		<DesignPageClient
			project={projectData}
			orgSlug={orgSlug}
			initialDesign={serializedDesign}
			orgPrinters={orgPrinters}
		/>
	);
}

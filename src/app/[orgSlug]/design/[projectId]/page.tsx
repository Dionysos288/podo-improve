import { notFound } from 'next/navigation';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireSession } from '@/src/shared/core/auth/get-session';
import { DesignPageClient, type ProjectDetail } from './DesignPageClient';

interface DesignPageProps {
	params: Promise<{ orgSlug: string; projectId: string }>;
}

/**
 * Server Component - prefetches project data before rendering
 * This eliminates the loading spinner and enables SEO
 */
export default async function DesignPage({ params }: DesignPageProps) {
	const { orgSlug, projectId } = await params;

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
					footSide: true,
					stlUrl: true,
				},
			},
		},
	});

	if (!project) {
		notFound();
	}

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
			footSide: scan.footSide,
			stlUrl: scan.stlUrl,
		})),
	};

	return <DesignPageClient project={projectData} orgSlug={orgSlug} />;
}

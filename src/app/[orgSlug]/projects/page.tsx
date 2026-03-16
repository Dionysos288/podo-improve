import type { Metadata } from 'next';
import { getProjects } from '@/src/features/projects/server/actions';
import { ProjectsClient } from '@/src/features/projects/components/ProjectsClient';
import type { ProjectStatus } from '@prisma/client';

export const metadata: Metadata = {
	title: 'Projecten',
	description: 'Beheer uw zolenprojecten. Bekijk de status, ontwerp en exporteer medische inlegzolen.',
};

interface ProjectsPageProps {
	params: Promise<{ orgSlug: string }>;
	searchParams: Promise<{ status?: string }>;
}

export default async function ProjectsPage({
	params,
	searchParams,
}: ProjectsPageProps) {
	const { orgSlug } = await params;
	const { status } = await searchParams;
	const typedStatus = (status as ProjectStatus | undefined) ?? '';
	const projects = await getProjects();

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-7xl">
				<ProjectsClient
					projects={projects}
					orgSlug={orgSlug}
					initialStatus={typedStatus}
				/>
			</div>
		</div>
	);
}

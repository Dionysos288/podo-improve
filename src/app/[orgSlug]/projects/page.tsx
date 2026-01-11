import { getProjects } from '@/src/features/projects/server/actions';
import { ProjectsClient } from './_components/ProjectsClient';

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
	const projects = await getProjects();

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-7xl">
				<ProjectsClient
					projects={projects}
					orgSlug={orgSlug}
					initialStatus={status}
				/>
			</div>
		</div>
	);
}

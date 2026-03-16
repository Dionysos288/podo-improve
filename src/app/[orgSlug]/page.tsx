import type { Metadata } from 'next';
import { getServerSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';
import { unstable_cache } from 'next/cache';

export const metadata: Metadata = {
	title: 'Dashboard',
	description: 'Overzicht van uw organisatie: patiënten, projecten en recente activiteit.',
};
import {
	StatCard,
	SectionCard,
	SectionHeader,
} from '@/src/shared/components/ui/section-card';
import Link from 'next/link';
import { Users, FolderOpen, Printer, ChevronRight } from 'lucide-react';

// Cache dashboard stats for 60 seconds to reduce database load
const getDashboardStats = unstable_cache(
	async (orgId: string) => {
		const [patientsCount, projectsCount, recentProjects] = await Promise.all([
			prisma.patient.count({
				where: { orgId, deletedAt: null },
			}),
			prisma.project.count({
				where: {
					patient: { orgId },
					deletedAt: null,
				},
			}),
			prisma.project.findMany({
				where: {
					patient: { orgId },
					deletedAt: null,
				},
				include: {
					patient: true,
					doctor: true,
				},
				orderBy: { createdAt: 'desc' },
				take: 5,
			}),
		]);
		return { patientsCount, projectsCount, recentProjects };
	},
	['dashboard-stats'],
	{ revalidate: 60, tags: ['dashboard'] }
);

interface DashboardPageProps {
	params: Promise<{ orgSlug: string }>;
}

export default async function DashboardPage({ params }: DashboardPageProps) {
	const { orgSlug } = await params;
	const session = await getServerSession();

	if (!session) {
		return null;
	}

	// Get the organization
	const organization = await prisma.organization.findUnique({
		where: { slug: orgSlug },
	});

	if (!organization) {
		return null;
	}

	// Get cached dashboard stats
	const { patientsCount, projectsCount, recentProjects } = await getDashboardStats(organization.id);

	const stats = [
		{
			label: 'Patiënten',
			value: patientsCount,
			icon: <Users className="h-6 w-6" />,
			href: `/${orgSlug}/patients`,
		},
		{
			label: 'Projecten',
			value: projectsCount,
			icon: <FolderOpen className="h-6 w-6" />,
			href: `/${orgSlug}/projects`,
		},
		{
			label: 'Printers',
			value: 1,
			icon: <Printer className="h-6 w-6" />,
			href: `/${orgSlug}/settings`,
		},
	];

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-7xl space-y-8">
				{/* Header */}
				<div>
					<h1 className="text-3xl font-bold text-foreground">
						Welkom terug, {session.user.name.split(' ')[0]}
					</h1>
					<p className="mt-2 text-ui-muted">
						Hier is een overzicht van je praktijk
					</p>
				</div>

				{/* Stats grid */}
				<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{stats.map((stat) => (
						<Link key={stat.label} href={stat.href}>
							<StatCard
								icon={stat.icon}
								label={stat.label}
								value={stat.value}
							/>
						</Link>
					))}
				</div>

				{/* Recent projects */}
				<SectionCard>
					<SectionHeader
						title="Recente projecten"
						description="Je laatst gemaakte of bewerkte projecten"
						action={
							<Link
								href={`/${orgSlug}/projects`}
								className="text-sm font-medium text-ui-accent hover:opacity-80"
							>
								Bekijk alles →
							</Link>
						}
					/>
					{recentProjects.length === 0 ? (
						<div className="flex flex-col items-center justify-center rounded-xl bg-ui-overlay/30 py-12">
							<FolderOpen className="mb-3 h-12 w-12 text-ui-muted" />
							<p className="text-center text-sm text-ui-muted">
								Nog geen projecten. Maak een nieuw project aan om te beginnen.
							</p>
						</div>
					) : (
						<div className="space-y-2">
							{recentProjects.map((project) => (
								<Link
									key={project.id}
									href={`/${orgSlug}/projects/${project.id}`}
									className="group flex items-center justify-between rounded-xl border border-ui-border bg-ui-overlay/20 p-4 transition-all hover:border-ui-accent/50 hover:bg-ui-overlay/40"
								>
									<div className="flex-1">
										<p className="font-medium text-foreground">
											{project.name}
										</p>
										<p className="mt-1 text-sm text-ui-muted">
											{project.patient.firstName} {project.patient.lastName}
										</p>
									</div>
									<div className="flex items-center gap-4">
										<div className="text-right">
											<span
												className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
													project.status === 'COMPLETED'
														? 'bg-green-500/10 text-green-400'
														: project.status === 'IN_PROGRESS'
														? 'bg-blue-500/10 text-blue-400'
														: 'bg-ui-overlay text-ui-muted'
												}`}
											>
												{project.status === 'COMPLETED'
													? 'Voltooid'
													: project.status === 'IN_PROGRESS'
													? 'In behandeling'
													: project.status === 'DRAFT'
													? 'Concept'
													: 'Gearchiveerd'}
											</span>
											<p className="mt-1 text-xs text-ui-muted">
												{new Date(project.createdAt).toLocaleDateString(
													'nl-NL'
												)}
											</p>
										</div>
										<ChevronRight className="h-5 w-5 text-ui-muted transition-transform group-hover:translate-x-1" />
									</div>
								</Link>
							))}
						</div>
					)}
				</SectionCard>
			</div>
		</div>
	);
}

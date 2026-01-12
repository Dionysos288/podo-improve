import Link from 'next/link';
import { Button } from '@/src/shared/components/ui/button';
import { getProject } from '@/src/features/projects/server/actions';
import { ArrowLeft, FileBox, Box, Upload } from 'lucide-react';
import { ProjectActions } from '@/src/features/projects/hooks/ProjectActions';
import { notFound } from 'next/navigation';

interface ProjectDetailPageProps {
	params: Promise<{ orgSlug: string; id: string }>;
}

export default async function ProjectDetailPage({
	params,
}: ProjectDetailPageProps) {
	const { orgSlug, id } = await params;

	let project;
	try {
		project = await getProject(id);
	} catch {
		notFound();
	}

	if (!project) {
		notFound();
	}

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-7xl">
				{/* Header */}
				<div className="mb-8">
					<Link
						href={`/${orgSlug}/projects`}
						className="mb-6 inline-flex items-center gap-2 text-sm text-ui-muted transition-colors hover:text-foreground"
					>
						<ArrowLeft className="h-4 w-4" />
						Terug naar projecten
					</Link>
					<div className="flex items-start justify-between">
						<div>
							<h1 className="text-3xl font-bold text-foreground">
								{project.name}
							</h1>
							<p className="mt-2 text-ui-muted">
								{project.patient.firstName} {project.patient.lastName}
								{project.doctor && ` • ${project.doctor.name}`}
							</p>
						</div>
						<ProjectActions
							projectId={id}
							projectStatus={project.status}
							orgSlug={orgSlug}
							currentName={project.name}
							currentDoctorId={project.doctor?.id || null}
						/>
					</div>
				</div>

				<div className="grid gap-8 lg:grid-cols-3">
					{/* Project info */}
					<div className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6">
						<h2 className="mb-6 text-xl font-semibold text-foreground">
							Projectgegevens
						</h2>
						<div className="space-y-6">
							<div>
								<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ui-muted">
									Status
								</p>
								<p className="text-foreground">
									{project.status === 'COMPLETED'
										? 'Voltooid'
										: project.status === 'IN_PROGRESS'
											? 'In behandeling'
											: project.status === 'DRAFT'
												? 'Concept'
												: 'Gearchiveerd'}
								</p>
							</div>
							<div>
								<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ui-muted">
									Patiënt
								</p>
								<Link
									href={`/${orgSlug}/patients/${project.patient.id}`}
									className="text-ui-accent transition-opacity hover:opacity-80"
								>
									{project.patient.firstName} {project.patient.lastName}
								</Link>
							</div>
							{project.doctor && (
								<div>
									<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ui-muted">
										Behandelaar
									</p>
									<p className="text-foreground">{project.doctor.name}</p>
								</div>
							)}
							<div>
								<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ui-muted">
									Datum
								</p>
								<p className="text-foreground">
									{new Date(project.date).toLocaleDateString('nl-NL')}
								</p>
							</div>
							<div>
								<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ui-muted">
									Aangemaakt op
								</p>
								<p className="text-foreground">
									{new Date(project.createdAt).toLocaleDateString('nl-NL')}
								</p>
							</div>
						</div>
					</div>

					{/* Scans */}
					<div className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6">
						<div className="mb-6 flex items-center justify-between">
							<h2 className="flex items-center gap-3 text-xl font-semibold text-foreground">
								<div className="rounded-xl bg-ui-accent/10 p-2">
									<FileBox className="h-5 w-5 text-ui-accent" />
								</div>
								Scans ({project.scans.length})
							</h2>
							<Link href={`/${orgSlug}/design/${id}`}>
								<Button className="flex items-center gap-2 rounded-xl bg-ui-accent px-4 py-2 text-sm font-medium text-slate-900 transition-colors">
									<Upload className="h-4 w-4" />
									Upload scans
								</Button>
							</Link>
						</div>
						{project.scans.length === 0 ? (
							<div className="flex flex-col items-center justify-center rounded-xl bg-ui-overlay/30 py-12">
								<div className="mb-4 rounded-full bg-ui-overlay p-4">
									<FileBox className="h-8 w-8 text-ui-muted" />
								</div>
								<p className="text-center text-ui-muted">
									Nog geen scans. Upload scans in de ontwerpmodus.
								</p>
							</div>
						) : (
							<div className="space-y-3">
								{project.scans.map((scan) => (
									<div
										key={scan.id}
										className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-overlay/20 p-4"
									>
										<div className="flex items-center gap-4">
											<div
												className={`flex h-12 w-12 items-center justify-center rounded-xl font-semibold ${
													scan.footSide === 'LEFT'
														? 'bg-blue-500/10 text-blue-400'
														: 'bg-purple-500/10 text-purple-400'
												}`}
											>
												{scan.footSide === 'LEFT' ? 'L' : 'R'}
											</div>
											<div>
												<p className="font-medium text-foreground">
													{scan.footSide === 'LEFT'
														? 'Linkervoet'
														: 'Rechtervoet'}
												</p>
												<p className="mt-1 text-xs text-ui-muted">
													{new Date(scan.createdAt).toLocaleDateString('nl-NL')}
												</p>
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</div>

					{/* Designs */}
					<div className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6">
						<h2 className="mb-6 flex items-center gap-3 text-xl font-semibold text-foreground">
							<div className="rounded-xl bg-ui-accent/10 p-2">
								<Box className="h-5 w-5 text-ui-accent" />
							</div>
							Ontwerpen ({project.designs.length})
						</h2>
						{project.designs.length === 0 ? (
							<div className="flex flex-col items-center justify-center rounded-xl bg-ui-overlay/30 py-12">
								<div className="mb-4 rounded-full bg-ui-overlay p-4">
									<Box className="h-8 w-8 text-ui-muted" />
								</div>
								<p className="mb-4 text-center text-ui-muted">
									Nog geen ontwerpen.
								</p>
								<Link href={`/${orgSlug}/design/${id}`}>
									<Button className="rounded-xl bg-ui-accent px-5 py-2.5 text-sm font-medium text-slate-900 transition-colors">
										Start ontwerpen
									</Button>
								</Link>
							</div>
						) : (
							<div className="space-y-3">
								{project.designs.map((design) => (
									<Link
										key={design.id}
										href={`/${orgSlug}/design/${id}`}
										className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-overlay/20 p-4 transition-colors hover:border-ui-accent/50 hover:bg-ui-overlay/40"
									>
										<div>
											<p className="font-medium text-foreground">
												Versie {design.version}
											</p>
											<p className="mt-1 text-xs text-ui-muted">
												{new Date(design.createdAt).toLocaleDateString('nl-NL')}
											</p>
										</div>
										{design.stlUrl && (
											<span className="rounded-xl bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-400">
												Geëxporteerd
											</span>
										)}
									</Link>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

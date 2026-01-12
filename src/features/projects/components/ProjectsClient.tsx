'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Search, FolderOpen, Plus } from 'lucide-react';
import { CreateProjectModal } from './CreateProjectModal';
import type { ProjectStatus } from '@prisma/client';
import type { ProjectsClientProps } from '@/src/features/projects/types/types';

const statusFilters = [
	{ value: '', label: 'Alle' },
	{ value: 'DRAFT', label: 'Concept' },
	{ value: 'IN_PROGRESS', label: 'In behandeling' },
	{ value: 'COMPLETED', label: 'Voltooid' },
	{ value: 'ARCHIVED', label: 'Gearchiveerd' },
];

export function ProjectsClient({
	projects,
	orgSlug,
	initialStatus = '',
}: ProjectsClientProps) {
	const [searchQuery, setSearchQuery] = useState('');
	const [statusFilter, setStatusFilter] = useState<ProjectStatus | ''>(
		initialStatus
	);
	const [showCreateModal, setShowCreateModal] = useState(false);

	const filteredProjects = projects.filter((project) => {
		const searchText =
			`${project.name} ${project.patient.firstName} ${project.patient.lastName}`.toLowerCase();
		const matchesSearch = searchText.includes(searchQuery.toLowerCase());
		const matchesStatus = !statusFilter || project.status === statusFilter;
		return matchesSearch && matchesStatus;
	});

	return (
		<>
			<div className="mb-8 flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold text-foreground">Projecten</h1>
					<p className="mt-2 text-ui-muted">Overzicht van alle projecten</p>
				</div>
				<Button
					onClick={() => setShowCreateModal(true)}
					className="flex items-center gap-2 rounded-xl bg-ui-accent px-5 py-2.5 font-medium text-slate-900 transition-colors"
				>
					<Plus className="h-5 w-5" />
					Nieuw project
				</Button>
			</div>

			{/* Filters */}
			<div className="mb-8 flex flex-col gap-4 sm:flex-row">
				<div className="relative flex-1">
					<Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ui-muted" />
					<Input
						type="text"
						placeholder="Zoek projecten..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full rounded-xl border border-ui-border bg-ui-card py-3 pl-12 pr-4 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-2 focus:ring-ui-accent/20"
					/>
				</div>
				<div className="flex flex-wrap gap-2">
					{statusFilters.map((filter) => (
						<button
							key={filter.value}
							onClick={() =>
								setStatusFilter(filter.value as ProjectStatus | '')
							}
							className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
								statusFilter === filter.value
									? 'bg-ui-accent text-slate-900 shadow-lg shadow-ui-accent/20'
									: 'border border-ui-border text-ui-muted hover:border-ui-accent/50 hover:text-foreground'
							}`}
						>
							{filter.label}
						</button>
					))}
				</div>
			</div>

			{/* Projects list */}
			{filteredProjects.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-2xl border border-ui-border bg-ui-card p-12">
					<div className="mb-4 rounded-full bg-ui-overlay p-4">
						<FolderOpen className="h-8 w-8 text-ui-muted" />
					</div>
					<p className="text-center text-ui-muted">
						{searchQuery || statusFilter
							? 'Geen projecten gevonden'
							: 'Nog geen projecten. Maak een nieuw project aan bij een patiënt.'}
					</p>
				</div>
			) : (
				<div className="space-y-6">
					{filteredProjects.map((project) => (
						<Link
							key={project.id}
							href={`/${orgSlug}/projects/${project.id}`}
							className="block"
						>
							<div className="group rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6 transition-all hover:border-ui-accent/50 hover:shadow-lg hover:shadow-ui-accent/5">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-4">
										<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-ui-accent/10">
											<FolderOpen className="h-7 w-7 text-ui-accent" />
										</div>
										<div>
											<p className="text-lg font-semibold text-foreground">
												{project.name}
											</p>
											<p className="mt-1 text-sm text-ui-muted">
												{project.patient.firstName} {project.patient.lastName}
												{project.doctor && ` • ${project.doctor.name}`}
											</p>
										</div>
									</div>
									<div className="flex items-center gap-6">
										<div className="text-right">
											<p className="text-sm font-medium text-foreground">
												{project.scansCount} scan
												{project.scansCount !== 1 ? 's' : ''}
											</p>
											<p className="mt-1 text-xs text-ui-muted">
												{new Date(project.date).toLocaleDateString('nl-NL')}
											</p>
										</div>
										<span
											className={`rounded-xl px-4 py-2 text-xs font-medium ${
												project.status === 'COMPLETED'
													? 'bg-green-500/10 text-green-400'
													: project.status === 'IN_PROGRESS'
														? 'bg-blue-500/10 text-blue-400'
														: project.status === 'DRAFT'
															? 'bg-ui-overlay text-ui-muted'
															: 'bg-orange-500/10 text-orange-400'
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
									</div>
								</div>
							</div>
						</Link>
					))}
				</div>
			)}

			<CreateProjectModal
				open={showCreateModal}
				onClose={() => setShowCreateModal(false)}
				orgSlug={orgSlug}
			/>
		</>
	);
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Select } from '@/src/shared/components/ui/select';
import { Trash2, Pencil } from 'lucide-react';
import {
	deleteProject,
	updateProject,
} from '@/src/features/projects/server/actions';
import { useOrganizationMembers } from '@/src/features/organizations/hooks/use-organization';
import type { ProjectStatus } from '@prisma/client';
import type {
	ProjectActionsProps,
	Member,
} from '@/src/features/projects/types/types';

const PROJECT_STATUS_OPTIONS = [
	{ value: 'DRAFT', label: 'Concept' },
	{ value: 'IN_PROGRESS', label: 'In behandeling' },
	{ value: 'COMPLETED', label: 'Voltooid' },
	{ value: 'ARCHIVED', label: 'Gearchiveerd' },
];

export function ProjectActions({
	projectId,
	projectStatus,
	orgSlug,
	currentName,
	currentDoctorId,
}: ProjectActionsProps) {
	const router = useRouter();
	const { data: members, isLoading: isLoadingMembers } =
		useOrganizationMembers();
	const [showEditModal, setShowEditModal] = useState(false);
	const [projectName, setProjectName] = useState(currentName);
	const [selectedDoctorId, setSelectedDoctorId] = useState(
		currentDoctorId || ''
	);
	const [isUpdating, setIsUpdating] = useState(false);
	const [isCreatingDesign, setIsCreatingDesign] = useState(false);

	useEffect(() => {
		if (currentDoctorId) {
			setSelectedDoctorId(currentDoctorId);
		}
	}, [currentDoctorId]);

	const handleDelete = async () => {
		if (!confirm('Weet je zeker dat je dit project wilt verwijderen?')) return;
		try {
			await deleteProject(projectId);
			router.push(`/${orgSlug}/projects`);
		} catch (error) {
			console.error('Failed to delete project:', error);
		}
	};

	const handleStatusChange = async (status: ProjectStatus) => {
		try {
			await updateProject(projectId, { status });
			router.refresh();
		} catch (error) {
			console.error('Failed to update status:', error);
		}
	};

	const handleUpdate = async () => {
		setIsUpdating(true);
		try {
			await updateProject(projectId, {
				name: projectName,
				doctorId: selectedDoctorId || undefined,
			});
			setShowEditModal(false);
			router.refresh();
		} catch (error) {
			console.error('Failed to update project:', error);
		} finally {
			setIsUpdating(false);
		}
	};

	const handleCreateDesign = async () => {
		setIsCreatingDesign(true);
		try {
			const response = await fetch(`/api/projects/${projectId}/designs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});

			if (!response.ok) {
				const data = await response.json().catch(() => ({}));
				throw new Error(data.error || 'Nieuw ontwerp aanmaken mislukt');
			}

			const design = await response.json();
			router.push(`/${orgSlug}/design/${projectId}?designId=${design.id}`);
		} catch (error) {
			console.error('Failed to create design:', error);
		} finally {
			setIsCreatingDesign(false);
		}
	};

	return (
		<>
			<div className="flex items-center gap-3">
				<Select
					value={projectStatus}
					onChange={(val) => handleStatusChange(val as ProjectStatus)}
					options={PROJECT_STATUS_OPTIONS}
					className="min-w-[180px]"
					size="md"
				/>
				<Button
					onClick={handleCreateDesign}
					disabled={isCreatingDesign}
					className="flex items-center gap-2 rounded-xl bg-ui-accent px-5 py-2.5 font-medium text-slate-900 transition-colors disabled:opacity-50"
				>
					{isCreatingDesign ? 'Ontwerp maken...' : 'Ontwerpen'}
				</Button>
				<button
					onClick={() => setShowEditModal(true)}
					className="rounded-xl p-3 text-ui-muted transition-colors hover:bg-ui-card hover:text-foreground"
					title="Bewerken"
				>
					<Pencil className="h-5 w-5" />
				</button>
				<button
					onClick={handleDelete}
					className="rounded-xl p-3 text-ui-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
					title="Verwijderen"
				>
					<Trash2 className="h-5 w-5" />
				</button>
			</div>

			{/* Edit Project Modal */}
			{showEditModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
					<div className="w-full max-w-md rounded-2xl border border-ui-border bg-ui-panel p-8 shadow-2xl">
						<h2 className="mb-6 text-2xl font-bold text-foreground">
							Project bewerken
						</h2>
						<div className="space-y-6">
							<div className="space-y-2">
								<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
									Projectnaam
								</label>
								<Input
									variant="dark"
									type="text"
									value={projectName}
									onChange={(e) => setProjectName(e.target.value)}
									className="rounded-xl px-4 py-3"
								/>
							</div>
							{isLoadingMembers ? (
								<div className="space-y-2">
									<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
										Behandelaar
									</label>
									<div className="rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-sm text-ui-muted">
										Laden...
									</div>
								</div>
							) : (
								<Select
									label="Behandelaar"
									value={selectedDoctorId}
									onChange={setSelectedDoctorId}
									placeholder="Geen behandelaar"
									options={[
										{ value: '', label: 'Geen behandelaar' },
										...(members?.map((member: Member) => ({
											value: member.id,
											label: member.name,
										})) ?? []),
									]}
								/>
							)}
							<div className="flex gap-3 pt-4">
								<Button
									onClick={() => setShowEditModal(false)}
									variant="outline"
									className="flex-1 rounded-xl border border-ui-border py-3 font-medium text-foreground transition-colors hover:bg-ui-overlay"
								>
									Annuleren
								</Button>
								<Button
									onClick={handleUpdate}
									disabled={isUpdating || !projectName}
									className="flex-1 rounded-xl bg-ui-accent py-3 font-semibold text-slate-900 transition-colors disabled:opacity-50"
								>
									{isUpdating ? 'Bezig...' : 'Opslaan'}
								</Button>
							</div>
						</div>
					</div>
				</div>
			)}
		</>
	);
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/shared/components/ui/button';
import { Trash2, Plus, Pencil } from 'lucide-react';
import {
	deletePatient,
	updatePatient,
} from '@/src/features/patients/server/actions';
import { CreateProjectModal } from '@/src/features/projects/components/CreateProjectModal';
import { Input } from '@/src/shared/components/ui/input';

interface PatientActionsProps {
	patientId: string;
	patientName: string;
	orgSlug: string;
	currentFirstName: string;
	currentLastName: string;
	currentBirthDate: Date | null;
	currentNotes: string | null;
}

export function PatientActions({
	patientId,
	patientName,
	orgSlug,
	currentFirstName,
	currentLastName,
	currentBirthDate,
	currentNotes,
}: PatientActionsProps) {
	const router = useRouter();
	const [showCreateProject, setShowCreateProject] = useState(false);
	const [showEditModal, setShowEditModal] = useState(false);
	const [firstName, setFirstName] = useState(currentFirstName);
	const [lastName, setLastName] = useState(currentLastName);
	const [birthDate, setBirthDate] = useState(
		currentBirthDate
			? new Date(currentBirthDate).toISOString().split('T')[0]
			: ''
	);
	const [notes, setNotes] = useState(currentNotes || '');
	const [isUpdating, setIsUpdating] = useState(false);

	const handleDelete = async () => {
		if (!confirm('Weet je zeker dat je deze patiënt wilt verwijderen?')) return;
		try {
			await deletePatient(patientId);
			router.push(`/${orgSlug}/patients`);
		} catch (error) {
			console.error('Failed to delete patient:', error);
		}
	};

	const handleUpdate = async () => {
		setIsUpdating(true);
		try {
			await updatePatient(patientId, {
				firstName,
				lastName,
				birthDate: birthDate ? new Date(birthDate) : null,
				notes: notes || null,
			});
			setShowEditModal(false);
			router.refresh();
		} catch (error) {
			console.error('Failed to update patient:', error);
		} finally {
			setIsUpdating(false);
		}
	};

	return (
		<>
			<div className="flex items-center gap-3">
				<Button
					onClick={() => setShowCreateProject(true)}
					className="flex items-center gap-2 rounded-xl bg-ui-accent px-5 py-2.5 font-medium text-slate-900 transition-colors"
				>
					<Plus className="h-4 w-4" />
					Nieuw project
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

			<CreateProjectModal
				open={showCreateProject}
				onClose={() => setShowCreateProject(false)}
				patientId={patientId}
				patientName={patientName}
				orgSlug={orgSlug}
			/>

			{/* Edit Patient Modal */}
			{showEditModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
					<div className="w-full max-w-md rounded-2xl border border-ui-border bg-ui-panel p-8 shadow-2xl">
						<h2 className="mb-6 text-2xl font-bold text-foreground">
							Patiënt bewerken
						</h2>
						<div className="space-y-4">
							<div className="space-y-2">
								<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
									Voornaam
								</label>
								<Input
									type="text"
									value={firstName}
									onChange={(e) => setFirstName(e.target.value)}
									className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-foreground"
								/>
							</div>
							<div className="space-y-2">
								<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
									Achternaam
								</label>
								<Input
									type="text"
									value={lastName}
									onChange={(e) => setLastName(e.target.value)}
									className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-foreground"
								/>
							</div>
							<div className="space-y-2">
								<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
									Geboortedatum
								</label>
								<Input
									type="date"
									value={birthDate}
									onChange={(e) => setBirthDate(e.target.value)}
									className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-foreground"
								/>
							</div>
							<div className="space-y-2">
								<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
									Notities
								</label>
								<textarea
									value={notes}
									onChange={(e) => setNotes(e.target.value)}
									rows={3}
									className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-foreground resize-none"
								/>
							</div>
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
									disabled={isUpdating || !firstName || !lastName}
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

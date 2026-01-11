'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { createPatient } from '@/src/features/patients/server/actions';

interface CreatePatientModalProps {
	open: boolean;
	onClose: () => void;
}

export function CreatePatientModal({ open, onClose }: CreatePatientModalProps) {
	const router = useRouter();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [newPatient, setNewPatient] = useState({
		firstName: '',
		lastName: '',
		birthDate: '',
		notes: '',
	});

	if (!open) return null;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsSubmitting(true);

		try {
			await createPatient({
				firstName: newPatient.firstName,
				lastName: newPatient.lastName,
				birthDate: newPatient.birthDate || undefined,
				notes: newPatient.notes || undefined,
			});
			setNewPatient({ firstName: '', lastName: '', birthDate: '', notes: '' });
			onClose();
			router.refresh();
		} catch (error) {
			console.error('Failed to create patient:', error);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="ui-panel w-full max-w-md rounded-2xl p-6">
				<h2 className="mb-4 text-xl font-semibold text-foreground">
					Nieuwe patiënt
				</h2>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<label className="text-xs uppercase tracking-wide text-ui-muted">
								Voornaam
							</label>
							<Input
								type="text"
								value={newPatient.firstName}
								onChange={(e) =>
									setNewPatient({ ...newPatient, firstName: e.target.value })
								}
								required
								className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground"
							/>
						</div>
						<div className="space-y-2">
							<label className="text-xs uppercase tracking-wide text-ui-muted">
								Achternaam
							</label>
							<Input
								type="text"
								value={newPatient.lastName}
								onChange={(e) =>
									setNewPatient({ ...newPatient, lastName: e.target.value })
								}
								required
								className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground"
							/>
						</div>
					</div>
					<div className="space-y-2">
						<label className="text-xs uppercase tracking-wide text-ui-muted">
							Geboortedatum
						</label>
						<Input
							type="date"
							value={newPatient.birthDate}
							onChange={(e) =>
								setNewPatient({ ...newPatient, birthDate: e.target.value })
							}
							className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground"
						/>
					</div>
					<div className="space-y-2">
						<label className="text-xs uppercase tracking-wide text-ui-muted">
							Notities
						</label>
						<textarea
							value={newPatient.notes}
							onChange={(e) =>
								setNewPatient({ ...newPatient, notes: e.target.value })
							}
							rows={3}
							className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground"
						/>
					</div>
					<div className="flex gap-3 pt-2">
						<Button
							type="button"
							onClick={onClose}
							variant="outline"
							className="flex-1 rounded-lg border border-ui-border py-2 text-foreground"
						>
							Annuleren
						</Button>
						<Button
							type="submit"
							disabled={isSubmitting}
							className="flex-1 rounded-lg bg-ui-accent py-2 font-medium text-slate-900"
						>
							{isSubmitting ? 'Opslaan...' : 'Opslaan'}
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}

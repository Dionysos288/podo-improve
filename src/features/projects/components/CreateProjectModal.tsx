'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Select } from '@/src/shared/components/ui/select';
import { createProject } from '@/src/features/projects/server/actions';
import { getPatients } from '@/src/features/patients/server/actions';
import { useOrganizationMembers } from '@/src/features/organizations/hooks/use-organization';
import { useSession } from '@/src/shared/core/auth/auth-client';
import type {
	CreateProjectModalProps,
	PatientOption,
	Member,
} from '@/src/features/projects/types/types';

export function CreateProjectModal({
	open,
	onClose,
	orgSlug,
	patientId: initialPatientId,
	patientName: initialPatientName,
}: CreateProjectModalProps) {
	const router = useRouter();
	const { data: session } = useSession();
	const { data: members, isLoading: isLoadingMembers } =
		useOrganizationMembers();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [projectName, setProjectName] = useState('');
	const [selectedPatientId, setSelectedPatientId] = useState(
		initialPatientId || ''
	);
	const [selectedDoctorId, setSelectedDoctorId] = useState('');
	const [patients, setPatients] = useState<PatientOption[]>([]);
	const [isLoadingPatients, setIsLoadingPatients] = useState(false);

	const isPatientPreselected = !!initialPatientId;

	// Set default doctor to current user when members load
	useEffect(() => {
		if (members && session?.user?.id && !selectedDoctorId) {
			const currentUserMember = members.find(
				(m: Member) => m.id === session.user.id
			);
			if (currentUserMember) {
				setSelectedDoctorId(currentUserMember.id);
			} else if (members.length > 0) {
				setSelectedDoctorId(members[0].id);
			}
		}
	}, [members, session, selectedDoctorId]);

	useEffect(() => {
		if (open && !isPatientPreselected) {
			setIsLoadingPatients(true);
			getPatients()
				.then((data) => {
					setPatients(data);
					if (data.length > 0) {
						setSelectedPatientId(data[0].id);
					}
				})
				.catch((error) => {
					console.error('Failed to load patients:', error);
				})
				.finally(() => {
					setIsLoadingPatients(false);
				});
		}
	}, [open, isPatientPreselected]);

	if (!open) return null;

	const selectedPatient = isPatientPreselected
		? {
				id: initialPatientId!,
				firstName: initialPatientName?.split(' ')[0] || '',
				lastName: initialPatientName?.split(' ').slice(1).join(' ') || '',
			}
		: patients.find((p) => p.id === selectedPatientId);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const finalPatientId = isPatientPreselected
			? initialPatientId!
			: selectedPatientId;
		if (!finalPatientId) return;

		setIsSubmitting(true);

		try {
			const projectNameFallback = isPatientPreselected
				? `Project voor ${initialPatientName}`
				: `Project voor ${selectedPatient?.firstName} ${selectedPatient?.lastName}`;

			const project = await createProject({
				patientId: finalPatientId,
				name: projectName || projectNameFallback,
				doctorId: selectedDoctorId || undefined,
			});
			setProjectName('');
			if (!isPatientPreselected) {
				setSelectedPatientId('');
			}
			setSelectedDoctorId(session?.user?.id || '');
			onClose();
			router.push(`/${orgSlug}/projects/${project.id}`);
		} catch (error) {
			console.error('Failed to create project:', error);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
			<div className="w-full max-w-md rounded-2xl border border-ui-border bg-ui-panel p-8 shadow-2xl">
				<h2 className="mb-6 text-2xl font-bold text-foreground">
					Nieuw project
				</h2>
				<form onSubmit={handleSubmit} className="space-y-6">
					{!isPatientPreselected &&
						(isLoadingPatients ? (
							<div className="space-y-2">
								<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
									Patiënt
								</label>
								<div className="rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-sm text-ui-muted">
									Laden...
								</div>
							</div>
						) : (
							<Select
								label="Patiënt"
								value={selectedPatientId}
								onChange={setSelectedPatientId}
								placeholder="Selecteer een patiënt"
								options={patients.map((patient) => ({
									value: patient.id,
									label: `${patient.firstName} ${patient.lastName}`,
								}))}
							/>
						))}
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
							placeholder="Selecteer een behandelaar"
							options={
								members?.map((member: Member) => ({
									value: member.id,
									label: member.name,
								})) ?? []
							}
						/>
					)}
					<div className="space-y-2">
						<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
							Projectnaam
						</label>
						<Input
							variant="dark"
							type="text"
							value={projectName}
							onChange={(e) => setProjectName(e.target.value)}
							placeholder={
								isPatientPreselected
									? `Project voor ${initialPatientName}`
									: selectedPatient
										? `Project voor ${selectedPatient.firstName} ${selectedPatient.lastName}`
										: 'Projectnaam'
							}
							className="rounded-xl px-4 py-3"
						/>
					</div>
					<div className="flex gap-3 pt-4">
						<Button
							type="button"
							onClick={onClose}
							variant="outline"
							className="flex-1 rounded-xl border border-ui-border py-3 font-medium text-foreground transition-colors hover:bg-ui-overlay"
						>
							Annuleren
						</Button>
						<Button
							type="submit"
							disabled={
								isSubmitting ||
								(!isPatientPreselected && !selectedPatientId) ||
								!selectedDoctorId ||
								(!isPatientPreselected && isLoadingPatients) ||
								isLoadingMembers
							}
							className="flex-1 rounded-xl bg-ui-accent py-3 font-semibold text-slate-900 transition-colors disabled:opacity-50"
						>
							{isSubmitting ? 'Aanmaken...' : 'Aanmaken'}
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { createProject } from '@/src/features/projects/server/actions';
import { useOrganizationMembers } from '@/src/features/organizations/hooks/use-organization';
import { useSession } from '@/src/shared/core/auth/auth-client';

interface CreateProjectModalProps {
	open: boolean;
	onClose: () => void;
	patientId: string;
	patientName: string;
	orgSlug: string;
}

interface Member {
	id: string;
	name: string;
	email: string;
}

export function CreateProjectModal({
	open,
	onClose,
	patientId,
	patientName,
	orgSlug,
}: CreateProjectModalProps) {
	const router = useRouter();
	const { data: session } = useSession();
	const { data: members, isLoading: isLoadingMembers } = useOrganizationMembers();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [projectName, setProjectName] = useState('');
	const [selectedDoctorId, setSelectedDoctorId] = useState('');

	// Set default doctor to current user when members load
	useEffect(() => {
		if (members && session?.user?.id && !selectedDoctorId) {
			const currentUserMember = members.find((m: Member) => m.id === session.user.id);
			if (currentUserMember) {
				setSelectedDoctorId(currentUserMember.id);
			} else if (members.length > 0) {
				setSelectedDoctorId(members[0].id);
			}
		}
	}, [members, session, selectedDoctorId]);

	if (!open) return null;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsSubmitting(true);

		try {
			const project = await createProject({
				patientId,
				name: projectName || `Project voor ${patientName}`,
				doctorId: selectedDoctorId || undefined,
			});
			setProjectName('');
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
				<h2 className="mb-6 text-2xl font-bold text-foreground">Nieuw project</h2>
				<form onSubmit={handleSubmit} className="space-y-6">
						<div className="space-y-2">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Behandelaar
							</label>
							{isLoadingMembers ? (
								<div className="rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-sm text-ui-muted">
									Laden...
								</div>
							) : (
								<select
									value={selectedDoctorId}
									onChange={(e) => setSelectedDoctorId(e.target.value)}
									className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 pr-12 text-sm font-medium text-foreground transition-colors focus:border-ui-accent focus:outline-none focus:ring-2 focus:ring-ui-accent/20"
									required
								>
									<option value="">Selecteer een behandelaar</option>
									{members?.map((member: Member) => (
										<option key={member.id} value={member.id}>
											{member.name}
										</option>
									))}
								</select>
							)}
						</div>
						<div className="space-y-2">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Projectnaam
							</label>
							<Input
								type="text"
								value={projectName}
								onChange={(e) => setProjectName(e.target.value)}
								placeholder={`Project voor ${patientName}`}
								className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-2 focus:ring-ui-accent/20"
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
								disabled={isSubmitting || !selectedDoctorId || isLoadingMembers}
								className="flex-1 rounded-xl bg-ui-accent py-3 font-semibold text-slate-900 transition-colors disabled:opacity-50"
							>
								{isSubmitting ? 'Aanmaken...' : 'Aanmaken'}
							</Button>
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}

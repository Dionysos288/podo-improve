'use client';

// Extracted from /[orgSlug]/admin so we can reuse it inside Settings > Gebruikers

import { useState } from 'react';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { InlineSelect } from '@/src/shared/components/ui/select';
import {
	useOrganizationMembers,
	useUpdateMemberRole,
	useRemoveMember,
} from '@/src/features/organizations/hooks/use-organization';
import {
	useInvitations,
	useCreateInvitation,
	useRevokeInvitation,
} from '@/src/features/invitations/hooks/use-invitations';
import { Users, Mail, Key, Trash2, Shield, User } from 'lucide-react';

interface Member {
	id: string;
	name: string;
	email: string;
	role: 'ADMIN' | 'DOCTOR';
	createdAt: Date;
}

interface Invitation {
	id: string;
	code: string | null;
	email: string | null;
	role: 'ADMIN' | 'DOCTOR';
	expiresAt: Date;
	createdAt: Date;
	invitedByName: string;
	isExpired: boolean;
}

export function AdminPanel() {
	const [showInviteModal, setShowInviteModal] = useState(false);
	const [inviteType, setInviteType] = useState<'email' | 'code'>('code');
	const [inviteEmail, setInviteEmail] = useState('');
	const [inviteRole, setInviteRole] = useState<'ADMIN' | 'DOCTOR'>('DOCTOR');
	const [createdCode, setCreatedCode] = useState<string | null>(null);

	const { data: members, isLoading: membersLoading } = useOrganizationMembers();
	const { data: invitations, isLoading: invitationsLoading } = useInvitations();

	const updateRole = useUpdateMemberRole();
	const removeMember = useRemoveMember();
	const createInvitation = useCreateInvitation();
	const revokeInvitation = useRevokeInvitation();

	const handleCreateInvitation = async () => {
		try {
			const result = await createInvitation.mutateAsync({
				type: inviteType,
				email: inviteType === 'email' ? inviteEmail : undefined,
				role: inviteRole,
			});
			if (inviteType === 'code') {
				setCreatedCode(result.code || null);
			} else {
				setShowInviteModal(false);
				setInviteEmail('');
			}
		} catch (error) {
			console.error('Failed to create invitation:', error);
		}
	};

	const handleRoleChange = async (
		userId: string,
		newRole: 'ADMIN' | 'DOCTOR'
	) => {
		try {
			await updateRole.mutateAsync({ userId, role: newRole });
		} catch (error) {
			console.error('Failed to update role:', error);
		}
	};

	const handleRemoveMember = async (userId: string) => {
		if (!confirm('Weet je zeker dat je dit lid wilt verwijderen?')) return;
		try {
			await removeMember.mutateAsync(userId);
		} catch (error) {
			console.error('Failed to remove member:', error);
		}
	};

	const handleRevokeInvitation = async (invitationId: string) => {
		if (!confirm('Weet je zeker dat je deze uitnodiging wilt intrekken?'))
			return;
		try {
			await revokeInvitation.mutateAsync(invitationId);
		} catch (error) {
			console.error('Failed to revoke invitation:', error);
		}
	};

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold text-foreground">Gebruikers</h2>
				<p className="mt-2 text-sm text-ui-muted">
					Beheer leden en uitnodigingen voor je organisatie.
				</p>
			</div>

			<div className="grid gap-8 lg:grid-cols-2">
				{/* Members */}
				<div className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6">
					<div className="mb-6 flex items-center justify-between">
						<h3 className="flex items-center gap-3 text-lg font-semibold text-foreground">
							<div className="rounded-xl bg-ui-accent/10 p-2">
								<Users className="h-5 w-5 text-ui-accent" />
							</div>
							Leden ({members?.length || 0})
						</h3>
					</div>
					{membersLoading ? (
						<div className="py-8 text-center text-ui-muted">Laden...</div>
					) : members?.length === 0 ? (
						<div className="flex flex-col items-center justify-center rounded-xl bg-ui-overlay/30 py-12">
							<div className="mb-4 rounded-full bg-ui-overlay p-4">
								<Users className="h-8 w-8 text-ui-muted" />
							</div>
							<p className="text-center text-ui-muted">Geen leden</p>
						</div>
					) : (
						<div className="space-y-3">
							{members?.map((member: Member) => (
								<div
									key={member.id}
									className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-overlay/20 p-4"
								>
									<div className="flex items-center gap-4">
										<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ui-accent/10 text-sm font-semibold text-ui-accent">
											{member.name
												.split(' ')
												.map((n: string) => n[0])
												.join('')
												.toUpperCase()
												.slice(0, 2)}
										</div>
										<div className="min-w-0">
											<p className="font-semibold text-foreground">
												{member.name}
											</p>
											<p className="mt-1 text-sm text-ui-muted">
												{member.email}
											</p>
										</div>
									</div>
									<div className="flex items-center gap-3">
										<InlineSelect
											value={member.role}
											onChange={(val) =>
												handleRoleChange(member.id, val as 'ADMIN' | 'DOCTOR')
											}
											options={[
												{ value: 'ADMIN', label: 'Beheerder' },
												{ value: 'DOCTOR', label: 'Medewerker' },
											]}
										/>
										<button
											onClick={() => handleRemoveMember(member.id)}
											className="rounded-xl p-2.5 text-ui-muted transition-all hover:bg-red-500/10 hover:text-red-400"
											title="Verwijderen"
										>
											<Trash2 className="h-5 w-5" />
										</button>
									</div>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Invitations */}
				<div className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6">
					<div className="mb-6 flex items-center justify-between">
						<h3 className="flex items-center gap-3 text-lg font-semibold text-foreground">
							<div className="rounded-xl bg-ui-accent/10 p-2">
								<Mail className="h-5 w-5 text-ui-accent" />
							</div>
							Uitnodigingen
						</h3>
						<Button
							onClick={() => {
								setShowInviteModal(true);
								setCreatedCode(null);
							}}
							className="rounded-xl bg-ui-accent px-5 py-2.5 text-sm font-medium text-slate-900 transition-colors"
						>
							Uitnodigen
						</Button>
					</div>
					{invitationsLoading ? (
						<div className="py-8 text-center text-ui-muted">Laden...</div>
					) : invitations?.length === 0 ? (
						<div className="flex flex-col items-center justify-center rounded-xl bg-ui-overlay/30 py-12">
							<div className="mb-4 rounded-full bg-ui-overlay p-4">
								<Mail className="h-8 w-8 text-ui-muted" />
							</div>
							<p className="text-center text-ui-muted">
								Geen openstaande uitnodigingen
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{invitations?.map((invitation: Invitation) => (
								<div
									key={invitation.id}
									className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-overlay/20 p-4"
								>
									<div className="flex items-center gap-4">
										<div
											className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
												invitation.email
													? 'bg-blue-500/10 text-blue-400'
													: 'bg-purple-500/10 text-purple-400'
											}`}
										>
											{invitation.email ? (
												<Mail className="h-5 w-5" />
											) : (
												<Key className="h-5 w-5" />
											)}
										</div>
										<div className="min-w-0">
											{invitation.email ? (
												<p className="font-semibold text-foreground">
													{invitation.email}
												</p>
											) : (
												<p className="font-mono font-semibold text-foreground">
													{invitation.code}
												</p>
											)}
											<p className="mt-1 text-sm text-ui-muted">
												{invitation.role === 'ADMIN'
													? 'Beheerder'
													: 'Medewerker'}
												{' • '}
												{invitation.isExpired ? (
													<span className="text-red-400">Verlopen</span>
												) : (
													`Verloopt ${new Date(
														invitation.expiresAt
													).toLocaleDateString('nl-NL')}`
												)}
											</p>
										</div>
									</div>
									<button
										onClick={() => handleRevokeInvitation(invitation.id)}
										className="rounded-xl p-2.5 text-ui-muted transition-all hover:bg-red-500/10 hover:text-red-400"
										title="Intrekken"
									>
										<Trash2 className="h-5 w-5" />
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Invite Modal (same as before) */}
			{showInviteModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
					<div className="w-full max-w-md rounded-2xl border border-ui-border bg-ui-panel p-8 shadow-2xl">
						<h2 className="mb-6 text-2xl font-bold text-foreground">
							Nieuw lid uitnodigen
						</h2>
						{createdCode ? (
							<div className="space-y-6">
								<div className="rounded-xl border-2 border-ui-accent/30 bg-ui-accent/10 p-6">
									<p className="mb-3 text-center text-sm font-medium text-ui-muted">
										Uitnodigingscode:
									</p>
									<p className="text-center font-mono text-3xl font-bold tracking-widest text-ui-accent">
										{createdCode}
									</p>
								</div>
								<p className="text-center text-sm text-ui-muted">
									Deel deze code met de persoon die je wilt uitnodigen.
								</p>
								<Button
									onClick={() => {
										setShowInviteModal(false);
										setCreatedCode(null);
									}}
									className="w-full rounded-xl bg-ui-accent py-3 font-semibold text-slate-900 transition-colors"
								>
									Sluiten
								</Button>
							</div>
						) : (
							<div className="space-y-6">
								<div className="flex gap-2 rounded-xl border border-ui-border bg-ui-overlay/30 p-1">
									<button
										onClick={() => setInviteType('code')}
										className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition-all ${
											inviteType === 'code'
												? 'bg-ui-accent text-slate-900 shadow-sm'
												: 'text-ui-muted hover:text-foreground'
										}`}
									>
										<Key className="h-5 w-5" />
										Code
									</button>
									<button
										onClick={() => setInviteType('email')}
										className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition-all ${
											inviteType === 'email'
												? 'bg-ui-accent text-slate-900 shadow-sm'
												: 'text-ui-muted hover:text-foreground'
										}`}
									>
										<Mail className="h-5 w-5" />
										E-mail
									</button>
								</div>

								{inviteType === 'email' && (
									<div className="space-y-2">
										<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
											E-mailadres
										</label>
										<Input
											type="email"
											value={inviteEmail}
											onChange={(e) => setInviteEmail(e.target.value)}
											placeholder="naam@bedrijf.nl"
											className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-2 focus:ring-ui-accent/20"
										/>
									</div>
								)}

								<div className="space-y-2">
									<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
										Rol
									</label>
									<div className="flex gap-3">
										<button
											onClick={() => setInviteRole('DOCTOR')}
											className={`flex flex-1 items-center justify-center gap-3 rounded-xl border py-4 text-sm font-medium transition-colors ${
												inviteRole === 'DOCTOR'
													? 'border-ui-accent bg-ui-accent/10 text-ui-accent'
													: 'border-ui-border text-ui-muted hover:border-ui-accent/50'
											}`}
										>
											<User className="h-5 w-5" />
											Medewerker
										</button>
										<button
											onClick={() => setInviteRole('ADMIN')}
											className={`flex flex-1 items-center justify-center gap-3 rounded-xl border py-4 text-sm font-medium transition-colors ${
												inviteRole === 'ADMIN'
													? 'border-ui-accent bg-ui-accent/10 text-ui-accent'
													: 'border-ui-border text-ui-muted hover:border-ui-accent/50'
											}`}
										>
											<Shield className="h-5 w-5" />
											Beheerder
										</button>
									</div>
								</div>

								<div className="flex gap-3 pt-4">
									<Button
										onClick={() => setShowInviteModal(false)}
										variant="outline"
										className="flex-1 rounded-xl border border-ui-border py-3 font-medium text-foreground transition-colors hover:bg-ui-overlay"
									>
										Annuleren
									</Button>
									<Button
										onClick={handleCreateInvitation}
										disabled={
											createInvitation.isPending ||
											(inviteType === 'email' && !inviteEmail)
										}
										className="flex-1 rounded-xl bg-ui-accent py-3 font-semibold text-slate-900 transition-colors disabled:opacity-50"
									>
										{createInvitation.isPending ? 'Bezig...' : 'Uitnodigen'}
									</Button>
								</div>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

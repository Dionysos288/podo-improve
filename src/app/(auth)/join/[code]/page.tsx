'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUp, useSession } from '@/src/shared/core/auth/auth-client';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';

interface InvitationInfo {
	orgName: string;
	email: string | null;
	role: string;
}

export default function JoinWithCodePage({
	params,
}: {
	params: Promise<{ code: string }>;
}) {
	const { code } = use(params);
	const router = useRouter();
	const { data: session } = useSession();
	const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Form fields for new users
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');

	useEffect(() => {
		async function validateInvitation() {
			try {
				const response = await fetch(`/api/invitations/validate?code=${code}`);
				const data = await response.json();

				if (!response.ok) {
					setError(data.error || 'Ongeldige uitnodigingscode');
					return;
				}

				setInvitation(data);
				if (data.email) {
					setEmail(data.email);
				}
			} catch {
				setError('Er is een fout opgetreden bij het valideren');
			} finally {
				setIsLoading(false);
			}
		}

		validateInvitation();
	}, [code]);

	const handleExistingUserJoin = async () => {
		setError(null);
		setIsSubmitting(true);

		try {
			const response = await fetch('/api/invitations/accept', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code }),
			});

			const data = await response.json();

			if (!response.ok) {
				setError(data.error || 'Kon niet lid worden');
				return;
			}

			router.push(`/${data.orgSlug}`);
			router.refresh();
		} catch {
			setError('Er is een fout opgetreden');
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleNewUserJoin = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsSubmitting(true);

		try {
			// Create the user account
			const result = await signUp.email({
				email,
				password,
				name,
			});

			if (result.error) {
				setError(result.error.message || 'Account aanmaken mislukt');
				return;
			}

			// Accept the invitation
			const response = await fetch('/api/invitations/accept', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code }),
			});

			const data = await response.json();

			if (!response.ok) {
				setError(data.error || 'Kon niet lid worden');
				return;
			}

			router.push(`/${data.orgSlug}`);
			router.refresh();
		} catch {
			setError('Er is een fout opgetreden');
		} finally {
			setIsSubmitting(false);
		}
	};

	if (isLoading) {
		return (
			<div className="relative z-10 w-full max-w-md">
				<div className="ui-panel rounded-2xl p-8 text-center">
					<div className="animate-pulse text-ui-muted">Laden...</div>
				</div>
			</div>
		);
	}

	if (error && !invitation) {
		return (
			<div className="relative z-10 w-full max-w-md">
				<div className="ui-panel rounded-2xl p-8 text-center">
					<div className="mb-4 text-red-400">{error}</div>
					<Link
						href="/join"
						className="text-ui-accent transition-opacity hover:opacity-80"
					>
						Probeer een andere code
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="relative z-10 w-full max-w-md">
			<div className="ui-panel rounded-2xl p-8">
				<div className="mb-8 text-center">
					<h1 className="text-2xl font-semibold text-foreground">
						Lid worden van {invitation?.orgName}
					</h1>
					<p className="mt-2 text-sm text-ui-muted">
						Je bent uitgenodigd als{' '}
						<span className="font-medium text-ui-accent">
							{invitation?.role === 'ADMIN' ? 'Admin' : 'Medewerker'}
						</span>
					</p>
				</div>

				{error && (
					<div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
						{error}
					</div>
				)}

				{session ? (
					// Existing user flow
					<div className="space-y-4">
						<div className="rounded-lg border border-ui-border bg-ui-card p-4">
							<p className="text-sm text-ui-muted">Ingelogd als</p>
							<p className="font-medium text-foreground">{session.user.email}</p>
						</div>

						<Button
							onClick={handleExistingUserJoin}
							disabled={isSubmitting}
							className="w-full rounded-lg bg-ui-accent py-3 font-medium text-slate-900 transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
						>
							{isSubmitting ? 'Lid worden...' : 'Lid worden'}
						</Button>

						<p className="text-center text-sm text-ui-muted">
							Niet jij?{' '}
							<Link
								href="/login"
								className="text-ui-accent transition-opacity hover:opacity-80"
							>
								Log in met een ander account
							</Link>
						</p>
					</div>
				) : (
					// New user flow
					<form onSubmit={handleNewUserJoin} className="space-y-4">
						<div className="space-y-2">
							<label
								htmlFor="name"
								className="text-xs uppercase tracking-wide text-ui-muted"
							>
								Volledige naam
							</label>
							<Input
								id="name"
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Jan Jansen"
								required
								autoComplete="name"
								className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-1 focus:ring-ui-accent"
							/>
						</div>

						<div className="space-y-2">
							<label
								htmlFor="email"
								className="text-xs uppercase tracking-wide text-ui-muted"
							>
								E-mailadres
							</label>
							<Input
								id="email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="naam@bedrijf.nl"
								required
								autoComplete="email"
								disabled={!!invitation?.email}
								className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-1 focus:ring-ui-accent disabled:opacity-50"
							/>
						</div>

						<div className="space-y-2">
							<label
								htmlFor="password"
								className="text-xs uppercase tracking-wide text-ui-muted"
							>
								Wachtwoord
							</label>
							<Input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Minimaal 8 tekens"
								required
								autoComplete="new-password"
								className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-1 focus:ring-ui-accent"
							/>
						</div>

						<Button
							type="submit"
							disabled={isSubmitting}
							className="w-full rounded-lg bg-ui-accent py-3 font-medium text-slate-900 transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
						>
							{isSubmitting ? 'Account aanmaken...' : 'Account aanmaken en lid worden'}
						</Button>

						<p className="text-center text-sm text-ui-muted">
							Heb je al een account?{' '}
							<Link
								href="/login"
								className="text-ui-accent transition-opacity hover:opacity-80"
							>
								Log in
							</Link>
						</p>
					</form>
				)}
			</div>
		</div>
	);
}

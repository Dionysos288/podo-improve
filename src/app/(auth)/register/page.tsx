'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUp } from '@/src/shared/core/auth/auth-client';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';

function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.slice(0, 50);
}

export default function RegisterPage() {
	const router = useRouter();
	const [step, setStep] = useState<'account' | 'organization'>('account');
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	// Account fields
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [accessKey, setAccessKey] = useState('');

	// Organization fields
	const [orgName, setOrgName] = useState('');
	const [orgSlug, setOrgSlug] = useState('');
	const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

	const handleOrgNameChange = (value: string) => {
		setOrgName(value);
		if (!slugManuallyEdited) {
			setOrgSlug(generateSlug(value));
		}
	};

	const handleSlugChange = (value: string) => {
		setSlugManuallyEdited(true);
		setOrgSlug(generateSlug(value));
	};

	const handleAccountSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		if (password !== confirmPassword) {
			setError('Wachtwoorden komen niet overeen');
			return;
		}

		if (password.length < 8) {
			setError('Wachtwoord moet minimaal 8 tekens bevatten');
			return;
		}

		if (!accessKey.trim()) {
			setError('Een toegangssleutel is verplicht om een account aan te maken');
			return;
		}

		setStep('organization');
	};

	const handleOrganizationSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		if (!orgSlug || orgSlug.length < 3) {
			setError('URL moet minimaal 3 tekens bevatten');
			setIsLoading(false);
			return;
		}

		try {
			const accessKeyValidation = await fetch(
				`/api/access-keys/validate?code=${encodeURIComponent(accessKey.trim())}&email=${encodeURIComponent(email.trim())}`
			);

			if (!accessKeyValidation.ok) {
				const data = await accessKeyValidation.json().catch(() => ({}));
				setError(data.error || 'Toegangssleutel is ongeldig');
				return;
			}

			// First, create the user
			const result = await signUp.email({
				email,
				password,
				name,
			});

			if (result.error) {
				setError(result.error.message || 'Registratie mislukt');
				return;
			}

			// Then create the organization and link the user
			const orgResponse = await fetch('/api/organizations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: orgName,
					slug: orgSlug,
					accessKey: accessKey.trim(),
				}),
			});

			if (!orgResponse.ok) {
				const data = await orgResponse.json();
				setError(data.error || 'Organisatie aanmaken mislukt');
				return;
			}

			// Redirect to the new organization
			router.push(`/${orgSlug}`);
			router.refresh();
		} catch {
			setError('Er is een fout opgetreden bij het registreren');
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="relative z-10 w-full max-w-md">
			<div className="ui-panel rounded-2xl p-8">
				<div className="mb-8 text-center">
					<h1 className="text-2xl font-semibold text-foreground">
						{step === 'account' ? 'Account aanmaken' : 'Organisatie aanmaken'}
					</h1>
					<p className="mt-2 text-sm text-ui-muted">
						{step === 'account'
							? 'Vul je gegevens in om te beginnen'
							: 'Maak een organisatie aan voor je team'}
					</p>
				</div>

				{/* Progress indicator */}
				<div className="mb-8 flex items-center justify-center gap-2">
					<div
						className={`h-2 w-16 rounded-full transition-colors ${
							step === 'account' ? 'bg-ui-accent' : 'bg-ui-border'
						}`}
					/>
					<div
						className={`h-2 w-16 rounded-full transition-colors ${
							step === 'organization' ? 'bg-ui-accent' : 'bg-ui-border'
						}`}
					/>
				</div>

				{error && (
					<div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
						{error}
					</div>
				)}

				{step === 'account' ? (
					<form onSubmit={handleAccountSubmit} className="space-y-4">
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
								className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-1 focus:ring-ui-accent"
							/>
						</div>

							<div className="space-y-2">
								<label
									htmlFor="accessKey"
									className="text-xs uppercase tracking-wide text-ui-muted"
								>
									Toegangssleutel
								</label>
								<Input
									id="accessKey"
									type="text"
									value={accessKey}
									onChange={(e) => setAccessKey(e.target.value.toUpperCase())}
									placeholder="PODO-XXXX-XXXX"
									required
									autoComplete="off"
									className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-1 focus:ring-ui-accent"
								/>
								<p className="text-xs text-ui-muted">
									Je ontvangt deze sleutel nadat een betaling offline is bevestigd.
								</p>
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

						<div className="space-y-2">
							<label
								htmlFor="confirmPassword"
								className="text-xs uppercase tracking-wide text-ui-muted"
							>
								Bevestig wachtwoord
							</label>
							<Input
								id="confirmPassword"
								type="password"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								placeholder="Herhaal je wachtwoord"
								required
								autoComplete="new-password"
								className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-1 focus:ring-ui-accent"
							/>
						</div>

						<Button
							type="submit"
							className="w-full rounded-lg bg-ui-accent py-3 font-medium text-slate-900 transition-opacity duration-150 hover:opacity-90"
						>
							Volgende
						</Button>
					</form>
				) : (
					<form onSubmit={handleOrganizationSubmit} className="space-y-4">
						<div className="space-y-2">
							<label
								htmlFor="orgName"
								className="text-xs uppercase tracking-wide text-ui-muted"
							>
								Organisatienaam
							</label>
							<Input
								id="orgName"
								type="text"
								value={orgName}
								onChange={(e) => handleOrgNameChange(e.target.value)}
								placeholder="Mijn Podologie Praktijk"
								required
								className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-1 focus:ring-ui-accent"
							/>
						</div>

						<div className="space-y-2">
							<label
								htmlFor="orgSlug"
								className="text-xs uppercase tracking-wide text-ui-muted"
							>
								Organisatie URL
							</label>
							<div className="flex items-center rounded-lg border border-ui-border bg-ui-card focus-within:border-ui-accent focus-within:ring-1 focus-within:ring-ui-accent">
								<span className="pl-4 text-ui-muted">podo.app/</span>
								<Input
									id="orgSlug"
									type="text"
									value={orgSlug}
									onChange={(e) => handleSlugChange(e.target.value)}
									placeholder="mijn-praktijk"
									required
									className="flex-1 border-0 bg-transparent px-1 py-3 text-foreground placeholder:text-ui-muted focus:outline-none focus:ring-0"
								/>
							</div>
							<p className="text-xs text-ui-muted">
								Dit wordt je unieke URL voor toegang tot de applicatie
							</p>
						</div>

						<div className="flex gap-3">
							<Button
								type="button"
								onClick={() => setStep('account')}
								variant="outline"
								className="flex-1 rounded-lg border border-ui-border py-3 text-foreground transition-colors hover:bg-ui-overlay"
							>
								Terug
							</Button>
							<Button
								type="submit"
								disabled={isLoading}
								className="flex-1 rounded-lg bg-ui-accent py-3 font-medium text-slate-900 transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
							>
								{isLoading ? 'Aanmaken...' : 'Aanmaken'}
							</Button>
						</div>
					</form>
				)}

				<div className="mt-8 text-center text-sm text-ui-muted">
					Heb je al een account?{' '}
					<Link
						href="/login"
						className="text-ui-accent transition-opacity hover:opacity-80"
					>
						Inloggen
					</Link>
				</div>

				<div className="mt-4 text-center text-sm text-ui-muted">
					Heb je een uitnodigingscode?{' '}
					<Link
						href="/join"
						className="text-ui-accent transition-opacity hover:opacity-80"
					>
						Lid worden
					</Link>
				</div>
			</div>
		</div>
	);
}

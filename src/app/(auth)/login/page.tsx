'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from '@/src/shared/core/auth/auth-client';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';

export default function LoginPage() {
	const router = useRouter();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		try {
			const result = await signIn.email({
				email,
				password,
			});

			if (result.error) {
				setError(result.error.message || 'Inloggen mislukt');
				return;
			}

			const callbackUrl = new URLSearchParams(window.location.search).get(
				'callbackUrl',
			);
			const destination =
				callbackUrl?.startsWith('/') && !callbackUrl.startsWith('//')
					? callbackUrl
					: '/';
			router.push(destination);
			router.refresh();
		} catch {
			setError('Er is een fout opgetreden bij het inloggen');
		} finally {
			setIsLoading(false);
		}
	};


	return (
		<div className="relative z-10 w-full max-w-md">
			<div className="ui-panel rounded-2xl p-8">
				<div className="mb-8 text-center">
					<h1 className="text-2xl font-semibold text-foreground">
						Welkom terug
					</h1>
					<p className="mt-2 text-sm text-ui-muted">
						Log in op je account om verder te gaan
					</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					{error && (
						<div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
							{error}
						</div>
					)}

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
							placeholder="••••••••"
							required
							autoComplete="current-password"
							className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-1 focus:ring-ui-accent"
						/>
					</div>

					<Button
						type="submit"
						disabled={isLoading}
						className="w-full rounded-lg bg-ui-accent py-3 font-medium text-slate-900 transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
					>
						{isLoading ? 'Inloggen...' : 'Inloggen'}
					</Button>
				</form>

				<div className="mt-8 text-center text-sm text-ui-muted">
					Geen account?{' '}
					<Link
						href="/register"
						className="text-ui-accent transition-opacity hover:opacity-80"
					>
						Registreren
					</Link>
				</div>
			</div>
		</div>
	);
}

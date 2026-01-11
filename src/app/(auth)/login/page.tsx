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

			// Redirect to home, middleware will handle org routing
			router.push('/');
			router.refresh();
		} catch {
			setError('Er is een fout opgetreden bij het inloggen');
		} finally {
			setIsLoading(false);
		}
	};

	const handleOAuthSignIn = async (provider: 'google' | 'microsoft') => {
		setError(null);
		setIsLoading(true);

		try {
			await signIn.social({
				provider,
				callbackURL: '/',
			});
		} catch {
			setError(`Inloggen via ${provider} is mislukt`);
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

				<div className="my-6 flex items-center gap-4">
					<div className="h-px flex-1 bg-ui-border" />
					<span className="text-xs text-ui-muted">of</span>
					<div className="h-px flex-1 bg-ui-border" />
				</div>

				<div className="space-y-3">
					<button
						type="button"
						onClick={() => handleOAuthSignIn('google')}
						disabled={isLoading}
						className="flex w-full items-center justify-center gap-3 rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground transition-colors duration-150 hover:bg-ui-overlay disabled:opacity-50"
					>
						<svg className="h-5 w-5" viewBox="0 0 24 24">
							<path
								fill="currentColor"
								d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
							/>
							<path
								fill="currentColor"
								d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
							/>
							<path
								fill="currentColor"
								d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
							/>
							<path
								fill="currentColor"
								d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
							/>
						</svg>
						Inloggen met Google
					</button>

					<button
						type="button"
						onClick={() => handleOAuthSignIn('microsoft')}
						disabled={isLoading}
						className="flex w-full items-center justify-center gap-3 rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-foreground transition-colors duration-150 hover:bg-ui-overlay disabled:opacity-50"
					>
						<svg className="h-5 w-5" viewBox="0 0 24 24">
							<path fill="#f25022" d="M1 1h10v10H1z" />
							<path fill="#00a4ef" d="M1 13h10v10H1z" />
							<path fill="#7fba00" d="M13 1h10v10H13z" />
							<path fill="#ffb900" d="M13 13h10v10H13z" />
						</svg>
						Inloggen met Microsoft
					</button>
				</div>

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

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';

export default function JoinPage() {
	const router = useRouter();
	const [code, setCode] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		try {
			// Validate the invite code
			const response = await fetch(`/api/invitations/validate?code=${code}`);
			const data = await response.json();

			if (!response.ok) {
				setError(data.error || 'Ongeldige uitnodigingscode');
				return;
			}

			// Redirect to the join flow with the code
			router.push(`/join/${code}`);
		} catch {
			setError('Er is een fout opgetreden');
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="relative z-10 w-full max-w-md">
			<div className="ui-panel rounded-2xl p-8">
				<div className="mb-8 text-center">
					<h1 className="text-2xl font-semibold text-foreground">
						Lid worden van een organisatie
					</h1>
					<p className="mt-2 text-sm text-ui-muted">
						Voer je uitnodigingscode in om lid te worden
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
							htmlFor="code"
							className="text-xs uppercase tracking-wide text-ui-muted"
						>
							Uitnodigingscode
						</label>
						<Input
							id="code"
							type="text"
							value={code}
							onChange={(e) => setCode(e.target.value.toUpperCase())}
							placeholder="ABC123"
							required
							autoComplete="off"
							className="w-full rounded-lg border border-ui-border bg-ui-card px-4 py-3 text-center text-lg font-mono tracking-widest text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-1 focus:ring-ui-accent"
						/>
					</div>

					<Button
						type="submit"
						disabled={isLoading || code.length < 4}
						className="w-full rounded-lg bg-ui-accent py-3 font-medium text-slate-900 transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
					>
						{isLoading ? 'Controleren...' : 'Doorgaan'}
					</Button>
				</form>

				<div className="mt-8 text-center text-sm text-ui-muted">
					Geen uitnodigingscode?{' '}
					<Link
						href="/register"
						className="text-ui-accent transition-opacity hover:opacity-80"
					>
						Nieuwe organisatie aanmaken
					</Link>
				</div>

				<div className="mt-4 text-center text-sm text-ui-muted">
					Heb je al een account?{' '}
					<Link
						href="/login"
						className="text-ui-accent transition-opacity hover:opacity-80"
					>
						Inloggen
					</Link>
				</div>
			</div>
		</div>
	);
}

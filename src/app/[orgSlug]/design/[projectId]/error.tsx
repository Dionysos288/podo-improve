'use client';

import { useEffect } from 'react';
import { Button } from '@/src/shared/components/ui/button';
import Link from 'next/link';

interface ErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function DesignError({ error, reset }: ErrorProps) {
	useEffect(() => {
		// Log error to monitoring service in production
		if (process.env.NODE_ENV === 'production') {
			console.error('Design page error:', error);
		}
	}, [error]);

	return (
		<div className="flex h-dvh flex-col items-center justify-center gap-6 bg-background p-8">
			<div className="text-center">
				<div className="mb-4 text-6xl">⚠️</div>
				<h1 className="text-2xl font-bold text-foreground">
					Er ging iets mis
				</h1>
				<p className="mt-2 text-ui-muted max-w-md">
					{error.message || 'Er is een fout opgetreden bij het laden van de ontwerppagina.'}
				</p>
				{error.digest && (
					<p className="mt-1 text-xs text-ui-muted font-mono">
						Foutcode: {error.digest}
					</p>
				)}
			</div>
			<div className="flex gap-3">
				<Button onClick={reset} variant="default">
					Opnieuw proberen
				</Button>
				<Link href="/">
					<Button variant="outline">Terug naar home</Button>
				</Link>
			</div>
		</div>
	);
}

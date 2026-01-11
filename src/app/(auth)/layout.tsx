import { Suspense } from 'react';

export default function AuthLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<div className="absolute inset-0 overflow-hidden">
				<div className="absolute -left-1/4 -top-1/4 h-1/2 w-1/2 rounded-full bg-ui-accent/5 blur-3xl" />
				<div className="absolute -bottom-1/4 -right-1/4 h-1/2 w-1/2 rounded-full bg-ui-accent/5 blur-3xl" />
			</div>
			<Suspense fallback={<div className="text-ui-muted">Laden...</div>}>
				{children}
			</Suspense>
		</div>
	);
}

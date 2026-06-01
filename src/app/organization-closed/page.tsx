'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { signOut } from '@/src/shared/core/auth';
import { Button } from '@/src/shared/components/ui/button';
import { ShieldX, LogOut, Mail } from 'lucide-react';

function OrganizationClosedContent() {
	const searchParams = useSearchParams();
	const org = searchParams.get('org') ?? undefined;
	const reason = searchParams.get('reason') ?? undefined;

	const handleLogout = async () => {
		await signOut({ fetchOptions: { onSuccess: () => window.location.assign('/login') } });
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
			<div className="w-full max-w-lg rounded-3xl border border-ui-border bg-ui-panel p-10 text-center shadow-sm">
				<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
					<ShieldX size={32} className="text-red-400" />
				</div>

				<h1 className="mt-6 text-2xl font-bold text-foreground">
					{org ? `${org} is gedeactiveerd` : 'Organisatie gedeactiveerd'}
				</h1>

				<p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ui-muted">
					Het account van deze organisatie is gedeactiveerd. Alle toegang tot de applicatie is tijdelijk geblokkeerd. Neem contact op via{' '}
					<a href="mailto:info@podoimprove.be" className="font-medium text-ui-accent hover:underline">info@podoimprove.be</a>{' '}
					voor meer informatie.
				</p>

				{reason && (
					<div className="mt-5 rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-left">
						<p className="text-[11px] font-medium uppercase tracking-wide text-ui-muted">Reden</p>
						<p className="mt-1 text-sm leading-6 text-foreground">{reason}</p>
					</div>
				)}

				<div className="mt-8 space-y-3">
					<a
						href="mailto:info@podoimprove.be"
						className="flex w-full items-center justify-center gap-2 rounded-xl border border-ui-border bg-ui-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-[rgba(255,255,255,0.06)]"
					>
						<Mail size={16} className="text-ui-muted" />
						Mail naar info@podoimprove.be
					</a>
					<Button
						onClick={handleLogout}
						variant="outline"
						className="w-full rounded-xl"
					>
						<LogOut size={16} className="mr-2" />
						Uitloggen
					</Button>
				</div>

				<p className="mt-6 text-xs text-ui-muted/60">
					Als je denkt dat dit een fout is, neem dan contact op met de platformbeheerder.
				</p>
			</div>
		</div>
	);
}

export default function OrganizationClosedPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
					<div className="h-96 w-full max-w-lg animate-pulse rounded-3xl border border-ui-border bg-ui-panel" />
				</div>
			}
		>
			<OrganizationClosedContent />
		</Suspense>
	);
}

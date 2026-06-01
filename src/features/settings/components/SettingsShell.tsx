'use client';

import Link from 'next/link';
import { useRouter, useSelectedLayoutSegment } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { SettingsTab } from '@/src/features/settings/navigation/settings-tabs';
import { cn } from '@/src/shared/lib/cn';

type SettingsShellProps = {
	orgSlug: string;
	orgName: string;
	tabs: SettingsTab[];
	children: React.ReactNode;
};

export function SettingsShell({
	orgSlug,
	orgName,
	tabs,
	children,
}: SettingsShellProps) {
	const router = useRouter();
	const selectedSegment = useSelectedLayoutSegment();
	const [pendingSegment, setPendingSegment] = useState<string | null>(null);
	const activeSegment =
		pendingSegment && pendingSegment !== selectedSegment
			? pendingSegment
			: selectedSegment ?? 'basis';

	const tabLinks = useMemo(
		() =>
			tabs.map((tab) => ({
				...tab,
				href: `/${orgSlug}${tab.hrefSuffix}`,
			})),
		[orgSlug, tabs]
	);

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-7xl space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold text-foreground">Instellingen</h1>
						<p className="mt-2 text-ui-muted">{orgName}</p>
					</div>
				</div>

				<nav
					aria-label="Instellingen tabs"
					className="flex flex-wrap items-center gap-2 border-b border-ui-border pb-3"
				>
					{tabLinks.map((tab) => {
						const isActive = activeSegment === tab.segment;
						return (
							<Link
								key={tab.href}
								href={tab.href}
								aria-current={isActive ? 'page' : undefined}
								onClick={() => setPendingSegment(tab.segment)}
								onFocus={() => router.prefetch(tab.href)}
								onPointerEnter={() => router.prefetch(tab.href)}
								className={cn(
									'rounded-xl border px-4 py-2 text-sm font-medium transition-colors',
									isActive
										? 'border-ui-accent/60 bg-ui-accent/10 text-foreground'
										: 'border-ui-border bg-ui-card text-ui-muted hover:border-ui-accent/50 hover:text-foreground'
								)}
							>
								{tab.label}
							</Link>
						);
					})}
				</nav>

				{children}
			</div>
		</div>
	);
}

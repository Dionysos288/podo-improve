import { cn } from '@/src/shared/lib/cn';

export function SkeletonBlock({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				'animate-pulse rounded-lg bg-ui-overlay/40',
				className
			)}
		/>
	);
}

export function SkeletonLine({
	className,
	width = 'w-full',
}: {
	className?: string;
	width?: string;
}) {
	return <SkeletonBlock className={cn('h-4', width, className)} />;
}

export function PageShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-7xl">{children}</div>
		</div>
	);
}

export function PanelCard({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6',
				className
			)}
		>
			{children}
		</div>
	);
}

export function SettingsPanelCard({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'rounded-2xl border border-ui-border bg-ui-panel p-6',
				className
			)}
		>
			{children}
		</div>
	);
}

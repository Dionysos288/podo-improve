import { cn } from '@/src/shared/lib/cn';

interface SectionCardProps {
	children: React.ReactNode;
	className?: string;
	padding?: 'sm' | 'md' | 'lg';
}

export function SectionCard({
	children,
	className,
	padding = 'md',
}: SectionCardProps) {
	const paddingClasses = {
		sm: 'p-4',
		md: 'p-6',
		lg: 'p-8',
	};

	return (
		<div
			className={cn(
				'rounded-2xl border border-ui-border bg-ui-card backdrop-blur-sm',
				paddingClasses[padding],
				className
			)}
		>
			{children}
		</div>
	);
}

interface SectionHeaderProps {
	title: string;
	description?: string;
	action?: React.ReactNode;
}

export function SectionHeader({
	title,
	description,
	action,
}: SectionHeaderProps) {
	return (
		<div className="mb-6 flex items-start justify-between">
			<div>
				<h2 className="text-xl font-semibold text-foreground">{title}</h2>
				{description && (
					<p className="mt-1 text-sm text-ui-muted">{description}</p>
				)}
			</div>
			{action && <div className="flex-shrink-0">{action}</div>}
		</div>
	);
}

interface StatCardProps {
	icon: React.ReactNode;
	label: string;
	value: string | number;
	trend?: {
		value: string;
		positive: boolean;
	};
}

export function StatCard({ icon, label, value, trend }: StatCardProps) {
	return (
		<div className="rounded-2xl border border-ui-border bg-gradient-to-br from-ui-card to-ui-panel p-6 backdrop-blur-sm transition-all hover:border-ui-accent/50 hover:shadow-lg hover:shadow-ui-accent/5">
			<div className="flex items-start justify-between">
				<div className="rounded-xl bg-ui-accent/10 p-3 text-ui-accent">
					{icon}
				</div>
				{trend && (
					<span
						className={cn(
							'text-xs font-medium',
							trend.positive ? 'text-green-400' : 'text-red-400'
						)}
					>
						{trend.positive ? '↑' : '↓'} {trend.value}
					</span>
				)}
			</div>
			<div className="mt-4">
				<p className="text-3xl font-bold text-foreground">{value}</p>
				<p className="mt-1 text-sm text-ui-muted">{label}</p>
			</div>
		</div>
	);
}

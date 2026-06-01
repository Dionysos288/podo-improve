import { cn } from '@/src/shared/lib/cn';
import {
	SettingsPanelCard,
	SkeletonBlock,
	SkeletonLine,
} from '@/src/shared/components/skeletons/skeleton-primitives';

export type SettingsSkeletonVariant =
	| 'basis'
	| 'usage'
	| 'users'
	| 'mdr'
	| 'printer'
	| 'backup'
	| 'cards';

type SettingsPageSkeletonProps = {
	variant?: SettingsSkeletonVariant;
	className?: string;
};

function PanelHeaderSkeleton({
	titleWidth = 'w-24',
	descriptionWidth = 'w-64',
}: {
	titleWidth?: string;
	descriptionWidth?: string;
}) {
	return (
		<div>
			<SkeletonLine className={cn('h-7 rounded-lg', titleWidth)} />
			<SkeletonLine className={cn('mt-2 h-4', descriptionWidth)} />
		</div>
	);
}

function BasisSettingsSkeleton() {
	return (
		<div className="space-y-6">
			<SettingsPanelCard>
				<PanelHeaderSkeleton titleWidth="w-16" descriptionWidth="w-56" />
				<div className="mt-6 grid gap-4 md:grid-cols-2">
					{Array.from({ length: 4 }).map((_, index) => (
						<div
							key={index}
							className="rounded-2xl border border-ui-border bg-ui-card p-4"
						>
							<SkeletonLine className="h-3 w-20" />
							<SkeletonLine className="mt-2 h-5 w-28" />
						</div>
					))}
				</div>
			</SettingsPanelCard>
			<SettingsPanelCard>
				<PanelHeaderSkeleton titleWidth="w-32" descriptionWidth="w-80" />
				<div className="mt-6 space-y-4">
					<SkeletonBlock className="h-10 w-full rounded-lg" />
					<div className="flex items-center gap-3">
						<SkeletonBlock className="h-5 w-5 rounded" />
						<SkeletonLine className="h-4 w-48" />
					</div>
					<div className="flex flex-wrap gap-3">
						<SkeletonBlock className="h-10 w-36 rounded-xl" />
						<SkeletonBlock className="h-10 w-28 rounded-xl" />
					</div>
				</div>
			</SettingsPanelCard>
		</div>
	);
}

function UsageSettingsSkeleton() {
	return (
		<div className="space-y-6">
			<SettingsPanelCard>
				<PanelHeaderSkeleton titleWidth="w-20" descriptionWidth="w-96" />
			</SettingsPanelCard>
			<div className="grid gap-6 lg:grid-cols-3">
				{Array.from({ length: 3 }).map((_, index) => (
					<SettingsPanelCard key={index}>
						<SkeletonLine className="h-3 w-20" />
						<SkeletonLine className="mt-2 h-7 w-32" />
						<SkeletonLine className="mt-2 h-4 w-40" />
					</SettingsPanelCard>
				))}
			</div>
			<div className="grid gap-6 lg:grid-cols-2">
				{Array.from({ length: 2 }).map((_, columnIndex) => (
					<SettingsPanelCard key={columnIndex}>
						<SkeletonLine className="mb-4 h-6 w-40" />
						<div className="grid gap-3 sm:grid-cols-2">
							{Array.from({ length: 4 }).map((__, rowIndex) => (
								<div
									key={rowIndex}
									className="rounded-xl border border-ui-border bg-ui-card px-4 py-3"
								>
									<SkeletonLine className="h-3 w-24" />
									<SkeletonLine className="mt-2 h-7 w-12" />
								</div>
							))}
						</div>
					</SettingsPanelCard>
				))}
			</div>
		</div>
	);
}

function UsersSettingsSkeleton() {
	return (
		<SettingsPanelCard>
			<div className="grid gap-8 lg:grid-cols-2">
				{Array.from({ length: 2 }).map((_, columnIndex) => (
					<div key={columnIndex}>
						<SkeletonLine className="mb-6 h-7 w-44" />
						<div className="space-y-3">
							{Array.from({ length: 3 }).map((__, rowIndex) => (
								<div
									key={rowIndex}
									className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-card p-4"
								>
									<div className="flex items-center gap-3">
										<SkeletonBlock className="h-10 w-10 rounded-full" />
										<div className="space-y-2">
											<SkeletonLine className="h-4 w-32" />
											<SkeletonLine className="h-3 w-40" />
										</div>
									</div>
									<SkeletonBlock className="h-8 w-20 rounded-lg" />
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</SettingsPanelCard>
	);
}

function MdrSettingsSkeleton() {
	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-ui-border bg-ui-panel p-6">
				<PanelHeaderSkeleton titleWidth="w-48" descriptionWidth="w-full max-w-2xl" />
				<SkeletonBlock className="h-10 w-28 rounded-lg" />
			</div>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{Array.from({ length: 4 }).map((_, index) => (
					<div
						key={index}
						className="rounded-xl border border-ui-border bg-ui-panel px-4 py-3"
					>
						<SkeletonLine className="h-3 w-24" />
						<SkeletonLine className="mt-2 h-5 w-28" />
					</div>
				))}
			</div>
			<SettingsPanelCard>
				<SkeletonLine className="mb-2 h-6 w-56" />
				<SkeletonLine className="mb-6 h-4 w-80" />
				<div className="grid gap-3 sm:grid-cols-2">
					{Array.from({ length: 6 }).map((_, index) => (
						<div
							key={index}
							className="rounded-xl border border-ui-border bg-ui-panel px-4 py-3"
						>
							<SkeletonLine className="h-3 w-28" />
							<SkeletonBlock className="mt-2 h-9 w-full rounded-lg" />
						</div>
					))}
				</div>
			</SettingsPanelCard>
		</div>
	);
}

function PrinterSettingsSkeleton() {
	return (
		<SettingsPanelCard>
			<PanelHeaderSkeleton titleWidth="w-28" descriptionWidth="w-56" />
			<div className="mt-6 overflow-hidden rounded-2xl border border-ui-border">
				<div className="grid grid-cols-12 bg-ui-card px-4 py-3">
					<SkeletonLine className="col-span-5 h-3 w-20" />
					<SkeletonLine className="col-span-3 h-3 w-12" />
					<SkeletonLine className="col-span-2 h-3 w-12" />
					<SkeletonLine className="col-span-2 ml-auto h-3 w-14" />
				</div>
				<div className="divide-y divide-ui-border">
					{Array.from({ length: 2 }).map((_, index) => (
						<div
							key={index}
							className="grid grid-cols-12 items-center bg-ui-panel px-4 py-3"
						>
							<SkeletonLine className="col-span-5 h-5 w-32" />
							<SkeletonLine className="col-span-3 h-4 w-16" />
							<SkeletonLine className="col-span-2 h-4 w-16" />
							<div className="col-span-2 flex justify-end">
								<SkeletonBlock className="h-9 w-28 rounded-xl" />
							</div>
						</div>
					))}
				</div>
			</div>
		</SettingsPanelCard>
	);
}

function BackupSettingsSkeleton() {
	return (
		<SettingsPanelCard>
			<div className="flex items-center justify-between">
				<PanelHeaderSkeleton titleWidth="w-24" descriptionWidth="w-72" />
				<SkeletonBlock className="h-10 w-32 rounded-xl" />
			</div>
			<div className="mt-6 space-y-3">
				{Array.from({ length: 3 }).map((_, index) => (
					<div
						key={index}
						className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-card px-4 py-3"
					>
						<div className="space-y-2">
							<SkeletonLine className="h-4 w-40" />
							<SkeletonLine className="h-3 w-32" />
						</div>
						<div className="flex gap-2">
							<SkeletonBlock className="h-9 w-24 rounded-xl" />
							<SkeletonBlock className="h-9 w-9 rounded-xl" />
						</div>
					</div>
				))}
			</div>
		</SettingsPanelCard>
	);
}

function CardsSettingsSkeleton() {
	return (
		<div className="grid gap-4 md:grid-cols-2">
			{Array.from({ length: 4 }).map((_, index) => (
				<SkeletonBlock key={index} className="h-36 rounded-2xl" />
			))}
		</div>
	);
}

export function SettingsPageSkeleton({
	variant = 'cards',
	className,
}: SettingsPageSkeletonProps) {
	const content = (() => {
		switch (variant) {
			case 'basis':
				return <BasisSettingsSkeleton />;
			case 'usage':
				return <UsageSettingsSkeleton />;
			case 'users':
				return <UsersSettingsSkeleton />;
			case 'mdr':
				return <MdrSettingsSkeleton />;
			case 'printer':
				return <PrinterSettingsSkeleton />;
			case 'backup':
				return <BackupSettingsSkeleton />;
			default:
				return <CardsSettingsSkeleton />;
		}
	})();

	return <div className={cn(className)}>{content}</div>;
}

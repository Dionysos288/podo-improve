import { cn } from '@/src/shared/lib/cn';
import {
	PageShell,
	PanelCard,
	SkeletonBlock,
	SkeletonLine,
} from './skeleton-primitives';

function ListPageHeader({
	actionWidth = 'w-44',
}: {
	actionWidth?: string;
}) {
	return (
		<div className="mb-8 flex items-center justify-between">
			<div>
				<SkeletonLine className="h-9 w-48 rounded-lg" />
				<SkeletonLine className="mt-2 h-5 w-72" />
			</div>
			<SkeletonBlock className={cn('h-11 rounded-xl', actionWidth)} />
		</div>
	);
}

function SearchFieldSkeleton() {
	return (
		<div className="relative mb-8">
			<SkeletonBlock className="h-12 w-full rounded-xl" />
		</div>
	);
}

export function DashboardSkeleton() {
	return (
		<PageShell>
			<div className="space-y-8">
				<div>
					<SkeletonLine className="h-9 w-80 rounded-lg" />
					<SkeletonLine className="mt-2 h-5 w-64" />
				</div>

				<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: 3 }).map((_, index) => (
						<div
							key={index}
							className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6"
						>
							<SkeletonBlock className="h-12 w-12 rounded-xl" />
							<div className="mt-4">
								<SkeletonLine className="h-9 w-16" />
								<SkeletonLine className="mt-2 h-4 w-24" />
							</div>
						</div>
					))}
				</div>

				<div className="rounded-2xl border border-ui-border bg-ui-card p-6 backdrop-blur-sm">
					<div className="mb-6 flex items-start justify-between">
						<div>
							<SkeletonLine className="h-7 w-48" />
							<SkeletonLine className="mt-2 h-4 w-72" />
						</div>
						<SkeletonLine className="h-4 w-28" />
					</div>
					<div className="space-y-2">
						{Array.from({ length: 5 }).map((_, index) => (
							<div
								key={index}
								className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-overlay/20 p-4"
							>
								<div className="flex-1 space-y-2">
									<SkeletonLine className="h-5 w-40" />
									<SkeletonLine className="h-4 w-32" />
								</div>
								<div className="flex items-center gap-4">
									<div className="space-y-2 text-right">
										<SkeletonBlock className="ml-auto h-7 w-24 rounded-full" />
										<SkeletonLine className="h-3 w-20" />
									</div>
									<SkeletonBlock className="h-5 w-5 rounded" />
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</PageShell>
	);
}

export function PatientsListSkeleton() {
	return (
		<PageShell>
			<ListPageHeader actionWidth="w-44" />
			<SearchFieldSkeleton />
			<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }).map((_, index) => (
					<div
						key={index}
						className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6"
					>
						<div className="mb-4 flex items-center gap-4">
							<SkeletonBlock className="h-14 w-14 shrink-0 rounded-xl" />
							<div className="min-w-0 flex-1 space-y-2">
								<SkeletonLine className="h-6 w-36" />
								<SkeletonLine className="h-4 w-24" />
							</div>
						</div>
						<div className="flex items-center justify-between rounded-xl bg-ui-overlay/30 px-4 py-3">
							<SkeletonLine className="h-4 w-20" />
							<SkeletonLine className="h-4 w-24" />
						</div>
					</div>
				))}
			</div>
		</PageShell>
	);
}

export function ProjectsListSkeleton() {
	return (
		<PageShell>
			<ListPageHeader actionWidth="w-40" />
			<div className="mb-8 flex flex-col gap-4 sm:flex-row">
				<SkeletonBlock className="h-12 flex-1 rounded-xl" />
				<div className="flex flex-wrap gap-2">
					{Array.from({ length: 5 }).map((_, index) => (
						<SkeletonBlock
							key={index}
							className="h-11 w-[88px] rounded-xl"
						/>
					))}
				</div>
			</div>
			<div className="space-y-6">
				{Array.from({ length: 4 }).map((_, index) => (
					<div
						key={index}
						className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6"
					>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-4">
								<SkeletonBlock className="h-14 w-14 shrink-0 rounded-xl" />
								<div className="space-y-2">
									<SkeletonLine className="h-6 w-44" />
									<SkeletonLine className="h-4 w-56" />
								</div>
							</div>
							<div className="flex items-center gap-6">
								<div className="space-y-2 text-right">
									<SkeletonLine className="h-4 w-16" />
									<SkeletonLine className="h-3 w-20" />
								</div>
								<SkeletonBlock className="h-9 w-28 rounded-xl" />
							</div>
						</div>
					</div>
				))}
			</div>
		</PageShell>
	);
}

function DetailBackLinkSkeleton() {
	return <SkeletonLine className="mb-6 h-4 w-44" />;
}

function DetailFieldSkeleton() {
	return (
		<div>
			<SkeletonLine className="mb-2 h-3 w-16" />
			<SkeletonLine className="h-5 w-32" />
		</div>
	);
}

function ProjectInfoCardSkeleton() {
	return (
		<PanelCard>
			<SkeletonLine className="mb-6 h-7 w-40" />
			<div className="space-y-6">
				{Array.from({ length: 5 }).map((_, index) => (
					<DetailFieldSkeleton key={index} />
				))}
			</div>
		</PanelCard>
	);
}

function ScansCardSkeleton() {
	return (
		<PanelCard>
			<div className="mb-6 flex items-center justify-between">
				<div className="flex items-center gap-3">
					<SkeletonBlock className="h-9 w-9 rounded-xl" />
					<SkeletonLine className="h-7 w-28" />
				</div>
				<SkeletonBlock className="h-10 w-36 rounded-xl" />
			</div>
			<div className="space-y-3">
				{Array.from({ length: 2 }).map((_, index) => (
					<div
						key={index}
						className="rounded-xl border border-ui-border bg-ui-overlay/20 p-4"
					>
						<div className="flex items-center justify-between">
							<div className="space-y-2">
								<SkeletonLine className="h-5 w-32" />
								<SkeletonLine className="h-3 w-24" />
							</div>
							<div className="flex gap-2">
								<SkeletonBlock className="h-6 w-8 rounded-md" />
								<SkeletonBlock className="h-6 w-8 rounded-md" />
							</div>
						</div>
					</div>
				))}
			</div>
		</PanelCard>
	);
}

function DesignsCardSkeleton() {
	return (
		<PanelCard>
			<div className="mb-6 flex items-center gap-3">
				<SkeletonBlock className="h-9 w-9 rounded-xl" />
				<SkeletonLine className="h-7 w-36" />
			</div>
			<div className="space-y-3">
				{Array.from({ length: 2 }).map((_, index) => (
					<div
						key={index}
						className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-overlay/20 p-4"
					>
						<div className="space-y-2">
							<SkeletonLine className="h-5 w-24" />
							<SkeletonLine className="h-3 w-20" />
						</div>
						<SkeletonBlock className="h-8 w-24 rounded-xl" />
					</div>
				))}
			</div>
		</PanelCard>
	);
}

export function ProjectDetailSkeleton() {
	return (
		<PageShell>
			<div className="mb-8">
				<DetailBackLinkSkeleton />
				<div className="flex items-start justify-between">
					<div className="space-y-2">
						<SkeletonLine className="h-9 w-64 rounded-lg" />
						<SkeletonLine className="h-5 w-48" />
					</div>
					<SkeletonBlock className="h-10 w-36 rounded-xl" />
				</div>
			</div>
			<div className="grid gap-8 lg:grid-cols-3">
				<ProjectInfoCardSkeleton />
				<ScansCardSkeleton />
				<DesignsCardSkeleton />
			</div>
		</PageShell>
	);
}

export function PatientDetailSkeleton() {
	return (
		<PageShell>
			<div className="mb-8">
				<DetailBackLinkSkeleton />
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-6">
						<SkeletonBlock className="h-20 w-20 shrink-0 rounded-2xl" />
						<div className="space-y-2">
							<SkeletonLine className="h-9 w-56 rounded-lg" />
							<SkeletonLine className="h-5 w-40" />
						</div>
					</div>
					<SkeletonBlock className="h-10 w-32 rounded-xl" />
				</div>
			</div>
			<div className="grid gap-8 lg:grid-cols-3">
				<PanelCard className="lg:col-span-1">
					<SkeletonLine className="mb-6 h-7 w-44" />
					<div className="space-y-6">
						{Array.from({ length: 4 }).map((_, index) => (
							<DetailFieldSkeleton key={index} />
						))}
					</div>
				</PanelCard>
				<PanelCard className="lg:col-span-2">
					<SkeletonLine className="mb-6 h-7 w-36" />
					<div className="space-y-3">
						{Array.from({ length: 3 }).map((_, index) => (
							<div
								key={index}
								className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-overlay/20 p-4"
							>
								<div className="space-y-2">
									<SkeletonLine className="h-5 w-40" />
									<SkeletonLine className="h-4 w-52" />
								</div>
								<SkeletonBlock className="h-9 w-28 rounded-xl" />
							</div>
						))}
					</div>
				</PanelCard>
			</div>
		</PageShell>
	);
}

/** @deprecated Use PatientsListSkeleton or ProjectsListSkeleton */
export function ListPageSkeleton() {
	return <PatientsListSkeleton />;
}

/** @deprecated Use ProjectDetailSkeleton or PatientDetailSkeleton */
export function DetailPageSkeleton() {
	return <ProjectDetailSkeleton />;
}

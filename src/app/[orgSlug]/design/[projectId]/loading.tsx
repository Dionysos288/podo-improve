export default function DesignLoading() {
	return (
		<div className="flex h-dvh flex-col bg-background text-foreground">
			{/* Header skeleton */}
			<div className="border-b border-ui-border bg-ui-panel/90 px-4 py-2">
				<div className="flex items-center justify-between">
					<div className="h-5 w-32 animate-pulse rounded bg-ui-overlay" />
					<div className="h-8 w-28 animate-pulse rounded bg-ui-overlay" />
				</div>
			</div>

			{/* Main content skeleton */}
			<div className="relative flex-1">
				{/* 3D viewer area */}
				<div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900">
					{/* Animated insole silhouette — matches the in-app 3D loader */}
					<div className="relative mb-6">
						<svg width="80" height="160" viewBox="0 0 80 160" className="animate-insole-shimmer drop-shadow-[0_0_24px_rgba(99,247,214,0.25)]">
							<path
								d="M40 8 C22 8 14 28 12 48 C10 68 12 88 16 108 C20 128 28 148 40 152 C52 148 60 128 64 108 C68 88 70 68 68 48 C66 28 58 8 40 8Z"
								fill="none"
								stroke="var(--ui-accent)"
								strokeWidth="1.5"
								opacity="0.6"
							/>
							<path
								d="M40 16 C26 16 20 32 18 48 C16 64 18 84 22 104 C26 124 32 140 40 144 C48 140 54 124 58 104 C62 84 64 64 62 48 C60 32 54 16 40 16Z"
								fill="var(--ui-accent)"
								opacity="0.08"
							/>
						</svg>
						<div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
							<div className="animate-orbit-dot">
								<div className="h-2 w-2 rounded-full bg-ui-accent shadow-[0_0_8px_rgba(99,247,214,0.6)]" />
							</div>
						</div>
					</div>
					<p className="animate-fade-in-up text-sm font-medium text-ui-muted">
						3D model laden…
					</p>
					<div className="mt-3 h-0.5 w-32 overflow-hidden rounded-full bg-ui-border/40">
						<div className="h-full w-1/3 rounded-full bg-ui-accent/60 animate-progress-indeterminate" />
					</div>
				</div>

				{/* Right panel skeleton */}
				<div className="absolute right-4 top-4 z-20 flex h-[85vh] w-[420px] flex-col rounded-2xl border border-ui-border bg-ui-panel overflow-hidden">
					{/* Step rail skeleton */}
					<div className="flex gap-2 border-b border-ui-border p-4">
						{[1, 2, 3, 4].map((i) => (
							<div
								key={i}
								className="h-8 w-8 animate-pulse rounded-full bg-ui-overlay"
							/>
						))}
					</div>

					{/* Content skeleton */}
					<div className="flex-1 space-y-4 p-4">
						{[1, 2, 3].map((i) => (
							<div key={i} className="space-y-2">
								<div className="h-4 w-24 animate-pulse rounded bg-ui-overlay" />
								<div className="h-10 w-full animate-pulse rounded-lg bg-ui-overlay" />
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

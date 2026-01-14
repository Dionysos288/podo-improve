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
				<div className="absolute inset-0 flex items-center justify-center bg-gray-900">
					<div className="text-center">
						<div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-ui-accent border-t-transparent mx-auto" />
						<p className="text-ui-muted">Ontwerppagina laden...</p>
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

'use client';

/** Single priority state for the viewer surface (one blocking card at a time). */
export type ViewerOverlayMode =
	| { kind: 'boot' }
	| { kind: 'fitting'; message: string }
	| { kind: 'autoDetect'; message: string }
	| { kind: 'textEditing'; message: string; subtext?: string };

type ViewerStatusOverlayProps = {
	mode: ViewerOverlayMode | null;
};

function InsoleSpinnerMark() {
	return (
		<>
			<div className="relative mb-6">
				<svg
					width="80"
					height="160"
					viewBox="0 0 80 160"
					className="animate-insole-shimmer drop-shadow-[0_0_24px_rgba(99,247,214,0.25)]"
				>
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
			<div className="mt-3 h-0.5 w-32 overflow-hidden rounded-full bg-ui-border/40">
				<div className="h-full w-1/3 rounded-full bg-ui-accent/60 animate-progress-indeterminate" />
			</div>
		</>
	);
}

function SpinnerCard({
	title,
	body,
	boot,
}: {
	title: string;
	body?: string;
	boot?: boolean;
}) {
	return (
		<div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-gray-900/80 backdrop-blur-sm">
			{boot ? (
				<>
					<InsoleSpinnerMark />
					<p className="mt-4 animate-fade-in-up text-sm font-medium text-ui-muted">{title}</p>
				</>
			) : (
				<div className="animate-fade-in-up flex flex-col items-center gap-3 rounded-2xl border border-ui-border bg-ui-panel/95 px-6 py-5 shadow-xl">
					<div className="relative h-8 w-8">
						<div className="absolute inset-0 rounded-full border-2 border-ui-border" />
						<div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-ui-accent" />
					</div>
					<p className="text-xs font-semibold text-ui-text">{title}</p>
					{body ? <p className="text-center text-[11px] text-ui-muted">{body}</p> : null}
					<div className="h-0.5 w-24 overflow-hidden rounded-full bg-ui-border/40">
						<div className="h-full w-1/3 rounded-full bg-ui-accent/60 animate-progress-indeterminate" />
					</div>
				</div>
			)}
		</div>
	);
}

/** One full-screen viewer overlay at a time; keep copy aligned with `loading.tsx`. */
export function ViewerStatusOverlay({ mode }: ViewerStatusOverlayProps) {
	if (!mode) return null;

	if (mode.kind === 'boot') {
		return (
			<SpinnerCard
				boot
				title="3D model laden…"
			/>
		);
	}

	if (mode.kind === 'fitting') {
		return (
			<SpinnerCard title={mode.message} />
		);
	}

	if (mode.kind === 'autoDetect') {
		return (
			<SpinnerCard title={mode.message} />
		);
	}

	return (
		<SpinnerCard title={mode.message} body={mode.subtext} />
	);
}

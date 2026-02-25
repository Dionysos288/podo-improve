'use client';

import { cn } from '@/src/shared/lib/cn';

interface BoxEditConfirmOverlayProps {
	onCancel: () => void;
	onConfirm: () => void;
	className?: string;
}

export function BoxEditConfirmOverlay({
	onCancel,
	onConfirm,
	className,
}: BoxEditConfirmOverlayProps) {
	return (
		<div
			className={cn(
				'ui-overlay-card w-[380px] rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur',
				className
			)}
		>
			<div className="text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">
				Actie
			</div>
			<div className="mt-1 text-sm font-semibold">Box</div>
			<div className="mt-2 text-xs leading-relaxed text-(--ui-muted)">
				Beweeg de punten van de box om het ontwerp aan te passen. Als je klaar bent klik je op de knop
				 bevestigen of annuleren.
			</div>

			<div className="mt-4 flex items-center justify-end gap-2">
				<button
					type="button"
					onClick={onCancel}
					className="rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)]"
				>
					Annuleren
				</button>
				<button
					type="button"
					onClick={onConfirm}
					className="rounded-lg bg-(--ui-accent) px-3 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90"
				>
					Bevestigen
				</button>
			</div>
		</div>
	);
}

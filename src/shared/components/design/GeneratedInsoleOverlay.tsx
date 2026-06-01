'use client';

import { cn } from '@/src/shared/lib/cn';

export type InsoleSide = 'left' | 'right';

interface GeneratedInsoleOverlayProps {
	selectedSide: InsoleSide;
	boxEnabled: { left: boolean; right: boolean };
	onToggleBox: (side: InsoleSide) => void;
	onMirrorToOther: (side: InsoleSide) => void;
	onTrimlineEdit?: (side: InsoleSide) => void;
	onScanRotateEdit?: (side: InsoleSide) => void;
	/** When false, the "3D scan draaien" action is hidden because the underlying 3D model is not visible. */
	scanRotateAvailable?: boolean;
	className?: string;
}

export function GeneratedInsoleOverlay({
	selectedSide,
	boxEnabled,
	onToggleBox,
	onMirrorToOther,
	onTrimlineEdit,
	onScanRotateEdit,
	scanRotateAvailable = true,
	className,
}: GeneratedInsoleOverlayProps) {
	const isBoxOn = selectedSide === 'left' ? boxEnabled.left : boxEnabled.right;

	return (
		<div
			className={cn(
				'ui-overlay-card w-[320px] rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur',
				className
			)}
		>
			<div className="flex items-center justify-between">
				<div>
					<div className="text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">
						Actie
					</div>
					<div className="mt-1 text-xs text-(--ui-muted)">
						Geselecteerd: {selectedSide === 'left' ? 'Links' : 'Rechts'}
					</div>
				</div>
			</div>

			<div className="mt-3 space-y-2">
				<button
					type="button"
					onClick={() => onToggleBox(selectedSide)}
					className={cn(
						'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition',
						isBoxOn
							? 'border-(--ui-accent) bg-[rgba(86,242,214,0.14)] text-(--ui-text)'
							: 'border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-text) hover:bg-[rgba(255,255,255,0.08)]'
					)}
				>
					<span>Box</span>
					<span className="text-xs text-(--ui-muted)">
						{isBoxOn ? 'Actief' : 'Openen'}
					</span>
				</button>

				{onTrimlineEdit && (
					<button
						type="button"
						onClick={() => onTrimlineEdit(selectedSide)}
						className="flex w-full items-center justify-between rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)]"
					>
						<span>Trimline aanpassen</span>
						<span className="text-xs text-(--ui-muted)">Rand bewerken</span>
					</button>
				)}

				{onScanRotateEdit && scanRotateAvailable && (
					<button
						type="button"
						onClick={() => onScanRotateEdit(selectedSide)}
						className="flex w-full items-center justify-between rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)]"
					>
						<span>3D scan draaien</span>
						<span className="text-xs text-(--ui-muted)">Uitlijning aanpassen</span>
					</button>
				)}

				<button
					type="button"
					onClick={() => onMirrorToOther(selectedSide)}
					className="flex w-full items-center justify-between rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)]"
				>
					<span>Spiegelen</span>
					<span className="text-xs text-(--ui-muted)">Kopieer naar {selectedSide === 'left' ? 'Rechts' : 'Links'}</span>
				</button>
			</div>
		</div>
	);
}

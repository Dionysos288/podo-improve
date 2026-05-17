'use client';

import { cn } from '@/src/shared/lib/cn';

export interface ScanRotateEditCardProps {
	title: string;
	subtitle: string;
	saveDisabled?: boolean;
	onCancel: () => void;
	onSave: () => void;
	onResetToAuto: () => void;
	className?: string;
}

export function ScanRotateEditCard({
	title,
	subtitle,
	saveDisabled = false,
	onCancel,
	onSave,
	onResetToAuto,
	className,
}: ScanRotateEditCardProps) {
	return (
		<div
			className={cn(
				'ui-overlay-card w-[min(92vw,320px)] rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur',
				className,
			)}
		>
			<div className="text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">
				{title}
			</div>
			<p className="mt-1 text-xs text-(--ui-muted)">{subtitle}</p>
			<button
				type="button"
				onClick={onResetToAuto}
				className="mt-3 text-left text-[11px] font-medium text-(--ui-accent) underline underline-offset-2 hover:opacity-90"
			>
				Reset to auto
			</button>
			<div className="mt-4 flex gap-2">
				<button
					type="button"
					onClick={onCancel}
					className="flex-1 rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.04)] px-3 py-2 text-xs font-medium text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)]"
				>
					Annuleren
				</button>
				<button
					type="button"
					disabled={saveDisabled}
					onClick={onSave}
					className="flex-1 rounded-lg bg-[#56f2d6] px-3 py-2 text-xs font-semibold text-gray-900 transition hover:bg-[#3ddbb8] disabled:cursor-not-allowed disabled:opacity-35"
				>
					Opslaan
				</button>
			</div>
		</div>
	);
}

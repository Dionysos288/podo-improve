'use client';

import { cn } from '@/src/shared/lib/cn';

export type BottomTextDraft = {
	text: string;
	sizeMm: number;
	depthMm: number;
};

export interface TextEditCardProps {
	draft: BottomTextDraft;
	onDraftChange: (next: BottomTextDraft) => void;
	saveDisabled?: boolean;
	warning?: string | null;
	onCancel: () => void;
	onSave: () => void;
	className?: string;
}

export function TextEditCard({
	draft,
	onDraftChange,
	saveDisabled = false,
	warning,
	onCancel,
	onSave,
	className,
}: TextEditCardProps) {
	return (
		<div
			className={cn(
				'ui-overlay-card w-[min(92vw,320px)] rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur',
				className,
			)}
		>
			<div className="text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">
				Tekst graveren
			</div>
			<p className="mt-1 text-xs text-(--ui-muted)">
				Voorbeeld op de onderkant van de steunzool. Sla op om te bevestigen.
			</p>

			<div className="mt-4 space-y-3">
				<label className="flex flex-col gap-1">
					<span className="text-xs uppercase tracking-wide text-(--ui-text)/70">Tekst</span>
					<input
						type="text"
						className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-ui-text"
						value={draft.text}
						onChange={(e) => onDraftChange({ ...draft, text: e.target.value })}
						placeholder="Bijv. naam / ordernummer"
					/>
				</label>
				<div className="grid grid-cols-2 gap-2">
					<label className="flex flex-col gap-1">
						<span className="text-xs uppercase tracking-wide text-(--ui-text)/70">Grootte (mm)</span>
						<input
							type="number"
							inputMode="decimal"
							className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-ui-text"
							value={draft.sizeMm}
							onChange={(e) =>
								onDraftChange({
									...draft,
									sizeMm: Math.max(1, Math.min(40, Number(e.target.value) || 1)),
								})
							}
							min={1}
							max={40}
							step={0.5}
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs uppercase tracking-wide text-(--ui-text)/70">Diepte (mm)</span>
						<input
							type="number"
							inputMode="decimal"
							className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-ui-text"
							value={draft.depthMm}
							onChange={(e) =>
								onDraftChange({
									...draft,
									depthMm: Math.max(0.2, Math.min(3, Number(e.target.value) || 0.6)),
								})
							}
							min={0.2}
							max={3}
							step={0.1}
						/>
					</label>
				</div>
				{warning ? <p className="text-xs text-amber-300/90">{warning}</p> : null}
			</div>

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

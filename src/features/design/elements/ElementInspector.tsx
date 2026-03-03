'use client';

import { useCallback } from 'react';
import { cn } from '@/src/shared/lib/cn';
import {
	useElementsStore,
	getElementByKey,
	ELEMENT_COLORS,
	type PlacedElement,
	type ElementProfile,
	type ElementFloorMode,
} from '@/src/features/design/elements';

type Props = {
	element: PlacedElement;
	/** When true, renders as the full "Item Instellingen" right-sidebar panel */
	standalone?: boolean;
	/** Callback to add another element (opens modal) */
	onAddElement?: () => void;
};

/**
 * "Item Instellingen" panel — shown in the right sidebar when
 * an orthotic element is selected.  Matches the competitor layout:
 *
 *   ┌──────────────────────────────┐
 *   │  Item Instellingen           │
 *   │  ─────────────────────────   │
 *   │  Hoogte        [  3  ] mm    │
 *   │  Vloeren    [Op zool vl…  ▾] │
 *   │  Opsplitsen          [   ]   │
 *   │  ─────────────────────────   │
 *   │  [ Toevoegen aan bibliotheek]│
 *   └──────────────────────────────┘
 */
export function ElementInspector({ element, standalone, onAddElement }: Props) {
	const { updateElement } = useElementsStore();

	const item = getElementByKey(element.libraryKey);
	const color = item ? ELEMENT_COLORS[item.color] : '#999';

	const update = useCallback(
		(updates: Partial<PlacedElement>) => {
			updateElement(element.id, updates);
		},
		[element.id, updateElement]
	);

	const content = (
		<div className="space-y-3">
			{/* Header */}
			<div className="flex items-center gap-2.5">
				<div
					className="h-3.5 w-3.5 rounded-full ring-2 ring-white/20"
					style={{ backgroundColor: color }}
				/>
				<span className="text-sm font-bold text-ui-text">
					{item?.label ?? element.libraryKey}
				</span>
			</div>

			<div className="h-px bg-ui-border" />

			{/* ── Settings ── */}
			<div className="space-y-2.5">
				{/* Profile selector (if multiple profiles) */}
				{item && item.profiles.length > 1 && (
					<div className="flex items-center justify-between">
						<span className="text-sm text-ui-muted">Profiel</span>
						<div className="flex gap-1">
							{item.profiles.map((p) => (
								<button
									key={p}
									type="button"
									onClick={() => update({ profile: p })}
									className={cn(
										'rounded-lg px-2.5 py-1 text-xs font-semibold transition',
										element.profile === p
											? 'bg-ui-accent text-slate-900'
											: 'text-ui-text hover:bg-[rgba(255,255,255,0.06)]'
									)}
								>
									{p === 'bol' ? 'Bol' : p === 'vlak' ? 'Vlak' : p === 'hol' ? 'Hol' : 'Vloeiend'}
								</button>
							))}
						</div>
					</div>
				)}

				{/* Hoogte */}
				<div className="flex items-center justify-between">
					<span className="text-sm text-ui-muted">Hoogte</span>
					<div className="flex items-center gap-1.5">
						<input
							type="number"
							inputMode="decimal"
							className="w-16 rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-right text-sm font-medium text-ui-text"
							value={Math.abs(element.heightMm)}
							onChange={(e) => {
								const val = Number(e.target.value) || 0;
								update({
									heightMm:
										element.heightMm >= 0
											? Math.max(0.5, val)
											: -Math.max(0.5, val),
								});
							}}
							min={0.5}
							max={item ? Math.abs(item.heightRange[1]) : 10}
							step={0.5}
						/>
						<span className="text-xs text-ui-muted">mm</span>
					</div>
				</div>

				{/* Vloeren */}
				<div className="flex items-center justify-between">
					<span className="text-sm text-ui-muted">Vloeren</span>
					<select
						value={element.floorMode}
						onChange={(e) => update({ floorMode: e.target.value as ElementFloorMode })}
						className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-right text-sm text-ui-text appearance-none pr-7 cursor-pointer"
						style={{
							backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23999' viewBox='0 0 16 16'%3E%3Cpath d='M4.646 5.646a.5.5 0 01.708 0L8 8.293l2.646-2.647a.5.5 0 01.708.708l-3 3a.5.5 0 01-.708 0l-3-3a.5.5 0 010-.708z'/%3E%3C/svg%3E")`,
							backgroundRepeat: 'no-repeat',
							backgroundPosition: 'right 8px center',
						}}
					>
						<option value="sole">Op zool vloeren</option>
						<option value="scan">Op scan vloeren</option>
						<option value="free">Vrij</option>
					</select>
				</div>

				{/* Opsplitsen */}
				<div className="flex items-center justify-between">
					<span className="text-sm text-ui-muted">Opsplitsen</span>
					<button
						type="button"
						onClick={() => update({ split: !element.split })}
						className={cn(
							'relative h-6 w-11 rounded-full transition-colors',
							element.split
								? 'bg-ui-accent'
								: 'bg-[rgba(255,255,255,0.12)]'
						)}
					>
						<span
							className={cn(
								'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
								element.split && 'translate-x-5'
							)}
						/>
					</button>
				</div>
			</div>

			<div className="h-px bg-ui-border" />

			{/* Add to library button (green, like competitor) */}
			<button
				type="button"
				className="w-full rounded-lg bg-ui-accent px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:brightness-110"
			>
				Toevoegen aan bibliotheek
			</button>

			{/* Add another element */}
			{onAddElement && (
				<button
					type="button"
					onClick={onAddElement}
					className="w-full rounded-lg border border-ui-border bg-[rgba(255,255,255,0.03)] px-4 py-2 text-sm text-ui-text transition hover:bg-[rgba(255,255,255,0.06)]"
				>
					+ Element toevoegen
				</button>
			)}
		</div>
	);

	if (standalone) {
		return (
			<div className="flex h-full flex-col">
				<div className="border-b border-ui-border px-5 py-4">
					<h3 className="text-base font-bold text-ui-text">
						Item Instellingen
					</h3>
				</div>
				<div className="flex-1 overflow-y-auto px-5 py-4">
					{content}
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-ui-border bg-[rgba(255,255,255,0.03)] p-3">
			{content}
		</div>
	);
}

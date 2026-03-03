'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/src/shared/lib/cn';
import {
	ELEMENTEN_ITEMS,
	DIEPELEMENTEN_ITEMS,
	ELEMENT_COLORS,
	type ElementTab,
	type ElementLibraryItem,
} from '@/src/features/design/elements';

type Props = {
	open: boolean;
	onClose: () => void;
	onAdd: (libraryKey: string) => void;
	side: 'left' | 'right';
};

const TABS: { key: ElementTab; label: string }[] = [
	{ key: 'elementen', label: 'Elementen' },
	{ key: 'diepelementen', label: 'Diepelementen' },
];

/* ── Thumbnail SVG for an element outline ────── */
function ElementThumbnail({
	item,
	size = 56,
}: {
	item: ElementLibraryItem;
	size?: number;
}) {
	const fillColor = ELEMENT_COLORS[item.color] ?? '#999';
	const pts = item.outline.map(([x, y]) => `${x * size},${y * size}`).join(' ');

	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			className="shrink-0"
		>
			<polygon
				points={pts}
				fill={fillColor}
				fillOpacity={0.25}
				stroke={fillColor}
				strokeWidth={1.5}
			/>
		</svg>
	);
}

export function ElementsModal({ open, onClose, onAdd, side }: Props) {
	const [tab, setTab] = useState<ElementTab>('elementen');

	const items = useMemo(
		() => (tab === 'elementen' ? ELEMENTEN_ITEMS : DIEPELEMENTEN_ITEMS),
		[tab]
	);

	// Group items by color/type for visual grouping
	const groups = useMemo(() => {
		const map = new Map<string, ElementLibraryItem[]>();
		for (const item of items) {
			const key = item.color;
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(item);
		}
		return Array.from(map.entries());
	}, [items]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<>
			{/* Backdrop */}
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
				<div
					className="absolute inset-0"
					onMouseDown={onClose}
				/>

				{/* Modal panel */}
				<div
					className="relative z-10 flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col rounded-2xl border border-ui-border bg-ui-panel shadow-2xl"
					onMouseDown={(e) => e.stopPropagation()}
				>
					{/* Header */}
					<div className="flex items-center justify-between border-b border-ui-border px-5 py-4">
						<div>
							<h2 className="text-base font-semibold text-ui-text">
								Elementen kiezen
							</h2>
							<p className="text-xs text-ui-muted">
								{side === 'left' ? 'Links' : 'Rechts'} – klik op een element om
								toe te voegen
							</p>
						</div>
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-3 py-1.5 text-sm text-ui-muted transition hover:bg-[rgba(255,255,255,0.06)]"
						>
							Sluiten
						</button>
					</div>

					{/* Tab bar */}
					<div className="flex items-center gap-2 border-b border-ui-border px-5 py-3">
						{TABS.map((t) => (
							<button
								key={t.key}
								type="button"
								onClick={() => setTab(t.key)}
								className={cn(
									'rounded-xl px-4 py-2 text-sm font-semibold transition',
									t.key === tab
										? 'bg-ui-accent text-slate-900'
										: 'text-ui-text hover:bg-[rgba(255,255,255,0.06)]'
								)}
							>
								{t.label}
							</button>
						))}
					</div>

					{/* Body – scrollable grid */}
					<div className="flex-1 overflow-y-auto p-5">
						{groups.map(([colorKey, groupItems]) => (
							<div key={colorKey} className="mb-5 last:mb-0">
								<div className="mb-2 flex items-center gap-2">
									<div
										className="h-2.5 w-2.5 rounded-full"
										style={{
											backgroundColor: ELEMENT_COLORS[colorKey] ?? '#999',
										}}
									/>
									<span className="text-[11px] font-semibold uppercase tracking-wide text-ui-muted">
										{colorKey}
									</span>
								</div>

								<div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
									{groupItems.map((item) => (
										<button
											key={item.key}
											type="button"
											onClick={() => {
												onAdd(item.key);
												onClose();
											}}
											className={cn(
												'group flex flex-col items-center gap-1.5 rounded-xl border border-ui-border bg-[rgba(255,255,255,0.02)] p-3 transition',
												'hover:border-ui-accent/50 hover:bg-[rgba(255,255,255,0.05)]'
											)}
										>
											<ElementThumbnail item={item} size={48} />
											<span className="text-center text-[11px] font-medium leading-tight text-ui-text">
												{item.label}
											</span>
											<span className="text-[10px] text-ui-muted">
												{Math.abs(item.defaultHeightMm)} mm
												{item.tab === 'diepelementen' && ' diep'}
											</span>
										</button>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</>
	);
}

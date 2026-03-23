'use client';

import { useCallback } from 'react';
import {
	useElementsStore,
	getElementByKey,
	ELEMENT_COLORS,
	type PlacedElement,
} from '@/src/features/design/elements';
import { cn } from '@/src/shared/lib/cn';

type Props = {
	element: PlacedElement;
	className?: string;
	editMode?: 'move' | 'scale' | 'trimline' | 'box' | null;
	onEditModeChange?: (mode: 'move' | 'scale' | 'trimline' | 'box' | null) => void;
};

/**
 * Left-side "Actie" panel shown when an element is selected.
 * Matches the competitor layout with action buttons:
 *
 *   ┌────────────────────────┐
 *   │  Actie                 │
 *   │  ───────────────────── │
 *   │  ↻ Roteren             │
 *   │  ⇔ Schalen 1 richting  │
 *   │  ⇕ Schalen 2 richtingen│
 *   │  ↔ Spiegelen           │
 *   │  🗑 Verwijderen         │
 *   └────────────────────────┘
 */
export function ElementActionsPanel({ element, className, editMode = null, onEditModeChange }: Props) {
	const { updateElement, removeElement, duplicateElement, selectElement } =
		useElementsStore();

	const item = getElementByKey(element.libraryKey);
	const color = item ? ELEMENT_COLORS[item.color] : '#999';

	const handleRotate = useCallback(() => {
		// Rotate 15° each click
		const newRad = element.rotationRad + (15 * Math.PI) / 180;
		updateElement(element.id, { rotationRad: newRad });
	}, [element.id, element.rotationRad, updateElement]);

	const toggleMode = useCallback((mode: 'move' | 'scale' | 'trimline' | 'box') => {
		onEditModeChange?.(editMode === mode ? null : mode);
	}, [editMode, onEditModeChange]);

	const handleMirror = useCallback(() => {
		// Spiegelen = duplicate to other foot
		duplicateElement(element.id, true);
	}, [element.id, duplicateElement]);

	const handleDelete = useCallback(() => {
		removeElement(element.id);
		selectElement(null);
	}, [element.id, removeElement, selectElement]);

	const actions = [
		{
			key: 'rotate',
			label: 'Roteren',
			description: '15° per klik',
			onClick: handleRotate,
			danger: false,
		},
		{
			key: 'scale',
			label: 'Schalen',
			description: editMode === 'scale' ? 'Actief' : 'Grootte aanpassen',
			onClick: () => toggleMode('scale'),
			active: editMode === 'scale',
			danger: false,
		},
		{
			key: 'box',
			label: 'Box',
			description: editMode === 'box' ? 'Actief' : '2 richtingen',
			onClick: () => toggleMode('box'),
			active: editMode === 'box',
			danger: false,
		},
		{
			key: 'trimline',
			label: 'Trimlijn aanpassen',
			description: editMode === 'trimline' ? 'Actief' : 'Rand wijzigen',
			onClick: () => toggleMode('trimline'),
			active: editMode === 'trimline',
			danger: false,
		},
		{
			key: 'move',
			label: 'Verplaatsen',
			description: editMode === 'move' ? 'Pijlen actief' : 'Met pijlen verplaatsen',
			onClick: () => toggleMode('move'),
			active: editMode === 'move',
			danger: false,
		},
		{
			key: 'mirror',
			label: 'Spiegelen',
			description: `Kopieer naar ${element.side === 'left' ? 'rechts' : 'links'}`,
			onClick: handleMirror,
			danger: false,
		},
		{
			key: 'delete',
			label: 'Verwijderen',
			description: 'Element wissen',
			onClick: handleDelete,
			danger: true,
		},
	];

	return (
		<div
			className={cn(
				'rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur',
				className
			)}
		>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<div className="text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">
						Actie
					</div>
					<div className="mt-1 flex items-center gap-2">
						<div
							className="h-2.5 w-2.5 shrink-0 rounded-full"
							style={{ backgroundColor: color }}
						/>
						<span className="text-sm font-semibold">{item?.label ?? element.libraryKey}</span>
					</div>
					<div className="text-xs text-(--ui-muted)">
						Geselecteerd: {element.side === 'left' ? 'Links' : 'Rechts'}
					</div>
				</div>
			</div>

			{/* Actions */}
			<div className="mt-3 space-y-2">
				{actions.map((action) => (
					<button
						key={action.key}
						type="button"
						onClick={action.onClick}
						className={cn(
							'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition',
							action.danger
								? 'border-red-500/40 bg-[rgba(239,68,68,0.06)] text-red-400 hover:bg-[rgba(239,68,68,0.14)]'
								: action.active
									? 'border-ui-accent/40 bg-ui-accent/10 text-(--ui-text)'
									: 'border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-text) hover:bg-[rgba(255,255,255,0.08)]'
						)}
					>
						<span>{action.label}</span>
						<span className="text-xs text-(--ui-muted)">{action.description}</span>
					</button>
				))}
			</div>
		</div>
	);
}

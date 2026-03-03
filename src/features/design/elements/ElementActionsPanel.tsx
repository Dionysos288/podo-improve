'use client';

import { useCallback } from 'react';
import {
	useElementsStore,
	getElementByKey,
	ELEMENT_COLORS,
	type PlacedElement,
} from '@/src/features/design/elements';

type Props = {
	element: PlacedElement;
	className?: string;
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
export function ElementActionsPanel({ element, className }: Props) {
	const { updateElement, removeElement, duplicateElement, selectElement } =
		useElementsStore();

	const item = getElementByKey(element.libraryKey);
	const color = item ? ELEMENT_COLORS[item.color] : '#999';

	const handleRotate = useCallback(() => {
		// Rotate 15° each click
		const newRad = element.rotationRad + (15 * Math.PI) / 180;
		updateElement(element.id, { rotationRad: newRad });
	}, [element.id, element.rotationRad, updateElement]);

	const handleScale1 = useCallback(() => {
		// Scale uniformly +10%
		const newScale = Math.min(3, (element.scaleU + element.scaleV) / 2 * 1.1);
		updateElement(element.id, { scaleU: newScale, scaleV: newScale });
	}, [element.id, element.scaleU, element.scaleV, updateElement]);

	const handleScale2 = useCallback(() => {
		// Scale width +10% (independent)
		updateElement(element.id, {
			scaleU: Math.min(3, element.scaleU * 1.1),
			scaleV: Math.min(3, element.scaleV * 1.1),
		});
	}, [element.id, element.scaleU, element.scaleV, updateElement]);

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
			icon: (
				<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M21.5 2v6h-6" />
					<path d="M21.34 15.57a10 10 0 1 1-.57-8.38" />
				</svg>
			),
			onClick: handleRotate,
		},
		{
			key: 'scale1',
			label: 'Schalen 1 richting',
			icon: (
				<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M21 12H3M21 12l-4-4m4 4l-4 4M3 12l4-4m-4 4l4 4" />
				</svg>
			),
			onClick: handleScale1,
		},
		{
			key: 'scale2',
			label: 'Schalen 2 richtingen',
			icon: (
				<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M21 12H3M21 12l-4-4m4 4l-4 4M3 12l4-4m-4 4l4 4" />
					<path d="M12 3v18M12 3l-4 4m4-4l4 4M12 21l-4-4m4 4l4-4" />
				</svg>
			),
			onClick: handleScale2,
		},
		{
			key: 'mirror',
			label: 'Spiegelen',
			icon: (
				<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M12 3v18" />
					<path d="M8 6H4l4 6-4 6h4" />
					<path d="M16 6h4l-4 6 4 6h-4" />
				</svg>
			),
			onClick: handleMirror,
		},
		{
			key: 'delete',
			label: 'Verwijderen',
			icon: (
				<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
				</svg>
			),
			onClick: handleDelete,
			danger: true,
		},
	];

	return (
		<div
			className={`rounded-2xl border border-ui-border bg-ui-panel/95 backdrop-blur-sm text-ui-text overflow-hidden ${className ?? ''}`}
		>
			{/* Header */}
			<div className="px-4 py-3 border-b border-ui-border">
				<div className="flex items-center gap-2">
					<div
						className="h-2.5 w-2.5 rounded-full"
						style={{ backgroundColor: color }}
					/>
					<span className="text-sm font-bold">Actie</span>
				</div>
			</div>

			{/* Actions list */}
			<div className="p-2 space-y-0.5">
				{actions.map((action) => (
					<button
						key={action.key}
						type="button"
						onClick={action.onClick}
						className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition
							${action.danger
								? 'text-red-400 hover:bg-red-500/10'
								: 'text-ui-text hover:bg-[rgba(255,255,255,0.06)]'
							}
						`}
					>
						<span className="shrink-0 opacity-70">{action.icon}</span>
						<span className="font-medium">{action.label}</span>
					</button>
				))}
			</div>
		</div>
	);
}

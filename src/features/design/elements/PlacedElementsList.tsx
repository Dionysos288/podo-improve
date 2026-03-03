'use client';

import { cn } from '@/src/shared/lib/cn';
import {
	useElementsStore,
	getElementByKey,
	ELEMENT_COLORS,
} from '@/src/features/design/elements';

/**
 * Compact list of all placed elements for a given side.
 * Clicking selects the element for editing in the inspector.
 */
export function PlacedElementsList({ side }: { side: 'left' | 'right' }) {
	const { placedElements, selectedElementId, selectElement, removeElement } =
		useElementsStore();

	const elements = placedElements.filter((el) => el.side === side);

	if (elements.length === 0) {
		return (
			<p className="text-xs text-ui-muted italic">
				Nog geen elementen geplaatst
			</p>
		);
	}

	return (
		<div className="space-y-1">
			{elements.map((el) => {
				const item = getElementByKey(el.libraryKey);
				const color = item ? ELEMENT_COLORS[item.color] : '#999';
				const isSelected = el.id === selectedElementId;

				return (
					<div
						key={el.id}
						className={cn(
							'flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition cursor-pointer',
							isSelected
								? 'border-ui-accent bg-ui-accent/10'
								: 'border-ui-border bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)]'
						)}
						onClick={() => selectElement(isSelected ? null : el.id)}
					>
						<div className="flex items-center gap-2">
							<div
								className="h-2.5 w-2.5 rounded-full shrink-0"
								style={{ backgroundColor: color }}
							/>
							<span className="text-ui-text font-medium">
								{item?.label ?? el.libraryKey}
							</span>
							<span className="text-[10px] text-ui-muted">
								{Math.abs(el.heightMm)} mm
							</span>
						</div>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								removeElement(el.id);
							}}
							className="rounded-md px-1.5 py-0.5 text-xs text-ui-muted transition hover:bg-red-500/10 hover:text-red-400"
						>
							×
						</button>
					</div>
				);
			})}
		</div>
	);
}

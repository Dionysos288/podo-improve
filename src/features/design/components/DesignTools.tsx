'use client';

import { useDesignStore } from '@/src/shared/core/store/designStore';

export function DesignTools() {
	const { elements, selectedTemplate } = useDesignStore();

	const hasLeftInsole = elements.some(
		(el) => el.type === 'insole' && el.footSide === 'left'
	);
	const hasRightInsole = elements.some(
		(el) => el.type === 'insole' && el.footSide === 'right'
	);

	// Don't show add buttons if insoles are already added
	if (hasLeftInsole && hasRightInsole) {
		return (
			<div className="space-y-2">
				<div className="flex gap-2">
					<div className="px-3 py-1.5 bg-green-50 rounded text-sm">
						<span className="font-medium">✓ Left Insole</span>
					</div>
					<div className="px-3 py-1.5 bg-green-50 rounded text-sm">
						<span className="font-medium">✓ Right Insole</span>
					</div>
				</div>
				{selectedTemplate && (
					<div className="text-xs text-gray-500">
						Template:{' '}
						<span className="capitalize font-medium">{selectedTemplate}</span>
					</div>
				)}
			</div>
		);
	}

	return null;
}

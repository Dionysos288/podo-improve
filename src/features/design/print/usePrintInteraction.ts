'use client';

import { useCallback, useState } from 'react';
import type { PrintZoneId } from '@/src/features/design/print/printZones';

export function usePrintInteraction() {
	const [hoveredBySide, setHoveredBySide] = useState<{
		left: PrintZoneId | null;
		right: PrintZoneId | null;
	}>({ left: null, right: null });

	const resetHover = useCallback(() => {
		setHoveredBySide({ left: null, right: null });
	}, []);

	const onPrepZoneHover = useCallback((zone: PrintZoneId | null, side: 'left' | 'right') => {
		setHoveredBySide((prev) =>
			prev[side] === zone ? prev : { ...prev, [side]: zone },
		);
	}, []);

	const onSplitToggledOff = useCallback(() => {
		resetHover();
	}, [resetHover]);

	const onPrepWholeInsoleClick = useCallback((_side: 'left' | 'right') => {
		void _side;
		resetHover();
	}, [resetHover]);

	const deselectInteraction = useCallback(() => {
		resetHover();
	}, [resetHover]);

	return {
		hoveredBySide,
		resetHover,
		onPrepZoneHover,
		onWholeInsoleToggleSplitOff: onSplitToggledOff,
		onPrepWholeInsoleClick,
		deselectInteraction,
	};
}

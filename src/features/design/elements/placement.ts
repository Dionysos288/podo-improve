import type { BoxGridSavedOffsets } from '@/src/features/design/components/InteractiveBoxGrid';
import type { TrimlineHandleProfile } from '@/src/shared/components/design/TrimlineEditOverlay';
import type { ElementLibraryItem, PlacedElement } from './types';

export function getDefaultPlacementForSide(
	item: Pick<ElementLibraryItem, 'defaultPosition' | 'defaultRotationRad'> | undefined,
	side: 'left' | 'right',
) {
	const defaultU = item?.defaultPosition?.u ?? 0.5;
	const authoredV = item?.defaultPosition?.v ?? 0.5;
	const authoredRotation = item?.defaultRotationRad ?? 0;

	return {
		positionU: defaultU,
		positionV: side === 'right' ? authoredV : 1 - authoredV,
		rotationRad: side === 'right' ? authoredRotation : -authoredRotation,
	};
}

export function mirrorBoxGridOffsetsAcrossWidth(
	source?: BoxGridSavedOffsets | null,
): BoxGridSavedOffsets | null {
	if (!source) return null;
	const { cols, rows, offsets } = source;
	const mirrored = new Array<number>(offsets.length).fill(0);
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) {
			const sourceIndex = row * cols + col;
			const targetIndex = row * cols + (cols - 1 - col);
			mirrored[targetIndex] = offsets[sourceIndex] ?? 0;
		}
	}
	return {
		cols,
		rows,
		offsets: mirrored,
	};
}

export function mirrorTrimlineHandleProfileAcrossWidth(
	source?: TrimlineHandleProfile | null,
): TrimlineHandleProfile | null {
	if (!source) return null;
	return {
		bins: source.bins,
		tValues: [...source.tValues],
		rightOffsetsMm: [...source.leftOffsetsMm],
		leftOffsetsMm: [...source.rightOffsetsMm],
	};
}

export function mirrorPlacedElementToSide(
	element: PlacedElement,
	to: 'left' | 'right',
): PlacedElement {
	if (element.side === to) {
		return structuredClone(element);
	}

	return {
		...structuredClone(element),
		side: to,
		positionV: 1 - element.positionV,
		rotationRad: -element.rotationRad,
		trimlineHandleProfile: mirrorTrimlineHandleProfileAcrossWidth(element.trimlineHandleProfile),
		boxGridOffsets: mirrorBoxGridOffsetsAcrossWidth(element.boxGridOffsets),
	};
}

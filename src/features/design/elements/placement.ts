import type { BoxGridSavedOffsets } from '@/src/features/design/types/boxGrid';
import type { TrimlineHandleProfile, TrimlineHandleProfilePoint } from '@/src/shared/components/design/TrimlineEditOverlay';
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

function mirrorStoredOffsetAcrossWidth(
	off: BoxGridSavedOffsets['offsets'][number],
): BoxGridSavedOffsets['offsets'][number] {
	if (typeof off === 'number') return off;
	return { du: -off.du, dv: off.dv, dh: off.dh };
}

export function mirrorBoxGridOffsetsAcrossWidth(
	source?: BoxGridSavedOffsets | null,
): BoxGridSavedOffsets | null {
	if (!source) return null;
	const { cols, rows, offsets, version } = source;
	const layers =
		version === 3
			? Math.max(1, source.layers ?? Math.ceil(offsets.length / Math.max(1, rows * cols)))
			: 1;
	const total = rows * cols * layers;
	const mirrored: BoxGridSavedOffsets['offsets'] = new Array(total);
	for (let layer = 0; layer < layers; layer += 1) {
		for (let row = 0; row < rows; row += 1) {
			for (let col = 0; col < cols; col += 1) {
				const sourceIndex = (layer * rows + row) * cols + col;
				const targetIndex = (layer * rows + row) * cols + (cols - 1 - col);
				mirrored[targetIndex] = mirrorStoredOffsetAcrossWidth(offsets[sourceIndex] ?? 0);
			}
		}
	}
	const base = {
		cols,
		rows,
		offsets: mirrored,
	};
	if (version === 3) {
		return { ...base, version: 3 as const, layers };
	}
	if (version === 2) {
		return { ...base, version: 2 as const };
	}
	return base;
}

export function mirrorTrimlineHandleProfileAcrossWidth(
	source?: TrimlineHandleProfile | null,
): TrimlineHandleProfile | null {
	if (!source) return null;
	const { bins } = source;
	const wAx = source.widthAxis ?? 'x';
	const flipDelta = (d: TrimlineHandleProfilePoint) => ({
		x: wAx === 'x' ? -d.x : d.x,
		y: wAx === 'y' ? -d.y : d.y,
		z: wAx === 'z' ? -d.z : d.z,
	});
	const flipDeltas = (arr?: TrimlineHandleProfilePoint[]) =>
		arr?.map((d) => flipDelta(d));
	return {
		bins,
		tValues: [...source.tValues],
		rightOffsetsMm: [...source.leftOffsetsMm],
		leftOffsetsMm: [...source.rightOffsetsMm],
		rightHeightOffsetsMm: source.leftHeightOffsetsMm
			? [...source.leftHeightOffsetsMm]
			: undefined,
		leftHeightOffsetsMm: source.rightHeightOffsetsMm
			? [...source.rightHeightOffsetsMm]
			: undefined,
		rightDeltasMm: flipDeltas(source.leftDeltasMm),
		leftDeltasMm: flipDeltas(source.rightDeltasMm),
		widthAxis: source.widthAxis,
		version: 2,
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

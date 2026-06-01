import * as THREE from 'three';

export type LengthAxisName = 'x' | 'y' | 'z';

export interface GeometryAxes {
	lengthAxis: LengthAxisName;
	widthAxis: LengthAxisName;
	heightAxis: LengthAxisName;
	bbox: THREE.Box3;
	lengthSpan: number;
	widthSpan: number;
	heightSpan: number;
}

/**
 * Axis convention for insoles: longest = heel-to-toe length, shortest = thickness.
 */
export function getGeometryAxes(geometry: THREE.BufferGeometry): GeometryAxes {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;

	const sizeX = bbox.max.x - bbox.min.x;
	const sizeY = bbox.max.y - bbox.min.y;
	const sizeZ = bbox.max.z - bbox.min.z;

	const sizes = [
		{ axis: 'x' as const, size: sizeX },
		{ axis: 'y' as const, size: sizeY },
		{ axis: 'z' as const, size: sizeZ },
	].sort((a, b) => b.size - a.size);

	return {
		lengthAxis: sizes[0].axis,
		widthAxis: sizes[1].axis,
		heightAxis: sizes[2].axis,
		bbox,
		lengthSpan: sizes[0].size,
		widthSpan: sizes[1].size,
		heightSpan: sizes[2].size,
	};
}

export function getAxisValue(
	positions: THREE.BufferAttribute,
	i: number,
	axis: string,
): number {
	if (axis === 'x') return positions.getX(i);
	if (axis === 'y') return positions.getY(i);
	return positions.getZ(i);
}

export function setAxisValue(
	positions: THREE.BufferAttribute,
	i: number,
	axis: string,
	value: number,
): void {
	if (axis === 'x') positions.setX(i, value);
	else if (axis === 'y') positions.setY(i, value);
	else positions.setZ(i, value);
}

export function getMinForAxis(bbox: THREE.Box3, axis: string): number {
	if (axis === 'x') return bbox.min.x;
	if (axis === 'y') return bbox.min.y;
	return bbox.min.z;
}

export function getMaxForAxis(bbox: THREE.Box3, axis: string): number {
	if (axis === 'x') return bbox.max.x;
	if (axis === 'y') return bbox.max.y;
	return bbox.max.z;
}

/**
 * Infer heel-to-toe direction using the same wider-end heuristic as STL canonicalization.
 */
export function createHeelToToeMapper(params: {
	positions: THREE.BufferAttribute;
	lengthAxis: string;
	widthAxis: string;
	bbox: THREE.Box3;
	lengthSpan: number;
}): {
	heelAtMin: boolean;
	getT: (lengthVal: number) => number;
} {
	const { positions, lengthAxis, widthAxis, bbox, lengthSpan } = params;

	const minLength = getMinForAxis(bbox, lengthAxis);
	const maxLength = getMaxForAxis(bbox, lengthAxis);

	const slice = Math.max(lengthSpan * 0.08, 1e-6);

	let minEndMinWidth = Number.POSITIVE_INFINITY;
	let minEndMaxWidth = Number.NEGATIVE_INFINITY;
	let minEndCount = 0;

	let maxEndMinWidth = Number.POSITIVE_INFINITY;
	let maxEndMaxWidth = Number.NEGATIVE_INFINITY;
	let maxEndCount = 0;

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);

		if (lengthVal <= minLength + slice) {
			minEndMinWidth = Math.min(minEndMinWidth, widthVal);
			minEndMaxWidth = Math.max(minEndMaxWidth, widthVal);
			minEndCount++;
		}

		if (lengthVal >= maxLength - slice) {
			maxEndMinWidth = Math.min(maxEndMinWidth, widthVal);
			maxEndMaxWidth = Math.max(maxEndMaxWidth, widthVal);
			maxEndCount++;
		}
	}

	const minEndWidthSpan =
		minEndCount > 10 ? Math.max(0, minEndMaxWidth - minEndMinWidth) : Number.POSITIVE_INFINITY;
	const maxEndWidthSpan =
		maxEndCount > 10 ? Math.max(0, maxEndMaxWidth - maxEndMinWidth) : Number.POSITIVE_INFINITY;

	const heelAtMin =
		Number.isFinite(minEndWidthSpan) && Number.isFinite(maxEndWidthSpan)
			? minEndWidthSpan >= maxEndWidthSpan
			: true;

	return {
		heelAtMin,
		getT: (lengthVal: number) => {
			const raw = (lengthVal - minLength) / lengthSpan;
			const clamped = Math.max(0, Math.min(1, raw));
			return heelAtMin ? clamped : 1 - clamped;
		},
	};
}

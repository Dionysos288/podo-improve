/** Insole heel→toe split; loop = single closed perimeter (elements, pads). */
export type ContourLayout = 'insole' | 'loop';

/**
 * Shared shape consumed by the interactive trimline editor for both insoles
 * (heel→toe split into right/left halves) and elements (single closed loop).
 */
export interface ContourData {
	layout: ContourLayout;
	/** Closed loop positions when layout === 'loop' (bins * 3). */
	loopPos?: Float32Array;
	/** Outward normals for loop layout (bins * 3). */
	loopNormals?: Float32Array;
	/** Positions along the right side (positive width), bins length */
	rightPos: Float32Array; // [x,y,z, x,y,z, ...]
	/** Positions along the left side (negative width), bins length */
	leftPos: Float32Array;
	/** t-values per bin */
	tValues: Float32Array;
	/** Half-widths per bin for right side */
	rightHalfW: Float32Array;
	/** Half-widths per bin for left side */
	leftHalfW: Float32Array;
	/** Outward normal direction per right-side bin (unit vec, bins*3) */
	rightNormals: Float32Array;
	/** Outward normal direction per left-side bin (unit vec, bins*3) */
	leftNormals: Float32Array;
	widthAxis: 'x' | 'y' | 'z';
	lengthAxis: 'x' | 'y' | 'z';
	heightAxis: 'x' | 'y' | 'z';
	bins: number;
	centerW: number;
}

/** Geometry bbox axis assignment: smallest span = height, largest = length. */
export function resolveContourAxes(size: { x: number; y: number; z: number }): {
	heightAxis: 'x' | 'y' | 'z';
	widthAxis: 'x' | 'y' | 'z';
	lengthAxis: 'x' | 'y' | 'z';
} {
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	return { heightAxis: axes[0], widthAxis: axes[1], lengthAxis: axes[2] };
}

/** Index into a flat [x,y,z] array for a named axis. */
export const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

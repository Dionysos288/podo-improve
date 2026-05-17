/** Per-region trimline offsets in mm (legacy fallback when no handle profile exists). */
export interface TrimlineAdjustments {
	global: number;
	heel: number;
	midfoot: number;
	forefoot: number;
	toe: number;
}

export interface TrimlineHandleProfilePoint {
	x: number;
	y: number;
	z: number;
}

/** Trimline stored as per-bin outward offsets plus optional full 3D curve (source of truth when present). */
export interface TrimlineHandleProfile {
	bins: number;
	tValues: number[];
	rightOffsetsMm: number[];
	leftOffsetsMm: number[];
	/** Along heightAxis — additive displacement in mesh-local axes (mm), same semantics as outward offsets. */
	rightHeightOffsetsMm?: number[];
	leftHeightOffsetsMm?: number[];
	/** Legacy hydrated saves — not used for rim cut (width + height scalars only). */
	rightDeltasMm?: TrimlineHandleProfilePoint[];
	leftDeltasMm?: TrimlineHandleProfilePoint[];
	/** Which geometry axis is lateral width; used when mirroring profiles across feet. */
	widthAxis?: 'x' | 'y' | 'z';
	/** Closed-loop vertices in mesh local space: right heel→toe, then left toe→heel (length 2*bins). */
	points3D?: TrimlineHandleProfilePoint[];
	version?: 2;
}

export const DEFAULT_TRIMLINE_ADJUSTMENTS: TrimlineAdjustments = {
	global: 0,
	heel: 0,
	midfoot: 0,
	forefoot: 0,
	toe: 0,
};

/**
 * Mekanika CNC Pro "M" (630 x 1030 mm) machine profile for the EVA competitor
 * NC replica post-processor.
 *
 * All values are derived directly from the competitor reference file
 * `Elien Heyvaert - 2026_top (1).nc` and kept in one place so the replica can
 * be tuned without touching the generator logic.
 *
 * Coordinate conventions of the competitor file (reproduced here):
 * - Absolute positioning (G90), metric (G21).
 * - Work zero is at a machine corner: the table extends in -X / -Y, so all
 *   cutting coordinates are negative. The program ends by parking at +Y to
 *   present the part to the operator.
 * - Z is zeroed at the TABLE and grows UPWARD. The insole surface therefore
 *   sits at positive Z (block top ~= 28.85 mm); retract is well above that.
 */

export interface XY {
	x: number;
	y: number;
}

/**
 * Absolute machine-coordinate centers of the two insoles within the single
 * shared block. Insole A (left) and insole B (right) sit 130 mm apart in X and
 * share the same Y center. Heel points toward -Y.
 */
export const INSOLE_CENTERS: Record<'left' | 'right', XY> = {
	left: { x: -388, y: -370 },
	right: { x: -258, y: -370 },
};

/**
 * The shared block holding one L+R pair, derived from INSOLE_CENTERS so a
 * single pair reproduces the competitor exactly. The block center is the
 * midpoint of the two insole centers; within a block, left sits at
 * `center.x - PAIR_HALF_DX` and right at `center.x + PAIR_HALF_DX`.
 */
export const SLOT0_BLOCK_CENTER: XY = {
	x: (INSOLE_CENTERS.left.x + INSOLE_CENTERS.right.x) / 2,
	y: INSOLE_CENTERS.left.y,
};
export const PAIR_HALF_DX = (INSOLE_CENTERS.right.x - INSOLE_CENTERS.left.x) / 2;

/** Gap (mm) between adjacent blocks when packing multiple pairs on the bed. */
export const BLOCK_PACK_GAP = 20;

export interface PairFootprint {
	widthX: number;
	lenY: number;
}

export interface PairSlot {
	blockCenter: XY;
	leftTarget: XY;
	rightTarget: XY;
}

/**
 * Pack N L+R-pair blocks onto the bed as a uniform grid, anchored at the
 * competitor's slot-0 block and growing toward -X (columns) then -Y (rows).
 * Uses the largest pair footprint for a uniform, collision-free step. Layout is
 * intentionally simple and deterministic; the generator's envelope guard
 * rejects anything that still overflows the machine.
 */
export function layoutPairSlots(
	footprints: PairFootprint[],
	bedWidthMm: number,
	gapMm: number = BLOCK_PACK_GAP,
): PairSlot[] {
	const count = footprints.length;
	if (count === 0) return [];

	const maxWidthX = Math.max(...footprints.map((f) => f.widthX));
	const maxLenY = Math.max(...footprints.map((f) => f.lenY));
	const colStep = maxWidthX + gapMm;
	const rowStep = maxLenY + gapMm;

	const usableX = bedWidthMm - 2 * MARGIN_FOR_LAYOUT;
	const cols = Math.max(1, Math.floor(usableX / colStep));

	const slots: PairSlot[] = [];
	for (let i = 0; i < count; i++) {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const blockCenter: XY = {
			x: SLOT0_BLOCK_CENTER.x - col * colStep,
			y: SLOT0_BLOCK_CENTER.y - row * rowStep,
		};
		slots.push({
			blockCenter,
			leftTarget: { x: blockCenter.x - PAIR_HALF_DX, y: blockCenter.y },
			rightTarget: { x: blockCenter.x + PAIR_HALF_DX, y: blockCenter.y },
		});
	}
	return slots;
}

const MARGIN_FOR_LAYOUT = 10;

/** Table-zeroed Z (mm) that the insole's highest surface point maps to. */
export const BLOCK_TOP_Z = 28.85;
/** Safe retract height (mm) between operations. */
export const RETRACT_Z = 60;
/** Z (mm) where the perimeter profile pass starts its first helical loop. */
export const PROFILE_TOP_Z = 41;
/** Z (mm) the perimeter profile descends to (just above the table). */
export const PROFILE_FLOOR_Z = 1;
/** Rapid approach height (mm) used before the profile pass plunges in. */
export const PROFILE_APPROACH_Z = 100;

/** Cutting feed for the 3D surface flowline finish (mm/min). */
export const FEED_SURFACE = 2400;
/** Cutting feed for the perimeter profile pass (mm/min). */
export const FEED_PROFILE = 1700;
/** Step (mm) along each length scanline of the surface finish. */
export const Y_SCAN_STEP = 1.0;
/** Decimal places for emitted coordinates (competitor uses 4). */
export const DECIMALS = 4;
/** Spindle speed (RPM) from the competitor header. */
export const SPINDLE_RPM = 24000;
/** Final park position in Y (mm) to present the part to the operator. */
export const PARK_Y = 300;

/**
 * Mekanika Pro "M" usable work envelope. The replica refuses to emit moves
 * outside this (minus a safety margin) so an oversized insole or wrong work
 * zero is caught before the machine hits a limit.
 *
 * Long axis = Y (1030 mm) = insole length (heel toward -Y).
 * Short axis = X (630 mm) = the left+right pair, 130 mm apart.
 */
export const MACHINE_ENVELOPE = {
	xMax: 630,
	yMax: 1030,
	marginMm: 5,
} as const;

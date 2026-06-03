/**
 * EVA competitor NC replica post-processor.
 *
 * Emits table-zeroed (positive-Z), absolute machine-coordinate G-code that
 * matches the competitor reference file for the Mekanika CNC Pro "M":
 * - same header/footer, feeds, 4-decimal formatting, G00/G01 dialect
 * - both insoles placed in one block (L at X=-388, R at X=-258, heel toward -Y)
 * - continuous 3D flowline surface finish (constant machine-X, swept along Y)
 * - helical perimeter profile that frees each insole
 * - final park at +Y to present the part
 *
 * The surface points come from the patient's own insole geometry; only the
 * format, coordinate system, placement and strategy mirror the competitor.
 */

import type { CncToolSettings } from '../../types';
import type { HeightfieldData } from '../generateNc';
import {
	computePlacement,
	sampleHeightfield,
	contourYSegmentsAtX,
	type Placement,
} from './placement';
import {
	BLOCK_TOP_Z,
	RETRACT_Z,
	PROFILE_TOP_Z,
	PROFILE_FLOOR_Z,
	PROFILE_APPROACH_Z,
	FEED_SURFACE,
	FEED_PROFILE,
	Y_SCAN_STEP,
	DECIMALS,
	SPINDLE_RPM,
	PARK_Y,
	MACHINE_ENVELOPE,
	PAIR_HALF_DX,
	layoutPairSlots,
	type PairFootprint,
} from './machineProfile';

export interface ReplicaSide {
	contour: [number, number][];
	heightfield: HeightfieldData;
}

/** One L+R block; either side may be omitted (single-foot job). */
export interface ReplicaPair {
	left?: ReplicaSide;
	right?: ReplicaSide;
}

export interface GenerateNcReplicaOptions {
	/** Backward-compatible single pair (the current project). */
	left?: ReplicaSide;
	right?: ReplicaSide;
	/** Multiple pairs for a batch run; takes precedence over left/right. */
	pairs?: ReplicaPair[];
	toolSettings: CncToolSettings;
	/** Bed width (mm) used for slot packing; defaults to the Mekanika M envelope. */
	bedWidthMm?: number;
}

interface SidePrep {
	side: 'left' | 'right';
	placement: Placement;
	heightfield: HeightfieldData;
}

function fmtNum(v: number): string {
	let s = v.toFixed(DECIMALS).replace(/0+$/, '');
	if (s === '-0.') s = '0.';
	return s;
}

export function generateNcReplica(options: GenerateNcReplicaOptions): string {
	const { toolSettings } = options;
	const lines: string[] = [];
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

	const track = (x: number, y: number): void => {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	};
	const move = (code: 'G00' | 'G01', x: number, y: number, z: number): void => {
		track(x, y);
		lines.push(`${code} X${fmtNum(x)} Y${fmtNum(y)} Z${fmtNum(z)}`);
	};

	const allPairs: ReplicaPair[] =
		options.pairs && options.pairs.length > 0
			? options.pairs
			: [{ left: options.left, right: options.right }];

	const footprints: PairFootprint[] = allPairs.map(measurePairFootprint);
	const slots = layoutPairSlots(
		footprints,
		options.bedWidthMm ?? MACHINE_ENVELOPE.xMax,
	);

	const reps: SidePrep[] = [];
	allPairs.forEach((pair, i) => {
		const slot = slots[i];
		if (pair.left) {
			reps.push({
				side: 'left',
				placement: computePlacement(pair.left.contour, slot.leftTarget),
				heightfield: pair.left.heightfield,
			});
		}
		if (pair.right) {
			reps.push({
				side: 'right',
				placement: computePlacement(pair.right.contour, slot.rightTarget),
				heightfield: pair.right.heightfield,
			});
		}
	});

	// ── Header ──
	lines.push('%');
	lines.push('G90');
	lines.push('G21');
	lines.push('T1');
	lines.push(`S${SPINDLE_RPM} M03`);

	// ── Surface finish for each insole (continuous flowline) ──
	for (const rep of reps) {
		emitSurfaceFinish(lines, move, rep, toolSettings);
	}

	// ── Perimeter profile section (restarts spindle like the competitor) ──
	if (reps.length > 0) {
		lines.push(`S${SPINDLE_RPM} M03`);
		for (const rep of reps) {
			emitProfilePass(lines, move, rep, toolSettings);
		}
	}

	// ── Footer: lift then park (bare axis words, matching competitor) ──
	// The park is a Y-only move that keeps the modal X, so it only extends the
	// Y envelope — do not pollute the X span with a phantom X0.
	lines.push(`Z${PROFILE_APPROACH_Z}`);
	lines.push(`Y${PARK_Y}`);
	if (PARK_Y > maxY) maxY = PARK_Y;
	if (PARK_Y < minY) minY = PARK_Y;
	lines.push('%');

	// ── Envelope guard (Mekanika Pro M) ──
	const xSpan = maxX - minX;
	const ySpan = maxY - minY;
	const xLimit = MACHINE_ENVELOPE.xMax - 2 * MACHINE_ENVELOPE.marginMm;
	const yLimit = MACHINE_ENVELOPE.yMax - 2 * MACHINE_ENVELOPE.marginMm;
	if (xSpan > xLimit || ySpan > yLimit) {
		throw new Error(
			`NC replica exceeds Mekanika Pro M envelope: X span ${xSpan.toFixed(1)}mm ` +
			`(limit ${xLimit}mm), Y span ${ySpan.toFixed(1)}mm (limit ${yLimit}mm). ` +
			`Reduce the number of insoles in this run, or check insole size and ` +
			`work-zero placement.`,
		);
	}

	return lines.join('\n');
}

/**
 * Center-independent footprint of one pair's block: width along machine X
 * (both insoles plus their 130 mm center separation) and length along Y.
 */
function measurePairFootprint(pair: ReplicaPair): PairFootprint {
	let maxSideWidth = 0;
	let maxSideLen = 0;
	for (const side of [pair.left, pair.right]) {
		if (!side || side.contour.length < 3) continue;
		const pl = computePlacement(side.contour, { x: 0, y: 0 });
		const w = pl.placedBox.maxX - pl.placedBox.minX;
		const l = pl.placedBox.maxY - pl.placedBox.minY;
		if (w > maxSideWidth) maxSideWidth = w;
		if (l > maxSideLen) maxSideLen = l;
	}
	return { widthX: 2 * PAIR_HALF_DX + maxSideWidth, lenY: maxSideLen };
}

function zSurface(
	hf: HeightfieldData,
	placement: Placement,
	mx: number,
	my: number,
	ballR: number,
): number {
	const [lx, ly] = placement.unplace(mx, my);
	return BLOCK_TOP_Z + sampleHeightfield(hf, lx, ly) + ballR;
}

function emitSurfaceFinish(
	lines: string[],
	move: (code: 'G00' | 'G01', x: number, y: number, z: number) => void,
	rep: SidePrep,
	tool: CncToolSettings,
): void {
	const { placement, heightfield: hf } = rep;
	const ballR = tool.toolType === 'ball-nose' ? tool.toolDiameterMm / 2 : 0;
	const toolR = tool.toolDiameterMm / 2;
	const rawStep = (tool.toolDiameterMm * tool.stepoverPercent) / 100 * 0.5;
	const stepover = Math.max(0.6, Math.min(rawStep, 1.2));
	const { minX, maxX } = placement.placedBox;

	let zigzag = false;
	let started = false;
	let prevSingle = false;
	let lastX = minX;
	let lastY = 0;

	for (let x = minX + toolR; x <= maxX - toolR; x += stepover) {
		const segments = contourYSegmentsAtX(placement.placedContour, x);
		if (segments.length === 0) continue;
		const singleSeg = segments.length === 1;

		for (let s = 0; s < segments.length; s++) {
			const [yLo, yHi] = segments[s];
			const yStart = zigzag ? yHi : yLo;
			const yEnd = zigzag ? yLo : yHi;
			const dir = yEnd >= yStart ? 1 : -1;
			const steps = Math.max(1, Math.ceil(Math.abs(yEnd - yStart) / Y_SCAN_STEP));

			const zStart = zSurface(hf, placement, x, yStart, ballR);
			const continuous = started && singleSeg && prevSingle && s === 0;
			if (continuous) {
				// Link to the next scanline at cutting depth — no rapid lift.
				move('G01', x, yStart, zStart);
			} else {
				move('G00', x, yStart, RETRACT_Z);
				lines.push(`F${FEED_SURFACE}`);
				move('G01', x, yStart, zStart);
				lines.push(`F${FEED_SURFACE}`);
				started = true;
			}

			for (let i = 1; i <= steps; i++) {
				let y = yStart + dir * Y_SCAN_STEP * i;
				y = dir > 0 ? Math.min(y, yEnd) : Math.max(y, yEnd);
				move('G01', x, y, zSurface(hf, placement, x, y, ballR));
			}
			lastX = x;
			lastY = yEnd;

			if (segments.length > 1) {
				move('G00', x, yEnd, RETRACT_Z);
				started = false;
			}
		}
		prevSingle = singleSeg;
		zigzag = !zigzag;
	}

	if (started) move('G00', lastX, lastY, RETRACT_Z);
}

function emitProfilePass(
	lines: string[],
	move: (code: 'G00' | 'G01', x: number, y: number, z: number) => void,
	rep: SidePrep,
	tool: CncToolSettings,
): void {
	const contour = rep.placement.placedContour;
	if (contour.length < 3) return;

	const loops = Math.max(1, Math.ceil((PROFILE_TOP_Z - PROFILE_FLOOR_Z) / tool.depthOfCutMm));
	const perLoop = contour.length;
	const total = loops * perLoop;
	const [x0, y0] = contour[0];

	move('G00', x0, y0, RETRACT_Z);
	lines.push(`F${FEED_SURFACE}`);
	move('G01', x0, y0, PROFILE_TOP_Z);
	lines.push(`F${FEED_PROFILE}`);

	let counter = 0;
	for (let loop = 0; loop < loops; loop++) {
		for (let i = 0; i < perLoop; i++) {
			counter++;
			const [x, y] = contour[(i + 1) % perLoop];
			const z = PROFILE_TOP_Z + (PROFILE_FLOOR_Z - PROFILE_TOP_Z) * (counter / total);
			move('G01', x, y, z);
		}
	}
	// One clean loop at the floor to finish the wall.
	for (let i = 0; i < perLoop; i++) {
		const [x, y] = contour[i];
		move('G01', x, y, PROFILE_FLOOR_Z);
	}
	move('G00', x0, y0, RETRACT_Z);
}

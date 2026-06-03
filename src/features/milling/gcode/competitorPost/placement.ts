/**
 * Placement + orientation helpers for the EVA competitor NC replica.
 *
 * The contour + heightfield produced by `extractStlContour` live in a local
 * frame where Z=0 is the insole top (negative into the stock) and the length
 * axis may run along either X or Y. These helpers map that local frame onto the
 * competitor's absolute machine coordinates: insole centered on its target,
 * length along machine Y with the heel toward -Y, using a pure 90 deg rotation
 * (never a reflection, so a left foot never becomes a right foot).
 */

import type { HeightfieldData } from '../generateNc';
import type { XY } from './machineProfile';

export interface Placement {
	/** Local (contour/heightfield) point -> absolute machine XY. */
	place: (x: number, y: number) => [number, number];
	/** Absolute machine XY -> local (contour/heightfield) point. */
	unplace: (mx: number, my: number) => [number, number];
	/** The outer contour expressed in absolute machine coordinates. */
	placedContour: [number, number][];
	/** Bounding box of the placed contour in machine coordinates. */
	placedBox: { minX: number; maxX: number; minY: number; maxY: number };
}

type Quarter = 0 | 1 | 2 | 3;

function rotate(dx: number, dy: number, k: Quarter): [number, number] {
	switch (k) {
		case 0: return [dx, dy];
		case 1: return [-dy, dx];
		case 2: return [-dx, -dy];
		case 3: return [dy, -dx];
	}
}

function endWidthSpread(
	points: [number, number][],
	lengthIsX: boolean,
	lo: number,
	hi: number,
): number {
	let min = Infinity;
	let max = -Infinity;
	for (const [x, y] of points) {
		const l = lengthIsX ? x : y;
		if (l < lo || l > hi) continue;
		const w = lengthIsX ? y : x;
		if (w < min) min = w;
		if (w > max) max = w;
	}
	return max > min ? max - min : 0;
}

/**
 * Build a Placement for one insole from its local contour, centered on the
 * given absolute machine target. Heel is detected as the wider end along the
 * length axis (same heuristic as the STL auto-orientation), then rotated so it
 * points toward -Y. A left foot is never reflected into a right foot.
 */
export function computePlacement(
	contour: [number, number][],
	target: XY,
): Placement {
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const [x, y] of contour) {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	const spanX = maxX - minX;
	const spanY = maxY - minY;
	const lengthIsX = spanX > spanY;

	// Heel = wider end along the length axis.
	let heelDir: [number, number];
	if (lengthIsX) {
		const band = spanX * 0.15;
		const spreadMin = endWidthSpread(contour, true, minX, minX + band);
		const spreadMax = endWidthSpread(contour, true, maxX - band, maxX);
		heelDir = spreadMax >= spreadMin ? [1, 0] : [-1, 0];
	} else {
		const band = spanY * 0.15;
		const spreadMin = endWidthSpread(contour, false, minY, minY + band);
		const spreadMax = endWidthSpread(contour, false, maxY - band, maxY);
		heelDir = spreadMax >= spreadMin ? [0, 1] : [0, -1];
	}

	// Choose the quarter-turn that sends the heel direction to (0,-1).
	let k: Quarter = 0;
	if (heelDir[0] === 1) k = 3;
	else if (heelDir[0] === -1) k = 1;
	else if (heelDir[1] === 1) k = 2;
	else k = 0;
	const kInv = ((4 - k) % 4) as Quarter;

	const place = (x: number, y: number): [number, number] => {
		const [rx, ry] = rotate(x - cx, y - cy, k);
		return [target.x + rx, target.y + ry];
	};
	const unplace = (mx: number, my: number): [number, number] => {
		const [dx, dy] = rotate(mx - target.x, my - target.y, kInv);
		return [cx + dx, cy + dy];
	};

	const placedContour = contour.map(([x, y]) => place(x, y));
	let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
	for (const [x, y] of placedContour) {
		if (x < pMinX) pMinX = x;
		if (x > pMaxX) pMaxX = x;
		if (y < pMinY) pMinY = y;
		if (y > pMaxY) pMaxY = y;
	}

	return {
		place,
		unplace,
		placedContour,
		placedBox: { minX: pMinX, maxX: pMaxX, minY: pMinY, maxY: pMaxY },
	};
}

/**
 * Bilinear sample of the heightfield in its local frame.
 * Returns the insole-top-relative Z (0 = top, negative into the stock).
 */
export function sampleHeightfield(hf: HeightfieldData, x: number, y: number): number {
	if (hf.cols === 0 || hf.rows === 0) return 0;
	const col = (x - hf.originOffsetMm.x) / hf.cellSizeMm;
	const row = (y - hf.originOffsetMm.y) / hf.cellSizeMm;

	const c0 = Math.max(0, Math.min(Math.floor(col), hf.cols - 1));
	const r0 = Math.max(0, Math.min(Math.floor(row), hf.rows - 1));
	const c1 = Math.min(c0 + 1, hf.cols - 1);
	const r1 = Math.min(r0 + 1, hf.rows - 1);
	const ct = Math.max(0, Math.min(col - c0, 1));
	const rt = Math.max(0, Math.min(row - r0, 1));

	const get = (r: number, c: number): number => {
		const v = hf.zValues[r * hf.cols + c];
		return typeof v === 'number' && Number.isFinite(v) ? v : 0;
	};

	const z00 = get(r0, c0);
	const z10 = get(r0, c1);
	const z01 = get(r1, c0);
	const z11 = get(r1, c1);
	const z0 = z00 + (z10 - z00) * ct;
	const z1 = z01 + (z11 - z01) * ct;
	return z0 + (z1 - z0) * rt;
}

/**
 * Find the Y segments where a vertical line at machine-X `x` lies inside the
 * placed contour. Returns sorted [yMin, yMax] pairs (handles concavities).
 */
export function contourYSegmentsAtX(
	placedContour: [number, number][],
	x: number,
): [number, number][] {
	const hits: number[] = [];
	for (let i = 0; i < placedContour.length; i++) {
		const [x1, y1] = placedContour[i];
		const [x2, y2] = placedContour[(i + 1) % placedContour.length];
		if ((x1 <= x && x2 >= x) || (x2 <= x && x1 >= x)) {
			if (Math.abs(x2 - x1) < 1e-4) continue;
			const t = (x - x1) / (x2 - x1);
			hits.push(y1 + t * (y2 - y1));
		}
	}
	if (hits.length < 2) return [];
	hits.sort((a, b) => a - b);
	const segments: [number, number][] = [];
	for (let i = 0; i + 1 < hits.length; i += 2) {
		if (hits[i + 1] - hits[i] > 1.0) segments.push([hits[i], hits[i + 1]]);
	}
	return segments;
}

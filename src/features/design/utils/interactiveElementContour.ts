import * as THREE from 'three';

import {
	AXIS_INDEX,
	type ContourData,
	resolveContourAxes,
} from '@/src/features/design/utils/contourTypes';

const GRID_LONG_CELLS = 128;
const BOUNDARY_SMOOTH_PASSES = 2;

interface GridSpace {
	cols: number;
	rows: number;
	originL: number;
	originW: number;
	cellL: number;
	cellW: number;
}

/**
 * Concave-safe contour for element pads. The insole sweep assumes a star-convex
 * outline; element shapes (banana/kidney) are concave, so we instead rasterize
 * the top-down footprint into an occupancy grid, trace its real outer boundary,
 * and place the line on the element's top surface.
 */
export function extractElementContour(
	geometry: THREE.BufferGeometry,
	bins = 48,
): ContourData | null {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	if (!bbox) return null;

	const size = bbox.getSize(new THREE.Vector3());
	const { heightAxis, widthAxis, lengthAxis } = resolveContourAxes(size);

	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos || pos.count < 3) return null;

	const li = AXIS_INDEX[lengthAxis];
	const wi = AXIS_INDEX[widthAxis];
	const hi = AXIS_INDEX[heightAxis];

	const lengthSpan = Math.max(1e-6, bbox.max[lengthAxis] - bbox.min[lengthAxis]);
	const widthSpan = Math.max(1e-6, bbox.max[widthAxis] - bbox.min[widthAxis]);
	const centerW = (bbox.min[widthAxis] + bbox.max[widthAxis]) * 0.5;
	const centerL = (bbox.min[lengthAxis] + bbox.max[lengthAxis]) * 0.5;

	// ── Occupancy + top-height grid (top-down length/width plane) ──
	const cols = GRID_LONG_CELLS;
	const cellL = lengthSpan / cols;
	const cellW = cellL; // square cells so distances stay isotropic
	const rows = Math.max(8, Math.ceil(widthSpan / cellW) + 1);
	const grid: GridSpace = {
		cols: cols + 1,
		rows,
		originL: bbox.min[lengthAxis],
		originW: bbox.min[widthAxis],
		cellL,
		cellW,
	};

	const occupancy = new Uint8Array(grid.cols * grid.rows);
	const topHeight = new Float32Array(grid.cols * grid.rows).fill(Number.NEGATIVE_INFINITY);

	const markCell = (col: number, row: number, h: number) => {
		if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return;
		const idx = row * grid.cols + col;
		occupancy[idx] = 1;
		if (h > topHeight[idx]) topHeight[idx] = h;
	};

	const index = geometry.getIndex();
	const triCount = index ? index.count / 3 : pos.count / 3;
	const aL = [0, 0, 0];
	const aW = [0, 0, 0];
	const aH = [0, 0, 0];

	for (let t = 0; t < triCount; t++) {
		for (let k = 0; k < 3; k++) {
			const vIdx = index ? index.getX(t * 3 + k) : t * 3 + k;
			aL[k] = pos.array[vIdx * 3 + li];
			aW[k] = pos.array[vIdx * 3 + wi];
			aH[k] = pos.array[vIdx * 3 + hi];
		}
		rasterizeTriangle(grid, aL, aW, aH, markCell);
	}

	fillHoles(occupancy, grid);

	// ── Trace the outer boundary (Moore neighbour tracing) ──
	const boundary = traceOuterBoundary(occupancy, grid);
	if (!boundary || boundary.length < 8) return null;

	// Cell → world (length/width), height from the per-cell top-surface grid.
	const sampleTopHeight = (col: number, row: number): number => {
		// Search a small neighbourhood for the highest recorded top (boundary
		// cells sit at the silhouette edge where coverage can be sparse).
		let best = Number.NEGATIVE_INFINITY;
		for (let dr = -1; dr <= 1; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				const c = col + dc;
				const r = row + dr;
				if (c < 0 || c >= grid.cols || r < 0 || r >= grid.rows) continue;
				const h = topHeight[r * grid.cols + c];
				if (h > best) best = h;
			}
		}
		return Number.isFinite(best) ? best : bbox.max[heightAxis];
	};

	const polyL: number[] = [];
	const polyW: number[] = [];
	const polyH: number[] = [];
	for (const [col, row] of boundary) {
		polyL.push(grid.originL + col * grid.cellL);
		polyW.push(grid.originW + row * grid.cellW);
		polyH.push(sampleTopHeight(col, row));
	}

	smoothClosed(polyL, BOUNDARY_SMOOTH_PASSES);
	smoothClosed(polyW, BOUNDARY_SMOOTH_PASSES);
	smoothClosed(polyH, BOUNDARY_SMOOTH_PASSES);

	// ── Arc-length resample to `bins` even points ──
	const n = polyL.length;
	const cum = new Float64Array(n + 1);
	for (let i = 1; i <= n; i++) {
		const cur = i % n;
		const prev = i - 1;
		const dl = polyL[cur] - polyL[prev];
		const dw = polyW[cur] - polyW[prev];
		cum[i] = cum[i - 1] + Math.hypot(dl, dw);
	}
	const total = cum[n];
	if (total < 1e-6) return null;

	const sampleAt = (targetLen: number): [number, number, number] => {
		let lo = 0;
		let hi2 = n;
		while (lo < hi2 - 1) {
			const mid = (lo + hi2) >> 1;
			if (cum[mid] < targetLen) lo = mid;
			else hi2 = mid;
		}
		const segLen = cum[lo + 1] - cum[lo];
		const frac = segLen > 1e-9 ? (targetLen - cum[lo]) / segLen : 0;
		const a = lo % n;
		const b = (lo + 1) % n;
		return [
			polyL[a] + (polyL[b] - polyL[a]) * frac,
			polyW[a] + (polyW[b] - polyW[a]) * frac,
			polyH[a] + (polyH[b] - polyH[a]) * frac,
		];
	};

	const tValues = new Float32Array(bins);
	const loopPos = new Float32Array(bins * 3);
	const loopHalfW = new Float32Array(bins);
	const loopL = new Float32Array(bins);
	const loopW = new Float32Array(bins);

	for (let i = 0; i < bins; i++) {
		const tt = i / bins;
		tValues[i] = i / (bins - 1);
		const [l, w, h] = sampleAt(tt * total);
		const ri = i * 3;
		loopPos[ri + li] = l;
		loopPos[ri + wi] = w;
		loopPos[ri + hi] = h;
		loopL[i] = l;
		loopW[i] = w;
		loopHalfW[i] = Math.hypot(w - centerW, l - centerL);
	}

	// ── Outward normals from polygon winding (robust on concave segments) ──
	let signedArea = 0;
	for (let i = 0; i < bins; i++) {
		const j = (i + 1) % bins;
		signedArea += loopL[i] * loopW[j] - loopL[j] * loopW[i];
	}
	const ccw = signedArea > 0;
	const loopNormals = new Float32Array(bins * 3);
	for (let i = 0; i < bins; i++) {
		const prev = (i - 1 + bins) % bins;
		const next = (i + 1) % bins;
		const tL = loopL[next] - loopL[prev];
		const tW = loopW[next] - loopW[prev];
		// Outward = tangent rotated -90° for CCW winding, +90° for CW.
		let nL = ccw ? tW : -tW;
		let nW = ccw ? -tL : tL;
		let mag = Math.hypot(nL, nW);
		if (mag < 1e-8) {
			nL = loopL[i] - centerL;
			nW = loopW[i] - centerW;
			mag = Math.hypot(nL, nW) || 1;
		}
		nL /= mag;
		nW /= mag;
		const ri = i * 3;
		loopNormals[ri + li] = nL;
		loopNormals[ri + wi] = nW;
		loopNormals[ri + hi] = 0;
	}

	const leftPos = new Float32Array(bins * 3);
	const leftNormals = new Float32Array(bins * 3);

	return {
		layout: 'loop',
		loopPos,
		loopNormals,
		rightPos: loopPos,
		leftPos,
		tValues,
		rightHalfW: loopHalfW,
		leftHalfW: new Float32Array(bins),
		rightNormals: loopNormals,
		leftNormals,
		widthAxis,
		lengthAxis,
		heightAxis,
		bins,
		centerW,
	};
}

/** Scan-convert a triangle into the occupancy grid (length/width plane). */
function rasterizeTriangle(
	grid: GridSpace,
	l: number[],
	w: number[],
	h: number[],
	mark: (col: number, row: number, height: number) => void,
): void {
	const c0 = (l[0] - grid.originL) / grid.cellL;
	const c1 = (l[1] - grid.originL) / grid.cellL;
	const c2 = (l[2] - grid.originL) / grid.cellL;
	const r0 = (w[0] - grid.originW) / grid.cellW;
	const r1 = (w[1] - grid.originW) / grid.cellW;
	const r2 = (w[2] - grid.originW) / grid.cellW;

	const minC = Math.max(0, Math.floor(Math.min(c0, c1, c2)));
	const maxC = Math.min(grid.cols - 1, Math.ceil(Math.max(c0, c1, c2)));
	const minR = Math.max(0, Math.floor(Math.min(r0, r1, r2)));
	const maxR = Math.min(grid.rows - 1, Math.ceil(Math.max(r0, r1, r2)));

	const denom = (r1 - r2) * (c0 - c2) + (c2 - c1) * (r0 - r2);
	if (Math.abs(denom) < 1e-9) {
		// Degenerate triangle — stamp its three vertices so slivers still mark.
		mark(Math.round(c0), Math.round(r0), h[0]);
		mark(Math.round(c1), Math.round(r1), h[1]);
		mark(Math.round(c2), Math.round(r2), h[2]);
		return;
	}

	for (let r = minR; r <= maxR; r++) {
		for (let c = minC; c <= maxC; c++) {
			const a = ((r1 - r2) * (c - c2) + (c2 - c1) * (r - r2)) / denom;
			const b = ((r2 - r0) * (c - c2) + (c0 - c2) * (r - r2)) / denom;
			const g = 1 - a - b;
			if (a < -0.01 || b < -0.01 || g < -0.01) continue;
			const height = a * h[0] + b * h[1] + g * h[2];
			mark(c, r, height);
		}
	}
}

/** Fill interior holes so concave but solid footprints trace as one loop. */
function fillHoles(occupancy: Uint8Array, grid: GridSpace): void {
	const { cols, rows } = grid;
	const outside = new Uint8Array(cols * rows);
	const stack: number[] = [];
	const pushIfFree = (c: number, r: number) => {
		if (c < 0 || c >= cols || r < 0 || r >= rows) return;
		const idx = r * cols + c;
		if (occupancy[idx] || outside[idx]) return;
		outside[idx] = 1;
		stack.push(idx);
	};
	for (let c = 0; c < cols; c++) {
		pushIfFree(c, 0);
		pushIfFree(c, rows - 1);
	}
	for (let r = 0; r < rows; r++) {
		pushIfFree(0, r);
		pushIfFree(cols - 1, r);
	}
	while (stack.length) {
		const idx = stack.pop()!;
		const c = idx % cols;
		const r = (idx - c) / cols;
		pushIfFree(c - 1, r);
		pushIfFree(c + 1, r);
		pushIfFree(c, r - 1);
		pushIfFree(c, r + 1);
	}
	for (let i = 0; i < occupancy.length; i++) {
		if (!occupancy[i] && !outside[i]) occupancy[i] = 1;
	}
}

/** Moore-neighbour boundary tracing → ordered closed list of [col,row] cells. */
function traceOuterBoundary(
	occupancy: Uint8Array,
	grid: GridSpace,
): Array<[number, number]> | null {
	const { cols, rows } = grid;
	const at = (c: number, r: number) =>
		c >= 0 && c < cols && r >= 0 && r < rows && occupancy[r * cols + c] === 1;

	let startC = -1;
	let startR = -1;
	for (let r = 0; r < rows && startC < 0; r++) {
		for (let c = 0; c < cols; c++) {
			if (occupancy[r * cols + c]) {
				startC = c;
				startR = r;
				break;
			}
		}
	}
	if (startC < 0) return null;

	// 8-neighbour offsets clockwise starting from west.
	const dirs = [
		[-1, 0],
		[-1, -1],
		[0, -1],
		[1, -1],
		[1, 0],
		[1, 1],
		[0, 1],
		[-1, 1],
	];

	const boundary: Array<[number, number]> = [];
	let curC = startC;
	let curR = startR;
	let backDir = 0;
	const maxSteps = cols * rows * 4;
	let steps = 0;

	do {
		boundary.push([curC, curR]);
		let found = false;
		for (let i = 0; i < 8; i++) {
			const dirIdx = (backDir + i) % 8;
			const nc = curC + dirs[dirIdx][0];
			const nr = curR + dirs[dirIdx][1];
			if (at(nc, nr)) {
				// Step here; resume search from the direction we came from.
				backDir = (dirIdx + 6) % 8;
				curC = nc;
				curR = nr;
				found = true;
				break;
			}
		}
		if (!found) break; // isolated cell
		steps++;
	} while ((curC !== startC || curR !== startR) && steps < maxSteps);

	return boundary.length >= 8 ? boundary : null;
}

/** In-place circular smoothing of a scalar ring. */
function smoothClosed(arr: number[], passes: number): void {
	const n = arr.length;
	if (n < 5) return;
	for (let p = 0; p < passes; p++) {
		const copy = arr.slice();
		for (let i = 0; i < n; i++) {
			const a = copy[(i - 1 + n) % n];
			const b = copy[i];
			const c = copy[(i + 1) % n];
			arr[i] = a * 0.25 + b * 0.5 + c * 0.25;
		}
	}
}

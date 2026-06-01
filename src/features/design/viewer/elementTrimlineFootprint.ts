import * as THREE from 'three';

import type { TrimlineHandleProfile } from '@/src/shared/components/design/TrimlineEditOverlay';
import { extractElementContour } from '@/src/features/design/utils/interactiveElementContour';
import { AXIS_INDEX } from '@/src/features/design/utils/contourTypes';
import { getAxisValue, setAxisValue } from '@/src/features/design/utils/geometryAxes';

const SIGNAL_EPS = 1e-3;

/**
 * Robust mean-value coordinates (Hormann-Floater 2006) for a point against a closed
 * polygon. Writes normalised weights into `outWeights` (length = bins). Handles the
 * degenerate vertex/edge cases so points on the boundary stay on the boundary.
 */
function meanValueWeights(
	px: number,
	py: number,
	polyX: Float32Array,
	polyY: Float32Array,
	bins: number,
	outWeights: Float64Array,
	scratchR: Float64Array,
	scratchTan: Float64Array,
): void {
	const eps = 1e-7;

	for (let i = 0; i < bins; i++) {
		const dx = polyX[i]! - px;
		const dy = polyY[i]! - py;
		const r = Math.hypot(dx, dy);
		if (r < eps) {
			// Point coincides with a polygon vertex.
			outWeights.fill(0, 0, bins);
			outWeights[i] = 1;
			return;
		}
		scratchR[i] = r;
	}

	for (let i = 0; i < bins; i++) {
		const j = (i + 1) % bins;
		const ax = polyX[i]! - px;
		const ay = polyY[i]! - py;
		const bx = polyX[j]! - px;
		const by = polyY[j]! - py;
		const area = ax * by - ay * bx; // 2x signed triangle area (x, P_i, P_j)
		const dot = ax * bx + ay * by;
		if (Math.abs(area) < eps && dot < 0) {
			// Point lies on edge (i, j): linear blend of the two endpoints.
			const ri = scratchR[i]!;
			const rj = scratchR[j]!;
			const total = ri + rj;
			outWeights.fill(0, 0, bins);
			outWeights[i] = total > eps ? rj / total : 0.5;
			outWeights[j] = total > eps ? ri / total : 0.5;
			return;
		}
		scratchTan[i] = Math.abs(area) < eps ? 0 : (scratchR[i]! * scratchR[j]! - dot) / area;
	}

	let sum = 0;
	for (let i = 0; i < bins; i++) {
		const prev = (i - 1 + bins) % bins;
		const w = (scratchTan[prev]! + scratchTan[i]!) / scratchR[i]!;
		outWeights[i] = w;
		sum += w;
	}

	if (Math.abs(sum) < eps) {
		const uniform = 1 / bins;
		outWeights.fill(uniform, 0, bins);
		return;
	}
	const inv = 1 / sum;
	for (let i = 0; i < bins; i++) outWeights[i]! *= inv;
}

/**
 * Loop profiles store all signal in the right arrays, but mirroring an element to the
 * other foot swaps right↔left. Combining recovers the per-bin offset either way.
 */
function combinedOffset(right: number[] | undefined, left: number[] | undefined, i: number): number {
	return (right?.[i] ?? 0) + (left?.[i] ?? 0);
}

function profileHasFootprintSignal(profile: TrimlineHandleProfile): boolean {
	const bins = profile.bins;
	for (let i = 0; i < bins; i++) {
		if (Math.abs(combinedOffset(profile.rightOffsetsMm, profile.leftOffsetsMm, i)) > SIGNAL_EPS) {
			return true;
		}
	}
	return false;
}

/**
 * Bakes an interactive element trimline edit into the pad geometry.
 *
 * The saved profile holds per-bin outward (width) and height offsets in mm relative to
 * the element's untrimmed silhouette. We re-extract the pad's base loop contour as a
 * deformation cage, build the dragged target loop (base + offset along each outward
 * normal), and remap every vertex through its mean-value coordinates in that cage. The
 * whole footprint reflows into the new outline — perimeter on the line, interior filled
 * smoothly — instead of only sliding a rim band. Mutates `geometry` in place.
 */
export function applyElementTrimlineFootprint(
	geometry: THREE.BufferGeometry,
	profile: TrimlineHandleProfile | null | undefined,
	mmToWorld: number,
): void {
	if (!profile || profile.bins <= 1 || mmToWorld <= 0) return;
	if (!profileHasFootprintSignal(profile)) return;

	const contour = extractElementContour(geometry, profile.bins);
	if (
		!contour ||
		contour.layout !== 'loop' ||
		!contour.loopPos ||
		!contour.loopNormals
	) {
		return;
	}

	const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!positions) return;

	const bins = contour.bins;
	const { lengthAxis, widthAxis } = contour;
	const li = AXIS_INDEX[lengthAxis];
	const wi = AXIS_INDEX[widthAxis];

	// Base loop = deformation cage; target loop = dragged silhouette (base + offset).
	const loopL = new Float32Array(bins);
	const loopW = new Float32Array(bins);
	const targetL = new Float32Array(bins);
	const targetW = new Float32Array(bins);

	for (let i = 0; i < bins; i++) {
		const ri = i * 3;
		const bL = contour.loopPos[ri + li]!;
		const bW = contour.loopPos[ri + wi]!;
		loopL[i] = bL;
		loopW[i] = bW;
		const offWidthWorld =
			combinedOffset(profile.rightOffsetsMm, profile.leftOffsetsMm, i) * mmToWorld;
		targetL[i] = bL + contour.loopNormals[ri + li]! * offWidthWorld;
		targetW[i] = bW + contour.loopNormals[ri + wi]! * offWidthWorld;
	}

	// Reconstruct every pad vertex from its mean-value weights in the base cage so the
	// whole footprint reflows into the dragged outline instead of folding at the rim.
	const weights = new Float64Array(bins);
	const scratchR = new Float64Array(bins);
	const scratchTan = new Float64Array(bins);

	for (let v = 0; v < positions.count; v++) {
		const L = getAxisValue(positions, v, lengthAxis);
		const W = getAxisValue(positions, v, widthAxis);

		meanValueWeights(L, W, loopL, loopW, bins, weights, scratchR, scratchTan);

		let newL = 0;
		let newW = 0;
		for (let i = 0; i < bins; i++) {
			const w = weights[i]!;
			if (w === 0) continue;
			newL += w * targetL[i]!;
			newW += w * targetW[i]!;
		}

		setAxisValue(positions, v, lengthAxis, newL);
		setAxisValue(positions, v, widthAxis, newW);
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
}

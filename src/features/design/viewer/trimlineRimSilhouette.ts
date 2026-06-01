import * as THREE from 'three';

import type { TrimlineHandleProfile, TrimlineHandleProfilePoint } from '@/src/shared/components/design/TrimlineEditOverlay';
import { getAxisValue, getGeometryAxes, getMinForAxis } from '@/src/features/design/utils/geometryAxes';

// Lateral band: footbed interior stays put, only the outer wall reshapes.
const EDGE_INNER_THRESHOLD = 0.55;
const EDGE_OUTER_THRESHOLD = 0.9;
// Threshold used when sampling which vertices define the wall rim top per bin.
const RIM_SAMPLE_THRESHOLD = 0.5;
// Vertical falloff: how far below the rim the displacement fades to zero.
const RIM_BAND_MM = 12;

type AxisName = 'x' | 'y' | 'z';

/** A side contour as flat (length, width) pairs, one per bin, in mesh-local space. */
interface SidePolyline {
	length: Float32Array;
	width: Float32Array;
	bins: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-9, edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

function smoothBins(src: Float32Array): Float32Array {
	const out = new Float32Array(src.length);
	for (let i = 0; i < src.length; i++) {
		const a = src[Math.max(0, i - 2)]!;
		const b = src[Math.max(0, i - 1)]!;
		const c = src[i]!;
		const d = src[Math.min(src.length - 1, i + 1)]!;
		const e = src[Math.min(src.length - 1, i + 2)]!;
		out[i] = a * 0.1 + b * 0.2 + c * 0.4 + d * 0.2 + e * 0.1;
	}
	return out;
}

function sampleArray(values: Float32Array, t: number): number {
	const tt = Math.max(0, Math.min(1, t));
	const scaled = tt * Math.max(0, values.length - 1);
	const i0 = Math.floor(scaled);
	const i1 = Math.min(values.length - 1, i0 + 1);
	const f = scaled - i0;
	return values[i0]! + (values[i1]! - values[i0]!) * f;
}

function buildHeightOffsets(profile: TrimlineHandleProfile): {
	right: Float32Array;
	left: Float32Array;
	hasSignal: boolean;
} {
	const bins = profile.bins;
	const right = new Float32Array(bins);
	const left = new Float32Array(bins);
	const rightSrc = profile.rightHeightOffsetsMm;
	const leftSrc = profile.leftHeightOffsetsMm;
	let hasSignal = false;

	for (let i = 0; i < bins; i++) {
		const r = rightSrc?.length === bins ? rightSrc[i]! : 0;
		const l = leftSrc?.length === bins ? leftSrc[i]! : 0;
		right[i] = r;
		left[i] = l;
		if (Math.abs(r) > 1e-9 || Math.abs(l) > 1e-9) hasSignal = true;
	}

	return { right: smoothBins(right), left: smoothBins(left), hasSignal };
}

function fillMissingBins(values: Float32Array, fallback: number): void {
	for (let i = 0; i < values.length; i++) {
		if (Number.isFinite(values[i]!)) continue;
		let left = i - 1;
		let right = i + 1;
		while (left >= 0 && !Number.isFinite(values[left]!)) left--;
		while (right < values.length && !Number.isFinite(values[right]!)) right++;
		if (left >= 0 && right < values.length) values[i] = (values[left]! + values[right]!) * 0.5;
		else if (left >= 0) values[i] = values[left]!;
		else if (right < values.length) values[i] = values[right]!;
		else values[i] = fallback;
	}
}

function pointAxisValue(point: TrimlineHandleProfilePoint, axis: AxisName): number {
	if (axis === 'x') return point.x;
	if (axis === 'y') return point.y;
	return point.z;
}

/**
 * Splits the captured closed-loop contour into per-side (length, width) polylines so
 * vertices can be located by their actual silhouette position rather than a linear
 * length fraction. Returns null when points3D is absent or malformed.
 */
function buildSidePolylines(
	profile: TrimlineHandleProfile,
	lengthAxis: AxisName,
	widthAxis: AxisName,
): { right: SidePolyline; left: SidePolyline } | null {
	const bins = profile.bins;
	const points = profile.points3D;
	if (!points || points.length !== bins * 2 || bins <= 1) return null;

	const build = (offset: number): SidePolyline => {
		const length = new Float32Array(bins);
		const width = new Float32Array(bins);
		for (let i = 0; i < bins; i++) {
			const point = points[offset + i]!;
			length[i] = pointAxisValue(point, lengthAxis);
			width[i] = pointAxisValue(point, widthAxis);
		}
		return { length, width, bins };
	};

	return { right: build(0), left: build(bins) };
}

/**
 * Projects a vertex's (length, width) onto the side contour polyline and returns the
 * fractional bin index of the nearest point, so the rim edit lands exactly under the
 * captured silhouette regardless of arc-length vs linear-length spacing.
 */
function projectToContourBin(lengthVal: number, widthVal: number, polyline: SidePolyline): number {
	const { length, width, bins } = polyline;
	let bestBin = 0;
	let bestDistSq = Number.POSITIVE_INFINITY;

	for (let k = 0; k < bins - 1; k++) {
		const aL = length[k]!;
		const aW = width[k]!;
		const bL = length[k + 1]!;
		const bW = width[k + 1]!;
		const dL = bL - aL;
		const dW = bW - aW;
		const segLenSq = dL * dL + dW * dW;
		let u = 0;
		if (segLenSq > 1e-12) {
			u = ((lengthVal - aL) * dL + (widthVal - aW) * dW) / segLenSq;
			u = Math.max(0, Math.min(1, u));
		}
		const projL = aL + dL * u;
		const projW = aW + dW * u;
		const distSq = (lengthVal - projL) ** 2 + (widthVal - projW) ** 2;
		if (distSq < bestDistSq) {
			bestDistSq = distSq;
			bestBin = k + u;
		}
	}

	return Math.max(0, Math.min(bins - 1, bestBin));
}

/**
 * Reshapes only the outer wall rim toward the dragged trimline silhouette.
 *
 * Runs in the final emitted geometry space (the same space the gizmo edits). The cut
 * is placed by projecting each wall vertex onto the captured contour (`points3D`), so
 * the relative per-bin height offsets land exactly under the drawn silhouette. Right/
 * left split on width sign, matching `extractContour`.
 */
export function applyTrimlineRimSilhouette(
	geometry: THREE.BufferGeometry,
	profile: TrimlineHandleProfile,
	mmToWorld: number,
): void {
	const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!positions || profile.bins <= 1 || mmToWorld <= 0) return;

	const offsets = buildHeightOffsets(profile);
	if (!offsets.hasSignal) return;

	geometry.computeBoundingBox();
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);
	const minLength = getMinForAxis(bbox, lengthAxis);
	const safeLengthSpan = Math.max(1e-6, lengthSpan);
	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan * 0.5;
	const halfWidth = Math.max(1e-6, widthSpan * 0.5);
	const bins = profile.bins;

	const sidePolylines = buildSidePolylines(profile, lengthAxis, widthAxis);

	// t in [0,1] from heel (length-min) to toe. When the captured contour is available
	// we locate the vertex on it (exact silhouette placement); otherwise fall back to a
	// linear length fraction so legacy profiles without points3D still apply.
	const paramFor = (lengthVal: number, widthVal: number, isRight: boolean): number => {
		if (sidePolylines) {
			const polyline = isRight ? sidePolylines.right : sidePolylines.left;
			return projectToContourBin(lengthVal, widthVal, polyline) / (bins - 1);
		}
		return Math.max(0, Math.min(1, (lengthVal - minLength) / safeLengthSpan));
	};

	// Wall rim top per bin, per side, built only from outer-wall vertices (so the
	// arch/footbed never counts as the rim) and located with the same projection.
	const rightRim = new Float32Array(bins).fill(Number.NEGATIVE_INFINITY);
	const leftRim = new Float32Array(bins).fill(Number.NEGATIVE_INFINITY);

	for (let i = 0; i < positions.count; i++) {
		const widthVal = getAxisValue(positions, i, widthAxis);
		const sideRatio = Math.min(1, Math.abs(widthVal - centerWidth) / halfWidth);
		if (sideRatio < RIM_SAMPLE_THRESHOLD) continue;
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const isRight = widthVal >= centerWidth;
		const bin = Math.min(bins - 1, Math.max(0, Math.round(paramFor(lengthVal, widthVal, isRight) * (bins - 1))));
		const heightVal = getAxisValue(positions, i, heightAxis);
		const rim = isRight ? rightRim : leftRim;
		if (heightVal > rim[bin]!) rim[bin] = heightVal;
	}

	fillMissingBins(rightRim, bbox.max[heightAxis]);
	fillMissingBins(leftRim, bbox.max[heightAxis]);
	const smoothedRightRim = smoothBins(rightRim);
	const smoothedLeftRim = smoothBins(leftRim);

	const rimBandWorld = RIM_BAND_MM * mmToWorld;

	for (let i = 0; i < positions.count; i++) {
		const widthVal = getAxisValue(positions, i, widthAxis);
		const sideRatio = Math.min(1, Math.abs(widthVal - centerWidth) / halfWidth);
		const lateralEdgeWeight = smoothstep(EDGE_INNER_THRESHOLD, EDGE_OUTER_THRESHOLD, sideRatio);
		if (lateralEdgeWeight <= 1e-4) continue;

		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const isRight = widthVal >= centerWidth;
		const t = paramFor(lengthVal, widthVal, isRight);
		const offsetWorld = sampleArray(isRight ? offsets.right : offsets.left, t) * mmToWorld;
		if (Math.abs(offsetWorld) <= 1e-8) continue;

		const heightVal = getAxisValue(positions, i, heightAxis);
		const rimTop = sampleArray(isRight ? smoothedRightRim : smoothedLeftRim, t);
		const distanceBelowRim = Math.max(0, rimTop - heightVal);
		const rimBandWeight = 1 - smoothstep(0, rimBandWorld, distanceBelowRim);
		const weight = lateralEdgeWeight * rimBandWeight;
		if (weight <= 1e-4) continue;

		const nextHeight = heightVal + offsetWorld * weight;
		if (heightAxis === 'x') positions.setX(i, nextHeight);
		else if (heightAxis === 'y') positions.setY(i, nextHeight);
		else positions.setZ(i, nextHeight);
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
}

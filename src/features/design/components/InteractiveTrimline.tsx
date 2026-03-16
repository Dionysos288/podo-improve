'use client';

import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type {
	TrimlineAdjustments,
	TrimlineHandleProfile,
} from '@/src/shared/components/design/TrimlineEditOverlay';

// ── Types ──────────────────────────────────────────────────────────────
type RegionKey = 'heel' | 'midfoot' | 'forefoot' | 'toe';

function tToRegion(t: number): RegionKey {
	if (t <= 0.25) return 'heel';
	if (t <= 0.55) return 'midfoot';
	if (t <= 0.82) return 'forefoot';
	return 'toe';
}

const REGION_COLORS: Record<RegionKey, THREE.Color> = {
	heel: new THREE.Color('#ef4444'),
	midfoot: new THREE.Color('#22c55e'),
	forefoot: new THREE.Color('#3b82f6'),
	toe: new THREE.Color('#f59e0b'),
};
const COLOR_WHITE = new THREE.Color('#ffffff');
const COLOR_HOVER = new THREE.Color('#56f2d6');
const COLOR_SELECTED = new THREE.Color('#a78bfa'); // purple for multi-selected

function smoothstep(e0: number, e1: number, v: number): number {
	const c = Math.max(0, Math.min(1, (v - e0) / Math.max(1e-6, e1 - e0)));
	return c * c * (3 - 2 * c);
}

function regionWeights(t: number) {
	return {
		heel: 1 - smoothstep(0.22, 0.28, t),
		midfoot: smoothstep(0.22, 0.28, t) * (1 - smoothstep(0.52, 0.58, t)),
		forefoot: smoothstep(0.52, 0.58, t) * (1 - smoothstep(0.79, 0.85, t)),
		toe: smoothstep(0.79, 0.85, t),
	};
}

/** Convert per-handle offsets back to region-based TrimlineAdjustments via weighted average */
function handleOffsetsToAdjustments(
	offsets: Float32Array,
	tValues: Float32Array,
	base: TrimlineAdjustments,
): TrimlineAdjustments {
	const regionSum: Record<RegionKey, number> = { heel: 0, midfoot: 0, forefoot: 0, toe: 0 };
	const regionWeight: Record<RegionKey, number> = { heel: 0, midfoot: 0, forefoot: 0, toe: 0 };

	for (let i = 0; i < offsets.length; i++) {
		const w = regionWeights(tValues[i]);
		const off = offsets[i];
		regionSum.heel += off * w.heel;
		regionSum.midfoot += off * w.midfoot;
		regionSum.forefoot += off * w.forefoot;
		regionSum.toe += off * w.toe;
		regionWeight.heel += w.heel;
		regionWeight.midfoot += w.midfoot;
		regionWeight.forefoot += w.forefoot;
		regionWeight.toe += w.toe;
	}

	const snap = (v: number) => Math.max(-5, Math.min(8, Math.round(v * 2) / 2));
	return {
		global: base.global,
		heel: snap(regionWeight.heel > 0.01 ? regionSum.heel / regionWeight.heel : base.heel),
		midfoot: snap(regionWeight.midfoot > 0.01 ? regionSum.midfoot / regionWeight.midfoot : base.midfoot),
		forefoot: snap(regionWeight.forefoot > 0.01 ? regionSum.forefoot / regionWeight.forefoot : base.forefoot),
		toe: snap(regionWeight.toe > 0.01 ? regionSum.toe / regionWeight.toe : base.toe),
	};
}

function buildHandleProfile(
	offsets: Float32Array,
	tValues: Float32Array,
	bins: number,
): TrimlineHandleProfile {
	return {
		bins,
		tValues: Array.from(tValues.slice(0, bins)),
		rightOffsetsMm: Array.from(offsets.slice(0, bins)),
		leftOffsetsMm: Array.from(offsets.slice(bins, bins * 2)),
	};
}

// ── Smoothing helper ───────────────────────────────────────────────────
const SMOOTH_RADIUS = 4;

/** Apply deltaMm to dragged indices with gaussian falloff to neighbors on same side */
function applyDeltaWithSmoothing(
	offsets: Float32Array,
	startOffsets: Float32Array,
	draggedIndices: number[],
	deltaMm: number,
	bins: number,
	radius: number,
) {
	const sigma = radius / 2.0;
	const effects = new Float32Array(offsets.length);

	for (const idx of draggedIndices) {
		const side = idx < bins ? 0 : bins;
		const binIdx = idx - side;
		for (let d = -radius; d <= radius; d++) {
			const nb = binIdx + d;
			if (nb < 0 || nb >= bins) continue;
			const nbIdx = nb + side;
			const falloff = d === 0 ? 1.0 : Math.exp(-0.5 * (d / sigma) ** 2);
			const effect = deltaMm * falloff;
			// Take strongest absolute effect if multiple dragged handles overlap
			if (Math.abs(effect) > Math.abs(effects[nbIdx])) {
				effects[nbIdx] = effect;
			}
		}
	}

	for (let i = 0; i < offsets.length; i++) {
		if (effects[i] !== 0) {
			offsets[i] = Math.max(-5, Math.min(8, startOffsets[i] + effects[i]));
		}
	}
}

// ── Contour extraction ─────────────────────────────────────────────────
interface ContourData {
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

function extractContour(
	geometry: THREE.BufferGeometry,
	bins = 48,
): ContourData | null {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	if (!bbox) return null;

	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	const heightAxis = axes[0];
	const widthAxis = axes[1];
	const lengthAxis = axes[2];

	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos || pos.count < 32) return null;

	const centerW = (bbox.min[widthAxis] + bbox.max[widthAxis]) * 0.5;
	const centerL = (bbox.min[lengthAxis] + bbox.max[lengthAxis]) * 0.5;

	const ai = { x: 0, y: 1, z: 2 } as const;
	const li = ai[lengthAxis], wi = ai[widthAxis], hi = ai[heightAxis];

	// ── Height-based filtering ──
	// On insoles with beveled rims the bottom surface can extend beyond
	// the visible top edge.  We prefer upper-portion vertices so the
	// contour matches what the user sees from the top-down view.
	const minH = bbox.min[heightAxis];
	const maxH = bbox.max[heightAxis];
	const hRange = Math.max(1e-6, maxH - minH);
	const hThreshold = minH + hRange * 0.35; // keep top ~65 %

	// ── Polar sweep: find farthest vertex at each angle around centroid ──
	// angle 0 = toe (+length), π/2 = right (+width), π = heel (-length), 3π/2 = left (-width)
	const SWEEP = bins * 6;
	const angStep = (2 * Math.PI) / SWEEP;

	const sweepL = new Float32Array(SWEEP);
	const sweepW = new Float32Array(SWEEP);
	const sweepH = new Float32Array(SWEEP);
	const sweepDist = new Float32Array(SWEEP); // 0 = no vertex found

	// Secondary arrays for upper-portion vertices (preferred)
	const topL = new Float32Array(SWEEP);
	const topW = new Float32Array(SWEEP);
	const topH = new Float32Array(SWEEP);
	const topDist = new Float32Array(SWEEP);

	for (let i = 0; i < pos.count; i++) {
		const lv = pos.array[i * 3 + li];
		const wv = pos.array[i * 3 + wi];
		const hv = pos.array[i * 3 + hi];
		const dl = lv - centerL;
		const dw = wv - centerW;
		const dist = Math.sqrt(dl * dl + dw * dw);

		let ang = Math.atan2(dw, dl); // atan2(width, length)
		if (ang < 0) ang += 2 * Math.PI;
		const bin = Math.round(ang / angStep) % SWEEP;

		// Track overall farthest (fallback)
		if (dist > sweepDist[bin]) {
			sweepDist[bin] = dist;
			sweepL[bin] = lv;
			sweepW[bin] = wv;
			sweepH[bin] = hv;
		}

		// Track farthest among upper-portion vertices (preferred)
		if (hv >= hThreshold && dist > topDist[bin]) {
			topDist[bin] = dist;
			topL[bin] = lv;
			topW[bin] = wv;
			topH[bin] = hv;
		}
	}

	// Use upper-vertex data where available; fall back to overall data
	for (let i = 0; i < SWEEP; i++) {
		if (topDist[i] > 0) {
			sweepL[i] = topL[i];
			sweepW[i] = topW[i];
			sweepH[i] = topH[i];
			sweepDist[i] = topDist[i];
		}
	}

	// Fill empty bins by circular interpolation
	for (let i = 0; i < SWEEP; i++) {
		if (sweepDist[i] > 0) continue;
		let lk = 1, rk = 1;
		while (lk < SWEEP && sweepDist[(i - lk + SWEEP) % SWEEP] <= 0) lk++;
		while (rk < SWEEP && sweepDist[(i + rk) % SWEEP] <= 0) rk++;
		const lIdx = (i - lk + SWEEP) % SWEEP;
		const rIdx = (i + rk) % SWEEP;
		if (sweepDist[lIdx] > 0 && sweepDist[rIdx] > 0) {
			const blend = lk / (lk + rk);
			sweepL[i] = sweepL[lIdx] * (1 - blend) + sweepL[rIdx] * blend;
			sweepW[i] = sweepW[lIdx] * (1 - blend) + sweepW[rIdx] * blend;
			sweepH[i] = sweepH[lIdx] * (1 - blend) + sweepH[rIdx] * blend;
			sweepDist[i] = 1; // mark filled
		}
	}

	// Smooth boundary (4 passes, circular)
	for (let p = 0; p < 4; p++) {
		const tL = sweepL.slice(), tW = sweepW.slice(), tH = sweepH.slice();
		for (let i = 0; i < SWEEP; i++) {
			const a2 = (i - 2 + SWEEP) % SWEEP;
			const a1 = (i - 1 + SWEEP) % SWEEP;
			const b1 = (i + 1) % SWEEP;
			const b2 = (i + 2) % SWEEP;
			sweepL[i] = tL[a2] * 0.06 + tL[a1] * 0.24 + tL[i] * 0.4 + tL[b1] * 0.24 + tL[b2] * 0.06;
			sweepW[i] = tW[a2] * 0.06 + tW[a1] * 0.24 + tW[i] * 0.4 + tW[b1] * 0.24 + tW[b2] * 0.06;
			sweepH[i] = tH[a2] * 0.06 + tH[a1] * 0.24 + tH[i] * 0.4 + tH[b1] * 0.24 + tH[b2] * 0.06;
		}
	}

	// ── Split into right and left halves ──
	// heelBin = angle π (negative length direction)
	const heelBin = Math.round(SWEEP / 2);
	// toeBin = angle 0/2π (positive length direction)

	// Interpolate a sweep position at a fractional index
	const sampleSweep = (idx: number): [number, number, number] => {
		let wrapped = idx % SWEEP;
		if (wrapped < 0) wrapped += SWEEP;
		const i0 = Math.floor(wrapped);
		const i1 = (i0 + 1) % SWEEP;
		const frac = wrapped - i0;
		return [
			sweepL[i0] * (1 - frac) + sweepL[i1] * frac,
			sweepW[i0] * (1 - frac) + sweepW[i1] * frac,
			sweepH[i0] * (1 - frac) + sweepH[i1] * frac,
		];
	};

	// Right half: from heelBin (angle π) DECREASING to 0 (angle 0 = toe)
	// Left half: from heelBin (angle π) INCREASING to SWEEP (angle 2π = toe)

	// ── Arc-length resampling for even handle spacing ──
	// Compute cumulative arc length along each half of the sweep
	const rightSweepLen = heelBin; // number of sweep steps for right half
	const leftSweepLen = SWEEP - heelBin; // number of sweep steps for left half

	const computeArcParams = (startIdx: number, endIdx: number, direction: 1 | -1) => {
		const steps = Math.abs(endIdx - startIdx);
		const cumLen = new Float64Array(steps + 1);
		cumLen[0] = 0;
		for (let k = 1; k <= steps; k++) {
			const curSweep = startIdx + direction * k;
			const prevSweep = startIdx + direction * (k - 1);
			const [cL, cW] = sampleSweep(curSweep);
			const [pL, pW] = sampleSweep(prevSweep);
			const dl = cL - pL, dw = cW - pW;
			cumLen[k] = cumLen[k - 1] + Math.sqrt(dl * dl + dw * dw);
		}
		return cumLen;
	};

	// Right: heelBin → 0 (decreasing)
	const rArc = computeArcParams(heelBin, 0, -1);
	const rTotalLen = rArc[rightSweepLen];
	// Left: heelBin → SWEEP (increasing)
	const lArc = computeArcParams(heelBin, heelBin + leftSweepLen, 1);
	const lTotalLen = lArc[leftSweepLen];

	// Find sweep index for a target arc-length by binary search
	const arcToSweepStep = (cumLen: Float64Array, targetLen: number): number => {
		let lo = 0, hi = cumLen.length - 1;
		while (lo < hi - 1) {
			const mid = (lo + hi) >> 1;
			if (cumLen[mid] < targetLen) lo = mid; else hi = mid;
		}
		const segLen = cumLen[hi] - cumLen[lo];
		const frac = segLen > 1e-12 ? (targetLen - cumLen[lo]) / segLen : 0;
		return lo + frac;
	};

	const tValues = new Float32Array(bins);
	const rightPos = new Float32Array(bins * 3);
	const leftPos = new Float32Array(bins * 3);
	const rightHalfW = new Float32Array(bins);
	const leftHalfW = new Float32Array(bins);

	for (let i = 0; i < bins; i++) {
		const t = i / (bins - 1); // 0 = heel, 1 = toe
		tValues[i] = t;
		const ri = i * 3;

		// Right half: find sweep index by arc-length
		const rStep = arcToSweepStep(rArc, t * rTotalLen);
		const rSweepIdx = heelBin - rStep; // decreasing from heelBin
		const [rL, rW, rH] = sampleSweep(rSweepIdx);
		rightPos[ri + li] = rL;
		rightPos[ri + wi] = rW;
		rightPos[ri + hi] = rH;
		rightHalfW[i] = Math.max(0, rW - centerW);

		// Left half: find sweep index by arc-length
		const lStep = arcToSweepStep(lArc, t * lTotalLen);
		const lSweepIdx = heelBin + lStep; // increasing from heelBin
		const [lL, lW, lH] = sampleSweep(lSweepIdx);
		leftPos[ri + li] = lL;
		leftPos[ri + wi] = lW;
		leftPos[ri + hi] = lH;
		leftHalfW[i] = Math.max(0, centerW - lW);
	}

	// ── Compute per-handle outward normals ──
	const rightNormals = new Float32Array(bins * 3);
	const leftNormals = new Float32Array(bins * 3);

	for (let i = 0; i < bins; i++) {
		const prev = Math.max(0, i - 1);
		const next = Math.min(bins - 1, i + 1);
		const rp = prev * 3, rn = next * 3, ri = i * 3;

		// Right side tangent → normal (CCW then verify outward)
		{
			const tL = rightPos[rn + li] - rightPos[rp + li];
			const tW = rightPos[rn + wi] - rightPos[rp + wi];
			let nL = -tW, nW = tL; // 90° CCW
			let mag = Math.sqrt(nL * nL + nW * nW);
			if (mag < 1e-8) { nL = 0; nW = 1; mag = 1; }
			nL /= mag; nW /= mag;
			// Ensure outward (away from centroid)
			const dirL = rightPos[ri + li] - centerL;
			const dirW = rightPos[ri + wi] - centerW;
			if (nL * dirL + nW * dirW < 0) { nL = -nL; nW = -nW; }
			rightNormals[ri + li] = nL;
			rightNormals[ri + wi] = nW;
			rightNormals[ri + hi] = 0;
		}

		// Left side tangent → normal (CCW then verify outward)
		{
			const tL = leftPos[rn + li] - leftPos[rp + li];
			const tW = leftPos[rn + wi] - leftPos[rp + wi];
			let nL = -tW, nW = tL; // 90° CCW
			let mag = Math.sqrt(nL * nL + nW * nW);
			if (mag < 1e-8) { nL = 0; nW = -1; mag = 1; }
			nL /= mag; nW /= mag;
			// Ensure outward (away from centroid)
			const dirL = leftPos[ri + li] - centerL;
			const dirW = leftPos[ri + wi] - centerW;
			if (nL * dirL + nW * dirW < 0) { nL = -nL; nW = -nW; }
			leftNormals[ri + li] = nL;
			leftNormals[ri + wi] = nW;
			leftNormals[ri + hi] = 0;
		}
	}

	return {
		rightPos,
		leftPos,
		tValues,
		rightHalfW: rightHalfW,
		leftHalfW: leftHalfW,
		rightNormals,
		leftNormals,
		widthAxis,
		lengthAxis,
		heightAxis,
		bins,
		centerW,
	};
}

// ── Outline line ───────────────────────────────────────────────────────
function OutlineLine({ geometry }: { geometry: THREE.BufferGeometry }) {
	const lineObj = useMemo(() => {
		const mat = new THREE.LineBasicMaterial({
			color: '#56f2d6',
			linewidth: 2,
			transparent: true,
			opacity: 0.7,
			depthTest: false,
		});
		const line = new THREE.Line(geometry, mat);
		line.renderOrder = 10;
		return line;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		lineObj.geometry = geometry;
	}, [geometry, lineObj]);

	useEffect(
		() => () => { (lineObj.material as THREE.Material).dispose(); },
		[lineObj]
	);

	return <primitive object={lineObj} />;
}

// ── Main component ─────────────────────────────────────────────────────
interface InteractiveTrimlineProps {
	insoleGeometry: THREE.BufferGeometry | null;
	adjustments: TrimlineAdjustments;
	onPendingChange: (adj: TrimlineAdjustments) => void;
	onPendingProfileChange?: (profile: TrimlineHandleProfile) => void;
	profile?: TrimlineHandleProfile | null;
	side: 'left' | 'right';
	mmToWorld: number;
	active: boolean;
}

const HANDLE_RADIUS = 0.45;
const HANDLE_RADIUS_HOVER = 0.65;

function getEndpointPair(idx: number, bins: number): number[] {
	if (idx === 0 || idx === bins) return [0, bins];
	if (idx === bins - 1 || idx === bins * 2 - 1) return [bins - 1, bins * 2 - 1];
	return [idx];
}

function expandEndpointSelection(indices: number[], bins: number): number[] {
	const expanded = new Set<number>();
	for (const idx of indices) {
		for (const paired of getEndpointPair(idx, bins)) expanded.add(paired);
	}
	return Array.from(expanded);
}

/** Shared geometry for all handles — created once */
const _sphereGeo = new THREE.SphereGeometry(1, 8, 6);

export function InteractiveTrimline({
	insoleGeometry,
	adjustments,
	onPendingChange,
	onPendingProfileChange,
	profile,
	mmToWorld,
	active,
}: InteractiveTrimlineProps) {
	const { camera, gl } = useThree();
	const groupRef = useRef<THREE.Group>(null);
	const instanceRef = useRef<THREE.InstancedMesh>(null);

	// ── Contour (recomputes only when geometry prop changes) ──
	const contour = useMemo(() => {
		if (!insoleGeometry) return null;
		return extractContour(insoleGeometry, 48);
	}, [insoleGeometry]);

	// Total handles = bins on each side
	const handleCount = contour ? contour.bins * 2 : 0;

	// ── Per-handle offset in mm (the user's edits) ──
	// Length = handleCount. Index 0..bins-1 = right side, bins..2*bins-1 = left side.
	const offsetsRef = useRef<Float32Array>(new Float32Array(0));
	const tValuesRef = useRef<Float32Array>(new Float32Array(0));

	// Serialize adjustments values so the effect only fires when actual
	// numeric values change — not when the parent passes a new object ref.
	const adjKey = `${adjustments.global},${adjustments.heel},${adjustments.midfoot},${adjustments.forefoot},${adjustments.toe}`;
	const profileKey = profile
		? `${profile.bins}|${profile.rightOffsetsMm.join(',')}|${profile.leftOffsetsMm.join(',')}`
		: '';

	// Initialize offsets from adjustments when contour or committed adjustments change
	useEffect(() => {
		if (!contour) return;
		const n = contour.bins * 2;
		const offsets = new Float32Array(n);
		const tVals = new Float32Array(n);
		const canUseProfile =
			!!profile &&
			profile.bins === contour.bins &&
			profile.rightOffsetsMm.length === contour.bins &&
			profile.leftOffsetsMm.length === contour.bins;

		for (let i = 0; i < contour.bins; i++) {
			const t = contour.tValues[i];
			tVals[i] = t;
			tVals[i + contour.bins] = t;
			if (canUseProfile) {
				offsets[i] = profile.rightOffsetsMm[i] ?? 0;
				offsets[i + contour.bins] = profile.leftOffsetsMm[i] ?? 0;
				continue;
			}
			const w = regionWeights(t);
			const adj =
				adjustments.heel * w.heel +
				adjustments.midfoot * w.midfoot +
				adjustments.forefoot * w.forefoot +
				adjustments.toe * w.toe;
			offsets[i] = adj; // right side
			offsets[i + contour.bins] = adj; // left side
		}
		offsetsRef.current = offsets;
		tValuesRef.current = tVals;
		// Force initial instance update
		needsInstanceUpdate.current = true;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [contour, adjKey, profileKey]);

	// ── Selection / hover state ──
	const [hoveredIdx, setHoveredIdx] = useState<number>(-1);
	const selectedSet = useRef<Set<number>>(new Set());
	const [selectedVersion, setSelectedVersion] = useState(0); // bump to trigger color re-render
	const [isDragging, setIsDragging] = useState(false);

	// ── Drag refs (screen-space approach) ──
	const dragging = useRef(false);
	const dragStartNDC = useRef(new THREE.Vector2());
	/** NDC units per +1 mm along the width axis (for each dragged handle) */
	const dragNdcPerMm = useRef(new THREE.Vector2());
	const dragStartOffsets = useRef<Float32Array>(new Float32Array(0));
	const dragHandleIndices = useRef<number[]>([]);

	// ── Multi-select box drag refs ──
	const boxSelecting = useRef(false);
	const boxStartNDC = useRef(new THREE.Vector2());
	const boxCurrentNDC = useRef(new THREE.Vector2());
	const boxOverlayRef = useRef<HTMLDivElement | null>(null);

	const needsInstanceUpdate = useRef(true);

	const hiddenHandleSet = useMemo(() => {
		if (!contour) return new Set<number>();
		return new Set<number>([contour.bins, contour.bins * 2 - 1]);
	}, [contour]);

	const getSharedEndpointPosition = useCallback((endpoint: 0 | 1) => {
		if (!contour) return null;
		const { bins, rightPos, leftPos, rightNormals, leftNormals } = contour;
		const pointIdx = endpoint === 0 ? 0 : bins - 1;
		const ri = pointIdx * 3;
		const leftIdx = pointIdx + bins;
		const offsets = offsetsRef.current;
		const rightOff = offsets.length > pointIdx ? offsets[pointIdx] * mmToWorld : 0;
		const leftOff = offsets.length > leftIdx ? offsets[leftIdx] * mmToWorld : 0;
		return new THREE.Vector3(
			(
				rightPos[ri + 0] + rightOff * rightNormals[ri + 0] +
				leftPos[ri + 0] + leftOff * leftNormals[ri + 0]
			) * 0.5,
			(
				rightPos[ri + 1] + rightOff * rightNormals[ri + 1] +
				leftPos[ri + 1] + leftOff * leftNormals[ri + 1]
			) * 0.5,
			(
				rightPos[ri + 2] + rightOff * rightNormals[ri + 2] +
				leftPos[ri + 2] + leftOff * leftNormals[ri + 2]
			) * 0.5,
		);
	}, [contour, mmToWorld]);

	// ── Build outline geometry ──
	const outlineGeo = useMemo(() => {
		if (!contour) return null;
		const { bins, rightPos, leftPos, rightNormals, leftNormals } = contour;
		const offsets = offsetsRef.current;
		const mm = mmToWorld;

		const pts: THREE.Vector3[] = [];
		const heelShared = getSharedEndpointPosition(0);
		const toeShared = getSharedEndpointPosition(1);
		if (heelShared) pts.push(heelShared);
		// Right side: heel→toe, skipping shared endpoints
		for (let i = 1; i < bins - 1; i++) {
			const ri = i * 3;
			const off = offsets.length > i ? offsets[i] * mm : 0;
			pts.push(new THREE.Vector3(
				rightPos[ri + 0] + off * rightNormals[ri + 0],
				rightPos[ri + 1] + off * rightNormals[ri + 1],
				rightPos[ri + 2] + off * rightNormals[ri + 2],
			));
		}
		if (toeShared) pts.push(toeShared);
		// Left side: toe→heel, skipping shared endpoints
		for (let i = bins - 2; i >= 1; i--) {
			const ri = i * 3;
			const off = offsets.length > i + bins ? offsets[i + bins] * mm : 0;
			pts.push(new THREE.Vector3(
				leftPos[ri + 0] + off * leftNormals[ri + 0],
				leftPos[ri + 1] + off * leftNormals[ri + 1],
				leftPos[ri + 2] + off * leftNormals[ri + 2],
			));
		}
		if (pts.length > 0) pts.push(pts[0].clone());
		return new THREE.BufferGeometry().setFromPoints(pts);
		// We deliberately only include selectedVersion so outline re-renders after drag
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [contour, mmToWorld, selectedVersion, isDragging, getSharedEndpointPosition]);

	// ── Update instanced mesh transforms + colors every frame ──
	const _mat4 = useMemo(() => new THREE.Matrix4(), []);
	const _color = useMemo(() => new THREE.Color(), []);

	const updateInstances = useCallback(() => {
		if (!contour || !instanceRef.current) return;
		const inst = instanceRef.current;
		const { bins, rightPos, leftPos, rightNormals, leftNormals } = contour;
		const offsets = offsetsRef.current;
		const mm = mmToWorld;
		const sel = selectedSet.current;

		for (let i = 0; i < bins; i++) {
			const ri = i * 3;
			const t = contour.tValues[i];
			const region = tToRegion(t);

			// Right side handle (index i)
			{
				let px: number;
				let py: number;
				let pz: number;
				if (i === 0 || i === bins - 1) {
					const shared = getSharedEndpointPosition(i === 0 ? 0 : 1);
					px = shared?.x ?? rightPos[ri + 0];
					py = shared?.y ?? rightPos[ri + 1];
					pz = shared?.z ?? rightPos[ri + 2];
				} else {
					const off = offsets.length > i ? offsets[i] * mm : 0;
					px = rightPos[ri + 0] + off * rightNormals[ri + 0];
					py = rightPos[ri + 1] + off * rightNormals[ri + 1];
					pz = rightPos[ri + 2] + off * rightNormals[ri + 2];
				}
				const r = (hoveredIdx === i) ? HANDLE_RADIUS_HOVER : HANDLE_RADIUS;
				_mat4.makeScale(r, r, r).setPosition(px, py, pz);
				inst.setMatrixAt(i, _mat4);

				const isSelected = sel.has(i);
				const isHov = hoveredIdx === i;
				_color.copy(
					isSelected ? COLOR_SELECTED
						: isHov ? COLOR_HOVER
							: REGION_COLORS[region]
				);
				inst.setColorAt(i, _color);
			}

			// Left side handle (index i + bins)
			{
				const li = i + bins;
				if (hiddenHandleSet.has(li)) {
					_mat4.makeScale(0.0001, 0.0001, 0.0001).setPosition(99999, 99999, 99999);
					inst.setMatrixAt(li, _mat4);
					_color.setRGB(0, 0, 0);
					inst.setColorAt(li, _color);
					continue;
				}
				const off = offsets.length > li ? offsets[li] * mm : 0;
				const px = leftPos[ri + 0] + off * leftNormals[ri + 0];
				const py = leftPos[ri + 1] + off * leftNormals[ri + 1];
				const pz = leftPos[ri + 2] + off * leftNormals[ri + 2];
				const r = (hoveredIdx === li) ? HANDLE_RADIUS_HOVER : HANDLE_RADIUS;
				_mat4.makeScale(r, r, r).setPosition(px, py, pz);
				inst.setMatrixAt(li, _mat4);

				const isSelected = sel.has(li);
				const isHov = hoveredIdx === li;
				_color.copy(
					isSelected ? COLOR_SELECTED
						: isHov ? COLOR_HOVER
							: REGION_COLORS[region]
				);
				inst.setColorAt(li, _color);
			}
		}

		inst.instanceMatrix.needsUpdate = true;
		if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
	}, [contour, mmToWorld, hoveredIdx, hiddenHandleSet, getSharedEndpointPosition, _mat4, _color]);

	// Update every frame only when needed
	useFrame(() => {
		if (needsInstanceUpdate.current || dragging.current) {
			updateInstances();
			needsInstanceUpdate.current = false;
		}
	});

	// Also update when hoveredIdx or selection changes
	useEffect(() => {
		needsInstanceUpdate.current = true;
	}, [hoveredIdx, selectedVersion]);

	// ── Stable refs ──
	const cameraRef = useRef(camera);
	cameraRef.current = camera;
	const mmRef = useRef(mmToWorld);
	mmRef.current = mmToWorld;
	const onPendingRef = useRef(onPendingChange);
	onPendingRef.current = onPendingChange;
	const onPendingProfileRef = useRef(onPendingProfileChange);
	onPendingProfileRef.current = onPendingProfileChange;
	const contourRef = useRef(contour);
	contourRef.current = contour;

	const emitPending = useCallback(() => {
		const adj = handleOffsetsToAdjustments(
			offsetsRef.current,
			tValuesRef.current,
			adjustments,
		);
		onPendingRef.current(adj);
		if (contourRef.current && onPendingProfileRef.current) {
			onPendingProfileRef.current(
				buildHandleProfile(offsetsRef.current, tValuesRef.current, contourRef.current.bins)
			);
		}
	}, [adjustments]);

	// ── Pointer move (handle dragging OR box selection) ──
	const onPointerMove = useCallback((e: PointerEvent) => {
		const rect = gl.domElement.getBoundingClientRect();
		const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

		// Box selection mode
		if (boxSelecting.current) {
			boxCurrentNDC.current.set(ndcX, ndcY);

			// Update visual overlay
			const overlay = boxOverlayRef.current;
			if (overlay) {
				const startPx = ((boxStartNDC.current.x + 1) / 2) * rect.width;
				const startPy = ((1 - boxStartNDC.current.y) / 2) * rect.height;
				const curPx = ((ndcX + 1) / 2) * rect.width;
				const curPy = ((1 - ndcY) / 2) * rect.height;
				overlay.style.display = 'block';
				overlay.style.left = `${Math.min(startPx, curPx)}px`;
				overlay.style.top = `${Math.min(startPy, curPy)}px`;
				overlay.style.width = `${Math.abs(curPx - startPx)}px`;
				overlay.style.height = `${Math.abs(curPy - startPy)}px`;
			}
			return;
		}

		// Handle dragging
		if (!dragging.current) return;

		// Screen-space delta in NDC
		const dNdcX = ndcX - dragStartNDC.current.x;
		const dNdcY = ndcY - dragStartNDC.current.y;

		// Project delta onto the NDC width direction to get mm
		const ndcPMm = dragNdcPerMm.current;
		const ndcPerMmLen = ndcPMm.lengthSq();
		const deltaMm = ndcPerMmLen > 1e-12
			? (dNdcX * ndcPMm.x + dNdcY * ndcPMm.y) / ndcPerMmLen
			: 0;

		const indices = dragHandleIndices.current;
		const startOff = dragStartOffsets.current;
		const bins = contourRef.current?.bins ?? 0;

		applyDeltaWithSmoothing(
			offsetsRef.current, startOff, indices, deltaMm, bins, SMOOTH_RADIUS,
		);

		emitPending();
		needsInstanceUpdate.current = true;
	}, [gl, emitPending]);

	const onPointerUp = useCallback(() => {
		if (boxSelecting.current) {
			// Finish box selection — select handles inside the rect
			boxSelecting.current = false;
			if (boxOverlayRef.current) boxOverlayRef.current.style.display = 'none';

			if (contourRef.current && instanceRef.current && groupRef.current) {
				const { bins } = contourRef.current;
				const sel = new Set<number>();
				const _v = new THREE.Vector3();
				const _ndc = new THREE.Vector3();

				const x1 = Math.min(boxStartNDC.current.x, boxCurrentNDC.current.x);
				const y1 = Math.min(boxStartNDC.current.y, boxCurrentNDC.current.y);
				const x2 = Math.max(boxStartNDC.current.x, boxCurrentNDC.current.x);
				const y2 = Math.max(boxStartNDC.current.y, boxCurrentNDC.current.y);

				// Only select if box is large enough (avoid accidental clicks)
				if (Math.abs(x2 - x1) > 0.01 || Math.abs(y2 - y1) > 0.01) {
					for (let i = 0; i < bins * 2; i++) {
						if (hiddenHandleSet.has(i)) continue;
						const m4 = new THREE.Matrix4();
						instanceRef.current.getMatrixAt(i, m4);
						_v.setFromMatrixPosition(m4);
						groupRef.current.localToWorld(_v);
						_ndc.copy(_v).project(cameraRef.current);

						if (_ndc.x >= x1 && _ndc.x <= x2 && _ndc.y >= y1 && _ndc.y <= y2) {
							sel.add(i);
						}
					}
				}
				selectedSet.current = sel;
				setSelectedVersion((v) => v + 1);
			}
			return;
		}

		if (dragging.current) {
			dragging.current = false;
			setIsDragging(false);
			gl.domElement.style.cursor = 'auto';
			// Re-render outline with final positions
			setSelectedVersion((v) => v + 1);
		}
	}, [gl, hiddenHandleSet]);

	// ── Attach / detach native listeners ──
	useEffect(() => {
		if (!active) return;
		const el = gl.domElement;
		el.addEventListener('pointermove', onPointerMove);
		el.addEventListener('pointerup', onPointerUp);
		return () => {
			el.removeEventListener('pointermove', onPointerMove);
			el.removeEventListener('pointerup', onPointerUp);
		};
	}, [active, gl, onPointerMove, onPointerUp]);

	// ── Box selection overlay div ──
	useEffect(() => {
		if (!active) return;
		const parent = gl.domElement.parentElement;
		if (!parent) return;

		const div = document.createElement('div');
		div.style.cssText = [
			'position:absolute',
			'border:1.5px dashed rgba(167,139,250,0.85)',
			'background:rgba(167,139,250,0.12)',
			'pointer-events:none',
			'display:none',
			'z-index:10',
			'border-radius:2px',
		].join(';');
		parent.style.position = 'relative';
		parent.appendChild(div);
		boxOverlayRef.current = div;

		return () => {
			div.remove();
			boxOverlayRef.current = null;
		};
	}, [active, gl]);

	// ── Keyboard arrow nudge ──
	useEffect(() => {
		if (!active) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			const sel = selectedSet.current;
			if (sel.size === 0) return;

			e.preventDefault();
			// ArrowRight = outward (+), ArrowLeft = inward (−)
			const step = e.key === 'ArrowRight' ? 0.5 : -0.5;
			const bins = contourRef.current?.bins ?? 0;
			const indices = expandEndpointSelection(Array.from(sel), bins).filter((idx) => !hiddenHandleSet.has(idx));

			const snapshot = offsetsRef.current.slice();
			applyDeltaWithSmoothing(
				offsetsRef.current, snapshot, indices, step, bins, SMOOTH_RADIUS,
			);

			emitPending();
			needsInstanceUpdate.current = true;
			setSelectedVersion((v) => v + 1);
		};

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [active, emitPending, hiddenHandleSet]);

	// ── Nothing to render ──
	if (!active || !contour || handleCount === 0) return null;

	const startDrag = (handleIdx: number, screenX: number, screenY: number) => {
		if (hiddenHandleSet.has(handleIdx)) return;
		const sel = selectedSet.current;
		const indices = sel.has(handleIdx) && sel.size > 1
			? Array.from(sel)
			: [handleIdx];
		const visibleIndices = expandEndpointSelection(indices, contour?.bins ?? 0).filter((idx) => !hiddenHandleSet.has(idx));
		if (visibleIndices.length === 0) return;

		dragging.current = true;
		setIsDragging(true);
		dragHandleIndices.current = visibleIndices;
		dragStartOffsets.current = offsetsRef.current.slice();

		// Record start NDC
		const rect = gl.domElement.getBoundingClientRect();
		const startNdcX = ((screenX - rect.left) / rect.width) * 2 - 1;
		const startNdcY = -((screenY - rect.top) / rect.height) * 2 + 1;
		dragStartNDC.current.set(startNdcX, startNdcY);

		// Compute NDC-per-mm: project the handle's world position and
		// a point offset by +1mm along the width axis, then take the
		// screen-space difference. This gives us how much NDC changes
		// per 1mm of width offset — works for any camera angle.
		if (instanceRef.current && groupRef.current) {
			const m4 = new THREE.Matrix4();
			instanceRef.current.getMatrixAt(handleIdx, m4);

			// Handle position in local space
			const localPos = new THREE.Vector3().setFromMatrixPosition(m4);

			// Offset by +1mm along the handle's outward normal
			const normals = handleIdx < contour.bins ? contour.rightNormals : contour.leftNormals;
			const normBin = (handleIdx < contour.bins ? handleIdx : handleIdx - contour.bins) * 3;
			const offsetPos = localPos.clone();
			offsetPos.x += mmToWorld * normals[normBin + 0];
			offsetPos.y += mmToWorld * normals[normBin + 1];
			offsetPos.z += mmToWorld * normals[normBin + 2];

			// Transform both to world space
			const worldA = localPos.clone();
			groupRef.current.localToWorld(worldA);
			const worldB = offsetPos.clone();
			groupRef.current.localToWorld(worldB);

			// Project to NDC
			const ndcA = worldA.project(cameraRef.current);
			const ndcB = worldB.project(cameraRef.current);

			// NDC displacement per +1mm
			dragNdcPerMm.current.set(ndcB.x - ndcA.x, ndcB.y - ndcA.y);
		} else {
			dragNdcPerMm.current.set(0.01, 0); // fallback
		}

		gl.domElement.style.cursor = 'grabbing';
	};

	return (
		<group ref={groupRef}>
			{outlineGeo && <OutlineLine geometry={outlineGeo} />}

			<instancedMesh
				ref={instanceRef}
				args={[_sphereGeo, undefined, handleCount]}
				renderOrder={11}
				frustumCulled={false}
				onPointerDown={(e) => {
					e.stopPropagation();
					const idx = e.instanceId;
					if (idx == null) return;
					if (hiddenHandleSet.has(idx)) return;

					// If holding shift, toggle selection
					if (e.nativeEvent.shiftKey) {
						const sel = selectedSet.current;
						if (sel.has(idx)) sel.delete(idx);
						else sel.add(idx);
						setSelectedVersion((v) => v + 1);
						return;
					}

					// If clicking a non-selected handle, clear selection and select only this
					if (!selectedSet.current.has(idx)) {
						selectedSet.current = new Set([idx]);
						setSelectedVersion((v) => v + 1);
					}

					startDrag(idx, e.nativeEvent.clientX, e.nativeEvent.clientY);
				}}
				onPointerMove={(e) => {
					if (dragging.current) return;
					const idx = e.instanceId;
					if (idx != null && !hiddenHandleSet.has(idx) && idx !== hoveredIdx) {
						setHoveredIdx(idx);
						gl.domElement.style.cursor = 'grab';
					}
				}}
				onPointerLeave={() => {
					if (!dragging.current) {
						setHoveredIdx(-1);
						gl.domElement.style.cursor = 'auto';
					}
				}}
			>
				<meshBasicMaterial
					transparent
					opacity={0.8}
					depthTest={false}
				/>
			</instancedMesh>

			{/* Invisible plane to catch clicks for box-selection on empty space */}
			<mesh
				visible={false}
				renderOrder={0}
				onPointerDown={(e) => {
					// Only left mouse button
					if (e.nativeEvent.button !== 0) return;
					// Only trigger if no handle was hit (this mesh is behind)
					if (e.intersections.length > 1) return;
					e.stopPropagation();

					// Clear selection
					selectedSet.current = new Set();
					setSelectedVersion((v) => v + 1);

					// Start box selection
					const rect = gl.domElement.getBoundingClientRect();
					const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
					const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;
					boxSelecting.current = true;
					boxStartNDC.current.set(ndcX, ndcY);
					boxCurrentNDC.current.set(ndcX, ndcY);
				}}
			>
				<planeGeometry args={[9999, 9999]} />
				<meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
			</mesh>
		</group>
	);
}

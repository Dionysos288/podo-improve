import * as THREE from 'three';

import type { ContourData, ContourLayout } from '@/src/features/design/utils/contourTypes';

export type { ContourData, ContourLayout };

/** Insole-only contour: heel→toe polar sweep split into right/left halves. */
export function extractContour(
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

	const bboxDiag = Math.max(size.length(), 1e-6);
	const raycaster = new THREE.Raycaster();
	const snapGeo = geometry.clone();
	const snapMesh = new THREE.Mesh(snapGeo, new THREE.MeshBasicMaterial());
	snapMesh.updateMatrixWorld(true);
	const rayOrigin = new THREE.Vector3();
	const rayDir = new THREE.Vector3();
	const planarOutward = (
		samplePos: Float32Array,
		sampleNormalsLw: Float32Array,
		i: number,
		o: THREE.Vector3,
		dir: THREE.Vector3,
	) => {
		const ri = i * 3;
		o.set(samplePos[ri]!, samplePos[ri + 1]!, samplePos[ri + 2]!);
		dir.set(sampleNormalsLw[ri]!, sampleNormalsLw[ri + 1]!, sampleNormalsLw[ri + 2]!);
		if (dir.lengthSq() < 1e-12) {
			dir.set(0, 1, 0);
		}
		dir.normalize();
	};
	const planarNormalsLw = (): { right: Float32Array; left: Float32Array } => {
		const rightN = new Float32Array(bins * 3);
		const leftN = new Float32Array(bins * 3);
		for (let i = 0; i < bins; i++) {
			const prev = Math.max(0, i - 1);
			const next = Math.min(bins - 1, i + 1);
			const rp = prev * 3, rn = next * 3, ri = i * 3;
			{
				const tL = rightPos[rn + li] - rightPos[rp + li];
				const tW = rightPos[rn + wi] - rightPos[rp + wi];
				let nL = -tW, nW = tL;
				let mag = Math.sqrt(nL * nL + nW * nW);
				if (mag < 1e-8) {
					nL = 0;
					nW = 1;
					mag = 1;
				}
				nL /= mag;
				nW /= mag;
				const dirL = rightPos[ri + li] - centerL;
				const dirW = rightPos[ri + wi] - centerW;
				if (nL * dirL + nW * dirW < 0) {
					nL = -nL;
					nW = -nW;
				}
				rightN[ri + li] = nL;
				rightN[ri + wi] = nW;
				rightN[ri + hi] = 0;
			}
			{
				const tL = leftPos[rn + li] - leftPos[rp + li];
				const tW = leftPos[rn + wi] - leftPos[rp + wi];
				let nL = -tW, nW = tL;
				let mag = Math.sqrt(nL * nL + nW * nW);
				if (mag < 1e-8) {
					nL = 0;
					nW = -1;
					mag = 1;
				}
				nL /= mag;
				nW /= mag;
				const dirL = leftPos[ri + li] - centerL;
				const dirW = leftPos[ri + wi] - centerW;
				if (nL * dirL + nW * dirW < 0) {
					nL = -nL;
					nW = -nW;
				}
				leftN[ri + li] = nL;
				leftN[ri + wi] = nW;
				leftN[ri + hi] = 0;
			}
		}
		return { right: rightN, left: leftN };
	};
	let planar = planarNormalsLw();
	for (let pass = 0; pass < 3; pass++) {
		const snapLw = (
			samplePos: Float32Array,
			lwNormals: Float32Array,
			i: number,
		) => {
			const ri = i * 3;
			planarOutward(samplePos, lwNormals, i, rayOrigin, rayDir);
			rayOrigin.addScaledVector(rayDir, bboxDiag * 1.05);
			rayDir.multiplyScalar(-1).normalize();
			raycaster.set(rayOrigin, rayDir);
			raycaster.far = bboxDiag * 3;
			const hits = raycaster.intersectObject(snapMesh, false);
			if (hits.length > 0) {
				const p = hits[0]!.point;
				samplePos[ri] = p.x;
				samplePos[ri + 1] = p.y;
				samplePos[ri + 2] = p.z;
			}
		};
		for (let i = 0; i < bins; i++) snapLw(rightPos, planar.right, i);
		for (let j = 0; j < bins; j++) snapLw(leftPos, planar.left, j);
		planar = planarNormalsLw();
	}
	snapMesh.material.dispose();
	snapGeo.dispose();
	const rightNormals = planar.right;
	const leftNormals = planar.left;

	return {
		layout: 'insole',
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



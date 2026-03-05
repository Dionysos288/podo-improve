'use client';

import * as THREE from 'three';
import type {
	ThreePointLandmarks,
	DerivedLandmarks,
	AutoLandmarkResult,
	LandmarkConfidence,
} from '../types/types';
import { LANDMARK_CONFIDENCE_THRESHOLD } from '../types/types';

// ============================================================================
// Automatic Landmark Detection — Classical Geometric Methods
// ============================================================================
//
// Detects the 3 required landmarks (heel, meta1, meta5) plus derived points
// (navicular, calcaneus, toeTip) purely from mesh geometry using:
//   1. PCA for axis alignment
//   2. Width profile analysis for heel/forefoot identification
//   3. Curvature-based ball-of-foot detection for metatarsal heads
//   4. Extremal vertex searches for heel, toe tip
//
// Confidence scores are computed per-landmark based on geometric plausibility.
// If overall confidence < threshold, the system flags for manual review.
// ============================================================================

type Vec3Tuple = [number, number, number];

/** Internal vertex in local foot coordinate space */
interface LocalVertex {
	worldPos: THREE.Vector3;
	u: number; // along length axis (0 = rear, 1 = front)
	v: number; // along width axis (medial/lateral)
	w: number; // height (up from plantar)
}

/**
 * Run PCA on a set of 3D positions to find principal axes.
 * Returns axes sorted by descending eigenvalue (longest, medium, shortest).
 */
function computePCA(positions: Float32Array, count: number): {
	axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
	center: THREE.Vector3;
	extents: [number, number, number];
} {
	// Compute centroid
	const center = new THREE.Vector3();
	for (let i = 0; i < count; i++) {
		center.x += positions[i * 3];
		center.y += positions[i * 3 + 1];
		center.z += positions[i * 3 + 2];
	}
	center.divideScalar(count);

	// Build 3×3 covariance matrix (upper triangular)
	let cxx = 0, cxy = 0, cxz = 0;
	let cyy = 0, cyz = 0, czz = 0;

	for (let i = 0; i < count; i++) {
		const dx = positions[i * 3] - center.x;
		const dy = positions[i * 3 + 1] - center.y;
		const dz = positions[i * 3 + 2] - center.z;
		cxx += dx * dx;
		cxy += dx * dy;
		cxz += dx * dz;
		cyy += dy * dy;
		cyz += dy * dz;
		czz += dz * dz;
	}

	const n = count;
	cxx /= n; cxy /= n; cxz /= n;
	cyy /= n; cyz /= n; czz /= n;

	// Solve eigenvalues via Jacobi iteration (3×3 symmetric matrix)
	const eigenvalues: number[] = [0, 0, 0];
	const eigenvectors: THREE.Vector3[] = [
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(0, 0, 1),
	];

	// Power iteration for top 3 eigenvectors (sufficient for 3×3)
	const mat = [
		[cxx, cxy, cxz],
		[cxy, cyy, cyz],
		[cxz, cyz, czz],
	];

	for (let ev = 0; ev < 3; ev++) {
		let vec = new THREE.Vector3(
			Math.random() + 0.1,
			Math.random() + 0.1,
			Math.random() + 0.1
		).normalize();

		// 50 iterations of power method
		for (let iter = 0; iter < 50; iter++) {
			const newVec = new THREE.Vector3(
				mat[0][0] * vec.x + mat[0][1] * vec.y + mat[0][2] * vec.z,
				mat[1][0] * vec.x + mat[1][1] * vec.y + mat[1][2] * vec.z,
				mat[2][0] * vec.x + mat[2][1] * vec.y + mat[2][2] * vec.z
			);
			const len = newVec.length();
			if (len < 1e-12) break;
			vec = newVec.divideScalar(len);
		}

		// Eigenvalue = Rayleigh quotient
		const Av = new THREE.Vector3(
			mat[0][0] * vec.x + mat[0][1] * vec.y + mat[0][2] * vec.z,
			mat[1][0] * vec.x + mat[1][1] * vec.y + mat[1][2] * vec.z,
			mat[2][0] * vec.x + mat[2][1] * vec.y + mat[2][2] * vec.z
		);
		const lambda = vec.dot(Av);

		eigenvalues[ev] = lambda;
		eigenvectors[ev] = vec.clone();

		// Deflate matrix: M = M - λ * v * vT
		for (let r = 0; r < 3; r++) {
			for (let c = 0; c < 3; c++) {
				const vr = [vec.x, vec.y, vec.z][r];
				const vc = [vec.x, vec.y, vec.z][c];
				mat[r][c] -= lambda * vr * vc;
			}
		}
	}

	// Sort by eigenvalue descending
	const indices = [0, 1, 2].sort((a, b) => eigenvalues[b] - eigenvalues[a]);
	const sortedAxes = indices.map((i) => eigenvectors[i]) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
	const sortedExtents = indices.map((i) => Math.sqrt(Math.max(0, eigenvalues[i]) * 2)) as [number, number, number];

	return { axes: sortedAxes, center, extents: sortedExtents };
}

/**
 * Compute the width profile along the length axis.
 * Returns an array of { t, width } where t goes from 0 to 1 along length.
 */
function computeWidthProfile(
	localVerts: LocalVertex[],
	numBins: number
): Array<{ t: number; width: number; count: number }> {
	const bins: Array<{ minV: number; maxV: number; count: number }> = [];
	for (let i = 0; i < numBins; i++) {
		bins.push({ minV: Infinity, maxV: -Infinity, count: 0 });
	}

	for (const v of localVerts) {
		const bin = Math.min(numBins - 1, Math.max(0, Math.floor(v.u * numBins)));
		bins[bin].minV = Math.min(bins[bin].minV, v.v);
		bins[bin].maxV = Math.max(bins[bin].maxV, v.v);
		bins[bin].count++;
	}

	return bins.map((b, i) => ({
		t: (i + 0.5) / numBins,
		width: b.count > 5 ? b.maxV - b.minV : 0,
		count: b.count,
	}));
}

/**
 * Smooth a width profile using a rolling average to reduce bin noise.
 */
function smoothWidthProfile(
	profile: Array<{ t: number; width: number; count: number }>,
	windowSize = 3
): Array<{ t: number; width: number; count: number }> {
	const half = Math.floor(windowSize / 2);
	return profile.map((entry, i) => {
		let sumW = 0;
		let sumC = 0;
		let n = 0;
		for (let j = Math.max(0, i - half); j <= Math.min(profile.length - 1, i + half); j++) {
			sumW += profile[j].width;
			sumC += profile[j].count;
			n++;
		}
		return { t: entry.t, width: sumW / n, count: Math.round(sumC / n) };
	});
}

/**
 * Find the ball-of-foot region: local maximum in width in the forefoot area.
 * Uses a smoothed profile for robust peak detection.
 * Returns the t-position and width.
 */
function findBallOfFoot(
	widthProfile: Array<{ t: number; width: number; count: number }>
): { t: number; width: number } {
	// Smooth to reduce bin noise
	const smoothed = smoothWidthProfile(widthProfile, 3);

	// Search in the forefoot region (t in [0.40, 0.85])
	let bestT = 0.7;
	let bestWidth = 0;

	for (const entry of smoothed) {
		if (entry.t > 0.40 && entry.t < 0.85 && entry.width > bestWidth && entry.count > 3) {
			bestWidth = entry.width;
			bestT = entry.t;
		}
	}

	return { t: bestT, width: bestWidth };
}

/**
 * Find the widest slice in the rear portion (heel region).
 */
function findHeelRegion(
	widthProfile: Array<{ t: number; width: number; count: number }>
): { t: number; width: number } {
	let bestT = 0.1;
	let bestWidth = 0;

	for (const entry of widthProfile) {
		if (entry.t < 0.3 && entry.width > bestWidth && entry.count > 5) {
			bestWidth = entry.width;
			bestT = entry.t;
		}
	}

	return { t: bestT, width: bestWidth };
}

/**
 * Detect the 3 primary landmarks (heel, meta1, meta5) and derived points
 * automatically from a foot mesh using classical geometry.
 *
 * @param geometry   The foot scan BufferGeometry
 * @param filename   Optional filename to infer left/right side
 * @returns AutoLandmarkResult with detected landmarks, confidence, and warnings
 */
export function detectLandmarksClassical(
	geometry: THREE.BufferGeometry,
	filename?: string
): AutoLandmarkResult {
	const warnings: string[] = [];
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
	if (!posAttr) {
		throw new Error('Mesh has no position attribute');
	}

	const count = posAttr.count;
	if (count < 500) {
		warnings.push(`Zeer laag aantal vertices (${count}), detectie kan onnauwkeurig zijn.`);
	}

	// ---------------------------------------------------------------
	// Step 1: PCA to find principal axes
	// ---------------------------------------------------------------
	const positions = posAttr.array as Float32Array;
	const { axes, center, extents } = computePCA(positions, count);

	let lengthAxis = axes[0]; // longest axis = heel-to-toe
	const widthAxis = axes[1]; // middle axis = lateral
	let heightAxis = axes[2]; // shortest axis = height

	// Ensure consistent orientation by using the extent ratios
	const lengthWidthRatio = extents[0] / (extents[1] || 1);
	if (lengthWidthRatio < 1.5) {
		warnings.push(`Lengte/breedte verhouding (${lengthWidthRatio.toFixed(2)}) is laag — scan kan niet goed uitgelijd zijn.`);
	}

	// ---------------------------------------------------------------
	// Step 2: Project all vertices into local PCA space
	// ---------------------------------------------------------------
	const localVerts: LocalVertex[] = [];
	let minU = Infinity, maxU = -Infinity;
	let minV = Infinity, maxV = -Infinity;
	let minW = Infinity, maxW = -Infinity;

	for (let i = 0; i < count; i++) {
		const worldPos = new THREE.Vector3(
			posAttr.getX(i),
			posAttr.getY(i),
			posAttr.getZ(i)
		);
		const rel = worldPos.clone().sub(center);
		const u = rel.dot(lengthAxis);
		const v = rel.dot(widthAxis);
		const w = rel.dot(heightAxis);

		localVerts.push({ worldPos, u, v, w });
		minU = Math.min(minU, u);
		maxU = Math.max(maxU, u);
		minV = Math.min(minV, v);
		maxV = Math.max(maxV, v);
		minW = Math.min(minW, w);
		maxW = Math.max(maxW, w);
	}

	const uSpan = maxU - minU;
	const vSpan = maxV - minV;

	// Normalize u to 0–1
	for (const lv of localVerts) {
		lv.u = (lv.u - minU) / (uSpan || 1);
		lv.v = (lv.v - minV) / (vSpan || 1);
	}

	// ---------------------------------------------------------------
	// Step 3: Determine heel vs toe end using width profile
	// ---------------------------------------------------------------
	const widthProfile = computeWidthProfile(localVerts, 30);
	const heelRegion = findHeelRegion(widthProfile);
	const ballRegion = findBallOfFoot(widthProfile);

	// Heuristic: the heel end is the wider end of the rear portion.
	// If the rear end is narrower, flip the axis.
	const rearWidth = heelRegion.width;
	const frontWidth = ballRegion.width;

	let heelAtLowU = true;
	if (rearWidth < frontWidth * 0.6) {
		// The wider end is at high U — need to flip
		heelAtLowU = false;
		// Flip u coordinates
		for (const lv of localVerts) {
			lv.u = 1 - lv.u;
		}
		lengthAxis = lengthAxis.clone().negate();
	}

	// ---------------------------------------------------------------
	// Step 4: Find heel point (rearmost + lowest vertex)
	// ---------------------------------------------------------------
	let bestHeelScore = -Infinity;
	let heelVertex: LocalVertex = localVerts[0];

	for (const lv of localVerts) {
		if (lv.u < 0.15) {
			// Score: prefer rearmost (low u) and lowest (low w)
			const score = (0.15 - lv.u) * 3 + (1 - (lv.w - minW) / ((maxW - minW) || 1));
			if (score > bestHeelScore) {
				bestHeelScore = score;
				heelVertex = lv;
			}
		}
	}

	// Refine: centroid of lowest 20% of heel region vertices
	const heelCandidates = localVerts.filter((lv) => lv.u < 0.12);
	if (heelCandidates.length > 10) {
		heelCandidates.sort((a, b) => a.w - b.w);
		const take = Math.max(5, Math.floor(heelCandidates.length * 0.2));
		const centroid = new THREE.Vector3();
		for (let i = 0; i < take; i++) {
			centroid.add(heelCandidates[i].worldPos);
		}
		centroid.divideScalar(take);
		// Find actual vertex closest to centroid
		let closest = heelCandidates[0];
		let closestDist = Infinity;
		for (const lv of heelCandidates) {
			const d = lv.worldPos.distanceTo(centroid);
			if (d < closestDist) {
				closestDist = d;
				closest = lv;
			}
		}
		heelVertex = closest;
	}

	// ---------------------------------------------------------------
	// Step 5: Find toe tip (frontmost vertex)
	// ---------------------------------------------------------------
	let toeTipVertex: LocalVertex = localVerts[0];
	let maxUVal = -Infinity;
	for (const lv of localVerts) {
		if (lv.u > maxUVal) {
			maxUVal = lv.u;
			toeTipVertex = lv;
		}
	}

	// ---------------------------------------------------------------
	// Step 6: Find metatarsal heads (M1 and M5)
	// ---------------------------------------------------------------
	// Ball of foot is the widest part in the forefoot region.
	// M5 = most lateral vertex at ball, M1 = most medial at ball.
	const ballT = ballRegion.t;

	// Use a wider slice (10% of foot length) for robust detection
	let ballSliceVerts = localVerts.filter(
		(lv) => Math.abs(lv.u - ballT) < 0.10
	);

	// If still too few vertices, expand further
	if (ballSliceVerts.length < 30) {
		ballSliceVerts = localVerts.filter(
			(lv) => Math.abs(lv.u - ballT) < 0.15
		);
	}

	// Robust M1/M5 detection: use percentile-based selection (5th/95th)
	// to avoid outlier vertices pulling the result off
	const sortedByV = [...ballSliceVerts].sort((a, b) => a.v - b.v);

	let meta1Vertex: LocalVertex = localVerts[0];
	let meta5Vertex: LocalVertex = localVerts[0];
	let minVBall = 0;
	let maxVBall = 1;

	if (sortedByV.length >= 10) {
		// 5th and 95th percentile
		const lo = Math.floor(sortedByV.length * 0.05);
		const hi = Math.floor(sortedByV.length * 0.95);

		// Cluster of lowest-V vertices → one side
		const lowCluster = sortedByV.slice(0, Math.max(3, lo + 1));
		const hiCluster = sortedByV.slice(Math.min(sortedByV.length - 3, hi));

		// Pick the vertex closest to each cluster centroid for a clean position
		const lowCentroid = new THREE.Vector3();
		for (const lv of lowCluster) lowCentroid.add(lv.worldPos);
		lowCentroid.divideScalar(lowCluster.length);

		const hiCentroid = new THREE.Vector3();
		for (const lv of hiCluster) hiCentroid.add(lv.worldPos);
		hiCentroid.divideScalar(hiCluster.length);

		// Find nearest actual vertex to each centroid
		let bestLowDist = Infinity;
		let bestHiDist = Infinity;
		for (const lv of ballSliceVerts) {
			const dLow = lv.worldPos.distanceTo(lowCentroid);
			if (dLow < bestLowDist) { bestLowDist = dLow; meta5Vertex = lv; }
			const dHi = lv.worldPos.distanceTo(hiCentroid);
			if (dHi < bestHiDist) { bestHiDist = dHi; meta1Vertex = lv; }
		}

		minVBall = sortedByV[lo].v;
		maxVBall = sortedByV[hi].v;
	} else if (sortedByV.length > 0) {
		// Fallback: absolute min/max if very few vertices
		meta5Vertex = sortedByV[0];
		meta1Vertex = sortedByV[sortedByV.length - 1];
		minVBall = sortedByV[0].v;
		maxVBall = sortedByV[sortedByV.length - 1].v;
	}

	// ---------------------------------------------------------------
	// Step 7: Infer foot side
	// ---------------------------------------------------------------
	let side: 'left' | 'right' | 'unknown' = 'unknown';
	if (filename) {
		const lower = filename.toLowerCase();
		if (lower.includes('_l.') || lower.includes('_l_') || lower.includes('left') || lower.includes('links') || lower.endsWith('_l')) {
			side = 'left';
		} else if (lower.includes('_r.') || lower.includes('_r_') || lower.includes('right') || lower.includes('rechts') || lower.endsWith('_r')) {
			side = 'right';
		}
	}

	// If not inferred from filename, use arch asymmetry:
	// The medial arch (M1 side) is typically higher than the lateral side
	if (side === 'unknown') {
		// Check which side has a higher midfoot (arch) — that's medial
		const midVerts = localVerts.filter((lv) => lv.u > 0.25 && lv.u < 0.55);
		const lowVHalf = midVerts.filter((lv) => lv.v < 0.5);
		const highVHalf = midVerts.filter((lv) => lv.v >= 0.5);

		const avgWLow = lowVHalf.length > 0
			? lowVHalf.reduce((s, v) => s + v.w, 0) / lowVHalf.length
			: 0;
		const avgWHigh = highVHalf.length > 0
			? highVHalf.reduce((s, v) => s + v.w, 0) / highVHalf.length
			: 0;

		// Medial side is higher → that's where M1 is
		if (Math.abs(avgWHigh - avgWLow) > 0.5) {
			// Higher side = medial, but we need to know which is M1 direction
			// For a right foot: medial (M1) is at low V. For left: medial (M1) is at high V.
			side = avgWHigh > avgWLow ? 'left' : 'right';
		} else {
			warnings.push('Kan links/rechts niet automatisch bepalen. Controleer handmatig.');
		}
	}

	// Assign M1 (medial, first metatarsal) and M5 (lateral, fifth metatarsal) based on side
	// For left foot: medial (M1) is the side with higher V (more positive in the PCA frame)
	// For right foot: medial (M1) is the side with lower V
	if (side === 'left') {
		// M1 = high V side, M5 = low V side
		if (meta1Vertex.v < meta5Vertex.v) {
			[meta1Vertex, meta5Vertex] = [meta5Vertex, meta1Vertex];
		}
	} else if (side === 'right') {
		// M1 = low V side, M5 = high V side
		if (meta1Vertex.v > meta5Vertex.v) {
			[meta1Vertex, meta5Vertex] = [meta5Vertex, meta1Vertex];
		}
	}

	// ---------------------------------------------------------------
	// Step 8: Find navicular (highest medial midfoot vertex)
	// ---------------------------------------------------------------
	const isLeftFoot = side === 'left';
	let bestNavicularW = -Infinity;
	let navicularVertex: LocalVertex = localVerts[0];

	for (const lv of localVerts) {
		if (lv.u > 0.25 && lv.u < 0.55) {
			// Medial side detection
			const isMedial = isLeftFoot ? lv.v > 0.5 : lv.v < 0.5;
			if ((isMedial || side === 'unknown') && lv.w > bestNavicularW) {
				bestNavicularW = lv.w;
				navicularVertex = lv;
			}
		}
	}

	// ---------------------------------------------------------------
	// Step 9: Find calcaneus (lowest posterior vertex)
	// ---------------------------------------------------------------
	let lowestW = Infinity;
	let calcaneusVertex: LocalVertex = heelVertex;

	for (const lv of localVerts) {
		if (lv.u < 0.15 && lv.w < lowestW) {
			lowestW = lv.w;
			calcaneusVertex = lv;
		}
	}

	// ---------------------------------------------------------------
	// Step 10: Find lateral edge (most lateral midfoot vertex)
	// ---------------------------------------------------------------
	let lateralEdgeVertex: LocalVertex = meta5Vertex;
	let bestLateral = -Infinity;

	for (const lv of localVerts) {
		if (lv.u > 0.2 && lv.u < 0.7) {
			// Lateral = opposite of medial
			const lateralScore = isLeftFoot ? (1 - lv.v) : lv.v;
			if (lateralScore > bestLateral) {
				bestLateral = lateralScore;
				lateralEdgeVertex = lv;
			}
		}
	}

	// ---------------------------------------------------------------
	// Step 11: Compute confidence scores
	// ---------------------------------------------------------------
	const confidence: LandmarkConfidence = {
		heel: 0,
		meta1: 0,
		meta5: 0,
		toeTip: 0,
		navicular: 0,
		calcaneus: 0,
	};

	// Heel confidence: based on how many vertices are in the heel region
	// and how clearly the rearmost point stands out
	const heelRegionCount = localVerts.filter((lv) => lv.u < 0.12).length;
	confidence.heel = Math.min(1, heelRegionCount / 50) * 0.8 +
		(heelVertex.u < 0.05 ? 0.2 : 0.1);

	// ToeTip: based on clear separation from ball region
	const toeTipSeparation = toeTipVertex.u - ballT;
	confidence.toeTip = Math.min(1, toeTipSeparation / 0.2) * 0.9 + 0.1;

	// Meta1/Meta5: multi-factor confidence
	// IMPORTANT: v coords are already normalized to [0,1], so ballWidth IS the fraction of total width.
	const ballWidth = maxVBall - minVBall;

	// Factor 1: Ball width should span a good portion of foot width (expect 50–90%)
	const widthScore = Math.min(1, ballWidth / 0.55);

	// Factor 2: Vertex density in the ball slice (more vertices = more reliable)
	const densityScore = Math.min(1, ballSliceVerts.length / 80);

	// Factor 3: Physical plausibility — M1-M5 distance relative to foot length
	// Typical forefoot is 25–45% of foot length
	const m1m5Dist = meta1Vertex.worldPos.distanceTo(meta5Vertex.worldPos);
	const m1m5Ratio = uSpan > 0 ? m1m5Dist / uSpan : 0;
	const plausibilityScore = m1m5Ratio > 0.15 && m1m5Ratio < 0.55
		? 1.0
		: m1m5Ratio > 0.10 && m1m5Ratio < 0.65
			? 0.6
			: 0.2;

	// Factor 4: Ball position is in a reasonable forefoot location
	const ballPosScore = ballT > 0.45 && ballT < 0.80 ? 1.0 : 0.5;

	// Combined: weighted average
	const metaScore = widthScore * 0.40 + densityScore * 0.20 + plausibilityScore * 0.25 + ballPosScore * 0.15;
	confidence.meta1 = Math.min(1, metaScore);
	confidence.meta5 = Math.min(1, metaScore);

	console.log(
		`[Landmark] Ball slice: ${ballSliceVerts.length} verts, ballWidth=${ballWidth.toFixed(3)}, ` +
		`M1-M5 dist=${m1m5Dist.toFixed(1)}, ratio=${m1m5Ratio.toFixed(2)}, ballT=${ballT.toFixed(2)}\n` +
		`  widthScore=${widthScore.toFixed(2)}, densityScore=${densityScore.toFixed(2)}, ` +
		`plausibility=${plausibilityScore.toFixed(2)}, ballPos=${ballPosScore.toFixed(2)} → meta=${metaScore.toFixed(2)}`
	)

	// Navicular: based on how much higher it is than surrounding vertices
	const midVertAvgW = localVerts
		.filter((lv) => lv.u > 0.25 && lv.u < 0.55)
		.reduce((s, v, _, arr) => s + v.w / arr.length, 0);
	const navicularElevation = bestNavicularW - midVertAvgW;
	confidence.navicular = Math.min(1, Math.max(0, navicularElevation / 5)) * 0.8 +
		(bestNavicularW > -Infinity ? 0.2 : 0);

	// Calcaneus: confidence based on vertex density in heel and clear low point
	confidence.calcaneus = Math.min(1, heelRegionCount / 30) * 0.7 +
		(calcaneusVertex !== heelVertex ? 0.3 : 0.15);

	// Overall confidence: geometric mean
	const scores = Object.values(confidence);
	const overallConfidence = Math.pow(
		scores.reduce((prod, s) => prod * Math.max(s, 0.01), 1),
		1 / scores.length
	);

	const needsManualReview = overallConfidence < LANDMARK_CONFIDENCE_THRESHOLD;
	if (needsManualReview) {
		warnings.push(
			`Automatische detectie vertrouwen (${(overallConfidence * 100).toFixed(0)}%) is onder de drempel (${(LANDMARK_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%). Handmatige controle aanbevolen.`
		);

		// Flag specific low-confidence landmarks
		for (const [key, score] of Object.entries(confidence)) {
			if (score < 0.5) {
				warnings.push(`Lage betrouwbaarheid voor ${key}: ${(score * 100).toFixed(0)}%`);
			}
		}
	}

	// ---------------------------------------------------------------
	// Step 12: Build result
	// ---------------------------------------------------------------
	const landmarks: ThreePointLandmarks = {
		heel: heelVertex.worldPos.toArray() as Vec3Tuple,
		meta1: meta1Vertex.worldPos.toArray() as Vec3Tuple,
		meta5: meta5Vertex.worldPos.toArray() as Vec3Tuple,
	};

	const derived: DerivedLandmarks = {
		navicular: navicularVertex.worldPos.toArray() as Vec3Tuple,
		calcaneus: calcaneusVertex.worldPos.toArray() as Vec3Tuple,
		toeTip: toeTipVertex.worldPos.toArray() as Vec3Tuple,
		lateralEdge: lateralEdgeVertex.worldPos.toArray() as Vec3Tuple,
	};

	return {
		landmarks,
		derived,
		confidence,
		overallConfidence,
		needsManualReview,
		warnings,
		side,
	};
}

/**
 * Validate that detected landmarks form a plausible foot shape.
 * Returns additional warnings if geometry is inconsistent.
 */
export function validateDetectedLandmarks(
	result: AutoLandmarkResult
): string[] {
	const warnings: string[] = [];

	const heel = new THREE.Vector3(...result.landmarks.heel);
	const m1 = new THREE.Vector3(...result.landmarks.meta1);
	const m5 = new THREE.Vector3(...result.landmarks.meta5);
	const toeTip = new THREE.Vector3(...result.derived.toeTip);
	const nav = new THREE.Vector3(...result.derived.navicular);

	// Check foot length (heel to toe tip): typical 200–320mm
	const footLength = heel.distanceTo(toeTip);
	if (footLength < 150) {
		warnings.push(`Voetlengte (${footLength.toFixed(0)}mm) is erg kort. Controleer scan schaal.`);
	} else if (footLength > 350) {
		warnings.push(`Voetlengte (${footLength.toFixed(0)}mm) is erg lang. Controleer scan schaal.`);
	}

	// Check forefoot width (M1 to M5): typical 70–120mm
	const ffWidth = m1.distanceTo(m5);
	if (ffWidth < 50) {
		warnings.push(`Voorvoet breedte (${ffWidth.toFixed(0)}mm) is erg smal.`);
	} else if (ffWidth > 150) {
		warnings.push(`Voorvoet breedte (${ffWidth.toFixed(0)}mm) is erg breed.`);
	}

	// Check ratio: length/width should be ~2.0–3.5
	const ratio = footLength / (ffWidth || 1);
	if (ratio < 1.5 || ratio > 4.0) {
		warnings.push(`Lengte/breedte verhouding (${ratio.toFixed(1)}) valt buiten normaal bereik (1.5–4.0).`);
	}

	// Check M1/M5 are ahead of heel
	const heelToM1 = m1.clone().sub(heel);
	const heelToM5 = m5.clone().sub(heel);
	if (heelToM1.length() < footLength * 0.3) {
		warnings.push('Meta1 ligt te dicht bij de hiel.');
	}
	if (heelToM5.length() < footLength * 0.3) {
		warnings.push('Meta5 ligt te dicht bij de hiel.');
	}

	// Navicular should be between heel and forefoot
	const heelToNav = nav.clone().sub(heel);
	const navProjection = heelToNav.dot(toeTip.clone().sub(heel).normalize());
	const navRelativePosition = navProjection / footLength;
	if (navRelativePosition < 0.15 || navRelativePosition > 0.65) {
		warnings.push(`Naviculare positie (${(navRelativePosition * 100).toFixed(0)}% van voetlengte) lijkt ongebruikelijk.`);
	}

	return warnings;
}

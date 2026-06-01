import * as THREE from 'three';
import type { OntwerpCorrections } from '@/src/shared/components/design/OntwerpPanel';
import type { CorrectionKey } from '@/src/shared/components/design/correctionsCatalog';
import type { TrimlineHandleProfile } from '@/src/shared/components/design/TrimlineEditOverlay';
import {
	createHeelToToeMapper,
	getGeometryAxes,
	getAxisValue,
	setAxisValue,
	getMinForAxis,
} from '@/src/features/design/utils/geometryAxes';

/**
 * Smooth interpolation function for creating smooth transitions
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/**
 * KUIP HOOGTE (Cup Height)
 * Raises side walls along the selected trimline path.
 *
 * New behavior:
 * - Uses the per-handle trimline profile (when available) as the path mask.
 * - Raises only the side-wall/rim region (not the whole top or bottom).
 * - Falls back to a heel-focused wall raise when no path selection is present.
 */
export function applyKuipHoogte(
	geometry: THREE.BufferGeometry,
	amount: number, // in world units (already converted from mm)
	options?: {
		side?: 'left' | 'right';
		trimlineHandleProfile?: TrimlineHandleProfile | null;
	}
): void {
	if (amount === 0) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan, heightSpan } = getGeometryAxes(geometry);
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});
	
	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;
	const minHeight = getMinForAxis(bbox, heightAxis);

	const profile = options?.trimlineHandleProfile;
	const hasProfile = Boolean(
		profile &&
		profile.bins > 1 &&
		profile.rightOffsetsMm.length >= profile.bins &&
		profile.leftOffsetsMm.length >= profile.bins
	);

	const sampleProfileOffset = (values: number[], bins: number, t: number) => {
		const clampedT = Math.max(0, Math.min(1, t));
		const scaled = clampedT * (bins - 1);
		const i0 = Math.floor(scaled);
		const i1 = Math.min(bins - 1, i0 + 1);
		const f = scaled - i0;
		const a = values[i0] ?? 0;
		const b = values[i1] ?? a;
		return a * (1 - f) + b * f;
	};

	const rightPeak = hasProfile
		? profile!.rightOffsetsMm.slice(0, profile!.bins).reduce((m, v) => Math.max(m, Math.abs(v)), 0)
		: 0;
	const leftPeak = hasProfile
		? profile!.leftOffsetsMm.slice(0, profile!.bins).reduce((m, v) => Math.max(m, Math.abs(v)), 0)
		: 0;
	const hasPathMask = hasProfile && (rightPeak > 0.05 || leftPeak > 0.05);

	const lateralPositiveEdge = options?.side === 'left';
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const heightVal = getAxisValue(positions, i, heightAxis);

		// Keep the correction on the upper wall/rim region.
		const relHeight = heightSpan > 1e-6
			? (heightVal - minHeight) / heightSpan
			: 1;
		const topWallWeight = smoothstep(0.30, 0.88, relHeight);
		if (topWallWeight <= 0.001) continue;
		
		// Distance from center (0=center, 1=edge)
		const distFromCenter = Math.abs(widthVal - centerWidth) / (widthSpan / 2);
		const wallWeight = smoothstep(0.55, 0.98, distFromCenter);
		if (wallWeight <= 0.001) continue;

		const isPositiveEdge = widthVal >= centerWidth;
		const edgeBias = isPositiveEdge === lateralPositiveEdge ? 1.0 : 0.9;

		let pathWeight: number;
		if (hasPathMask) {
			const bins = profile!.bins;
			const edgeValues = isPositiveEdge
				? profile!.rightOffsetsMm
				: profile!.leftOffsetsMm;
			const edgePeak = isPositiveEdge ? rightPeak : leftPeak;
			if (edgePeak <= 0.05) continue;
			const offsetAbs = Math.abs(sampleProfileOffset(edgeValues, bins, t));
			const normOffset = offsetAbs / Math.max(edgePeak, 1e-6);
			pathWeight = smoothstep(0.08, 0.35, normOffset);
			if (pathWeight <= 0.001) continue;
		} else {
			// Fallback when no selected path exists: heel-to-midfoot bowl wall.
			pathWeight = smoothstep(0.85, 0.22, t);
			if (pathWeight <= 0.001) continue;
		}
		
		const heightAdjust = amount * wallWeight * topWallWeight * pathWeight * edgeBias;
		if (heightAdjust <= 1e-6) continue;

		const currentHeight = getAxisValue(positions, i, heightAxis);
		setAxisValue(positions, i, heightAxis, currentHeight - heightAdjust);
	}
	
	positions.needsUpdate = true;
}

/**
 * VOORVOET UITVLAKKEN (Forefoot Flattening)
 * Flattens the forefoot area by reducing height variations in that zone
 * Creates a more even surface for metatarsal support
 */
export function applyVoorvoetUitvlakken(
	geometry: THREE.BufferGeometry,
	enabled: boolean
): void {
	if (!enabled) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan } = getGeometryAxes(geometry);
	
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});
	
	// Forefoot is roughly the front 40% (0.6 to 1.0)
	const forefootStart = 0.6;
	
	// First pass: find average height in forefoot region
	let totalHeight = 0;
	let count = 0;
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);
		
		if (t > forefootStart) {
			totalHeight += getAxisValue(positions, i, heightAxis);
			count++;
		}
	}
	
	if (count === 0) return;
	const avgHeight = totalHeight / count;
	
	// Second pass: flatten toward average with smooth transition
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);
		
		if (t > forefootStart) {
			const currentHeight = getAxisValue(positions, i, heightAxis);
			
			// Smooth transition from forefoot start
			const flattenStrength = smoothstep(forefootStart, 0.75, t) * 0.7;
			
			// Blend toward average height
			const newHeight = currentHeight + (avgHeight - currentHeight) * flattenStrength;
			setAxisValue(positions, i, heightAxis, newHeight);
		}
	}
	
	positions.needsUpdate = true;
}

/**
 * HIEL HEFFING (Heel Lift)
 * Raises the heel area to compensate for leg length discrepancy or Achilles issues
 * Can be long (gradual slope) or short (steeper slope)
 */
export function applyHielHeffing(
	geometry: THREE.BufferGeometry,
	amount: number, // in mm
	length: 'lang' | 'kort' | 'midden'
): void {
	if (amount === 0) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan } = getGeometryAxes(geometry);
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});
	
	// Determine how far the lift extends based on length setting
	let liftEnd: number;
	switch (length) {
		case 'kort':
			liftEnd = 0.15; // Short lift - only back 15%
			break;
		case 'midden':
			liftEnd = 0.25; // Medium lift - back 25%
			break;
		case 'lang':
		default:
			liftEnd = 0.35; // Long lift - back 35%
			break;
	}
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);
		
		if (t < liftEnd) {
			// Full lift at heel (0), tapering to 0 at liftEnd
			const liftFactor = smoothstep(liftEnd, 0, t);
			const heightAdjust = amount * liftFactor;
			
			const currentHeight = getAxisValue(positions, i, heightAxis);
			setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
		}
	}
	
	positions.needsUpdate = true;
}

/**
 * MEDIALE BOOG CORRECTIE (Medial Arch Correction)
 * Adjusts the arch support height
 * Positive values increase arch support, negative values decrease it
 */
export function applyMedialeBoogCorrectie(
	geometry: THREE.BufferGeometry,
	amount: number, // in mm
	isLeftFoot: boolean
): void {
	if (amount === 0) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	geometry.computeVertexNormals();
	const normals = geometry.attributes.normal as THREE.BufferAttribute | undefined;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);
	
	const minWidth = getMinForAxis(bbox, widthAxis);
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});
	const normalAxisIndex = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const heightVal = getAxisValue(positions, i, heightAxis);
		
		const relativeLength = heelToToe.getT(lengthVal);
		const relativeWidth = (widthVal - minWidth) / widthSpan;
		
		const medialCoord = isLeftFoot ? relativeWidth : 1 - relativeWidth;
		const lengthEnvelope =
			smoothstep(0.14, 0.24, relativeLength) *
			(1 - smoothstep(0.6, 0.76, relativeLength));
		if (lengthEnvelope <= 0.001) continue;

		const innerSlope = smoothstep(0.42, 0.68, medialCoord);
		const edgeLift = smoothstep(0.68, 0.98, medialCoord);
		const widthWeight = Math.min(1, 0.45 * innerSlope + 0.55 * edgeLift);
		if (widthWeight <= 0.001) continue;

		const upNormal = normals
			? Math.abs(
				normalAxisIndex === 0
					? normals.getX(i)
					: normalAxisIndex === 1
						? normals.getY(i)
						: normals.getZ(i)
			)
			: 1;
		const topSurfaceWeight = normals
			? smoothstep(0.28, 0.86, upNormal)
			: 1;
		if (topSurfaceWeight <= 0.001) continue;

		const sideFaceGuard = normals ? smoothstep(0.1, 0.45, upNormal) : 1;
		const archWeight = lengthEnvelope * widthWeight * topSurfaceWeight * sideFaceGuard;
		if (archWeight <= 0.001) continue;

		setAxisValue(positions, i, heightAxis, heightVal + amount * archWeight);
	}
	
	positions.needsUpdate = true;
}

/**
 * GLADSTRIJKEN (Smoothing / Surface cleanup)
 *
 * Smooths out local surface inconsistencies (bumps, dips, holes, seams)
 * WITHOUT changing the overall height profile of the insole.
 *
 * Uses iterative Laplacian smoothing: each vertex moves toward the average
 * of its topological neighbours. This eliminates local noise while the
 * global shape (arch, heel cup, etc.) is preserved.
 *
 * Steps:
 * 1. Build an adjacency map from the index/face buffer
 * 2. Detect outlier vertices (local height differs from neighbour average
 *    by more than a threshold) — these are "holes" or spikes
 * 3. Run N Laplacian smoothing iterations, blending each vertex toward
 *    its neighbour-average position.  The blend factor and iteration count
 *    are governed by the intensity slider (0-10).
 *
 * intensity  0 → no-op
 * intensity  1 → gentle polish (1 pass, low blend)
 * intensity 10 → aggressive fill + smooth (8 passes, high blend)
 */
export function applyGladstrijken(
	geometry: THREE.BufferGeometry,
	intensity: number // 0-10 scale
): void {
	if (intensity === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const count = positions.count;
	if (count < 4) return;

	// ── 1. Build adjacency (vertex → set of neighbour vertex indices) ──
	const adjacency: Set<number>[] = new Array(count);
	for (let i = 0; i < count; i++) adjacency[i] = new Set();

	const index = geometry.index;
	if (index) {
		// Indexed geometry — walk triangles
		const arr = index.array;
		for (let t = 0; t < arr.length; t += 3) {
			const a = arr[t]!, b = arr[t + 1]!, c = arr[t + 2]!;
			adjacency[a].add(b); adjacency[a].add(c);
			adjacency[b].add(a); adjacency[b].add(c);
			adjacency[c].add(a); adjacency[c].add(b);
		}
	} else {
		// Non-indexed: every 3 consecutive vertices form a triangle
		for (let t = 0; t < count; t += 3) {
			const a = t, b = t + 1, c = t + 2;
			if (c >= count) break;
			adjacency[a].add(b); adjacency[a].add(c);
			adjacency[b].add(a); adjacency[b].add(c);
			adjacency[c].add(a); adjacency[c].add(b);
		}
	}

	// ── 2. Iterative Laplacian smoothing ──
	// intensity 1 → 1 pass / 0.15 blend
	// intensity 10 → 8 passes / 0.55 blend
	const passes = Math.max(1, Math.round(intensity * 0.8));
	const blendFactor = 0.10 + (intensity / 10) * 0.45; // 0.10 … 0.55

	// Work on a flat copy so we read old positions while writing new ones
	const px = new Float32Array(count);
	const py = new Float32Array(count);
	const pz = new Float32Array(count);

	for (let pass = 0; pass < passes; pass++) {
		// Snapshot current positions
		for (let i = 0; i < count; i++) {
			px[i] = positions.getX(i);
			py[i] = positions.getY(i);
			pz[i] = positions.getZ(i);
		}

		for (let i = 0; i < count; i++) {
			const nbrs = adjacency[i];
			if (!nbrs || nbrs.size === 0) continue;

			// Compute neighbour centroid
			let sx = 0, sy = 0, sz = 0;
			for (const n of nbrs) {
				sx += px[n]; sy += py[n]; sz += pz[n];
			}
			const inv = 1 / nbrs.size;
			sx *= inv; sy *= inv; sz *= inv;

			// Blend toward centroid
			positions.setX(i, px[i] + (sx - px[i]) * blendFactor);
			positions.setY(i, py[i] + (sy - py[i]) * blendFactor);
			positions.setZ(i, pz[i] + (sz - pz[i]) * blendFactor);
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

function applyFrontalTilt(
	geometry: THREE.BufferGeometry,
	amount: number,
	region: 'gehele-zool' | 'voorvoet' | 'hiel',
	isLeftFoot: boolean,
	raiseMedialSide: boolean
): void {
	if (amount === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});

	const angleRad = (amount * Math.PI) / 180;
	const heightPerWidth = Math.tan(angleRad);
	const medialDirection = isLeftFoot ? 1 : -1;
	const sideDirection = raiseMedialSide ? medialDirection : -medialDirection;

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const t = heelToToe.getT(lengthVal);

		let regionWeight = 0;
		switch (region) {
			case 'gehele-zool':
				regionWeight = 1;
				break;
			case 'voorvoet':
				regionWeight = smoothstep(0.55, 0.75, t);
				break;
			case 'hiel':
				regionWeight = smoothstep(0.28, 0.06, t);
				break;
		}

		if (regionWeight <= 0.01) continue;

		const distFromCenter = widthVal - centerWidth;
		const signedDist = distFromCenter * sideDirection;
		const heightAdjust = signedDist * heightPerWidth * regionWeight;
		const currentHeight = getAxisValue(positions, i, heightAxis);
		setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
	}

	positions.needsUpdate = true;
}

/**
 * PRONATIE (Pronation Correction)
 * Tilts the insole to correct inward rolling of the foot.
 * User expectation in this project: raise the lateral (outer) side.
 */
export function applyPronatie(
	geometry: THREE.BufferGeometry,
	amount: number,
	region: 'gehele-zool' | 'voorvoet' | 'hiel',
	isLeftFoot: boolean
): void {
	applyFrontalTilt(geometry, amount, region, isLeftFoot, false);
}

/**
 * SUPINATIE (Supination Correction)
 * Tilts the insole to correct outward rolling of the foot.
 * User expectation in this project: raise the medial (inner) side.
 */
export function applySupinatie(
	geometry: THREE.BufferGeometry,
	amount: number,
	region: 'gehele-zool' | 'voorvoet' | 'hiel',
	isLeftFoot: boolean
): void {
	applyFrontalTilt(geometry, amount, region, isLeftFoot, true);
}

/**
 * MEDIAAL VLAK (Medial Flange)
 * Vertical extension of the medial arch region for pronatory control.
 * Raises the medial edge of the insole along the midfoot to create a wall-like support.
 * Height setting (laag/midden/hoog) controls how far inward the flange extends.
 */
export function applyMediaalVlak(
	geometry: THREE.BufferGeometry,
	amount: number, // mm of height increase
	hoogte: 'laag' | 'midden' | 'hoog',
	isLeftFoot: boolean
): void {
	if (amount === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	// How far inward the flange extends (fraction of half-width from edge)
	const flangeDepth = hoogte === 'laag' ? 0.12 : hoogte === 'midden' ? 0.2 : 0.3;

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const t = heelToToe.getT(lengthVal);

		// Flange zone: midfoot + rearfoot (0.1 – 0.65 heel-to-toe)
		const lengthWeight = smoothstep(0.08, 0.15, t) * smoothstep(0.68, 0.60, t);
		if (lengthWeight <= 0.001) continue;

		const relativeWidth = (widthVal - minWidth) / widthSpan;

		// Medial side: left foot → high relativeWidth, right foot → low relativeWidth
		const edgeDist = isLeftFoot
			? smoothstep(1.0 - flangeDepth, 1.0, relativeWidth)
			: smoothstep(flangeDepth, 0.0, relativeWidth);

		if (edgeDist > 0.001) {
			const heightAdjust = amount * edgeDist * lengthWeight;
			const currentHeight = getAxisValue(positions, i, heightAxis);
			setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
		}
	}

	positions.needsUpdate = true;
}

/**
 * LATERAAL VLAK (Lateral Flange)
 * Vertical extension of the lateral arch region for supinatory control.
 * Mirror of medial flange, but on the outer side.
 */
export function applyLateraalVlak(
	geometry: THREE.BufferGeometry,
	amount: number,
	hoogte: 'laag' | 'midden' | 'hoog',
	isLeftFoot: boolean
): void {
	if (amount === 0) return;

	// Lateral is the opposite side of medial – flip the foot reference
	applyMediaalVlak(geometry, amount, hoogte, !isLeftFoot);
}

/**
 * VERPLAATS APEX MIDDENVOET (Shift Midfoot Arch Apex)
 * Shifts the peak of the medial arch forward or backward along the length axis.
 * Positive = toward toes, negative = toward heel.
 * Works by re-distributing the existing arch correction with an offset center.
 */
export function applyApexMiddenvoet(
	geometry: THREE.BufferGeometry,
	shiftMm: number, // mm of shift (negative=heel, positive=toe)
	isLeftFoot: boolean
): void {
	if (shiftMm === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	// Convert mm shift to t-space offset
	const tShift = shiftMm / lengthSpan;
	// Default arch center is 0.42; shift it
	const archCenter = Math.max(0.22, Math.min(0.58, 0.42 + tShift));
	const archHalfWidth = 0.22;

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const t = heelToToe.getT(lengthVal);
		const relativeWidth = (widthVal - minWidth) / widthSpan;

		// Only affect the arch zone
		const inArch = t > (archCenter - archHalfWidth) && t < (archCenter + archHalfWidth);
		if (!inArch) continue;

		// Medial side
		const medialSide = isLeftFoot ? relativeWidth > 0.5 : relativeWidth < 0.5;
		if (!medialSide) continue;

		const lengthWeight = 1 - Math.abs(t - archCenter) / archHalfWidth;
		const widthWeight = isLeftFoot
			? smoothstep(0.5, 0.8, relativeWidth)
			: smoothstep(0.5, 0.2, relativeWidth);

		const weight = Math.max(0, lengthWeight) * widthWeight;
		if (weight > 0.01) {
			// The shift effect: positive shift pushes the peak forward,
			// effectively raising the front of the arch and lowering the back
			// relative to the original position. We create a differential:
			const origCenter = 0.42;
			const origWeight = 1 - Math.abs(t - origCenter) / archHalfWidth;
			const delta = (Math.max(0, lengthWeight) - Math.max(0, origWeight)) * widthWeight;

			if (Math.abs(delta) > 0.001) {
				// Scale the redistribution effect (a moderate push of ~2mm per mm shift)
				const heightAdjust = delta * Math.abs(shiftMm) * 0.3;
				const currentHeight = getAxisValue(positions, i, heightAxis);
				setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
			}
		}
	}

	positions.needsUpdate = true;
}

/**
 * VERPLAATS APEX HIEL (Shift Heel Apex)
 * Shifts the peak of the heel lift forward or backward.
 * Positive = toward toes (peak moves forward), negative = toward heel (steeper).
 */
export function applyApexHiel(
	geometry: THREE.BufferGeometry,
	shiftMm: number,
	_isLeftFoot: boolean
): void {
	if (shiftMm === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan } = getGeometryAxes(geometry);

	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	// Convert mm to t-space; the default heel peak is at t=0
	const tShift = shiftMm / lengthSpan;
	const peakT = Math.max(0, Math.min(0.25, tShift));
	const fadeEnd = Math.max(peakT + 0.08, 0.15);

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);

		if (t > fadeEnd + 0.05) continue;

		// Create a peaked profile around peakT instead of monotone from 0
		let weight: number;
		if (t <= peakT) {
			weight = peakT > 0.001 ? smoothstep(0, peakT, t) : 1;
		} else {
			weight = smoothstep(fadeEnd, peakT, t);
		}

		if (weight > 0.001) {
			// Redistribute: raise around new peak, lower at old peak (t=0)
			const origWeight = smoothstep(fadeEnd, 0, t);
			const delta = weight - origWeight;

			if (Math.abs(delta) > 0.001) {
				const heightAdjust = delta * Math.abs(shiftMm) * 0.2;
				const currentHeight = getAxisValue(positions, i, heightAxis);
				setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
			}
		}
	}

	positions.needsUpdate = true;
}

/**
 * HIELBEENCORRECTIE (Heel Clip / Calcaneus Alignment)
 * A vertical extension on the medial or lateral side of the heel cup
 * to align the calcaneus and improve rearfoot control.
 */
export function applyHielbeenCorrectie(
	geometry: THREE.BufferGeometry,
	amount: number,
	zijde: 'mediaal' | 'lateraal',
	isLeftFoot: boolean
): void {
	if (amount === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);

		// Only affect heel zone (0 – 0.25)
		const lengthWeight = smoothstep(0.28, 0.12, t);
		if (lengthWeight <= 0.001) continue;

		const widthVal = getAxisValue(positions, i, widthAxis);
		const relativeWidth = (widthVal - minWidth) / widthSpan;

		// Determine which edge to raise
		let isTargetSide: boolean;
		if (zijde === 'mediaal') {
			isTargetSide = isLeftFoot ? relativeWidth > 0.65 : relativeWidth < 0.35;
		} else {
			isTargetSide = isLeftFoot ? relativeWidth < 0.35 : relativeWidth > 0.65;
		}

		if (isTargetSide) {
			// Edge factor: stronger at the very edge
			const edgeFactor = isLeftFoot
				? (zijde === 'mediaal'
					? smoothstep(0.65, 1.0, relativeWidth)
					: smoothstep(0.35, 0.0, relativeWidth))
				: (zijde === 'mediaal'
					? smoothstep(0.35, 0.0, relativeWidth)
					: smoothstep(0.65, 1.0, relativeWidth));

			const heightAdjust = amount * edgeFactor * lengthWeight;
			if (heightAdjust > 0.001) {
				const currentHeight = getAxisValue(positions, i, heightAxis);
				setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
			}
		}
	}

	positions.needsUpdate = true;
}

/**
 * HIELBREEDTE CORRECTIE (Heel Width Correction)
 * Expands the heel cup by pushing vertices outward along the width axis
 * in the heel zone, providing a broader base of support.
 */
export function applyHielbreedteCorrectie(
	geometry: THREE.BufferGeometry,
	amount: number // mm of expansion per side
): void {
	if (amount === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis: _h, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;
	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);

		// Heel zone (0 – 0.22)
		const lengthWeight = smoothstep(0.25, 0.10, t);
		if (lengthWeight <= 0.001) continue;

		const widthVal = getAxisValue(positions, i, widthAxis);
		const distFromCenter = widthVal - centerWidth;
		const normalizedDist = Math.abs(distFromCenter) / (widthSpan / 2);

		// Only expand the outer portions (>50% from center)
		if (normalizedDist > 0.5) {
			const edgeFactor = smoothstep(0.5, 1.0, normalizedDist);
			const sign = distFromCenter > 0 ? 1 : -1;
			const shift = sign * amount * edgeFactor * lengthWeight;
			setAxisValue(positions, i, widthAxis, widthVal + shift);
		}
	}

	positions.needsUpdate = true;
}

/**
 * ZOOLBREEDTE (Sole Width / Horizontal Expansion)
 * Expands the entire insole width by pushing edge vertices outward,
 * similar to a Medial Arch Platform (MAP) technique.
 */
export function applyZoolbreedte(
	geometry: THREE.BufferGeometry,
	amount: number // mm of expansion per side
): void {
	if (amount === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { widthAxis, bbox, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;

	for (let i = 0; i < positions.count; i++) {
		const widthVal = getAxisValue(positions, i, widthAxis);
		const distFromCenter = widthVal - centerWidth;
		const normalizedDist = Math.abs(distFromCenter) / (widthSpan / 2);

		// Gradual expansion: stronger at edges
		if (normalizedDist > 0.3) {
			const factor = smoothstep(0.3, 1.0, normalizedDist);
			const sign = distFromCenter > 0 ? 1 : -1;
			const shift = sign * amount * factor;
			setAxisValue(positions, i, widthAxis, widthVal + shift);
		}
	}

	positions.needsUpdate = true;
}

/**
 * Apply all corrections to a geometry.
 *
 * Correction steps mutate vertex positions sequentially; downstream passes must rebuild
 * per-step spatial context — do not cache heel-to-length mappers across the full pipeline here.
 */
export function applyAllCorrections(
	geometry: THREE.BufferGeometry,
	corrections: OntwerpCorrections,
	side: 'left' | 'right',
	options?: {
		/**
		 * Converts millimeters (UI/input space) into geometry/world units.
		 * Use this when the STL is rescaled for rendering.
		 */
		mmToWorld?: number;
		activeCorrections?: CorrectionKey[];
		trimlineHandleProfile?: TrimlineHandleProfile | null;
	}
): void {
	const isLeft = side === 'left';
	const mmToWorld = options?.mmToWorld ?? 1;
	const activeSet = options?.activeCorrections
		? new Set<CorrectionKey>(options.activeCorrections)
		: null;
	const isActive = (key: CorrectionKey) => {
		if (!activeSet) return true;
		return activeSet.has(key);
	};
	
	// Apply corrections in a specific order for best results
	
	// 1. Heel lift first (changes base height)
	if (isActive('hielHeffing')) {
		const heelValue = isLeft
			? corrections.hielHeffing.value.left
			: corrections.hielHeffing.value.right;
		const heelLength = (isLeft
			? corrections.hielHeffing.length.left
			: corrections.hielHeffing.length.right) as 'lang' | 'kort' | 'midden';
		applyHielHeffing(geometry, heelValue * mmToWorld, heelLength);
	}
	
	// 2. Arch correction
	if (isActive('medialeBoogCorrectie')) {
		const archValue = isLeft
			? corrections.medialeBoogCorrectie.left
			: corrections.medialeBoogCorrectie.right;
		applyMedialeBoogCorrectie(geometry, archValue * mmToWorld, isLeft);
	}
	
	// 3. Cup height (edge raising)
	if (isActive('kuipHoogte')) {
		const cupValue = isLeft
			? corrections.kuipHoogte.left
			: corrections.kuipHoogte.right;
		applyKuipHoogte(geometry, cupValue * mmToWorld, {
			side,
			trimlineHandleProfile: options?.trimlineHandleProfile ?? null,
		});
	}
	
	// 4. Forefoot flattening
	if (isActive('voorvoetUitvlakken')) {
		applyVoorvoetUitvlakken(geometry, corrections.voorvoetUitvlakken.enabled);
	}
	
	// 5. Pronation/Supination tilts
	if (isActive('pronatie')) {
		const pronatieValue = isLeft
			? corrections.pronatie.correctie.left
			: corrections.pronatie.correctie.right;
		const pronatieRegion = (isLeft
			? corrections.pronatie.regio.left
			: corrections.pronatie.regio.right) as 'gehele-zool' | 'voorvoet' | 'hiel';
		applyPronatie(geometry, pronatieValue, pronatieRegion, isLeft);
	}
	
	if (isActive('supinatie')) {
		const supinatieValue = isLeft
			? corrections.supinatie.correctie.left
			: corrections.supinatie.correctie.right;
		const supinatieRegion = (isLeft
			? corrections.supinatie.regio.left
			: corrections.supinatie.regio.right) as 'gehele-zool' | 'voorvoet' | 'hiel';
		applySupinatie(geometry, supinatieValue, supinatieRegion, isLeft);
	}
	
	// 6. Medial flange
	if (isActive('mediaalVlak')) {
		const flangeValue = isLeft
			? corrections.mediaalVlak.waarde.left
			: corrections.mediaalVlak.waarde.right;
		const flangeHoogte = (isLeft
			? corrections.mediaalVlak.hoogte.left
			: corrections.mediaalVlak.hoogte.right) as 'laag' | 'midden' | 'hoog';
		applyMediaalVlak(geometry, flangeValue * mmToWorld, flangeHoogte, isLeft);
	}

	// 7. Lateral flange
	if (isActive('lateraalVlak')) {
		const flangeValue = isLeft
			? corrections.lateraalVlak.waarde.left
			: corrections.lateraalVlak.waarde.right;
		const flangeHoogte = (isLeft
			? corrections.lateraalVlak.hoogte.left
			: corrections.lateraalVlak.hoogte.right) as 'laag' | 'midden' | 'hoog';
		applyLateraalVlak(geometry, flangeValue * mmToWorld, flangeHoogte, isLeft);
	}

	// 8. Apex midfoot shift
	if (isActive('apexMiddenvoet')) {
		const shiftValue = isLeft
			? corrections.apexMiddenvoet.left
			: corrections.apexMiddenvoet.right;
		applyApexMiddenvoet(geometry, shiftValue * mmToWorld, isLeft);
	}

	// 9. Apex heel shift
	if (isActive('apexHiel')) {
		const shiftValue = isLeft
			? corrections.apexHiel.left
			: corrections.apexHiel.right;
		applyApexHiel(geometry, shiftValue * mmToWorld, isLeft);
	}

	// 10. Heel clip (calcaneus alignment)
	if (isActive('hielbeenCorrectie')) {
		const clipValue = isLeft
			? corrections.hielbeenCorrectie.waarde.left
			: corrections.hielbeenCorrectie.waarde.right;
		const clipZijde = (isLeft
			? corrections.hielbeenCorrectie.zijde.left
			: corrections.hielbeenCorrectie.zijde.right) as 'mediaal' | 'lateraal';
		applyHielbeenCorrectie(geometry, clipValue * mmToWorld, clipZijde, isLeft);
	}

	// 11. Heel width expansion
	if (isActive('hielbreedteCorrectie')) {
		const widthValue = isLeft
			? corrections.hielbreedteCorrectie.left
			: corrections.hielbreedteCorrectie.right;
		applyHielbreedteCorrectie(geometry, widthValue * mmToWorld);
	}

	// 12. Sole width expansion
	if (isActive('zoolbreedte')) {
		const soleWidthValue = isLeft
			? corrections.zoolbreedte.left
			: corrections.zoolbreedte.right;
		applyZoolbreedte(geometry, soleWidthValue * mmToWorld);
	}

	// 13. Smoothing last (to blend all changes)
	if (isActive('gladstrijken')) {
		applyGladstrijken(geometry, corrections.gladstrijken);
	}
}

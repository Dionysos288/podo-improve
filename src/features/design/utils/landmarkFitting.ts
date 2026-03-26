'use client';

import * as THREE from 'three';
import type {
	ThreePointLandmarks,
	DerivedLandmarks,
	CompleteLandmarkSet,
	FootGeometry,
} from '../types/types';

export type LandmarkPoints = {
	meta1: [number, number, number];
	meta5: [number, number, number];
	navicular: [number, number, number];
	calcaneus: [number, number, number];
	heel: [number, number, number];
	toeTip?: [number, number, number];
};

export interface FootReferenceFrame {
	origin: THREE.Vector3;
	longAxis: THREE.Vector3; // heel -> forefoot direction (normalized)
	normal: THREE.Vector3; // base plane normal (normalized)
	lateral: THREE.Vector3; // completes RHS basis
	archHeight: number;
	footLength: number;
	forefootWidth: number;
	forefootMid: THREE.Vector3;
}

export interface SlicePlane {
	point: THREE.Vector3;
	normal: THREE.Vector3;
	t: number; // 0..1 along long axis from heel to forefoot
}

const toVec = (p: [number, number, number]) =>
	new THREE.Vector3(p[0], p[1], p[2]);

// ============================================
// 3-Point Landmark System (new)
// ============================================

/**
 * Compute the complete foot geometry from 3 manually selected landmarks
 * plus the full mesh geometry. Auto-derives navicular, calcaneus, toe tip, and lateral edge.
 *
 * Required landmarks:
 * - meta5: Metatarsal 5 (lateral forefoot)
 * - meta1: Metatarsal 1 (medial forefoot)
 * - heel: Center of the heel
 *
 * @param landmarks The 3 manually picked landmarks
 * @param footMesh  The foot scan BufferGeometry
 * @param filename  Optional filename to infer left/right side
 */
export function computeFootGeometryFrom3Points(
	landmarks: ThreePointLandmarks,
	footMesh: THREE.BufferGeometry,
	filename?: string
): { footGeometry: FootGeometry; derived: DerivedLandmarks; complete: CompleteLandmarkSet } {
	const pHeel = toVec(landmarks.heel);
	const pM1 = toVec(landmarks.meta1);
	const pM5 = toVec(landmarks.meta5);

	// 1. Compute foot axis: heel → midpoint(M1, M5)
	const forefootMid = new THREE.Vector3().addVectors(pM1, pM5).multiplyScalar(0.5);
	const footAxisVec = new THREE.Vector3().subVectors(forefootMid, pHeel);
	const heelToForefootDist = footAxisVec.length();
	const footAxisNorm = footAxisVec.clone().normalize();

	// 2. Compute ground plane from the 3 landmarks
	const v1 = new THREE.Vector3().subVectors(pM1, pHeel);
	const v2 = new THREE.Vector3().subVectors(pM5, pHeel);
	let groundNormal = new THREE.Vector3().crossVectors(v1, v2).normalize();

	// Ensure ground normal points "up" (away from plantar surface)
	if (groundNormal.length() < 1e-6) {
		// Degenerate case: landmarks are collinear, fall back to Z-up
		groundNormal.set(0, 0, 1);
	}

	// Use the mesh centroid to verify ground normal direction.
	// The centroid of a foot scan is above the ground plane (dorsal side),
	// so dot(centroid - heel, groundNormal) should be positive.
	const posAttrForCentroid = footMesh.getAttribute('position');
	if (posAttrForCentroid && posAttrForCentroid.count > 0) {
		const centroid = new THREE.Vector3();
		for (let i = 0; i < posAttrForCentroid.count; i++) {
			centroid.x += posAttrForCentroid.getX(i);
			centroid.y += posAttrForCentroid.getY(i);
			centroid.z += posAttrForCentroid.getZ(i);
		}
		centroid.divideScalar(posAttrForCentroid.count);
		const centroidRel = centroid.clone().sub(pHeel);
		if (centroidRel.dot(groundNormal) < 0) {
			// Ground normal is pointing toward plantar side — flip it
			groundNormal.negate();
		}
	}

	// 3. Lateral axis: perpendicular to footAxis within the ground plane
	const lateralAxis = new THREE.Vector3().crossVectors(groundNormal, footAxisNorm).normalize();

	// If lateral axis is degenerate, recalculate
	if (lateralAxis.length() < 1e-6) {
		// Fallback: use M1→M5 direction
		lateralAxis.copy(new THREE.Vector3().subVectors(pM5, pM1).normalize());
	}

	// 4. Forefoot width: project M1→M5 onto lateral axis
	const m1m5 = new THREE.Vector3().subVectors(pM1, pM5);
	const forefootWidth = Math.abs(m1m5.dot(lateralAxis));

	// 5. Scan the mesh to find foot length, navicular, calcaneus, toe tip
	const posAttr = footMesh.getAttribute('position');
	if (!posAttr) {
		throw new Error('Foot mesh has no position attribute');
	}

	let maxProjection = -Infinity;
	let minProjection = Infinity;
	let toeTipPoint = pHeel.clone();
	const tmp = new THREE.Vector3();

	// Track vertices in different regions for auto-deriving landmarks
	let bestNavicularHeight = -Infinity;
	let navicularPoint = forefootMid.clone();
	let lowestPosteriorW = Infinity;
	let calcaneusPoint = pHeel.clone();
	let lateralEdgePoint = pM5.clone();
	let maxLateralV = -Infinity;

	for (let i = 0; i < posAttr.count; i++) {
		tmp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
		const rel = tmp.clone().sub(pHeel);
		const u = rel.dot(footAxisNorm); // projection along foot axis
		const v = rel.dot(lateralAxis); // projection along lateral axis
		const w = rel.dot(groundNormal); // height above ground plane

		// Foot length: most distal vertex
		if (u > maxProjection) {
			maxProjection = u;
			toeTipPoint.copy(tmp);
		}
		if (u < minProjection) {
			minProjection = u;
		}

		// Navicular: highest vertex in the medial midfoot region
		// Medial = negative V for right foot (or positive for left), midfoot = 30-60% of heel-to-forefoot distance
		const tU = u / heelToForefootDist;
		if (tU > 0.25 && tU < 0.65) {
			// Check if on medial side (opposite to M5 direction)
			const m5Side = new THREE.Vector3().subVectors(pM5, pHeel).dot(lateralAxis);
			const isMedial = m5Side > 0 ? v < 0 : v > 0;
			if (isMedial && w > bestNavicularHeight) {
				bestNavicularHeight = w;
				navicularPoint.copy(tmp);
			}
		}

		// Calcaneus: lowest posterior vertex (bottom of heel)
		if (tU >= -0.1 && tU < 0.15 && w < lowestPosteriorW) {
			lowestPosteriorW = w;
			calcaneusPoint.copy(tmp);
		}

		// Lateral edge: most lateral vertex in the midfoot
		if (tU > 0.2 && tU < 0.8) {
			const m5Side = new THREE.Vector3().subVectors(pM5, pHeel).dot(lateralAxis);
			const lateralV = m5Side > 0 ? v : -v;
			if (lateralV > maxLateralV) {
				maxLateralV = lateralV;
				lateralEdgePoint.copy(tmp);
			}
		}
	}

	const footLength = maxProjection - Math.min(0, minProjection);

	// Arch height: navicular height relative to ground plane
	const archHeight = bestNavicularHeight > -Infinity ? bestNavicularHeight : 0;

	// Infer foot side from filename or landmark geometry
	let side: 'left' | 'right' | 'unknown' = 'unknown';
	if (filename) {
		const lower = filename.toLowerCase();
		if (lower.includes('_l.') || lower.includes('_l_') || lower.includes('left') || lower.endsWith('_l')) {
			side = 'left';
		} else if (lower.includes('_r.') || lower.includes('_r_') || lower.includes('right') || lower.endsWith('_r')) {
			side = 'right';
		}
	}

	const derived: DerivedLandmarks = {
		navicular: navicularPoint.toArray() as [number, number, number],
		calcaneus: calcaneusPoint.toArray() as [number, number, number],
		toeTip: toeTipPoint.toArray() as [number, number, number],
		lateralEdge: lateralEdgePoint.toArray() as [number, number, number],
	};

	const complete: CompleteLandmarkSet = {
		...landmarks,
		...derived,
	};

	const footGeometryResult: FootGeometry = {
		footLength,
		forefootWidth,
		footAxis: footAxisNorm.toArray() as [number, number, number],
		lateralAxis: lateralAxis.toArray() as [number, number, number],
		groundNormal: groundNormal.toArray() as [number, number, number],
		origin: pHeel.toArray() as [number, number, number],
		forefootMid: forefootMid.toArray() as [number, number, number],
		archHeight,
		side,
	};

	return { footGeometry: footGeometryResult, derived, complete };
}

/**
 * Convert a CompleteLandmarkSet (new 3-point system) into the legacy LandmarkPoints
 * format needed by the existing insole generation and corrections pipeline.
 */
export function completeLandmarksToLegacy(complete: CompleteLandmarkSet): LandmarkPoints {
	return {
		meta1: complete.meta1,
		meta5: complete.meta5,
		navicular: complete.navicular,
		calcaneus: complete.calcaneus,
		heel: complete.heel,
		toeTip: complete.toeTip,
	};
}

// ============================================
// Legacy 5-Point System (preserved for backward compatibility)
// ============================================

export function computeFootReference(
	points: LandmarkPoints
): FootReferenceFrame {
	const pHeel = toVec(points.heel);
	const p1 = toVec(points.meta1);
	const p5 = toVec(points.meta5);
	const pNav = toVec(points.navicular);
	const pToe = points.toeTip ? toVec(points.toeTip) : null;

	// Forefoot midpoint and long axis
	const pFore = new THREE.Vector3().addVectors(p1, p5).multiplyScalar(0.5);
	const longAxis = new THREE.Vector3().subVectors(pFore, pHeel).normalize();

	// Base plane from heel + met heads
	const v1 = new THREE.Vector3().subVectors(p1, pHeel);
	const v2 = new THREE.Vector3().subVectors(p5, pHeel);
	const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

	// Lateral axis completes a RHS (normal x longAxis gives lateral)
	const lateral = new THREE.Vector3()
		.crossVectors(normal, longAxis)
		.normalize();

	// Arch height (signed distance of navicular to plane)
	const archHeight = normal.dot(new THREE.Vector3().subVectors(pNav, pHeel));

	// Foot length and width (project width onto plane)
	const forefootLength = new THREE.Vector3().subVectors(pFore, pHeel).length();
	const toeProjection = pToe
		? new THREE.Vector3().subVectors(pToe, pHeel).dot(longAxis)
		: forefootLength;
	const footLength = Math.max(forefootLength, toeProjection);
	const widthVec = new THREE.Vector3().subVectors(p1, p5);
	const widthProjected = widthVec
		.clone()
		.sub(normal.clone().multiplyScalar(normal.dot(widthVec)));
	const forefootWidth = widthProjected.length();

	return {
		origin: pHeel,
		longAxis,
		normal,
		lateral,
		archHeight,
		footLength,
		forefootWidth,
		forefootMid: pFore,
	};
}

export function generateSlicePlanes(
	frame: FootReferenceFrame,
	sliceSpacing = 0.004
): SlicePlane[] {
	const { origin, longAxis, normal, footLength } = frame;
	const count = Math.max(5, Math.floor(footLength / sliceSpacing));
	const planes: SlicePlane[] = [];
	for (let i = 0; i <= count; i++) {
		const t = i / count;
		const point = origin
			.clone()
			.add(longAxis.clone().multiplyScalar(footLength * t));
		planes.push({ point, normal: normal.clone(), t });
	}
	return planes;
}

export interface InsoleDesignPlan {
	frame: FootReferenceFrame;
	slices: SlicePlane[];
	notes: string[];
}

export function buildInsolePlan(
	points: LandmarkPoints,
	options?: { sliceSpacing?: number }
): InsoleDesignPlan {
	const frame = computeFootReference(points);
	const slices = generateSlicePlanes(frame, options?.sliceSpacing ?? 0.004);
	return {
		frame,
		slices,
		notes: [
			'Use slices to sample the foot mesh along the long axis.',
			'Raise medial arch support around navicular height.',
			'Add heel cup around calcaneus; blend smoothly.',
			'Offset top surface by chosen thickness for bottom shell.',
		],
	};
}

export function tupleToVec(p: [number, number, number]) {
	return toVec(p);
}

export function mapToFrame(
	p: THREE.Vector3,
	frame: FootReferenceFrame
): { u: number; v: number; w: number } {
	const rel = p.clone().sub(frame.origin);
	return {
		u: rel.dot(frame.longAxis),
		v: rel.dot(frame.lateral),
		w: rel.dot(frame.normal),
	};
}

export interface InsoleGenerationOptions {
	thickness?: number; // base shell thickness (meters)
	resU?: number;
	resV?: number;
	archBoost?: number; // multiplier on navicular height
	archSpread?: { u: number; v: number };
	heelCupDepth?: number;
	heelCupSpread?: { u: number; v: number };
}

export function buildInsoleGeometry(
	footGeometry: THREE.BufferGeometry,
	points: LandmarkPoints,
	options?: InsoleGenerationOptions
): THREE.BufferGeometry | null {
	const frame = computeFootReference(points);
	const thickness = options?.thickness ?? 0.004; // 4 mm
	const resU = options?.resU ?? 120;
	const resV = options?.resV ?? 60;
	const archBoost = options?.archBoost ?? 0.8;
	const archSpread = options?.archSpread ?? { u: 0.22, v: 0.35 };
	const heelCupDepth = options?.heelCupDepth ?? 0.008; // 8 mm
	const heelCupSpread = options?.heelCupSpread ?? { u: 0.12, v: 0.35 };

	const posAttr = footGeometry.getAttribute('position');
	if (!posAttr) return null;

	// Map all vertices to local frame and collect bounds
	const verts: Array<{ u: number; v: number; w: number }> = [];
	let minU = Infinity;
	let maxU = -Infinity;
	let minV = Infinity;
	let maxV = -Infinity;
	for (let i = 0; i < posAttr.count; i++) {
		const p = new THREE.Vector3(
			posAttr.getX(i),
			posAttr.getY(i),
			posAttr.getZ(i)
		);
		const t = mapToFrame(p, frame);
		verts.push(t);
		minU = Math.min(minU, t.u);
		maxU = Math.max(maxU, t.u);
		minV = Math.min(minV, t.v);
		maxV = Math.max(maxV, t.v);
	}

	// Clamp U to [0, footLength] so slicer covers the plantar region
	minU = Math.max(0, minU);
	maxU = Math.max(frame.footLength, maxU);

	const du = (maxU - minU) / (resU - 1);
	const dv = (maxV - minV) / (resV - 1);
	const heights = new Float32Array(resU * resV).fill(Number.NEGATIVE_INFINITY);

	// Rasterize max height (w) into grid
	for (const t of verts) {
		const iu = Math.min(resU - 1, Math.max(0, Math.floor((t.u - minU) / du)));
		const iv = Math.min(resV - 1, Math.max(0, Math.floor((t.v - minV) / dv)));
		const idx = iv * resU + iu;
		if (t.w > heights[idx]) heights[idx] = t.w;
	}

	// Replace missing with zero and smooth a few times
	for (let i = 0; i < heights.length; i++) {
		if (!Number.isFinite(heights[i])) heights[i] = 0;
	}
	const smoothPasses = 3;
	for (let pass = 0; pass < smoothPasses; pass++) {
		const copy = heights.slice();
		for (let iv = 1; iv < resV - 1; iv++) {
			for (let iu = 1; iu < resU - 1; iu++) {
				const idx = iv * resU + iu;
				const acc =
					copy[idx] +
					copy[idx - 1] +
					copy[idx + 1] +
					copy[idx - resU] +
					copy[idx + resU];
				heights[idx] = acc / 5;
			}
		}
	}

	// Apply arch lift (Gaussian bump) based on navicular
	const navLocal = mapToFrame(toVec(points.navicular), frame);
	const archSigmaU = archSpread.u * frame.footLength;
	const archSigmaV = archSpread.v * frame.forefootWidth;
	for (let iv = 0; iv < resV; iv++) {
		for (let iu = 0; iu < resU; iu++) {
			const u = minU + iu * du;
			const v = minV + iv * dv;
			const duNav = (u - navLocal.u) / archSigmaU;
			const dvNav = (v - navLocal.v) / archSigmaV;
			const gauss = Math.exp(-(duNav * duNav + dvNav * dvNav));
			heights[iv * resU + iu] += archBoost * frame.archHeight * gauss;
		}
	}

	// Apply heel cup (Gaussian dip)
	const heelLocal = mapToFrame(toVec(points.calcaneus), frame);
	const heelSigmaU = heelCupSpread.u * frame.footLength;
	const heelSigmaV = heelCupSpread.v * frame.forefootWidth;
	for (let iv = 0; iv < resV; iv++) {
		for (let iu = 0; iu < resU; iu++) {
			const u = minU + iu * du;
			const v = minV + iv * dv;
			const duH = (u - heelLocal.u) / heelSigmaU;
			const dvH = (v - heelLocal.v) / heelSigmaV;
			const gauss = Math.exp(-(duH * duH + dvH * dvH));
			heights[iv * resU + iu] -= heelCupDepth * gauss;
		}
	}

	// Build positions for top and bottom
	const vertCount = resU * resV * 2;
	const positions = new Float32Array(vertCount * 3);
	const idxTop = (iv: number, iu: number) => (iv * resU + iu) * 3;
	const idxBot = (iv: number, iu: number) => (resU * resV + iv * resU + iu) * 3;

	for (let iv = 0; iv < resV; iv++) {
		for (let iu = 0; iu < resU; iu++) {
			const u = minU + iu * du;
			const v = minV + iv * dv;
			const h = heights[iv * resU + iu];

			const worldPos = frame.origin
				.clone()
				.add(frame.longAxis.clone().multiplyScalar(u))
				.add(frame.lateral.clone().multiplyScalar(v))
				.add(frame.normal.clone().multiplyScalar(h));
			const worldBottom = worldPos
				.clone()
				.add(frame.normal.clone().multiplyScalar(-thickness));

			const tIdx = idxTop(iv, iu);
			positions[tIdx] = worldPos.x;
			positions[tIdx + 1] = worldPos.y;
			positions[tIdx + 2] = worldPos.z;

			const bIdx = idxBot(iv, iu);
			positions[bIdx] = worldBottom.x;
			positions[bIdx + 1] = worldBottom.y;
			positions[bIdx + 2] = worldBottom.z;
		}
	}

	const indices: number[] = [];
	const pushQuad = (
		a: number,
		b: number,
		c: number,
		d: number,
		invert = false
	) => {
		if (!invert) {
			indices.push(a, b, d, b, c, d);
		} else {
			indices.push(a, d, b, b, d, c);
		}
	};

	// Top and bottom faces
	for (let iv = 0; iv < resV - 1; iv++) {
		for (let iu = 0; iu < resU - 1; iu++) {
			const a = iv * resU + iu;
			const b = iv * resU + iu + 1;
			const c = (iv + 1) * resU + iu + 1;
			const d = (iv + 1) * resU + iu;
			pushQuad(a, b, c, d, false); // top
			const a2 = resU * resV + a;
			const b2 = resU * resV + b;
			const c2 = resU * resV + c;
			const d2 = resU * resV + d;
			pushQuad(a2, b2, c2, d2, true); // bottom (invert)
		}
	}

	// Side walls
	const topOffset = 0;
	const botOffset = resU * resV;
	const wall = (a: number, b: number) => {
		indices.push(topOffset + a, topOffset + b, botOffset + b);
		indices.push(topOffset + a, botOffset + b, botOffset + a);
	};

	for (let iu = 0; iu < resU - 1; iu++) {
		// minV edge
		wall(iu, iu + 1);
		// maxV edge
		wall((resV - 1) * resU + iu, (resV - 1) * resU + iu + 1);
	}
	for (let iv = 0; iv < resV - 1; iv++) {
		// minU edge
		wall(iv * resU, (iv + 1) * resU);
		// maxU edge
		wall(iv * resU + (resU - 1), (iv + 1) * resU + (resU - 1));
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geom.setIndex(indices);
	geom.computeVertexNormals();
	return geom;
}

export interface TemplateFitOptions extends InsoleGenerationOptions {
	padScale?: number; // overall XY padding multiplier
}

/**
 * Fit the provided base insole geometry (GLTF template) to the foot scan using
 * bounding boxes and landmark-driven arch / heel shaping.
 */
export function fitTemplateInsole(
	baseGeometry: THREE.BufferGeometry,
	footGeometry: THREE.BufferGeometry,
	points: LandmarkPoints,
	options?: TemplateFitOptions
): THREE.BufferGeometry | null {
	const frame = computeFootReference(points);
	const thickness = options?.thickness ?? 0.004; // 4 mm shell
	const archBoost = options?.archBoost ?? 0.75;
	const archSpread = options?.archSpread ?? { u: 0.22, v: 0.35 };
	const heelCupDepth = options?.heelCupDepth ?? 0.007; // 7 mm dip
	const heelCupSpread = options?.heelCupSpread ?? { u: 0.12, v: 0.35 };
	const padScale = options?.padScale ?? 1.02; // a bit wider/longer than the scan

	const template = baseGeometry.clone();
	template.computeBoundingBox();
	footGeometry.computeBoundingBox();
	if (!template.boundingBox || !footGeometry.boundingBox) return null;

	const tBox = template.boundingBox;
	const fBox = footGeometry.boundingBox;
	const tSize = tBox.getSize(new THREE.Vector3());
	const fSize = fBox.getSize(new THREE.Vector3());
	const tCenter = tBox.getCenter(new THREE.Vector3());
	const fCenter = fBox.getCenter(new THREE.Vector3());

	// Scale template to foot size (x / z dominant). Uniform scale to preserve template proportions.
	const scaleX = (fSize.x * padScale) / (tSize.x || 1);
	const scaleZ = (fSize.z * padScale) / (tSize.z || 1);
	const uniformScale = Math.max(scaleX, scaleZ);

	const m = new THREE.Matrix4()
		.makeTranslation(-tCenter.x, -tCenter.y, -tCenter.z)
		.multiply(
			new THREE.Matrix4().makeScale(uniformScale, uniformScale, uniformScale)
		)
		.multiply(
			new THREE.Matrix4().makeTranslation(fCenter.x, fCenter.y, fCenter.z)
		);
	template.applyMatrix4(m);
	template.computeBoundingBox();

	const posAttr = template.getAttribute('position') as THREE.BufferAttribute;
	if (!posAttr) return null;

	// Apply arch lift and heel cup along the anatomical frame normal
	const navLocal = mapToFrame(toVec(points.navicular), frame);
	const heelLocal = mapToFrame(toVec(points.calcaneus), frame);
	const archSigmaU = archSpread.u * frame.footLength;
	const archSigmaV = archSpread.v * frame.forefootWidth;
	const heelSigmaU = heelCupSpread.u * frame.footLength;
	const heelSigmaV = heelCupSpread.v * frame.forefootWidth;

	for (let i = 0; i < posAttr.count; i++) {
		const p = new THREE.Vector3(
			posAttr.getX(i),
			posAttr.getY(i),
			posAttr.getZ(i)
		);
		const { u, v } = mapToFrame(p, frame);

		// Arch bump
		const duNav = (u - navLocal.u) / archSigmaU;
		const dvNav = (v - navLocal.v) / archSigmaV;
		const archGauss = Math.exp(-(duNav * duNav + dvNav * dvNav));

		// Heel cup dip
		const duH = (u - heelLocal.u) / heelSigmaU;
		const dvH = (v - heelLocal.v) / heelSigmaV;
		const heelGauss = Math.exp(-(duH * duH + dvH * dvH));

		const delta =
			archBoost * frame.archHeight * archGauss - heelCupDepth * heelGauss;

		// Offset along frame normal; include thickness to push shell under foot
		const offset = frame.normal.clone().multiplyScalar(delta - thickness);
		p.add(offset);

		posAttr.setXYZ(i, p.x, p.y, p.z);
	}

	posAttr.needsUpdate = true;
	template.computeVertexNormals();
	return template;
}

export interface BasicInsoleOptions extends InsoleGenerationOptions {
	padScale?: number; // expand relative to foot outline
	toeTaper?: number; // 0..1 taper factor toward toes
	heelTaper?: number; // 0..1 taper factor toward heel
	resU?: number;
	resV?: number;
	/** Additional scale factor applied to the planform (length + width). */
	lengthScale?: number;
	/** Raise the lateral/medial edges above the top surface (world units). */
	rimHeight?: number;
	/** Width of the raised rim band measured inward from the outer edge (world units). */
	rimBandThickness?: number;
	/** Shift the medial arch center forward/backward along the foot length (world units). */
	archCenterShift?: number;
	/**
	 * Optional override to scale the insole planform to a target foot length.
	 * Uses the landmark-derived frame length as the reference.
	 */
	targetFootLength?: number;
	/**
	 * Optional override to steer arch height (world units). Implemented as an
	 * archBoost derived from frame.archHeight.
	 */
	targetArchHeight?: number;
}

/**
 * Build a simple parametric insole (no GLTF) that is easy to deform later.
 * Uses foot bbox + landmarks to set size and arch/heel shaping.
 */
export function buildBasicInsole(
	footGeometry: THREE.BufferGeometry,
	points: LandmarkPoints,
	options?: BasicInsoleOptions
): THREE.BufferGeometry | null {
	const frame = computeFootReference(points);
	const padScale = options?.padScale ?? 1.02;
	const thickness = options?.thickness ?? 0.004; // 4 mm
	let archBoost = options?.archBoost ?? 0.75;
	const archSpread = options?.archSpread ?? { u: 0.22, v: 0.35 };
	const heelCupDepth = options?.heelCupDepth ?? 0.007; // 7 mm
	const heelCupSpread = options?.heelCupSpread ?? { u: 0.12, v: 0.35 };
	const toeTaper = options?.toeTaper ?? 0.14;
	const heelTaper = options?.heelTaper ?? 0.08;
	const resU = options?.resU ?? 140;
	const resV = options?.resV ?? 70;
	const targetFootLength = options?.targetFootLength;
	const targetArchHeight = options?.targetArchHeight;
	const archCenterShift = options?.archCenterShift ?? 0;
	const lengthScale = options?.lengthScale;
	const rimHeight = options?.rimHeight ?? 0;
	const rimBandThickness = Math.max(0, options?.rimBandThickness ?? thickness);
	const smoothstep = (edge0: number, edge1: number, x: number) => {
		const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
		return t * t * (3 - 2 * t);
	};

	if (typeof targetArchHeight === 'number' && Number.isFinite(targetArchHeight)) {
		const denom = frame.archHeight;
		if (Math.abs(denom) > 1e-8) {
			archBoost = targetArchHeight / denom;
			archBoost = Math.max(-5, Math.min(5, archBoost));
		}
	}

	footGeometry.computeBoundingBox();
	const bbox = footGeometry.boundingBox;
	if (!bbox) return null;
	const size = bbox.getSize(new THREE.Vector3());
	let planScale =
		typeof targetFootLength === 'number' &&
		Number.isFinite(targetFootLength) &&
		targetFootLength > 1e-6
			? targetFootLength / frame.footLength
			: 1;
	if (typeof lengthScale === 'number' && Number.isFinite(lengthScale)) {
		planScale *= Math.max(0.1, lengthScale);
	}
	const width = size.x * padScale * planScale;
	const length = frame.footLength * padScale * planScale;

	// Sigma for arch/heel
	const archSigmaU = archSpread.u * frame.footLength * planScale;
	const archSigmaV = archSpread.v * frame.forefootWidth * planScale;
	const heelSigmaU = heelCupSpread.u * frame.footLength * planScale;
	const heelSigmaV = heelCupSpread.v * frame.forefootWidth * planScale;

	const navLocalRaw = mapToFrame(toVec(points.navicular), frame);
	const heelLocalRaw = mapToFrame(toVec(points.calcaneus), frame);
	const navLocal = {
		u: navLocalRaw.u * planScale + archCenterShift,
		v: navLocalRaw.v * planScale,
	};
	const heelLocal = {
		u: heelLocalRaw.u * planScale,
		v: heelLocalRaw.v * planScale,
	};

	const positions = new Float32Array(resU * resV * 2 * 3);
	const indices: number[] = [];

	const idxTop = (iv: number, iu: number) => (iv * resU + iu) * 3;
	const idxBot = (iv: number, iu: number) => (resU * resV + iv * resU + iu) * 3;

	for (let iu = 0; iu < resU; iu++) {
		const tu = iu / (resU - 1);
		const u = tu * length; // 0 at heel, +length toward toes
		// Taper width along length: wider mid/fore, slimmer heel
		const taper =
			1 -
			heelTaper * (1 - tu) - // heel side
			toeTaper * tu; // toe side
		const halfW = width * 0.5 * taper;

		for (let iv = 0; iv < resV; iv++) {
			const lateralOffset = (iv - (resV - 1) / 2) / ((resV - 1) / 2); // -1..1
			const v = lateralOffset * halfW;

			// Height shaping
			const duNav = (u - navLocal.u) / archSigmaU;
			const dvNav = (v - navLocal.v) / archSigmaV;
			const archGauss = Math.exp(-(duNav * duNav + dvNav * dvNav));

			const duH = (u - heelLocal.u) / heelSigmaU;
			const dvH = (v - heelLocal.v) / heelSigmaV;
			const heelGauss = Math.exp(-(duH * duH + dvH * dvH));

			let h =
				archBoost * frame.archHeight * archGauss - heelCupDepth * heelGauss;

			if (rimHeight > 0) {
				const edge = Math.abs(lateralOffset);
				const rimBandNormalized = Math.max(
					0.08,
					Math.min(0.45, rimBandThickness / Math.max(1e-6, halfW))
				);
				const rimStart = Math.max(0.45, 1.0 - rimBandNormalized);
				const rimWeight = smoothstep(rimStart, 1.0, edge);
				h += rimHeight * rimWeight;
			}

			const worldPos = frame.origin
				.clone()
				.add(frame.longAxis.clone().multiplyScalar(u))
				.add(frame.lateral.clone().multiplyScalar(v))
				.add(frame.normal.clone().multiplyScalar(h));
			const worldBottom = worldPos
				.clone()
				.add(frame.normal.clone().multiplyScalar(-thickness));

			const tIdx = idxTop(iv, iu);
			positions[tIdx] = worldPos.x;
			positions[tIdx + 1] = worldPos.y;
			positions[tIdx + 2] = worldPos.z;

			const bIdx = idxBot(iv, iu);
			positions[bIdx] = worldBottom.x;
			positions[bIdx + 1] = worldBottom.y;
			positions[bIdx + 2] = worldBottom.z;
		}
	}

	const pushQuad = (
		a: number,
		b: number,
		c: number,
		d: number,
		invert = false
	) => {
		if (!invert) {
			indices.push(a, b, d, b, c, d);
		} else {
			indices.push(a, d, b, b, d, c);
		}
	};

	// Top and bottom faces
	for (let iv = 0; iv < resV - 1; iv++) {
		for (let iu = 0; iu < resU - 1; iu++) {
			const a = iv * resU + iu;
			const b = iv * resU + iu + 1;
			const c = (iv + 1) * resU + iu + 1;
			const d = (iv + 1) * resU + iu;
			pushQuad(a, b, c, d, false); // top
			const a2 = resU * resV + a;
			const b2 = resU * resV + b;
			const c2 = resU * resV + c;
			const d2 = resU * resV + d;
			pushQuad(a2, b2, c2, d2, true); // bottom (invert)
		}
	}

	// Side walls
	const topOffset = 0;
	const botOffset = resU * resV;
	const wall = (a: number, b: number) => {
		indices.push(topOffset + a, topOffset + b, botOffset + b);
		indices.push(topOffset + a, botOffset + b, botOffset + a);
	};

	for (let iu = 0; iu < resU - 1; iu++) {
		// minV edge
		wall(iu, iu + 1);
		// maxV edge
		wall((resV - 1) * resU + iu, (resV - 1) * resU + iu + 1);
	}
	for (let iv = 0; iv < resV - 1; iv++) {
		// minU edge
		wall(iv * resU, (iv + 1) * resU);
		// maxU edge
		wall(iv * resU + (resU - 1), (iv + 1) * resU + (resU - 1));
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geom.setIndex(indices);
	geom.computeVertexNormals();
	return geom;
}

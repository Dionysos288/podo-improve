/**
 * ──────────────────────────────────────────────
 *  Element geometry core
 *
 *  Pure, framework-free helpers that turn placed orthotic elements into
 *  insole geometry (vertex displacement + vertex colours) and smooth the
 *  result so raised pads melt into the insole body without seams.
 *
 *  This module is intentionally free of React/three-fiber so it can run on
 *  the main thread OR inside a Web Worker (see useElementsGeometryWorker).
 * ──────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { PlacedElement } from '../types';
import { applyElements, applyElementColors } from '../applyElements';

export type ElementSmoothStrength = 'mild' | 'full';

/**
 * Raw buffers describing an insole mesh. Transferable across a worker boundary.
 */
export interface ElementGeometryComputeInput {
	/** Flat XYZ position array (length = vertexCount * 3). */
	positions: Float32Array;
	/** Optional flat XYZ normal array. Recomputed when omitted. */
	normals?: Float32Array;
	/** Optional triangle index (Uint32). Needed for melt smoothing. */
	index?: Uint32Array;
	elements: PlacedElement[];
	mmToWorld: number;
	smooth: ElementSmoothStrength;
	baseColorHex?: string;
}

export interface ElementGeometryComputeResult {
	positions: Float32Array;
	colors: Float32Array;
}

/**
 * C² quintic smootherstep. Zero 1st and 2nd derivatives at t=0 and t=1, so
 * ramps built from it meet the surrounding surface with no visible crease.
 */
export function quinticEase(t: number): number {
	const c = t < 0 ? 0 : t > 1 ? 1 : t;
	return c * c * c * (c * (c * 6 - 15) + 10);
}

/**
 * Single C² side-ramp weight for an element pad, used everywhere a pad rises
 * from the insole so the slope is identical between the printed displacement
 * and the coloured overlay.
 *
 * The ramp lives entirely INSIDE the footprint: weight is 0 (flush with the
 * surface, zero slope) exactly at the outline edge and reaches 1 over
 * `blendNorm` worth of inward distance. Because both value and slope are 0 at
 * the edge, the pad emerges smoothly from the insole instead of forming a
 * vertical wall.
 */
export function elementSideWeight(
	edgeDist: number,
	inside: boolean,
	blendNorm: number,
): number {
	if (!inside) return 0;
	if (blendNorm <= 1e-6) return 1;
	return quinticEase(Math.min(edgeDist / blendNorm, 1));
}

interface SmoothElementsOptions {
	passes?: number;
	alpha?: number;
	dilateRings?: number;
	normalThreshold?: number;
}

/**
 * "Elementen vloeien" melt for the printed insole mesh.
 *
 * Smooths ONLY the vertices the elements displaced (plus a dilated ring of
 * surrounding insole) along the height axis, so raised pads round off and
 * blend into the body instead of reading as sharp steps. Operates in place on
 * the height axis and returns the same geometry.
 */
export function smoothElementsIntoInsole(
	geometry: THREE.BufferGeometry,
	/** Height-axis positions captured BEFORE applyElements (full x/y/z array). */
	basePositions: Float32Array,
	options: SmoothElementsOptions = {},
): THREE.BufferGeometry {
	const {
		passes = 14,
		alpha = 0.5,
		dilateRings = 3,
		normalThreshold = 0.2,
	} = options;

	if (!geometry.index) return geometry;
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | null;
	const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | null;
	if (!posAttr || !normalAttr) return geometry;

	const vertCount = posAttr.count;
	if (basePositions.length < vertCount * 3) return geometry;
	const idxArr = geometry.index.array;
	const faceCount = idxArr.length / 3;

	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const sz = bbox.getSize(new THREE.Vector3());
	const hAxisIdx: 0 | 1 | 2 = sz.x <= sz.y && sz.x <= sz.z ? 0 : sz.y <= sz.z ? 1 : 2;

	const neighborSets: Set<number>[] = Array.from(
		{ length: vertCount },
		() => new Set<number>(),
	);
	for (let f = 0; f < faceCount; f++) {
		const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
		neighborSets[a].add(b); neighborSets[a].add(c);
		neighborSets[b].add(a); neighborSets[b].add(c);
		neighborSets[c].add(a); neighborSets[c].add(b);
	}

	const normals = normalAttr.array as Float32Array;
	const topFacing = new Uint8Array(vertCount);
	for (let v = 0; v < vertCount; v++) {
		if (normals[v * 3 + hAxisIdx] > normalThreshold) topFacing[v] = 1;
	}

	const pos = posAttr.array as Float32Array;

	let maxDelta = 1e-6;
	const deltas = new Float32Array(vertCount);
	for (let v = 0; v < vertCount; v++) {
		const d = Math.abs(pos[v * 3 + hAxisIdx] - basePositions[v * 3 + hAxisIdx]);
		deltas[v] = d;
		if (d > maxDelta) maxDelta = d;
	}
	if (maxDelta <= 1e-5) return geometry;
	const threshold = Math.max(1e-5, maxDelta * 0.02);
	const affected = new Uint8Array(vertCount);
	for (let v = 0; v < vertCount; v++) {
		if (deltas[v] > threshold) affected[v] = 1;
	}
	for (let r = 0; r < dilateRings; r++) {
		const snapshot = affected.slice();
		for (let v = 0; v < vertCount; v++) {
			if (!snapshot[v]) continue;
			for (const nb of neighborSets[v]) affected[nb] = 1;
		}
	}

	const heights = new Float32Array(vertCount);
	for (let v = 0; v < vertCount; v++) heights[v] = pos[v * 3 + hAxisIdx];
	const tmp = heights.slice();

	for (let p = 0; p < passes; p++) {
		for (let v = 0; v < vertCount; v++) {
			if (!affected[v] || !topFacing[v]) { tmp[v] = heights[v]; continue; }
			const nbs = neighborSets[v];
			if (nbs.size === 0) { tmp[v] = heights[v]; continue; }
			let sum = 0;
			for (const nb of nbs) sum += heights[nb];
			tmp[v] = heights[v] + alpha * (sum / nbs.size - heights[v]);
		}
		heights.set(tmp);
	}

	for (let v = 0; v < vertCount; v++) {
		if (!affected[v] || !topFacing[v]) continue;
		pos[v * 3 + hAxisIdx] = heights[v];
	}

	posAttr.needsUpdate = true;
	geometry.computeVertexNormals();
	return geometry;
}

/**
 * Apply element height displacements to an insole geometry and, when the
 * "Elementen vloeien" strength is `full`, melt the displaced region into the
 * body. Mutates `geometry` in place.
 */
export function applyElementsWithSmoothing(
	geometry: THREE.BufferGeometry,
	elements: PlacedElement[],
	options: { mmToWorld: number; smooth: ElementSmoothStrength },
): void {
	if (!elements || elements.length === 0) return;

	const { mmToWorld, smooth } = options;

	let basePositions: Float32Array | null = null;
	if (smooth === 'full') {
		const prePos = geometry.getAttribute('position') as
			| THREE.BufferAttribute
			| undefined;
		if (prePos) basePositions = new Float32Array(prePos.array as Float32Array);
	}

	applyElements(geometry, elements, { mmToWorld });

	if (smooth === 'full' && basePositions) {
		smoothElementsIntoInsole(geometry, basePositions);
	}
}

/**
 * Worker-friendly entry point: rebuild a geometry from raw buffers, bake in the
 * elements (displacement + smoothing + vertex colours) and return the resulting
 * position and colour buffers. Pure with respect to its inputs.
 */
export function computeElementGeometry(
	input: ElementGeometryComputeInput,
): ElementGeometryComputeResult {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		'position',
		new THREE.BufferAttribute(new Float32Array(input.positions), 3),
	);
	if (input.normals) {
		geometry.setAttribute(
			'normal',
			new THREE.BufferAttribute(new Float32Array(input.normals), 3),
		);
	}
	if (input.index) {
		geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(input.index), 1));
	}
	if (!geometry.getAttribute('normal')) {
		geometry.computeVertexNormals();
	}

	applyElementsWithSmoothing(geometry, input.elements, {
		mmToWorld: input.mmToWorld,
		smooth: input.smooth,
	});

	applyElementColors(geometry, input.elements, {
		mmToWorld: input.mmToWorld,
		baseColor: input.baseColorHex,
	});

	const outPos = geometry.getAttribute('position') as THREE.BufferAttribute;
	const outColor = geometry.getAttribute('color') as THREE.BufferAttribute;
	const result: ElementGeometryComputeResult = {
		positions: new Float32Array(outPos.array as Float32Array),
		colors: new Float32Array(outColor.array as Float32Array),
	};
	geometry.dispose();
	return result;
}

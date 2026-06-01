import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';

const MAX_OVERLAY_VERTS = 120_000;
const MAX_TESSELLATE_VERTS = 80_000;
const MAX_LAPLACIAN_VERTS = 50_000;
const MERGE_TOLERANCE = 1e-4;
const OVERLAY_MERGE_TOLERANCE = 0.001;
const LAPLACIAN_PASSES = 4;
const LAPLACIAN_LAMBDA = 0.28;

function computeMaxSpan(geometry: THREE.BufferGeometry): number {
	if (!geometry.boundingBox) {
		geometry.computeBoundingBox();
	}
	const box = geometry.boundingBox;
	if (!box) return 1;
	return Math.max(
		box.max.x - box.min.x,
		box.max.y - box.min.y,
		box.max.z - box.min.z,
		1e-6,
	);
}

function mergeAndNormals(
	geometry: THREE.BufferGeometry,
	tolerance: number,
): THREE.BufferGeometry {
	try {
		const merged = BufferGeometryUtils.mergeVertices(geometry, tolerance);
		merged.computeVertexNormals();
		merged.computeBoundingBox();
		merged.computeBoundingSphere();
		if (merged !== geometry) {
			geometry.dispose();
		}
		return merged;
	} catch {
		geometry.computeVertexNormals();
		return geometry;
	}
}

function laplacianSmoothPositions(
	geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
	const posAttr = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| undefined;
	const index = geometry.getIndex();
	if (!posAttr || posAttr.count < 3 || posAttr.count > MAX_LAPLACIAN_VERTS) {
		return geometry;
	}

	const vertCount = posAttr.count;
	const neighborSets: Set<number>[] = Array.from(
		{ length: vertCount },
		() => new Set<number>(),
	);

	const addEdge = (a: number, b: number) => {
		if (a === b) return;
		neighborSets[a].add(b);
		neighborSets[b].add(a);
	};

	if (index) {
		const indices = index.array;
		for (let i = 0; i < indices.length; i += 3) {
			addEdge(indices[i], indices[i + 1]);
			addEdge(indices[i + 1], indices[i + 2]);
			addEdge(indices[i + 2], indices[i]);
		}
	} else {
		for (let i = 0; i + 2 < vertCount; i += 3) {
			addEdge(i, i + 1);
			addEdge(i + 1, i + 2);
			addEdge(i + 2, i);
		}
	}

	const working = new Float32Array(posAttr.array);

	for (let pass = 0; pass < LAPLACIAN_PASSES; pass++) {
		const next = new Float32Array(working);
		for (let v = 0; v < vertCount; v++) {
			const neighbors = neighborSets[v];
			if (neighbors.size === 0) continue;
			let avgX = 0;
			let avgY = 0;
			let avgZ = 0;
			for (const n of neighbors) {
				avgX += working[n * 3];
				avgY += working[n * 3 + 1];
				avgZ += working[n * 3 + 2];
			}
			const inv = 1 / neighbors.size;
			avgX *= inv;
			avgY *= inv;
			avgZ *= inv;
			const base = v * 3;
			next[base] = working[base] + (avgX - working[base]) * LAPLACIAN_LAMBDA;
			next[base + 1] =
				working[base + 1] + (avgY - working[base + 1]) * LAPLACIAN_LAMBDA;
			next[base + 2] =
				working[base + 2] + (avgZ - working[base + 2]) * LAPLACIAN_LAMBDA;
		}
		working.set(next);
	}

	posAttr.array.set(working);
	posAttr.needsUpdate = true;
	return geometry;
}

/**
 * Tessellate coarse triangles then weld for STL prep and box-grid bases.
 */
export function tessellateAndWeldGeometry(
	geometry: THREE.BufferGeometry,
	mmToWorld: number,
): THREE.BufferGeometry {
	const pos = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| undefined;
	if (!pos || pos.count < 3) {
		geometry.computeVertexNormals();
		return geometry;
	}

	if (pos.count > MAX_OVERLAY_VERTS) {
		return mergeAndNormals(geometry, MERGE_TOLERANCE);
	}

	const span = computeMaxSpan(geometry);
	const targetEdge = Math.max(0.06 * Math.max(mmToWorld, 1e-6), span / 32);

	try {
		const mod = new TessellateModifier(targetEdge, 6);
		const tessellated = mod.modify(geometry.clone());
		return mergeAndNormals(tessellated, MERGE_TOLERANCE);
	} catch {
		return mergeAndNormals(geometry, MERGE_TOLERANCE);
	}
}

const MELT_PASSES = 14;
const MELT_LAMBDA = 0.55;

/**
 * "Elementen vloeien" melt for the visible element overlay pad.
 *
 * Strongly smooths the pad ALONG ITS HEIGHT AXIS ONLY (averaging neighbour
 * heights, leaving the footprint x/y untouched). This rounds and lowers the
 * raised top and tapers the rim down toward the base so the colored element
 * visibly melts into the insole body instead of reading as a sharp raised pad.
 * The pad stays a pickable mesh.
 */
export function meltElementOverlayGeometry(
	geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
	let working = mergeAndNormals(geometry, OVERLAY_MERGE_TOLERANCE);
	const posAttr = working.getAttribute('position') as
		| THREE.BufferAttribute
		| undefined;
	const index = working.getIndex();
	if (
		!posAttr ||
		!index ||
		posAttr.count < 3 ||
		posAttr.count > MAX_LAPLACIAN_VERTS
	) {
		working.computeVertexNormals();
		return working;
	}

	const vertCount = posAttr.count;
	working.computeBoundingBox();
	const box = working.boundingBox!;
	const sx = box.max.x - box.min.x;
	const sy = box.max.y - box.min.y;
	const sz = box.max.z - box.min.z;
	const h: 0 | 1 | 2 = sx <= sy && sx <= sz ? 0 : sy <= sz ? 1 : 2;

	const neighborSets: Set<number>[] = Array.from(
		{ length: vertCount },
		() => new Set<number>(),
	);
	const indices = index.array;
	const addEdge = (a: number, b: number) => {
		if (a === b) return;
		neighborSets[a].add(b);
		neighborSets[b].add(a);
	};
	for (let i = 0; i < indices.length; i += 3) {
		addEdge(indices[i], indices[i + 1]);
		addEdge(indices[i + 1], indices[i + 2]);
		addEdge(indices[i + 2], indices[i]);
	}

	const arr = posAttr.array as Float32Array;
	const heights = new Float32Array(vertCount);
	for (let v = 0; v < vertCount; v++) heights[v] = arr[v * 3 + h];
	const tmp = heights.slice();

	for (let pass = 0; pass < MELT_PASSES; pass++) {
		for (let v = 0; v < vertCount; v++) {
			const nbs = neighborSets[v];
			if (nbs.size === 0) {
				tmp[v] = heights[v];
				continue;
			}
			let sum = 0;
			for (const n of nbs) sum += heights[n];
			tmp[v] = heights[v] + MELT_LAMBDA * (sum / nbs.size - heights[v]);
		}
		heights.set(tmp);
	}

	for (let v = 0; v < vertCount; v++) arr[v * 3 + h] = heights[v];
	posAttr.needsUpdate = true;
	working.computeVertexNormals();
	working.computeBoundingBox();
	working.computeBoundingSphere();
	return working;
}

/**
 * Final smooth pass for element overlay meshes after transform/trim.
 */
export function smoothElementOverlayGeometry(
	geometry: THREE.BufferGeometry,
	mmToWorld: number,
): THREE.BufferGeometry {
	const pos = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| undefined;
	if (!pos || pos.count < 3) {
		geometry.computeVertexNormals();
		return geometry;
	}

	let working = geometry;

	if (pos.count <= MAX_TESSELLATE_VERTS) {
		const span = computeMaxSpan(working);
		const targetEdge = Math.max(0.05 * Math.max(mmToWorld, 1e-6), span / 36);
		try {
			const mod = new TessellateModifier(targetEdge, 4);
			const tessellated = mod.modify(working.clone());
			if (working !== geometry) {
				working.dispose();
			}
			working = tessellated;
		} catch {
			/* keep working geometry */
		}
	}

	working = mergeAndNormals(working, OVERLAY_MERGE_TOLERANCE);
	working = laplacianSmoothPositions(working);
	working.computeVertexNormals();
	working.computeBoundingBox();
	working.computeBoundingSphere();
	return working;
}

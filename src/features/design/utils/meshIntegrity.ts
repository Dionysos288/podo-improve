import * as THREE from 'three';

type DistortionResult = {
	affectedVerts: Set<number>;
	severity: Float32Array;
};

const DEFAULT_DISTORTION_THRESHOLD = 0.8;

export function computeFaceNormals(
	geometry: THREE.BufferGeometry,
): Float32Array | null {
	const idx = geometry.index;
	const pos = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| null;
	if (!idx || !pos) return null;

	const idxArr = idx.array;
	const faceCount = idxArr.length / 3;
	const normals = new Float32Array(faceCount * 3);

	for (let f = 0; f < faceCount; f++) {
		const a = idxArr[f * 3];
		const b = idxArr[f * 3 + 1];
		const c = idxArr[f * 3 + 2];

		const ax = pos.getX(a);
		const ay = pos.getY(a);
		const az = pos.getZ(a);
		const e1x = pos.getX(b) - ax;
		const e1y = pos.getY(b) - ay;
		const e1z = pos.getZ(b) - az;
		const e2x = pos.getX(c) - ax;
		const e2y = pos.getY(c) - ay;
		const e2z = pos.getZ(c) - az;

		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

		normals[f * 3] = nx / len;
		normals[f * 3 + 1] = ny / len;
		normals[f * 3 + 2] = nz / len;
	}

	return normals;
}

export function snapshotPositions(
	geometry: THREE.BufferGeometry,
): Float32Array | null {
	const pos = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| null;
	if (!pos) return null;
	return new Float32Array(pos.array as Float32Array);
}

export function detectDistortedTriangles(
	geometry: THREE.BufferGeometry,
	referenceNormals: Float32Array,
	distortionThreshold = DEFAULT_DISTORTION_THRESHOLD,
): DistortionResult {
	const idx = geometry.index;
	const pos = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| null;
	const currentNormals = computeFaceNormals(geometry);
	if (!idx || !pos || !currentNormals) {
		return { affectedVerts: new Set<number>(), severity: new Float32Array(0) };
	}

	const idxArr = idx.array;
	const faceCount = idxArr.length / 3;
	const severity = new Float32Array(pos.count);
	const affectedVerts = new Set<number>();

	for (let f = 0; f < faceCount; f++) {
		const dot =
			referenceNormals[f * 3] * currentNormals[f * 3] +
			referenceNormals[f * 3 + 1] * currentNormals[f * 3 + 1] +
			referenceNormals[f * 3 + 2] * currentNormals[f * 3 + 2];

		if (dot >= distortionThreshold) continue;

		const a = idxArr[f * 3];
		const b = idxArr[f * 3 + 1];
		const c = idxArr[f * 3 + 2];
		const faceSeverity =
			dot < 0
				? 1
				: Math.max(
						0.15,
						(distortionThreshold - dot) /
							Math.max(1e-6, distortionThreshold),
					);

		affectedVerts.add(a);
		affectedVerts.add(b);
		affectedVerts.add(c);
		severity[a] = Math.max(severity[a], faceSeverity);
		severity[b] = Math.max(severity[b], faceSeverity);
		severity[c] = Math.max(severity[c], faceSeverity);
	}

	return { affectedVerts, severity };
}

function buildNeighborList(
	indexArray: ArrayLike<number>,
	vertCount: number,
): number[][] {
	const neighbors: number[][] = Array.from({ length: vertCount }, () => []);
	const faceCount = indexArray.length / 3;

	for (let f = 0; f < faceCount; f++) {
		const a = indexArray[f * 3];
		const b = indexArray[f * 3 + 1];
		const c = indexArray[f * 3 + 2];

		if (!neighbors[a].includes(b)) neighbors[a].push(b);
		if (!neighbors[a].includes(c)) neighbors[a].push(c);
		if (!neighbors[b].includes(a)) neighbors[b].push(a);
		if (!neighbors[b].includes(c)) neighbors[b].push(c);
		if (!neighbors[c].includes(a)) neighbors[c].push(a);
		if (!neighbors[c].includes(b)) neighbors[c].push(b);
	}

	return neighbors;
}

function expandVertexSet(
	verts: Set<number>,
	neighbors: number[][],
	rings: number,
): Set<number> {
	const result = new Set(verts);
	let frontier = new Set(verts);

	for (let ring = 0; ring < rings; ring++) {
		const nextFrontier = new Set<number>();
		for (const v of frontier) {
			for (const nb of neighbors[v]) {
				if (result.has(nb)) continue;
				result.add(nb);
				nextFrontier.add(nb);
			}
		}
		frontier = nextFrontier;
	}

	return result;
}

function computeRingDistances(
	seedVerts: Set<number>,
	repairZone: Set<number>,
	neighbors: number[][],
	vertCount: number,
): Float32Array {
	const dist = new Float32Array(vertCount);
	dist.fill(Number.POSITIVE_INFINITY);

	const queue: number[] = [];
	for (const v of seedVerts) {
		dist[v] = 0;
		queue.push(v);
	}

	let cursor = 0;
	while (cursor < queue.length) {
		const v = queue[cursor++];
		const nextDist = dist[v] + 1;
		for (const nb of neighbors[v]) {
			if (!repairZone.has(nb) || nextDist >= dist[nb]) continue;
			dist[nb] = nextDist;
			queue.push(nb);
		}
	}

	return dist;
}

function smoothRepairZone(
	pos: THREE.BufferAttribute,
	neighbors: number[][],
	repairZone: Set<number>,
	ringDistances: Float32Array,
	originalPositions: Float32Array,
	passes: number,
	alpha: number,
): void {
	const vertCount = pos.count;

	for (let pass = 0; pass < passes; pass++) {
		const tmpX = new Float32Array(vertCount);
		const tmpY = new Float32Array(vertCount);
		const tmpZ = new Float32Array(vertCount);

		for (let i = 0; i < vertCount; i++) {
			tmpX[i] = pos.getX(i);
			tmpY[i] = pos.getY(i);
			tmpZ[i] = pos.getZ(i);
		}

		for (const v of repairZone) {
			const nbs = neighbors[v];
			if (nbs.length === 0) continue;

			let sx = 0;
			let sy = 0;
			let sz = 0;
			for (const nb of nbs) {
				sx += tmpX[nb];
				sy += tmpY[nb];
				sz += tmpZ[nb];
			}

			const ringDist = ringDistances[v];
			const falloff = Number.isFinite(ringDist)
				? Math.max(0.12, 1 - ringDist / 4)
				: 0.12;
			const localAlpha = alpha * falloff;

			pos.setXYZ(
				v,
				tmpX[v] +
					localAlpha * (sx / nbs.length - tmpX[v]) +
					0.06 * falloff * (originalPositions[v * 3] - tmpX[v]),
				tmpY[v] +
					localAlpha * (sy / nbs.length - tmpY[v]) +
					0.06 * falloff * (originalPositions[v * 3 + 1] - tmpY[v]),
				tmpZ[v] +
					localAlpha * (sz / nbs.length - tmpZ[v]) +
					0.06 * falloff * (originalPositions[v * 3 + 2] - tmpZ[v]),
			);
		}
	}

	pos.needsUpdate = true;
}

export function repairDistortedVertices(
	geometry: THREE.BufferGeometry,
	originalPositions: Float32Array,
	affectedVerts: Set<number>,
	severity: Float32Array,
	origFaceNormals: Float32Array,
	maxPasses = 12,
): void {
	const idx = geometry.index;
	const pos = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| null;
	if (!idx || !pos || affectedVerts.size === 0) return;

	const neighbors = buildNeighborList(idx.array, pos.count);
	const repairZone = expandVertexSet(affectedVerts, neighbors, 3);
	const ringDistances = computeRingDistances(
		affectedVerts,
		repairZone,
		neighbors,
		pos.count,
	);

	for (let pass = 0; pass < maxPasses; pass++) {
		const current = detectDistortedTriangles(
			geometry,
			origFaceNormals,
			DEFAULT_DISTORTION_THRESHOLD,
		);
		if (current.affectedVerts.size === 0) break;

		const progress = pass / Math.max(1, maxPasses - 1);
		const laplacianAlpha = 0.14 + progress * 0.12;
		const pullToOriginal = 0.22 + progress * 0.34;

		for (const v of repairZone) {
			const nbs = neighbors[v];
			if (nbs.length === 0) continue;

			let sx = 0;
			let sy = 0;
			let sz = 0;
			for (const nb of nbs) {
				sx += pos.getX(nb);
				sy += pos.getY(nb);
				sz += pos.getZ(nb);
			}

			const cx = pos.getX(v);
			const cy = pos.getY(v);
			const cz = pos.getZ(v);
			const lapX = cx + laplacianAlpha * (sx / nbs.length - cx);
			const lapY = cy + laplacianAlpha * (sy / nbs.length - cy);
			const lapZ = cz + laplacianAlpha * (sz / nbs.length - cz);

			const localSeverity = Math.max(
				severity[v],
				current.severity[v],
				0.08,
			);
			const ringDist = ringDistances[v];
			const ringFalloff = Number.isFinite(ringDist)
				? Math.max(0.18, 1 - ringDist / 4)
				: 0.18;
			const blend = Math.min(
				0.82,
				pullToOriginal * localSeverity * ringFalloff,
			);

			pos.setXYZ(
				v,
				lapX + blend * (originalPositions[v * 3] - lapX),
				lapY + blend * (originalPositions[v * 3 + 1] - lapY),
				lapZ + blend * (originalPositions[v * 3 + 2] - lapZ),
			);
		}

		pos.needsUpdate = true;
	}

	smoothRepairZone(
		pos,
		neighbors,
		repairZone,
		ringDistances,
		originalPositions,
		5,
		0.22,
	);
}

export function clampVertexDisplacement(
	geometry: THREE.BufferGeometry,
	originalPositions: Float32Array,
	maxDist: number,
): void {
	const pos = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| null;
	if (!pos) return;

	const softStart = maxDist * 0.65;
	for (let i = 0; i < pos.count; i++) {
		for (let axis = 0; axis < 3; axis++) {
			const current = (pos.array as Float32Array)[i * 3 + axis];
			const original = originalPositions[i * 3 + axis];
			const delta = current - original;
			const absDelta = Math.abs(delta);
			if (absDelta <= softStart) continue;

			const sign = delta > 0 ? 1 : -1;
			const t =
				(absDelta - softStart) /
				Math.max(1e-6, maxDist - softStart);
			const smoothT = Math.min(1, t) ** 2 * (3 - 2 * Math.min(1, t));
			const finalDelta =
				softStart + (maxDist - softStart) * (1 - smoothT * 0.5);
			const clamped = original + sign * Math.min(absDelta, finalDelta);

			if (axis === 0) pos.setX(i, clamped);
			else if (axis === 1) pos.setY(i, clamped);
			else pos.setZ(i, clamped);
		}
	}

	pos.needsUpdate = true;
}

export function ensureMeshIntegrity(
	geometry: THREE.BufferGeometry,
	originalPositions: Float32Array,
	maxDisplacement?: number,
): void {
	if (!geometry.index) return;

	const pos = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| null;
	if (!pos) return;

	const currentPositions = new Float32Array(pos.array as Float32Array);
	(pos.array as Float32Array).set(originalPositions);
	pos.needsUpdate = true;
	const refNormals = computeFaceNormals(geometry);
	(pos.array as Float32Array).set(currentPositions);
	pos.needsUpdate = true;

	if (!refNormals) return;
	if (typeof maxDisplacement === 'number' && maxDisplacement > 0) {
		clampVertexDisplacement(geometry, originalPositions, maxDisplacement);
	}

	const detected = detectDistortedTriangles(
		geometry,
		refNormals,
		DEFAULT_DISTORTION_THRESHOLD,
	);
	if (detected.affectedVerts.size > 0) {
		repairDistortedVertices(
			geometry,
			originalPositions,
			detected.affectedVerts,
			detected.severity,
			refNormals,
		);
	}

	geometry.computeVertexNormals();
}

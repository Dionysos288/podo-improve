import * as THREE from 'three';
import type { InsoleSurfaceModel } from './insoleSurfaceModel';
import { VertexZone } from './insoleSurfaceModel';

export interface DisplacementField {
	targetPositions: Float32Array;
	weights: Float32Array;
	budgets: Float32Array;
	primaryDirections?: Float32Array;
	secondaryDirections?: Float32Array;
	tangentialBudgets?: Float32Array;
	anchorStrengths?: Float32Array;
	rigidityWeights?: Float32Array;
	secondaryBudgets?: Float32Array;
	confidence: number;
}

export interface ConstrainedDeformConfig {
	iterations?: number;
	curvatureStiffening?: number;
	localRigidityWeight?: number;
	zoneTargetStrength?: Partial<Record<number, number>>;
}

const DEFAULT_ZONE_STRENGTH: Record<number, number> = {
	[VertexZone.Bottom]: 0,
	[VertexZone.Wall]: 0,
	[VertexZone.Rim]: 0,
	[VertexZone.Top]: 0.92,
};

function buildNeighborList(
	geometry: THREE.BufferGeometry,
	vertCount: number,
): number[][] {
	const neighbors: number[][] = Array.from({ length: vertCount }, () => []);
	if (!geometry.index) return neighbors;
	const ia = geometry.index.array;
	const faceCount = ia.length / 3;
	for (let f = 0; f < faceCount; f++) {
		const a = ia[f * 3];
		const b = ia[f * 3 + 1];
		const c = ia[f * 3 + 2];
		if (!neighbors[a].includes(b)) neighbors[a].push(b);
		if (!neighbors[a].includes(c)) neighbors[a].push(c);
		if (!neighbors[b].includes(a)) neighbors[b].push(a);
		if (!neighbors[b].includes(c)) neighbors[b].push(c);
		if (!neighbors[c].includes(a)) neighbors[c].push(a);
		if (!neighbors[c].includes(b)) neighbors[c].push(b);
	}
	return neighbors;
}

function normalizeOrFallback(
	x: number,
	y: number,
	z: number,
	fallback: [number, number, number],
): [number, number, number] {
	const len = Math.hypot(x, y, z);
	if (len <= 1e-8) return fallback;
	return [x / len, y / len, z / len];
}

function clampMagnitude(
	x: number,
	y: number,
	z: number,
	limit: number,
): [number, number, number] {
	if (limit <= 0) return [0, 0, 0];
	const len = Math.hypot(x, y, z);
	if (len <= limit || len <= 1e-8) return [x, y, z];
	const s = limit / len;
	return [x * s, y * s, z * s];
}

function orthonormalBasis(
	primary: [number, number, number],
	secondary: [number, number, number],
): { e1: [number, number, number]; e2: [number, number, number] | null } {
	const e1 = normalizeOrFallback(primary[0], primary[1], primary[2], [1, 0, 0]);
	const d = secondary[0] * e1[0] + secondary[1] * e1[1] + secondary[2] * e1[2];
	const sx = secondary[0] - e1[0] * d;
	const sy = secondary[1] - e1[1] * d;
	const sz = secondary[2] - e1[2] * d;
	const len = Math.hypot(sx, sy, sz);
	if (len <= 1e-8) return { e1, e2: null };
	return { e1, e2: [sx / len, sy / len, sz / len] };
}

function isRigidityNeighbor(
	model: InsoleSurfaceModel,
	vertex: number,
	neighbor: number,
): boolean {
	if (model.zones[vertex] !== VertexZone.Top || model.zones[neighbor] !== VertexZone.Top) {
		return false;
	}
	const protectedEdge = model.protectedMask[vertex] === 1 || model.protectedMask[neighbor] === 1;
	if (protectedEdge && model.regions[vertex] !== model.regions[neighbor]) {
		return false;
	}
	return true;
}

export function solveConstrainedDeformation(
	geometry: THREE.BufferGeometry,
	model: InsoleSurfaceModel,
	field: DisplacementField,
	config?: ConstrainedDeformConfig,
): void {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos || pos.count !== model.vertCount) return;

	const vertCount = pos.count;
	const iterations = config?.iterations ?? 4;
	const curvStiff = config?.curvatureStiffening ?? 6.5;
	const globalRigidity = config?.localRigidityWeight ?? 0.55;
	const zoneStrength = { ...DEFAULT_ZONE_STRENGTH, ...(config?.zoneTargetStrength ?? {}) };
	const neighbors = buildNeighborList(geometry, vertCount);

	const widthFallback: [number, number, number] =
		model.axes.widthAxis === 'x'
			? [1, 0, 0]
			: model.axes.widthAxis === 'y'
				? [0, 1, 0]
				: [0, 0, 1];

	const base = new Float32Array(vertCount * 3);
	for (let i = 0; i < vertCount; i++) {
		base[i * 3] = pos.getX(i);
		base[i * 3 + 1] = pos.getY(i);
		base[i * 3 + 2] = pos.getZ(i);
	}

	const baseLaplacian = new Float32Array(vertCount * 3);
	for (let v = 0; v < vertCount; v++) {
		let sx = 0;
		let sy = 0;
		let sz = 0;
		let count = 0;
		for (const nb of neighbors[v]) {
			if (!isRigidityNeighbor(model, v, nb)) continue;
			sx += base[nb * 3];
			sy += base[nb * 3 + 1];
			sz += base[nb * 3 + 2];
			count++;
		}
		if (count === 0) continue;
		baseLaplacian[v * 3] = base[v * 3] - sx / count;
		baseLaplacian[v * 3 + 1] = base[v * 3 + 1] - sy / count;
		baseLaplacian[v * 3 + 2] = base[v * 3 + 2] - sz / count;
	}

	let current = new Float32Array(base);
	for (let iter = 0; iter < iterations; iter++) {
		const next = new Float32Array(current);
		for (let v = 0; v < vertCount; v++) {
			if (model.deformableMask[v] === 0) {
				next[v * 3] = base[v * 3];
				next[v * 3 + 1] = base[v * 3 + 1];
				next[v * 3 + 2] = base[v * 3 + 2];
				continue;
			}

			const primary = field.primaryDirections
				? [
					field.primaryDirections[v * 3],
					field.primaryDirections[v * 3 + 1],
					field.primaryDirections[v * 3 + 2],
				] as [number, number, number]
				: widthFallback;
			const secondary = field.secondaryDirections
				? [
					field.secondaryDirections[v * 3],
					field.secondaryDirections[v * 3 + 1],
					field.secondaryDirections[v * 3 + 2],
				] as [number, number, number]
				: [
					model.referenceNormals[v * 3],
					model.referenceNormals[v * 3 + 1],
					model.referenceNormals[v * 3 + 2],
				] as [number, number, number];
			const { e1, e2 } = orthonormalBasis(primary, secondary);

			const tx = field.targetPositions[v * 3] - base[v * 3];
			const ty = field.targetPositions[v * 3 + 1] - base[v * 3 + 1];
			const tz = field.targetPositions[v * 3 + 2] - base[v * 3 + 2];

			const primaryTarget = tx * e1[0] + ty * e1[1] + tz * e1[2];
			const secondaryTarget = e2 ? tx * e2[0] + ty * e2[1] + tz * e2[2] : 0;

			const anchor = field.anchorStrengths?.[v] ?? 0;
			const response = Math.max(
				0,
				Math.min(
					1,
					(zoneStrength[model.zones[v]] ?? 0) *
						field.weights[v] *
						(1 / (1 + model.curvature[v] * curvStiff)) *
						(1 - model.regionTransition[v] * 0.75) *
						(1 - anchor * 0.35),
				),
			);

			const widthBudget = Math.max(0, field.budgets[v]);
			const secondaryBudget = Math.max(0, field.secondaryBudgets?.[v] ?? 0);
			let c1 = Math.max(-widthBudget, Math.min(widthBudget, primaryTarget * response));
			let c2 = e2 ? Math.max(-secondaryBudget, Math.min(secondaryBudget, secondaryTarget * response)) : 0;

			let cx = base[v * 3] + e1[0] * c1 + (e2 ? e2[0] * c2 : 0);
			let cy = base[v * 3 + 1] + e1[1] * c1 + (e2 ? e2[1] * c2 : 0);
			let cz = base[v * 3 + 2] + e1[2] * c1 + (e2 ? e2[2] * c2 : 0);

			let nsx = 0;
			let nsy = 0;
			let nsz = 0;
			let neighborCount = 0;
			for (const nb of neighbors[v]) {
				if (!isRigidityNeighbor(model, v, nb)) continue;
				nsx += current[nb * 3];
				nsy += current[nb * 3 + 1];
				nsz += current[nb * 3 + 2];
				neighborCount++;
			}

			if (neighborCount > 0) {
				const desiredX = nsx / neighborCount + baseLaplacian[v * 3];
				const desiredY = nsy / neighborCount + baseLaplacian[v * 3 + 1];
				const desiredZ = nsz / neighborCount + baseLaplacian[v * 3 + 2];
				const rigidity = Math.max(
					0,
					Math.min(0.98, (field.rigidityWeights?.[v] ?? model.shapePreservingWeight[v]) * globalRigidity),
				);
				cx += (desiredX - cx) * rigidity;
				cy += (desiredY - cy) * rigidity;
				cz += (desiredZ - cz) * rigidity;
			}

			const dx = cx - base[v * 3];
			const dy = cy - base[v * 3 + 1];
			const dz = cz - base[v * 3 + 2];

			c1 = dx * e1[0] + dy * e1[1] + dz * e1[2];
			c1 = Math.max(-widthBudget, Math.min(widthBudget, c1));
			c2 = e2 ? dx * e2[0] + dy * e2[1] + dz * e2[2] : 0;
			if (e2) c2 = Math.max(-secondaryBudget, Math.min(secondaryBudget, c2));

			const allowedX = e1[0] * c1 + (e2 ? e2[0] * c2 : 0);
			const allowedY = e1[1] * c1 + (e2 ? e2[1] * c2 : 0);
			const allowedZ = e1[2] * c1 + (e2 ? e2[2] * c2 : 0);

			const tangentialBudget = Math.max(0, field.tangentialBudgets?.[v] ?? 0);
			const tangential = clampMagnitude(
				dx - allowedX,
				dy - allowedY,
				dz - allowedZ,
				tangentialBudget,
			);
			const pullback = 1 - Math.min(0.7, anchor * 0.45);

			next[v * 3] = base[v * 3] + (allowedX + tangential[0]) * pullback;
			next[v * 3 + 1] = base[v * 3 + 1] + (allowedY + tangential[1]) * pullback;
			next[v * 3 + 2] = base[v * 3 + 2] + (allowedZ + tangential[2]) * pullback;
		}
		current = next;
	}

	for (let i = 0; i < vertCount; i++) {
		pos.setXYZ(i, current[i * 3], current[i * 3 + 1], current[i * 3 + 2]);
	}
	pos.needsUpdate = true;
	geometry.computeVertexNormals();
}

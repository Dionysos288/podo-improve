import * as THREE from 'three';
import type { InsoleSurfaceModel } from './insoleSurfaceModel';
import { VertexZone } from './insoleSurfaceModel';

export interface DisplacementField {
	targetPositions: Float32Array;
	weights: Float32Array;
	budgets: Float32Array;
	confidence: number;
}

export interface ConstrainedDeformConfig {
	iterations?: number;
	smoothnessWeight?: number;
	curvatureStiffening?: number;
	zoneTargetStrength?: Partial<Record<number, number>>;
}

const DEFAULT_ZONE_STRENGTH: Record<number, number> = {
	[VertexZone.Bottom]: 0,
	[VertexZone.Wall]: 0,
	[VertexZone.Rim]: 0,
	[VertexZone.Top]: 0.85,
};

function buildNeighborList(
	geometry: THREE.BufferGeometry,
	vertCount: number,
): number[][] {
	const nb: number[][] = Array.from({ length: vertCount }, () => []);
	if (!geometry.index) return nb;
	const ia = geometry.index.array;
	const fc = ia.length / 3;
	for (let f = 0; f < fc; f++) {
		const a = ia[f * 3],
			b = ia[f * 3 + 1],
			c = ia[f * 3 + 2];
		if (!nb[a].includes(b)) nb[a].push(b);
		if (!nb[a].includes(c)) nb[a].push(c);
		if (!nb[b].includes(a)) nb[b].push(a);
		if (!nb[b].includes(c)) nb[b].push(c);
		if (!nb[c].includes(a)) nb[c].push(a);
		if (!nb[c].includes(b)) nb[c].push(b);
	}
	return nb;
}

/**
 * Width-axis-only, region-isolated deformation solver.
 *
 * Moves vertices only along the width axis (the direction the scan/trimline
 * fitting requests). Non-width axes stay locked to the base position,
 * preventing the tangential drift and cross-axis pulling that caused
 * arch/heel crease artifacts.
 *
 * Regularization (Laplacian smoothing) operates only on the width axis and
 * only across neighbors in the same anatomical region, preventing
 * cross-region pulling between heel, arch, forefoot, and toe bands.
 */
export function solveConstrainedDeformation(
	geometry: THREE.BufferGeometry,
	model: InsoleSurfaceModel,
	field: DisplacementField,
	config?: ConstrainedDeformConfig,
): void {
	const pos = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| undefined;
	if (!pos || pos.count !== model.vertCount) return;

	const vertCount = pos.count;
	const { widthAxis } = model.axes;
	const wIdx = widthAxis === 'x' ? 0 : widthAxis === 'y' ? 1 : 2;
	const iterations = config?.iterations ?? 6;
	const smoothW = config?.smoothnessWeight ?? 0.15;
	const curvStiff = config?.curvatureStiffening ?? 6.0;
	const zoneStr = { ...DEFAULT_ZONE_STRENGTH, ...(config?.zoneTargetStrength ?? {}) };

	const neighbors = buildNeighborList(geometry, vertCount);

	const base = new Float32Array(vertCount * 3);
	for (let i = 0; i < vertCount; i++) {
		base[i * 3] = pos.getX(i);
		base[i * 3 + 1] = pos.getY(i);
		base[i * 3 + 2] = pos.getZ(i);
	}

	const deformable = model.deformableMask;
	const effectiveW = new Float32Array(vertCount);
	for (let v = 0; v < vertCount; v++) {
		if (deformable[v] === 0) continue;
		const zw = zoneStr[model.zones[v]] ?? 0;
		const ca = 1 / (1 + model.curvature[v] * curvStiff);
		const ra = 1 - model.regionTransition[v] * 0.8;
		effectiveW[v] = Math.min(1, zw * ca * field.weights[v] * ra);
	}

	const wCur = new Float32Array(vertCount);
	for (let v = 0; v < vertCount; v++) {
		const bw = base[v * 3 + wIdx];
		if (deformable[v] === 0) {
			wCur[v] = bw;
			continue;
		}
		const tw = field.targetPositions[v * 3 + wIdx];
		wCur[v] = bw + (tw - bw) * effectiveW[v];
	}

	const wNext = new Float32Array(vertCount);

	for (let iter = 0; iter < iterations; iter++) {
		wNext.set(wCur);

		for (let v = 0; v < vertCount; v++) {
			if (deformable[v] === 0) continue;

			const nbs = neighbors[v];
			if (nbs.length === 0) continue;

			const myRegion = model.regions[v];
			let sumW = 0, cnt = 0;
			for (const n of nbs) {
				if (deformable[n] === 0) continue;
				if (model.regions[n] !== myRegion) continue;
				sumW += wCur[n];
				cnt += 1;
			}
			if (cnt < 1e-6) continue;

			const avgW = sumW / cnt;
			const localSmooth = smoothW * 0.5;

			wNext[v] = wCur[v] + (avgW - wCur[v]) * localSmooth;

			const budget = field.budgets[v];
			if (budget > 0) {
				const dw = wNext[v] - base[v * 3 + wIdx];
				if (Math.abs(dw) > budget) {
					wNext[v] = base[v * 3 + wIdx] + (dw > 0 ? budget : -budget);
				}
			}

			wNext[v] += (base[v * 3 + wIdx] - wNext[v]) * 0.15;
		}

		wCur.set(wNext);
	}

	for (let i = 0; i < vertCount; i++) {
		if (wIdx === 0) pos.setX(i, wCur[i]);
		else if (wIdx === 1) pos.setY(i, wCur[i]);
		else pos.setZ(i, wCur[i]);
	}
	pos.needsUpdate = true;
}

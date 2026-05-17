import type { LatticeOffsetVec } from '@/src/features/design/types/boxGrid';

import type { LatticeNode } from '@/src/features/design/utils/boxLattice';

const MAX_ABS_DU_DV = 6;
const MAX_ABS_DH_DEFAULT = 10;

export function clampOffsetVec(
	vec: LatticeOffsetVec,
	maxDu: number,
	maxDv: number,
	maxDh: number,
) {
	vec.du = Math.max(-maxDu, Math.min(maxDu, vec.du));
	vec.dv = Math.max(-maxDv, Math.min(maxDv, vec.dv));
	vec.dh = Math.max(-maxDh, Math.min(maxDh, vec.dh));
}

export function estimateAverageNodeSpacing(nodes: LatticeNode[]): number {
	let total = 0;
	let count = 0;
	for (let i = 0; i < nodes.length; i++) {
		const s = nodes[i];
		let nearest = Infinity;
		for (let j = 0; j < nodes.length; j++) {
			if (i === j) continue;
			const d = nodes[j];
			const isNeighbor =
				(s.gridLayer === d.gridLayer &&
					((s.gridRow === d.gridRow && Math.abs(s.gridCol - d.gridCol) === 1) ||
						(s.gridCol === d.gridCol && Math.abs(s.gridRow - d.gridRow) === 1))) ||
				(s.gridRow === d.gridRow &&
					s.gridCol === d.gridCol &&
					Math.abs(s.gridLayer - d.gridLayer) === 1);
			if (!isNeighbor) continue;
			const dx = s.worldX - d.worldX;
			const dy = s.worldY - d.worldY;
			const dz = s.worldZ - d.worldZ;
			const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (dist > 1e-6 && dist < nearest) nearest = dist;
		}
		if (Number.isFinite(nearest)) {
			total += nearest;
			count++;
		}
	}
	return count > 0 ? total / count : 1;
}

export function applyVecDeltaWithSmoothing(
	nodes: LatticeNode[],
	offsets: LatticeOffsetVec[],
	startSnapshot: LatticeOffsetVec[],
	draggedIndices: number[],
	deltaDu: number,
	deltaDv: number,
	deltaDh: number,
	radius: number,
	avgSpacing: number,
	maxDu: number,
	maxDv: number,
	maxDh: number,
) {
	for (let i = 0; i < offsets.length; i++) {
		const snap = startSnapshot[i]!;
		offsets[i] = { du: snap.du, dv: snap.dv, dh: snap.dh };
	}

	const worldRadius = Math.max(avgSpacing * radius, avgSpacing * 0.75);
	const sigma = worldRadius / 2.25;
	const effects = new Array<LatticeOffsetVec>(offsets.length);
	for (let i = 0; i < effects.length; i++) {
		effects[i] = { du: 0, dv: 0, dh: 0 };
	}

	for (const idx of draggedIndices) {
		const src = nodes[idx];
		for (let j = 0; j < nodes.length; j++) {
			const dst = nodes[j];
			const dx = src.worldX - dst.worldX;
			const dy = src.worldY - dst.worldY;
			const dz = src.worldZ - dst.worldZ;
			const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (dist > worldRadius) continue;
			const falloff = dist < 1e-6 ? 1 : Math.exp(-0.5 * (dist / sigma) ** 2);
			const u = falloff * deltaDu;
			const v = falloff * deltaDv;
			const h = falloff * deltaDh;
			if (Math.hypot(u, v, h) > Math.hypot(effects[j]!.du, effects[j]!.dv, effects[j]!.dh)) {
				effects[j] = { du: u, dv: v, dh: h };
			}
		}
	}

	for (let i = 0; i < offsets.length; i++) {
		const e = effects[i];
		if (e.du === 0 && e.dv === 0 && e.dh === 0) continue;
		const snap = startSnapshot[i] ?? { du: 0, dv: 0, dh: 0 };
		const node = nodes[i];
		let nextDu = snap.du + e.du;
		let nextDv = snap.dv + e.dv;
		let nextDh = snap.dh + e.dh;
		if (node.lockLengthAxis) nextDu = 0;
		if (node.lockWidthAxis) nextDv = 0;
		offsets[i] = {
			du: Math.max(-maxDu, Math.min(maxDu, nextDu)),
			dv: Math.max(-maxDv, Math.min(maxDv, nextDv)),
			dh: Math.max(-maxDh, Math.min(maxDh, nextDh)),
		};
	}
}

export function getMaxDhForSpan(hSpanWorld: number, mmToWorld: number) {
	const spanMm = hSpanWorld / Math.max(mmToWorld, 1e-9);
	const scale = spanMm > 25 ? 1 : Math.max(0.35, spanMm / 25);
	return MAX_ABS_DH_DEFAULT * scale;
}

export { MAX_ABS_DU_DV };

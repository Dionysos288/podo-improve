import * as THREE from 'three';

import type { BoxGridSavedOffsets, LatticeOffsetVec } from '@/src/features/design/types/boxGrid';
import { normalizeSavedOffsets } from '@/src/features/design/types/boxGrid';

export interface ObLatticeFrame {
	uIdx: 0 | 1 | 2;
	vIdx: 0 | 1 | 2;
	hIdx: 0 | 1 | 2;
	uMin: number;
	uMax: number;
	vMin: number;
	vMax: number;
	hMin: number;
	hMax: number;
	cellU: number;
	cellV: number;
}

export interface LatticeNode {
	index: number;
	gridLayer: number;
	gridRow: number;
	gridCol: number;
	worldX: number;
	worldY: number;
	worldZ: number;
	active: boolean;
	lockWidthAxis: boolean;
	lockLengthAxis: boolean;
	normalizedU: number;
	normalizedV: number;
	normalizedH: number;
}

function pIdx(axis: 'x' | 'y' | 'z'): 0 | 1 | 2 {
	return ({ x: 0, y: 1, z: 2 }[axis]) as 0 | 1 | 2;
}

export function computeObLatticeFrame(geometry: THREE.BufferGeometry): ObLatticeFrame | null {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	if (!bbox) return null;

	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	const heightAxis = axes[0];
	const planeAxes = [axes[1], axes[2]] as const;

	const span0 =
		bbox.max[planeAxes[0]] - bbox.min[planeAxes[0]];
	const span1 =
		bbox.max[planeAxes[1]] - bbox.min[planeAxes[1]];

	const uAxis =
		span0 >= span1 ? planeAxes[0] : planeAxes[1];
	const vAxis = uAxis === planeAxes[0] ? planeAxes[1] : planeAxes[0];

	const uIdx = pIdx(uAxis);
	const vIdx = pIdx(vAxis);
	const hIdx = pIdx(heightAxis);

	const uMin = bbox.min[uAxis];
	const uMax = bbox.max[uAxis];
	const vMin = bbox.min[vAxis];
	const vMax = bbox.max[vAxis];
	const hMin = bbox.min[heightAxis];
	const hMax = bbox.max[heightAxis];

	const uSpan = Math.max(1e-9, uMax - uMin);
	const vSpan = Math.max(1e-9, vMax - vMin);

	return {
		uIdx,
		vIdx,
		hIdx,
		uMin,
		uMax,
		vMin,
		vMax,
		hMin,
		hMax,
		cellU: uSpan,
		cellV: vSpan,
	};
}

function buildProfileForSilhouette(
	geometry: THREE.BufferGeometry,
	frame: ObLatticeFrame,
	gridRows: number,
	sampleStride: number,
) {
	const positions = geometry.attributes.position as THREE.BufferAttribute | undefined;
	if (!positions) return null;

	const { uIdx, vIdx, uMin, uMax, vMin, vMax } = frame;
	const uSpan = uMax - uMin;
	const vSpan = vMax - vMin;
	const profileBins = Math.max(48, gridRows * 3);
	const profileMin = new Float32Array(profileBins).fill(Number.POSITIVE_INFINITY);
	const profileMax = new Float32Array(profileBins).fill(Number.NEGATIVE_INFINITY);
	const profileHits = new Uint16Array(profileBins);

	for (let i = 0; i < positions.count; i += sampleStride) {
		const u = positions.array[i * 3 + uIdx];
		const v = positions.array[i * 3 + vIdx];
		const t = Math.max(0, Math.min(1, (u - uMin) / uSpan));
		const bin = Math.min(
			profileBins - 1,
			Math.max(0, Math.round(t * (profileBins - 1))),
		);
		if (v < profileMin[bin]) profileMin[bin] = v;
		if (v > profileMax[bin]) profileMax[bin] = v;
		profileHits[bin]++;
	}
	for (let k = 0; k < profileBins; k++) {
		if (profileHits[k] > 0) continue;
		let left = k - 1;
		while (left >= 0 && profileHits[left] === 0) left--;
		let right = k + 1;
		while (right < profileBins && profileHits[right] === 0) right++;
		if (left >= 0 && right < profileBins) {
			profileMin[k] = (profileMin[left] + profileMin[right]) * 0.5;
			profileMax[k] = (profileMax[left] + profileMax[right]) * 0.5;
		} else if (left >= 0) {
			profileMin[k] = profileMin[left];
			profileMax[k] = profileMax[left];
		} else if (right < profileBins) {
			profileMin[k] = profileMin[right];
			profileMax[k] = profileMax[right];
		}
	}

	const sampleProfile = (t: number) => {
		const x = Math.max(0, Math.min(1, t)) * (profileBins - 1);
		const i0 = Math.floor(x);
		const i1 = Math.min(profileBins - 1, i0 + 1);
		const blend = x - i0;
		return {
			min: profileMin[i0] + (profileMin[i1] - profileMin[i0]) * blend,
			max: profileMax[i0] + (profileMax[i1] - profileMax[i0]) * blend,
		};
	};
	return { sampleProfile, uSpan, vSpan };
}

export function buildLattice(
	geometry: THREE.BufferGeometry,
	cols: number,
	rows: number,
	layers: number,
	mmToWorld: number,
): { frame: ObLatticeFrame; nodes: LatticeNode[] } | null {
	const frame = computeObLatticeFrame(geometry);
	if (!frame) return null;

	const positions = geometry.attributes.position as THREE.BufferAttribute | undefined;
	if (!positions) return null;

	const L = Math.max(1, layers);

	const sampleStride =
		positions.count > 240000
			? 12
			: positions.count > 120000
				? 8
				: positions.count > 60000
					? 4
					: 2;

	const prof =
		buildProfileForSilhouette(geometry, frame, rows, sampleStride);

	const nodes: LatticeNode[] = [];
	const { uIdx, vIdx, hIdx } = frame;
	let idx = 0;

	const gridSearch =
		Math.max(
			(frame.uMax - frame.uMin) / Math.max(1, cols - 1),
			(frame.vMax - frame.vMin) / Math.max(1, rows - 1),
		) * 1.12;

	const columnActive: boolean[][] = [];
	for (let row = 0; row < rows; row++) {
		const rowAct: boolean[] = [];
		for (let col = 0; col < cols; col++) {
			const nu = cols === 1 ? 0.5 : col / (cols - 1);
			const nv = rows === 1 ? 0.5 : row / (rows - 1);
			const uCoord = frame.uMin + nu * (frame.uMax - frame.uMin);
			const vCoord = frame.vMin + nv * (frame.vMax - frame.vMin);
			let active = true;
			if (prof) {
				const p = prof.sampleProfile((uCoord - frame.uMin) / (frame.uMax - frame.uMin));
				const edgeInset = Math.min(
					Math.max(gridSearch * 0.48, 1.6 * mmToWorld),
					prof.vSpan * 0.08,
				);
				if (
					Number.isFinite(p.min) &&
					Number.isFinite(p.max) &&
					(vCoord <= p.min + edgeInset || vCoord >= p.max - edgeInset)
				) {
					active = false;
				}
			}
			rowAct.push(active);
		}
		columnActive.push(rowAct);
	}

	for (let layer = 0; layer < L; layer++) {
		const nh =
			L === 1 ? 1 : layer / (L - 1);
		const hCoord = frame.hMin + nh * (frame.hMax - frame.hMin);

		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const nu = cols === 1 ? 0.5 : col / (cols - 1);
				const nv = rows === 1 ? 0.5 : row / (rows - 1);

				const uCoord = frame.uMin + nu * (frame.uMax - frame.uMin);
				const vCoord = frame.vMin + nv * (frame.vMax - frame.vMin);

				const active = columnActive[row]![col] ?? true;

				const pos: [number, number, number] = [0, 0, 0];
				pos[uIdx] = uCoord;
				pos[vIdx] = vCoord;
				pos[hIdx] = hCoord;

				const lockWidthAxis = col === 0 || col === cols - 1;
				const lockLengthAxis = row === 0 || row === rows - 1;

				nodes.push({
					index: idx++,
					gridLayer: layer,
					gridRow: row,
					gridCol: col,
					worldX: pos[0]!,
					worldY: pos[1]!,
					worldZ: pos[2]!,
					active,
					lockWidthAxis,
					lockLengthAxis,
					normalizedU: nu,
					normalizedV: nv,
					normalizedH: nh,
				});
			}
		}
	}

	return { frame, nodes };
}

export function hydrateLatticeOffsets(
	nodes: LatticeNode[],
	cols: number,
	rows: number,
	layers: number,
	saved: BoxGridSavedOffsets,
): LatticeOffsetVec[] {
	const normalized = normalizeSavedOffsets(saved, layers);
	if (normalized.length === nodes.length) {
		return normalized;
	}
	const out: LatticeOffsetVec[] = nodes.map(() => ({ du: 0, dv: 0, dh: 0 }));
	for (let i = 0; i < Math.min(normalized.length, out.length); i++) {
		const o = normalized[i];
		if (o) out[i] = { du: o.du, dv: o.dv, dh: o.dh };
	}
	return out;
}

import * as THREE from 'three';

import type { LatticeOffsetVec } from '@/src/features/design/types/boxGrid';

import type { LatticeNode, ObLatticeFrame } from '@/src/features/design/utils/boxLattice';

export const LATTICE_WEIGHTS_PER_VERTEX = 32;

export interface VertexLatticeInfluence {
	colCount: number;
	rowCount: number;
	layerCount: number;
	indexOf: Uint16Array;
	weightOf: Float32Array;
	vertexCount: number;
}

function clampi(x: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, x));
}

function bsplineSegment(nu: number, count: number): { i0: number; t: number } {
	if (count <= 1) return { i0: 0, t: 0 };
	const s = nu * (count - 1);
	const i0 = Math.min(count - 2, Math.max(0, Math.floor(s - 1e-9)));
	return { i0, t: s - i0 };
}

function cubicUniformWeights(t: number): [number, number, number, number] {
	const t2 = t * t;
	const t3 = t2 * t;
	const omt = 1 - t;
	const omt3 = omt * omt * omt;
	return [
		omt3 / 6,
		(3 * t3 - 6 * t2 + 4) / 6,
		(-3 * t3 + 3 * t2 + 3 * t + 1) / 6,
		t3 / 6,
	];
}

function flatNodeIndex(
	layer: number,
	row: number,
	col: number,
	rows: number,
	cols: number,
): number {
	return (layer * rows + row) * cols + col;
}

export function wendlandC2(rNormalized: number): number {
	const r = Math.max(0, Math.min(1, rNormalized));
	const t = 1 - r;
	return t ** 4 * (4 * r + 1);
}

export function nodeIndexFromRowCol(cols: number, row: number, col: number) {
	return row * cols + col;
}

export function precomputeVertexInfluences(
	geometry: THREE.BufferGeometry,
	frame: ObLatticeFrame,
	cols: number,
	rows: number,
	layers: number,
	nodes?: LatticeNode[],
): VertexLatticeInfluence | null {
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!posAttr) return null;
	const count = posAttr.count;
	const arr = posAttr.array as Float32Array;

	const L = Math.max(1, layers);
	const W = LATTICE_WEIGHTS_PER_VERTEX;

	const indexOf = new Uint16Array(count * W);
	const weightOf = new Float32Array(count * W);

	const latticeNodeId = (layer: number, row: number, col: number) => {
		const flat = flatNodeIndex(layer, row, col, rows, cols);
		return nodes?.[flat] ? nodes[flat].index : flat;
	};

	for (let vi = 0; vi < count; vi++) {
		const px = arr[vi * 3];
		const py = arr[vi * 3 + 1];
		const pz = arr[vi * 3 + 2];

		const coordU =
			frame.uIdx === 0 ? px : frame.uIdx === 1 ? py : pz;
		const coordV =
			frame.vIdx === 0 ? px : frame.vIdx === 1 ? py : pz;
		const coordH =
			frame.hIdx === 0 ? px : frame.hIdx === 1 ? py : pz;

		let nu =
			(coordU - frame.uMin) / Math.max(1e-9, frame.uMax - frame.uMin);
		let nv =
			(coordV - frame.vMin) / Math.max(1e-9, frame.vMax - frame.vMin);
		let nh =
			(coordH - frame.hMin) / Math.max(1e-9, frame.hMax - frame.hMin);
		nu = Math.max(0, Math.min(1, nu));
		nv = Math.max(0, Math.min(1, nv));
		nh = Math.max(0, Math.min(1, nh));

		const su = bsplineSegment(nu, cols);
		const sv = bsplineSegment(nv, rows);
		const wu = cubicUniformWeights(su.t);
		const wv = cubicUniformWeights(sv.t);

		let wh0: number;
		let wh1: number;
		let h0: number;
		let h1: number;
		if (L === 1) {
			wh0 = 1;
			wh1 = 0;
			h0 = 0;
			h1 = 0;
		} else {
			const sH = nh * (L - 1);
			const k0 = Math.min(L - 2, Math.max(0, Math.floor(sH - 1e-9)));
			const th = sH - k0;
			wh0 = 1 - th;
			wh1 = th;
			h0 = k0;
			h1 = k0 + 1;
		}

		let wSum = 0;
		let slot = 0;
		const outBase = vi * W;
		for (let a = 0; a < 4; a++) {
			const cu = clampi(su.i0 - 1 + a, 0, Math.max(0, cols - 1));
			for (let b = 0; b < 4; b++) {
				const cv = clampi(sv.i0 - 1 + b, 0, Math.max(0, rows - 1));
				const wUV = wu[a]! * wv[b]!;
				for (let hh = 0; hh < 2; hh++) {
					const layer = hh === 0 ? h0 : h1;
					const wh = hh === 0 ? wh0 : wh1;
					const w = wUV * wh;
					indexOf[outBase + slot] = latticeNodeId(layer, cv, cu);
					weightOf[outBase + slot] = w;
					wSum += w;
					slot++;
				}
			}
		}

		if (wSum < 1e-14) {
			for (let k = 0; k < W; k++) {
				weightOf[outBase + k] = k === 0 ? 1 : 0;
				indexOf[outBase + k] = latticeNodeId(0, 0, 0);
			}
			continue;
		}
		for (let k = 0; k < W; k++) {
			weightOf[outBase + k]! /= wSum;
		}
	}

	return {
		colCount: cols,
		rowCount: rows,
		layerCount: L,
		indexOf,
		weightOf,
		vertexCount: count,
	};
}

export function applyLatticeDeformation(
	positionArray: Float32Array,
	basePositions: Float32Array,
	offsetVecs: LatticeOffsetVec[],
	inf: VertexLatticeInfluence,
	frame: ObLatticeFrame,
	mmToWorld: number,
): void {
	const { uIdx, vIdx, hIdx } = frame;

	const mw = Math.max(1e-9, mmToWorld);
	const vc = inf.vertexCount;
	const ix = inf.indexOf;
	const wt = inf.weightOf;
	const W = LATTICE_WEIGHTS_PER_VERTEX;

	for (let i = 0; i < vc; i++) {
		const bo = i * W;
		let du = 0;
		let dv = 0;
		let dh = 0;
		for (let k = 0; k < W; k++) {
			const w = wt[bo + k]!;
			if (w < 1e-20) continue;
			const idx = ix[bo + k]!;
			const o = offsetVecs[idx] ?? { du: 0, dv: 0, dh: 0 };
			du += w * o.du;
			dv += w * o.dv;
			dh += w * o.dh;
		}

		const pu = mw * du;
		const pv = mw * dv;
		const ph = mw * dh;

		const bx = basePositions[i * 3];
		const by = basePositions[i * 3 + 1];
		const bz = basePositions[i * 3 + 2];

		const dx =
			pu * (uIdx === 0 ? 1 : 0) +
			pv * (vIdx === 0 ? 1 : 0) +
			ph * (hIdx === 0 ? 1 : 0);
		const dy =
			pu * (uIdx === 1 ? 1 : 0) +
			pv * (vIdx === 1 ? 1 : 0) +
			ph * (hIdx === 1 ? 1 : 0);
		const dz =
			pu * (uIdx === 2 ? 1 : 0) +
			pv * (vIdx === 2 ? 1 : 0) +
			ph * (hIdx === 2 ? 1 : 0);

		positionArray[i * 3] = bx + dx;
		positionArray[i * 3 + 1] = by + dy;
		positionArray[i * 3 + 2] = bz + dz;
	}
}

export function displacedPositionsWithinBBox(
	positionArray: Float32Array,
	vertexCount: number,
	frame: ObLatticeFrame,
	marginMm: number,
	mmToWorld: number,
): boolean {
	const m =
		Math.max(0, marginMm) * Math.max(1e-9, mmToWorld);

	for (let i = 0; i < vertexCount; i++) {
		const px = positionArray[i * 3];
		const py = positionArray[i * 3 + 1];
		const pz = positionArray[i * 3 + 2];

		const coordU =
			frame.uIdx === 0 ? px : frame.uIdx === 1 ? py : pz;
		const coordV =
			frame.vIdx === 0 ? px : frame.vIdx === 1 ? py : pz;
		const coordH =
			frame.hIdx === 0 ? px : frame.hIdx === 1 ? py : pz;

		if (
			coordU < frame.uMin - m ||
			coordU > frame.uMax + m ||
			coordV < frame.vMin - m ||
			coordV > frame.vMax + m ||
			coordH < frame.hMin - m ||
			coordH > frame.hMax + m
		)
			return false;
	}

	return true;
}

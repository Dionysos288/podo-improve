import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { mirrorBoxGridOffsetsAcrossWidth } from '@/src/features/design/elements/placement';
import { BOX_GRID_LAYERS, normalizeSavedOffsets } from '@/src/features/design/types/boxGrid';
import {
	applyLatticeDeformation,
	LATTICE_WEIGHTS_PER_VERTEX,
	precomputeVertexInfluences,
	wendlandC2,
} from '@/src/features/design/utils/boxDeformation';
import type { ObLatticeFrame } from '@/src/features/design/utils/boxLattice';
import { buildLattice, hydrateLatticeOffsets } from '@/src/features/design/utils/boxLattice';

describe('box deformation & lattice helpers', () => {
	it('wendlandC2 peaks at r=0 and vanishes at r=1', () => {
		expect(wendlandC2(0)).toBe(1);
		expect(wendlandC2(1)).toBe(0);
	});

	it('bicubic tensor weights sum to 1 per vertex', () => {
		const geometry = new THREE.BoxGeometry(4, 2, 6, 6, 2, 10);
		const built = buildLattice(geometry, 5, 5, 3, 1);
		expect(built).not.toBeNull();
		const inf = precomputeVertexInfluences(
			geometry,
			built!.frame,
			5,
			5,
			3,
			built!.nodes,
		);
		expect(inf).not.toBeNull();
		const W = LATTICE_WEIGHTS_PER_VERTEX;
		for (let vi = 0; vi < inf!.vertexCount; vi += 1) {
			const b = vi * W;
			let s = 0;
			for (let k = 0; k < W; k++) {
				s += inf!.weightOf[b + k]!;
			}
			expect(s).toBeCloseTo(1, 5);
		}
	});

	it('applyLatticeDeformation uses 32-slot influence buffer', () => {
		const frame: ObLatticeFrame = {
			uIdx: 0,
			vIdx: 2,
			hIdx: 1,
			uMin: 0,
			uMax: 1,
			vMin: 0,
			vMax: 1,
			hMin: 0,
			hMax: 2,
			cellU: 1,
			cellV: 1,
		};
		const W = LATTICE_WEIGHTS_PER_VERTEX;
		const inf = {
			colCount: 2,
			rowCount: 2,
			layerCount: 1,
			vertexCount: 1,
			indexOf: new Uint16Array(W).fill(0),
			weightOf: new Float32Array(W),
		};
		inf.weightOf[0] = 1;

		const base = new Float32Array([0.5, 0, 0.5]);
		const out = new Float32Array(base.length);
		const offs = [{ du: 0, dv: 0, dh: 4 }];
		applyLatticeDeformation(out, base, offs, inf, frame, 1);
		expect(out[1]).toBeCloseTo(4);
	});

	it('normalizeSavedOffsets maps legacy scalars to top layer only when L>1', () => {
		const normalized = normalizeSavedOffsets(
			{
				cols: 2,
				rows: 2,
				offsets: [1, -2, 3, 0],
			},
			3,
		);
		expect(normalized.length).toBe(2 * 2 * 3);
		const top = 3 - 1;
		expect(normalized[(top * 2 + 0) * 2 + 0]).toEqual({ du: 0, dv: 0, dh: 1 });
		expect(normalized[(top * 2 + 0) * 2 + 1]).toEqual({ du: 0, dv: 0, dh: -2 });
		expect(normalized[0]).toEqual({ du: 0, dv: 0, dh: 0 });
	});

	it('hydrateLatticeOffsets expands legacy onto lattice nodes', () => {
		const geometry = new THREE.BoxGeometry(2, 2, 2, 2, 2, 2);
		const built = buildLattice(geometry, 2, 2, 3, 1);
		expect(built).not.toBeNull();
		const nodes = built!.nodes;
		const legacy = hydrateLatticeOffsets(nodes, 2, 2, 3, {
			cols: 2,
			rows: 2,
			offsets: [0, 0, 0, 5],
		});
		const top = 2;
		expect(legacy[(top * 2 + 1) * 2 + 1]).toEqual({ du: 0, dv: 0, dh: 5 });

		const v2 = hydrateLatticeOffsets(nodes, 2, 2, 3, {
			cols: 2,
			rows: 2,
			version: 2,
			offsets: [
				{ du: 1, dv: 2, dh: 3 },
				{ du: 0, dv: 0, dh: 0 },
				{ du: -1, dv: 1, dh: 0 },
				{ du: 0, dv: 0, dh: 0 },
			],
		});
		const t = 3 - 1;
		expect(v2[(t * 2 + 0) * 2 + 0]).toEqual({ du: 1, dv: 2, dh: 3 });
		expect(v2[(t * 2 + 1) * 2 + 0]).toEqual({ du: -1, dv: 1, dh: 0 });
	});

	it('mirrorBoxGridOffsetsAcrossWidth permutes columns and flips lateral du (v2)', () => {
		const mirrored = mirrorBoxGridOffsetsAcrossWidth({
			cols: 3,
			rows: 2,
			version: 2,
			offsets: [
				{ du: 1, dv: 10, dh: 0 },
				{ du: 2, dv: 20, dh: 0 },
				{ du: 3, dv: 30, dh: 0 },
				{ du: 4, dv: 40, dh: 0 },
				{ du: 5, dv: 50, dh: 0 },
				{ du: 6, dv: 60, dh: 0 },
			],
		});
		expect(mirrored?.version).toBe(2);
		const m = mirrored!.offsets as { du: number; dv: number; dh: number }[];
		expect(m[0]).toEqual({ du: -3, dv: 30, dh: 0 });
		expect(m[2]).toEqual({ du: -1, dv: 10, dh: 0 });
		expect(m[3]).toEqual({ du: -6, dv: 60, dh: 0 });
	});

	it('mirrorBoxGridOffsetsAcrossWidth preserves version 3 and layers', () => {
		const mirrored = mirrorBoxGridOffsetsAcrossWidth({
			cols: 2,
			rows: 2,
			layers: 2,
			version: 3,
			offsets: [
				{ du: 1, dv: 0, dh: 0 },
				{ du: 0, dv: 0, dh: 0 },
				{ du: 0, dv: 0, dh: 0 },
				{ du: 0, dv: 0, dh: 0 },
				{ du: 5, dv: 0, dh: 0 },
				{ du: 0, dv: 0, dh: 0 },
				{ du: 0, dv: 0, dh: 0 },
				{ du: 0, dv: 0, dh: 0 },
			],
		});
		expect(mirrored?.version).toBe(3);
		expect(mirrored?.layers).toBe(2);
		const m = mirrored!.offsets as { du: number }[];
		expect(m[5]?.du).toBe(-5);
	});

	it('mirrorBoxGridOffsetsAcrossWidth keeps legacy scalar offsets unchanged', () => {
		const mirrored = mirrorBoxGridOffsetsAcrossWidth({
			cols: 2,
			rows: 2,
			offsets: [1, 2, 3, 4],
		});
		expect(mirrored?.version).toBeUndefined();
		expect(mirrored!.offsets as number[]).toEqual([2, 1, 4, 3]);
	});

	it('normalizeSavedOffsets defaults to BOX_GRID_LAYERS depth', () => {
		const n = normalizeSavedOffsets({
			cols: 2,
			rows: 2,
			offsets: [1, 0, 0, 0],
		});
		expect(n.length).toBe(2 * 2 * BOX_GRID_LAYERS);
	});
});

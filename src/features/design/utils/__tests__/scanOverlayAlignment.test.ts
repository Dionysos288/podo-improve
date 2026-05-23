import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	computeOverlayTopSurfaceAlignOffset,
	DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
	DEFAULT_SINK_BIAS_MM,
	percentileSorted,
} from '@/src/features/design/utils/scanOverlayAlignment';

describe('percentileSorted', () => {
	it('returns percentile from sorted floats', () => {
		const a = new Float32Array([1, 2, 3, 4, 5]);
		expect(percentileSorted(a, 0)).toBeCloseTo(1);
		expect(percentileSorted(a, 1)).toBeCloseTo(5);
		expect(percentileSorted(a, 0.5)).toBeCloseTo(3);
	});
});

describe('computeOverlayTopSurfaceAlignOffset', () => {
	const worldUp = new THREE.Vector3(0, 1, 0);
	const baseOpts = { mmToWorld: 0.4, maxDeltaWorld: 100 } as const;

	it('returns zero when geometry is missing', () => {
		const m = new THREE.Matrix4().identity();
		const out = computeOverlayTopSurfaceAlignOffset(null, null, { matrix: m }, worldUp);
		expect(out.length()).toBe(0);
	});

	it('still aligns when registration is marked invalid but matrix is usable', () => {
		const insole = new THREE.BoxGeometry(44, 16, 260, 4, 2, 8);
		insole.computeVertexNormals();
		const scan = insole.clone();
		scan.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -12, 0));
		scan.computeVertexNormals();
		const out = computeOverlayTopSurfaceAlignOffset(
			insole,
			scan,
			{ matrix: new THREE.Matrix4().identity(), valid: false },
			worldUp,
			{
				...baseOpts,
				embedScanHeightFraction: DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
				sinkBiasMm: DEFAULT_SINK_BIAS_MM,
			},
		);
		expect(Number.isFinite(out.y)).toBe(true);
		expect(out.y).toBeGreaterThan(-baseOpts.maxDeltaWorld + 1e-6);
	});

	it('default embed plus sinkBias sinks deeper than legacy 0.48 without bias', () => {
		const insole = new THREE.BoxGeometry(44, 16, 260, 8, 2, 12);
		insole.computeVertexNormals();
		const scan = insole.clone();
		scan.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -18, 0));
		scan.computeVertexNormals();
		const reg = { matrix: new THREE.Matrix4().identity(), valid: true };

		const deep = computeOverlayTopSurfaceAlignOffset(insole, scan, reg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
			sinkBiasMm: DEFAULT_SINK_BIAS_MM,
		});
		const shallow = computeOverlayTopSurfaceAlignOffset(insole, scan, reg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0.48,
			sinkBiasMm: 0,
		});

		expect(deep.y).toBeLessThan(shallow.y);
	});

	it('embedding fraction sinks more than shallow embed (numerically lower delta)', () => {
		const insole = new THREE.BoxGeometry(44, 16, 260, 8, 2, 12);
		insole.computeVertexNormals();
		const scan = insole.clone();
		scan.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -18, 0));
		scan.computeVertexNormals();
		const reg = { matrix: new THREE.Matrix4().identity(), valid: true };

		const deep = computeOverlayTopSurfaceAlignOffset(insole, scan, reg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0.48,
		});
		const shallow = computeOverlayTopSurfaceAlignOffset(insole, scan, reg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0.06,
		});

		expect(deep.y).toBeLessThan(shallow.y);
	});

	it('extra sink bias mm shifts further down than zero bias', () => {
		const insole = new THREE.BoxGeometry(44, 16, 260, 8, 2, 12);
		insole.computeVertexNormals();
		const scan = insole.clone();
		scan.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -18, 0));
		scan.computeVertexNormals();
		const reg = { matrix: new THREE.Matrix4().identity(), valid: true };
		const withBias = computeOverlayTopSurfaceAlignOffset(insole, scan, reg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0.58,
			sinkBiasMm: 3,
		});
		const noBias = computeOverlayTopSurfaceAlignOffset(insole, scan, reg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0.58,
			sinkBiasMm: 0,
		});
		expect(withBias.y).toBeLessThan(noBias.y);
	});

	it('large vertical misalignment is not damped to a tiny fraction of itself', () => {
		const insole = new THREE.BoxGeometry(44, 16, 260, 8, 2, 12);
		insole.computeVertexNormals();
		const scan = insole.clone();
		scan.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -28, 0));
		scan.computeVertexNormals();
		const reg = { matrix: new THREE.Matrix4().identity(), valid: true };
		const out = computeOverlayTopSurfaceAlignOffset(insole, scan, reg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
			sinkBiasMm: DEFAULT_SINK_BIAS_MM,
		});
		const mw = baseOpts.mmToWorld;
		expect(Math.abs(out.y)).toBeGreaterThan(mw * 3);
	});

	it('respects vertical clamp magnitude', () => {
		const insole = new THREE.BoxGeometry(40, 10, 200, 4, 2, 8);
		insole.computeVertexNormals();
		const scan = insole.clone();
		const out = computeOverlayTopSurfaceAlignOffset(
			insole,
			scan,
			{ matrix: new THREE.Matrix4().identity(), valid: true },
			worldUp,
			{
				...baseOpts,
				embedScanHeightFraction: DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
				sinkBiasMm: DEFAULT_SINK_BIAS_MM,
				maxDeltaWorld: 20,
			},
		);
		expect(Math.abs(out.y)).toBeLessThanOrEqual(20);
	});
});

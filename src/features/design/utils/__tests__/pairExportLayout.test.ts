import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	applyPairExportLayout,
	normalizePairExportLayout,
	pairExportGapMm,
} from '../pairExportLayout';

function centeredBox(length: number, width: number, height: number): THREE.BufferGeometry {
	const geometry = new THREE.BoxGeometry(length, width, height);
	geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	if (!box) return geometry;
	geometry.applyMatrix4(
		new THREE.Matrix4().makeTranslation(
			-(box.min.x + box.max.x) / 2,
			-(box.min.y + box.max.y) / 2,
			-box.min.z,
		),
	);
	return geometry;
}

describe('pairExportLayout', () => {
	it('normalizes legacy layout names', () => {
		expect(normalizePairExportLayout('visual')).toBe('side-by-side');
		expect(normalizePairExportLayout('compact')).toBe('print-bed');
	});

	it('places STL pair side-by-side along X without overlap', () => {
		const left = centeredBox(280, 100, 15);
		const right = centeredBox(280, 100, 15);
		const ok = applyPairExportLayout(left, right, 15, 'side-by-side');
		expect(ok).toBe(true);
		expect(pairExportGapMm(left, right, 'x')).toBeGreaterThanOrEqual(14.9);
		expect(pairExportGapMm(left, right, 'y')).toBeLessThan(0);
	});

	it('places print-bed pair along Y for compact bed layout', () => {
		const left = centeredBox(280, 100, 15);
		const right = centeredBox(280, 100, 15);
		const ok = applyPairExportLayout(left, right, 15, 'print-bed');
		expect(ok).toBe(true);
		expect(pairExportGapMm(left, right, 'y')).toBeGreaterThanOrEqual(14.9);
		expect(pairExportGapMm(left, right, 'x')).toBeLessThan(0);
	});
});

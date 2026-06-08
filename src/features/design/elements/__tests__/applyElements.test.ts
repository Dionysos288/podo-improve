import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
	applyElements,
	isThicknessOnlyElement,
} from '@/src/features/design/elements/applyElements';
import { getElementByKey } from '@/src/features/design/elements/catalog';
import type { PlacedElement } from '@/src/features/design/elements/types';

function createTestInsoleGeometry(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(120, 8, 40, 24, 2, 12);
	geom.computeVertexNormals();
	return geom;
}

function mockElement(
	id: string,
	libraryKey: string,
	overrides: Partial<PlacedElement> = {},
): PlacedElement {
	return {
		id,
		libraryKey,
		side: 'left',
		profile: 'vlak',
		heightMm: 4,
		blendMm: 5,
		trimOffsetMm: 0,
		floorMode: 'sole',
		split: false,
		positionU: 0.28,
		positionV: 0.5,
		rotationRad: 0,
		scaleU: 1,
		scaleV: 1,
		stackOrder: 0,
		...overrides,
	};
}

function snapshotPositions(
	geometry: THREE.BufferGeometry,
): Float32Array {
	const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
	return new Float32Array(positions.array);
}

function maxAxis(
	geometry: THREE.BufferGeometry,
	axis: 'x' | 'y' | 'z',
): number {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
	const read =
		axis === 'x'
			? (i: number) => pos.getX(i)
			: axis === 'y'
				? (i: number) => pos.getY(i)
				: (i: number) => pos.getZ(i);
	let max = -Infinity;
	for (let i = 0; i < pos.count; i++) {
		const value = read(i);
		if (value > max) max = value;
	}
	return max;
}

describe('isThicknessOnlyElement', () => {
	it('no catalog element is thickness-only: all ship a designed STL mesh', () => {
		expect(isThicknessOnlyElement(getElementByKey('sc-bol'))).toBe(false);
		expect(isThicknessOnlyElement(getElementByKey('spsa-vlak'))).toBe(false);
		expect(isThicknessOnlyElement(getElementByKey('hai-vlak-2'))).toBe(false);
		expect(isThicknessOnlyElement(getElementByKey('sd-1'))).toBe(false);
		expect(isThicknessOnlyElement(null)).toBe(false);
	});
});

describe('applyElements', () => {
	it('merges positive-height blue elements into the insole on export', () => {
		const insole = createTestInsoleGeometry();
		const before = snapshotPositions(insole);

		applyElements(insole, [
			mockElement('el-blue', 'sc-bol', { heightMm: 5, positionU: 0.45 }),
		]);

		const after = snapshotPositions(insole);
		expect(after.some((value, index) => value !== before[index])).toBe(true);

		insole.dispose();
	});

	it('merges positive-height orange elements into the insole on export', () => {
		const insole = createTestInsoleGeometry();
		const before = snapshotPositions(insole);

		applyElements(insole, [
			mockElement('el-orange', 'hai-vlak-2', { heightMm: 5, positionU: 0.45 }),
		]);

		const after = snapshotPositions(insole);
		expect(after.some((value, index) => value !== before[index])).toBe(true);

		insole.dispose();
	});

	it('still deforms the insole for non-thickness-only elements', () => {
		const insole = createTestInsoleGeometry();
		const before = snapshotPositions(insole);

		applyElements(insole, [
			mockElement('el-red', 'sd-1', { heightMm: 5, positionU: 0.45 }),
		]);

		const after = snapshotPositions(insole);
		expect(after.some((value, index) => value !== before[index])).toBe(true);

		insole.dispose();
	});

	it('raises the insole top at the footprint (export displacement parity)', () => {
		const insole = createTestInsoleGeometry();
		const maxTopBefore = maxAxis(insole, 'y');

		applyElements(insole, [
			mockElement('el-red', 'sd-1', { heightMm: 5, positionU: 0.45 }),
		]);

		const maxTopAfter = maxAxis(insole, 'y');
		// The baked insole (the exported mesh) must gain height where the additive
		// element sits — this is what getExportInsoleGeometryMm ships to the slicer.
		expect(maxTopAfter).toBeGreaterThan(maxTopBefore + 2);

		insole.dispose();
	});
});

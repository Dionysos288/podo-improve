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

describe('isThicknessOnlyElement', () => {
	it('identifies blue and orange catalog elements', () => {
		expect(isThicknessOnlyElement(getElementByKey('sc-bol'))).toBe(true);
		expect(isThicknessOnlyElement(getElementByKey('spsa-vlak'))).toBe(true);
		expect(isThicknessOnlyElement(getElementByKey('hai-vlak-2'))).toBe(true);
	});

	it('does not classify other color groups as thickness-only', () => {
		expect(isThicknessOnlyElement(getElementByKey('sd-1'))).toBe(false);
		expect(isThicknessOnlyElement(null)).toBe(false);
	});
});

describe('applyElements', () => {
	it('does not deform the insole for positive-height blue elements', () => {
		const insole = createTestInsoleGeometry();
		const before = snapshotPositions(insole);

		applyElements(insole, [mockElement('el-blue', 'sc-bol', { heightMm: 5 })]);

		const after = snapshotPositions(insole);
		expect(after.length).toBe(before.length);
		for (let i = 0; i < before.length; i++) {
			expect(after[i]).toBeCloseTo(before[i]!, 6);
		}

		insole.dispose();
	});

	it('does not deform the insole for positive-height orange elements', () => {
		const insole = createTestInsoleGeometry();
		const before = snapshotPositions(insole);

		applyElements(insole, [
			mockElement('el-orange', 'hai-vlak-2', { heightMm: 5 }),
		]);

		const after = snapshotPositions(insole);
		expect(after.length).toBe(before.length);
		for (let i = 0; i < before.length; i++) {
			expect(after[i]).toBeCloseTo(before[i]!, 6);
		}

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
});

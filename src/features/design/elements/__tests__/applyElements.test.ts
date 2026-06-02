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

	it('leaves vertices far from every element untouched (spatial early-out)', () => {
		const insole = createTestInsoleGeometry();
		const before = snapshotPositions(insole);

		// Single element near the heel (low u). Vertices at the toe end must be
		// outside the element's footprint+blend bbox and stay bit-identical.
		applyElements(insole, [
			mockElement('el-red', 'sd-1', {
				heightMm: 5,
				positionU: 0.12,
				positionV: 0.5,
				blendMm: 4,
			}),
		]);

		const after = snapshotPositions(insole);
		const positions = insole.getAttribute('position') as THREE.BufferAttribute;

		let changed = 0;
		let farUnchanged = 0;
		for (let i = 0; i < positions.count; i++) {
			const x = positions.getX(i); // length axis, -60..60
			const yBefore = before[i * 3 + 1]!;
			const yAfter = after[i * 3 + 1]!;
			if (yAfter !== yBefore) changed++;
			// Toe end (far from heel element) must be exactly unchanged.
			if (x > 30) {
				expect(yAfter).toBe(yBefore);
				farUnchanged++;
			}
		}
		expect(changed).toBeGreaterThan(0);
		expect(farUnchanged).toBeGreaterThan(0);

		insole.dispose();
	});

	it('raises top-facing vertices where the insole curves down (no SA Recht crater)', () => {
		// Dip the toe end of the top surface well below 60% of the bbox height,
		// keeping those vertices top-facing. The old absolute-height cutoff
		// skipped them and left a hole/crater under the pad.
		const insole = new THREE.BoxGeometry(120, 8, 40, 48, 2, 24);
		const pos = insole.getAttribute('position') as THREE.BufferAttribute;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const y = pos.getY(i);
			if (y > 3.9 && x > 20) {
				const t = Math.min(1, (x - 20) / 40);
				pos.setY(i, 4 - t * 6);
			}
		}
		pos.needsUpdate = true;
		insole.computeVertexNormals();

		const before = snapshotPositions(insole);
		applyElements(insole, [
			mockElement('el-sa', 'peloitte-2', {
				heightMm: 4,
				positionU: 0.85,
				positionV: 0.5,
				blendMm: 4,
			}),
		]);
		const after = snapshotPositions(insole);

		let raised = 0;
		for (let i = 0; i < pos.count; i++) {
			const dy = after[i * 3 + 1]! - before[i * 3 + 1]!;
			if (dy > 0.1) raised++;
		}
		// Pad sits on the dipped (low, top-facing) region and still rises.
		expect(raised).toBeGreaterThan(0);

		insole.dispose();
	});
});

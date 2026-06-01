import { describe, expect, it } from 'vitest';

import { sortPlacedElementsByStack } from '@/src/features/design/elements/sortPlacedElements';
import type { PlacedElement } from '@/src/features/design/elements/types';

function mockElement(id: string, stackOrder: number): PlacedElement {
	return {
		id,
		libraryKey: 'spsa-vlak',
		side: 'left',
		profile: 'vlak',
		heightMm: 2,
		blendMm: 5,
		trimOffsetMm: 0,
		floorMode: 'sole',
		split: false,
		positionU: 0.5,
		positionV: 0.5,
		rotationRad: 0,
		scaleU: 1,
		scaleV: 1,
		stackOrder,
	};
}

describe('sortPlacedElementsByStack', () => {
	it('sorts by ascending stackOrder', () => {
		const input = [
			mockElement('c', 2),
			mockElement('a', 0),
			mockElement('b', 1),
		];
		const sorted = sortPlacedElementsByStack(input);
		expect(sorted.map((el) => el.id)).toEqual(['a', 'b', 'c']);
	});

	it('preserves original order for equal stackOrder', () => {
		const input = [mockElement('first', 1), mockElement('second', 1)];
		const sorted = sortPlacedElementsByStack(input);
		expect(sorted.map((el) => el.id)).toEqual(['first', 'second']);
	});
});

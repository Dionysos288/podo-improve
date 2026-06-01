import { describe, expect, it } from 'vitest';

import { normalizeElementFloorMode } from '@/src/features/design/elements/normalizeFloorMode';

describe('normalizeElementFloorMode', () => {
	it('passes through canonical floor modes', () => {
		expect(normalizeElementFloorMode('sole')).toBe('sole');
		expect(normalizeElementFloorMode('scan')).toBe('scan');
		expect(normalizeElementFloorMode('free')).toBe('free');
	});

	it('maps legacy persisted values', () => {
		expect(normalizeElementFloorMode('vloeien')).toBe('sole');
		expect(normalizeElementFloorMode('niet-vloeien')).toBe('free');
	});

	it('defaults unknown values to sole for visibility', () => {
		expect(normalizeElementFloorMode(undefined)).toBe('sole');
		expect(normalizeElementFloorMode('bogus')).toBe('sole');
	});
});

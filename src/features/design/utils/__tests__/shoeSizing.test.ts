import { describe, expect, it } from 'vitest';

import {
	getBaseInsoleWidthMmForEuSize,
	getBaseInsoleWidthRatio,
} from '@/src/features/design/utils/baseInsole';
import {
	estimateEuShoeSizeFromFootLengthMm,
	getStandardWidthForFootLengthMm,
	getStandardWidthMmForEuSize,
} from '@/src/features/design/utils/shoeSizing';

describe('shoe sizing helper', () => {
	it('maps full EU sizes to the supplied standard widths', () => {
		expect(getStandardWidthMmForEuSize(40)).toBe(92);
		expect(getStandardWidthMmForEuSize(44)).toBe(100);
		expect(getStandardWidthMmForEuSize(60)).toBe(132);
	});

	it('interpolates half sizes between the adjacent full sizes', () => {
		expect(getStandardWidthMmForEuSize(40.5)).toBe(93);
		expect(getStandardWidthMmForEuSize(44.5)).toBe(101);
	});

	it('derives EU size from measured foot length and returns standard width', () => {
		const result = getStandardWidthForFootLengthMm(256.5);
		expect(result).toEqual({ euSize: 40.5, standardWidthMm: 93 });
	});

	it('returns null for implausible scan lengths', () => {
		expect(estimateEuShoeSizeFromFootLengthMm(120)).toBeNull();
		expect(getStandardWidthForFootLengthMm(500)).toBeNull();
	});

	it('applies measured base-type width ratios on top of the men width table', () => {
		expect(getBaseInsoleWidthRatio('man')).toBe(1);
		expect(getBaseInsoleWidthRatio('durea')).toBeCloseTo(0.973237, 6);
		expect(getBaseInsoleWidthRatio('fincomfort')).toBeCloseTo(1.033215, 6);
		expect(getBaseInsoleWidthRatio('vrouw')).toBeCloseTo(0.963807, 6);
		expect(getBaseInsoleWidthRatio('driekwart')).toBeCloseTo(0.910915, 6);
		expect(getBaseInsoleWidthMmForEuSize(40, 'fincomfort')).toBeCloseTo(95.05578, 5);
		expect(getBaseInsoleWidthMmForEuSize(40, 'vrouw')).toBeCloseTo(88.670244, 6);
	});
});
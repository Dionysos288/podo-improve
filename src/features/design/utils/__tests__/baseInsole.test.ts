import { describe, expect, it } from 'vitest';

import {
	DRIEKWART_BASE_INSOLE_ASSETS,
	getBaseInsoleAssetUrls,
	SHARED_BASE_INSOLE_ASSETS,
} from '@/src/features/design/utils/baseInsole';

describe('base insole helpers', () => {
	it('uses driekwart STLs only for driekwart and the shared men base for the others', () => {
		expect(getBaseInsoleAssetUrls('man')).toEqual(SHARED_BASE_INSOLE_ASSETS);
		expect(getBaseInsoleAssetUrls('durea')).toEqual(SHARED_BASE_INSOLE_ASSETS);
		expect(getBaseInsoleAssetUrls('fincomfort')).toEqual(SHARED_BASE_INSOLE_ASSETS);
		expect(getBaseInsoleAssetUrls('vrouw')).toEqual(SHARED_BASE_INSOLE_ASSETS);
		expect(getBaseInsoleAssetUrls('driekwart')).toEqual(DRIEKWART_BASE_INSOLE_ASSETS);
	});
});

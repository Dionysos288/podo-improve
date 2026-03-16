import type { BaseInsoleType } from '@/src/features/design/types/types';
import { getStandardWidthMmForEuSize } from '@/src/features/design/utils/shoeSizing';

export const DEFAULT_BASE_INSOLE_TYPE: BaseInsoleType = 'man';
export const SHARED_BASE_INSOLE_ASSETS = {
	leftUrl: '/base/(Amina) Ruymen - voor Dion_L.stl',
	rightUrl: '/base/(Amina) Ruymen - voor Dion_R.stl',
} as const;

export const DRIEKWART_BASE_INSOLE_ASSETS = {
	leftUrl: '/base/Driekwart zool_L.stl',
	rightUrl: '/base/Driekwart zool_R.stl',
} as const;

export const BASE_INSOLE_SELECT_OPTIONS: Array<{
	value: BaseInsoleType;
	label: string;
}> = [
	{ value: 'man', label: 'Man' },
	{ value: 'driekwart', label: 'Driekwart zool' },
	{ value: 'durea', label: 'Durea' },
	{ value: 'fincomfort', label: 'Fincomfort' },
	{ value: 'vrouw', label: 'Vrouw' },
];

const BASE_INSOLE_WIDTH_RATIO_BY_TYPE: Record<BaseInsoleType, number> = {
	man: 1,
	driekwart: 0.910915,
	durea: 0.973237,
	fincomfort: 1.033215,
	vrouw: 0.963807,
};

export function isBaseInsoleType(value: unknown): value is BaseInsoleType {
	return BASE_INSOLE_SELECT_OPTIONS.some((option) => option.value === value);
}

export function getBaseInsoleWidthRatio(baseInsoleType: BaseInsoleType): number {
	return BASE_INSOLE_WIDTH_RATIO_BY_TYPE[baseInsoleType] ?? 1;
}

export function getBaseInsoleWidthMmForEuSize(
	euSize: number,
	baseInsoleType: BaseInsoleType
): number {
	return getStandardWidthMmForEuSize(euSize) * getBaseInsoleWidthRatio(baseInsoleType);
}

export function getBaseInsoleAssetUrls(baseInsoleType: BaseInsoleType) {
	return baseInsoleType === 'driekwart'
		? DRIEKWART_BASE_INSOLE_ASSETS
		: SHARED_BASE_INSOLE_ASSETS;
}
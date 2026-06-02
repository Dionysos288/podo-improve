import type { FilamentType } from './print-options';

export const DEFAULT_MATERIAL_SEEDS: Array<{
	name: string;
	filamentType: FilamentType;
	isCustomSlot: boolean;
	nozzleTempC: number | null;
	bedTempC: number | null;
	maxSpeedMmS: number | null;
	sortOrder: number;
}> = [
	{ name: 'Footprint3D TPU-95A 2.3KG', filamentType: 'FLEX', isCustomSlot: false, nozzleTempC: 230, bedTempC: 40, maxSpeedMmS: 60, sortOrder: 0 },
	{ name: 'TPU 95A', filamentType: 'FLEX', isCustomSlot: false, nozzleTempC: 230, bedTempC: 40, maxSpeedMmS: 60, sortOrder: 1 },
	{ name: 'TPU 85A', filamentType: 'FLEX', isCustomSlot: false, nozzleTempC: 225, bedTempC: 40, maxSpeedMmS: 45, sortOrder: 2 },
	{ name: 'Vertex TPU', filamentType: 'FLEX', isCustomSlot: false, nozzleTempC: 235, bedTempC: 45, maxSpeedMmS: 60, sortOrder: 3 },
	{ name: 'EVA Powder', filamentType: 'FLEX', isCustomSlot: false, nozzleTempC: 230, bedTempC: 40, maxSpeedMmS: 50, sortOrder: 4 },
	{ name: 'Custom', filamentType: 'FLEX', isCustomSlot: true, nozzleTempC: null, bedTempC: null, maxSpeedMmS: null, sortOrder: 5 },
];

export const DEFAULT_MATERIAL_NAME = 'Footprint3D TPU-95A 2.3KG';

export const SEEDED_MATERIAL_NAMES = DEFAULT_MATERIAL_SEEDS.filter((s) => !s.isCustomSlot).map(
	(s) => s.name
);

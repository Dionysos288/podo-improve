export const PRINT_STRATEGY_VALUES = ['0.20mm', '0.15mm', '0.30mm'] as const;
export type PrintStrategy = (typeof PRINT_STRATEGY_VALUES)[number];

export const PRINT_STRATEGY_OPTIONS: { value: PrintStrategy; label: string }[] = [
	{ value: '0.20mm', label: 'Standaard (0,20 mm)' },
	{ value: '0.15mm', label: 'Fijn (0,15 mm)' },
	{ value: '0.30mm', label: 'Concept (0,30 mm)' },
];

export const FILL_PATTERN_VALUES = [
	'gyroid',
	'cubic',
	'rectilinear',
	'honeycomb',
	'concentric',
] as const;
export type FillPattern = (typeof FILL_PATTERN_VALUES)[number];

export const FILL_PATTERN_OPTIONS: { value: FillPattern; label: string }[] = [
	{ value: 'gyroid', label: 'Standaard (Gyroid)' },
	{ value: 'cubic', label: 'Sterk (Cubic)' },
	{ value: 'rectilinear', label: 'Snel (Rectilinear)' },
	{ value: 'honeycomb', label: 'Honeycomb' },
	{ value: 'concentric', label: 'Concentric' },
];

export const FILAMENT_TYPE_VALUES = ['FLEX', 'PLA', 'PETG', 'ABS', 'PVA'] as const;
export type FilamentType = (typeof FILAMENT_TYPE_VALUES)[number];

export const FILAMENT_TYPE_OPTIONS: { value: FilamentType; label: string }[] = [
	{ value: 'FLEX', label: 'FLEX (TPU)' },
	{ value: 'PLA', label: 'PLA' },
	{ value: 'PETG', label: 'PETG' },
	{ value: 'ABS', label: 'ABS' },
	{ value: 'PVA', label: 'PVA' },
];

export type FilamentPrintParams = {
	nozzleTempC: number;
	bedTempC: number;
	maxSpeedMmS: number;
};

/** Sensible per-type defaults used when a material has no explicit values. */
export const FILAMENT_TYPE_DEFAULTS: Record<FilamentType, FilamentPrintParams> = {
	FLEX: { nozzleTempC: 230, bedTempC: 40, maxSpeedMmS: 60 },
	PLA: { nozzleTempC: 210, bedTempC: 55, maxSpeedMmS: 150 },
	PETG: { nozzleTempC: 240, bedTempC: 70, maxSpeedMmS: 120 },
	ABS: { nozzleTempC: 250, bedTempC: 100, maxSpeedMmS: 120 },
	PVA: { nozzleTempC: 215, bedTempC: 60, maxSpeedMmS: 60 },
};

export function getFilamentDefaults(filamentType: string): FilamentPrintParams {
	const key = filamentType.toUpperCase() as FilamentType;
	return FILAMENT_TYPE_DEFAULTS[key] ?? FILAMENT_TYPE_DEFAULTS.FLEX;
}

const LEGACY_STRATEGY_MAP: Record<string, PrintStrategy> = {
	Default: '0.20mm',
	default: '0.20mm',
};

const LEGACY_INFILL_MAP: Record<string, FillPattern> = {
	Standard: 'gyroid',
	standard: 'gyroid',
};

export function normalizePrintStrategy(value: unknown): PrintStrategy {
	if (typeof value === 'string') {
		if ((PRINT_STRATEGY_VALUES as readonly string[]).includes(value)) {
			return value as PrintStrategy;
		}
		const mapped = LEGACY_STRATEGY_MAP[value];
		if (mapped) return mapped;
	}
	return '0.20mm';
}

export function normalizeFillPattern(value: unknown): FillPattern {
	if (typeof value === 'string') {
		if ((FILL_PATTERN_VALUES as readonly string[]).includes(value)) {
			return value as FillPattern;
		}
		const mapped = LEGACY_INFILL_MAP[value];
		if (mapped) return mapped;
	}
	return 'gyroid';
}

export function normalizePrinterSettings<T extends { strategy?: unknown; infill?: unknown }>(
	settings: T
): T & { strategy: PrintStrategy; infill: FillPattern } {
	return {
		...settings,
		strategy: normalizePrintStrategy(settings.strategy),
		infill: normalizeFillPattern(settings.infill),
	};
}

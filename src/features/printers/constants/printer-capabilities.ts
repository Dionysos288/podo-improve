export type PrinterCapability = {
	modelKey: 'raise3d-e2' | 'ir3-v2';
	label: string;
	extruder: 'idex' | 'single';
	nozzleOptions: string[];
	defaultNozzle: string;
	maxNozzleTempC: number;
	maxBedTempC: number;
	bed: 'flat' | 'belt';
};

export const PRINTER_CAPABILITIES: Record<
	PrinterCapability['modelKey'],
	PrinterCapability
> = {
	'raise3d-e2': {
		modelKey: 'raise3d-e2',
		label: 'Raise3D E2',
		extruder: 'idex',
		nozzleOptions: ['0.2', '0.4', '0.6', '0.8', '1.0'],
		defaultNozzle: '0.4',
		maxNozzleTempC: 300,
		maxBedTempC: 110,
		bed: 'flat',
	},
	'ir3-v2': {
		modelKey: 'ir3-v2',
		label: 'IdeaFormer IR3 V2',
		extruder: 'single',
		nozzleOptions: ['0.4', '0.6', '0.8', '1.0'],
		defaultNozzle: '0.4',
		maxNozzleTempC: 290,
		maxBedTempC: 90,
		bed: 'belt',
	},
};

export function resolvePrinterModelKey(input?: string | null): PrinterCapability['modelKey'] {
	const value = (input ?? '').toLowerCase();
	if (value.includes('ir3') || value.includes('ideaformer')) return 'ir3-v2';
	return 'raise3d-e2';
}

export function getPrinterCapability(input?: string | null): PrinterCapability {
	return PRINTER_CAPABILITIES[resolvePrinterModelKey(input)];
}

/** Map stored nozzle diameter (number or string) to a capability option value. */
export function resolveNozzleOptionValue(
	diameter: number | string | null | undefined,
	capability?: PrinterCapability
): string {
	const cap = capability ?? getPrinterCapability();
	if (diameter == null || diameter === '') return cap.defaultNozzle;
	const n = Number(diameter);
	if (!Number.isFinite(n)) return cap.defaultNozzle;
	const match = cap.nozzleOptions.find((opt) => Number(opt) === n);
	return match ?? cap.defaultNozzle;
}

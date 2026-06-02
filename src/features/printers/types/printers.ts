import type { FillPattern, PrintStrategy } from '../constants/print-options';

export type HardnessKey = 'extraSoft' | 'soft' | 'normal' | 'hard' | 'extraHard';

export type HardnessProfile = {
	infillPercent: number;
};

export type PrinterSettings = {
	nozzleDiameter?: number;
	strategy?: PrintStrategy;
	extruder?: 'Links' | 'Rechts';
	retraction?: number;
	printerModel?: string;
	overhang?: number;
	underlay?: number;
	perPart?: boolean;
	adhesion?: 'Geen' | 'Brim' | 'Raft' | 'Skirt';
	infill?: FillPattern;
	hardnessProfiles?: Record<HardnessKey, HardnessProfile>;
};

export type PrinterListItem = {
	id: string;
	orgId: string;
	name: string;
	brand: string | null;
	model: string | null;
	settings: PrinterSettings;
	createdAt: Date;
	updatedAt: Date;
};

export type PrintMaterialItem = {
	id: string;
	orgId: string;
	name: string;
	filamentType: string;
	isCustomSlot: boolean;
	nozzleTempC: number | null;
	bedTempC: number | null;
	maxSpeedMmS: number | null;
	sortOrder: number;
};

export type PrinterMaterialAssignment = {
	materialId: string;
	name: string;
	filamentType: string;
	isCustomSlot: boolean;
	nozzleTempC: number | null;
	bedTempC: number | null;
	maxSpeedMmS: number | null;
	isDefault: boolean;
};

export type PrinterWithMaterials = PrinterListItem & {
	materials: PrinterMaterialAssignment[];
};

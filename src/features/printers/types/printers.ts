export type HardnessKey = 'extraSoft' | 'soft' | 'normal' | 'hard' | 'extraHard';

export type HardnessProfile = {
	infillPercent: number;
};

export type PrinterSettings = {
	// Base
	nozzleDiameter?: number;
	strategy?: string;
	extruder?: 'Links' | 'Rechts';
	retraction?: number;
	printerModel?: string;
	overhang?: number;
	underlay?: number;
	perPart?: boolean;
	adhesion?: 'Geen' | 'Brim' | 'Raft' | 'Skirt';
	infill?: string;

	// Hardness
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


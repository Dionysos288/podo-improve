export type PrinterModel = 'raise3d-e2' | 'ir3-v2';

export type OrgSettings = {
	// Basis
	locale?: 'nl-NL' | 'en-US';
	theme?: 'dark' | 'light';
	patientView?: 'compact' | 'standard';
	defaultExportPath?: string;

	// MDR — Annex XIII standaardteksten
	companyName?: string;
	companyAddress?: string;
	introParagraph?: string;
	outroParagraph?: string;
	disclaimerParagraph?: string;
	mdr?: {
		manufacturer?: string;
		prrc?: string;
		kvkVat?: string;
		srn?: string;
		authorizedRep?: string;
		importer?: string;
		notifiedBody?: string;
		ceStatus?: string;
		nationalRegistrationNl?: string;
		seriesUdi?: string;
		vigilanceContact?: string;
		lastPmsReport?: string;
		softwareVersion?: string;
		samdClassification?: string;
	};

	// CNC / Frezen EVA settings (Mekanika CNC Pro + PlanetCNC)
	cnc?: {
		/** Named table presets (bed + block dimensions) for this organization */
		tablePresets?: Array<{
			id: string;
			name: string;
			blockWidthMm: number;
			blockLengthMm: number;
			blockDepthMm: number;
			blockGapMm: number;
			bedWidthMm: number;
			bedLengthMm: number;
		}>;
		selectedTablePresetId?: string;
		toolSettings?: {
			toolDiameterMm: number;
			toolType: 'ball-nose' | 'flat-end' | 'bull-nose';
			spindleSpeedRpm: number;
			feedRateXYMmMin: number;
			feedRateZMmMin: number;
			stepoverPercent: number;
			safeZMm: number;
			depthOfCutMm: number;
		};
		/** @deprecated Legacy flat fields — mirrored from toolSettings on save */
		toolDiameterMm?: number;
		toolType?: 'ball-nose' | 'flat-end' | 'bull-nose';
		spindleSpeedRpm?: number;
		feedRateXYMmMin?: number;
		feedRateZMmMin?: number;
		stepoverPercent?: number;
		safeZMm?: number;
		fixtureSlotOffsets?: Array<{ x: number; y: number; z: number }>;
	};
};

export interface UserSettings {
	// Local Print Agent configuration
	prusaSlicerPath?: string;
	disableBinaryGcode?: boolean;

	// Token for local agent to authenticate (keep as random string)
	agentToken?: string;
	agentLastSeenAt?: string;
}


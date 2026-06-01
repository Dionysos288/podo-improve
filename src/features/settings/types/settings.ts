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
		/** Default tool diameter in mm */
		toolDiameterMm?: number;
		/** Default tool type */
		toolType?: 'ball-nose' | 'flat-end' | 'bull-nose';
		/** Default spindle speed in RPM */
		spindleSpeedRpm?: number;
		/** Default XY feed rate in mm/min */
		feedRateXYMmMin?: number;
		/** Default Z feed rate in mm/min */
		feedRateZMmMin?: number;
		/** Default stepover percentage */
		stepoverPercent?: number;
		/** Safe Z height in mm */
		safeZMm?: number;
		/** Fixture slot offsets — array of 8 { x, y, z } positions in mm */
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


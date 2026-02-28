export type PrinterModel = 'raise3d-e2' | 'ir3-v2';

export type OrgSettings = {
	// Basis
	locale?: 'nl-NL' | 'en-US';
	theme?: 'dark' | 'light';
	patientView?: 'compact' | 'standard';
	defaultExportPath?: string;

	// MDR
	mdrEnabled?: boolean;
	companyName?: string;
	companyAddress?: string;
	logoUrl?: string;
	introParagraph?: string;
	outroParagraph?: string;
	disclaimerParagraph?: string;
};

export interface UserSettings {
	// Local Print Agent configuration
	prusaSlicerPath?: string;
	disableBinaryGcode?: boolean;

	// Token for local agent to authenticate (keep as random string)
	agentToken?: string;
	agentLastSeenAt?: string;
}


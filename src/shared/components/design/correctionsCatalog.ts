export type CorrectionCategory = 'Voorvoet' | 'Middenvoet' | 'Hiel' | 'Overige';

// NOTE: 'tekst' is a tool/annotation (not a geometry correction).
export type CorrectionKey =
	| 'kuipHoogte'
	| 'voorvoetUitvlakken'
	| 'hielHeffing'
	| 'medialeBoogCorrectie'
	| 'gladstrijken'
	| 'pronatie'
	| 'supinatie'
	| 'tekst';

export type CorrectionOption = {
	key: CorrectionKey;
	label: string;
	category: CorrectionCategory;
};

export const CORRECTION_OPTIONS: CorrectionOption[] = [
	{ key: 'voorvoetUitvlakken', label: 'Voorvoet uitvlakken', category: 'Voorvoet' },
	{ key: 'pronatie', label: 'Pronatie', category: 'Voorvoet' },
	{ key: 'supinatie', label: 'Supinatie', category: 'Voorvoet' },

	{ key: 'medialeBoogCorrectie', label: 'Mediale boog correctie', category: 'Middenvoet' },

	{ key: 'hielHeffing', label: 'Hiel heffing', category: 'Hiel' },
	{ key: 'kuipHoogte', label: 'Kuip hoogte', category: 'Hiel' },

	{ key: 'gladstrijken', label: 'Gladstrijken', category: 'Overige' },
	{ key: 'tekst', label: 'Tekst toevoegen', category: 'Overige' },
];

// Default behavior: all geometry corrections enabled, text tool disabled.
export const DEFAULT_ACTIVE_CORRECTIONS: CorrectionKey[] = CORRECTION_OPTIONS
	.map((o) => o.key)
	.filter((k) => k !== 'tekst');

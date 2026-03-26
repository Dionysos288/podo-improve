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
	// Legacy keys kept for data-compat (not shown in UI)
	| 'mediaalVlak'
	| 'lateraalVlak'
	| 'apexMiddenvoet'
	| 'apexHiel'
	| 'hielbeenCorrectie'
	| 'hielbreedteCorrectie'
	| 'zoolbreedte'
	| 'tekst';

export type CorrectionOption = {
	key: CorrectionKey;
	label: string;
	category: CorrectionCategory;
};

/**
 * Fixed correction list shown in the Ontwerp panel, in display order.
 * The "Correctie toevoegen" picker is gone — all corrections are always visible.
 */
export const CORRECTION_OPTIONS: CorrectionOption[] = [
	{ key: 'kuipHoogte', label: 'Kuip hoogte', category: 'Hiel' },
	{ key: 'voorvoetUitvlakken', label: 'Voorvoet uitvlakken', category: 'Voorvoet' },
	{ key: 'hielHeffing', label: 'Hiel heffing', category: 'Hiel' },
	{ key: 'medialeBoogCorrectie', label: 'Mediale boog correctie', category: 'Middenvoet' },
	{ key: 'gladstrijken', label: 'Gladstrijken', category: 'Overige' },
	{ key: 'pronatie', label: 'Pronatie', category: 'Voorvoet' },
	{ key: 'supinatie', label: 'Supinatie', category: 'Voorvoet' },
	{ key: 'zoolbreedte', label: 'Zoolbreedte', category: 'Overige' },
	{ key: 'tekst', label: 'Tekst toevoegen', category: 'Overige' },
];

// All geometry corrections are always active; tekst starts disabled.
export const DEFAULT_ACTIVE_CORRECTIONS: CorrectionKey[] = CORRECTION_OPTIONS
	.map((o) => o.key)
	.filter((k) => k !== 'tekst');

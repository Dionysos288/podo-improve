/**
 * ──────────────────────────────────────────────
 *  Orthotic Elements Library / Catalog
 *
 *  Full catalog matching the competitor screenshots.
 *  Each item has a normalised (0-1) outline polygon used for:
 *    – thumbnail SVG rendering
 *    – point-in-polygon hit testing in the geometry deformation
 * ──────────────────────────────────────────────
 */
import type { ElementLibraryItem, ElementTab } from './types';

/* ── shape outline helpers ────────────────────── */

/** Unit circle (N points) centred at 0.5, 0.5 with radius 0.4 */
function circle(n = 24): [number, number][] {
	return Array.from({ length: n }, (_, i) => {
		const a = (i / n) * Math.PI * 2;
		return [0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a)] as [number, number];
	});
}

/** Oval centred at 0.5, 0.5 with given x/y radii */
function oval(rx: number, ry: number, n = 24): [number, number][] {
	return Array.from({ length: n }, (_, i) => {
		const a = (i / n) * Math.PI * 2;
		return [0.5 + rx * Math.cos(a), 0.5 + ry * Math.sin(a)] as [number, number];
	});
}

/** Teardrop / druppel shape (wider at bottom, narrow at top) */
function teardrop(n = 24): [number, number][] {
	return Array.from({ length: n }, (_, i) => {
		const t = (i / n) * Math.PI * 2;
		const r = 0.35 * (1 + 0.3 * Math.sin(t));
		return [0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t) * 1.2] as [number, number];
	});
}

/** Crescent / halve-maan shape */
function crescent(n = 32): [number, number][] {
	const pts: [number, number][] = [];
	for (let i = 0; i <= n; i++) {
		const a = (i / n) * Math.PI;
		pts.push([0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a)]);
	}
	for (let i = n; i >= 0; i--) {
		const a = (i / n) * Math.PI;
		pts.push([0.5 + 0.25 * Math.cos(a), 0.5 + 0.25 * Math.sin(a)]);
	}
	return pts;
}

/** Kidney / nierenvorm */
function kidney(n = 24): [number, number][] {
	return Array.from({ length: n }, (_, i) => {
		const t = (i / n) * Math.PI * 2;
		const r = 0.3 + 0.1 * Math.cos(2 * t);
		return [0.5 + r * Math.cos(t) * 1.3, 0.5 + r * Math.sin(t)] as [number, number];
	});
}

/** Horseshoe / hoefijzer shape */
function horseshoe(n = 28): [number, number][] {
	const pts: [number, number][] = [];
	for (let i = 0; i <= n; i++) {
		const a = (i / n) * Math.PI * 1.5 - Math.PI * 0.25;
		pts.push([0.5 + 0.38 * Math.cos(a), 0.5 + 0.38 * Math.sin(a)]);
	}
	for (let i = n; i >= 0; i--) {
		const a = (i / n) * Math.PI * 1.5 - Math.PI * 0.25;
		pts.push([0.5 + 0.22 * Math.cos(a), 0.5 + 0.22 * Math.sin(a)]);
	}
	return pts;
}

/** Wedge / wig shape */
function wedge(): [number, number][] {
	return [
		[0.2, 0.15],
		[0.8, 0.15],
		[0.7, 0.85],
		[0.3, 0.85],
	];
}

/** Trapezoid */
function trapezoid(): [number, number][] {
	return [
		[0.15, 0.2],
		[0.85, 0.2],
		[0.75, 0.8],
		[0.25, 0.8],
	];
}

/** Forefoot band (wide shallow strip) */
function forefootBand(): [number, number][] {
	return [
		[0.1, 0.35],
		[0.9, 0.35],
		[0.9, 0.65],
		[0.1, 0.65],
	];
}

/* ── catalog entries ─────────────────────────── */

const ELEMENTS_CATALOG: ElementLibraryItem[] = [
	// ─── RCTB (Retro-Capital-Transverse Bar) variants ───
	{
		key: 'rctb-1',
		label: 'RCTB 1',
		tab: 'elementen',
		shape: 'trapezoid',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'metatarsals',
		color: 'red',
		outline: trapezoid(),
	},
	{
		key: 'rctb-2',
		label: 'RCTB 2',
		tab: 'elementen',
		shape: 'trapezoid',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'metatarsals',
		color: 'red',
		outline: trapezoid(),
	},
	{
		key: 'rctb-3',
		label: 'RCTB 3',
		tab: 'elementen',
		shape: 'trapezoid',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 5,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'metatarsals',
		color: 'red',
		outline: trapezoid(),
	},
	{
		key: 'rctb-pronatie',
		label: 'RCTB pronatie',
		tab: 'elementen',
		shape: 'trapezoid',
		defaultProfile: 'vlak',
		profiles: ['vlak', 'bol'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'metatarsals',
		color: 'red',
		outline: trapezoid(),
	},

	// ─── SD (Steun Druppel) variants ───
	{
		key: 'sd-1',
		label: 'SD 1',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 4,
		anchor: 'arch',
		color: 'blue',
		outline: teardrop(),
	},
	{
		key: 'sd-1-5',
		label: 'SD 1-5',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'blue',
		outline: teardrop(),
	},
	{
		key: 'sd-2-5',
		label: 'SD 2-5',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 5,
		heightRange: [1, 10],
		defaultBlendMm: 6,
		anchor: 'arch',
		color: 'blue',
		outline: teardrop(),
	},

	// ─── PPSA / PPSI (Pelotte Post-Scaph) ───
	{
		key: 'ppsa-bol',
		label: 'PPSA bol',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'teal',
		outline: oval(0.3, 0.4),
	},
	{
		key: 'ppsa-vlak',
		label: 'PPSA vlak',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'teal',
		outline: oval(0.3, 0.4),
	},
	{
		key: 'ppsi',
		label: 'PPSI',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'teal',
		outline: oval(0.3, 0.4),
	},
	{
		key: 'spsi',
		label: 'SPSI',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 4,
		anchor: 'midfoot',
		color: 'teal',
		outline: oval(0.25, 0.35),
	},
	{
		key: 'spsa-bol',
		label: 'SPSA bol',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'teal',
		outline: oval(0.3, 0.35),
	},
	{
		key: 'spsa-vlak',
		label: 'SPSA vlak',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'teal',
		outline: oval(0.3, 0.35),
	},

	// ─── MIC (Medial Internal Correction) ───
	{
		key: 'mic-halve-maan',
		label: 'MIC halve maan',
		tab: 'elementen',
		shape: 'crescent',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: crescent(),
	},
	{
		key: 'mic-halve-maan-groot',
		label: 'MIC halve maan groot',
		tab: 'elementen',
		shape: 'crescent',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 5,
		heightRange: [1, 10],
		defaultBlendMm: 6,
		anchor: 'arch',
		color: 'orange',
		outline: crescent(),
		defaultScale: [1.3, 1.3],
	},
	{
		key: 'mic-druppel',
		label: 'MIC druppel',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: teardrop(),
	},
	{
		key: 'mic-druppel-groot',
		label: 'MIC druppel groot',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 5,
		heightRange: [1, 10],
		defaultBlendMm: 6,
		anchor: 'arch',
		color: 'orange',
		outline: teardrop(),
		defaultScale: [1.3, 1.3],
	},

	// ─── SA / SC (Subtalar / Scaphoid) ───
	{
		key: 'sa-1',
		label: 'SA 1',
		tab: 'elementen',
		shape: 'kidney',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'green',
		outline: kidney(),
	},
	{
		key: 'sa-2',
		label: 'SA 2',
		tab: 'elementen',
		shape: 'kidney',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'green',
		outline: kidney(),
	},
	{
		key: 'sa-3',
		label: 'SA 3',
		tab: 'elementen',
		shape: 'kidney',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 5,
		heightRange: [1, 10],
		defaultBlendMm: 6,
		anchor: 'arch',
		color: 'green',
		outline: kidney(),
	},
	{
		key: 'sc-1',
		label: 'SC 1',
		tab: 'elementen',
		shape: 'kidney',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'green',
		outline: kidney(),
	},
	{
		key: 'sc-2',
		label: 'SC 2',
		tab: 'elementen',
		shape: 'kidney',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'green',
		outline: kidney(),
	},
	{
		key: 'sc-3',
		label: 'SC 3',
		tab: 'elementen',
		shape: 'kidney',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 5,
		heightRange: [1, 10],
		defaultBlendMm: 6,
		anchor: 'midfoot',
		color: 'green',
		outline: kidney(),
	},

	// ─── Pelotte (Metatarsal pad) ───
	{
		key: 'pelotte-1',
		label: 'Pelotte 1',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 6],
		defaultBlendMm: 4,
		anchor: 'metatarsals',
		color: 'red',
		outline: oval(0.25, 0.2),
	},
	{
		key: 'pelotte-2',
		label: 'Pelotte 2',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 6],
		defaultBlendMm: 4,
		anchor: 'metatarsals',
		color: 'red',
		outline: oval(0.3, 0.2),
	},
	{
		key: 'pelotte-3',
		label: 'Pelotte 3',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 5,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'metatarsals',
		color: 'red',
		outline: oval(0.35, 0.25),
	},
	{
		key: 'pa',
		label: 'PA',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 6],
		defaultBlendMm: 4,
		anchor: 'forefoot',
		color: 'red',
		outline: oval(0.2, 0.15),
	},

	// ─── Pronator ───
	{
		key: 'pronator-kort',
		label: 'Pronator kort',
		tab: 'elementen',
		shape: 'wedge',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'heelMedial',
		color: 'blue',
		outline: wedge(),
	},
	{
		key: 'pronator-lang',
		label: 'Pronator lang',
		tab: 'elementen',
		shape: 'wedge',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 10],
		defaultBlendMm: 6,
		anchor: 'heelMedial',
		color: 'blue',
		outline: wedge(),
		defaultScale: [1, 1.5],
	},

	// ─── Wig (Wedge) ───
	{
		key: 'wig',
		label: 'Wig',
		tab: 'elementen',
		shape: 'wedge',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 10],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: wedge(),
	},

	// ─── CV / HAI (Calcaneal Valgus / Heel Alignment Insert) ───
	{
		key: 'cv-hai-3',
		label: 'CV HAI 3°',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: horseshoe(),
	},
	{
		key: 'cv-hai-6',
		label: 'CV HAI 6°',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 10],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: horseshoe(),
	},
	{
		key: 'hai-3',
		label: 'HAI 3°',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 4,
		anchor: 'heel',
		color: 'blue',
		outline: horseshoe(),
	},
	{
		key: 'hai-6',
		label: 'HAI 6°',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 10],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: horseshoe(),
	},
	{
		key: 'cv-lang',
		label: 'CV lang',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 10],
		defaultBlendMm: 6,
		anchor: 'heel',
		color: 'blue',
		outline: horseshoe(),
		defaultScale: [1, 1.4],
	},
	{
		key: 'cv-kort',
		label: 'CV kort',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: horseshoe(),
		defaultScale: [1, 0.8],
	},
	{
		key: 'cv-mic',
		label: 'CV MIC',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 10],
		defaultBlendMm: 6,
		anchor: 'heel',
		color: 'orange',
		outline: horseshoe(),
	},

	// ─── Forefoot band ───
	{
		key: 'voorvoet-band',
		label: 'Voorvoet band',
		tab: 'elementen',
		shape: 'forefootBand',
		defaultProfile: 'vlak',
		profiles: ['vlak', 'bol'],
		defaultHeightMm: 2,
		heightRange: [1, 6],
		defaultBlendMm: 3,
		anchor: 'forefoot',
		color: 'red',
		outline: forefootBand(),
	},

	// ═══ DIEPELEMENTEN (engraved / recessed) ═══
	{
		key: 'diep-rond',
		label: 'Rond',
		tab: 'diepelementen',
		shape: 'circle',
		defaultProfile: 'hol',
		profiles: ['hol'],
		defaultHeightMm: -2,
		heightRange: [-6, -0.5],
		defaultBlendMm: 3,
		anchor: 'center',
		color: 'pink',
		outline: circle(),
	},
	{
		key: 'diep-ovaal',
		label: 'Ovaal vloeiend',
		tab: 'diepelementen',
		shape: 'oval',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'hol'],
		defaultHeightMm: -2,
		heightRange: [-6, -0.5],
		defaultBlendMm: 4,
		anchor: 'center',
		color: 'pink',
		outline: oval(0.35, 0.25),
	},
	{
		key: 'diep-ovaal-groot',
		label: 'Ovaal vloeiend groot',
		tab: 'diepelementen',
		shape: 'ovalLarge',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'hol'],
		defaultHeightMm: -3,
		heightRange: [-8, -0.5],
		defaultBlendMm: 5,
		anchor: 'center',
		color: 'pink',
		outline: oval(0.4, 0.3),
	},
];

export default ELEMENTS_CATALOG;

/** Pre-filtered catalogs for each tab */
export const ELEMENTEN_ITEMS = ELEMENTS_CATALOG.filter(
	(e) => e.tab === 'elementen'
);
export const DIEPELEMENTEN_ITEMS = ELEMENTS_CATALOG.filter(
	(e) => e.tab === 'diepelementen'
);

/** Lookup by key */
export function getElementByKey(key: string): ElementLibraryItem | undefined {
	return ELEMENTS_CATALOG.find((e) => e.key === key);
}

/** Color hex values for each color group */
export const ELEMENT_COLORS: Record<string, string> = {
	red: '#ef4444',
	blue: '#3b82f6',
	green: '#22c55e',
	orange: '#f59e0b',
	pink: '#ec4899',
	teal: '#14b8a6',
};

/** Default anatomical U,V placement by anchor zone (0-1, heel=0, toe=1) */
export const ANCHOR_POSITIONS: Record<string, { u: number; v: number }> = {
	forefoot:     { u: 0.85, v: 0.5 },
	metatarsals:  { u: 0.72, v: 0.5 },
	met1:         { u: 0.75, v: 0.65 },
	'met2-5':     { u: 0.75, v: 0.35 },
	'met1-5':     { u: 0.75, v: 0.5 },
	midfoot:      { u: 0.5,  v: 0.5 },
	arch:         { u: 0.45, v: 0.6 },
	heel:         { u: 0.15, v: 0.5 },
	heelMedial:   { u: 0.15, v: 0.65 },
	heelLateral:  { u: 0.15, v: 0.35 },
	fullLength:   { u: 0.5,  v: 0.5 },
	center:       { u: 0.5,  v: 0.5 },
};

/**
 * ──────────────────────────────────────────────
 *  Orthotic Elements Library / Catalog
 *
 *  Each item has a normalised (0-1) outline polygon used for:
 *    – thumbnail SVG rendering
 *    – point-in-polygon hit testing in the geometry deformation
 *  Elements with stlUrl use a pre-built STL mesh for the 3D overlay.
 * ──────────────────────────────────────────────
 */
import type { ElementLibraryItem } from './types';

/* ── shape outline helpers ────────────────────── */

/** Trapezoid */
function trapezoid(): [number, number][] {
	return [
		[0.15, 0.2],
		[0.85, 0.2],
		[0.75, 0.8],
		[0.25, 0.8],
	];
}

/* ── catalog entries ─────────────────────────── */

const ELEMENTS_CATALOG: ElementLibraryItem[] = [
	// ─── RCTB 3 (Retro-Capital-Transverse Bar, size 3) — red, trapezoid ───
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
		stlUrl: '/materials/rctb3.stl',
		stlSizeMm: [66, 32],
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

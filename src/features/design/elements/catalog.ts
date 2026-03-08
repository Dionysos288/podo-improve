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

/** Tall narrow strip for SA recht shapes */
function tallStrip(): [number, number][] {
	return [[0.28, 0.08], [0.72, 0.08], [0.72, 0.92], [0.28, 0.92]];
}

/** Small triangle for PA */
function triangle(): [number, number][] {
	return [[0.5, 0.08], [0.92, 0.88], [0.08, 0.88]];
}

/** Narrow sickle / HAI shape — open arc, taller than wide */
function sickle(n = 22): [number, number][] {
	const outer = 0.38, inner = 0.20;
	const start = -Math.PI * 0.25, end = Math.PI * 1.25;
	const pts: [number, number][] = [];
	for (let i = 0; i <= n; i++) {
		const a = start + (i / n) * (end - start);
		pts.push([0.5 + outer * Math.cos(a), 0.5 + outer * Math.sin(a)]);
	}
	for (let i = n; i >= 0; i--) {
		const a = start + (i / n) * (end - start);
		pts.push([0.5 + inner * Math.cos(a), 0.5 + inner * Math.sin(a)]);
	}
	return pts;
}

/** Thin narrow banana / PPSA / SC shape — elongated sliver */
function banana(n = 20): [number, number][] {
	const pts: [number, number][] = [];
	for (let i = 0; i <= n; i++) {
		const a = (i / n) * Math.PI;
		pts.push([0.5 + 0.22 * Math.cos(a), 0.5 + 0.42 * Math.sin(a)]);
	}
	for (let i = n; i >= 0; i--) {
		const a = (i / n) * Math.PI;
		pts.push([0.5 + 0.10 * Math.cos(a), 0.5 + 0.42 * Math.sin(a)]);
	}
	return pts;
}

/* ── catalog entries ─────────────────────────── */

const ELEMENTS_CATALOG: ElementLibraryItem[] = [
	// ─── RCTB (Retro-Capital-Transverse Bar) — red, trapezoid ───
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

	// ─── SD (Steun Druppel) — RED teardrop ───
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
		color: 'red',
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
		color: 'red',
		outline: teardrop(),
		defaultScale: [1.2, 1.2],
	},
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
		color: 'red',
		outline: teardrop(),
	},

	// ─── PPSA / PPSI / SPSA / SPSI — teal banana/sliver ───
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
		outline: banana(),
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
		outline: banana(),
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
		outline: banana(),
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
		outline: banana(),
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
		outline: banana(),
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
		outline: banana(),
	},

	// ─── MIC halve maan — orange crescent, 3 profiles ───
	{
		key: 'mic-halve-maan-hol',
		label: 'MIC halve maan hol',
		tab: 'elementen',
		shape: 'crescent',
		defaultProfile: 'hol',
		profiles: ['hol'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: crescent(),
	},
	{
		key: 'mic-halve-maan-bol',
		label: 'MIC halve maan bol',
		tab: 'elementen',
		shape: 'crescent',
		defaultProfile: 'bol',
		profiles: ['bol'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: crescent(),
	},
	{
		key: 'mic-halve-maan-vlak',
		label: 'MIC halve maan vlak',
		tab: 'elementen',
		shape: 'crescent',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: crescent(),
	},

	// ─── MIC druppel — orange teardrop, 3 profiles ───
	{
		key: 'mic-druppel-hol',
		label: 'MIC druppel hol',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'hol',
		profiles: ['hol'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: teardrop(),
	},
	{
		key: 'mic-druppel-bol',
		label: 'MIC druppel bol',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: teardrop(),
	},
	{
		key: 'mic-druppel-vlak',
		label: 'MIC druppel vlak',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: teardrop(),
	},

	// ─── SA (Subtalar Arch) — orange, recht/rond variants ───
	{
		key: 'sa-recht-2-5',
		label: 'SA recht 2-5',
		tab: 'elementen',
		shape: 'wedge',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: tallStrip(),
		defaultScale: [1.2, 1],
	},
	{
		key: 'sa-recht-1-5',
		label: 'SA recht 1-5',
		tab: 'elementen',
		shape: 'wedge',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 5,
		heightRange: [1, 10],
		defaultBlendMm: 6,
		anchor: 'arch',
		color: 'orange',
		outline: tallStrip(),
		defaultScale: [1.5, 1],
	},
	{
		key: 'sa-rond-2-4',
		label: 'SA rond 2-4',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: oval(0.3, 0.4),
	},
	{
		key: 'sa-recht-1',
		label: 'SA recht 1',
		tab: 'elementen',
		shape: 'wedge',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 4,
		anchor: 'arch',
		color: 'orange',
		outline: tallStrip(),
	},
	{
		key: 'sa-rond-1',
		label: 'SA rond 1',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 4,
		anchor: 'arch',
		color: 'orange',
		outline: oval(0.25, 0.35),
	},

	// ─── SC — blue banana ───
	{
		key: 'sc-bol',
		label: 'SC bol',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'bol',
		profiles: ['bol'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'blue',
		outline: banana(),
	},
	{
		key: 'sc-vloeiend',
		label: 'SC vloeiend',
		tab: 'elementen',
		shape: 'oval',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'blue',
		outline: banana(),
	},

	// ─── Pelotte — GREEN teardrop ───
	{
		key: 'pelotte-3',
		label: 'Pelotte 3',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 5,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'metatarsals',
		color: 'green',
		outline: teardrop(),
		defaultScale: [1.2, 1.2],
	},
	{
		key: 'pelotte-2',
		label: 'Pelotte 2',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 6],
		defaultBlendMm: 4,
		anchor: 'metatarsals',
		color: 'green',
		outline: teardrop(),
	},
	{
		key: 'pelotte-1',
		label: 'Pelotte 1',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 6],
		defaultBlendMm: 4,
		anchor: 'metatarsals',
		color: 'green',
		outline: teardrop(),
		defaultScale: [0.85, 0.85],
	},

	// ─── PA — blue small triangle ───
	{
		key: 'pa',
		label: 'PA',
		tab: 'elementen',
		shape: 'wedge',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 6],
		defaultBlendMm: 4,
		anchor: 'forefoot',
		color: 'blue',
		outline: triangle(),
	},

	// ─── Pronator — orange wedge ───
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
		color: 'orange',
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
		color: 'orange',
		outline: wedge(),
		defaultScale: [1, 1.5],
	},

	// ─── Wig — orange wedge ───
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
		color: 'orange',
		outline: wedge(),
	},

	// ─── CV HAI — blue thin sickle, 3 profiles ───
	{
		key: 'cv-hai-bol',
		label: 'CV HAI bol',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'bol',
		profiles: ['bol'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: sickle(),
	},
	{
		key: 'cv-hai-hol',
		label: 'CV HAI hol',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'hol',
		profiles: ['hol'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: sickle(),
	},
	{
		key: 'cv-hai-vlak',
		label: 'CV HAI vlak',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: sickle(),
	},

	// ─── HAI — orange sickle variants ───
	{
		key: 'hai-spsa',
		label: 'HAI SPSA',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 4,
		anchor: 'heel',
		color: 'orange',
		outline: sickle(),
	},
	{
		key: 'hai-bol',
		label: 'HAI bol',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'bol',
		profiles: ['bol'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 4,
		anchor: 'heel',
		color: 'orange',
		outline: sickle(),
	},
	{
		key: 'hai-vlak-2',
		label: 'HAI vlak 2',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 10],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'orange',
		outline: sickle(),
		defaultScale: [1.2, 1.2],
	},
	{
		key: 'hai-vlak',
		label: 'HAI vlak',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'vlak',
		profiles: ['vlak'],
		defaultHeightMm: 3,
		heightRange: [1, 8],
		defaultBlendMm: 4,
		anchor: 'heel',
		color: 'orange',
		outline: sickle(),
	},
	{
		key: 'hai-bol-2',
		label: 'HAI bol 2',
		tab: 'elementen',
		shape: 'horseshoe',
		defaultProfile: 'bol',
		profiles: ['bol'],
		defaultHeightMm: 4,
		heightRange: [1, 10],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'orange',
		outline: sickle(),
		defaultScale: [1.2, 1.2],
	},

	// ─── CV (Calcaneal Valgus) — blue horseshoe ───
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
		color: 'blue',
		outline: horseshoe(),
	},

	// ─── Vaak gebruikt shortcuts ───
	{
		key: 'vaak-pelottes',
		label: 'Vaak gebruikte pelottes',
		tab: 'elementen',
		shape: 'teardrop',
		defaultProfile: 'bol',
		profiles: ['bol', 'vlak'],
		defaultHeightMm: 4,
		heightRange: [1, 8],
		defaultBlendMm: 4,
		anchor: 'metatarsals',
		color: 'green',
		outline: teardrop(),
	},
	{
		key: 'vaak-gebruikt',
		label: 'Vaak gebruikt',
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

	// ═══ DIEPELEMENTEN (engraved / recessed) — pink ═══
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

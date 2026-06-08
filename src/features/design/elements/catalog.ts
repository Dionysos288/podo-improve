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

const BASE_ELEMENT_STL_PREFIX = '/base/elements/';
const LOWPOLY_ELEMENT_STL_PREFIX = '/base/elements-lowpoly/';
/** Bump when element STL assets change so viewer/thumbnail caches refresh. */
export const ELEMENT_STL_ASSET_VERSION = '2026-06-08';

/* ── shape outline helpers ────────────────────── */

/** Soft crescent / bar used by the SD 2-5 metatarsal element */
function sd25Outline(): [number, number][] {
	return [
		[0.06, 0.56],
		[0.12, 0.34],
		[0.3, 0.18],
		[0.55, 0.1],
		[0.8, 0.14],
		[0.95, 0.29],
		[0.98, 0.48],
		[0.92, 0.68],
		[0.75, 0.82],
		[0.52, 0.88],
		[0.29, 0.82],
		[0.12, 0.71],
	];
}

/** Wider crescent spanning all 5 toes for the SD 1-5 element */
function sd15Outline(): [number, number][] {
	return [
		[0.03, 0.52],
		[0.07, 0.30],
		[0.20, 0.14],
		[0.42, 0.05],
		[0.65, 0.04],
		[0.84, 0.10],
		[0.96, 0.24],
		[0.99, 0.44],
		[0.95, 0.64],
		[0.82, 0.80],
		[0.62, 0.91],
		[0.40, 0.94],
		[0.20, 0.88],
		[0.08, 0.72],
	];
}

/** Small oval pad for the SD 1 (big toe) element */
function sd1Outline(): [number, number][] {
	return [
		[0.05, 0.50],
		[0.12, 0.25],
		[0.28, 0.08],
		[0.50, 0.02],
		[0.72, 0.08],
		[0.88, 0.25],
		[0.95, 0.50],
		[0.88, 0.75],
		[0.72, 0.92],
		[0.50, 0.98],
		[0.28, 0.92],
		[0.12, 0.75],
	];
}

/** Elongated oval inset used by the Diep Ovaal element */
function diepOvaalOutline(): [number, number][] {
	return [
		[0.04, 0.50],
		[0.08, 0.28],
		[0.18, 0.12],
		[0.34, 0.04],
		[0.52, 0.01],
		[0.70, 0.04],
		[0.84, 0.12],
		[0.93, 0.28],
		[0.96, 0.50],
		[0.93, 0.72],
		[0.84, 0.88],
		[0.70, 0.96],
		[0.52, 0.99],
		[0.34, 0.96],
		[0.18, 0.88],
		[0.08, 0.72],
	];
}

/** Tall narrow arch pad outline for the HAI Vlak 2 element */
function haiVlak2Outline(): [number, number][] {
	return [
		[0.03, 0.46],
		[0.08, 0.22],
		[0.20, 0.06],
		[0.38, 0.01],
		[0.58, 0.01],
		[0.78, 0.06],
		[0.92, 0.22],
		[0.98, 0.46],
		[0.96, 0.68],
		[0.86, 0.86],
		[0.68, 0.96],
		[0.48, 0.99],
		[0.28, 0.96],
		[0.14, 0.86],
		[0.05, 0.68],
	];
}

/** Full insole bowl/cup (kuip) outline for the SC Bol element */
function scBolOutline(): [number, number][] {
	return [
		[0.02, 0.50],
		[0.05, 0.28],
		[0.12, 0.12],
		[0.25, 0.04],
		[0.42, 0.01],
		[0.60, 0.02],
		[0.78, 0.06],
		[0.90, 0.16],
		[0.97, 0.34],
		[0.99, 0.52],
		[0.94, 0.72],
		[0.82, 0.88],
		[0.65, 0.96],
		[0.45, 0.99],
		[0.28, 0.96],
		[0.14, 0.86],
		[0.05, 0.70],
	];
}

/** Elongated heel-side pad outline for the SPSA Vlak element */
function spsaVlakOutline(): [number, number][] {
	return [
		[0.03, 0.48],
		[0.06, 0.26],
		[0.14, 0.10],
		[0.28, 0.03],
		[0.48, 0.01],
		[0.68, 0.03],
		[0.84, 0.10],
		[0.94, 0.26],
		[0.98, 0.48],
		[0.95, 0.70],
		[0.86, 0.86],
		[0.70, 0.95],
		[0.50, 0.99],
		[0.30, 0.95],
		[0.14, 0.86],
		[0.06, 0.70],
	];
}

/** Rounded bar shape for the RCTB 3 midfoot element */
function rctb3Outline(): [number, number][] {
	return [
		[0.04, 0.50],
		[0.08, 0.28],
		[0.18, 0.12],
		[0.36, 0.04],
		[0.56, 0.02],
		[0.76, 0.08],
		[0.90, 0.20],
		[0.97, 0.40],
		[0.98, 0.58],
		[0.92, 0.76],
		[0.78, 0.90],
		[0.58, 0.97],
		[0.38, 0.96],
		[0.20, 0.88],
		[0.09, 0.72],
	];
}

/* ── catalog entries ─────────────────────────── */

const ELEMENTS_CATALOG: ElementLibraryItem[] = [
	{
		key: 'sd-2-5',
		label: 'SD 2-5',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 5],
		defaultBlendMm: 5,
		anchor: 'met2-5',
		color: 'red',
		outline: sd25Outline(),
		defaultScale: [0.9, 0.9],
		defaultPosition: { u: 0.82, v: 0.50 },
		defaultRotationRad: 0.2,
		stlUrl: '/base/elements/SD 2-5.stl',
		stlSizeMm: [63.7, 49.9],
	},
	{
		key: 'sd-1-5',
		label: 'SD 1-5',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 5],
		defaultBlendMm: 5,
		anchor: 'met1-5',
		color: 'red',
		outline: sd15Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.80, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/sd 1-5.stl',
		stlSizeMm: [87.2, 53.1],
	},
	{
		key: 'sd-1',
		label: 'SD 1',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 5],
		defaultBlendMm: 5,
		anchor: 'met1',
		color: 'red',
		outline: sd1Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.82, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/SD1.stl',
		stlSizeMm: [24.8, 19.8],
	},
	{
		key: 'rctb-3',
		label: 'RCTB 3',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'red',
		outline: rctb3Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.45, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/RCTB 3.stl',
		stlSizeMm: [86.1, 78.1],
	},
	{
		key: 'rctb-2',
		label: 'RCTB 2',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'red',
		outline: rctb3Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.45, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/RCTB 2.stl',
		stlSizeMm: [85.9, 83.6],
	},
	{
		key: 'rctb-1',
		label: 'RCTB 1',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'red',
		outline: rctb3Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.45, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/RCTB 1.stl',
		stlSizeMm: [85.2, 66.6],
	},
	{
		key: 'rctb-pronatie',
		label: 'RCTB Pronatie',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 8],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'red',
		outline: rctb3Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.45, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/RCTB Pronatie.stl',
		stlSizeMm: [86.6, 93.0],
	},
	{
		key: 'spsa-vlak',
		label: 'SPSA Vlak',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 8],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: spsaVlakOutline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.28, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/SPSA Vlak.stl',
		stlSizeMm: [56.6, 113.0],
	},
	{
		key: 'ppsa',
		label: 'PPSA',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 8],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: spsaVlakOutline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.28, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/PPSA.stl',
		stlSizeMm: [49.5, 115.7],
	},
	{
		key: 'sc-bol',
		label: 'SC Bol',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 10],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: scBolOutline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.08, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/sc bol.stl',
		stlInteractiveUrl: '/base/elements/sc bol.stl',
		stlSizeMm: [68.8, 58.7],
	},
	{
		key: 'ppsi',
		label: 'PPSI',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 10],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: scBolOutline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.08, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/PPSI.stl',
		stlSizeMm: [60.0, 62.4],
	},
	{
		key: 'spsi',
		label: 'SPSI',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 10],
		defaultBlendMm: 5,
		anchor: 'heel',
		color: 'blue',
		outline: scBolOutline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.08, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/SPSI.stl',
		stlSizeMm: [63.8, 53.3],
	},
	{
		key: 'hai-vlak-2',
		label: 'HAI Vlak 2',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 10],
		defaultBlendMm: 5,
		anchor: 'arch',
		color: 'orange',
		outline: haiVlak2Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.45, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/HAI Vlak 2.stl',
		stlSizeMm: [36.1, 124.3],
	},
	{
		key: 'sa-rechts-1-5',
		label: 'SA Rechts 1-5',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 5],
		defaultBlendMm: 5,
		anchor: 'metatarsals',
		color: 'skin',
		outline: sd15Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.78, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/sa recgt 1-5.stl',
		stlSizeMm: [84.2, 91.0],
	},
	{
		key: 'sa-recht-1',
		label: 'SA Recht 1',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 5],
		defaultBlendMm: 5,
		anchor: 'met1',
		color: 'skin',
		outline: sd1Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.82, v: 0.65 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/sa Recht 1.stl',
		stlSizeMm: [28.8, 67.4],
	},
	{
		key: 'peloitte-2',
		label: 'Peloitte 2',
		tab: 'elementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: 2,
		heightRange: [0.5, 5],
		defaultBlendMm: 5,
		anchor: 'midfoot',
		color: 'green',
		outline: rctb3Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.50, v: 0.50 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/peloitte 2.stl',
		stlSizeMm: [35.1, 40.2],
	},
	// ── Diepelementen (inset / engraved) ─────────────────────────
	{
		key: 'diep-rond',
		label: 'Diep Rond',
		tab: 'diepelementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: -2,
		heightRange: [0.5, 5],
		defaultBlendMm: 5,
		anchor: 'met1',
		color: 'magenta',
		outline: sd1Outline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.82, v: 0.65 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/diep-rond.stl',
		stlSizeMm: [24.5, 24.5],
	},
	{
		key: 'diep-ovaal',
		label: 'Diep Ovaal',
		tab: 'diepelementen',
		shape: 'custom',
		defaultProfile: 'vloeiend',
		profiles: ['vloeiend', 'vlak'],
		defaultHeightMm: -2,
		heightRange: [0.5, 5],
		defaultBlendMm: 5,
		anchor: 'met1',
		color: 'magenta',
		outline: diepOvaalOutline(),
		defaultScale: [1.0, 1.0],
		defaultPosition: { u: 0.82, v: 0.65 },
		defaultRotationRad: 0,
		stlUrl: '/base/elements/diep - ovaal.stl',
		stlSizeMm: [20.3, 48.3],
	},
];

export default ELEMENTS_CATALOG;

function getElementLowpolyStlUrl(item: ElementLibraryItem): string | undefined {
	if (!item.stlUrl) return undefined;
	if (!item.stlUrl.startsWith(BASE_ELEMENT_STL_PREFIX)) return undefined;
	return withElementStlAssetVersion(
		`${LOWPOLY_ELEMENT_STL_PREFIX}${item.stlUrl.slice(BASE_ELEMENT_STL_PREFIX.length)}`,
	);
}

function withElementStlAssetVersion(url: string): string {
	const separator = url.includes('?') ? '&' : '?';
	return `${url}${separator}v=${ELEMENT_STL_ASSET_VERSION}`;
}

export function getElementPreferredStlUrl(item: ElementLibraryItem): string | undefined {
	if (item.stlInteractiveUrl) return withElementStlAssetVersion(item.stlInteractiveUrl);
	if (!item.stlUrl) return undefined;
	return withElementStlAssetVersion(item.stlUrl);
}

export function getElementStlLoadUrls(item: ElementLibraryItem): string[] {
	const urls: string[] = [];
	const preferredUrl = getElementPreferredStlUrl(item);
	if (preferredUrl) urls.push(preferredUrl);
	const lowpolyUrl = getElementLowpolyStlUrl(item);
	if (lowpolyUrl && lowpolyUrl !== preferredUrl) urls.push(lowpolyUrl);
	return urls;
}

/**
 * URLs to try when building the on-screen overlay pad, cheapest first. Overlays
 * are visual only (export displacement is polygon-based, not STL-based), so the
 * viewer prefers the decimated low-poly mesh and falls back to the full-res STL.
 */
export function getElementViewerStlUrls(item: ElementLibraryItem): string[] {
	const preferredUrl = getElementPreferredStlUrl(item);
	const lowpolyUrl = getElementLowpolyStlUrl(item);
	// Curved cups (SC Bol, etc.) need the smooth full-res mesh in the viewer;
	// low-poly faceting reads as a jagged cut-out against the insole.
	if (item.stlInteractiveUrl && preferredUrl) {
		return [preferredUrl];
	}
	const urls: string[] = [];
	if (lowpolyUrl) urls.push(lowpolyUrl);
	if (preferredUrl && preferredUrl !== lowpolyUrl) urls.push(preferredUrl);
	return urls;
}

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
	skin: '#d4a574',
	magenta: '#d946ef',
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

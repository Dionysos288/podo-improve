/**
 * ──────────────────────────────────────────────
 *  Apply placed orthotic elements as vertex-level
 *  height displacements on an insole BufferGeometry.
 *
 *  This follows the same pattern as insoleCorrections.ts:
 *  standalone functions that mutate a BufferGeometry in-place.
 * ──────────────────────────────────────────────
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
	PlacedElement,
	ElementProfile,
	ElementColorGroup,
} from './types';
import {
	getElementByKey,
	getElementPreferredStlUrl,
	getElementViewerStlUrls,
	ELEMENT_COLORS,
} from './catalog';
import { getDefaultPlacementForSide } from './placement';
import {
	getElementStlHeightField,
	getCenterlineProfilePeakMm,
	getRowFloorProfilePeakMm,
	sampleRowFloorHeightMm,
	buildFootprintRowCenterProfile,
	getFootprintXExtent,
	sampleRowCenterRawX,
	lateralSpanTaper,
	localLengthToSpanT,
	localWidthToRawX,
	localWidthToSpanT,
	spanFillRawXFromLocalWidth,
	sampleElementHeightMm,
	type ElementStlHeightField,
	type FootprintXExtent,
} from './elementStlHeightField';
import {
	getInsoleSurfaceSampler,
	type InsoleSurfaceSampler,
} from './conformElementToInsole';
import { buildConformedElementSheet } from './conformedElementSheet';
import { normalizeElementFloorMode } from './normalizeFloorMode';
import { sortPlacedElementsByStack } from './sortPlacedElements';
import {
	smoothElementOverlayGeometry,
	tessellateAndWeldGeometry,
} from '../viewer/smoothOverlayGeometry';

// Every catalog element now ships a designed STL mesh, so all of them render
// and export from their real geometry (draped onto the insole). The thickness-
// only blob path is retained for any future element that has no STL, but no
// color is classified as thickness-only by default.
const THICKNESS_ONLY_COLORS = new Set<ElementColorGroup>([]);
const OVERLAY_ONLY_LIBRARY_KEYS = new Set([
	'rctb-1',
	'rctb-2',
	'rctb-3',
	'rctb-pronatie',
]);

export function isThicknessOnlyElement(
	item: { color?: ElementColorGroup } | null | undefined,
): boolean {
	return Boolean(item?.color && THICKNESS_ONLY_COLORS.has(item.color));
}

function isOverlayOnlyElement(
	item: { key?: string } | null | undefined,
): boolean {
	return Boolean(item?.key && OVERLAY_ONLY_LIBRARY_KEYS.has(item.key));
}

const stlMissWarnedKeys = new Set<string>();

function warnStlMissOnce(libraryKey: string): void {
	if (process.env.NODE_ENV === 'production') return;
	if (stlMissWarnedKeys.has(libraryKey)) return;
	stlMissWarnedKeys.add(libraryKey);
	console.warn(
		`Element overlay: STL not loaded for "${libraryKey}", using procedural fallback.`,
	);
}

function warnTrimFallbackOnce(elementId: string): void {
	if (process.env.NODE_ENV === 'production') return;
	console.warn(
		`Element overlay: trim removed all triangles for "${elementId}", keeping untrimmed geometry.`,
	);
}

/* ── helpers (same as insoleCorrections.ts) ──── */

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

function getGeometryAxes(geometry: THREE.BufferGeometry) {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const sizeX = bbox.max.x - bbox.min.x;
	const sizeY = bbox.max.y - bbox.min.y;
	const sizeZ = bbox.max.z - bbox.min.z;

	const sizes = [
		{ axis: 'x' as const, size: sizeX },
		{ axis: 'y' as const, size: sizeY },
		{ axis: 'z' as const, size: sizeZ },
	].sort((a, b) => b.size - a.size);

	return {
		lengthAxis: sizes[0].axis,
		widthAxis: sizes[1].axis,
		heightAxis: sizes[2].axis,
		bbox,
		lengthSpan: sizes[0].size,
		widthSpan: sizes[1].size,
		heightSpan: sizes[2].size,
	};
}

function getAxisValue(
	positions: THREE.BufferAttribute,
	i: number,
	axis: string,
): number {
	if (axis === 'x') return positions.getX(i);
	if (axis === 'y') return positions.getY(i);
	return positions.getZ(i);
}

function setAxisValue(
	positions: THREE.BufferAttribute,
	i: number,
	axis: string,
	value: number,
): void {
	if (axis === 'x') positions.setX(i, value);
	else if (axis === 'y') positions.setY(i, value);
	else positions.setZ(i, value);
}

function getMinForAxis(bbox: THREE.Box3, axis: string): number {
	if (axis === 'x') return bbox.min.x;
	if (axis === 'y') return bbox.min.y;
	return bbox.min.z;
}

function getMaxForAxis(bbox: THREE.Box3, axis: string): number {
	if (axis === 'x') return bbox.max.x;
	if (axis === 'y') return bbox.max.y;
	return bbox.max.z;
}

/* ── point-in-polygon (2D, winding number) ──── */

type PreparedPolygonEdge = {
	ax: number;
	ay: number;
	bx: number;
	by: number;
	dx: number;
	dy: number;
	len2: number;
};

type PreparedPolygon = {
	points: [number, number][];
	edges: PreparedPolygonEdge[];
};

function preparePolygon(points: [number, number][]): PreparedPolygon {
	const edges: PreparedPolygonEdge[] = [];
	const n = points.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const ax = points[i][0];
		const ay = points[i][1];
		const bx = points[j][0];
		const by = points[j][1];
		const dx = bx - ax;
		const dy = by - ay;
		edges.push({
			ax,
			ay,
			bx,
			by,
			dx,
			dy,
			len2: dx * dx + dy * dy,
		});
	}
	return { points, edges };
}

function measurePreparedPolygon(
	px: number,
	py: number,
	polygon: PreparedPolygon,
): { inside: boolean; edgeDist: number } {
	let inside = false;
	let minDistSq = Infinity;
	for (const edge of polygon.edges) {
		if (
			edge.ay > py !== edge.by > py &&
			px < (edge.dx * (py - edge.ay)) / (edge.by - edge.ay) + edge.ax
		) {
			inside = !inside;
		}
		let t =
			edge.len2 > 0
				? ((px - edge.ax) * edge.dx + (py - edge.ay) * edge.dy) / edge.len2
				: 0;
		t = Math.max(0, Math.min(1, t));
		const cx = edge.ax + t * edge.dx;
		const cy = edge.ay + t * edge.dy;
		const dx = px - cx;
		const dy = py - cy;
		const distSq = dx * dx + dy * dy;
		if (distSq < minDistSq) minDistSq = distSq;
	}
	return {
		inside,
		edgeDist: Math.sqrt(minDistSq),
	};
}

function pointInPolygon(
	px: number,
	py: number,
	polygon: [number, number][],
): boolean {
	return measurePreparedPolygon(px, py, preparePolygon(polygon)).inside;
}

function distToPolygonEdge(
	px: number,
	py: number,
	polygon: [number, number][],
): number {
	return measurePreparedPolygon(px, py, preparePolygon(polygon)).edgeDist;
}

/* ── profile height functions ────────────────── */

// ── Insole boundary clipping types ──────────────────────────────
/**
 * Describes a sampled insole boundary: at a given U (length) position,
 * what is the min and max V (width) extent of the insole.
 */
type InsoleBoundarySampler = (uNorm: number) => { minV: number; maxV: number };

function computeOutlineProfileWeight(
	u: number,
	v: number,
	outline: [number, number][],
	blendNorm: number,
	profile: ElementProfile,
): number {
	const { inside, edgeDist } = measurePreparedPolygon(u, v, preparePolygon(outline));

	if (inside) {
		if (blendNorm > 0.001) {
			const normEdgeDist = Math.min(edgeDist / blendNorm, 1);
			return profileMultiplier(profile, 1 - normEdgeDist);
		}
		return 1;
	}

	if (edgeDist >= blendNorm || blendNorm <= 0.001) return 0;
	const normEdgeDist = edgeDist / blendNorm;
	return profileMultiplier(profile, 1) * (1 - smoothstep(0, 1, normEdgeDist));
}

/**
 * Clamp a UV outline to the insole boundary.
 * Vertices outside the insole are snapped to the nearest edge.
 */
function clipOutlineToInsole(
	outline: [number, number][],
	sampler: InsoleBoundarySampler,
): [number, number][] {
	return outline.map(([u, v]) => {
		const uClamped = Math.max(0, Math.min(1, u));
		const { minV, maxV } = sampler(uClamped);
		const clampedV = Math.max(minV, Math.min(maxV, v));
		return [Math.max(0, Math.min(1, u)), clampedV] as [number, number];
	});
}

// ────────────────────────────────────────────────────────────────

/**
 * Given a normalised distance from centre (0 = centre, 1 = edge),
 * return a height multiplier based on the element profile.
 */
function profileMultiplier(profile: ElementProfile, normDist: number): number {
	const d = Math.max(0, Math.min(1, normDist));
	switch (profile) {
		case 'bol': // dome: smooth falloff from 1 at centre to 0 at edge
			return Math.cos((d * Math.PI) / 2);
		case 'vlak': // flat top with edge taper
			return d < 0.7 ? 1.0 : smoothstep(1, 0.7, d);
		case 'hol': // hollow: inverted dome (pocket)
			return Math.cos((d * Math.PI) / 2);
		case 'vloeiend': // smooth blend (wide taper)
			return 1.0 - d * d;
		default:
			return 1.0;
	}
}

/* ── transform outline points ────────────────── */

/**
 * Transform the normalised outline of a library element
 * into insole U,V space given the placed element's 2D transform.
 */
function transformOutline(
	outline: [number, number][],
	el: PlacedElement,
	/** Size of the element in U,V normalised space */
	elementSizeU: number,
	elementSizeV: number,
	mirrorWidth = false,
): [number, number][] {
	const cos = Math.cos(el.rotationRad);
	const sin = Math.sin(el.rotationRad);

	return outline.map(([ox, oy]) => {
		// Centre the outline at origin (-0.5..+0.5)
		const lx = (ox - 0.5) * elementSizeU * el.scaleU;
		let ly = (oy - 0.5) * elementSizeV * el.scaleV;
		if (mirrorWidth) {
			ly = -ly;
		}
		// Rotate
		const rx = lx * cos - ly * sin;
		const ry = lx * sin + ly * cos;
		// Translate to placement position
		return [el.positionU + rx, el.positionV + ry] as [number, number];
	});
}

type ResolvedElementLayout = {
	positionU: number;
	positionV: number;
	rotationRad: number;
	targetWidthMm?: number;
	targetLengthMm?: number;
	/**
	 * For full-width STL bars, remap each vertex's source width coordinate to the
	 * insole rim at that vertex's U slice instead of overshooting and clamping.
	 */
	conformWidthToInsole?: boolean;
	rctbLengthTaper?: boolean;
	heightProfile?: 'centerline' | 'rowFloor';
	/** Mirror the STL across the width axis (flip flat edge to opposite side) */
	mirrorWidth?: boolean;
};

type PlacementContext = {
	positions: THREE.BufferAttribute;
	vertexCount: number;
	lengthAxis: string;
	widthAxis: string;
	lengthMin: number;
	widthMin: number;
	lengthSpan: number;
	widthSpan: number;
	heelAtMin: boolean;
	mmToWorld: number;
	/** Insole width band [minV,maxV] at a normalised U (heel=0 → toe=1). */
	sampleInsoleExtent: (uNorm: number) => { minV: number; maxV: number };
	/** Heel wall extent (includes steep cup walls, not just the top footprint). */
	sampleInsoleHeelWallExtent?: (uNorm: number) => { minV: number; maxV: number };
	/** Insole length band [minU,maxU] at a normalised V. */
	sampleInsoleUExtent: (vNorm: number) => { minU: number; maxU: number };
};

function getEffectiveMirrorWidth(
	side: 'left' | 'right',
	mirrorWidth?: boolean,
) {
	return side === 'left' ? !Boolean(mirrorWidth) : Boolean(mirrorWidth);
}

type TopSurfaceHeightSamplerContext = {
	positions: THREE.BufferAttribute;
	normals: THREE.BufferAttribute;
	vertexCount: number;
	lengthAxis: string;
	widthAxis: string;
	heightAxis: string;
	lengthMin: number;
	widthMin: number;
	heightMin: number;
	heightSpan: number;
	lengthSpan: number;
	widthSpan: number;
	heelAtMin: boolean;
	gridSize?: number;
};

function buildTopSurfaceHeightSampler({
	positions,
	normals,
	vertexCount,
	lengthAxis,
	widthAxis,
	heightAxis,
	lengthMin,
	widthMin,
	heightMin,
	heightSpan,
	lengthSpan,
	widthSpan,
	heelAtMin,
	gridSize = 48,
}: TopSurfaceHeightSamplerContext): (u: number, v: number) => number {
	const normalIdx = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;
	const getNComp = (i: number): number => {
		if (normalIdx === 0) return normals.getX(i);
		if (normalIdx === 1) return normals.getY(i);
		return normals.getZ(i);
	};

	let signSum = 0;
	let signCount = 0;
	const topThresh = heightMin + heightSpan * 0.8;
	for (let i = 0; i < vertexCount; i++) {
		if (getAxisValue(positions, i, heightAxis) >= topThresh) {
			signSum += getNComp(i);
			signCount++;
		}
	}
	const upSign = signCount > 0 && signSum / signCount < 0 ? -1 : 1;

	const heightGrid = new Float32Array(gridSize * gridSize).fill(heightMin);
	for (let i = 0; i < vertexCount; i++) {
		if (getNComp(i) * upSign < 0.1) continue;
		const lv = getAxisValue(positions, i, lengthAxis);
		const wv = getAxisValue(positions, i, widthAxis);
		const hv = getAxisValue(positions, i, heightAxis);
		const rawU = (lv - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		const v = (wv - widthMin) / Math.max(widthSpan, 1e-6);
		const gu = Math.max(0, Math.min(gridSize - 1, Math.floor(u * gridSize)));
		const gv = Math.max(0, Math.min(gridSize - 1, Math.floor(v * gridSize)));
		const gridIndex = gu * gridSize + gv;
		if (hv > heightGrid[gridIndex]) heightGrid[gridIndex] = hv;
	}

	for (let pass = 0; pass < 4; pass++) {
		for (let gu = 0; gu < gridSize; gu++) {
			for (let gv = 0; gv < gridSize; gv++) {
				const gi = gu * gridSize + gv;
				if (heightGrid[gi] > heightMin) continue;
				let sum = 0;
				let count = 0;
				for (const [du, dv] of [
					[-1, 0],
					[1, 0],
					[0, -1],
					[0, 1],
				] as const) {
					const nu = gu + du;
					const nv = gv + dv;
					if (nu < 0 || nu >= gridSize || nv < 0 || nv >= gridSize) continue;
					const ni = nu * gridSize + nv;
					if (heightGrid[ni] > heightMin) {
						sum += heightGrid[ni];
						count++;
					}
				}
				if (count > 0) heightGrid[gi] = sum / count;
			}
		}
	}

	return (u: number, v: number): number => {
		const gu = Math.max(0, Math.min(gridSize - 0.001, u * gridSize));
		const gv = Math.max(0, Math.min(gridSize - 0.001, v * gridSize));
		const gui = Math.floor(gu);
		const gvi = Math.floor(gv);
		const guf = gu - gui;
		const gvf = gv - gvi;
		const gui1 = Math.min(gridSize - 1, gui + 1);
		const gvi1 = Math.min(gridSize - 1, gvi + 1);
		const h00 = heightGrid[gui * gridSize + gvi];
		const h10 = heightGrid[gui1 * gridSize + gvi];
		const h01 = heightGrid[gui * gridSize + gvi1];
		const h11 = heightGrid[gui1 * gridSize + gvi1];
		return (
			h00 * (1 - guf) * (1 - gvf) +
			h10 * guf * (1 - gvf) +
			h01 * (1 - guf) * gvf +
			h11 * guf * gvf
		);
	};
}

type GeometryAxes = ReturnType<typeof getGeometryAxes>;

type CachedInsoleOverlayAnalysis = {
	positionVersion: number;
	normalVersion: number;
	axes: GeometryAxes;
	lengthMin: number;
	widthMin: number;
	heightMin: number;
	heightSpan: number;
	heelAtMin: boolean;
	sampleHeight: (u: number, v: number) => number;
	sampleInsoleExtent: (uNorm: number) => { minV: number; maxV: number };
	sampleInsoleHeelWallExtent: (uNorm: number) => { minV: number; maxV: number };
	sampleInsoleUExtent: (vNorm: number) => { minU: number; maxU: number };
	getNormalComponent: (index: number) => number;
	upSign: number;
};

const insoleOverlayAnalysisCache = new WeakMap<
	THREE.BufferGeometry,
	CachedInsoleOverlayAnalysis
>();

function getPositionVersion(attribute: THREE.BufferAttribute | undefined) {
	return attribute?.version ?? 0;
}

function buildCachedInsoleOverlayAnalysis(
	insoleGeometry: THREE.BufferGeometry,
): CachedInsoleOverlayAnalysis {
	if (!insoleGeometry.getAttribute('normal')) {
		insoleGeometry.computeVertexNormals();
	}

	const axes = getGeometryAxes(insoleGeometry);
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } =
		axes;
	const lengthMin = getMinForAxis(bbox, lengthAxis);
	const widthMin = getMinForAxis(bbox, widthAxis);
	const heightMin = getMinForAxis(bbox, heightAxis);
	const heightMax = getMaxForAxis(bbox, heightAxis);
	const heightSpan = heightMax - heightMin;
	const heelAtMin = true;

	const positions = insoleGeometry.getAttribute(
		'position',
	) as THREE.BufferAttribute;
	const normals = insoleGeometry.getAttribute(
		'normal',
	) as THREE.BufferAttribute;
	const vertexCount = positions.count;
	const sampleHeight = buildTopSurfaceHeightSampler({
		positions,
		normals,
		vertexCount,
		lengthAxis,
		widthAxis,
		heightAxis,
		lengthMin,
		widthMin,
		heightMin,
		heightSpan,
		lengthSpan,
		widthSpan,
		heelAtMin,
	});

	const normalIdx = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;
	const getNormalComponent = (index: number): number => {
		if (normalIdx === 0) return normals.getX(index);
		if (normalIdx === 1) return normals.getY(index);
		return normals.getZ(index);
	};

	let signSum = 0;
	let signCount = 0;
	const topThresh = heightMin + heightSpan * 0.8;
	for (let i = 0; i < vertexCount; i++) {
		if (getAxisValue(positions, i, heightAxis) >= topThresh) {
			signSum += getNormalComponent(i);
			signCount++;
		}
	}
	const upSign = signCount > 0 && signSum / signCount < 0 ? -1 : 1;

	const BGRID = 96;
	const insoleOccupied = new Uint8Array(BGRID * BGRID);
	for (let i = 0; i < vertexCount; i++) {
		if (getNormalComponent(i) * upSign < 0.1) continue;
		const lv = getAxisValue(positions, i, lengthAxis);
		const wv = getAxisValue(positions, i, widthAxis);
		const rawU = (lv - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		const v = (wv - widthMin) / Math.max(widthSpan, 1e-6);
		const bu = Math.max(0, Math.min(BGRID - 1, Math.floor(u * BGRID)));
		const bv = Math.max(0, Math.min(BGRID - 1, Math.floor(v * BGRID)));
		insoleOccupied[bu * BGRID + bv] = 1;
	}

	const insoleMinVPerU = new Float32Array(BGRID).fill(1.0);
	const insoleMaxVPerU = new Float32Array(BGRID).fill(0.0);
	for (let bu = 0; bu < BGRID; bu++) {
		for (let bv = 0; bv < BGRID; bv++) {
			if (!insoleOccupied[bu * BGRID + bv]) continue;
			const vNorm = (bv + 0.5) / BGRID;
			if (vNorm < insoleMinVPerU[bu]) insoleMinVPerU[bu] = vNorm;
			if (vNorm > insoleMaxVPerU[bu]) insoleMaxVPerU[bu] = vNorm;
		}
	}
	for (let pass = 0; pass < 3; pass++) {
		for (let bu = 1; bu < BGRID - 1; bu++) {
			if (insoleMinVPerU[bu] > insoleMaxVPerU[bu]) {
				insoleMinVPerU[bu] = insoleMinVPerU[bu - 1];
				insoleMaxVPerU[bu] = insoleMaxVPerU[bu - 1];
			}
		}
	}
	for (let pass = 0; pass < 10; pass++) {
		const tmpMin = new Float32Array(insoleMinVPerU);
		const tmpMax = new Float32Array(insoleMaxVPerU);
		for (let bu = 1; bu < BGRID - 1; bu++) {
			if (tmpMin[bu] > tmpMax[bu]) continue;
			const prevOk = tmpMin[bu - 1] <= tmpMax[bu - 1];
			const nextOk = tmpMin[bu + 1] <= tmpMax[bu + 1];
			let wSum = 2;
			let minSum = tmpMin[bu] * 2;
			let maxSum = tmpMax[bu] * 2;
			if (prevOk) {
				minSum += tmpMin[bu - 1];
				maxSum += tmpMax[bu - 1];
				wSum += 1;
			}
			if (nextOk) {
				minSum += tmpMin[bu + 1];
				maxSum += tmpMax[bu + 1];
				wSum += 1;
			}
			insoleMinVPerU[bu] = minSum / wSum;
			insoleMaxVPerU[bu] = maxSum / wSum;
		}
	}

	// Heel wall extent: include steep cup-wall vertices so heel pads snap to the
	// actual sidewall, not the narrower top-surface footprint at the heel.
	const HEEL_WALL_U = 0.36;
	const heelWallOccupied = new Uint8Array(BGRID * BGRID);
	for (let i = 0; i < vertexCount; i++) {
		const lv = getAxisValue(positions, i, lengthAxis);
		const wv = getAxisValue(positions, i, widthAxis);
		const hv = getAxisValue(positions, i, heightAxis);
		const heightNorm = (hv - heightMin) / Math.max(heightSpan, 1e-6);
		if (heightNorm < 0.12) continue;
		const rawU = (lv - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		const upN = getNormalComponent(i) * upSign;
		if (u > HEEL_WALL_U) {
			if (upN < 0.1) continue;
		} else if (upN < -0.08) {
			continue;
		}
		const v = (wv - widthMin) / Math.max(widthSpan, 1e-6);
		const bu = Math.max(0, Math.min(BGRID - 1, Math.floor(u * BGRID)));
		const bv = Math.max(0, Math.min(BGRID - 1, Math.floor(v * BGRID)));
		heelWallOccupied[bu * BGRID + bv] = 1;
	}
	const insoleHeelWallMinVPerU = Float32Array.from(insoleMinVPerU);
	const insoleHeelWallMaxVPerU = Float32Array.from(insoleMaxVPerU);
	for (let bu = 0; bu < BGRID; bu++) {
		const uNorm = (bu + 0.5) / BGRID;
		if (uNorm > HEEL_WALL_U) continue;
		let hasWall = false;
		for (let bv = 0; bv < BGRID; bv++) {
			if (!heelWallOccupied[bu * BGRID + bv]) continue;
			hasWall = true;
			const vNorm = (bv + 0.5) / BGRID;
			if (vNorm < insoleHeelWallMinVPerU[bu]!) insoleHeelWallMinVPerU[bu] = vNorm;
			if (vNorm > insoleHeelWallMaxVPerU[bu]!) insoleHeelWallMaxVPerU[bu] = vNorm;
		}
		if (hasWall) {
			insoleHeelWallMinVPerU[bu] = Math.min(
				insoleHeelWallMinVPerU[bu]!,
				insoleMinVPerU[bu]!,
			);
			insoleHeelWallMaxVPerU[bu] = Math.max(
				insoleHeelWallMaxVPerU[bu]!,
				insoleMaxVPerU[bu]!,
			);
		}
	}
	for (let pass = 0; pass < 6; pass++) {
		const tmpMin = new Float32Array(insoleHeelWallMinVPerU);
		const tmpMax = new Float32Array(insoleHeelWallMaxVPerU);
		for (let bu = 1; bu < BGRID - 1; bu++) {
			if (tmpMin[bu]! > tmpMax[bu]!) continue;
			let wSum = 2;
			let minSum = tmpMin[bu]! * 2;
			let maxSum = tmpMax[bu]! * 2;
			if (tmpMin[bu - 1]! <= tmpMax[bu - 1]!) {
				minSum += tmpMin[bu - 1]!;
				maxSum += tmpMax[bu - 1]!;
				wSum += 1;
			}
			if (tmpMin[bu + 1]! <= tmpMax[bu + 1]!) {
				minSum += tmpMin[bu + 1]!;
				maxSum += tmpMax[bu + 1]!;
				wSum += 1;
			}
			insoleHeelWallMinVPerU[bu] = minSum / wSum;
			insoleHeelWallMaxVPerU[bu] = maxSum / wSum;
		}
	}

	const insoleMinUPerV = new Float32Array(BGRID).fill(1.0);
	const insoleMaxUPerV = new Float32Array(BGRID).fill(0.0);
	for (let bv = 0; bv < BGRID; bv++) {
		for (let bu = 0; bu < BGRID; bu++) {
			if (!insoleOccupied[bu * BGRID + bv]) continue;
			const uNorm = (bu + 0.5) / BGRID;
			if (uNorm < insoleMinUPerV[bv]) insoleMinUPerV[bv] = uNorm;
			if (uNorm > insoleMaxUPerV[bv]) insoleMaxUPerV[bv] = uNorm;
		}
	}
	for (let pass = 0; pass < 3; pass++) {
		for (let bv = 1; bv < BGRID - 1; bv++) {
			if (insoleMinUPerV[bv] > insoleMaxUPerV[bv]) {
				insoleMinUPerV[bv] = insoleMinUPerV[bv - 1];
				insoleMaxUPerV[bv] = insoleMaxUPerV[bv - 1];
			}
		}
	}
	for (let pass = 0; pass < 10; pass++) {
		const tmpMin = new Float32Array(insoleMinUPerV);
		const tmpMax = new Float32Array(insoleMaxUPerV);
		for (let bv = 1; bv < BGRID - 1; bv++) {
			if (tmpMin[bv] > tmpMax[bv]) continue;
			const prevOk = tmpMin[bv - 1] <= tmpMax[bv - 1];
			const nextOk = tmpMin[bv + 1] <= tmpMax[bv + 1];
			let wSum = 2;
			let minSum = tmpMin[bv] * 2;
			let maxSum = tmpMax[bv] * 2;
			if (prevOk) {
				minSum += tmpMin[bv - 1];
				maxSum += tmpMax[bv - 1];
				wSum += 1;
			}
			if (nextOk) {
				minSum += tmpMin[bv + 1];
				maxSum += tmpMax[bv + 1];
				wSum += 1;
			}
			insoleMinUPerV[bv] = minSum / wSum;
			insoleMaxUPerV[bv] = maxSum / wSum;
		}
	}

	const sampleInsoleUExtent = (
		vNorm: number,
	): { minU: number; maxU: number } => {
		const gv = Math.max(0, Math.min(BGRID - 1.001, vNorm * BGRID));
		const gvi = Math.floor(gv);
		const frac = gv - gvi;
		const gvi1 = Math.min(BGRID - 1, gvi + 1);
		return {
			minU: insoleMinUPerV[gvi] * (1 - frac) + insoleMinUPerV[gvi1] * frac,
			maxU: insoleMaxUPerV[gvi] * (1 - frac) + insoleMaxUPerV[gvi1] * frac,
		};
	};

	const sampleInsoleExtent = (
		uNorm: number,
	): { minV: number; maxV: number } => {
		const gu = Math.max(0, Math.min(BGRID - 1.001, uNorm * BGRID));
		const gui = Math.floor(gu);
		const frac = gu - gui;
		const gui1 = Math.min(BGRID - 1, gui + 1);
		return {
			minV: insoleMinVPerU[gui] * (1 - frac) + insoleMinVPerU[gui1] * frac,
			maxV: insoleMaxVPerU[gui] * (1 - frac) + insoleMaxVPerU[gui1] * frac,
		};
	};

	const sampleInsoleHeelWallExtent = (
		uNorm: number,
	): { minV: number; maxV: number } => {
		const gu = Math.max(0, Math.min(BGRID - 1.001, uNorm * BGRID));
		const gui = Math.floor(gu);
		const frac = gu - gui;
		const gui1 = Math.min(BGRID - 1, gui + 1);
		return {
			minV:
				insoleHeelWallMinVPerU[gui]! * (1 - frac) +
				insoleHeelWallMinVPerU[gui1]! * frac,
			maxV:
				insoleHeelWallMaxVPerU[gui]! * (1 - frac) +
				insoleHeelWallMaxVPerU[gui1]! * frac,
		};
	};

	return {
		positionVersion: getPositionVersion(positions),
		normalVersion: getPositionVersion(normals),
		axes,
		lengthMin,
		widthMin,
		heightMin,
		heightSpan,
		heelAtMin,
		sampleHeight,
		sampleInsoleExtent,
		sampleInsoleHeelWallExtent,
		sampleInsoleUExtent,
		getNormalComponent,
		upSign,
	};
}

function getCachedInsoleOverlayAnalysis(insoleGeometry: THREE.BufferGeometry) {
	const positions = insoleGeometry.getAttribute('position') as
		| THREE.BufferAttribute
		| undefined;
	const normals = insoleGeometry.getAttribute('normal') as
		| THREE.BufferAttribute
		| undefined;
	const positionVersion = getPositionVersion(positions);
	const normalVersion = getPositionVersion(normals);
	const cached = insoleOverlayAnalysisCache.get(insoleGeometry);
	if (
		cached &&
		cached.positionVersion === positionVersion &&
		cached.normalVersion === normalVersion
	) {
		return cached;
	}
	const next = buildCachedInsoleOverlayAnalysis(insoleGeometry);
	insoleOverlayAnalysisCache.set(insoleGeometry, next);
	return next;
}

function clamp01(value: number) {
	return Math.max(0, Math.min(1, value));
}

type TrimAdditiveOverlayGeometryOptions = {
	geometry: THREE.BufferGeometry;
	lengthAxis: string;
	widthAxis: string;
	heightAxis: string;
	lengthMin: number;
	widthMin: number;
	lengthSpan: number;
	widthSpan: number;
	heelAtMin: boolean;
	surfaceHeightSampler: (u: number, v: number) => number;
	epsilon: number;
};

function trimAdditiveOverlayGeometry({
	geometry,
	lengthAxis,
	widthAxis,
	heightAxis,
	lengthMin,
	widthMin,
	lengthSpan,
	widthSpan,
	heelAtMin,
	surfaceHeightSampler,
	epsilon,
}: TrimAdditiveOverlayGeometryOptions): THREE.BufferGeometry | null {
	const positions = geometry.getAttribute('position') as
		| THREE.BufferAttribute
		| undefined;
	if (!positions || positions.count < 3) return null;

	const visibleVertices = new Uint8Array(positions.count);
	const invLengthSpan = 1 / Math.max(lengthSpan, 1e-6);
	const invWidthSpan = 1 / Math.max(widthSpan, 1e-6);
	const triA = new THREE.Vector3();
	const triB = new THREE.Vector3();
	const triC = new THREE.Vector3();
	const edgeAB = new THREE.Vector3();
	const edgeAC = new THREE.Vector3();
	const cross = new THREE.Vector3();
	const degenerateArea = Math.max(epsilon * epsilon * 0.02, 1e-10);

	for (let i = 0; i < positions.count; i++) {
		const worldLength = getAxisValue(positions, i, lengthAxis);
		const worldWidth = getAxisValue(positions, i, widthAxis);
		const rawU = (worldLength - lengthMin) * invLengthSpan;
		const sampleU = clamp01(heelAtMin ? rawU : 1 - rawU);
		const sampleV = clamp01((worldWidth - widthMin) * invWidthSpan);
		const surfaceHeight = surfaceHeightSampler(sampleU, sampleV);
		const currentHeight = getAxisValue(positions, i, heightAxis);

		if (currentHeight <= surfaceHeight + epsilon) {
			setAxisValue(positions, i, heightAxis, surfaceHeight + epsilon);
			continue;
		}

		visibleVertices[i] = 1;
	}

	positions.needsUpdate = true;

	const triangleArea = (a: number, b: number, c: number): number => {
		triA.fromBufferAttribute(positions, a);
		triB.fromBufferAttribute(positions, b);
		triC.fromBufferAttribute(positions, c);
		edgeAB.subVectors(triB, triA);
		edgeAC.subVectors(triC, triA);
		cross.crossVectors(edgeAB, edgeAC);
		return cross.length() * 0.5;
	};

	const index = geometry.getIndex();
	if (index) {
		const keptIndices: number[] = [];
		for (let i = 0; i < index.count; i += 3) {
			const a = index.getX(i);
			const b = index.getX(i + 1);
			const c = index.getX(i + 2);
			if (!visibleVertices[a] && !visibleVertices[b] && !visibleVertices[c])
				continue;
			if (triangleArea(a, b, c) <= degenerateArea) continue;
			keptIndices.push(a, b, c);
		}

		if (keptIndices.length < 3) return null;
		geometry.setIndex(keptIndices);
		return geometry;
	}

	const keptPositions: number[] = [];
	for (let i = 0; i < positions.count; i += 3) {
		const a = i;
		const b = i + 1;
		const c = i + 2;
		if (c >= positions.count) break;
		if (!visibleVertices[a] && !visibleVertices[b] && !visibleVertices[c])
			continue;
		if (triangleArea(a, b, c) <= degenerateArea) continue;
		keptPositions.push(
			positions.getX(a),
			positions.getY(a),
			positions.getZ(a),
			positions.getX(b),
			positions.getY(b),
			positions.getZ(b),
			positions.getX(c),
			positions.getY(c),
			positions.getZ(c),
		);
	}

	if (keptPositions.length < 9) return null;

	let trimmedGeometry = new THREE.BufferGeometry();
	trimmedGeometry.setAttribute(
		'position',
		new THREE.Float32BufferAttribute(keptPositions, 3),
	);
	// Merge coincident vertices so computeVertexNormals produces smooth (shared) normals
	// instead of flat per-face normals that cause a faceted look.
	try {
		trimmedGeometry = mergeVertices(trimmedGeometry, 0.001);
	} catch {
		/* keep unmerged if it fails */
	}
	return trimmedGeometry;
}

// ── Declarative element placement ───────────────────────────────────────────
//
// Each element is positioned by a small spec rather than a bespoke procedural
// layout. The real STL mesh footprint is honoured; we only decide where to
// anchor it on the insole, how wide it should be, and its base orientation.
//   - span  : stretch the mesh width to the insole width at that U band.
//   - toe   : derive a narrow band from the forefoot width (single-toe pads).
//   - native: keep the mesh's authored footprint (stlSizeMm); place at default.

type ElementWidthMode = 'span' | 'toe' | 'native';
type ElementEdgeSnap = 'none' | 'medial' | 'lateral';

type ElementPlacementSpec = {
	/** Base orientation in degrees (0 or 180); side-adjusted like defaults. */
	baseRotationDeg: number;
	widthMode: ElementWidthMode;
	edgeSnap: ElementEdgeSnap;
	/**
	 * Initial U anchor (heel=0 → toe=1). When set, the element is placed/profiled
	 * here (+ user drag). When omitted, the element keeps its authored default U.
	 */
	anchorU?: number;
	/** Multiplier applied to the profiled insole width (span mode). */
	widthFactor?: number;
	/** Fraction of insole width excluded from the medial side (span mode). */
	medialInsetFrac?: number;
	/** Fraction of forefoot width used as the pad width (toe mode). */
	toeWidthFrac?: number;
	/**
	 * Toe mode + medial snap: centre as fraction of forefoot width inward from medial rim.
	 */
	toeMedialCenterFrac?: number;
	/** Legacy inset; use toeMedialCenterFrac for medial snap. */
	toeInsetFrac?: number;
	/** Multiplier applied to the native mesh length. */
	lengthScale?: number;
	/**
	 * Span-band centre along V after medial inset: 0 = medial edge, 1 = lateral.
	 * Applied in a side-aware way (always toward the 5th-toe side).
	 */
	spanLateralCenterBias?: number;
	/**
	 * Extra rotation (rad) on top of baseRotationDeg; right foot uses −offset,
	 * left foot uses +offset.
	 */
	rotationOffsetRad?: number;
	/** Rotate toe pads to follow the insole rim tangent (medial wall). */
	alignRotationToRim?: boolean;
	/** Added to rim tangent (rad); default π/2 so the pad sits on the wall. */
	rimRotationOffsetRad?: number;
	/** Remap source mesh width to the insole rim at each vertex's U slice. */
	conformWidthToInsole?: boolean;
	/**
	 * Sin heel-to-toe height envelope for full-width RCTB pads. Disable for
	 * asymmetric shapes (e.g. RCTB Pronatie) that must keep the STL length profile.
	 */
	rctbLengthTaper?: boolean;
	/**
	 * `rowFloor` samples the lowest STL height per row (cup floor) so height adds
	 * uniform thickness instead of growing rim walls.
	 */
	heightProfile?: 'centerline' | 'rowFloor';
	/** Use the widest insole cross-section from anchorU over the element length. */
	spanWidthMaxOverLength?: boolean;
	/** Mirror the mesh across the width axis (flat edge to opposite side). */
	mirrorWidth?: boolean;
	/**
	 * STL center → medial wall edge as a fraction of source width (default 0.5).
	 * Asymmetric pads (e.g. SPSA) need a lower native fraction when mirrorWidth
	 * is false because the flat wall edge sits on max-X, not min-X.
	 */
	medialHalfWidthFrac?: number | { mirrored: number; native: number };
	/** Extra shift toward the medial rim after snap (mm); closes small wall gaps. */
	medialWallPushMm?: number;
	/**
	 * `heelForward` samples the rim from anchorU toward the toes (heel-wall pads).
	 * `lengthSpan` samples across the full native pad length (arch rails).
	 * Default samples the heelward end of the pad (mid-foot stabilisers).
	 */
	rimSnapBand?: 'heelEnd' | 'heelForward' | 'lengthSpan';
	/** Slide each length slice to the heel-wall rim (follows curved cups). */
	heelWallConform?: 'medial' | 'lateral';
	/** Extra mm shift toward the snapped wall after placement. */
	rimOutsetMm?: number;
	/** Perimeter melt for conformed overlays (default 10). */
	overlayEdgeFadeCells?: number;
};

const ELEMENT_PLACEMENT: Record<string, ElementPlacementSpec> = {
	// Forefoot skin pads spanning the full metatarsal width, heel/toe-flipped.
	'sd-1-5': {
		baseRotationDeg: 180,
		widthMode: 'span',
		edgeSnap: 'none',
		anchorU: 0.78,
		widthFactor: 1.2,
	},
	'sa-rechts-1-5': {
		baseRotationDeg: 180,
		widthMode: 'span',
		edgeSnap: 'none',
		anchorU: 0.78,
		widthFactor: 1.2,
	},
	// Met 2-5: metatarsals 2–5, centred in the band (not on the outer rim), ~30° diagonal.
	'sd-2-5': {
		baseRotationDeg: 180,
		widthMode: 'span',
		edgeSnap: 'none',
		anchorU: 0.8,
		medialInsetFrac: 0.22,
		// Lower = toward medial / screen-right on a top view (away from the outer edge).
		spanLateralCenterBias: 0.38,
		// Right foot gets −60° on top of 180° (30° on the opposite side from before).
		rotationOffsetRad: Math.PI / 3 + (3 * Math.PI) / 2,
	},
	// Big-toe pad: flush on medial wall, centre ~10% in from edge (competitor left insole).
	'sd-1': {
		baseRotationDeg: 0,
		widthMode: 'toe',
		edgeSnap: 'medial',
		anchorU: 0.82,
		toeWidthFrac: 0.35,
		toeMedialCenterFrac: 0.1,
	},
	'sa-recht-1': {
		baseRotationDeg: 0,
		widthMode: 'toe',
		edgeSnap: 'medial',
		anchorU: 0.82,
		toeWidthFrac: 0.33,
		toeMedialCenterFrac: 0.1,
		lengthScale: 0.6,
	},
	// Depth (inset) elements sit at their drop position with their native STL
	// footprint and carve a rounded pocket into the insole — no span/toe snapping,
	// so they behave like before the placement refactor.
	// Midfoot RCTB bars spanning the full width, heel/toe-flipped.
	'rctb-1': {
		baseRotationDeg: 180,
		widthMode: 'span',
		edgeSnap: 'none',
		anchorU: 0.45,
		widthFactor: 1.2,
		conformWidthToInsole: true,
	},
	'rctb-2': {
		baseRotationDeg: 180,
		widthMode: 'span',
		edgeSnap: 'none',
		anchorU: 0.45,
		widthFactor: 1.2,
		conformWidthToInsole: true,
	},
	'rctb-3': {
		baseRotationDeg: 180,
		widthMode: 'span',
		edgeSnap: 'none',
		anchorU: 0.45,
		widthFactor: 1.2,
		conformWidthToInsole: true,
	},
	'rctb-pronatie': {
		baseRotationDeg: 180,
		widthMode: 'span',
		edgeSnap: 'none',
		anchorU: 0.45,
		widthFactor: 1.2,
		conformWidthToInsole: true,
		rctbLengthTaper: false,
	},
	// Heel cup: span-fill to heel rim width; row-floor height so added mm is
	// uniform thickness on the cup floor, not taller sidewalls.
	'sc-bol': {
		baseRotationDeg: 180,
		widthMode: 'span',
		edgeSnap: 'none',
		anchorU: 0.08,
		widthFactor: 1.12,
		lengthScale: 1.1,
		conformWidthToInsole: true,
		rctbLengthTaper: false,
		heightProfile: 'rowFloor',
		spanWidthMaxOverLength: true,
	},
	// Native-footprint stabilisers placed at their authored default position.
	'spsa-vlak': {
		baseRotationDeg: 180,
		widthMode: 'native',
		edgeSnap: 'medial',
		anchorU: 0.22,
		medialHalfWidthFrac: { mirrored: 0.5, native: 0.234 },
		medialWallPushMm: 5,
	},
	// Lateral mirror of SPSA: mirrorWidth (Z) + same heel-toe flip as SPSA (180° X).
	'ppsa': {
		baseRotationDeg: 180,
		widthMode: 'native',
		edgeSnap: 'lateral',
		anchorU: 0.22,
		mirrorWidth: true,
		medialHalfWidthFrac: { mirrored: 0.45, native: 0.22 },
		medialWallPushMm: 8,
	},
	// Heel interior stabiliser: lateral wall hug from the heel anchor toward midfoot.
	'ppsi': {
		baseRotationDeg: 180,
		widthMode: 'native',
		edgeSnap: 'lateral',
		anchorU: 0.08,
		rimSnapBand: 'heelForward',
		heelWallConform: 'lateral',
		rimOutsetMm: 6,
		medialHalfWidthFrac: { mirrored: 0.54, native: 0.54 },
		medialWallPushMm: 0,
		overlayEdgeFadeCells: 3,
	},
	// Heel interior stabiliser: medial wall hug from the heel anchor toward midfoot.
	'spsi': {
		baseRotationDeg: 180,
		widthMode: 'native',
		edgeSnap: 'medial',
		anchorU: 0.08,
		rimSnapBand: 'heelForward',
		heelWallConform: 'medial',
		rimOutsetMm: 8,
		// Flat wall on max-X; left foot uses mirrored width flip (see getEffectiveMirrorWidth).
		medialHalfWidthFrac: { mirrored: 0.44, native: 0.57 },
		medialWallPushMm: 0,
		overlayEdgeFadeCells: 3,
	},
	// Arch rail: medial wall hug along the full pad length.
	'hai-vlak-2': {
		baseRotationDeg: 0,
		widthMode: 'native',
		edgeSnap: 'medial',
		anchorU: 0.45,
		rimSnapBand: 'lengthSpan',
		heelWallConform: 'medial',
		alignRotationToRim: true,
		rimRotationOffsetRad: 0,
		// Flat wall on max-X; left foot uses mirrored width flip.
		medialHalfWidthFrac: { mirrored: 0.74, native: 0.28 },
		rimOutsetMm: 13,
		medialWallPushMm: 5,
		overlayEdgeFadeCells: 4,
	},
	// Midfoot pelotte, native footprint, heel/toe-flipped.
	'peloitte-2': { baseRotationDeg: 180, widthMode: 'native', edgeSnap: 'none' },
};

type InsoleProfile = {
	minV: number;
	maxV: number;
	centerV: number;
	widthNorm: number;
	widthMm: number;
};

/** Profile the insole width band around a normalised U using the smoothed rim. */
function profileInsoleAtU(
	context: PlacementContext,
	u: number,
	halfBand = 0.03,
): InsoleProfile {
	const { sampleInsoleExtent, widthSpan, mmToWorld } = context;
	let minSum = 0;
	let maxSum = 0;
	let n = 0;
	for (const offset of [-halfBand, 0, halfBand]) {
		const cu = Math.max(0, Math.min(1, u + offset));
		const { minV, maxV } = sampleInsoleExtent(cu);
		if (maxV > minV) {
			minSum += minV;
			maxSum += maxV;
			n++;
		}
	}
	const minV = n > 0 ? minSum / n : 0.1;
	const maxV = n > 0 ? maxSum / n : 0.9;
	const widthNorm = Math.max(0.05, maxV - minV);
		return {
		minV,
		maxV,
		centerV: (minV + maxV) / 2,
		widthNorm,
		widthMm: (widthNorm * widthSpan) / Math.max(mmToWorld, 1e-6),
	};
}

/** Tangent angle (rad) of the insole rim at normalised U along the medial edge. */
function sampleRimTangentRad(
	context: PlacementContext,
	u: number,
	medialAtMin: boolean,
): number {
	const eps = 0.012;
	const u0 = Math.max(0, u - eps);
	const u1 = Math.min(1, u + eps);
	const { sampleInsoleExtent, widthSpan, lengthSpan } = context;
	const v0 = medialAtMin
		? sampleInsoleExtent(u0).minV
		: sampleInsoleExtent(u0).maxV;
	const v1 = medialAtMin
		? sampleInsoleExtent(u1).minV
		: sampleInsoleExtent(u1).maxV;
	const du = u1 - u0;
	const dv = v1 - v0;
	if (Math.abs(du) < 1e-8) return 0;
	return Math.atan2(dv * widthSpan, du * lengthSpan);
}

function resolveMedialHalfWidthFrac(
	spec: ElementPlacementSpec,
	effectiveMirrorWidth: boolean,
): number {
	const frac = spec.medialHalfWidthFrac;
	if (frac === undefined) return 0.5;
	if (typeof frac === 'number') return frac;
	return effectiveMirrorWidth ? frac.mirrored : frac.native;
}

type InsoleExtentSampler = (
	uNorm: number,
) => { minV: number; maxV: number };

/** Most medial rim V along a U interval (tightest wall hug for curved heels). */
function sampleExtremalMedialRimV(
	context: PlacementContext,
	uStart: number,
	uEnd: number,
	medialAtMin: boolean,
	extentAtU: InsoleExtentSampler = context.sampleInsoleExtent,
): number {
	const lo = Math.max(0, Math.min(uStart, uEnd));
	const hi = Math.min(1, Math.max(uStart, uEnd));
	const steps = 8;
	let medialV = medialAtMin ? 1 : 0;
	for (let i = 0; i <= steps; i++) {
		const u = lo + ((hi - lo) * i) / steps;
		const { minV, maxV } = extentAtU(u);
		if (medialAtMin) medialV = Math.min(medialV, minV);
		else medialV = Math.max(medialV, maxV);
	}
	return medialV;
}

/** Outermost lateral rim V along a U interval. */
function sampleExtremalLateralRimV(
	context: PlacementContext,
	uStart: number,
	uEnd: number,
	medialAtMin: boolean,
	extentAtU: InsoleExtentSampler = context.sampleInsoleExtent,
): number {
	const lo = Math.max(0, Math.min(uStart, uEnd));
	const hi = Math.min(1, Math.max(uStart, uEnd));
	const steps = 8;
	let lateralV = medialAtMin ? 0 : 1;
	for (let i = 0; i <= steps; i++) {
		const u = lo + ((hi - lo) * i) / steps;
		const { minV, maxV } = extentAtU(u);
		if (medialAtMin) lateralV = Math.max(lateralV, maxV);
		else lateralV = Math.min(lateralV, minV);
	}
	return lateralV;
}

/** Native pad snapped flush to the medial or lateral insole rim. */
function resolveNativeRimSnapV(
	context: PlacementContext,
	spec: ElementPlacementSpec,
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	positionU: number,
	rim: 'medial' | 'lateral',
): number {
	const medialAtMin = el.side === 'right';
	const rimAtMin = rim === 'medial' ? medialAtMin : !medialAtMin;
	const effectiveMirrorWidth = getEffectiveMirrorWidth(el.side, spec.mirrorWidth);
	const wallFrac = resolveMedialHalfWidthFrac(spec, effectiveMirrorWidth);
	const nativeLengthMm = item?.stlSizeMm?.[1] ?? 50;
	const { uStart, uEnd } = resolveRimSnapUBand(
		context,
		spec,
		nativeLengthMm,
		positionU,
		medialAtMin,
	);
	const extentAtU =
		spec.rimSnapBand === 'heelForward' && context.sampleInsoleHeelWallExtent
			? context.sampleInsoleHeelWallExtent
			: context.sampleInsoleExtent;
	const rimV =
		rim === 'medial'
			? sampleExtremalMedialRimV(
					context,
					uStart,
					uEnd,
					medialAtMin,
					extentAtU,
				)
			: sampleExtremalLateralRimV(
					context,
					uStart,
					uEnd,
					medialAtMin,
					extentAtU,
				);
	const nativeWidthMm = item?.stlSizeMm?.[0] ?? 50;
	const wallHalfWidthNorm =
		(nativeWidthMm * wallFrac * context.mmToWorld) /
		Math.max(context.widthSpan, 1e-6);
	const wallPushNorm =
		(spec.medialWallPushMm ?? 0) *
		context.mmToWorld /
		Math.max(context.widthSpan, 1e-6);
	let snappedV = rimAtMin
		? rimV + wallHalfWidthNorm
		: rimV - wallHalfWidthNorm;
	if (wallPushNorm !== 0) {
		// Medial: push toward the medial wall; lateral: inset toward foot center.
		const towardRim = rimAtMin ? -wallPushNorm : wallPushNorm;
		snappedV += rim === 'medial' ? towardRim : -towardRim;
	}
	const outsetNorm =
		(spec.rimOutsetMm ?? 0) *
		context.mmToWorld /
		Math.max(context.widthSpan, 1e-6);
	if (outsetNorm !== 0) {
		snappedV += rimAtMin ? -outsetNorm : outsetNorm;
	}
	return clamp01(snappedV);
}

/** Lateral shift so each U slice hugs a curved heel wall. */
function heelWallWidthWorldDelta(
	lengthWorld: number,
	lengthMin: number,
	lengthSpan: number,
	widthSpan: number,
	heelAtMin: boolean,
	centrePositionU: number,
	rim: 'medial' | 'lateral',
	side: 'left' | 'right',
	extentAtU: InsoleExtentSampler,
): number {
	const rawUCell = (lengthWorld - lengthMin) / Math.max(lengthSpan, 1e-6);
	const uCell = heelAtMin ? rawUCell : 1 - rawUCell;
	const medialAtMin = side === 'right';
	const rimAtMin = rim === 'medial' ? medialAtMin : !medialAtMin;
	const extCell = extentAtU(uCell);
	const extCentre = extentAtU(centrePositionU);
	const rimCell = rimAtMin ? extCell.minV : extCell.maxV;
	const rimCentre = rimAtMin ? extCentre.minV : extCentre.maxV;
	return (rimCell - rimCentre) * widthSpan;
}

/** Per-U lateral shift so heel pads follow a curved cup wall. */
function buildHeelWallWidthAdjust(
	spec: ElementPlacementSpec | undefined,
	context: PlacementContext,
	el: PlacedElement,
	centrePositionU: number,
): ((lengthWorld: number) => number) | undefined {
	if (!spec?.heelWallConform) return undefined;
	const extentAtU =
		spec.rimSnapBand === 'heelForward' && context.sampleInsoleHeelWallExtent
			? context.sampleInsoleHeelWallExtent
			: context.sampleInsoleExtent;
	return (lengthWorld: number) =>
		heelWallWidthWorldDelta(
			lengthWorld,
			context.lengthMin,
			context.lengthSpan,
			context.widthSpan,
			context.heelAtMin,
			centrePositionU,
			spec.heelWallConform!,
			el.side,
			extentAtU,
		);
}

/** U interval for rim sampling on native wall-snapped pads. */
function resolveRimSnapUBand(
	context: PlacementContext,
	spec: ElementPlacementSpec,
	lengthMm: number,
	positionU: number,
	heelAtMin: boolean,
): { uStart: number; uEnd: number } {
	const lengthNorm =
		(lengthMm * context.mmToWorld) / Math.max(context.lengthSpan, 1e-6);
	if (spec.rimSnapBand === 'heelForward') {
		return heelAtMin
			? { uStart: positionU, uEnd: clamp01(positionU + lengthNorm) }
			: { uStart: clamp01(positionU - lengthNorm), uEnd: positionU };
	}
	if (spec.rimSnapBand === 'lengthSpan') {
		const halfLengthNorm = lengthNorm / 2;
		return {
			uStart: clamp01(positionU - halfLengthNorm),
			uEnd: clamp01(positionU + halfLengthNorm),
		};
	}
	const halfLengthNorm = lengthNorm / 2;
	if (spec.baseRotationDeg !== 180 || spec.anchorU === undefined) {
		return { uStart: positionU, uEnd: positionU };
	}
	const snapU = heelAtMin
		? Math.max(0.02, positionU - halfLengthNorm)
		: Math.min(0.98, positionU + halfLengthNorm);
	return heelAtMin
		? { uStart: snapU, uEnd: positionU }
		: { uStart: positionU, uEnd: snapU };
}

function resolveElementLayout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
): ResolvedElementLayout {
	const spec = item?.key ? ELEMENT_PLACEMENT[item.key] : undefined;
	if (!spec) {
		return {
			positionU: el.positionU,
			positionV: el.positionV,
			rotationRad: el.rotationRad,
		};
	}

	const defaults = getDefaultPlacementForSide(item, el.side);
	const deltaU = el.positionU - defaults.positionU;
	const deltaV = el.positionV - defaults.positionV;
	const deltaRotation = el.rotationRad - defaults.rotationRad;

	const baseRad = (spec.baseRotationDeg * Math.PI) / 180;
	const sideBaseRad = el.side === 'right' ? baseRad : -baseRad;
	const rotOff = spec.rotationOffsetRad ?? 0;
	const sideRotOff = el.side === 'right' ? -rotOff : rotOff;
	let rotationRad = sideBaseRad + sideRotOff + deltaRotation;

	// Right foot: medial = low V (big-toe / arch side). Left foot mirrors.
	const medialAtMin = el.side === 'right';

	// Base U: pinned to the spec anchor (+ drag) when given, else authored U.
	const positionU =
		spec.anchorU !== undefined
			? clamp01(spec.anchorU + deltaU)
			: clamp01(el.positionU);

	if (spec.widthMode === 'native') {
		const rimSnap =
			spec.edgeSnap === 'medial' || spec.edgeSnap === 'lateral'
				? spec.edgeSnap
				: null;
		const positionV = rimSnap
			? resolveNativeRimSnapV(context, spec, item, el, positionU, rimSnap)
			: clamp01(el.positionV);
		if (spec.alignRotationToRim) {
			const rimTan = sampleRimTangentRad(context, positionU, medialAtMin);
			const rimOffset = spec.rimRotationOffsetRad ?? 0;
			const sideRimOffset = medialAtMin ? rimOffset : -rimOffset;
			rotationRad = rimTan + sideRimOffset + deltaRotation;
		}
		return {
			positionU: spec.anchorU !== undefined ? positionU : clamp01(el.positionU),
			positionV: clamp01(positionV + (rimSnap ? 0 : deltaV)),
			rotationRad,
			conformWidthToInsole: spec.conformWidthToInsole,
			mirrorWidth: spec.mirrorWidth,
		};
	}

	const profile = profileInsoleAtU(context, positionU);
	const nativeLengthMm = item?.stlSizeMm?.[1] ?? 50;
	const targetLengthMm = nativeLengthMm * (spec.lengthScale ?? 1);

	if (spec.widthMode === 'toe') {
		const toeWidthMm = Math.max(
			12,
			profile.widthMm * (spec.toeWidthFrac ?? 0.22),
		);
		const halfWidthNorm =
			(toeWidthMm * context.mmToWorld) /
			Math.max(context.widthSpan, 1e-6) /
			2;
		const rim = context.sampleInsoleExtent(positionU);
		const medialV = medialAtMin ? rim.minV : rim.maxV;
		let positionV: number;
		if (spec.edgeSnap === 'medial') {
			const centreFrac =
				spec.toeMedialCenterFrac ?? spec.toeInsetFrac ?? 0.1;
			const centreInset = profile.widthNorm * centreFrac;
			positionV = medialAtMin
				? medialV + centreInset
				: medialV - centreInset;
		} else {
			positionV = profile.centerV;
		}

		if (spec.alignRotationToRim) {
			const rimTan = sampleRimTangentRad(context, positionU, medialAtMin);
			const rimOffset = spec.rimRotationOffsetRad ?? 0;
			const sideRimOffset = medialAtMin ? rimOffset : -rimOffset;
			rotationRad = rimTan + sideRimOffset + deltaRotation;
		}

		return {
			positionU,
			positionV: clamp01(positionV + deltaV),
			rotationRad,
			targetWidthMm: toeWidthMm,
			targetLengthMm,
			conformWidthToInsole: spec.conformWidthToInsole,
			mirrorWidth: spec.mirrorWidth,
		};
	}

	// span mode — width from the insole rim at this U (not an averaged profile band)
	const medialInset = spec.medialInsetFrac ?? 0;
	const lengthNorm =
		(targetLengthMm * context.mmToWorld) /
		Math.max(context.lengthSpan, 1e-6);
	const halfLengthNorm = lengthNorm * 0.5;
	const uBandStart = clamp01(positionU - halfLengthNorm);
	const uBandEnd = clamp01(positionU + halfLengthNorm);
	let lo = 1;
	let hi = 0;
	if (spec.spanWidthMaxOverLength) {
		const steps = 12;
		for (let s = 0; s <= steps; s++) {
			const u = uBandStart + ((uBandEnd - uBandStart) * s) / steps;
			const rim = context.sampleInsoleExtent(u);
			let bandLo = rim.minV;
			let bandHi = rim.maxV;
			if (medialInset > 0) {
				const inset = (bandHi - bandLo) * medialInset;
				if (medialAtMin) bandLo += inset;
				else bandHi -= inset;
			}
			if (bandHi - bandLo > hi - lo) {
				lo = bandLo;
				hi = bandHi;
			}
		}
	} else {
		const rimAtU = context.sampleInsoleExtent(positionU);
		lo = rimAtU.minV;
		hi = rimAtU.maxV;
		if (medialInset > 0) {
			const inset = (hi - lo) * medialInset;
			if (medialAtMin) lo += inset;
			else hi -= inset;
		}
	}
	const spanWidthMm = Math.max(
		20,
		(((hi - lo) * context.widthSpan) / Math.max(context.mmToWorld, 1e-6)) *
			(spec.widthFactor ?? 1),
	);
	const spanBias = spec.spanLateralCenterBias ?? 0.5;
	const spanCenterV = medialAtMin
		? lo + (hi - lo) * spanBias
		: lo + (hi - lo) * (1 - spanBias);
	return {
		positionU,
		positionV: clamp01(spanCenterV + deltaV),
		rotationRad,
		targetWidthMm: spanWidthMm,
		targetLengthMm,
		conformWidthToInsole: spec.conformWidthToInsole,
		rctbLengthTaper: spec.rctbLengthTaper ?? true,
		heightProfile: spec.heightProfile,
		mirrorWidth: spec.mirrorWidth,
	};
}

function getElementFootprintUv(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	metrics: { lengthSpan: number; widthSpan: number; mmToWorld: number },
	resolved?: ResolvedElementLayout,
) {
	const { lengthSpan, widthSpan, mmToWorld } = metrics;
	const widthMm = resolved?.targetWidthMm ?? item?.stlSizeMm?.[0];
	const lengthMm = resolved?.targetLengthMm ?? item?.stlSizeMm?.[1];

	const sizeU = lengthMm
		? (lengthMm * mmToWorld) / Math.max(lengthSpan, 1e-6)
		: 0.18;
	const sizeV = widthMm
		? (widthMm * mmToWorld) / Math.max(widthSpan, 1e-6)
		: 0.22;

	return {
		elementSizeU: sizeU,
		elementSizeV: sizeV,
	};
}

/**
 * Precomputed transform for raising the insole top surface from an additive
 * element's STL height field (export path; mirrors the on-screen overlay drape).
 */
interface PreparedStlDisplacement {
	field: ElementStlHeightField;
	scaleWidth: number;
	scaleLength: number;
	scaleHeight: number;
	cos: number;
	sin: number;
	centreLengthWorld: number;
	centreWidthWorld: number;
	stlCenterX: number;
	stlCenterY: number;
	rejectRadius: number;
	spanFillWidth: boolean;
	footprintX: FootprintXExtent;
	targetWidthWorld: number;
	targetLengthWorld: number;
	profilePeakMm: number;
	targetHeightMm: number;
	rctbLengthTaper: boolean;
	heightProfile?: 'centerline' | 'rowFloor';
	cupFill: boolean;
	rowCenterProfile: Float32Array | null;
	/** Lateral shift added to centreWidthWorld at each length slice (curved heel wall). */
	heelWallWidthAdjust?: (lengthWorld: number) => number;
}

/* ── main entry point ────────────────────────── */

/**
 * Apply all placed orthotic elements for a given side
 * to the insole geometry. Mutates geometry in-place.
 *
 * Call this AFTER applyAllCorrections in the pipeline.
 */
export function applyElements(
	geometry: THREE.BufferGeometry,
	elements: PlacedElement[],
	options?: {
		mmToWorld?: number;
		/**
		 * Pre-loaded element STL geometries keyed by URL. When provided, additive
		 * STL-backed elements raise the insole top surface from the STL's own height
		 * field. The visible/export overlay path uses buildElementOverlayGeometries
		 * for exact conformed pad meshes.
		 */
		stlGeometries?: Map<string, THREE.BufferGeometry>;
	},
): void {
	if (!elements || elements.length === 0) return;

	const sortedElements = sortPlacedElementsByStack(elements);
	const mmToWorld = options?.mmToWorld ?? 1;
	const stlGeometries = options?.stlGeometries;
	const geometryAnalysis = getCachedInsoleOverlayAnalysis(geometry);
	const {
		axes,
		lengthMin,
		widthMin,
		heightMin,
		heightSpan,
		heelAtMin,
		sampleHeight: sampleSurfaceHeight,
	} = geometryAnalysis;
	const { lengthAxis, widthAxis, heightAxis, lengthSpan, widthSpan } = axes;
	const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
	const vertexCount = positions.count;
	if (!geometry.getAttribute('normal')) {
		geometry.computeVertexNormals();
	}

	// Height-axis normal helper so depth (inset) elements can be restricted to the
	// top surface. "up" sign is inferred from the average normal of the highest
	// vertices, matching applyElementColors.
	const elementNormals = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
	const heightNormalIdx = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;
	const rawHeightNormal = (i: number): number => {
		if (!elementNormals) return 1;
		if (heightNormalIdx === 0) return elementNormals.getX(i);
		if (heightNormalIdx === 1) return elementNormals.getY(i);
		return elementNormals.getZ(i);
	};
	let normalSignSum = 0;
	let normalSignCount = 0;
	const topAltitudeThresh = heightMin + (heightSpan || 1) * 0.8;
	for (let i = 0; i < vertexCount; i++) {
		if (getAxisValue(positions, i, heightAxis) >= topAltitudeThresh) {
			normalSignSum += rawHeightNormal(i);
			normalSignCount++;
		}
	}
	const upSign = normalSignCount > 0 && normalSignSum / normalSignCount < 0 ? -1 : 1;
	const getHeightNormal = (i: number): number => rawHeightNormal(i) * upSign;
	/** Inset elements only carve top-facing vertices above this upward component. */
	const TOP_FACING_MIN = 0.15;

	// Precompute transformed outlines and bounding boxes for each element
	const prepared = sortedElements.map((el) => {
		const floorMode = normalizeElementFloorMode(el.floorMode);
		const item = getElementByKey(el.libraryKey);
		const resolved = resolveElementLayout(item, el, {
			positions,
			vertexCount,
			lengthAxis,
			widthAxis,
			lengthMin,
			widthMin,
			lengthSpan,
			widthSpan,
			heelAtMin,
			mmToWorld,
			sampleInsoleExtent: geometryAnalysis.sampleInsoleExtent,
			sampleInsoleHeelWallExtent: geometryAnalysis.sampleInsoleHeelWallExtent,
			sampleInsoleUExtent: geometryAnalysis.sampleInsoleUExtent,
		});
		const resolvedElement = {
			...el,
			positionU: resolved.positionU,
			positionV: resolved.positionV,
			rotationRad: resolved.rotationRad,
		};
		const effectiveMirrorWidth = getEffectiveMirrorWidth(
			el.side,
			resolved.mirrorWidth,
		);
		const outline = item?.outline ?? [[0, 0] as [number, number]];
		const { elementSizeU, elementSizeV } = getElementFootprintUv(
			item,
			el,
			{
				lengthSpan,
				widthSpan,
				mmToWorld,
			},
			resolved,
		);
		const transformed = transformOutline(
			outline,
			resolvedElement,
			elementSizeU,
			elementSizeV,
			effectiveMirrorWidth,
		);
		const polygon = preparePolygon(transformed);

		// Bounding box for early reject
		let minU = Infinity,
			maxU = -Infinity,
			minV = Infinity,
			maxV = -Infinity;
		for (const [u, v] of transformed) {
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}

		// Blend zone in normalised space
		const blendU = (el.blendMm * mmToWorld) / lengthSpan;
		const blendV = (el.blendMm * mmToWorld) / widthSpan;
		const blendNorm = Math.max(blendU, blendV);
		const heightWorld = el.heightMm * mmToWorld;
		const baseSurfaceHeight =
			heightWorld > 0 && floorMode !== 'sole'
				? sampleSurfaceHeight(resolved.positionU, resolved.positionV)
				: undefined;

		// Additive STL-backed elements raise the insole top from the STL height
		// field (matches the overlay drape); insets and thickness-only elements keep
		// the procedural outline path below.
		let stl: PreparedStlDisplacement | undefined;
		if (
			item &&
			stlGeometries &&
			el.heightMm > 0 &&
			!isThicknessOnlyElement(item) &&
			!isOverlayOnlyElement(item)
		) {
			const overlayStlUrl = getElementViewerStlUrls(item).find((url) =>
				stlGeometries.has(url),
			);
			const srcGeom = overlayStlUrl
				? stlGeometries.get(overlayStlUrl)
				: undefined;
			if (srcGeom) {
				const field = getElementStlHeightField(
					srcGeom,
					Boolean(item.stlSwapYZ),
				);
				const targetWidthMm =
					(resolved.targetWidthMm ?? item.stlSizeMm?.[0] ?? field.sourceWidthMm) *
					el.scaleV;
				const targetLengthMm =
					(resolved.targetLengthMm ??
						item.stlSizeMm?.[1] ??
						field.sourceLengthMm) * el.scaleU;
				const targetHeightMm = Math.max(0.2, Math.abs(el.heightMm));
				let scaleWidth = (targetWidthMm * mmToWorld) / field.sourceWidthMm;
				if (getEffectiveMirrorWidth(el.side, resolved.mirrorWidth))
					scaleWidth = -scaleWidth;
				const spanFillWidth = Boolean(resolved.conformWidthToInsole);
				const footprintX = getFootprintXExtent(field);
				const targetWidthWorld = targetWidthMm * mmToWorld;
				const targetLengthWorld = targetLengthMm * mmToWorld;
				const centreRawU = heelAtMin
					? resolved.positionU
					: 1 - resolved.positionU;
				const halfW = targetWidthWorld / 2;
				const halfL = (targetLengthMm * mmToWorld) / 2;
				const placementSpec = item?.key
					? ELEMENT_PLACEMENT[item.key]
					: undefined;
				const placementCtx: PlacementContext = {
					positions,
					vertexCount,
					lengthAxis,
					widthAxis,
					lengthMin,
					widthMin,
					lengthSpan,
					widthSpan,
					heelAtMin,
					mmToWorld,
					sampleInsoleExtent: geometryAnalysis.sampleInsoleExtent,
					sampleInsoleHeelWallExtent:
						geometryAnalysis.sampleInsoleHeelWallExtent,
					sampleInsoleUExtent: geometryAnalysis.sampleInsoleUExtent,
				};
				stl = {
					field,
					scaleWidth,
					scaleLength: (targetLengthMm * mmToWorld) / field.sourceLengthMm,
					scaleHeight: (targetHeightMm * mmToWorld) / field.sourceHeightMm,
					cos: Math.cos(resolved.rotationRad),
					sin: Math.sin(resolved.rotationRad),
					centreLengthWorld: lengthMin + centreRawU * lengthSpan,
					centreWidthWorld: widthMin + resolved.positionV * widthSpan,
					stlCenterX: field.stlCenterX,
					stlCenterY: field.stlCenterY,
					rejectRadius: Math.hypot(halfW, halfL) * 1.06,
					spanFillWidth,
					footprintX,
					targetWidthWorld,
					targetLengthWorld,
					profilePeakMm:
						resolved.heightProfile === 'rowFloor'
							? getRowFloorProfilePeakMm(field)
							: getCenterlineProfilePeakMm(field, footprintX),
					targetHeightMm,
					rctbLengthTaper: resolved.rctbLengthTaper ?? true,
					heightProfile: resolved.heightProfile,
					cupFill: resolved.heightProfile === 'rowFloor',
					rowCenterProfile: buildFootprintRowCenterProfile(field),
					heelWallWidthAdjust: buildHeelWallWidthAdjust(
						placementSpec,
						placementCtx,
						el,
						resolved.positionU,
					),
				};
			}
		}

		// Cup-fill elements: build a heel-to-toe rim-height ceiling (max insole top
		// height across the footprint at each U slice) so the floor fill can be
		// clamped to never rise above the surrounding insole wall.
		let cupRimCeiling: Float32Array | null = null;
		if (stl?.cupFill) {
			const BINS = 64;
			cupRimCeiling = new Float32Array(BINS).fill(-Infinity);
			for (let vi = 0; vi < vertexCount; vi++) {
				const lv = getAxisValue(positions, vi, lengthAxis);
				const wv = getAxisValue(positions, vi, widthAxis);
				const rawUu = (lv - lengthMin) / lengthSpan;
				const uu = heelAtMin ? rawUu : 1 - rawUu;
				const vv = (wv - widthMin) / widthSpan;
				if (uu < minU || uu > maxU || vv < minV || vv > maxV) continue;
				const hv = getAxisValue(positions, vi, heightAxis);
				const t = (uu - minU) / Math.max(maxU - minU, 1e-6);
				const b = Math.min(BINS - 1, Math.max(0, Math.floor(t * BINS)));
				if (hv > cupRimCeiling[b]!) cupRimCeiling[b] = hv;
			}
			// Fill empty bins from nearest neighbour, then box-blur the ridge line.
			let lastValid = -1;
			for (let b = 0; b < BINS; b++) {
				if (cupRimCeiling[b]! > -Infinity) lastValid = b;
				else if (lastValid >= 0) cupRimCeiling[b] = cupRimCeiling[lastValid]!;
			}
			for (let b = BINS - 1; b >= 0; b--) {
				if (cupRimCeiling[b]! > -Infinity) lastValid = b;
				else if (lastValid >= 0) cupRimCeiling[b] = cupRimCeiling[lastValid]!;
			}
			const scratch = Float32Array.from(cupRimCeiling);
			for (let b = 0; b < BINS; b++) {
				let sum = scratch[b]!;
				let n = 1;
				if (b > 0) {
					sum += scratch[b - 1]!;
					n++;
				}
				if (b < BINS - 1) {
					sum += scratch[b + 1]!;
					n++;
				}
				cupRimCeiling[b] = sum / n;
			}
		}

		return {
			el,
			floorMode,
			item,
			resolved,
			polygon,
			profile: el.profile,
			heightWorld,
			baseSurfaceHeight,
			blendNorm,
			stl,
			cupRimCeiling,
			cupRimU0: minU,
			cupRimU1: maxU,
			bboxMinU: minU - blendNorm,
			bboxMaxU: maxU + blendNorm,
			bboxMinV: minV - blendNorm,
			bboxMaxV: maxV + blendNorm,
		};
	});

	// Iterate vertices
	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const heightVal = getAxisValue(positions, i, heightAxis);

		// Normalise to 0-1 UV space
		const rawU = (lengthVal - lengthMin) / lengthSpan;
		const u = heelAtMin ? rawU : 1 - rawU; // 0 = heel, 1 = toe
		const v = (widthVal - widthMin) / widthSpan;

		// Only affect the top surface (upper 40% of height)
		const heightNorm = (heightVal - heightMin) / (heightSpan || 1);

		// Check if any element at this UV is an inset (diepelement) — these need
		// to affect ALL surface vertices regardless of height, because target areas
		// (e.g. big toe edge) curve down steeply and have low heightNorm.
		// Cup-fill elements (e.g. SC Bol) likewise span the bowl's low floor, so
		// they bypass the height gate and use a normal gate instead — that keeps
		// the steep insole walls untouched while thickening the floor.
		let hasInset = false;
		let hasCup = false;
		let hasStl = false;
		let cupCeilingWorld = Infinity;
		for (const p of prepared) {
			if (
				u >= p.bboxMinU &&
				u <= p.bboxMaxU &&
				v >= p.bboxMinV &&
				v <= p.bboxMaxV
			) {
				if (p.heightWorld < 0) {
					hasInset = true;
					break;
				}
				// STL-backed additive pads (heel/arch wall hugs, forefoot bars) sit
				// at any height on the insole, not just the top 40%. Treat them like
				// cup elements: bypass the global height gate and use a top-facing
				// normal gate so the whole footprint raises (matches the overlay).
				if (p.stl && !p.stl.cupFill) {
					hasStl = true;
				}
				if (p.stl?.cupFill) {
					hasCup = true;
					if (p.cupRimCeiling) {
						const span = Math.max(p.cupRimU1 - p.cupRimU0, 1e-6);
						const t = Math.min(1, Math.max(0, (u - p.cupRimU0) / span));
						const fb = t * (p.cupRimCeiling.length - 1);
						const b0 = Math.floor(fb);
						const b1 = Math.min(p.cupRimCeiling.length - 1, b0 + 1);
						const ceil =
							p.cupRimCeiling[b0]! * (1 - (fb - b0)) +
							p.cupRimCeiling[b1]! * (fb - b0);
						if (ceil < cupCeilingWorld) cupCeilingWorld = ceil;
					}
				}
			}
		}

		if (!hasInset && !hasCup && !hasStl) {
			if (heightNorm < 0.6) continue;
		} else {
			// Depth, cup and STL pad elements act on the TOP-FACING surface only;
			// never displace the underside or steep side walls (floor thickness, not
			// taller walls).
			if (getHeightNormal(i) < TOP_FACING_MIN) continue;
		}
		// Cup fill / STL pads: weight by the up-normal so the footprint gets full
		// thickness and the raise fades smoothly to zero up the steep walls — the
		// rim stays put and the floor/wall transition has no jagged step.
		const topWeight = hasInset
			? 1.0
			: hasCup || hasStl
				? smoothstep(TOP_FACING_MIN, 0.75, getHeightNormal(i))
				: smoothstep(0.6, 0.75, heightNorm);

		// Accumulate displacement from all elements
		let totalDisplacement = 0;

		for (const p of prepared) {
			if (isOverlayOnlyElement(p.item) && p.heightWorld > 0) continue;
			if (isThicknessOnlyElement(p.item) && p.heightWorld > 0) continue;

			// STL-backed additive element: raise the surface by the STL height field.
			if (p.stl) {
				const stl = p.stl;
				if (
					Math.abs(lengthVal - stl.centreLengthWorld) > stl.rejectRadius ||
					Math.abs(widthVal - stl.centreWidthWorld) > stl.rejectRadius
				)
					continue;
				let centreWidthWorld = stl.centreWidthWorld;
				if (stl.heelWallWidthAdjust) {
					centreWidthWorld += stl.heelWallWidthAdjust(lengthVal);
				}
				const dx = widthVal - centreWidthWorld;
				const dy = lengthVal - stl.centreLengthWorld;
				const localWidth = dx * stl.cos + dy * stl.sin;
				const localLength = -dx * stl.sin + dy * stl.cos;
				const rawY = localLength / stl.scaleLength + stl.stlCenterY;
				const lateralRawX = stl.spanFillWidth
					? spanFillRawXFromLocalWidth(
							stl.field,
							rawY,
							localWidth,
							stl.scaleWidth,
							stl.targetWidthWorld,
						)
					: localWidthToRawX(
							localWidth,
							stl.scaleWidth,
							stl.stlCenterX,
							false,
							stl.footprintX,
							stl.targetWidthWorld,
						);
				const rawX =
					stl.spanFillWidth &&
					stl.rowCenterProfile &&
					stl.heightProfile !== 'rowFloor'
						? sampleRowCenterRawX(stl.field, stl.rowCenterProfile, rawY)
						: lateralRawX;
				let padMm =
					stl.heightProfile === 'rowFloor'
						? sampleRowFloorHeightMm(stl.field, rawY)
						: sampleElementHeightMm(stl.field, rawX, rawY);
				if (
					!stl.spanFillWidth &&
					stl.rowCenterProfile &&
					stl.heightProfile !== 'rowFloor'
				) {
					const centerMm = sampleElementHeightMm(
						stl.field,
						sampleRowCenterRawX(stl.field, stl.rowCenterProfile, rawY),
						rawY,
					);
					if (centerMm > 1e-4 && padMm > centerMm) {
						padMm = centerMm + (padMm - centerMm) * 0.2;
					}
					const blurDx = stl.field.cellW * 0.85;
					const leftMm = sampleElementHeightMm(
						stl.field,
						lateralRawX - blurDx,
						rawY,
					);
					const rightMm = sampleElementHeightMm(
						stl.field,
						lateralRawX + blurDx,
						rawY,
					);
					padMm = (leftMm + padMm * 2 + rightMm) / 4;
				}
				if (padMm > 1e-4) {
					const taper =
						stl.spanFillWidth && stl.rctbLengthTaper
							? lateralSpanTaper(
									localLengthToSpanT(
										localLength,
										stl.targetLengthWorld,
									),
								)
							: 1;
					padMm =
						(padMm / stl.profilePeakMm) *
						stl.targetHeightMm *
						taper *
						mmToWorld;
				}
				if (padMm > 1e-4) totalDisplacement += padMm;
				continue;
			}

			// Early bounding-box reject
			if (u < p.bboxMinU || u > p.bboxMaxU || v < p.bboxMinV || v > p.bboxMaxV)
				continue;

			const { inside, edgeDist } = measurePreparedPolygon(u, v, p.polygon);

			let weight: number;
			if (inside) {
				// Inside: blend from edge
				if (p.blendNorm > 0.001) {
					const normEdgeDist = Math.min(edgeDist / p.blendNorm, 1);
					weight = profileMultiplier(p.profile, 1 - normEdgeDist);
				} else {
					weight = 1;
				}
			} else {
				// Outside: taper off in blend zone
				if (edgeDist < p.blendNorm && p.blendNorm > 0.001) {
					const normEdgeDist = edgeDist / p.blendNorm;
					weight =
						profileMultiplier(p.profile, 1 - 0.0) *
						(1 - smoothstep(0, 1, normEdgeDist));
				} else {
					continue;
				}
			}

			if (
				p.heightWorld > 0 &&
				p.floorMode !== 'sole' &&
				p.baseSurfaceHeight !== undefined
			) {
				const desiredTopHeight = p.baseSurfaceHeight + p.heightWorld * weight;
				const currentTargetHeight = heightVal + totalDisplacement;
				if (desiredTopHeight > currentTargetHeight) {
					totalDisplacement += desiredTopHeight - currentTargetHeight;
				}
			} else {
				totalDisplacement += p.heightWorld * weight;
			}
		}

		if (Math.abs(totalDisplacement) > 0.0001) {
			const currentHeight = getAxisValue(positions, i, heightAxis);
			let newHeight = currentHeight + totalDisplacement * topWeight;
			// Cup fill cannot rise above the surrounding insole rim — cut it off so
			// the element never pokes over the insole wall.
			if (hasCup && cupCeilingWorld < Infinity) {
				const ceil = cupCeilingWorld - 0.25 * mmToWorld;
				if (newHeight > ceil) newHeight = Math.max(currentHeight, ceil);
			}
			setAxisValue(positions, i, heightAxis, newHeight);
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
}

/* ══════════════════════════════════════════════
 *  buildElementOverlayGeometries
 *  Creates separate Three.js geometries for each placed element,
 *  positioned directly on the insole surface.
 *  These render as solid coloured pads ON TOP of the insole mesh,
 *  matching the competitor app appearance.
 * ══════════════════════════════════════════════ */

export interface ElementOverlayData {
	geometry: THREE.BufferGeometry;
	colorHex: string;
	elementId: string;
	stackOrder: number;
	isInset?: boolean;
	/**
	 * When true the overlay geometry carries a per-vertex `color` attribute that
	 * fades from the element colour at the raised interior to the insole colour at
	 * the rim, so a "flow onto sole" pad reads as one continuous surface with the
	 * insole (matte, no hard seam) instead of a glossy pad sitting on top.
	 */
	vertexColors?: boolean;
}

export function buildElementOverlayGeometries(
	insoleGeometry: THREE.BufferGeometry,
	elements: PlacedElement[],
	options?: {
		mmToWorld?: number;
		/** Pre-loaded STL geometries keyed by URL (from catalog stlUrl) */
		stlGeometries?: Map<string, THREE.BufferGeometry>;
		/**
		 * Base insole colour (hex) that "flow onto sole" pads fade toward at their
		 * rim so the perimeter melts into the insole instead of showing a hard seam.
		 */
		insoleColorHex?: string;
	},
): ElementOverlayData[] {
	if (!elements || elements.length === 0) return [];

	const insoleBlendColor = new THREE.Color(options?.insoleColorHex ?? '#d7dadd');
	const overlayColorHex = `#${insoleBlendColor.getHexString()}`;

	const sortedElements = sortPlacedElementsByStack(elements);

	if (!insoleGeometry.getAttribute('normal')) {
		insoleGeometry.computeVertexNormals();
	}

	const overlayAnalysis = getCachedInsoleOverlayAnalysis(insoleGeometry);
	const {
		axes,
		lengthMin,
		widthMin,
		heelAtMin,
		sampleHeight,
		sampleInsoleExtent,
		sampleInsoleHeelWallExtent,
		sampleInsoleUExtent,
	} = overlayAnalysis;
	const { lengthAxis, widthAxis, heightAxis, lengthSpan, widthSpan } = axes;
	const positions = insoleGeometry.getAttribute(
		'position',
	) as THREE.BufferAttribute;
	const vertexCount = positions.count;
	// Map UV + height to 3D world-space position
	const uvToWorld = (
		u: number,
		v: number,
		h: number,
	): [number, number, number] => {
		const rawU = heelAtMin ? u : 1 - u;
		const lw = lengthMin + rawU * lengthSpan;
		const ww = widthMin + v * widthSpan;
		const c: Record<string, number> = { x: 0, y: 0, z: 0 };
		c[lengthAxis] = lw;
		c[widthAxis] = ww;
		c[heightAxis] = h;
		return [c.x, c.y, c.z];
	};

	const mmToWorld = options?.mmToWorld ?? 1;
	const stlGeometries = options?.stlGeometries;
	// Overlays render coincident with the insole top surface so there is never a
	// visible or measurable gap at the element base. Z-fighting against the insole
	// is resolved by material polygonOffset in the viewer, not by a geometric lift.
	const SURFACE_EPSILON = 0;
	const INSET_OVERLAY_EPSILON = 0;
	// Element seating uses the BVH surface sampler (true shrinkwrap) — see
	// conformElementToInsole.ts — so no finite-difference height-field normal is
	// needed here any more.

	const buildInsetSurfaceOverlay = (
		outline: [number, number][],
	): THREE.BufferGeometry | null => {
		if (outline.length < 3) return null;

		let minU = Infinity,
			maxU = -Infinity,
			minV = Infinity,
			maxV = -Infinity;
		for (const [u, v] of outline) {
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}

		const spanU = Math.max(1e-4, maxU - minU);
		const spanV = Math.max(1e-4, maxV - minV);
		const gridU = Math.max(12, Math.min(36, Math.ceil(spanU / 0.012)));
		const gridV = Math.max(12, Math.min(36, Math.ceil(spanV / 0.012)));
		const stepU = spanU / gridU;
		const stepV = spanV / gridV;
		const edgePad = Math.max(stepU, stepV) * 0.9;

		const verts: number[] = [];
		const indexGrid = Array.from({ length: gridU + 1 }, () =>
			Array<number>(gridV + 1).fill(-1),
		);

		for (let gu = 0; gu <= gridU; gu++) {
			for (let gv = 0; gv <= gridV; gv++) {
				const u = minU + stepU * gu;
				const v = minV + stepV * gv;
				const inside = pointInPolygon(u, v, outline);
				const edgeDist = distToPolygonEdge(u, v, outline);
				if (!inside && edgeDist > edgePad) continue;
				const h = sampleHeight(u, v) + INSET_OVERLAY_EPSILON;
				indexGrid[gu][gv] = verts.length / 3;
				verts.push(...uvToWorld(u, v, h));
			}
		}

		const indices: number[] = [];
		for (let gu = 0; gu < gridU; gu++) {
			for (let gv = 0; gv < gridV; gv++) {
				const a = indexGrid[gu][gv];
				const b = indexGrid[gu + 1][gv];
				const c = indexGrid[gu][gv + 1];
				const d = indexGrid[gu + 1][gv + 1];

				if (a >= 0 && b >= 0 && c >= 0) indices.push(a, b, c);
				if (b >= 0 && d >= 0 && c >= 0) indices.push(b, d, c);
			}
		}

		if (verts.length < 9 || indices.length < 3) return null;

		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		geom.setIndex(indices);
		geom.computeVertexNormals();
		return geom;
	};

	const buildTrimmedAdditiveSurfaceOverlay = (
		outline: [number, number][],
		overlayBaseHeight: number,
	): THREE.BufferGeometry | null => {
		if (outline.length < 3) return null;

		let minU = Infinity,
			maxU = -Infinity,
			minV = Infinity,
			maxV = -Infinity;
		for (const [u, v] of outline) {
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}

		const spanU = Math.max(1e-4, maxU - minU);
		const spanV = Math.max(1e-4, maxV - minV);
		const gridU = Math.max(10, Math.min(36, Math.ceil(spanU / 0.018)));
		const gridV = Math.max(10, Math.min(36, Math.ceil(spanV / 0.018)));
		const stepU = spanU / gridU;
		const stepV = spanV / gridV;
		const edgePad = Math.max(stepU, stepV) * 0.9;

		const verts: number[] = [];
		const indexGrid = Array.from({ length: gridU + 1 }, () =>
			Array<number>(gridV + 1).fill(-1),
		);

		for (let gu = 0; gu <= gridU; gu++) {
			for (let gv = 0; gv <= gridV; gv++) {
				const u = minU + stepU * gu;
				const v = minV + stepV * gv;
				const inside = pointInPolygon(u, v, outline);
				const edgeDist = distToPolygonEdge(u, v, outline);
				if (!inside && edgeDist > edgePad) continue;
				indexGrid[gu][gv] = verts.length / 3;
				verts.push(...uvToWorld(u, v, overlayBaseHeight + SURFACE_EPSILON));
			}
		}

		const indices: number[] = [];
		for (let gu = 0; gu < gridU; gu++) {
			for (let gv = 0; gv < gridV; gv++) {
				const a = indexGrid[gu][gv];
				const b = indexGrid[gu + 1][gv];
				const c = indexGrid[gu][gv + 1];
				const d = indexGrid[gu + 1][gv + 1];

				if (a >= 0 && b >= 0 && c >= 0) indices.push(a, b, c);
				if (b >= 0 && d >= 0 && c >= 0) indices.push(b, d, c);
			}
		}

		if (verts.length < 9 || indices.length < 3) return null;

		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		geom.setIndex(indices);

		const trimmed = trimAdditiveOverlayGeometry({
			geometry: geom,
			lengthAxis,
			widthAxis,
			heightAxis,
			lengthMin,
			widthMin,
			lengthSpan,
			widthSpan,
			heelAtMin,
			surfaceHeightSampler: sampleHeight,
			epsilon: SURFACE_EPSILON,
		});
		if (!trimmed) return null;

		// Merge coincident vertices for smooth normals
		let smoothed: THREE.BufferGeometry;
		try {
			smoothed = mergeVertices(trimmed, 0.001);
		} catch {
			smoothed = trimmed;
		}
		smoothed.computeVertexNormals();
		smoothed.computeBoundingBox();
		return smoothed;
	};

	const buildRaisedElementTopSurfaceOverlay = (
		outline: [number, number][],
		heightMm: number,
		blendMm: number,
		profile: ElementProfile,
	): THREE.BufferGeometry | null => {
		if (outline.length < 3 || heightMm <= 0) return null;

		const heightWorld = Math.max(0.2, heightMm) * mmToWorld;
		const blendU = (blendMm * mmToWorld) / lengthSpan;
		const blendV = (blendMm * mmToWorld) / widthSpan;
		const blendNorm = Math.max(blendU, blendV);

		let perimeter = 0;
		for (let i = 0; i < outline.length; i++) {
			const [u0, v0] = outline[i]!;
			const [u1, v1] = outline[(i + 1) % outline.length]!;
			const du = (u1 - u0) * lengthSpan;
			const dv = (v1 - v0) * widthSpan;
			perimeter += Math.hypot(du, dv);
		}
		const samples = Math.max(
			48,
			Math.min(144, Math.ceil(perimeter / Math.max(1.5 * mmToWorld, 1e-6))),
		);
		const ringCount = Math.max(
			10,
			Math.min(28, Math.ceil(Math.sqrt(samples) * 2.2)),
		);

		const centroid = outline.reduce(
			(acc, [u, v]) => {
				acc[0] += u;
				acc[1] += v;
				return acc;
			},
			[0, 0] as [number, number],
		);
		centroid[0] /= outline.length;
		centroid[1] /= outline.length;

		const resampledOutline: [number, number][] = [];
		for (let sample = 0; sample < samples; sample++) {
			const target = (sample / samples) * perimeter;
			let walked = 0;
			for (let i = 0; i < outline.length; i++) {
				const [u0, v0] = outline[i]!;
				const [u1, v1] = outline[(i + 1) % outline.length]!;
				const duWorld = (u1 - u0) * lengthSpan;
				const dvWorld = (v1 - v0) * widthSpan;
				const segmentLength = Math.hypot(duWorld, dvWorld);
				if (walked + segmentLength >= target || i === outline.length - 1) {
					const t =
						segmentLength > 1e-8
							? Math.max(0, Math.min(1, (target - walked) / segmentLength))
							: 0;
					resampledOutline.push([
						u0 + (u1 - u0) * t,
						v0 + (v1 - v0) * t,
					]);
					break;
				}
				walked += segmentLength;
			}
		}
		if (resampledOutline.length < 3) return null;

		const verts: number[] = [];
		const indices: number[] = [];

		const pushVertex = (u: number, v: number): number => {
				const weight = computeOutlineProfileWeight(
					u,
					v,
					outline,
					blendNorm,
					profile,
				);
				const surfaceH = sampleHeight(u, v);
				const topH = surfaceH + heightWorld * weight + SURFACE_EPSILON;
				const index = verts.length / 3;
				verts.push(...uvToWorld(u, v, topH));
				return index;
		};

		const centerIndex = pushVertex(centroid[0], centroid[1]);
		let previousRing: number[] = [];

		for (let ring = 1; ring <= ringCount; ring++) {
			const t = ring / ringCount;
			const currentRing = resampledOutline.map(([outlineU, outlineV]) =>
				pushVertex(
					centroid[0] + (outlineU - centroid[0]) * t,
					centroid[1] + (outlineV - centroid[1]) * t,
				),
			);

			for (let i = 0; i < currentRing.length; i++) {
				const next = (i + 1) % currentRing.length;
				if (ring === 1) {
					indices.push(centerIndex, currentRing[i]!, currentRing[next]!);
				} else {
					indices.push(previousRing[i]!, currentRing[i]!, previousRing[next]!);
					indices.push(previousRing[next]!, currentRing[i]!, currentRing[next]!);
				}
			}

			previousRing = currentRing;
		}

		if (verts.length < 9 || indices.length < 3) return null;

		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		geom.setIndex(indices);
		return geom;
	};

	const buildRaisedElementVolumeOverlay = (
		outline: [number, number][],
		heightMm: number,
		blendMm: number,
		profile: ElementProfile,
	): THREE.BufferGeometry | null => {
		if (outline.length < 3 || heightMm <= 0) return null;

		let minU = Infinity,
			maxU = -Infinity,
			minV = Infinity,
			maxV = -Infinity;
		for (const [u, v] of outline) {
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}

		const spanU = Math.max(1e-4, maxU - minU);
		const spanV = Math.max(1e-4, maxV - minV);
		const gridU = Math.max(14, Math.min(40, Math.ceil(spanU / 0.012)));
		const gridV = Math.max(14, Math.min(40, Math.ceil(spanV / 0.012)));
		const stepU = spanU / gridU;
		const stepV = spanV / gridV;
		const edgePad = Math.max(stepU, stepV) * 0.85;

		const heightWorld = Math.max(0.2, heightMm) * mmToWorld;
		const blendU = (blendMm * mmToWorld) / lengthSpan;
		const blendV = (blendMm * mmToWorld) / widthSpan;
		const blendNorm = Math.max(blendU, blendV);

		const verts: number[] = [];
		const indexGrid = Array.from({ length: gridU + 1 }, () =>
			Array<number>(gridV + 1).fill(-1),
		);

		for (let gu = 0; gu <= gridU; gu++) {
			for (let gv = 0; gv <= gridV; gv++) {
				const u = minU + stepU * gu;
				const v = minV + stepV * gv;
				const inside = pointInPolygon(u, v, outline);
				const edgeDist = distToPolygonEdge(u, v, outline);
				if (!inside && edgeDist > edgePad) continue;

				const weight = computeOutlineProfileWeight(
					u,
					v,
					outline,
					blendNorm,
					profile,
				);
				if (weight <= 1e-4) continue;

				const surfaceH = sampleHeight(u, v);
				const topH = surfaceH + heightWorld * weight + SURFACE_EPSILON;
				indexGrid[gu][gv] = verts.length / 3;
				verts.push(...uvToWorld(u, v, topH));
			}
		}

		const indices: number[] = [];
		for (let gu = 0; gu < gridU; gu++) {
			for (let gv = 0; gv < gridV; gv++) {
				const a = indexGrid[gu][gv];
				const b = indexGrid[gu + 1][gv];
				const c = indexGrid[gu][gv + 1];
				const d = indexGrid[gu + 1][gv + 1];

				if (a >= 0 && b >= 0 && c >= 0) indices.push(a, b, c);
				if (b >= 0 && d >= 0 && c >= 0) indices.push(b, d, c);
			}
		}

		const topRing: number[] = [];
		const bottomRing: number[] = [];
		for (const [u, v] of outline) {
			const weight = computeOutlineProfileWeight(
				u,
				v,
				outline,
				blendNorm,
				profile,
			);
			const surfaceH = sampleHeight(u, v);
			const topH = surfaceH + heightWorld * weight + SURFACE_EPSILON;
			bottomRing.push(...uvToWorld(u, v, surfaceH + SURFACE_EPSILON * 0.35));
			topRing.push(...uvToWorld(u, v, topH));
		}

		const topOffset = verts.length / 3;
		verts.push(...topRing, ...bottomRing);

		const outlineCount = outline.length;
		for (let i = 0; i < outlineCount; i++) {
			const next = (i + 1) % outlineCount;
			const topA = topOffset + i;
			const topB = topOffset + next;
			const bottomA = topOffset + outlineCount + i;
			const bottomB = topOffset + outlineCount + next;
			indices.push(topA, bottomB, bottomA);
			indices.push(topA, topB, bottomB);
		}

		if (verts.length < 9 || indices.length < 3) return null;

		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		geom.setIndex(indices);
		return geom;
	};

	const buildProceduralRaisedOverlay = (
		outline: [number, number][],
		heightMm: number,
		blendMm: number,
		profile: ElementProfile,
		item: ReturnType<typeof getElementByKey>,
		floorMode: ReturnType<typeof normalizeElementFloorMode>,
		overlayBaseHeight: number,
	): THREE.BufferGeometry | null => {
		if (isThicknessOnlyElement(item)) {
			return buildRaisedElementTopSurfaceOverlay(
				outline,
				heightMm,
				blendMm,
				profile,
			);
		}

		if (floorMode !== 'sole') {
			return (
				buildTrimmedAdditiveSurfaceOverlay(outline, overlayBaseHeight) ??
				buildRaisedElementVolumeOverlay(outline, heightMm, blendMm, profile)
			);
		}

		return buildRaisedElementVolumeOverlay(
			outline,
			heightMm,
			blendMm,
			profile,
		);
	};

	const result: ElementOverlayData[] = [];
	// Built lazily (and cached per insole geometry) only when an STL-backed pad is
	// actually seated. Read-only: never mutates the insole.
	let surfaceSampler: InsoleSurfaceSampler | null = null;
	const placementContext: PlacementContext = {
		positions,
		vertexCount,
		lengthAxis,
		widthAxis,
		lengthMin,
		widthMin,
		lengthSpan,
		widthSpan,
		heelAtMin,
		mmToWorld,
		sampleInsoleExtent,
		sampleInsoleHeelWallExtent,
		sampleInsoleUExtent,
	};

	for (const el of sortedElements) {
		const item = getElementByKey(el.libraryKey);
		if (!item) continue;
		const floorMode = normalizeElementFloorMode(el.floorMode);
		const stackOrder = el.stackOrder ?? 0;
		// Visual overlays prefer the decimated low-poly STL for performance and
		// fall back to the full-res mesh.
		const overlayStlUrl = stlGeometries
			? getElementViewerStlUrls(item).find((url) => stlGeometries.has(url))
			: undefined;
		const resolved = resolveElementLayout(item, el, placementContext);
		const isInset = el.heightMm < 0;
		const baseSurfaceHeight =
			!isInset && floorMode !== 'sole'
				? sampleHeight(resolved.positionU, resolved.positionV)
				: undefined;

		// ── STL-based overlay (preferred when stlUrl is available) ──
		if (
			overlayStlUrl &&
			!isInset &&
			!isThicknessOnlyElement(item)
		) {
			const srcGeom = stlGeometries!.get(overlayStlUrl)!;
			const field = getElementStlHeightField(
				srcGeom,
				Boolean(item.stlSwapYZ),
			);
			const {
				sourceWidthMm,
				sourceLengthMm,
				sourceHeightMm,
			} = field;

			const targetWidthMm =
				(resolved.targetWidthMm ?? item.stlSizeMm?.[0] ?? sourceWidthMm) *
				el.scaleV;
			const targetLengthMm =
				(resolved.targetLengthMm ?? item.stlSizeMm?.[1] ?? sourceLengthMm) *
				el.scaleU;
			const targetHeightMm = Math.max(0.2, Math.abs(el.heightMm));

			let scaleWidth = (targetWidthMm * mmToWorld) / sourceWidthMm;
			if (getEffectiveMirrorWidth(el.side, resolved.mirrorWidth))
				scaleWidth = -scaleWidth;
			const scaleLength = (targetLengthMm * mmToWorld) / sourceLengthMm;
			const scaleHeight = (targetHeightMm * mmToWorld) / sourceHeightMm;

			const centreRawU = heelAtMin
				? resolved.positionU
				: 1 - resolved.positionU;
			const centreLengthWorld = lengthMin + centreRawU * lengthSpan;
			const centreWidthWorld = widthMin + resolved.positionV * widthSpan;
			const placementSpec = item.key ? ELEMENT_PLACEMENT[item.key] : undefined;
			const heelWallAdjust = buildHeelWallWidthAdjust(
				placementSpec,
				placementContext,
				el,
				resolved.positionU,
			);
			const edgeFadeCells =
				placementSpec?.overlayEdgeFadeCells ??
				(resolved.conformWidthToInsole ? 11 : 10);

			// Build the read-only insole surface sampler on first use (cached).
			if (!surfaceSampler) {
				surfaceSampler = getInsoleSurfaceSampler(insoleGeometry);
			}

			// Render the element as a smooth raised pad built from its top-surface
			// height field and conformed onto the insole. Export reuses these
			// conformed overlay meshes so the STL matches the preview. This fills
			// the footprint, melts flush at the boundary (zero gap), and rises to
			// the requested peak height regardless of the STL's native thickness.
			const sheet = buildConformedElementSheet({
				field,
				sampler: surfaceSampler,
				centreLengthWorld,
				centreWidthWorld,
				rotationRad: resolved.rotationRad,
				scaleWidth,
				scaleLength,
				scaleHeight,
				lengthAxis,
				widthAxis,
				heightAxis,
				seedHeight: (lengthWorld, widthWorld) => {
					const rawUSeed =
						(lengthWorld - lengthMin) / Math.max(lengthSpan, 1e-6);
					const uSeed = heelAtMin ? rawUSeed : 1 - rawUSeed;
					const vSeed = (widthWorld - widthMin) / Math.max(widthSpan, 1e-6);
					return sampleHeight(uSeed, vSeed);
				},
				maxRiseWorld: targetHeightMm * mmToWorld,
				edgeFadeCells,
				elementColorHex: overlayColorHex,
				insoleColorHex: overlayColorHex,
				spanFillWidth: Boolean(resolved.conformWidthToInsole),
				lengthProfileTaper: resolved.rctbLengthTaper ?? true,
				heightProfile: resolved.heightProfile,
				adjustWidthWorld: heelWallAdjust
					? (lengthWorld, widthWorld) =>
							widthWorld + heelWallAdjust(lengthWorld)
					: undefined,
			});

			result.push({
				geometry: sheet,
				colorHex: overlayColorHex,
				elementId: el.id,
				stackOrder,
				isInset: false,
				vertexColors: true,
			});
			continue;
		}

		if (
			getElementPreferredStlUrl(item) &&
			!isInset &&
			!isThicknessOnlyElement(item) &&
			!overlayStlUrl
		) {
			warnStlMissOnce(el.libraryKey);
		}

		// ── Fallback: procedural polygon overlay ──
		const resolvedElement = {
			...el,
			positionU: resolved.positionU,
			positionV: resolved.positionV,
			rotationRad: resolved.rotationRad,
		};
		const effectiveMirrorWidth = getEffectiveMirrorWidth(
			el.side,
			resolved.mirrorWidth,
		);
		const { elementSizeU, elementSizeV } = getElementFootprintUv(
			item,
			el,
			{
				lengthSpan,
				widthSpan,
				mmToWorld,
			},
			resolved,
		);
		const rawOutline = transformOutline(
			item.outline,
			resolvedElement,
			elementSizeU,
			elementSizeV,
			effectiveMirrorWidth,
		);
		// Clip outline to insole boundary so no procedural polygon overflows
		const outline = clipOutlineToInsole(rawOutline, sampleInsoleExtent);

		if (isInset) {
			const insetGeom = buildInsetSurfaceOverlay(outline);
			if (insetGeom) {
				result.push({
					geometry: smoothElementOverlayGeometry(insetGeom, mmToWorld),
					colorHex: overlayColorHex,
					elementId: el.id,
					stackOrder,
					isInset: true,
				});
			}
			continue;
		}

		if (floorMode !== 'sole') {
			const overlayGeom = buildProceduralRaisedOverlay(
				outline,
				el.heightMm,
				el.blendMm,
				el.profile,
				item,
				floorMode,
				baseSurfaceHeight ??
					sampleHeight(resolved.positionU, resolved.positionV),
			);
			if (!overlayGeom) {
				warnTrimFallbackOnce(el.id);
				continue;
			}

			result.push({
				geometry: smoothElementOverlayGeometry(overlayGeom, mmToWorld, {
					preservePlateau: !isThicknessOnlyElement(item),
				}),
				colorHex: overlayColorHex,
				elementId: el.id,
				stackOrder,
				isInset: false,
			});
			continue;
		}

		const volumeGeom = buildProceduralRaisedOverlay(
			outline,
			el.heightMm,
			el.blendMm,
			el.profile,
			item,
			floorMode,
			sampleHeight(resolved.positionU, resolved.positionV),
		);
		if (!volumeGeom) continue;

		result.push({
			geometry: smoothElementOverlayGeometry(volumeGeom, mmToWorld, {
				preservePlateau: !isThicknessOnlyElement(item),
			}),
			colorHex: overlayColorHex,
			elementId: el.id,
			stackOrder,
			isInset: false,
		});
	}

	return result;
}

/**
 * Paint vertex colors on the geometry for each placed element.
 * Uses the same outline polygon as applyElements for pixel-accurate shape.
 * Only colors the TOP surface (avoids side bleed-through).
 * Colors are fully opaque inside the element boundary.
 *
 * Mutates the geometry's `color` BufferAttribute in-place.
 */
export function applyElementColors(
	geometry: THREE.BufferGeometry,
	elements: PlacedElement[],
	options?: {
		mmToWorld?: number;
		baseColor?: string;
	},
): void {
	const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
	const vertexCount = positions.count;

	const baseCol = new THREE.Color(options?.baseColor ?? '#d7dadd');

	// Start with base colour everywhere
	const colors = new Float32Array(vertexCount * 3);
	for (let i = 0; i < vertexCount; i++) {
		colors[i * 3] = baseCol.r;
		colors[i * 3 + 1] = baseCol.g;
		colors[i * 3 + 2] = baseCol.b;
	}

	if (!elements || elements.length === 0) {
		geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		return;
	}

	const sortedElements = sortPlacedElementsByStack(elements);
	const geometryAnalysis = getCachedInsoleOverlayAnalysis(geometry);
	const { axes, lengthMin, widthMin, heightMin, heightSpan, heelAtMin } =
		geometryAnalysis;
	const { lengthAxis, widthAxis, heightAxis, lengthSpan, widthSpan } = axes;

	// Precompute transformed outlines + bounding boxes
	const prepared = sortedElements.map((el) => {
		const item = getElementByKey(el.libraryKey);
		const resolved = resolveElementLayout(item, el, {
			positions,
			vertexCount,
			lengthAxis,
			widthAxis,
			lengthMin,
			widthMin,
			lengthSpan,
			widthSpan,
			heelAtMin,
			mmToWorld: options?.mmToWorld ?? 1,
			sampleInsoleExtent: geometryAnalysis.sampleInsoleExtent,
			sampleInsoleHeelWallExtent: geometryAnalysis.sampleInsoleHeelWallExtent,
			sampleInsoleUExtent: geometryAnalysis.sampleInsoleUExtent,
		});
		const resolvedElement = {
			...el,
			positionU: resolved.positionU,
			positionV: resolved.positionV,
			rotationRad: resolved.rotationRad,
		};
		const effectiveMirrorWidth = getEffectiveMirrorWidth(
			el.side,
			resolved.mirrorWidth,
		);
		const outline =
			item?.outline ??
			([
				[0.1, 0.1],
				[0.9, 0.1],
				[0.9, 0.9],
				[0.1, 0.9],
			] as [number, number][]);
		const { elementSizeU, elementSizeV } = getElementFootprintUv(
			item,
			el,
			{
				lengthSpan,
				widthSpan,
				mmToWorld: options?.mmToWorld ?? 1,
			},
			resolved,
		);
		const transformed = transformOutline(
			outline,
			resolvedElement,
			elementSizeU,
			elementSizeV,
			effectiveMirrorWidth,
		);
		const polygon = preparePolygon(transformed);
		const colorHex = item ? ELEMENT_COLORS[item.color] : '#999';
		const col = new THREE.Color(colorHex);

		// Bounding box for fast per-vertex reject
		let minU = Infinity,
			maxU = -Infinity,
			minV = Infinity,
			maxV = -Infinity;
		for (const [u, v] of transformed) {
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}
		// Small UV margin for soft edge taper
		const edgeMargin = 0.012;
		return {
			polygon,
			color: col,
			minU: minU - edgeMargin,
			maxU: maxU + edgeMargin,
			minV: minV - edgeMargin,
			maxV: maxV + edgeMargin,
			edgeMargin,
		};
	});

	// Use vertex normals to detect top surface (normal points in +heightAxis direction).
	// First detect which sign is "up" by averaging normals of the top-altitude vertices.
	const normals = geometry.getAttribute('normal') as
		| THREE.BufferAttribute
		| undefined;
	const normalIdx = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;

	const getHeightNormalRaw = (i: number): number => {
		if (!normals) return 1;
		if (normalIdx === 0) return normals.getX(i);
		if (normalIdx === 1) return normals.getY(i);
		return normals.getZ(i);
	};

	// Determine "up" sign: average normal component for the top-20% height vertices
	let normalSignSum = 0,
		normalSignCount = 0;
	const topThreshAbs = heightMin + heightSpan * 0.8;
	for (let i = 0; i < vertexCount; i++) {
		const hv = getAxisValue(positions, i, heightAxis);
		if (hv >= topThreshAbs) {
			normalSignSum += getHeightNormalRaw(i);
			normalSignCount++;
		}
	}
	// upSign = +1 if top surface normals are positive, -1 if they're negative
	const upSign =
		normalSignCount > 0 && normalSignSum / normalSignCount < 0 ? -1 : 1;

	const getHeightNormal = (i: number): number => getHeightNormalRaw(i) * upSign;

	const tempColor = new THREE.Color();

	for (let i = 0; i < vertexCount; i++) {
		// Only paint vertices whose normal points sufficiently upward (top surface)
		const normalUp = getHeightNormal(i);
		if (normalUp < 0.25) continue; // side/bottom vertices — skip

		// Soft weight based on how top-facing the normal is (0.25→0.55 = partial, >0.55 = full)
		const topWeight = smoothstep(0.25, 0.55, normalUp);

		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);

		const rawU = (lengthVal - lengthMin) / lengthSpan;
		const u = heelAtMin ? rawU : 1 - rawU;
		const v = (widthVal - widthMin) / widthSpan;

		let bestAlpha = 0;
		let bestColor: THREE.Color | null = null;

		for (const p of prepared) {
			// Fast bounding-box reject
			if (u < p.minU || u > p.maxU || v < p.minV || v > p.maxV) continue;

			const { inside, edgeDist } = measurePreparedPolygon(u, v, p.polygon);

			let alpha: number;
			if (inside) {
				// Fully opaque inside — crisp solid pad
				alpha = 1.0;
			} else {
				// Soft taper just outside the polygon edge (tiny margin only)
				if (edgeDist < p.edgeMargin) {
					alpha = 1.0 - edgeDist / p.edgeMargin;
				} else {
					continue;
				}
			}

			if (alpha > bestAlpha) {
				bestAlpha = alpha;
				bestColor = p.color;
			}
		}

		if (bestColor && bestAlpha > 0) {
			const finalAlpha = bestAlpha * topWeight;
			tempColor.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
			tempColor.lerp(bestColor, finalAlpha);
			colors[i * 3] = tempColor.r;
			colors[i * 3 + 1] = tempColor.g;
			colors[i * 3 + 2] = tempColor.b;
		}
	}

	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

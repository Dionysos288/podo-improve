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
	ELEMENT_COLORS,
} from './catalog';
import { getDefaultPlacementForSide } from './placement';
import { normalizeElementFloorMode } from './normalizeFloorMode';
import { sortPlacedElementsByStack } from './sortPlacedElements';
import {
	smoothElementOverlayGeometry,
	tessellateAndWeldGeometry,
} from '../viewer/smoothOverlayGeometry';

const THICKNESS_ONLY_COLORS = new Set<ElementColorGroup>(['blue', 'orange']);

export function isThicknessOnlyElement(
	item: { color?: ElementColorGroup } | null | undefined,
): boolean {
	return Boolean(item?.color && THICKNESS_ONLY_COLORS.has(item.color));
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

/** Default insole-edge blend zone (mm). Height tapers to 0 within this margin. */
const INSOLE_EDGE_BLEND_MM = 3.0;

/** Larger edge blend for wide stabiliser pads that intentionally overshoot the insole. */
const WIDE_PAD_EDGE_BLEND_MM = 8.0;

function quinticEase(t: number): number {
	const clamped = Math.max(0, Math.min(1, t));
	const t3 = clamped * clamped * clamped;
	return t3 * (clamped * (clamped * 6 - 15) + 10);
}

function getAdditiveInsoleEdgeBlendMm(libraryKey: string | undefined): number {
	if (libraryKey === 'spsa-vlak' || libraryKey === 'ppsa') {
		return WIDE_PAD_EDGE_BLEND_MM;
	}
	return INSOLE_EDGE_BLEND_MM;
}

/**
 * Clip a single vertex to the insole boundary.
 * - If outside: snaps V to nearest edge, returns heightMultiplier = 0.
 * - If within the blend zone: returns a smooth 0→1 multiplier (quintic ease).
 * - If fully inside: returns heightMultiplier = 1.
 *
 * Returns { clippedV, clippedWorldWidth, heightMultiplier }.
 */
function clipVertexToInsole(
	sampleU: number,
	sampleV: number,
	worldWidth: number,
	sampler: InsoleBoundarySampler,
	widthMin: number,
	widthSpan: number,
	mmToWorld: number,
	blendMm: number = INSOLE_EDGE_BLEND_MM,
	softOutside = false,
): { clippedV: number; clippedWorldWidth: number; heightMultiplier: number } {
	const uClamped = Math.max(0, Math.min(1, sampleU));
	const { minV, maxV } = sampler(uClamped);

	const distToMinMm =
		((sampleV - minV) * widthSpan) / Math.max(mmToWorld, 1e-6);
	const distToMaxMm =
		((maxV - sampleV) * widthSpan) / Math.max(mmToWorld, 1e-6);
	const distToEdgeMm = Math.min(distToMinMm, distToMaxMm);

	if (distToEdgeMm < 0) {
		const clippedV = Math.max(minV, Math.min(maxV, sampleV));
		if (!softOutside) {
			return {
				clippedV,
				clippedWorldWidth: widthMin + clippedV * widthSpan,
				heightMultiplier: 0,
			};
		}
		const overshootMm = -distToEdgeMm;
		const fadeSpan = blendMm * 2;
		const heightMultiplier =
			overshootMm >= fadeSpan ? 0 : quinticEase(1 - overshootMm / fadeSpan);
		return {
			clippedV,
			clippedWorldWidth: widthMin + clippedV * widthSpan,
			heightMultiplier,
		};
	}
	if (distToEdgeMm < blendMm) {
		return {
			clippedV: sampleV,
			clippedWorldWidth: worldWidth,
			heightMultiplier: quinticEase(distToEdgeMm / blendMm),
		};
	}
	return {
		clippedV: sampleV,
		clippedWorldWidth: worldWidth,
		heightMultiplier: 1,
	};
}

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

type CachedStlDistanceField = {
	sourceWidthMm: number;
	sourceLengthMm: number;
	sourceHeightMm: number;
	stlCenterX: number;
	stlCenterY: number;
	stlBaseZ: number;
	stlMinX: number;
	stlMinY: number;
	cellW: number;
	cellL: number;
	cellSizeMm: number;
	distGrid: Float32Array;
	gridSize: number;
};

const stlDistanceFieldCache = new WeakMap<
	THREE.BufferGeometry,
	Map<string, CachedStlDistanceField>
>();
const preparedOverlayStlGeometryCache = new WeakMap<
	THREE.BufferGeometry,
	Map<string, THREE.BufferGeometry>
>();

function getPreparedOverlayStlGeometry(
	sourceGeometry: THREE.BufferGeometry,
	swapYZ: boolean,
): THREE.BufferGeometry {
	let perGeometryCache = preparedOverlayStlGeometryCache.get(sourceGeometry);
	if (!perGeometryCache) {
		perGeometryCache = new Map<string, THREE.BufferGeometry>();
		preparedOverlayStlGeometryCache.set(sourceGeometry, perGeometryCache);
	}
	const cacheKey = swapYZ ? 'swap-yz' : 'native';
	const cached = perGeometryCache.get(cacheKey);
	if (cached) return cached;

	let prepared: THREE.BufferGeometry;
	try {
		prepared = mergeVertices(sourceGeometry.clone(), 0.01);
	} catch {
		prepared = sourceGeometry.clone();
	}

	if (swapYZ) {
		const position = prepared.getAttribute('position') as THREE.BufferAttribute;
		for (let index = 0; index < position.count; index++) {
			const y = position.getY(index);
			const z = position.getZ(index);
			position.setY(index, z);
			position.setZ(index, y);
		}
		position.needsUpdate = true;
	}

	prepared = tessellateAndWeldGeometry(prepared, 1);
	prepared.computeBoundingBox();
	prepared.computeBoundingSphere();
	perGeometryCache.set(cacheKey, prepared);
	return prepared;
}

function getCachedStlDistanceField(
	sourceGeometry: THREE.BufferGeometry,
	swapYZ: boolean,
): CachedStlDistanceField {
	let perGeometryCache = stlDistanceFieldCache.get(sourceGeometry);
	if (!perGeometryCache) {
		perGeometryCache = new Map<string, CachedStlDistanceField>();
		stlDistanceFieldCache.set(sourceGeometry, perGeometryCache);
	}
	const cacheKey = swapYZ ? 'swap-yz' : 'native';
	const cached = perGeometryCache.get(cacheKey);
	if (cached) return cached;

	const pos = sourceGeometry.getAttribute('position') as THREE.BufferAttribute;
	const vtxCount = pos.count;
	let minX = Infinity,
		maxX = -Infinity;
	let minY = Infinity,
		maxY = -Infinity;
	let minZ = Infinity,
		maxZ = -Infinity;
	for (let i = 0; i < vtxCount; i++) {
		const x = pos.getX(i);
		const y = swapYZ ? pos.getZ(i) : pos.getY(i);
		const z = swapYZ ? pos.getY(i) : pos.getZ(i);
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		if (z < minZ) minZ = z;
		if (z > maxZ) maxZ = z;
	}

	const sourceWidthMm = Math.max(1e-6, maxX - minX);
	const sourceLengthMm = Math.max(1e-6, maxY - minY);
	const sourceHeightMm = Math.max(1e-6, maxZ - minZ);
	const stlCenterX = (minX + maxX) / 2;
	const stlCenterY = (minY + maxY) / 2;
	const stlBaseZ = minZ;
	const gridSize = 64;
	const cellW = sourceWidthMm / gridSize;
	const cellL = sourceLengthMm / gridSize;
	const occupied = new Uint8Array(gridSize * gridSize);
	const distGrid = new Float32Array(gridSize * gridSize);
	distGrid.fill(1e6);
	const baseThresh = stlBaseZ + sourceHeightMm * 0.08;

	for (let i = 0; i < vtxCount; i++) {
		const px = pos.getX(i);
		const py = swapYZ ? pos.getZ(i) : pos.getY(i);
		const pz = swapYZ ? pos.getY(i) : pos.getZ(i);
		if (pz <= baseThresh) continue;
		const gx = Math.min(
			gridSize - 1,
			Math.max(0, Math.floor((px - minX) / cellW)),
		);
		const gy = Math.min(
			gridSize - 1,
			Math.max(0, Math.floor((py - minY) / cellL)),
		);
		occupied[gy * gridSize + gx] = 1;
	}

	const queue: number[] = [];
	for (let gy = 0; gy < gridSize; gy++) {
		for (let gx = 0; gx < gridSize; gx++) {
			const gi = gy * gridSize + gx;
			if (!occupied[gi]) {
				distGrid[gi] = 0;
				continue;
			}
			let isBoundary =
				gx === 0 || gx === gridSize - 1 || gy === 0 || gy === gridSize - 1;
			if (!isBoundary) {
				for (const [dx, dy] of [
					[-1, 0],
					[1, 0],
					[0, -1],
					[0, 1],
				] as const) {
					const nx = gx + dx;
					const ny = gy + dy;
					if (
						nx >= 0 &&
						nx < gridSize &&
						ny >= 0 &&
						ny < gridSize &&
						!occupied[ny * gridSize + nx]
					) {
						isBoundary = true;
						break;
					}
				}
			}
			if (isBoundary) {
				distGrid[gi] = 0;
				queue.push(gx, gy);
			}
		}
	}

	let qi = 0;
	while (qi < queue.length) {
		const cx = queue[qi++];
		const cy = queue[qi++];
		const cd = distGrid[cy * gridSize + cx];
		for (const [dx, dy] of [
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1],
			[-1, -1],
			[-1, 1],
			[1, -1],
			[1, 1],
		] as const) {
			const nx = cx + dx;
			const ny = cy + dy;
			if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
			const ni = ny * gridSize + nx;
			if (!occupied[ni]) continue;
			const nd = cd + (dx !== 0 && dy !== 0 ? 1.414 : 1.0);
			if (nd < distGrid[ni]) {
				distGrid[ni] = nd;
				queue.push(nx, ny);
			}
		}
	}

	const next: CachedStlDistanceField = {
		sourceWidthMm,
		sourceLengthMm,
		sourceHeightMm,
		stlCenterX,
		stlCenterY,
		stlBaseZ,
		stlMinX: minX,
		stlMinY: minY,
		cellW,
		cellL,
		cellSizeMm: Math.max(cellW, cellL),
		distGrid,
		gridSize,
	};
	perGeometryCache.set(cacheKey, next);
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

function resolveAdaptiveSd25Layout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
): ResolvedElementLayout {
	const {
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
	} = context;

	const defaults = getDefaultPlacementForSide(item, el.side);
	const deltaU = el.positionU - defaults.positionU;
	const deltaV = el.positionV - defaults.positionV;
	const deltaRotation = el.rotationRad - defaults.rotationRad;

	const BINS = 36;
	const bins = Array.from({ length: BINS }, (_, index) => ({
		u: (index + 0.5) / BINS,
		minV: Infinity,
		maxV: -Infinity,
		count: 0,
	}));

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const rawU = (lengthVal - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		if (u < 0.58 || u > 0.94) continue;
		const v = (widthVal - widthMin) / Math.max(widthSpan, 1e-6);
		const binIndex = Math.max(0, Math.min(BINS - 1, Math.floor(u * BINS)));
		const bin = bins[binIndex];
		if (v < bin.minV) bin.minV = v;
		if (v > bin.maxV) bin.maxV = v;
		bin.count++;
	}

	let bestBin: (typeof bins)[number] | null = null;
	let bestScore = -Infinity;
	for (const bin of bins) {
		if (
			bin.count < 8 ||
			!Number.isFinite(bin.minV) ||
			!Number.isFinite(bin.maxV)
		)
			continue;
		const widthNorm = bin.maxV - bin.minV;
		if (widthNorm < 0.12) continue;
		const forefootBias = Math.max(0, 1 - Math.abs(bin.u - 0.79) / 0.12);
		const score = widthNorm * (0.55 + forefootBias);
		if (score > bestScore) {
			bestScore = score;
			bestBin = bin;
		}
	}

	if (!bestBin) {
		return {
			positionU: clamp01(el.positionU),
			positionV: clamp01(el.positionV),
			rotationRad: el.rotationRad,
		};
	}

	const localWidthNorm = Math.max(0.14, bestBin.maxV - bestBin.minV);
	// Place element centre at ~58% from minV for right (lateral), 42% for left
	const lateralCenterFactor = el.side === 'right' ? 0.58 : 0.42;
	const adaptiveU = clamp01(Math.max(0.72, Math.min(0.86, bestBin.u + 0.015)));
	const adaptiveV = clamp01(
		bestBin.minV + localWidthNorm * lateralCenterFactor,
	);
	const localWidthMm = (localWidthNorm * widthSpan) / Math.max(mmToWorld, 1e-6);
	const baseWidthMm = Math.max(24, localWidthMm * 0.62);
	const aspect =
		(item?.stlSizeMm?.[1] ?? 52) / Math.max(1e-6, item?.stlSizeMm?.[0] ?? 65.8);
	const baseLengthMm = Math.max(16, baseWidthMm * aspect * 1.0);
	const adaptiveRotation = el.side === 'right' ? -0.16 : 0.16;

	return {
		positionU: clamp01(adaptiveU + deltaU),
		positionV: clamp01(adaptiveV + deltaV),
		rotationRad: adaptiveRotation + deltaRotation,
		targetWidthMm: baseWidthMm,
		targetLengthMm: baseLengthMm,
	};
}

function resolveAdaptiveSd15Layout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
): ResolvedElementLayout {
	const {
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
	} = context;

	const defaults = getDefaultPlacementForSide(item, el.side);
	const deltaU = el.positionU - defaults.positionU;
	const deltaV = el.positionV - defaults.positionV;
	const deltaRotation = el.rotationRad - defaults.rotationRad;

	// Profile the forefoot region to find the best U cross-section
	// and measure the FULL insole width at each slice
	const BINS = 36;
	const bins = Array.from({ length: BINS }, (_, index) => ({
		u: (index + 0.5) / BINS,
		minV: Infinity,
		maxV: -Infinity,
		count: 0,
	}));

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const rawU = (lengthVal - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		if (u < 0.58 || u > 0.94) continue;
		const v = (widthVal - widthMin) / Math.max(widthSpan, 1e-6);
		const binIndex = Math.max(0, Math.min(BINS - 1, Math.floor(u * BINS)));
		const bin = bins[binIndex];
		if (v < bin.minV) bin.minV = v;
		if (v > bin.maxV) bin.maxV = v;
		bin.count++;
	}

	// Pick the widest forefoot cross-section around U≈0.78
	let bestBin: (typeof bins)[number] | null = null;
	let bestScore = -Infinity;
	for (const bin of bins) {
		if (
			bin.count < 8 ||
			!Number.isFinite(bin.minV) ||
			!Number.isFinite(bin.maxV)
		)
			continue;
		const widthNorm = bin.maxV - bin.minV;
		if (widthNorm < 0.12) continue;
		const forefootBias = Math.max(0, 1 - Math.abs(bin.u - 0.78) / 0.14);
		const score = widthNorm * (0.55 + forefootBias);
		if (score > bestScore) {
			bestScore = score;
			bestBin = bin;
		}
	}

	if (!bestBin) {
		return {
			positionU: clamp01(el.positionU),
			positionV: clamp01(el.positionV),
			rotationRad: el.rotationRad,
		};
	}

	// Full insole width at this cross-section (edge to edge)
	const insoleMinV = bestBin.minV;
	const insoleMaxV = bestBin.maxV;
	const insoleWidthNorm = Math.max(0.2, insoleMaxV - insoleMinV);
	const insoleWidthAtSliceMm =
		(insoleWidthNorm * widthSpan) / Math.max(mmToWorld, 1e-6);

	// SD 1-5 spans the entire insole width — scale to 120% so it clearly
	// overshoots the boundary, then the insole clipper trims excess cleanly.
	const adaptiveU = clamp01(Math.max(0.72, Math.min(0.85, bestBin.u + 0.01)));
	const adaptiveV = clamp01(insoleMinV + insoleWidthNorm * 0.5); // centred
	const baseWidthMm = Math.max(50, insoleWidthAtSliceMm * 1.2);
	const aspect =
		(item?.stlSizeMm?.[1] ?? 54.5) /
		Math.max(1e-6, item?.stlSizeMm?.[0] ?? 87.1);
	// SA rechts 1-5 should only cover ~60% of the forefoot length
	const lengthScale = item?.key === 'sa-rechts-1-5' ? 0.6 : 1.0;
	const baseLengthMm = Math.max(28, baseWidthMm * aspect * lengthScale);

	return {
		positionU: clamp01(adaptiveU + deltaU),
		positionV: clamp01(adaptiveV + deltaV),
		rotationRad: 0 + deltaRotation,
		targetWidthMm: baseWidthMm,
		targetLengthMm: baseLengthMm,
	};
}

function resolveAdaptiveSd1Layout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
): ResolvedElementLayout {
	const {
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
	} = context;

	const defaults = getDefaultPlacementForSide(item, el.side);
	const deltaU = el.positionU - defaults.positionU;
	const deltaV = el.positionV - defaults.positionV;
	const deltaRotation = el.rotationRad - defaults.rotationRad;

	// Profile the forefoot to find the met-1 (big toe) medial edge
	const BINS = 36;
	const bins = Array.from({ length: BINS }, (_, index) => ({
		u: (index + 0.5) / BINS,
		minV: Infinity,
		maxV: -Infinity,
		count: 0,
	}));

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const rawU = (lengthVal - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		if (u < 0.58 || u > 0.94) continue;
		const v = (widthVal - widthMin) / Math.max(widthSpan, 1e-6);
		const binIndex = Math.max(0, Math.min(BINS - 1, Math.floor(u * BINS)));
		const bin = bins[binIndex];
		if (v < bin.minV) bin.minV = v;
		if (v > bin.maxV) bin.maxV = v;
		bin.count++;
	}

	// Pick the widest forefoot slice around U≈0.82
	let bestBin: (typeof bins)[number] | null = null;
	let bestScore = -Infinity;
	for (const bin of bins) {
		if (
			bin.count < 8 ||
			!Number.isFinite(bin.minV) ||
			!Number.isFinite(bin.maxV)
		)
			continue;
		const widthNorm = bin.maxV - bin.minV;
		if (widthNorm < 0.12) continue;
		const forefootBias = Math.max(0, 1 - Math.abs(bin.u - 0.82) / 0.12);
		const score = widthNorm * (0.55 + forefootBias);
		if (score > bestScore) {
			bestScore = score;
			bestBin = bin;
		}
	}

	if (!bestBin) {
		return {
			positionU: clamp01(el.positionU),
			positionV: clamp01(el.positionV),
			rotationRad: el.rotationRad,
		};
	}

	const localWidthNorm = Math.max(0.14, bestBin.maxV - bestBin.minV);
	const localWidthMm = (localWidthNorm * widthSpan) / Math.max(mmToWorld, 1e-6);

	// SD 1 snaps to the medial edge of the insole (big toe side).
	// For right foot: medial = low V. For left foot: medial = high V.
	// Place centre so the pad sits against the edge; the clipper trims overflow.
	const medialEdge = el.side === 'right' ? bestBin.minV : bestBin.maxV;
	// Diep-rond: position at second toe (~25% from edge), others: near edge (10%)
	// Deep inset variants sit around the second toe (~25% from edge),
	// while regular met-1 pads stay close to the silhouette.
	const insetNorm =
		item?.key === 'diep-rond' || item?.key === 'diep-ovaal' ? 0.25 : 0.1;
	const adaptiveU = clamp01(Math.max(0.74, Math.min(0.9, bestBin.u + 0.01)));
	const adaptiveV =
		el.side === 'right'
			? clamp01(medialEdge + localWidthNorm * insetNorm)
			: clamp01(medialEdge - localWidthNorm * insetNorm);

	// Size: keep the natural proportions, scale width to ~30% of local forefoot width
	const baseWidthMm = Math.max(15, localWidthMm * 0.35);
	const aspect =
		(item?.stlSizeMm?.[1] ?? 20.3) /
		Math.max(1e-6, item?.stlSizeMm?.[0] ?? 25.4);
	// SA Recht 1 should only cover ~60% of the forefoot length
	const sd1LengthScale = item?.key === 'sa-recht-1' ? 0.6 : 1.0;
	const baseLengthMm = Math.max(12, baseWidthMm * aspect * sd1LengthScale);

	return {
		positionU: clamp01(adaptiveU + deltaU),
		positionV: clamp01(adaptiveV + deltaV),
		rotationRad: 0 + deltaRotation,
		targetWidthMm: baseWidthMm,
		targetLengthMm: baseLengthMm,
	};
}

/**
 * Shared adaptive layout for all RCTB variants.
 * All use the same base STL but with different width/length coverage and V offset.
 *
 *  - widthFactor:  portion of insole width the element should span (1.2 = 120% = full + overshoot)
 *  - lengthFactor: multiplier applied to the natural aspect-ratio length
 *  - vCenterBias:  0.5 = centred, higher = more medial (toward arch side)
 */
function resolveAdaptiveRctbLayout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
	opts: { widthFactor: number; lengthFactor: number; vCenterBias: number },
): ResolvedElementLayout {
	const {
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
	} = context;

	const defaults = getDefaultPlacementForSide(item, el.side);
	const deltaU = el.positionU - defaults.positionU;
	const deltaV = el.positionV - defaults.positionV;
	const deltaRotation = el.rotationRad - defaults.rotationRad;

	// Profile the midfoot region (U ≈ 0.25 – 0.65) to find the widest slice
	const BINS = 40;
	const bins = Array.from({ length: BINS }, (_, index) => ({
		u: (index + 0.5) / BINS,
		minV: Infinity,
		maxV: -Infinity,
		count: 0,
	}));

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const rawU = (lengthVal - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		if (u < 0.25 || u > 0.65) continue;
		const v = (widthVal - widthMin) / Math.max(widthSpan, 1e-6);
		const binIndex = Math.max(0, Math.min(BINS - 1, Math.floor(u * BINS)));
		const bin = bins[binIndex];
		if (v < bin.minV) bin.minV = v;
		if (v > bin.maxV) bin.maxV = v;
		bin.count++;
	}

	// Pick the widest midfoot cross-section around U≈0.45
	let bestBin: (typeof bins)[number] | null = null;
	let bestScore = -Infinity;
	for (const bin of bins) {
		if (
			bin.count < 8 ||
			!Number.isFinite(bin.minV) ||
			!Number.isFinite(bin.maxV)
		)
			continue;
		const widthNorm = bin.maxV - bin.minV;
		if (widthNorm < 0.1) continue;
		const midfootBias = Math.max(0, 1 - Math.abs(bin.u - 0.45) / 0.18);
		const score = widthNorm * (0.5 + midfootBias);
		if (score > bestScore) {
			bestScore = score;
			bestBin = bin;
		}
	}

	if (!bestBin) {
		return {
			positionU: clamp01(el.positionU),
			positionV: clamp01(el.positionV),
			rotationRad: el.rotationRad,
		};
	}

	// Full insole width at this cross-section
	const insoleMinV = bestBin.minV;
	const insoleMaxV = bestBin.maxV;
	const insoleWidthNorm = Math.max(0.2, insoleMaxV - insoleMinV);
	const insoleWidthAtSliceMm =
		(insoleWidthNorm * widthSpan) / Math.max(mmToWorld, 1e-6);

	const adaptiveU = clamp01(Math.max(0.35, Math.min(0.55, bestBin.u)));
	// vCenterBias shifts the element medially (>0.5) or laterally (<0.5)
	const adaptiveV = clamp01(insoleMinV + insoleWidthNorm * opts.vCenterBias);
	const baseWidthMm = Math.max(40, insoleWidthAtSliceMm * opts.widthFactor);
	const aspect =
		(item?.stlSizeMm?.[1] ?? 82.4) /
		Math.max(1e-6, item?.stlSizeMm?.[0] ?? 86.6);
	const baseLengthMm = Math.max(25, baseWidthMm * aspect * opts.lengthFactor);

	return {
		positionU: clamp01(adaptiveU + deltaU),
		positionV: clamp01(adaptiveV + deltaV),
		rotationRad: 0 + deltaRotation,
		targetWidthMm: baseWidthMm,
		targetLengthMm: baseLengthMm,
	};
}

// All RCTB variants share the same footprint — differences come from vertex
// deformation, not from scaling.  Width overshoots 120% for clean insole clipping.
const RCTB_PARAMS: Record<
	string,
	{ widthFactor: number; lengthFactor: number; vCenterBias: number }
> = {
	'rctb-3': { widthFactor: 1.2, lengthFactor: 0.7, vCenterBias: 0.5 },
	'rctb-2': { widthFactor: 1.2, lengthFactor: 0.7, vCenterBias: 0.5 },
	'rctb-1': { widthFactor: 1.2, lengthFactor: 0.7, vCenterBias: 0.5 },
	'rctb-pronatie': { widthFactor: 1.2, lengthFactor: 0.7, vCenterBias: 0.5 },
	'peloitte-2': { widthFactor: 0.55, lengthFactor: 0.9, vCenterBias: 0.5 },
};

// ── RCTB per-variant vertex deformation ─────────────────────────────────────
//
// All variants start from the RCTB 3 mesh and apply localised height
// modifications.  The deformation functions receive normalised coordinates:
//   nu: 0→1 across element width  (right foot: 0=lateral, 1=medial)
//   nv: 0→1 along element length  (0=heel-side edge, 1=toe-side edge)
// They return ADDITIONAL height in mm at that point.

/** Smooth radial bump centred at (cx,cy) with standard deviation sigma */
function gaussianBump(
	x: number,
	y: number,
	cx: number,
	cy: number,
	sigma: number,
): number {
	const dx = x - cx,
		dy = y - cy;
	return Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
}

type RctbDeformFn = (nu: number, nv: number, side: 'left' | 'right') => number;

const RCTB_DEFORM: Record<string, RctbDeformFn> = {
	// RCTB 3 — baseline, no deformation
	'rctb-3': () => 0,

	// RCTB 2 — moderate enhancement: raised central arch + top-right boost
	'rctb-2': (nu, nv) => {
		const archRaise = gaussianBump(nu, nv, 0.5, 0.5, 0.3) * 0.8;
		const upperBoost = gaussianBump(nu, nv, 0.65, 0.62, 0.22) * 0.5;
		return archRaise + upperBoost;
	},

	// RCTB 1 — strong enhancement: higher arch, spread, lateral→medial slope
	'rctb-1': (nu, nv) => {
		const archRaise = gaussianBump(nu, nv, 0.5, 0.48, 0.32) * 1.5;
		const upperRight = gaussianBump(nu, nv, 0.72, 0.55, 0.25) * 1.0;
		const slope = nu * 0.5; // gradual lateral → medial slope
		return archRaise + upperRight + slope;
	},

	// RCTB Pronatie — strong asymmetric medial raise for pronation correction
	'rctb-pronatie': (nu, nv, side) => {
		// Medial side: higher nu for right foot, lower nu for left
		const medialNu = side === 'right' ? nu : 1 - nu;
		const medialRaise = medialNu * medialNu * 2.2;
		const centerBoost = gaussianBump(nu, nv, 0.5, 0.5, 0.32) * 0.5;
		return medialRaise + centerBoost;
	},
};

// ── SPSA Vlak adaptive layout ───────────────────────────────────────────────
//
// The SPSA Vlak is a large heel-through-arch stabiliser covering the medial
// half of the insole from the very heel up through the arch (~55 % of length).
// Right foot: medial = low V (minV).  Left foot: medial = high V (maxV).
// The element overshoots to the medial edge and relies on insole boundary
// clipping to trim it flush.

function resolveAdaptiveSpsaVlakLayout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
): ResolvedElementLayout {
	const {
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
	} = context;

	const defaults = getDefaultPlacementForSide(item, el.side);
	const deltaU = el.positionU - defaults.positionU;
	const deltaV = el.positionV - defaults.positionV;
	const deltaRotation = el.rotationRad - defaults.rotationRad;

	// Profile the heel-to-arch region (U ≈ 0.02 – 0.65)
	const BINS = 40;
	const bins = Array.from({ length: BINS }, (_, index) => ({
		u: (index + 0.5) / BINS,
		minV: Infinity,
		maxV: -Infinity,
		count: 0,
	}));

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const rawU = (lengthVal - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		if (u < 0.02 || u > 0.65) continue;
		const v = (widthVal - widthMin) / Math.max(widthSpan, 1e-6);
		const binIndex = Math.max(0, Math.min(BINS - 1, Math.floor(u * BINS)));
		const bin = bins[binIndex];
		if (v < bin.minV) bin.minV = v;
		if (v > bin.maxV) bin.maxV = v;
		bin.count++;
	}

	// Find the widest heel-arch cross-section around U≈0.28
	let bestBin: (typeof bins)[number] | null = null;
	let bestScore = -Infinity;
	for (const bin of bins) {
		if (
			bin.count < 8 ||
			!Number.isFinite(bin.minV) ||
			!Number.isFinite(bin.maxV)
		)
			continue;
		const widthNorm = bin.maxV - bin.minV;
		if (widthNorm < 0.1) continue;
		const heelArchBias = Math.max(0, 1 - Math.abs(bin.u - 0.28) / 0.25);
		const score = widthNorm * (0.5 + heelArchBias);
		if (score > bestScore) {
			bestScore = score;
			bestBin = bin;
		}
	}

	if (!bestBin) {
		return {
			positionU: clamp01(el.positionU),
			positionV: clamp01(el.positionV),
			rotationRad: el.rotationRad,
		};
	}

	const insoleMinV = bestBin.minV;
	const insoleMaxV = bestBin.maxV;
	const insoleWidthNorm = Math.max(0.2, insoleMaxV - insoleMinV);
	const insoleWidthAtSliceMm =
		(insoleWidthNorm * widthSpan) / Math.max(mmToWorld, 1e-6);
	const insoleLengthMm = lengthSpan / Math.max(mmToWorld, 1e-6);

	// Centre at U ≈ 0.26 (biased toward heel so the mesh overshoots the heel tip
	// and the contour clipper can trim it flush)
	const adaptiveU = clamp01(Math.max(0.2, Math.min(0.32, bestBin.u)));

	// Position on the lateral half – centre close to the lateral edge (5th toe
	// side) so the element is flush against it.  Boundary clipping trims overshoot.
	// Right foot: lateral = high V (maxV).  Left foot: lateral = low V (minV).
	const lateralEdge = el.side === 'right' ? insoleMaxV : insoleMinV;
	const insetFraction = 0.22;
	const adaptiveV =
		el.side === 'right'
			? clamp01(lateralEdge - insoleWidthNorm * insetFraction)
			: clamp01(lateralEdge + insoleWidthNorm * insetFraction);

	// Width: 120% overshoot of insole width for clean edge clipping
	const baseWidthMm = Math.max(40, insoleWidthAtSliceMm * 1.2);
	// Length: ~80% of total insole length — generous overshoot past the heel tip
	// so the contour clipper has material to trim flush with no gaps
	const baseLengthMm = Math.max(80, insoleLengthMm * 0.8);

	return {
		positionU: clamp01(adaptiveU + deltaU),
		positionV: clamp01(adaptiveV + deltaV),
		rotationRad: 0 + deltaRotation,
		targetWidthMm: baseWidthMm,
		targetLengthMm: baseLengthMm,
	};
}

// ── PPSA adaptive layout ────────────────────────────────────────────────────
//
// The PPSA is the mirror of SPSA Vlak — same heel-through-arch stabiliser but
// placed on the medial (1st toe / arch) side instead of the lateral side.
// Right foot: medial = low V (minV).  Left foot: medial = high V (maxV).

function resolveAdaptivePpsaLayout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
): ResolvedElementLayout {
	const {
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
	} = context;

	const defaults = getDefaultPlacementForSide(item, el.side);
	const deltaU = el.positionU - defaults.positionU;
	const deltaV = el.positionV - defaults.positionV;
	const deltaRotation = el.rotationRad - defaults.rotationRad;

	// Profile the heel-to-arch region (U ≈ 0.02 – 0.65)
	const BINS = 40;
	const bins = Array.from({ length: BINS }, (_, index) => ({
		u: (index + 0.5) / BINS,
		minV: Infinity,
		maxV: -Infinity,
		count: 0,
	}));

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const rawU = (lengthVal - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		if (u < 0.02 || u > 0.65) continue;
		const v = (widthVal - widthMin) / Math.max(widthSpan, 1e-6);
		const binIndex = Math.max(0, Math.min(BINS - 1, Math.floor(u * BINS)));
		const bin = bins[binIndex];
		if (v < bin.minV) bin.minV = v;
		if (v > bin.maxV) bin.maxV = v;
		bin.count++;
	}

	let bestBin: (typeof bins)[number] | null = null;
	let bestScore = -Infinity;
	for (const bin of bins) {
		if (
			bin.count < 8 ||
			!Number.isFinite(bin.minV) ||
			!Number.isFinite(bin.maxV)
		)
			continue;
		const widthNorm = bin.maxV - bin.minV;
		if (widthNorm < 0.1) continue;
		const heelArchBias = Math.max(0, 1 - Math.abs(bin.u - 0.28) / 0.25);
		const score = widthNorm * (0.5 + heelArchBias);
		if (score > bestScore) {
			bestScore = score;
			bestBin = bin;
		}
	}

	if (!bestBin) {
		return {
			positionU: clamp01(el.positionU),
			positionV: clamp01(el.positionV),
			rotationRad: el.rotationRad,
		};
	}

	const insoleMinV = bestBin.minV;
	const insoleMaxV = bestBin.maxV;
	const insoleWidthNorm = Math.max(0.2, insoleMaxV - insoleMinV);
	const insoleWidthAtSliceMm =
		(insoleWidthNorm * widthSpan) / Math.max(mmToWorld, 1e-6);
	const insoleLengthMm = lengthSpan / Math.max(mmToWorld, 1e-6);

	const adaptiveU = clamp01(Math.max(0.2, Math.min(0.32, bestBin.u)));

	// Position on the medial half – centre close to the medial edge (1st toe
	// / arch side).  Boundary clipping trims overshoot.
	// Right foot: medial = low V (minV).  Left foot: medial = high V (maxV).
	const medialEdge = el.side === 'right' ? insoleMinV : insoleMaxV;
	const insetFraction = 0.22;
	const adaptiveV =
		el.side === 'right'
			? clamp01(medialEdge + insoleWidthNorm * insetFraction)
			: clamp01(medialEdge - insoleWidthNorm * insetFraction);

	const baseWidthMm = Math.max(40, insoleWidthAtSliceMm * 1.2);
	const baseLengthMm = Math.max(80, insoleLengthMm * 0.8);

	return {
		positionU: clamp01(adaptiveU + deltaU),
		positionV: clamp01(adaptiveV + deltaV),
		rotationRad: 0 + deltaRotation,
		mirrorWidth: true,
		targetWidthMm: baseWidthMm,
		targetLengthMm: baseLengthMm,
	};
}

// ── SC Bol adaptive layout ──────────────────────────────────────────────────
//
// The SC Bol (schaal bol = bowl cup) covers the heel area of the insole,
// like a cup around the heel.  Scaled to overshoot all edges so the contour
// clipper trims it to the insole silhouette.

function resolveAdaptiveScBolLayout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
): ResolvedElementLayout {
	const {
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
	} = context;

	const defaults = getDefaultPlacementForSide(item, el.side);
	const deltaU = el.positionU - defaults.positionU;
	const deltaV = el.positionV - defaults.positionV;
	const deltaRotation = el.rotationRad - defaults.rotationRad;

	// Profile the heel region (U ≈ 0.02 – 0.50)
	const BINS = 40;
	const bins = Array.from({ length: BINS }, (_, index) => ({
		u: (index + 0.5) / BINS,
		minV: Infinity,
		maxV: -Infinity,
		count: 0,
	}));

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const rawU = (lengthVal - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		if (u < 0.02 || u > 0.5) continue;
		const v = (widthVal - widthMin) / Math.max(widthSpan, 1e-6);
		const binIndex = Math.max(0, Math.min(BINS - 1, Math.floor(u * BINS)));
		const bin = bins[binIndex];
		if (v < bin.minV) bin.minV = v;
		if (v > bin.maxV) bin.maxV = v;
		bin.count++;
	}

	// Find widest heel cross-section biased toward U≈0.20
	let bestBin: (typeof bins)[number] | null = null;
	let bestScore = -Infinity;
	for (const bin of bins) {
		if (
			bin.count < 8 ||
			!Number.isFinite(bin.minV) ||
			!Number.isFinite(bin.maxV)
		)
			continue;
		const widthNorm = bin.maxV - bin.minV;
		if (widthNorm < 0.1) continue;
		const heelBias = Math.max(0, 1 - Math.abs(bin.u - 0.2) / 0.2);
		const score = widthNorm * (0.5 + heelBias);
		if (score > bestScore) {
			bestScore = score;
			bestBin = bin;
		}
	}

	if (!bestBin) {
		return {
			positionU: clamp01(el.positionU),
			positionV: clamp01(el.positionV),
			rotationRad: el.rotationRad,
		};
	}

	const insoleMinV = bestBin.minV;
	const insoleMaxV = bestBin.maxV;
	const insoleWidthNorm = Math.max(0.2, insoleMaxV - insoleMinV);
	const insoleWidthAtSliceMm =
		(insoleWidthNorm * widthSpan) / Math.max(mmToWorld, 1e-6);
	const insoleLengthMm = lengthSpan / Math.max(mmToWorld, 1e-6);

	// Centre the bowl very low (U ≈ 0.08) so the mesh generously overshoots
	// the heel tip and the contour clipper trims it flush — no gap at the base
	const adaptiveU = clamp01(Math.max(0.06, Math.min(0.12, bestBin.u - 0.1)));
	const adaptiveV = clamp01(insoleMinV + insoleWidthNorm * 0.5);

	// Width: 130% overshoot so the contour clipper trims both side edges
	const baseWidthMm = Math.max(50, insoleWidthAtSliceMm * 1.3);
	// Length: ~27% of total insole length — just the heel cup
	const baseLengthMm = Math.max(40, insoleLengthMm * 0.27);

	return {
		positionU: clamp01(adaptiveU + deltaU),
		positionV: clamp01(adaptiveV + deltaV),
		rotationRad: 0 + deltaRotation,
		targetWidthMm: baseWidthMm,
		targetLengthMm: baseLengthMm,
	};
}

// ── SC Bol / PPSI / SPSI diagonal slope deformation ─────────────────────
//
// PPSI and SPSI are the same heel cup as SC Bol but with a 45° diagonal cut
// across the upper (toe-side) edge.
//   PPSI: medial side stays full height, lateral side is cut away
//   SPSI: lateral side stays full height, medial side is cut away
//
// The function returns a height MULTIPLIER (0–1) for each STL vertex.
//   nu: 0→1 across STL width  (right foot: 0=medial, 1=lateral)
//   nv: 0→1 along STL length  (0=heel edge, 1=toe edge)

type ScBolSlopeFn = (nu: number, nv: number, side: 'left' | 'right') => number;

const SC_BOL_SLOPE: Record<string, ScBolSlopeFn> = {
	// SC Bol — no slope, full bowl
	'sc-bol': () => 1,

	// PPSI — medial side stays high, lateral side gets cut at the toe edge
	ppsi: (nu, nv, side) => {
		// For right foot: nu=0 = medial.  Lateral fraction increases with nu.
		const lateralFrac = side === 'right' ? nu : 1 - nu;
		// Slope only affects the upper portion (toe-side edge, nv > 0.3)
		const nvInfluence = Math.max(0, (nv - 0.3) / 0.7);
		return Math.max(0, 1 - lateralFrac * nvInfluence);
	},

	// SPSI — lateral side stays high, medial side gets cut at the toe edge
	spsi: (nu, nv, side) => {
		const medialFrac = side === 'right' ? 1 - nu : nu;
		const nvInfluence = Math.max(0, (nv - 0.3) / 0.7);
		return Math.max(0, 1 - medialFrac * nvInfluence);
	},
};

// ── HAI Vlak 2 adaptive layout ───────────────────────────────────────────
//
// The HAI Vlak 2 is a tall narrow arch support pad placed on the medial side
// (1st toe / arch side) in the midfoot region.  It snaps to the medial edge
// and covers heel-through-midfoot.
// Right foot: medial = low V (minV).  Left foot: medial = high V (maxV).

function resolveAdaptiveHaiVlak2Layout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
): ResolvedElementLayout {
	const {
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
	} = context;

	const defaults = getDefaultPlacementForSide(item, el.side);
	const deltaU = el.positionU - defaults.positionU;
	const deltaV = el.positionV - defaults.positionV;
	const deltaRotation = el.rotationRad - defaults.rotationRad;

	// Profile the arch region (U ≈ 0.20 – 0.60)
	const BINS = 40;
	const bins = Array.from({ length: BINS }, (_, index) => ({
		u: (index + 0.5) / BINS,
		minV: Infinity,
		maxV: -Infinity,
		count: 0,
	}));

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const rawU = (lengthVal - lengthMin) / Math.max(lengthSpan, 1e-6);
		const u = heelAtMin ? rawU : 1 - rawU;
		if (u < 0.2 || u > 0.6) continue;
		const v = (widthVal - widthMin) / Math.max(widthSpan, 1e-6);
		const binIndex = Math.max(0, Math.min(BINS - 1, Math.floor(u * BINS)));
		const bin = bins[binIndex];
		if (v < bin.minV) bin.minV = v;
		if (v > bin.maxV) bin.maxV = v;
		bin.count++;
	}

	// Find widest cross-section around the arch (U≈0.42)
	let bestBin: (typeof bins)[number] | null = null;
	let bestScore = -Infinity;
	for (const bin of bins) {
		if (
			bin.count < 8 ||
			!Number.isFinite(bin.minV) ||
			!Number.isFinite(bin.maxV)
		)
			continue;
		const widthNorm = bin.maxV - bin.minV;
		if (widthNorm < 0.1) continue;
		const archBias = Math.max(0, 1 - Math.abs(bin.u - 0.42) / 0.2);
		const score = widthNorm * (0.5 + archBias);
		if (score > bestScore) {
			bestScore = score;
			bestBin = bin;
		}
	}

	if (!bestBin) {
		return {
			positionU: clamp01(el.positionU),
			positionV: clamp01(el.positionV),
			rotationRad: el.rotationRad,
		};
	}

	const insoleMinV = bestBin.minV;
	const insoleMaxV = bestBin.maxV;
	const insoleWidthNorm = Math.max(0.2, insoleMaxV - insoleMinV);
	const insoleWidthAtSliceMm =
		(insoleWidthNorm * widthSpan) / Math.max(mmToWorld, 1e-6);
	const insoleLengthMm = lengthSpan / Math.max(mmToWorld, 1e-6);

	// Centre at the arch (U ≈ 0.42)
	const adaptiveU = clamp01(Math.max(0.36, Math.min(0.48, bestBin.u)));

	// Snap to the medial edge (1st toe / arch side)
	// Right foot: medial = low V (minV).  Left foot: medial = high V (maxV).
	const medialEdge = el.side === 'right' ? insoleMinV : insoleMaxV;
	const insetFraction = 0.05;
	const adaptiveV =
		el.side === 'right'
			? clamp01(medialEdge + insoleWidthNorm * insetFraction)
			: clamp01(medialEdge - insoleWidthNorm * insetFraction);

	// Width: ~46% of insole width with overshoot for clipping
	const baseWidthMm = Math.max(22, insoleWidthAtSliceMm * 0.46);
	// Length: ~42% of total insole length (arch region)
	const baseLengthMm = Math.max(45, insoleLengthMm * 0.42);

	return {
		positionU: clamp01(adaptiveU + deltaU),
		positionV: clamp01(adaptiveV + deltaV),
		rotationRad: 0 + deltaRotation,
		targetWidthMm: baseWidthMm,
		targetLengthMm: baseLengthMm,
	};
}

function resolveElementLayout(
	item: ReturnType<typeof getElementByKey>,
	el: PlacedElement,
	context: PlacementContext,
): ResolvedElementLayout {
	if (item?.key === 'sd-2-5') {
		return resolveAdaptiveSd25Layout(item, el, context);
	}
	if (item?.key === 'sd-1-5' || item?.key === 'sa-rechts-1-5') {
		return resolveAdaptiveSd15Layout(item, el, context);
	}
	if (
		item?.key === 'sd-1' ||
		item?.key === 'sa-recht-1' ||
		item?.key === 'diep-rond' ||
		item?.key === 'diep-ovaal'
	) {
		return resolveAdaptiveSd1Layout(item, el, context);
	}
	if (item?.key === 'spsa-vlak') {
		return resolveAdaptiveSpsaVlakLayout(item, el, context);
	}
	if (item?.key === 'ppsa') {
		return resolveAdaptivePpsaLayout(item, el, context);
	}
	if (item?.key === 'sc-bol' || item?.key === 'ppsi' || item?.key === 'spsi') {
		return resolveAdaptiveScBolLayout(item, el, context);
	}
	if (item?.key === 'hai-vlak-2') {
		return resolveAdaptiveHaiVlak2Layout(item, el, context);
	}
	const rctbParams = item?.key ? RCTB_PARAMS[item.key] : undefined;
	if (rctbParams) {
		return resolveAdaptiveRctbLayout(item, el, context, rctbParams);
	}

	return {
		positionU: el.positionU,
		positionV: el.positionV,
		rotationRad: el.rotationRad,
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
	},
): void {
	if (!elements || elements.length === 0) return;

	const sortedElements = sortPlacedElementsByStack(elements);
	const mmToWorld = options?.mmToWorld ?? 1;
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
		let hasInset = false;
		for (const p of prepared) {
			if (
				p.heightWorld < 0 &&
				u >= p.bboxMinU &&
				u <= p.bboxMaxU &&
				v >= p.bboxMinV &&
				v <= p.bboxMaxV
			) {
				hasInset = true;
				break;
			}
		}

		if (!hasInset) {
			if (heightNorm < 0.6) continue;
		}
		const topWeight = hasInset ? 1.0 : smoothstep(0.6, 0.75, heightNorm);

		// Accumulate displacement from all elements
		let totalDisplacement = 0;

		for (const p of prepared) {
			if (isThicknessOnlyElement(p.item) && p.heightWorld > 0) continue;

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
			setAxisValue(
				positions,
				i,
				heightAxis,
				currentHeight + totalDisplacement * topWeight,
			);
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
}

export function buildElementOverlayGeometries(
	insoleGeometry: THREE.BufferGeometry,
	elements: PlacedElement[],
	options?: {
		mmToWorld?: number;
		/** Pre-loaded STL geometries keyed by URL (from catalog stlUrl) */
		stlGeometries?: Map<string, THREE.BufferGeometry>;
	},
): ElementOverlayData[] {
	if (!elements || elements.length === 0) return [];

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
	const SURFACE_EPSILON = 0.08 * mmToWorld;
	const INSET_OVERLAY_EPSILON = SURFACE_EPSILON * 0.35;

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
	};

	for (const el of sortedElements) {
		const item = getElementByKey(el.libraryKey);
		if (!item) continue;
		const floorMode = normalizeElementFloorMode(el.floorMode);
		const stackOrder = el.stackOrder ?? 0;
		const preferredStlUrl = getElementPreferredStlUrl(item);
		const resolved = resolveElementLayout(item, el, placementContext);
		const isInset = el.heightMm < 0;
		const baseSurfaceHeight =
			!isInset && floorMode !== 'sole'
				? sampleHeight(resolved.positionU, resolved.positionV)
				: undefined;

		// ── STL-based overlay (preferred when stlUrl is available) ──
		if (
			preferredStlUrl &&
			stlGeometries?.has(preferredStlUrl) &&
			!isInset &&
			!isThicknessOnlyElement(item)
		) {
			const srcGeom = stlGeometries.get(preferredStlUrl)!;
			const cachedDistanceField = getCachedStlDistanceField(
				srcGeom,
				Boolean(item.stlSwapYZ),
			);
			let geom = getPreparedOverlayStlGeometry(
				srcGeom,
				Boolean(item.stlSwapYZ),
			).clone();

			// The STL is in mm, centred at origin in X, Y starts at 0.
			// We need to:
			// 1. Scale from mm to world units
			// 2. Position at the element's UV placement on the insole
			// 3. Snap the bottom to the insole surface height

			const pos = geom.getAttribute('position') as THREE.BufferAttribute;
			const vtxCount = pos.count;
			const {
				sourceWidthMm,
				sourceLengthMm,
				sourceHeightMm,
				stlCenterX,
				stlCenterY,
				stlBaseZ,
				stlMinX,
				stlMinY,
				cellW,
				cellL,
				cellSizeMm,
				distGrid,
				gridSize,
			} = cachedDistanceField;

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

			// Wider blend zone (at least 8mm) for a gentle slope from the insole surface
			const blendMm = Math.max(8, el.blendMm * 1.6);
			const sampleEdgeFactor = (stlX: number, stlY: number): number => {
				const gx = Math.min(
					gridSize - 1,
					Math.max(0, (stlX - stlMinX) / cellW),
				);
				const gy = Math.min(
					gridSize - 1,
					Math.max(0, (stlY - stlMinY) / cellL),
				);
				// Bilinear sample
				const gxi = Math.min(gridSize - 2, Math.floor(gx));
				const gyi = Math.min(gridSize - 2, Math.floor(gy));
				const fx = gx - gxi,
					fy = gy - gyi;
				const d00 = distGrid[gyi * gridSize + gxi];
				const d10 = distGrid[gyi * gridSize + gxi + 1];
				const d01 = distGrid[(gyi + 1) * gridSize + gxi];
				const d11 = distGrid[(gyi + 1) * gridSize + gxi + 1];
				const dCells =
					d00 * (1 - fx) * (1 - fy) +
					d10 * fx * (1 - fy) +
					d01 * (1 - fx) * fy +
					d11 * fx * fy;
				const dMm = dCells * cellSizeMm;
				if (dMm >= blendMm) return 1.0;
				const t = dMm / blendMm;
				// Smooth quintic ease-in for a very gentle ramp
				const t3 = t * t * t;
				return t3 * (t * (t * 6 - 15) + 10);
			};

			// Where to place the element centre on the insole (world coords)
			const centreU = resolved.positionU;
			const centreV = resolved.positionV;
			const centreRawU = heelAtMin ? centreU : 1 - centreU;
			const centreLengthWorld = lengthMin + centreRawU * lengthSpan;
			const centreWidthWorld = widthMin + centreV * widthSpan;

			// Build rotation matrix for the element
			const cos = Math.cos(resolved.rotationRad);
			const sin = Math.sin(resolved.rotationRad);

			const insoleEdgeBlendMm = getAdditiveInsoleEdgeBlendMm(item.key);

			// Transform each vertex:
			// 1. Centre the STL at origin
			// 2. Scale mm → world
			// 3. Rotate
			// 4. Translate to world position
			// 5. Clip to insole boundary via shared utility
			for (let i = 0; i < vtxCount; i++) {
				// STL local coords (mm, centred)
				const rawX = pos.getX(i);
				const rawY = pos.getY(i);
				const localWidth = (rawX - stlCenterX) * scaleWidth;
				const localLength = (rawY - stlCenterY) * scaleLength;
				let rawLocalHeight = (pos.getZ(i) - stlBaseZ) * scaleHeight;

				// Per-variant regional deformation (e.g. RCTB 1/2/pronatie)
				const deformFn = item.key ? RCTB_DEFORM[item.key] : undefined;
				if (deformFn) {
					const nu = (rawX - stlMinX) / sourceWidthMm;
					const nv = (rawY - stlMinY) / sourceLengthMm;
					// Only deform the top surface — scale by relative Z height
					// so the bottom face stays flat on the insole
					const heightFrac = Math.max(
						0,
						(pos.getZ(i) - stlBaseZ) / sourceHeightMm,
					);
					const extraMm = deformFn(nu, nv, el.side);
					rawLocalHeight += extraMm * mmToWorld * heightFrac;
				}

				// Per-variant diagonal slope (SC Bol / PPSI / SPSI)
				const slopeFn = item.key ? SC_BOL_SLOPE[item.key] : undefined;
				if (slopeFn) {
					const nu = (rawX - stlMinX) / sourceWidthMm;
					const nv = (rawY - stlMinY) / sourceLengthMm;
					rawLocalHeight *= slopeFn(nu, nv, el.side);
				}

				// Apply smooth edge blend — taper height near the STL boundary
				const edgeFactor = sampleEdgeFactor(rawX, rawY);
				let localHeight: number;
				if (isInset) {
					// For inset elements: create a bowl shape using the edge distance.
					// edgeFactor = 0 at boundary, 1 deep inside.
					// Bowl depth = targetHeightMm at the centre, tapering to 0 at the edge.
					const depthWorld = targetHeightMm * mmToWorld;
					localHeight = depthWorld * edgeFactor;
				} else {
					localHeight = rawLocalHeight * edgeFactor;
				}

				// Rotate in the horizontal plane
				const rx = localWidth * cos - localLength * sin;
				const ry = localWidth * sin + localLength * cos;
				let worldWidth = centreWidthWorld + rx;
				let worldLength = centreLengthWorld + ry;
				const rawSampleU =
					(worldLength - lengthMin) / Math.max(lengthSpan, 1e-6);
				let sampleUValue = heelAtMin ? rawSampleU : 1 - rawSampleU;
				let sampleVValue = (worldWidth - widthMin) / Math.max(widthSpan, 1e-6);
				const sampleUClamped = Math.max(0, Math.min(1, sampleUValue));

				// ── Clip to insole boundary: V direction (width edges) ──
				const clip = clipVertexToInsole(
					sampleUClamped,
					sampleVValue,
					worldWidth,
					sampleInsoleExtent,
					widthMin,
					widthSpan,
					mmToWorld,
					insoleEdgeBlendMm,
					true,
				);
				sampleVValue = clip.clippedV;
				worldWidth = clip.clippedWorldWidth;
				localHeight *= clip.heightMultiplier;

				// ── Clip to insole boundary: U direction (heel/toe contour) ──
				const vForUClip = Math.max(0, Math.min(1, sampleVValue));
				const { minU: insoleMinUAtV, maxU: insoleMaxUAtV } =
					sampleInsoleUExtent(vForUClip);
				const distToHeelMm =
					((sampleUValue - insoleMinUAtV) * lengthSpan) /
					Math.max(mmToWorld, 1e-6);
				const distToToeMm =
					((insoleMaxUAtV - sampleUValue) * lengthSpan) /
					Math.max(mmToWorld, 1e-6);
				const distToUEdgeMm = Math.min(distToHeelMm, distToToeMm);
				if (distToUEdgeMm < 0) {
					const overshootMm = -distToUEdgeMm;
					const clampedU = Math.max(
						insoleMinUAtV,
						Math.min(insoleMaxUAtV, sampleUValue),
					);
					sampleUValue = clampedU;
					const clampedRawU = heelAtMin ? clampedU : 1 - clampedU;
					worldLength = lengthMin + clampedRawU * lengthSpan;
					const fadeSpan = insoleEdgeBlendMm * 2;
					if (overshootMm >= fadeSpan) {
						localHeight = 0;
					} else {
						localHeight *= quinticEase(1 - overshootMm / fadeSpan);
					}
				} else if (distToUEdgeMm < insoleEdgeBlendMm) {
					localHeight *= quinticEase(distToUEdgeMm / insoleEdgeBlendMm);
				}

				const sampleVClamped = Math.max(0, Math.min(1, sampleVValue));
				const sampleUFinal = Math.max(0, Math.min(1, sampleUValue));
				const surfaceH = sampleHeight(sampleUFinal, sampleVClamped);

				// Map local XY to insole axes
				const c: Record<string, number> = { x: 0, y: 0, z: 0 };
				c[widthAxis] = worldWidth;
				c[lengthAxis] = worldLength;
				// For inset elements: create the depression shape directly.
				// localHeight is 0 at edges, max at centre (due to edge blend).
				// Invert: at edges sit at surface, at centre push deepest into insole.
				c[heightAxis] = isInset
					? surfaceH - localHeight + SURFACE_EPSILON * 0.5
					: (floorMode === 'sole'
							? surfaceH
							: (baseSurfaceHeight ?? surfaceH)) +
						localHeight +
						SURFACE_EPSILON;

				pos.setXYZ(i, c.x, c.y, c.z);
			}

			if (floorMode !== 'sole') {
				const trimmedGeom = trimAdditiveOverlayGeometry({
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
				if (!trimmedGeom) {
					warnTrimFallbackOnce(el.id);
				} else {
					geom = trimmedGeom;
				}
			}

			pos.needsUpdate = true;
			geom = smoothElementOverlayGeometry(geom, mmToWorld);

			result.push({
				geometry: geom,
				colorHex: ELEMENT_COLORS[item.color] ?? '#999',
				elementId: el.id,
				stackOrder,
				isInset: false,
			});
			continue;
		}

		if (preferredStlUrl && !isInset && !stlGeometries?.has(preferredStlUrl)) {
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
					colorHex: ELEMENT_COLORS[item.color] ?? '#999',
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
				geometry: smoothElementOverlayGeometry(overlayGeom, mmToWorld),
				colorHex: ELEMENT_COLORS[item.color] ?? '#999',
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
			geometry: smoothElementOverlayGeometry(volumeGeom, mmToWorld),
			colorHex: ELEMENT_COLORS[item.color] ?? '#999',
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

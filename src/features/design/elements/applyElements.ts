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
import type { PlacedElement, ElementProfile } from './types';
import { getElementByKey, ELEMENT_COLORS } from './catalog';

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
	axis: string
): number {
	if (axis === 'x') return positions.getX(i);
	if (axis === 'y') return positions.getY(i);
	return positions.getZ(i);
}

function setAxisValue(
	positions: THREE.BufferAttribute,
	i: number,
	axis: string,
	value: number
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

function pointInPolygon(
	px: number,
	py: number,
	polygon: [number, number][]
): boolean {
	let inside = false;
	const n = polygon.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = polygon[i][0],
			yi = polygon[i][1];
		const xj = polygon[j][0],
			yj = polygon[j][1];
		if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/** Distance from point to closest polygon edge (approximate) */
function distToPolygonEdge(
	px: number,
	py: number,
	polygon: [number, number][]
): number {
	let minDist = Infinity;
	const n = polygon.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const ax = polygon[i][0],
			ay = polygon[i][1];
		const bx = polygon[j][0],
			by = polygon[j][1];
		// Project point onto segment
		const dx = bx - ax,
			dy = by - ay;
		const len2 = dx * dx + dy * dy;
		let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
		t = Math.max(0, Math.min(1, t));
		const cx = ax + t * dx,
			cy = ay + t * dy;
		const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
		if (dist < minDist) minDist = dist;
	}
	return minDist;
}

/* ── profile height functions ────────────────── */

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
	elementSizeV: number
): [number, number][] {
	const cos = Math.cos(el.rotationRad);
	const sin = Math.sin(el.rotationRad);

	return outline.map(([ox, oy]) => {
		// Centre the outline at origin (-0.5..+0.5)
		let lx = (ox - 0.5) * elementSizeU * el.scaleU;
		let ly = (oy - 0.5) * elementSizeV * el.scaleV;
		// Rotate
		const rx = lx * cos - ly * sin;
		const ry = lx * sin + ly * cos;
		// Translate to placement position
		return [el.positionU + rx, el.positionV + ry] as [number, number];
	});
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
	}
): void {
	if (!elements || elements.length === 0) return;

	const mmToWorld = options?.mmToWorld ?? 1;
	const axes = getGeometryAxes(geometry);
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = axes;

	const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
	const vertexCount = positions.count;

	const lengthMin = getMinForAxis(bbox, lengthAxis);
	const widthMin = getMinForAxis(bbox, widthAxis);
	const heightMax = getMaxForAxis(bbox, heightAxis);
	const heightMin = getMinForAxis(bbox, heightAxis);
	const heightSpan = heightMax - heightMin;

	// Infer heel direction (same heuristic as insoleCorrections)
	// Count vertices in first/last 20% of length to determine which end is wider
	let widthSumLow = 0,
		countLow = 0;
	let widthSumHigh = 0,
		countHigh = 0;
	const thresh = lengthSpan * 0.2;

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const normLen = lengthVal - lengthMin;
		if (normLen < thresh) {
			widthSumLow += Math.abs(widthVal - widthMin - widthSpan / 2);
			countLow++;
		} else if (normLen > lengthSpan - thresh) {
			widthSumHigh += Math.abs(widthVal - widthMin - widthSpan / 2);
			countHigh++;
		}
	}

	const avgLow = countLow > 0 ? widthSumLow / countLow : 0;
	const avgHigh = countHigh > 0 ? widthSumHigh / countHigh : 0;
	// Heel end is wider on average
	const heelAtMin = avgLow >= avgHigh;

	// Element default size in normalised UV space (fraction of insole)
	const ELEMENT_SIZE_U = 0.18; // ~18% of length
	const ELEMENT_SIZE_V = 0.22; // ~22% of width

	// Precompute transformed outlines and bounding boxes for each element
	const prepared = elements.map((el) => {
		const item = getElementByKey(el.libraryKey);
		const outline = item?.outline ?? [[0, 0] as [number, number]];
		const transformed = transformOutline(outline, el, ELEMENT_SIZE_U, ELEMENT_SIZE_V);

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

		return {
			el,
			item,
			transformed,
			profile: el.profile,
			heightWorld: el.heightMm * mmToWorld,
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
		if (heightNorm < 0.6) continue;
		const topWeight = smoothstep(0.6, 0.75, heightNorm);

		// Accumulate displacement from all elements
		let totalDisplacement = 0;

		for (const p of prepared) {
			// Early bounding-box reject
			if (u < p.bboxMinU || u > p.bboxMaxU || v < p.bboxMinV || v > p.bboxMaxV)
				continue;

			const inside = pointInPolygon(u, v, p.transformed);
			const edgeDist = distToPolygonEdge(u, v, p.transformed);

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
					weight = profileMultiplier(p.profile, 1 - 0.0) * (1 - smoothstep(0, 1, normEdgeDist));
				} else {
					continue;
				}
			}

			totalDisplacement += p.heightWorld * weight;
		}

		if (Math.abs(totalDisplacement) > 0.0001) {
			const currentHeight = getAxisValue(positions, i, heightAxis);
			setAxisValue(
				positions,
				i,
				heightAxis,
				currentHeight + totalDisplacement * topWeight
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
}

export function buildElementOverlayGeometries(
	insoleGeometry: THREE.BufferGeometry,
	elements: PlacedElement[],
	options?: { mmToWorld?: number }
): ElementOverlayData[] {
	if (!elements || elements.length === 0) return [];

	if (!insoleGeometry.getAttribute('normal')) {
		insoleGeometry.computeVertexNormals();
	}

	const axes = getGeometryAxes(insoleGeometry);
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = axes;
	const lengthMin = getMinForAxis(bbox, lengthAxis);
	const widthMin  = getMinForAxis(bbox, widthAxis);
	const heightMax = getMaxForAxis(bbox, heightAxis);
	const heightMin = getMinForAxis(bbox, heightAxis);
	const heightSpan = heightMax - heightMin;

	const positions = insoleGeometry.getAttribute('position') as THREE.BufferAttribute;
	const normals   = insoleGeometry.getAttribute('normal')   as THREE.BufferAttribute;
	const vertexCount = positions.count;

	// Detect which normal direction is "up" (toward the top surface)
	const normalIdx = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;
	const getNComp = (i: number): number => {
		if (normalIdx === 0) return normals.getX(i);
		if (normalIdx === 1) return normals.getY(i);
		return normals.getZ(i);
	};
	let signSum = 0, signCount = 0;
	const topThresh = heightMin + heightSpan * 0.8;
	for (let i = 0; i < vertexCount; i++) {
		if (getAxisValue(positions, i, heightAxis) >= topThresh) {
			signSum += getNComp(i); signCount++;
		}
	}
	const upSign = signCount > 0 && signSum / signCount < 0 ? -1 : 1;

	// Heel/toe direction
	let wSumLow = 0, cLow = 0, wSumHigh = 0, cHigh = 0;
	const thr = lengthSpan * 0.2;
	for (let i = 0; i < vertexCount; i++) {
		const lv = getAxisValue(positions, i, lengthAxis);
		const wv = getAxisValue(positions, i, widthAxis);
		const nl = lv - lengthMin;
		if (nl < thr) { wSumLow += Math.abs(wv - widthMin - widthSpan / 2); cLow++; }
		else if (nl > lengthSpan - thr) { wSumHigh += Math.abs(wv - widthMin - widthSpan / 2); cHigh++; }
	}
	const heelAtMin = (cLow > 0 ? wSumLow / cLow : 0) >= (cHigh > 0 ? wSumHigh / cHigh : 0);

	// Build a UV → max-surface-height lookup grid from top-facing vertices
	const GRID = 48;
	const heightGrid = new Float32Array(GRID * GRID).fill(heightMin);
	for (let i = 0; i < vertexCount; i++) {
		if (getNComp(i) * upSign < 0.1) continue; // skip sides / bottom
		const lv = getAxisValue(positions, i, lengthAxis);
		const wv = getAxisValue(positions, i, widthAxis);
		const hv = getAxisValue(positions, i, heightAxis);
		const rawU = (lv - lengthMin) / lengthSpan;
		const u = heelAtMin ? rawU : 1 - rawU;
		const v = (wv - widthMin) / widthSpan;
		const gu = Math.max(0, Math.min(GRID - 1, Math.floor(u * GRID)));
		const gv = Math.max(0, Math.min(GRID - 1, Math.floor(v * GRID)));
		if (hv > heightGrid[gu * GRID + gv]) heightGrid[gu * GRID + gv] = hv;
	}
	// Fill empty grid cells by spreading from neighbours
	for (let pass = 0; pass < 4; pass++) {
		for (let gu = 0; gu < GRID; gu++) {
			for (let gv = 0; gv < GRID; gv++) {
				const gi = gu * GRID + gv;
				if (heightGrid[gi] > heightMin) continue;
				let sum = 0, cnt = 0;
				for (const [du, dv] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
					const nu = gu+du, nv = gv+dv;
					if (nu>=0 && nu<GRID && nv>=0 && nv<GRID) {
						const ni = nu*GRID+nv;
						if (heightGrid[ni] > heightMin) { sum += heightGrid[ni]; cnt++; }
					}
				}
				if (cnt > 0) heightGrid[gi] = sum / cnt;
			}
		}
	}

	// Bilinear sample of the height grid at a UV point
	const sampleHeight = (u: number, v: number): number => {
		const gu = Math.max(0, Math.min(GRID - 0.001, u * GRID));
		const gv = Math.max(0, Math.min(GRID - 0.001, v * GRID));
		const gui = Math.floor(gu), guf = gu - gui;
		const gvi = Math.floor(gv), gvf = gv - gvi;
		const gui1 = Math.min(GRID-1, gui+1), gvi1 = Math.min(GRID-1, gvi+1);
		const h00 = heightGrid[gui * GRID + gvi];
		const h10 = heightGrid[gui1 * GRID + gvi];
		const h01 = heightGrid[gui * GRID + gvi1];
		const h11 = heightGrid[gui1 * GRID + gvi1];
		return h00*(1-guf)*(1-gvf) + h10*guf*(1-gvf) + h01*(1-guf)*gvf + h11*guf*gvf;
	};

	// Map UV + height to 3D world-space position
	const uvToWorld = (u: number, v: number, h: number): [number, number, number] => {
		const rawU = heelAtMin ? u : 1-u;
		const lw = lengthMin + rawU * lengthSpan;
		const ww = widthMin + v * widthSpan;
		const c: Record<string, number> = { x: 0, y: 0, z: 0 };
		c[lengthAxis] = lw; c[widthAxis] = ww; c[heightAxis] = h;
		return [c.x, c.y, c.z];
	};

	const mmToWorld    = options?.mmToWorld ?? 1;
	const LIFT         = 0.6 * mmToWorld; // mm above surface
	const ELEMENT_SIZE_U = 0.18;
	const ELEMENT_SIZE_V = 0.22;

	const result: ElementOverlayData[] = [];

	for (const el of elements) {
		const item = getElementByKey(el.libraryKey);
		if (!item) continue;

		const outline = transformOutline(item.outline, el, ELEMENT_SIZE_U, ELEMENT_SIZE_V);
		const n = outline.length;

		// Triangulate polygon correctly (handles concave shapes like crescent/horseshoe)
		const pts2d = outline.map(([u, v]) => new THREE.Vector2(u, v));
		let triIndices: number[];
		try {
			triIndices = THREE.ShapeUtils.triangulateShape(pts2d, []).flat();
		} catch {
			// Fallback: simple fan from vertex 0
			triIndices = [];
			for (let i = 1; i < n - 1; i++) triIndices.push(0, i, i + 1);
		}

		// Build world-space vertices, each snapped to insole surface + lift
		const verts: number[] = [];
		for (const [u, v] of outline) {
			const h = sampleHeight(u, v) + LIFT;
			verts.push(...uvToWorld(u, v, h));
		}

		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		geom.setIndex(triIndices);
		geom.computeVertexNormals();

		result.push({
			geometry: geom,
			colorHex: ELEMENT_COLORS[item.color] ?? '#999',
			elementId: el.id,
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
	}
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

	// Reuse the same axis detection as applyElements
	const axes = getGeometryAxes(geometry);
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = axes;

	const lengthMin = getMinForAxis(bbox, lengthAxis);
	const widthMin = getMinForAxis(bbox, widthAxis);
	const heightMax = getMaxForAxis(bbox, heightAxis);
	const heightMin = getMinForAxis(bbox, heightAxis);
	const heightSpan = heightMax - heightMin;

	// Heel direction (same heuristic as applyElements)
	let widthSumLow = 0, countLow = 0;
	let widthSumHigh = 0, countHigh = 0;
	const thresh = lengthSpan * 0.2;

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const normLen = lengthVal - lengthMin;
		if (normLen < thresh) {
			widthSumLow += Math.abs(widthVal - widthMin - widthSpan / 2);
			countLow++;
		} else if (normLen > lengthSpan - thresh) {
			widthSumHigh += Math.abs(widthVal - widthMin - widthSpan / 2);
			countHigh++;
		}
	}
	const heelAtMin = (countLow > 0 ? widthSumLow / countLow : 0) >= (countHigh > 0 ? widthSumHigh / countHigh : 0);

	// Same element size constants as applyElements so shapes align
	const ELEMENT_SIZE_U = 0.18;
	const ELEMENT_SIZE_V = 0.22;

	// Precompute transformed outlines + bounding boxes
	const prepared = elements.map((el) => {
		const item = getElementByKey(el.libraryKey);
		const outline = item?.outline ?? ([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]] as [number, number][]);
		const transformed = transformOutline(outline, el, ELEMENT_SIZE_U, ELEMENT_SIZE_V);
		const colorHex = item ? ELEMENT_COLORS[item.color] : '#999';
		const col = new THREE.Color(colorHex);

		// Bounding box for fast per-vertex reject
		let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
		for (const [u, v] of transformed) {
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}
		// Small UV margin for soft edge taper
		const edgeMargin = 0.012;
		return { transformed, color: col, minU: minU - edgeMargin, maxU: maxU + edgeMargin, minV: minV - edgeMargin, maxV: maxV + edgeMargin, edgeMargin };
	});

	// Use vertex normals to detect top surface (normal points in +heightAxis direction).
	// First detect which sign is "up" by averaging normals of the top-altitude vertices.
	const normals = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
	const normalIdx = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;

	const getHeightNormalRaw = (i: number): number => {
		if (!normals) return 1;
		if (normalIdx === 0) return normals.getX(i);
		if (normalIdx === 1) return normals.getY(i);
		return normals.getZ(i);
	};

	// Determine "up" sign: average normal component for the top-20% height vertices
	let normalSignSum = 0, normalSignCount = 0;
	const topThreshAbs = heightMin + heightSpan * 0.8;
	for (let i = 0; i < vertexCount; i++) {
		const hv = getAxisValue(positions, i, heightAxis);
		if (hv >= topThreshAbs) {
			normalSignSum += getHeightNormalRaw(i);
			normalSignCount++;
		}
	}
	// upSign = +1 if top surface normals are positive, -1 if they're negative
	const upSign = normalSignCount > 0 && normalSignSum / normalSignCount < 0 ? -1 : 1;

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

			const inside = pointInPolygon(u, v, p.transformed);

			let alpha: number;
			if (inside) {
				// Fully opaque inside — crisp solid pad
				alpha = 1.0;
			} else {
				// Soft taper just outside the polygon edge (tiny margin only)
				const edgeDist = distToPolygonEdge(u, v, p.transformed);
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

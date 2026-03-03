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
 *  applyElementColors
 *  Paints vertex colors on the geometry to visualise
 *  placed orthotic elements (like the competitor app).
 *
 *  Call on the *rendered* geometry (after corrections,
 *  thickness, rim height are applied).
 * ══════════════════════════════════════════════ */

/**
 * Compute the UV footprint for one placed element.
 * Returns the centre (cu, cv) and radii (ru, rv) of the ellipse
 * that represents the element on the insole.
 */
function getElementEllipse(
	el: PlacedElement,
	item: { outline: [number, number][]; defaultScale?: [number, number] } | undefined,
) {
	// Base element size as fraction of insole — large for bold competitor-style colors
	const BASE_U = 0.28;
	const BASE_V = 0.35;

	// Compute approximate outline radius from the library outline
	let outlineRadiusU = 0.4; // default: 80% of outline space
	let outlineRadiusV = 0.4;
	if (item?.outline && item.outline.length > 2) {
		let maxDx = 0, maxDy = 0;
		for (const [ox, oy] of item.outline) {
			maxDx = Math.max(maxDx, Math.abs(ox - 0.5));
			maxDy = Math.max(maxDy, Math.abs(oy - 0.5));
		}
		outlineRadiusU = maxDx || 0.4;
		outlineRadiusV = maxDy || 0.4;
	}

	const ru = BASE_U * outlineRadiusU * 2 * el.scaleU;
	const rv = BASE_V * outlineRadiusV * 2 * el.scaleV;

	return { cu: el.positionU, cv: el.positionV, ru, rv };
}

/**
 * Paint vertex colors on the geometry for each placed element.
 * Uses an ellipse-based approach for robust, visible results.
 * Colors ALL vertices (top + sides) for maximum visibility.
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

	// Detect geometry axes
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const sizeX = bbox.max.x - bbox.min.x;
	const sizeY = bbox.max.y - bbox.min.y;
	const sizeZ = bbox.max.z - bbox.min.z;

	// Sort axes by size: longest = length, middle = width, shortest = height
	const axes = [
		{ axis: 'x' as const, size: sizeX, min: bbox.min.x, max: bbox.max.x },
		{ axis: 'y' as const, size: sizeY, min: bbox.min.y, max: bbox.max.y },
		{ axis: 'z' as const, size: sizeZ, min: bbox.min.z, max: bbox.max.z },
	].sort((a, b) => b.size - a.size);

	const lengthInfo = axes[0]; // longest
	const widthInfo = axes[1];  // middle
	const heightInfo = axes[2]; // shortest (thickness)

	const getVal = (i: number, axis: 'x' | 'y' | 'z') => {
		if (axis === 'x') return positions.getX(i);
		if (axis === 'y') return positions.getY(i);
		return positions.getZ(i);
	};

	// Infer heel direction: the wider end is the heel
	let widthSumLow = 0, countLow = 0;
	let widthSumHigh = 0, countHigh = 0;
	const thresh20 = lengthInfo.size * 0.2;
	const widthCenter = widthInfo.min + widthInfo.size / 2;

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getVal(i, lengthInfo.axis);
		const widthVal = getVal(i, widthInfo.axis);
		const normLen = lengthVal - lengthInfo.min;
		if (normLen < thresh20) {
			widthSumLow += Math.abs(widthVal - widthCenter);
			countLow++;
		} else if (normLen > lengthInfo.size - thresh20) {
			widthSumHigh += Math.abs(widthVal - widthCenter);
			countHigh++;
		}
	}
	const avgLow = countLow > 0 ? widthSumLow / countLow : 0;
	const avgHigh = countHigh > 0 ? widthSumHigh / countHigh : 0;
	const heelAtMin = avgLow >= avgHigh;

	// Precompute element ellipses and colours
	const prepared = elements.map((el) => {
		const item = getElementByKey(el.libraryKey);
		const ellipse = getElementEllipse(el, item);
		const colorHex = item ? ELEMENT_COLORS[item.color] : '#999';
		const col = new THREE.Color(colorHex);

		// Blend zone around the ellipse (in UV space)
		const blendFrac = 0.50; // 50% extra around ellipse for wide smooth taper

		return {
			...ellipse,
			color: col,
			blendRu: ellipse.ru * (1 + blendFrac),
			blendRv: ellipse.rv * (1 + blendFrac),
		};
	});

	const tempColor = new THREE.Color();

	for (let i = 0; i < vertexCount; i++) {
		const lengthVal = getVal(i, lengthInfo.axis);
		const widthVal = getVal(i, widthInfo.axis);
		const heightVal = getVal(i, heightInfo.axis);

		// Normalise to 0-1 UV
		const rawU = (lengthVal - lengthInfo.min) / lengthInfo.size;
		const u = heelAtMin ? rawU : 1 - rawU; // 0 = heel, 1 = toe
		const v = (widthVal - widthInfo.min) / widthInfo.size;

		// Height weighting: top surface gets full colour, sides get partial
		const heightNorm = (heightVal - heightInfo.min) / (heightInfo.size || 1);
		// Top surface (heightNorm > 0.4): full colour. Bottom/sides: still 65% coloured.
		const surfaceWeight = heightNorm > 0.4 ? 1.0 : 0.65;

		// Check each element
		let bestAlpha = 0;
		let bestColor: THREE.Color | null = null;

		for (const p of prepared) {
			// Ellipse distance: (du/ru)^2 + (dv/rv)^2
			const du = u - p.cu;
			const dv = v - p.cv;

			// Check against outer blend boundary (fast reject)
			const normDistBlend = (du * du) / (p.blendRu * p.blendRu) + (dv * dv) / (p.blendRv * p.blendRv);
			if (normDistBlend > 1) continue; // outside blend zone

			// Check against inner ellipse
			const normDist = (du * du) / (p.ru * p.ru) + (dv * dv) / (p.rv * p.rv);

			let alpha: number;
			if (normDist <= 1) {
				// Inside the element ellipse — bold solid colour
				alpha = 0.95;
			} else {
				// In the blend zone — taper off
				const t = (Math.sqrt(normDist) - 1) / (Math.sqrt(normDistBlend) - 1 + 0.001);
				alpha = 0.95 * (1 - smoothstep(0, 1, Math.min(1, t)));
			}

			if (alpha > bestAlpha) {
				bestAlpha = alpha;
				bestColor = p.color;
			}
		}

		if (bestColor && bestAlpha > 0.01) {
			const finalAlpha = bestAlpha * surfaceWeight;
			tempColor.setRGB(
				colors[i * 3],
				colors[i * 3 + 1],
				colors[i * 3 + 2]
			);
			tempColor.lerp(bestColor, finalAlpha);
			colors[i * 3] = tempColor.r;
			colors[i * 3 + 1] = tempColor.g;
			colors[i * 3 + 2] = tempColor.b;
		}
	}

	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

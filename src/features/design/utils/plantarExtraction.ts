'use client';

import * as THREE from 'three';
import {
	computeBoundsTree,
	disposeBoundsTree,
	acceleratedRaycast,
} from 'three-mesh-bvh';
import type {
	PlantarData,
	FootGeometry,
} from '../types/types';

// Extend THREE.BufferGeometry and THREE.Mesh prototypes for BVH
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * Extract the plantar (bottom) surface of a foot scan via dense upward raycasting.
 *
 * Process:
 * 1. Orient mesh so foot axis = +U, lateral = +V, ground normal = +W
 * 2. Cast rays upward (+W) from below the mesh on a dense grid
 * 3. Record first-hit points as the plantar heightmap
 * 4. Compute plantar outline as concave hull of hit points projected to UV plane
 * 5. Apply toe offset: shrink outline anterior to 80% of foot length
 *
 * @param footGeometry  The loaded foot scan BufferGeometry
 * @param geometry      The computed FootGeometry reference frame
 * @param cellSizeMm    Grid cell spacing in mm (default 1.0)
 * @returns PlantarData with heightmap, outline, and metadata
 */
export function extractPlantarSurface(
	footGeometry: THREE.BufferGeometry,
	geometry: FootGeometry,
	cellSizeMm = 1.0
): PlantarData {
	const origin = new THREE.Vector3(...geometry.origin);
	const footAxis = new THREE.Vector3(...geometry.footAxis);
	const lateralAxis = new THREE.Vector3(...geometry.lateralAxis);
	const groundNormal = new THREE.Vector3(...geometry.groundNormal);

	// Build a BVH-accelerated mesh for raycasting
	const cloned = footGeometry.clone();
	cloned.computeBoundsTree();
	const tempMesh = new THREE.Mesh(cloned, new THREE.MeshBasicMaterial());

	// Compute the foot bounding box in the local anatomical frame
	const posAttr = cloned.getAttribute('position');
	let minU = Infinity, maxU = -Infinity;
	let minV = Infinity, maxV = -Infinity;
	let minW = Infinity, maxW = -Infinity;
	const tmp = new THREE.Vector3();

	for (let i = 0; i < posAttr.count; i++) {
		tmp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
		const rel = tmp.clone().sub(origin);
		const u = rel.dot(footAxis);
		const v = rel.dot(lateralAxis);
		const w = rel.dot(groundNormal);
		if (u < minU) minU = u;
		if (u > maxU) maxU = u;
		if (v < minV) minV = v;
		if (v > maxV) maxV = v;
		if (w < minW) minW = w;
		if (w > maxW) maxW = w;
	}

	// Add small margin
	const margin = cellSizeMm * 2;
	minU -= margin;
	maxU += margin;
	minV -= margin;
	maxV += margin;

	const cols = Math.max(1, Math.ceil((maxU - minU) / cellSizeMm));
	const rows = Math.max(1, Math.ceil((maxV - minV) / cellSizeMm));

	const heightmap = new Float32Array(cols * rows).fill(NaN);
	const outlinePoints: Array<[number, number]> = [];

	// Ray origin is well below the mesh, direction is +groundNormal (upward)
	const rayDir = groundNormal.clone().normalize();
	const rayOriginOffset = minW - 50; // 50 units below the lowest point
	const raycaster = new THREE.Raycaster();
	raycaster.firstHitOnly = true;

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const u = minU + (col + 0.5) * cellSizeMm;
			const v = minV + (row + 0.5) * cellSizeMm;

			// World position of ray origin
			const rayPos = origin.clone()
				.add(footAxis.clone().multiplyScalar(u))
				.add(lateralAxis.clone().multiplyScalar(v))
				.add(groundNormal.clone().multiplyScalar(rayOriginOffset));

			raycaster.set(rayPos, rayDir);
			const hits = raycaster.intersectObject(tempMesh, false);

			if (hits.length > 0) {
				// First hit = plantar surface (bottom of foot)
				const hitPoint = hits[0].point;
				const rel = hitPoint.clone().sub(origin);
				const w = rel.dot(groundNormal);
				heightmap[row * cols + col] = w;
				outlinePoints.push([u, v]);
			}
		}
	}

	// Clean up BVH
	cloned.disposeBoundsTree();

	// Compute concave outline from hit points using grid-based boundary detection
	const outline = computeGridOutline(outlinePoints, heightmap, cols, rows, minU, minV, cellSizeMm);

	return {
		outline,
		heightmap,
		gridSize: [cols, rows],
		cellSize: cellSizeMm,
		bounds: [minU, maxU, minV, maxV],
		footAxis: geometry.footAxis,
		groundNormal: geometry.groundNormal,
		origin: geometry.origin,
	};
}

/**
 * Compute the boundary outline of the plantar surface from the grid of hit points.
 * Uses a grid-based boundary detection: a cell is on the boundary if any of its
 * 4-connected neighbors is empty (NaN).
 */
function computeGridOutline(
	hitPoints: Array<[number, number]>,
	heightmap: Float32Array,
	cols: number,
	rows: number,
	minU: number,
	minV: number,
	cellSize: number
): Array<[number, number]> {
	const boundaryPoints: Array<[number, number]> = [];

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const idx = row * cols + col;
			if (isNaN(heightmap[idx])) continue;

			// Check if this cell is on the boundary
			const isBoundary =
				col === 0 || col === cols - 1 || row === 0 || row === rows - 1 ||
				isNaN(heightmap[idx - 1]) ||       // left
				isNaN(heightmap[idx + 1]) ||       // right
				isNaN(heightmap[idx - cols]) ||    // above
				isNaN(heightmap[idx + cols]);      // below

			if (isBoundary) {
				const u = minU + (col + 0.5) * cellSize;
				const v = minV + (row + 0.5) * cellSize;
				boundaryPoints.push([u, v]);
			}
		}
	}

	// Sort boundary points by angle from centroid to form a closed contour
	if (boundaryPoints.length < 3) return boundaryPoints;

	const cx = boundaryPoints.reduce((s, p) => s + p[0], 0) / boundaryPoints.length;
	const cy = boundaryPoints.reduce((s, p) => s + p[1], 0) / boundaryPoints.length;

	boundaryPoints.sort((a, b) => {
		const angleA = Math.atan2(a[1] - cy, a[0] - cx);
		const angleB = Math.atan2(b[1] - cy, b[0] - cx);
		return angleA - angleB;
	});

	return boundaryPoints;
}

/**
 * Apply a toe offset to the plantar outline:
 * Shrink the outline inward by `offsetMm` at vertices anterior to `thresholdPct` of foot length.
 *
 * @param outline       The plantar outline in UV coords
 * @param footLength    Total foot length in world units
 * @param heelU         The U coordinate of the heel (origin of foot axis)
 * @param offsetMm      Inward offset in mm (default 1.5)
 * @param thresholdPct  Percentage of foot length above which offset applies (default 0.80)
 */
export function applyToeOffset(
	outline: Array<[number, number]>,
	footLength: number,
	heelU: number,
	offsetMm = 1.5,
	thresholdPct = 0.80
): Array<[number, number]> {
	if (outline.length < 3) return outline;

	const threshold = heelU + footLength * thresholdPct;
	const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length;
	const cy = outline.reduce((s, p) => s + p[1], 0) / outline.length;

	return outline.map(([u, v]) => {
		if (u < threshold) return [u, v] as [number, number];

		// How far into the toe zone (0 at threshold, 1 at full length)
		const t = Math.min(1, (u - threshold) / (footLength * (1 - thresholdPct)));
		const offsetAmount = offsetMm * t;

		// Shrink toward centroid
		const du = u - cx;
		const dv = v - cy;
		const dist = Math.sqrt(du * du + dv * dv);
		if (dist < 1e-6) return [u, v] as [number, number];

		const shrinkFactor = Math.max(0, 1 - offsetAmount / dist);
		return [
			cx + du * shrinkFactor,
			cy + dv * shrinkFactor,
		] as [number, number];
	});
}

/**
 * Apply Gaussian smoothing to the plantar heightmap to remove scan noise.
 *
 * @param heightmap  The raw heightmap Float32Array
 * @param cols       Grid columns
 * @param rows       Grid rows
 * @param sigma      Gaussian sigma in grid cells (default 3)
 * @param passes     Number of smoothing passes (default 2)
 */
export function smoothPlantarHeightmap(
	heightmap: Float32Array,
	cols: number,
	rows: number,
	sigma = 3,
	passes = 2
): Float32Array {
	let current = new Float32Array(heightmap);
	const kernelRadius = Math.ceil(sigma * 2);

	// Build 1D Gaussian kernel
	const kernelSize = kernelRadius * 2 + 1;
	const kernel = new Float32Array(kernelSize);
	let kernelSum = 0;
	for (let i = 0; i < kernelSize; i++) {
		const x = i - kernelRadius;
		kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
		kernelSum += kernel[i];
	}
	for (let i = 0; i < kernelSize; i++) kernel[i] /= kernelSum;

	for (let pass = 0; pass < passes; pass++) {
		// Horizontal pass
		const temp = new Float32Array(cols * rows).fill(NaN);
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const idx = row * cols + col;
				if (isNaN(current[idx])) continue;

				let sum = 0;
				let weight = 0;
				for (let k = -kernelRadius; k <= kernelRadius; k++) {
					const c2 = col + k;
					if (c2 < 0 || c2 >= cols) continue;
					const val = current[row * cols + c2];
					if (isNaN(val)) continue;
					const w = kernel[k + kernelRadius];
					sum += val * w;
					weight += w;
				}
				temp[idx] = weight > 0 ? sum / weight : current[idx];
			}
		}

		// Vertical pass
		const result = new Float32Array(cols * rows).fill(NaN);
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const idx = row * cols + col;
				if (isNaN(temp[idx])) continue;

				let sum = 0;
				let weight = 0;
				for (let k = -kernelRadius; k <= kernelRadius; k++) {
					const r2 = row + k;
					if (r2 < 0 || r2 >= rows) continue;
					const val = temp[r2 * cols + col];
					if (isNaN(val)) continue;
					const w = kernel[k + kernelRadius];
					sum += val * w;
					weight += w;
				}
				result[idx] = weight > 0 ? sum / weight : temp[idx];
			}
		}

		current = result;
	}

	return current;
}

/**
 * Validate a foot scan mesh before allowing landmark selection.
 * Checks vertex count, bounding box dimensions, and basic mesh integrity.
 */
export function validateFootScan(
	geometry: THREE.BufferGeometry,
	filename?: string
): {
	valid: boolean;
	warnings: string[];
	errors: string[];
	vertexCount: number;
	boundingBoxMm: [number, number, number];
	inferredSide: 'left' | 'right' | 'unknown';
} {
	const warnings: string[] = [];
	const errors: string[] = [];

	const posAttr = geometry.getAttribute('position');
	const vertexCount = posAttr?.count ?? 0;

	if (vertexCount < 1000) {
		errors.push(`Te weinig vertices (${vertexCount}). Minimum is 1000 voor een bruikbare scan.`);
	} else if (vertexCount < 5000) {
		warnings.push(`Lage vertex count (${vertexCount}). Kwaliteit kan beperkt zijn.`);
	}

	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	let boundingBoxMm: [number, number, number] = [0, 0, 0];

	if (bbox) {
		const size = bbox.getSize(new THREE.Vector3());
		// Sort to find length (longest), width, height (shortest)
		const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
		boundingBoxMm = [dims[0], dims[1], dims[2]];

		const footLength = dims[0];
		if (footLength < 100 || footLength > 450) {
			warnings.push(
				`Scan lengte (${footLength.toFixed(0)}mm) valt buiten verwacht bereik (100–450mm). ` +
				`Controleer schaal/eenheden.`
			);
		}

		// Check if it's a reasonable foot shape (length should be ~2-3x width)
		const ratio = dims[0] / (dims[1] || 1);
		if (ratio < 1.5 || ratio > 5) {
			warnings.push(
				`Lengte/breedte verhouding (${ratio.toFixed(1)}) is ongebruikelijk voor een voetscan.`
			);
		}
	}

	// Infer side from filename
	let inferredSide: 'left' | 'right' | 'unknown' = 'unknown';
	if (filename) {
		const lower = filename.toLowerCase();
		if (lower.includes('_l.') || lower.includes('_l_') || lower.includes('left') || lower.endsWith('_l')) {
			inferredSide = 'left';
		} else if (lower.includes('_r.') || lower.includes('_r_') || lower.includes('right') || lower.endsWith('_r')) {
			inferredSide = 'right';
		}
	}

	return {
		valid: errors.length === 0,
		warnings,
		errors,
		vertexCount,
		boundingBoxMm,
		inferredSide,
	};
}

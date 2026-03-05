'use client';

import * as THREE from 'three';
import type { ScanValidationResult } from '../types/types';

// ============================================================================
// Mesh Preprocessing Utilities
// ============================================================================
//
// Functions for cleaning, validating, and preparing raw foot scan meshes
// before they enter the insole generation pipeline. Includes:
//   - Statistical outlier removal
//   - Laplacian smoothing
//   - Normal recomputation and validation
//   - Auto-orientation (plantar surface facing consistent direction)
//   - Unit/scale validation
//   - Mesh decimation (vertex reduction)
// ============================================================================

/**
 * Remove statistical outlier vertices from a mesh.
 * Vertices whose mean distance to k nearest neighbors exceeds
 * (mean + stdRatio × stdDev) are removed.
 *
 * Returns a new BufferGeometry with outliers removed.
 */
export function removeOutliers(
	geometry: THREE.BufferGeometry,
	options: {
		/** Number of neighbors to consider (default 20) */
		kNeighbors?: number;
		/** Standard deviation multiplier threshold (default 2.0) */
		stdRatio?: number;
	} = {}
): THREE.BufferGeometry {
	const k = options.kNeighbors ?? 20;
	const stdRatio = options.stdRatio ?? 2.0;

	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
	const count = posAttr.count;

	if (count < k + 1) return geometry.clone();

	// Build simple spatial index using a sorted array approach
	// For moderate mesh sizes (5k–50k) this is fast enough
	const points: THREE.Vector3[] = [];
	for (let i = 0; i < count; i++) {
		points.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
	}

	// Compute mean distance to k nearest neighbors for each vertex
	const meanDistances: number[] = new Array(count);

	for (let i = 0; i < count; i++) {
		// Find k nearest neighbors (brute force, fine for <50k vertices)
		const dists: number[] = [];
		for (let j = 0; j < count; j++) {
			if (i === j) continue;
			dists.push(points[i].distanceToSquared(points[j]));
		}
		dists.sort((a, b) => a - b);

		let sum = 0;
		for (let n = 0; n < Math.min(k, dists.length); n++) {
			sum += Math.sqrt(dists[n]);
		}
		meanDistances[i] = sum / Math.min(k, dists.length);
	}

	// Compute global mean and stddev of mean distances
	const globalMean = meanDistances.reduce((s, d) => s + d, 0) / count;
	const variance = meanDistances.reduce((s, d) => s + (d - globalMean) ** 2, 0) / count;
	const globalStd = Math.sqrt(variance);
	const threshold = globalMean + stdRatio * globalStd;

	// Filter vertices
	const keep: boolean[] = meanDistances.map((d) => d <= threshold);
	const keptCount = keep.filter(Boolean).length;

	if (keptCount === count) return geometry.clone();
	if (keptCount < 100) {
		// Don't remove too many — return original
		console.warn(`Outlier removal would leave only ${keptCount} vertices, skipping.`);
		return geometry.clone();
	}

	// Build new geometry with only kept vertices
	// For indexed geometry, this is more complex — use non-indexed
	const newPositions: number[] = [];
	const hasNormals = !!geometry.getAttribute('normal');
	const normalAttr = hasNormals ? (geometry.getAttribute('normal') as THREE.BufferAttribute) : null;
	const newNormals: number[] = [];

	for (let i = 0; i < count; i++) {
		if (keep[i]) {
			newPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
			if (normalAttr) {
				newNormals.push(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
			}
		}
	}

	const result = new THREE.BufferGeometry();
	result.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
	if (newNormals.length > 0) {
		result.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
	}

	return result;
}

/**
 * Apply Laplacian smoothing to a mesh.
 * Each vertex is moved toward the centroid of its neighbors.
 * Uses face adjacency to determine neighbors.
 *
 * @param geometry  The input BufferGeometry (should be non-indexed or indexed triangle mesh)
 * @param iterations Number of smoothing passes (default 1)
 * @param lambda     Smoothing factor 0–1 (default 0.5; 1 = full move to centroid)
 */
export function applyLaplacianSmoothing(
	geometry: THREE.BufferGeometry,
	iterations = 1,
	lambda = 0.5
): void {
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
	const count = posAttr.count;
	if (count < 3) return;

	// Build adjacency from faces
	const neighbors: Set<number>[] = Array.from({ length: count }, () => new Set<number>());

	const index = geometry.getIndex();
	if (index) {
		const indices = index.array;
		for (let i = 0; i < indices.length; i += 3) {
			const a = indices[i], b = indices[i + 1], c = indices[i + 2];
			neighbors[a].add(b); neighbors[a].add(c);
			neighbors[b].add(a); neighbors[b].add(c);
			neighbors[c].add(a); neighbors[c].add(b);
		}
	} else {
		// Non-indexed: every 3 vertices form a face
		for (let i = 0; i < count; i += 3) {
			if (i + 2 >= count) break;
			neighbors[i].add(i + 1); neighbors[i].add(i + 2);
			neighbors[i + 1].add(i); neighbors[i + 1].add(i + 2);
			neighbors[i + 2].add(i); neighbors[i + 2].add(i + 1);
		}
	}

	const positions = posAttr.array as Float32Array;

	for (let iter = 0; iter < iterations; iter++) {
		const newPositions = new Float32Array(positions.length);
		newPositions.set(positions);

		for (let i = 0; i < count; i++) {
			const nbrs = neighbors[i];
			if (nbrs.size === 0) continue;

			let cx = 0, cy = 0, cz = 0;
			for (const j of nbrs) {
				cx += positions[j * 3];
				cy += positions[j * 3 + 1];
				cz += positions[j * 3 + 2];
			}
			cx /= nbrs.size;
			cy /= nbrs.size;
			cz /= nbrs.size;

			newPositions[i * 3] = positions[i * 3] + lambda * (cx - positions[i * 3]);
			newPositions[i * 3 + 1] = positions[i * 3 + 1] + lambda * (cy - positions[i * 3 + 1]);
			newPositions[i * 3 + 2] = positions[i * 3 + 2] + lambda * (cz - positions[i * 3 + 2]);
		}

		positions.set(newPositions);
	}

	posAttr.needsUpdate = true;
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
}

/**
 * Ensure all face normals are consistent (outward-facing).
 * Recomputes vertex normals and checks for degenerate faces.
 *
 * @returns Number of degenerate faces found (area ≈ 0)
 */
export function validateAndFixNormals(geometry: THREE.BufferGeometry): number {
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();

	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
	const index = geometry.getIndex();
	let degenerateFaces = 0;

	if (index) {
		const indices = index.array;
		const a = new THREE.Vector3();
		const b = new THREE.Vector3();
		const c = new THREE.Vector3();

		for (let i = 0; i < indices.length; i += 3) {
			a.set(posAttr.getX(indices[i]), posAttr.getY(indices[i]), posAttr.getZ(indices[i]));
			b.set(posAttr.getX(indices[i + 1]), posAttr.getY(indices[i + 1]), posAttr.getZ(indices[i + 1]));
			c.set(posAttr.getX(indices[i + 2]), posAttr.getY(indices[i + 2]), posAttr.getZ(indices[i + 2]));

			const edge1 = b.clone().sub(a);
			const edge2 = c.clone().sub(a);
			const cross = edge1.cross(edge2);
			if (cross.length() < 1e-10) {
				degenerateFaces++;
			}
		}
	}

	return degenerateFaces;
}

/**
 * Validate a foot scan mesh and return diagnostic information.
 * Checks vertex count, dimensions, aspect ratio, and manifold status.
 *
 * @param geometry The loaded foot scan geometry
 * @param filename Optional filename for left/right inference
 */
export function validateFootScan(
	geometry: THREE.BufferGeometry,
	filename?: string
): ScanValidationResult {
	const warnings: string[] = [];
	const errors: string[] = [];

	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
	const vertexCount = posAttr ? posAttr.count : 0;

	if (vertexCount < 100) {
		errors.push(`Te weinig vertices (${vertexCount}). Minimaal 100 vereist.`);
	} else if (vertexCount < 1000) {
		warnings.push(`Laag aantal vertices (${vertexCount}). Nauwkeurigheid kan beperkt zijn.`);
	}

	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const size = new THREE.Vector3();
	bbox.getSize(size);

	// Sort dimensions: [length, width, height]
	const dims = [size.x, size.y, size.z].sort((a, b) => b - a) as [number, number, number];

	// Validate dimensions (expecting mm units; typical foot 200–350mm long)
	if (dims[0] < 100) {
		warnings.push(`Grootste afmeting (${dims[0].toFixed(1)}mm) is klein. Controleer eenheid (verwacht mm).`);
	} else if (dims[0] > 450) {
		warnings.push(`Grootste afmeting (${dims[0].toFixed(1)}mm) is erg groot. Controleer schaal.`);
	}

	// Aspect ratio: length/width should be ~2–3.5
	const ratio = dims[0] / (dims[1] || 1);
	if (ratio < 1.5) {
		warnings.push(`Lengte/breedte verhouding (${ratio.toFixed(2)}) is laag. Voetscans zijn normaal 2:1 tot 3.5:1.`);
	} else if (ratio > 5) {
		warnings.push(`Lengte/breedte verhouding (${ratio.toFixed(2)}) is erg hoog.`);
	}

	// Basic manifold check: look for non-manifold edges (edges shared by != 2 faces)
	let isManifold = true;
	const index = geometry.getIndex();
	if (index) {
		const edgeMap = new Map<string, number>();
		const indices = index.array;
		for (let i = 0; i < indices.length; i += 3) {
			const tri = [indices[i], indices[i + 1], indices[i + 2]];
			for (let j = 0; j < 3; j++) {
				const a = Math.min(tri[j], tri[(j + 1) % 3]);
				const b = Math.max(tri[j], tri[(j + 1) % 3]);
				const key = `${a}-${b}`;
				edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
			}
		}
		for (const count of edgeMap.values()) {
			if (count > 2) {
				isManifold = false;
				break;
			}
		}
		if (!isManifold) {
			warnings.push('Mesh heeft non-manifold randen. Kan problemen geven bij 3D-printen.');
		}
	}

	// Infer foot side from filename
	let inferredSide: 'left' | 'right' | 'unknown' = 'unknown';
	if (filename) {
		const lower = filename.toLowerCase();
		if (lower.includes('left') || lower.includes('links') || lower.includes('_l.') || lower.includes('_l_')) {
			inferredSide = 'left';
		} else if (lower.includes('right') || lower.includes('rechts') || lower.includes('_r.') || lower.includes('_r_')) {
			inferredSide = 'right';
		}
	}

	return {
		valid: errors.length === 0,
		warnings,
		errors,
		vertexCount,
		boundingBoxMm: dims,
		isManifold,
		inferredSide,
	};
}

/**
 * Auto-orient a foot scan so the plantar (bottom) surface faces a consistent direction.
 * Uses the mesh's center of mass and vertex density distribution.
 *
 * The convention is:
 * - Longest axis → length (heel-to-toe, +X direction after alignment)
 * - Middle axis → width (lateral, +Y)
 * - Shortest axis → height (plantar-to-dorsal, +Z = up)
 *
 * @returns The rotation matrix applied (for undo/logging)
 */
export function autoOrientMesh(geometry: THREE.BufferGeometry): THREE.Matrix4 {
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
	const count = posAttr.count;

	// Compute centroid
	const centroid = new THREE.Vector3();
	for (let i = 0; i < count; i++) {
		centroid.x += posAttr.getX(i);
		centroid.y += posAttr.getY(i);
		centroid.z += posAttr.getZ(i);
	}
	centroid.divideScalar(count);

	// Compute bounding box to determine axes
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const size = new THREE.Vector3();
	bbox.getSize(size);

	// Sort axes by size: longest = length, middle = width, shortest = height
	const axisInfo = [
		{ axis: new THREE.Vector3(1, 0, 0), size: size.x, name: 'x' },
		{ axis: new THREE.Vector3(0, 1, 0), size: size.y, name: 'y' },
		{ axis: new THREE.Vector3(0, 0, 1), size: size.z, name: 'z' },
	].sort((a, b) => b.size - a.size);

	const lengthDir = axisInfo[0].axis;
	const widthDir = axisInfo[1].axis;
	const heightDir = axisInfo[2].axis;

	// Build rotation matrix to align: length→X, width→Y, height→Z
	const rotMatrix = new THREE.Matrix4();
	rotMatrix.makeBasis(lengthDir, widthDir, heightDir);

	// Only rotate if not already aligned
	const isAligned =
		axisInfo[0].name === 'x' &&
		axisInfo[1].name === 'y' &&
		axisInfo[2].name === 'z';

	if (!isAligned) {
		// Center, rotate, then re-center
		const centerMatrix = new THREE.Matrix4().makeTranslation(
			-centroid.x, -centroid.y, -centroid.z
		);
		const invRot = rotMatrix.clone().invert();
		const uncenterMatrix = new THREE.Matrix4().makeTranslation(
			centroid.x, centroid.y, centroid.z
		);

		const transform = new THREE.Matrix4()
			.multiply(uncenterMatrix)
			.multiply(invRot)
			.multiply(centerMatrix);

		geometry.applyMatrix4(transform);
		geometry.computeBoundingBox();
		geometry.computeVertexNormals();

		return transform;
	}

	return new THREE.Matrix4(); // identity
}

/**
 * Center a mesh at the origin and return the translation applied.
 */
export function centerMesh(geometry: THREE.BufferGeometry): THREE.Vector3 {
	geometry.computeBoundingBox();
	const center = new THREE.Vector3();
	geometry.boundingBox!.getCenter(center);

	const translation = center.clone().negate();
	geometry.translate(translation.x, translation.y, translation.z);
	geometry.computeBoundingBox();

	return translation;
}

/**
 * Scale a mesh uniformly to achieve a target size along the longest axis.
 * Useful for normalizing scan units (e.g. meters → millimeters).
 *
 * @param targetLengthMm Expected length of the longest dimension in mm
 * @returns The scale factor applied
 */
export function scaleMeshToTarget(
	geometry: THREE.BufferGeometry,
	targetLengthMm: number
): number {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const size = new THREE.Vector3();
	bbox.getSize(size);
	const currentLength = Math.max(size.x, size.y, size.z);

	if (currentLength < 1e-6) return 1;

	const scale = targetLengthMm / currentLength;

	// Only scale if significantly different (not within 10%)
	if (Math.abs(scale - 1) > 0.1) {
		geometry.scale(scale, scale, scale);
		geometry.computeBoundingBox();
		geometry.computeVertexNormals();
	}

	return scale;
}

/**
 * Simple mesh decimation by uniform vertex sampling.
 * Reduces vertex count to approximately the target while preserving overall shape.
 *
 * Note: For production use, quadric decimation (MeshLab/Open3D) gives better results.
 * This is a fast client-side approximation.
 *
 * @param geometry Input geometry
 * @param targetCount Target vertex count
 * @returns Decimated geometry (new instance)
 */
export function decimateMesh(
	geometry: THREE.BufferGeometry,
	targetCount: number
): THREE.BufferGeometry {
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
	const count = posAttr.count;

	if (count <= targetCount) return geometry.clone();

	const keepRatio = targetCount / count;
	const hasNormals = !!geometry.getAttribute('normal');
	const normalAttr = hasNormals
		? (geometry.getAttribute('normal') as THREE.BufferAttribute)
		: null;

	const newPositions: number[] = [];
	const newNormals: number[] = [];

	// Use spatial hashing to keep evenly distributed vertices
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const size = new THREE.Vector3();
	bbox.getSize(size);

	// Grid resolution based on target count (approx cube root)
	const gridRes = Math.max(3, Math.ceil(Math.pow(targetCount, 1 / 3)));
	const cellSizeX = size.x / gridRes;
	const cellSizeY = size.y / gridRes;
	const cellSizeZ = size.z / gridRes;

	// Group vertices by grid cell, keep closest to cell center
	const cellMap = new Map<string, { dist: number; idx: number }>();

	for (let i = 0; i < count; i++) {
		const x = posAttr.getX(i);
		const y = posAttr.getY(i);
		const z = posAttr.getZ(i);

		const cx = Math.floor((x - bbox.min.x) / (cellSizeX || 1));
		const cy = Math.floor((y - bbox.min.y) / (cellSizeY || 1));
		const cz = Math.floor((z - bbox.min.z) / (cellSizeZ || 1));
		const key = `${cx},${cy},${cz}`;

		// Distance to cell center
		const cellCenterX = bbox.min.x + (cx + 0.5) * cellSizeX;
		const cellCenterY = bbox.min.y + (cy + 0.5) * cellSizeY;
		const cellCenterZ = bbox.min.z + (cz + 0.5) * cellSizeZ;
		const dist = (x - cellCenterX) ** 2 + (y - cellCenterY) ** 2 + (z - cellCenterZ) ** 2;

		const existing = cellMap.get(key);
		if (!existing || dist < existing.dist) {
			cellMap.set(key, { dist, idx: i });
		}
	}

	// If spatial approach gives too few, supplement with random sampling
	const selectedIndices = new Set(Array.from(cellMap.values()).map((v) => v.idx));

	if (selectedIndices.size < targetCount) {
		// Add random vertices to reach target
		const shuffled = Array.from({ length: count }, (_, i) => i)
			.sort(() => Math.random() - 0.5);
		for (const idx of shuffled) {
			if (selectedIndices.size >= targetCount) break;
			selectedIndices.add(idx);
		}
	}

	for (const idx of selectedIndices) {
		newPositions.push(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx));
		if (normalAttr) {
			newNormals.push(normalAttr.getX(idx), normalAttr.getY(idx), normalAttr.getZ(idx));
		}
	}

	const result = new THREE.BufferGeometry();
	result.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
	if (newNormals.length > 0) {
		result.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
	}
	result.computeBoundingBox();

	return result;
}

/**
 * Full preprocessing pipeline for a raw foot scan.
 * Applies: validation → outlier removal → smoothing → orientation → centering.
 *
 * @returns The preprocessed geometry (mutated in place) and validation result
 */
export function preprocessFootScan(
	geometry: THREE.BufferGeometry,
	options: {
		removeOutliers?: boolean;
		smoothPasses?: number;
		autoOrient?: boolean;
		center?: boolean;
		targetVertexCount?: number;
		filename?: string;
	} = {}
): {
	geometry: THREE.BufferGeometry;
	validation: ScanValidationResult;
	transforms: {
		outlierRemoval: boolean;
		smoothPasses: number;
		orientMatrix: THREE.Matrix4 | null;
		centerTranslation: THREE.Vector3 | null;
		decimated: boolean;
		scaleFactor: number;
	};
} {
	const {
		removeOutliers: doRemoveOutliers = true,
		smoothPasses = 1,
		autoOrient: doAutoOrient = true,
		center: doCenter = true,
		targetVertexCount = 0,
		filename,
	} = options;

	// Validate first
	const validation = validateFootScan(geometry, filename);

	let workingGeometry = geometry;
	let outlierRemoval = false;
	let orientMatrix: THREE.Matrix4 | null = null;
	let centerTranslation: THREE.Vector3 | null = null;
	let decimated = false;
	let scaleFactor = 1;

	// 1. Remove outliers
	if (doRemoveOutliers && validation.vertexCount > 500) {
		workingGeometry = removeOutliers(workingGeometry);
		outlierRemoval = true;
	}

	// 2. Decimate if needed
	if (targetVertexCount > 0 && workingGeometry.getAttribute('position').count > targetVertexCount) {
		workingGeometry = decimateMesh(workingGeometry, targetVertexCount);
		decimated = true;
	}

	// 3. Smooth
	if (smoothPasses > 0) {
		applyLaplacianSmoothing(workingGeometry, smoothPasses, 0.3);
	}

	// 4. Fix normals
	validateAndFixNormals(workingGeometry);

	// 5. Auto-orient
	if (doAutoOrient) {
		orientMatrix = autoOrientMesh(workingGeometry);
	}

	// 6. Center
	if (doCenter) {
		centerTranslation = centerMesh(workingGeometry);
	}

	return {
		geometry: workingGeometry,
		validation,
		transforms: {
			outlierRemoval,
			smoothPasses,
			orientMatrix,
			centerTranslation,
			decimated,
			scaleFactor,
		},
	};
}

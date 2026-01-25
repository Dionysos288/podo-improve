import * as THREE from 'three';
import type { InsoleZone } from '../types/types';
import { exportGeometryToSTLBinary } from './stlExport';

/**
 * Smooth falloff function for grid point influence
 * Creates a circular falloff pattern around the selected grid point
 */
function calculateGridInfluence(
	distanceX: number,
	distanceY: number,
	falloffRadius: number = 1.5
): number {
	// Calculate euclidean distance
	const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
	
	if (distance >= falloffRadius) {
		return 0;
	}
	
	// Smooth falloff using smoothstep-like function
	const normalized = distance / falloffRadius;
	const t = 1 - normalized;
	return t * t * (3 - 2 * t); // Smoothstep
}

export function liftGridSquare(
	geometry: THREE.BufferGeometry,
	colIndex: number,
	rowIndex: number,
	amount: number,
	gridCols: number,
	gridRows: number,
	falloffRadius: number = 1.5
): void {
	const gridAttr = geometry.attributes.gridIndex as THREE.BufferAttribute;
	const positions = geometry.attributes.position as THREE.BufferAttribute;

	if (!gridAttr) {
		console.warn('Grid indices not found. Preprocess geometry first.');
		return;
	}

	const targetCol = colIndex / (gridCols - 1);
	const targetRow = rowIndex / (gridRows - 1);

	let modifiedCount = 0;

	for (let i = 0; i < positions.count; i++) {
		const col = gridAttr.getX(i);
		const row = gridAttr.getY(i);

		// Calculate distance in grid space (normalized 0-1)
		const distanceX = Math.abs(col - targetCol) * (gridCols - 1);
		const distanceY = Math.abs(row - targetRow) * (gridRows - 1);

		// Calculate influence weight with smooth falloff
		const influence = calculateGridInfluence(distanceX, distanceY, falloffRadius);

		if (influence > 0.001) {
			const currentZ = positions.getZ(i);
			const adjustment = amount * influence;
			positions.setZ(i, currentZ + adjustment);
			modifiedCount++;
		}
	}

	if (modifiedCount > 0) {
		positions.needsUpdate = true;
		geometry.computeVertexNormals();
	}
}

/**
 * Lift multiple grid points with smooth blending between them
 * Creates natural deformation across selected points
 */
export function liftMultipleGridPoints(
	geometry: THREE.BufferGeometry,
	selectedPoints: Array<{ col: number; row: number }>,
	amount: number,
	gridCols: number,
	gridRows: number,
	falloffRadius: number = 1.5
): void {
	const gridAttr = geometry.attributes.gridIndex as THREE.BufferAttribute;
	const positions = geometry.attributes.position as THREE.BufferAttribute;

	if (!gridAttr) {
		console.warn('Grid indices not found. Preprocess geometry first.');
		return;
	}

	let modifiedCount = 0;

	for (let i = 0; i < positions.count; i++) {
		const col = gridAttr.getX(i);
		const row = gridAttr.getY(i);

		// Calculate maximum influence from all selected points
		let maxInfluence = 0;

		for (const point of selectedPoints) {
			const targetCol = point.col / (gridCols - 1);
			const targetRow = point.row / (gridRows - 1);

			// Calculate distance in grid space
			const distanceX = Math.abs(col - targetCol) * (gridCols - 1);
			const distanceY = Math.abs(row - targetRow) * (gridRows - 1);

			// Calculate influence for this point
			const influence = calculateGridInfluence(distanceX, distanceY, falloffRadius);
			maxInfluence = Math.max(maxInfluence, influence);
		}

		if (maxInfluence > 0.001) {
			const currentZ = positions.getZ(i);
			const adjustment = amount * maxInfluence;
			positions.setZ(i, currentZ + adjustment);
			modifiedCount++;
		}
	}

	if (modifiedCount > 0) {
		positions.needsUpdate = true;
		geometry.computeVertexNormals();
	}
}

/**
 * Smooth interpolation function for creating smooth transitions
 * Returns a value between 0 and 1 with ease-in-ease-out curve
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/**
 * Calculate the weight/influence of a zone on a vertex based on its position
 * Returns a value between 0 (no influence) and 1 (full influence)
 * Uses smooth falloff at zone boundaries to create seamless transitions
 */
function calculateZoneWeight(
	relativeY: number,
	relativeZ: number,
	zoneType: InsoleZone,
	transitionWidth: number = 0.1
): number {
	switch (zoneType) {
		case 'heel':
			// Full weight at 0, fade out by 0.2 + transitionWidth
			return smoothstep(0.2 + transitionWidth, 0.2 - transitionWidth, relativeY);

		case 'midfoot':
			// Full weight in middle (0.2 to 0.5), fade at both ends
		if (relativeY < 0.2 + transitionWidth) {
			// Fade in from heel boundary
			return smoothstep(0.2 - transitionWidth, 0.2 + transitionWidth, relativeY);
		} else if (relativeY > 0.5 - transitionWidth) {
			// Fade out to forefoot boundary
			return smoothstep(0.5 + transitionWidth, 0.5 - transitionWidth, relativeY);
		}
			return 1;

		case 'forefoot':
			// Full weight at 1, fade in from 0.5 - transitionWidth
			return smoothstep(0.5 - transitionWidth, 0.5 + transitionWidth, relativeY);

		case 'arch':
		// Arch is based on Z height (elevation) across the entire insole
		// Vertices with higher Z values are part of the arch
		// The arch typically spans from heel to midfoot/forefoot transition
		// Use Z position to determine arch influence with smooth falloff
		const zWeight = smoothstep(0.2, 0.6, relativeZ);
		
		// Optional: reduce influence at extreme front/back of insole
		let yModifier = 1;
		if (relativeY < 0.05) {
			// Very back of heel - reduce arch influence
			yModifier = smoothstep(0, 0.05, relativeY);
		} else if (relativeY > 0.8) {
			// Very front of toes - reduce arch influence
			yModifier = smoothstep(1.0, 0.8, relativeY);
		}
		
		return zWeight * yModifier;
		default:
			return 0;
	}
}

export function adjustZone(
	geometry: THREE.BufferGeometry,
	zoneType: InsoleZone,
	amount: number
): void {
	const zonesAttr = geometry.attributes.zones as THREE.BufferAttribute;
	const positions = geometry.attributes.position as THREE.BufferAttribute;

	if (!zonesAttr) {
		console.warn('Zones not found. Preprocess geometry first.');
		return;
	}

	// Compute bounding box to get relative positions
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	
	const minY = bbox.min.y;
	const maxY = bbox.max.y;
	const minZ = bbox.min.z;
	const maxZ = bbox.max.z;
	
	const lengthY = maxY - minY;
	const lengthZ = maxZ - minZ;

	let modifiedCount = 0;
	
	for (let i = 0; i < positions.count; i++) {
		const y = positions.getY(i) - minY;
		const z = positions.getZ(i) - minZ;
		
		const relativeY = lengthY > 0 ? y / lengthY : 0;
		const relativeZ = lengthZ > 0 ? z / lengthZ : 0;
		
		// Calculate the weight/influence of this zone on this vertex
		const weight = calculateZoneWeight(relativeY, relativeZ, zoneType);
		
		if (weight > 0.001) { // Only modify vertices with significant influence
			const currentZ = positions.getZ(i);
			const adjustment = amount * weight;
			positions.setZ(i, currentZ + adjustment);
			modifiedCount++;
		}
	}

	if (modifiedCount > 0) {
		positions.needsUpdate = true;
		geometry.computeVertexNormals();
	}
}

export function applyMaterialOverlay(
	geometry: THREE.BufferGeometry,
	zone: InsoleZone,
	materialId: string
): void {
	const zonesAttr = geometry.attributes.zones as THREE.BufferAttribute;
	const materialsAttr = geometry.attributes.materials as THREE.BufferAttribute;

	if (!zonesAttr || !materialsAttr) {
		console.warn('Zones or materials not found. Preprocess geometry first.');
		return;
	}

	let targetColor: [number, number, number];
	switch (zone) {
		case 'heel':
			targetColor = [1, 0, 0];
			break;
		case 'midfoot':
			targetColor = [0, 1, 0];
			break;
		case 'forefoot':
			targetColor = [0, 0, 1];
			break;
		case 'arch':
			targetColor = [1, 1, 0];
			break;
		default:
			return;
	}

	const materialValues = getMaterialRGB(materialId);
	const tolerance = 0.1;

	for (let i = 0; i < zonesAttr.count; i++) {
		const r = zonesAttr.getX(i);
		const g = zonesAttr.getY(i);
		const b = zonesAttr.getZ(i);

		if (
			Math.abs(r - targetColor[0]) < tolerance &&
			Math.abs(g - targetColor[1]) < tolerance &&
			Math.abs(b - targetColor[2]) < tolerance
		) {
			materialsAttr.setX(i, materialValues[0]);
			materialsAttr.setY(i, materialValues[1]);
			materialsAttr.setZ(i, materialValues[2]);
		}
	}

	materialsAttr.needsUpdate = true;
}

function getMaterialRGB(materialId: string): [number, number, number] {
	const materialMap: Record<string, [number, number, number]> = {
		none: [0, 0, 0],
		overlay1: [0.33, 0, 0],
		inset: [0, 0.66, 0],
		overlay2: [0.66, 0, 0],
		overlay3: [0, 0, 0.33],
	};

	return materialMap[materialId] || [0, 0, 0];
}

export function removeMaterialOverlay(
	geometry: THREE.BufferGeometry,
	zone: InsoleZone
): void {
	applyMaterialOverlay(geometry, zone, 'none');
}

export function exportModifiedGeometry(
	geometry: THREE.BufferGeometry,
	filename: string = 'modified-insole.stl'
): void {
	const cleanGeometry = geometry.clone();

	cleanGeometry.deleteAttribute('gridIndex');
	cleanGeometry.deleteAttribute('zones');
	cleanGeometry.deleteAttribute('materials');

	exportGeometryToSTLBinary(cleanGeometry, filename);
}

export function resetGeometryModifications(
	geometry: THREE.BufferGeometry,
	originalGeometry: THREE.BufferGeometry
): void {
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const originalPositions = originalGeometry.attributes.position as THREE.BufferAttribute;

	if (positions.count !== originalPositions.count) {
		console.warn('Cannot reset: vertex count mismatch');
		return;
	}

	for (let i = 0; i < positions.count; i++) {
		positions.setX(i, originalPositions.getX(i));
		positions.setY(i, originalPositions.getY(i));
		positions.setZ(i, originalPositions.getZ(i));
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

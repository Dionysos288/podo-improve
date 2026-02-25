import * as THREE from 'three';

export interface GridPoint {
	id: string;
	position: THREE.Vector3;
	originalZ: number;
	gridRow: number;
	gridCol: number;
}

export interface GridPointSelection {
	selectedIds: Set<string>;
}

/**
 * Build a grid of control points on the surface of the insole geometry.
 * Returns structured grid points that can be selected and moved.
 */
export function buildInteractiveGridPoints(
	geometry: THREE.BufferGeometry,
	gridCols: number,
	gridRows: number
): GridPoint[] {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	if (!bbox || !positions) return [];

	const minX = bbox.min.x;
	const maxX = bbox.max.x;
	const minY = bbox.min.y;
	const maxY = bbox.max.y;
	const spanX = maxX - minX;
	const spanY = maxY - minY;
	if (spanX === 0 || spanY === 0) return [];

	// Build spatial hash for fast nearest-vertex lookup
	const cellSize = Math.max(spanX / 30, spanY / 30, 1);
	const spatialHash = new Map<string, number[]>();
	for (let i = 0; i < positions.count; i++) {
		const vx = positions.getX(i);
		const vy = positions.getY(i);
		const cx = Math.floor((vx - minX) / cellSize);
		const cy = Math.floor((vy - minY) / cellSize);
		const key = `${cx},${cy}`;
		const bucket = spatialHash.get(key);
		if (bucket) bucket.push(i);
		else spatialHash.set(key, [i]);
	}

	const result: GridPoint[] = [];
	for (let row = 0; row < gridRows; row++) {
		for (let col = 0; col < gridCols; col++) {
			const nx = gridCols === 1 ? 0.5 : col / (gridCols - 1);
			const ny = gridRows === 1 ? 0.5 : row / (gridRows - 1);
			const x = minX + nx * spanX;
			const y = minY + ny * spanY;

			const cx = Math.floor((x - minX) / cellSize);
			const cy = Math.floor((y - minY) / cellSize);

			let bestIdx = -1;
			let bestD2 = Infinity;
			// Search this cell + neighbors
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					const key = `${cx + dx},${cy + dy}`;
					const bucket = spatialHash.get(key);
					if (!bucket) continue;
					for (const i of bucket) {
						const vx = positions.getX(i);
						const vy = positions.getY(i);
						const d2 = (vx - x) * (vx - x) + (vy - y) * (vy - y);
						if (d2 < bestD2) {
							bestD2 = d2;
							bestIdx = i;
						}
					}
				}
			}

			if (bestIdx >= 0) {
				const z = positions.getZ(bestIdx);
				result.push({
					id: `grid-${row}-${col}`,
					position: new THREE.Vector3(x, y, z),
					originalZ: z,
					gridRow: row,
					gridCol: col,
				});
			}
		}
	}

	return result;
}

/**
 * Apply smooth deformation to geometry based on moved grid points.
 * Uses smooth hermite interpolation for natural blending with the surface.
 */
export function applyGridPointDeformation(
	geometry: THREE.BufferGeometry,
	gridPoints: GridPoint[],
	influenceRadius = 4.5
): void {
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	if (!positions) return;

	// Find grid points that have been moved
	const movedPoints = gridPoints.filter(
		(gp) => Math.abs(gp.position.z - gp.originalZ) > 0.01
	);
	if (movedPoints.length === 0) return;

	// Smooth Hermite interpolation function
	const smoothstep = (t: number): number => {
		t = Math.max(0, Math.min(1, t));
		return t * t * (3 - 2 * t);
	};

	// Apply weighted displacement to each vertex - optimized single pass
	for (let i = 0; i < positions.count; i++) {
		const vx = positions.getX(i);
		const vy = positions.getY(i);
		const vz = positions.getZ(i);

		let totalWeight = 0;
		let totalDisplacement = 0;

		for (const gp of movedPoints) {
			const dx = vx - gp.position.x;
			const dy = vy - gp.position.y;
			const dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < influenceRadius) {
				// Gentle falloff using double smoothstep for smooth blending
				const normalized = dist / influenceRadius;
				const weight = smoothstep(smoothstep(1 - normalized));
				const displacement = gp.position.z - gp.originalZ;

				totalWeight += weight;
				totalDisplacement += weight * displacement;
			}
		}

		if (totalWeight > 0) {
			const finalDisplacement = totalDisplacement / totalWeight;
			positions.setZ(i, vz + finalDisplacement);
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * Reset all grid points to their original positions.
 */
export function resetGridPoints(gridPoints: GridPoint[]): void {
	for (const gp of gridPoints) {
		gp.position.z = gp.originalZ;
	}
}

/**
 * Move selected grid points by a delta amount.
 * Also applies smooth falloff to neighboring grid points for natural deformation.
 */
export function moveSelectedGridPoints(
	gridPoints: GridPoint[],
	selectedIds: Set<string>,
	deltaZ: number
): void {
	// First, directly move selected points and mark them
	const directlyMoved = new Set<string>();
	for (const gp of gridPoints) {
		if (selectedIds.has(gp.id)) {
			gp.position.z += deltaZ;
			directlyMoved.add(gp.id);
		}
	}

	// Now propagate movement to neighboring grid points with smooth falloff
	for (const gp of gridPoints) {
		if (directlyMoved.has(gp.id)) continue; // Skip already moved points

		let maxInfluence = 0;

		// Check distance to each directly moved point
		for (const movedGp of gridPoints) {
			if (!directlyMoved.has(movedGp.id)) continue;

			const dx = gp.position.x - movedGp.position.x;
			const dy = gp.position.y - movedGp.position.y;
			const dist = Math.sqrt(dx * dx + dy * dy);

			// Influence radius in grid space (affects ~3-4 neighboring points)
			const influenceRadius = 15;

			if (dist < influenceRadius && dist > 0.1) {
				// Smooth falloff: closest neighbors get 0.85-0.9 influence, then drops off
				const normalized = dist / influenceRadius;
				const t = 1 - normalized;
				// Use smoothstep for natural falloff
				const smoothed = t * t * (3 - 2 * t);
				const influence = smoothed * 0.9; // Max 90% of original movement

				if (influence > maxInfluence) {
					maxInfluence = influence;
				}
			}
		}

		if (maxInfluence > 0) {
			gp.position.z += deltaZ * maxInfluence;
		}
	}
}

import * as THREE from 'three';
import type { OntwerpCorrections } from '@/src/shared/components/design/OntwerpPanel';

/**
 * Smooth interpolation function for creating smooth transitions
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/**
 * Get the axis information from geometry bounding box
 */
function getGeometryAxes(geometry: THREE.BufferGeometry): {
	lengthAxis: string;
	widthAxis: string;
	heightAxis: string;
	bbox: THREE.Box3;
	lengthSpan: number;
	widthSpan: number;
	heightSpan: number;
} {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	
	const sizeX = bbox.max.x - bbox.min.x;
	const sizeY = bbox.max.y - bbox.min.y;
	const sizeZ = bbox.max.z - bbox.min.z;
	
	// For insoles: longest = length (heel-to-toe), middle = width, shortest = height
	const sizes = [
		{ axis: 'x', size: sizeX },
		{ axis: 'y', size: sizeY },
		{ axis: 'z', size: sizeZ },
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

/**
 * Get position value based on axis
 */
function getAxisValue(positions: THREE.BufferAttribute, i: number, axis: string): number {
	if (axis === 'x') return positions.getX(i);
	if (axis === 'y') return positions.getY(i);
	return positions.getZ(i);
}

/**
 * Set position value based on axis
 */
function setAxisValue(positions: THREE.BufferAttribute, i: number, axis: string, value: number): void {
	if (axis === 'x') positions.setX(i, value);
	else if (axis === 'y') positions.setY(i, value);
	else positions.setZ(i, value);
}

/**
 * Get min value of bbox for axis
 */
function getMinForAxis(bbox: THREE.Box3, axis: string): number {
	if (axis === 'x') return bbox.min.x;
	if (axis === 'y') return bbox.min.y;
	return bbox.min.z;
}

/**
 * Get max value of bbox for axis
 */
function getMaxForAxis(bbox: THREE.Box3, axis: string): number {
	if (axis === 'x') return bbox.max.x;
	if (axis === 'y') return bbox.max.y;
	return bbox.max.z;
}

/**
 * KUIP HOOGTE (Cup Height)
 * Raises the edges/rim of the insole to create a cup shape that holds the foot
 * The effect is strongest at the lateral edges and reduces toward the center
 */
export function applyKuipHoogte(
	geometry: THREE.BufferGeometry,
	amount: number // in mm
): void {
	if (amount === 0) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { widthAxis, heightAxis, bbox, widthSpan } = getGeometryAxes(geometry);
	
	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;
	
	for (let i = 0; i < positions.count; i++) {
		const widthVal = getAxisValue(positions, i, widthAxis);
		
		// Calculate distance from center (normalized 0-1 where 1 is at edge)
		const distFromCenter = Math.abs(widthVal - centerWidth) / (widthSpan / 2);
		
		// Cup effect: raise edges more, center stays flat
		// Use a quadratic curve for natural cup shape
		const edgeFactor = distFromCenter * distFromCenter;
		
		// Only apply to the outer 40% of the width on each side
		if (distFromCenter > 0.6) {
			const adjustedFactor = smoothstep(0.6, 1.0, distFromCenter);
			const heightAdjust = amount * adjustedFactor;
			
			const currentHeight = getAxisValue(positions, i, heightAxis);
			setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
		}
	}
	
	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * VOORVOET UITVLAKKEN (Forefoot Flattening)
 * Flattens the forefoot area by reducing height variations in that zone
 * Creates a more even surface for metatarsal support
 */
export function applyVoorvoetUitvlakken(
	geometry: THREE.BufferGeometry,
	enabled: boolean
): void {
	if (!enabled) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, heightAxis, bbox, lengthSpan, heightSpan } = getGeometryAxes(geometry);
	
	const minLength = getMinForAxis(bbox, lengthAxis);
	const minHeight = getMinForAxis(bbox, heightAxis);
	
	// Forefoot is roughly the front 40% (0.6 to 1.0)
	const forefootStart = 0.5;
	
	// First pass: find average height in forefoot region
	let totalHeight = 0;
	let count = 0;
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const relativeLength = (lengthVal - minLength) / lengthSpan;
		
		if (relativeLength > forefootStart) {
			totalHeight += getAxisValue(positions, i, heightAxis);
			count++;
		}
	}
	
	if (count === 0) return;
	const avgHeight = totalHeight / count;
	
	// Second pass: flatten toward average with smooth transition
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const relativeLength = (lengthVal - minLength) / lengthSpan;
		
		if (relativeLength > forefootStart) {
			const currentHeight = getAxisValue(positions, i, heightAxis);
			
			// Smooth transition from forefoot start
			const flattenStrength = smoothstep(forefootStart, 0.7, relativeLength) * 0.7;
			
			// Blend toward average height
			const newHeight = currentHeight + (avgHeight - currentHeight) * flattenStrength;
			setAxisValue(positions, i, heightAxis, newHeight);
		}
	}
	
	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * HIEL HEFFING (Heel Lift)
 * Raises the heel area to compensate for leg length discrepancy or Achilles issues
 * Can be long (gradual slope) or short (steeper slope)
 */
export function applyHielHeffing(
	geometry: THREE.BufferGeometry,
	amount: number, // in mm
	length: 'lang' | 'kort' | 'midden'
): void {
	if (amount === 0) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, heightAxis, bbox, lengthSpan } = getGeometryAxes(geometry);
	
	const minLength = getMinForAxis(bbox, lengthAxis);
	
	// Determine how far the lift extends based on length setting
	let liftEnd: number;
	switch (length) {
		case 'kort':
			liftEnd = 0.15; // Short lift - only back 15%
			break;
		case 'midden':
			liftEnd = 0.25; // Medium lift - back 25%
			break;
		case 'lang':
		default:
			liftEnd = 0.35; // Long lift - back 35%
			break;
	}
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const relativeLength = (lengthVal - minLength) / lengthSpan;
		
		if (relativeLength < liftEnd) {
			// Full lift at heel (0), tapering to 0 at liftEnd
			const liftFactor = smoothstep(liftEnd, 0, relativeLength);
			const heightAdjust = amount * liftFactor;
			
			const currentHeight = getAxisValue(positions, i, heightAxis);
			setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
		}
	}
	
	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * MEDIALE BOOG CORRECTIE (Medial Arch Correction)
 * Adjusts the arch support height
 * Positive values increase arch support, negative values decrease it
 */
export function applyMedialeBoogCorrectie(
	geometry: THREE.BufferGeometry,
	amount: number, // in mm
	isLeftFoot: boolean
): void {
	if (amount === 0) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);
	
	const minLength = getMinForAxis(bbox, lengthAxis);
	const minWidth = getMinForAxis(bbox, widthAxis);
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		
		const relativeLength = (lengthVal - minLength) / lengthSpan;
		const relativeWidth = (widthVal - minWidth) / widthSpan;
		
		// Arch zone: midfoot area (0.2 to 0.6 along length)
		const lengthInArch = relativeLength > 0.15 && relativeLength < 0.55;
		
		if (lengthInArch) {
			// Medial side depends on foot side
			// For left foot: medial is the right side (higher relativeWidth)
			// For right foot: medial is the left side (lower relativeWidth)
			const medialSide = isLeftFoot ? relativeWidth > 0.5 : relativeWidth < 0.5;
			
			if (medialSide) {
				// Calculate arch influence based on position
				const lengthWeight = 1 - Math.abs(relativeLength - 0.35) / 0.2;
				const widthWeight = isLeftFoot 
					? smoothstep(0.5, 0.8, relativeWidth)
					: smoothstep(0.5, 0.2, relativeWidth);
				
				const archWeight = Math.max(0, lengthWeight) * widthWeight;
				
				if (archWeight > 0.01) {
					const heightAdjust = amount * archWeight;
					const currentHeight = getAxisValue(positions, i, heightAxis);
					setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
				}
			}
		}
	}
	
	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * GLADSTRIJKEN (Smoothing)
 * Smooths out bumps and height variations across the entire insole surface
 * Works by finding local average heights and using bilinear interpolation
 * to create perfectly smooth transitions without visible bands
 * Higher values = more smoothing (reduces bumps more aggressively)
 */
export function applyGladstrijken(
	geometry: THREE.BufferGeometry,
	intensity: number // 0-10 scale
): void {
	if (intensity === 0) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);
	
	const minLength = getMinForAxis(bbox, lengthAxis);
	const minWidth = getMinForAxis(bbox, widthAxis);
	
	// Create a grid to compute local average heights
	// Use fixed resolution for consistent results
	const gridResolution = 20;
	const cellSizeLength = lengthSpan / (gridResolution - 1);
	const cellSizeWidth = widthSpan / (gridResolution - 1);
	
	// Build grid of average heights
	const heightGrid: { sum: number; count: number }[][] = [];
	for (let i = 0; i < gridResolution; i++) {
		heightGrid[i] = [];
		for (let j = 0; j < gridResolution; j++) {
			heightGrid[i][j] = { sum: 0, count: 0 };
		}
	}
	
	// First pass: accumulate heights into grid cells
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const heightVal = getAxisValue(positions, i, heightAxis);
		
		const gridX = Math.min(gridResolution - 1, Math.max(0, Math.round((lengthVal - minLength) / cellSizeLength)));
		const gridY = Math.min(gridResolution - 1, Math.max(0, Math.round((widthVal - minWidth) / cellSizeWidth)));
		
		heightGrid[gridX][gridY].sum += heightVal;
		heightGrid[gridX][gridY].count++;
	}
	
	// Compute average heights per cell (fill empty cells with neighbors)
	const avgHeights: number[][] = [];
	for (let i = 0; i < gridResolution; i++) {
		avgHeights[i] = [];
		for (let j = 0; j < gridResolution; j++) {
			const cell = heightGrid[i][j];
			if (cell.count > 0) {
				avgHeights[i][j] = cell.sum / cell.count;
			} else {
				// Find nearest non-empty cell
				let found = false;
				for (let r = 1; r < gridResolution && !found; r++) {
					for (let di = -r; di <= r && !found; di++) {
						for (let dj = -r; dj <= r && !found; dj++) {
							const ni = i + di;
							const nj = j + dj;
							if (ni >= 0 && ni < gridResolution && nj >= 0 && nj < gridResolution) {
								const neighbor = heightGrid[ni][nj];
								if (neighbor.count > 0) {
									avgHeights[i][j] = neighbor.sum / neighbor.count;
									found = true;
								}
							}
						}
					}
				}
				if (!found) avgHeights[i][j] = 0;
			}
		}
	}
	
	// Apply multiple smoothing passes to the grid itself
	const smoothPasses = Math.ceil(intensity / 2);
	let smoothedHeights = avgHeights;
	
	for (let pass = 0; pass < smoothPasses; pass++) {
		const newSmoothed: number[][] = [];
		for (let i = 0; i < gridResolution; i++) {
			newSmoothed[i] = [];
			for (let j = 0; j < gridResolution; j++) {
				let sum = smoothedHeights[i][j];
				let count = 1;
				
				// Average with neighbors (gaussian-like weighting)
				for (let di = -1; di <= 1; di++) {
					for (let dj = -1; dj <= 1; dj++) {
						if (di === 0 && dj === 0) continue;
						const ni = i + di;
						const nj = j + dj;
						if (ni >= 0 && ni < gridResolution && nj >= 0 && nj < gridResolution) {
							// Corner neighbors get less weight
							const weight = (di !== 0 && dj !== 0) ? 0.5 : 1.0;
							sum += smoothedHeights[ni][nj] * weight;
							count += weight;
						}
					}
				}
				newSmoothed[i][j] = sum / count;
			}
		}
		smoothedHeights = newSmoothed;
	}
	
	// Normalize intensity to blend factor (0.1 to 0.9)
	const blendFactor = 0.1 + (intensity / 10) * 0.8;
	
	// Second pass: use BILINEAR INTERPOLATION for smooth transitions
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const currentHeight = getAxisValue(positions, i, heightAxis);
		
		// Get continuous grid coordinates
		const gx = (lengthVal - minLength) / cellSizeLength;
		const gy = (widthVal - minWidth) / cellSizeWidth;
		
		// Clamp to grid bounds
		const gxClamped = Math.max(0, Math.min(gridResolution - 1.001, gx));
		const gyClamped = Math.max(0, Math.min(gridResolution - 1.001, gy));
		
		// Get integer and fractional parts for bilinear interpolation
		const x0 = Math.floor(gxClamped);
		const y0 = Math.floor(gyClamped);
		const x1 = Math.min(x0 + 1, gridResolution - 1);
		const y1 = Math.min(y0 + 1, gridResolution - 1);
		const fx = gxClamped - x0;
		const fy = gyClamped - y0;
		
		// Bilinear interpolation between 4 grid points
		const h00 = smoothedHeights[x0][y0];
		const h10 = smoothedHeights[x1][y0];
		const h01 = smoothedHeights[x0][y1];
		const h11 = smoothedHeights[x1][y1];
		
		const targetHeight = 
			h00 * (1 - fx) * (1 - fy) +
			h10 * fx * (1 - fy) +
			h01 * (1 - fx) * fy +
			h11 * fx * fy;
		
		// Blend current height toward target (smoothed interpolated average)
		const newHeight = currentHeight + (targetHeight - currentHeight) * blendFactor;
		setAxisValue(positions, i, heightAxis, newHeight);
	}
	
	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * PRONATIE (Pronation Correction)
 * Tilts the insole to correct inward rolling of the foot
 * Raises the medial (inner) side
 */
export function applyPronatie(
	geometry: THREE.BufferGeometry,
	amount: number, // in degrees (0-10)
	region: 'gehele-zool' | 'voorvoet' | 'hiel',
	isLeftFoot: boolean
): void {
	if (amount === 0) return;
	
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);
	
	const minLength = getMinForAxis(bbox, lengthAxis);
	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;
	
	// Convert degrees to radians and calculate height change per mm of width
	const angleRad = (amount * Math.PI) / 180;
	const heightPerWidth = Math.tan(angleRad);
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		
		const relativeLength = (lengthVal - minLength) / lengthSpan;
		
		// Determine if this vertex is in the affected region
		let regionWeight = 0;
		switch (region) {
			case 'gehele-zool':
				regionWeight = 1;
				break;
			case 'voorvoet':
				regionWeight = smoothstep(0.4, 0.6, relativeLength);
				break;
			case 'hiel':
				regionWeight = smoothstep(0.3, 0.1, relativeLength);
				break;
		}
		
		if (regionWeight > 0.01) {
			// Distance from center (positive = medial side for pronation correction)
			// For pronation: raise medial side, which is different for left/right foot
			const distFromCenter = widthVal - centerWidth;
			
			// For left foot: medial is positive X, for right foot: medial is negative X
			const medialDirection = isLeftFoot ? 1 : -1;
			const signedDist = distFromCenter * medialDirection;
			
			// Height adjustment based on distance from center
			const heightAdjust = signedDist * heightPerWidth * regionWeight;
			
			const currentHeight = getAxisValue(positions, i, heightAxis);
			setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
		}
	}
	
	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * SUPINATIE (Supination Correction)
 * Tilts the insole to correct outward rolling of the foot
 * Raises the lateral (outer) side
 */
export function applySupinatie(
	geometry: THREE.BufferGeometry,
	amount: number, // in degrees (0-10)
	region: 'gehele-zool' | 'voorvoet' | 'hiel',
	isLeftFoot: boolean
): void {
	if (amount === 0) return;
	
	// Supination is the opposite of pronation - raise the lateral side
	// We can implement this by calling pronation with inverted foot side
	applyPronatie(geometry, amount, region, !isLeftFoot);
}

/**
 * Apply all corrections to a geometry
 */
export function applyAllCorrections(
	geometry: THREE.BufferGeometry,
	corrections: OntwerpCorrections,
	side: 'left' | 'right'
): void {
	const isLeft = side === 'left';
	
	// Apply corrections in a specific order for best results
	
	// 1. Heel lift first (changes base height)
	const heelValue = isLeft ? corrections.hielHeffing.value.left : corrections.hielHeffing.value.right;
	const heelLength = (isLeft ? corrections.hielHeffing.length.left : corrections.hielHeffing.length.right) as 'lang' | 'kort' | 'midden';
	applyHielHeffing(geometry, heelValue, heelLength);
	
	// 2. Arch correction
	const archValue = isLeft ? corrections.medialeBoogCorrectie.left : corrections.medialeBoogCorrectie.right;
	applyMedialeBoogCorrectie(geometry, archValue, isLeft);
	
	// 3. Cup height (edge raising)
	const cupValue = isLeft ? corrections.kuipHoogte.left : corrections.kuipHoogte.right;
	applyKuipHoogte(geometry, cupValue);
	
	// 4. Forefoot flattening
	applyVoorvoetUitvlakken(geometry, corrections.voorvoetUitvlakken.enabled);
	
	// 5. Pronation/Supination tilts
	const pronatieValue = isLeft ? corrections.pronatie.correctie.left : corrections.pronatie.correctie.right;
	const pronatieRegion = (isLeft ? corrections.pronatie.regio.left : corrections.pronatie.regio.right) as 'gehele-zool' | 'voorvoet' | 'hiel';
	applyPronatie(geometry, pronatieValue, pronatieRegion, isLeft);
	
	const supinatieValue = isLeft ? corrections.supinatie.correctie.left : corrections.supinatie.correctie.right;
	const supinatieRegion = (isLeft ? corrections.supinatie.regio.left : corrections.supinatie.regio.right) as 'gehele-zool' | 'voorvoet' | 'hiel';
	applySupinatie(geometry, supinatieValue, supinatieRegion, isLeft);
	
	// 6. Smoothing last (to blend all changes)
	applyGladstrijken(geometry, corrections.gladstrijken);
}

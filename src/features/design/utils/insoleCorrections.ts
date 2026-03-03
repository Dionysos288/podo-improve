import * as THREE from 'three';
import type { OntwerpCorrections } from '@/src/shared/components/design/OntwerpPanel';
import type { CorrectionKey } from '@/src/shared/components/design/correctionsCatalog';

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
 * Insoles often arrive with an arbitrary axis direction (length can run min->max or max->min).
 * Many corrections are defined in heel-to-toe terms, so we infer which end is the heel.
 *
 * Heuristic: depending on scan orientation and trimming, the "narrow end" rule can flip.
 * In this project, we treat the heel end as the end with the larger width span.
 */
function createHeelToToeMapper(params: {
	positions: THREE.BufferAttribute;
	lengthAxis: string;
	widthAxis: string;
	bbox: THREE.Box3;
	lengthSpan: number;
}): {
	heelAtMin: boolean;
	getT: (lengthVal: number) => number; // 0 = heel, 1 = toe
} {
	const { positions, lengthAxis, widthAxis, bbox, lengthSpan } = params;

	const minLength = getMinForAxis(bbox, lengthAxis);
	const maxLength = getMaxForAxis(bbox, lengthAxis);

	// Sample ~8% of length at each end.
	const slice = Math.max(lengthSpan * 0.08, 1e-6);

	let minEndMinWidth = Number.POSITIVE_INFINITY;
	let minEndMaxWidth = Number.NEGATIVE_INFINITY;
	let minEndCount = 0;

	let maxEndMinWidth = Number.POSITIVE_INFINITY;
	let maxEndMaxWidth = Number.NEGATIVE_INFINITY;
	let maxEndCount = 0;

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);

		if (lengthVal <= minLength + slice) {
			minEndMinWidth = Math.min(minEndMinWidth, widthVal);
			minEndMaxWidth = Math.max(minEndMaxWidth, widthVal);
			minEndCount++;
		}

		if (lengthVal >= maxLength - slice) {
			maxEndMinWidth = Math.min(maxEndMinWidth, widthVal);
			maxEndMaxWidth = Math.max(maxEndMaxWidth, widthVal);
			maxEndCount++;
		}
	}

	const minEndWidthSpan =
		minEndCount > 10 ? Math.max(0, minEndMaxWidth - minEndMinWidth) : Number.POSITIVE_INFINITY;
	const maxEndWidthSpan =
		maxEndCount > 10 ? Math.max(0, maxEndMaxWidth - maxEndMinWidth) : Number.POSITIVE_INFINITY;

	// If heuristic fails (e.g. degenerate geometry), default to heel at min.
	// NOTE: We intentionally choose the wider end as heel (see comment above).
	const heelAtMin =
		Number.isFinite(minEndWidthSpan) && Number.isFinite(maxEndWidthSpan)
			? minEndWidthSpan >= maxEndWidthSpan
			: true;

	return {
		heelAtMin,
		getT: (lengthVal: number) => {
			const raw = (lengthVal - minLength) / lengthSpan; // 0 at min, 1 at max
			const clamped = Math.max(0, Math.min(1, raw));
			return heelAtMin ? clamped : 1 - clamped;
		},
	};
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
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});
	
	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);
		// Heel cup should be strongest in the rearfoot and fade toward the forefoot.
		// 1.0 at heel->~midfoot, then fades to 0 by ~2/3 length.
		const lengthWeight = smoothstep(0.65, 0.35, t);
		if (lengthWeight <= 0.001) continue;

		const widthVal = getAxisValue(positions, i, widthAxis);
		
		// Calculate distance from center (normalized 0-1 where 1 is at edge)
		const distFromCenter = Math.abs(widthVal - centerWidth) / (widthSpan / 2);
		
		// Only apply to the outer 40% of the width on each side
		if (distFromCenter > 0.6) {
			const adjustedFactor = smoothstep(0.6, 1.0, distFromCenter);
			const heightAdjust = amount * adjustedFactor * lengthWeight;
			
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
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan } = getGeometryAxes(geometry);
	
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});
	
	// Forefoot is roughly the front 40% (0.6 to 1.0)
	const forefootStart = 0.6;
	
	// First pass: find average height in forefoot region
	let totalHeight = 0;
	let count = 0;
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);
		
		if (t > forefootStart) {
			totalHeight += getAxisValue(positions, i, heightAxis);
			count++;
		}
	}
	
	if (count === 0) return;
	const avgHeight = totalHeight / count;
	
	// Second pass: flatten toward average with smooth transition
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);
		
		if (t > forefootStart) {
			const currentHeight = getAxisValue(positions, i, heightAxis);
			
			// Smooth transition from forefoot start
			const flattenStrength = smoothstep(forefootStart, 0.75, t) * 0.7;
			
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
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan } = getGeometryAxes(geometry);
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});
	
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
		const t = heelToToe.getT(lengthVal);
		
		if (t < liftEnd) {
			// Full lift at heel (0), tapering to 0 at liftEnd
			const liftFactor = smoothstep(liftEnd, 0, t);
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
	
	const minWidth = getMinForAxis(bbox, widthAxis);
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		
		const relativeLength = heelToToe.getT(lengthVal);
		const relativeWidth = (widthVal - minWidth) / widthSpan;
		
		// Arch zone: midfoot area (heel->toe)
		const lengthInArch = relativeLength > 0.18 && relativeLength < 0.62;
		
		if (lengthInArch) {
			// Medial side depends on foot side
			// For left foot: medial is the right side (higher relativeWidth)
			// For right foot: medial is the left side (lower relativeWidth)
			const medialSide = isLeftFoot ? relativeWidth > 0.5 : relativeWidth < 0.5;
			
			if (medialSide) {
				// Calculate arch influence based on position
				const lengthWeight = 1 - Math.abs(relativeLength - 0.42) / 0.22;
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
	
	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});
	
	// Convert degrees to radians and calculate height change per mm of width
	const angleRad = (amount * Math.PI) / 180;
	const heightPerWidth = Math.tan(angleRad);
	
	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		
		const t = heelToToe.getT(lengthVal);
		
		// Determine if this vertex is in the affected region
		let regionWeight = 0;
		switch (region) {
			case 'gehele-zool':
				regionWeight = 1;
				break;
			case 'voorvoet':
				regionWeight = smoothstep(0.55, 0.75, t);
				break;
			case 'hiel':
				regionWeight = smoothstep(0.28, 0.06, t);
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
 * MEDIAAL VLAK (Medial Flange)
 * Vertical extension of the medial arch region for pronatory control.
 * Raises the medial edge of the insole along the midfoot to create a wall-like support.
 * Height setting (laag/midden/hoog) controls how far inward the flange extends.
 */
export function applyMediaalVlak(
	geometry: THREE.BufferGeometry,
	amount: number, // mm of height increase
	hoogte: 'laag' | 'midden' | 'hoog',
	isLeftFoot: boolean
): void {
	if (amount === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	// How far inward the flange extends (fraction of half-width from edge)
	const flangeDepth = hoogte === 'laag' ? 0.12 : hoogte === 'midden' ? 0.2 : 0.3;

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const t = heelToToe.getT(lengthVal);

		// Flange zone: midfoot + rearfoot (0.1 – 0.65 heel-to-toe)
		const lengthWeight = smoothstep(0.08, 0.15, t) * smoothstep(0.68, 0.60, t);
		if (lengthWeight <= 0.001) continue;

		const relativeWidth = (widthVal - minWidth) / widthSpan;

		// Medial side: left foot → high relativeWidth, right foot → low relativeWidth
		const edgeDist = isLeftFoot
			? smoothstep(1.0 - flangeDepth, 1.0, relativeWidth)
			: smoothstep(flangeDepth, 0.0, relativeWidth);

		if (edgeDist > 0.001) {
			const heightAdjust = amount * edgeDist * lengthWeight;
			const currentHeight = getAxisValue(positions, i, heightAxis);
			setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * LATERAAL VLAK (Lateral Flange)
 * Vertical extension of the lateral arch region for supinatory control.
 * Mirror of medial flange, but on the outer side.
 */
export function applyLateraalVlak(
	geometry: THREE.BufferGeometry,
	amount: number,
	hoogte: 'laag' | 'midden' | 'hoog',
	isLeftFoot: boolean
): void {
	if (amount === 0) return;

	// Lateral is the opposite side of medial – flip the foot reference
	applyMediaalVlak(geometry, amount, hoogte, !isLeftFoot);
}

/**
 * VERPLAATS APEX MIDDENVOET (Shift Midfoot Arch Apex)
 * Shifts the peak of the medial arch forward or backward along the length axis.
 * Positive = toward toes, negative = toward heel.
 * Works by re-distributing the existing arch correction with an offset center.
 */
export function applyApexMiddenvoet(
	geometry: THREE.BufferGeometry,
	shiftMm: number, // mm of shift (negative=heel, positive=toe)
	isLeftFoot: boolean
): void {
	if (shiftMm === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	// Convert mm shift to t-space offset
	const tShift = shiftMm / lengthSpan;
	// Default arch center is 0.42; shift it
	const archCenter = Math.max(0.22, Math.min(0.58, 0.42 + tShift));
	const archHalfWidth = 0.22;

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const widthVal = getAxisValue(positions, i, widthAxis);
		const t = heelToToe.getT(lengthVal);
		const relativeWidth = (widthVal - minWidth) / widthSpan;

		// Only affect the arch zone
		const inArch = t > (archCenter - archHalfWidth) && t < (archCenter + archHalfWidth);
		if (!inArch) continue;

		// Medial side
		const medialSide = isLeftFoot ? relativeWidth > 0.5 : relativeWidth < 0.5;
		if (!medialSide) continue;

		const lengthWeight = 1 - Math.abs(t - archCenter) / archHalfWidth;
		const widthWeight = isLeftFoot
			? smoothstep(0.5, 0.8, relativeWidth)
			: smoothstep(0.5, 0.2, relativeWidth);

		const weight = Math.max(0, lengthWeight) * widthWeight;
		if (weight > 0.01) {
			// The shift effect: positive shift pushes the peak forward,
			// effectively raising the front of the arch and lowering the back
			// relative to the original position. We create a differential:
			const origCenter = 0.42;
			const origWeight = 1 - Math.abs(t - origCenter) / archHalfWidth;
			const delta = (Math.max(0, lengthWeight) - Math.max(0, origWeight)) * widthWeight;

			if (Math.abs(delta) > 0.001) {
				// Scale the redistribution effect (a moderate push of ~2mm per mm shift)
				const heightAdjust = delta * Math.abs(shiftMm) * 0.3;
				const currentHeight = getAxisValue(positions, i, heightAxis);
				setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
			}
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * VERPLAATS APEX HIEL (Shift Heel Apex)
 * Shifts the peak of the heel lift forward or backward.
 * Positive = toward toes (peak moves forward), negative = toward heel (steeper).
 */
export function applyApexHiel(
	geometry: THREE.BufferGeometry,
	shiftMm: number,
	_isLeftFoot: boolean
): void {
	if (shiftMm === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan } = getGeometryAxes(geometry);

	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	// Convert mm to t-space; the default heel peak is at t=0
	const tShift = shiftMm / lengthSpan;
	const peakT = Math.max(0, Math.min(0.25, tShift));
	const fadeEnd = Math.max(peakT + 0.08, 0.15);

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);

		if (t > fadeEnd + 0.05) continue;

		// Create a peaked profile around peakT instead of monotone from 0
		let weight: number;
		if (t <= peakT) {
			weight = peakT > 0.001 ? smoothstep(0, peakT, t) : 1;
		} else {
			weight = smoothstep(fadeEnd, peakT, t);
		}

		if (weight > 0.001) {
			// Redistribute: raise around new peak, lower at old peak (t=0)
			const origWeight = smoothstep(fadeEnd, 0, t);
			const delta = weight - origWeight;

			if (Math.abs(delta) > 0.001) {
				const heightAdjust = delta * Math.abs(shiftMm) * 0.2;
				const currentHeight = getAxisValue(positions, i, heightAxis);
				setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
			}
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * HIELBEENCORRECTIE (Heel Clip / Calcaneus Alignment)
 * A vertical extension on the medial or lateral side of the heel cup
 * to align the calcaneus and improve rearfoot control.
 */
export function applyHielbeenCorrectie(
	geometry: THREE.BufferGeometry,
	amount: number,
	zijde: 'mediaal' | 'lateraal',
	isLeftFoot: boolean
): void {
	if (amount === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);

		// Only affect heel zone (0 – 0.25)
		const lengthWeight = smoothstep(0.28, 0.12, t);
		if (lengthWeight <= 0.001) continue;

		const widthVal = getAxisValue(positions, i, widthAxis);
		const relativeWidth = (widthVal - minWidth) / widthSpan;

		// Determine which edge to raise
		let isTargetSide: boolean;
		if (zijde === 'mediaal') {
			isTargetSide = isLeftFoot ? relativeWidth > 0.65 : relativeWidth < 0.35;
		} else {
			isTargetSide = isLeftFoot ? relativeWidth < 0.35 : relativeWidth > 0.65;
		}

		if (isTargetSide) {
			// Edge factor: stronger at the very edge
			const edgeFactor = isLeftFoot
				? (zijde === 'mediaal'
					? smoothstep(0.65, 1.0, relativeWidth)
					: smoothstep(0.35, 0.0, relativeWidth))
				: (zijde === 'mediaal'
					? smoothstep(0.35, 0.0, relativeWidth)
					: smoothstep(0.65, 1.0, relativeWidth));

			const heightAdjust = amount * edgeFactor * lengthWeight;
			if (heightAdjust > 0.001) {
				const currentHeight = getAxisValue(positions, i, heightAxis);
				setAxisValue(positions, i, heightAxis, currentHeight + heightAdjust);
			}
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * HIELBREEDTE CORRECTIE (Heel Width Correction)
 * Expands the heel cup by pushing vertices outward along the width axis
 * in the heel zone, providing a broader base of support.
 */
export function applyHielbreedteCorrectie(
	geometry: THREE.BufferGeometry,
	amount: number // mm of expansion per side
): void {
	if (amount === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { lengthAxis, widthAxis, heightAxis: _h, bbox, lengthSpan, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;
	const heelToToe = createHeelToToeMapper({ positions, lengthAxis, widthAxis, bbox, lengthSpan });

	for (let i = 0; i < positions.count; i++) {
		const lengthVal = getAxisValue(positions, i, lengthAxis);
		const t = heelToToe.getT(lengthVal);

		// Heel zone (0 – 0.22)
		const lengthWeight = smoothstep(0.25, 0.10, t);
		if (lengthWeight <= 0.001) continue;

		const widthVal = getAxisValue(positions, i, widthAxis);
		const distFromCenter = widthVal - centerWidth;
		const normalizedDist = Math.abs(distFromCenter) / (widthSpan / 2);

		// Only expand the outer portions (>50% from center)
		if (normalizedDist > 0.5) {
			const edgeFactor = smoothstep(0.5, 1.0, normalizedDist);
			const sign = distFromCenter > 0 ? 1 : -1;
			const shift = sign * amount * edgeFactor * lengthWeight;
			setAxisValue(positions, i, widthAxis, widthVal + shift);
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * ZOOLBREEDTE (Sole Width / Horizontal Expansion)
 * Expands the entire insole width by pushing edge vertices outward,
 * similar to a Medial Arch Platform (MAP) technique.
 */
export function applyZoolbreedte(
	geometry: THREE.BufferGeometry,
	amount: number // mm of expansion per side
): void {
	if (amount === 0) return;

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const { widthAxis, bbox, widthSpan } = getGeometryAxes(geometry);

	const minWidth = getMinForAxis(bbox, widthAxis);
	const centerWidth = minWidth + widthSpan / 2;

	for (let i = 0; i < positions.count; i++) {
		const widthVal = getAxisValue(positions, i, widthAxis);
		const distFromCenter = widthVal - centerWidth;
		const normalizedDist = Math.abs(distFromCenter) / (widthSpan / 2);

		// Gradual expansion: stronger at edges
		if (normalizedDist > 0.3) {
			const factor = smoothstep(0.3, 1.0, normalizedDist);
			const sign = distFromCenter > 0 ? 1 : -1;
			const shift = sign * amount * factor;
			setAxisValue(positions, i, widthAxis, widthVal + shift);
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/**
 * Apply all corrections to a geometry
 */
export function applyAllCorrections(
	geometry: THREE.BufferGeometry,
	corrections: OntwerpCorrections,
	side: 'left' | 'right',
	options?: {
		/**
		 * Converts millimeters (UI/input space) into geometry/world units.
		 * Use this when the STL is rescaled for rendering.
		 */
		mmToWorld?: number;
		activeCorrections?: CorrectionKey[];
	}
): void {
	const isLeft = side === 'left';
	const mmToWorld = options?.mmToWorld ?? 1;
	const activeSet = options?.activeCorrections
		? new Set<CorrectionKey>(options.activeCorrections)
		: null;
	const isActive = (key: CorrectionKey) => {
		if (!activeSet) return true;
		return activeSet.has(key);
	};
	
	// Apply corrections in a specific order for best results
	
	// 1. Heel lift first (changes base height)
	if (isActive('hielHeffing')) {
		const heelValue = isLeft
			? corrections.hielHeffing.value.left
			: corrections.hielHeffing.value.right;
		const heelLength = (isLeft
			? corrections.hielHeffing.length.left
			: corrections.hielHeffing.length.right) as 'lang' | 'kort' | 'midden';
		applyHielHeffing(geometry, heelValue * mmToWorld, heelLength);
	}
	
	// 2. Arch correction
	if (isActive('medialeBoogCorrectie')) {
		const archValue = isLeft
			? corrections.medialeBoogCorrectie.left
			: corrections.medialeBoogCorrectie.right;
		applyMedialeBoogCorrectie(geometry, archValue * mmToWorld, isLeft);
	}
	
	// 3. Cup height (edge raising)
	if (isActive('kuipHoogte')) {
		const cupValue = isLeft
			? corrections.kuipHoogte.left
			: corrections.kuipHoogte.right;
		applyKuipHoogte(geometry, cupValue * mmToWorld);
	}
	
	// 4. Forefoot flattening
	if (isActive('voorvoetUitvlakken')) {
		applyVoorvoetUitvlakken(geometry, corrections.voorvoetUitvlakken.enabled);
	}
	
	// 5. Pronation/Supination tilts
	if (isActive('pronatie')) {
		const pronatieValue = isLeft
			? corrections.pronatie.correctie.left
			: corrections.pronatie.correctie.right;
		const pronatieRegion = (isLeft
			? corrections.pronatie.regio.left
			: corrections.pronatie.regio.right) as 'gehele-zool' | 'voorvoet' | 'hiel';
		applyPronatie(geometry, pronatieValue, pronatieRegion, isLeft);
	}
	
	if (isActive('supinatie')) {
		const supinatieValue = isLeft
			? corrections.supinatie.correctie.left
			: corrections.supinatie.correctie.right;
		const supinatieRegion = (isLeft
			? corrections.supinatie.regio.left
			: corrections.supinatie.regio.right) as 'gehele-zool' | 'voorvoet' | 'hiel';
		applySupinatie(geometry, supinatieValue, supinatieRegion, isLeft);
	}
	
	// 6. Medial flange
	if (isActive('mediaalVlak')) {
		const flangeValue = isLeft
			? corrections.mediaalVlak.waarde.left
			: corrections.mediaalVlak.waarde.right;
		const flangeHoogte = (isLeft
			? corrections.mediaalVlak.hoogte.left
			: corrections.mediaalVlak.hoogte.right) as 'laag' | 'midden' | 'hoog';
		applyMediaalVlak(geometry, flangeValue * mmToWorld, flangeHoogte, isLeft);
	}

	// 7. Lateral flange
	if (isActive('lateraalVlak')) {
		const flangeValue = isLeft
			? corrections.lateraalVlak.waarde.left
			: corrections.lateraalVlak.waarde.right;
		const flangeHoogte = (isLeft
			? corrections.lateraalVlak.hoogte.left
			: corrections.lateraalVlak.hoogte.right) as 'laag' | 'midden' | 'hoog';
		applyLateraalVlak(geometry, flangeValue * mmToWorld, flangeHoogte, isLeft);
	}

	// 8. Apex midfoot shift
	if (isActive('apexMiddenvoet')) {
		const shiftValue = isLeft
			? corrections.apexMiddenvoet.left
			: corrections.apexMiddenvoet.right;
		applyApexMiddenvoet(geometry, shiftValue * mmToWorld, isLeft);
	}

	// 9. Apex heel shift
	if (isActive('apexHiel')) {
		const shiftValue = isLeft
			? corrections.apexHiel.left
			: corrections.apexHiel.right;
		applyApexHiel(geometry, shiftValue * mmToWorld, isLeft);
	}

	// 10. Heel clip (calcaneus alignment)
	if (isActive('hielbeenCorrectie')) {
		const clipValue = isLeft
			? corrections.hielbeenCorrectie.waarde.left
			: corrections.hielbeenCorrectie.waarde.right;
		const clipZijde = (isLeft
			? corrections.hielbeenCorrectie.zijde.left
			: corrections.hielbeenCorrectie.zijde.right) as 'mediaal' | 'lateraal';
		applyHielbeenCorrectie(geometry, clipValue * mmToWorld, clipZijde, isLeft);
	}

	// 11. Heel width expansion
	if (isActive('hielbreedteCorrectie')) {
		const widthValue = isLeft
			? corrections.hielbreedteCorrectie.left
			: corrections.hielbreedteCorrectie.right;
		applyHielbreedteCorrectie(geometry, widthValue * mmToWorld);
	}

	// 12. Sole width expansion
	if (isActive('zoolbreedte')) {
		const soleWidthValue = isLeft
			? corrections.zoolbreedte.left
			: corrections.zoolbreedte.right;
		applyZoolbreedte(geometry, soleWidthValue * mmToWorld);
	}

	// 13. Smoothing last (to blend all changes)
	if (isActive('gladstrijken')) {
		applyGladstrijken(geometry, corrections.gladstrijken);
	}
}

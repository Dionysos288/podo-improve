/**
 * ──────────────────────────────────────────────
 *  Element STL height field
 *
 *  Builds a top-surface height map (in mm above the element base) from a raw
 *  element STL, sampled on a fixed grid in the STL's own footprint space.
 *
 *  Both the on-screen overlay (buildElementOverlayGeometries) and the exported
 *  insole displacement (applyElements) sample this field so the rendered pad and
 *  the manufactured single-piece insole always agree. The STL already carries its
 *  own smooth, gradual edges, so no taper, blend or smoothing is applied here.
 * ──────────────────────────────────────────────
 */
import * as THREE from 'three';

export interface ElementStlHeightField {
	gridSize: number;
	/** Max (z − baseZ) per cell, in mm. 0 where the footprint is unoccupied. */
	heightGridMm: Float32Array;
	occupied: Uint8Array;
	sourceWidthMm: number;
	sourceLengthMm: number;
	sourceHeightMm: number;
	stlMinX: number;
	stlMinY: number;
	stlCenterX: number;
	stlCenterY: number;
	stlBaseZ: number;
	cellW: number;
	cellL: number;
}

const heightFieldCache = new WeakMap<
	THREE.BufferGeometry,
	Map<string, ElementStlHeightField>
>();

const GRID_SIZE = 64;

/**
 * Cached per source geometry + axis convention. `swapYZ` matches the STL load
 * convention used elsewhere (footprint in XY, height in Z).
 */
export function getElementStlHeightField(
	sourceGeometry: THREE.BufferGeometry,
	swapYZ: boolean,
): ElementStlHeightField {
	let perGeometry = heightFieldCache.get(sourceGeometry);
	if (!perGeometry) {
		perGeometry = new Map<string, ElementStlHeightField>();
		heightFieldCache.set(sourceGeometry, perGeometry);
	}
	const cacheKey = swapYZ ? 'swap-yz' : 'native';
	const cached = perGeometry.get(cacheKey);
	if (cached) return cached;

	const pos = sourceGeometry.getAttribute('position') as THREE.BufferAttribute;
	const vtxCount = pos.count;

	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
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
	const stlBaseZ = minZ;
	const cellW = sourceWidthMm / GRID_SIZE;
	const cellL = sourceLengthMm / GRID_SIZE;

	const occupied = new Uint8Array(GRID_SIZE * GRID_SIZE);
	const heightGridMm = new Float32Array(GRID_SIZE * GRID_SIZE);

	for (let i = 0; i < vtxCount; i++) {
		const px = pos.getX(i);
		const py = swapYZ ? pos.getZ(i) : pos.getY(i);
		const pz = swapYZ ? pos.getY(i) : pos.getZ(i);
		const gx = Math.min(
			GRID_SIZE - 1,
			Math.max(0, Math.floor((px - minX) / cellW)),
		);
		const gy = Math.min(
			GRID_SIZE - 1,
			Math.max(0, Math.floor((py - minY) / cellL)),
		);
		const gi = gy * GRID_SIZE + gx;
		const hMm = pz - stlBaseZ;
		occupied[gi] = 1;
		if (hMm > heightGridMm[gi]) heightGridMm[gi] = hMm;
	}

	// Fill interior cells that no vertex landed in with the max of their occupied
	// neighbours so a sparse mesh does not punch zero-height holes mid-pad.
	for (let pass = 0; pass < 2; pass++) {
		for (let gy = 0; gy < GRID_SIZE; gy++) {
			for (let gx = 0; gx < GRID_SIZE; gx++) {
				const gi = gy * GRID_SIZE + gx;
				if (occupied[gi]) continue;
				let neighbourMax = 0;
				let neighbourCount = 0;
				for (const [dx, dy] of NEIGHBOURS) {
					const nx = gx + dx;
					const ny = gy + dy;
					if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
					const ni = ny * GRID_SIZE + nx;
					if (!occupied[ni]) continue;
					neighbourCount++;
					if (heightGridMm[ni] > neighbourMax) neighbourMax = heightGridMm[ni];
				}
				// Only fill cells surrounded by occupied neighbours (interior holes),
				// not perimeter cells, so the footprint edge stays crisp.
				if (neighbourCount >= 5) {
					heightGridMm[gi] = neighbourMax;
					occupied[gi] = 2;
				}
			}
		}
		for (let i = 0; i < occupied.length; i++) {
			if (occupied[i] === 2) occupied[i] = 1;
		}
	}

	// Smooth the max-sampled grid: max-per-cell leaves a jagged, grainy surface
	// because neighbouring cells snap to different vertices of a dense mesh. Average
	// each occupied cell with its occupied neighbours (edge stays crisp — unoccupied
	// cells are excluded), then rescale so the peak height is preserved and the
	// therapeutic height stays accurate. This makes the pad read as smooth as the
	// source STL for both the viewer overlay and the exported part.
	let preMax = 0;
	for (let i = 0; i < heightGridMm.length; i++) {
		if (occupied[i] && heightGridMm[i] > preMax) preMax = heightGridMm[i];
	}
	if (preMax > 1e-4) {
		const blurScratch = new Float32Array(heightGridMm.length);
		for (let pass = 0; pass < 3; pass++) {
			for (let gy = 0; gy < GRID_SIZE; gy++) {
				for (let gx = 0; gx < GRID_SIZE; gx++) {
					const gi = gy * GRID_SIZE + gx;
					if (!occupied[gi]) {
						blurScratch[gi] = heightGridMm[gi];
						continue;
					}
					let sum = heightGridMm[gi];
					let count = 1;
					for (const [dx, dy] of NEIGHBOURS) {
						const nx = gx + dx;
						const ny = gy + dy;
						if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
						const ni = ny * GRID_SIZE + nx;
						if (!occupied[ni]) continue;
						sum += heightGridMm[ni];
						count++;
					}
					blurScratch[gi] = sum / count;
				}
			}
			heightGridMm.set(blurScratch);
		}
		let postMax = 0;
		for (let i = 0; i < heightGridMm.length; i++) {
			if (occupied[i] && heightGridMm[i] > postMax) postMax = heightGridMm[i];
		}
		if (postMax > 1e-4) {
			const k = preMax / postMax;
			for (let i = 0; i < heightGridMm.length; i++) {
				if (occupied[i]) heightGridMm[i] *= k;
			}
		}
	}

	const field: ElementStlHeightField = {
		gridSize: GRID_SIZE,
		heightGridMm,
		occupied,
		sourceWidthMm,
		sourceLengthMm,
		sourceHeightMm,
		stlMinX: minX,
		stlMinY: minY,
		stlCenterX: (minX + maxX) / 2,
		stlCenterY: (minY + maxY) / 2,
		stlBaseZ,
		cellW,
		cellL,
	};
	perGeometry.set(cacheKey, field);
	return field;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1],
	[-1, -1],
	[-1, 1],
	[1, -1],
	[1, 1],
];

/**
 * Bilinear sample of the element top-surface height (mm above base) at a raw STL
 * footprint coordinate (rawX, rawY in the same frame the field was built from).
 * Returns 0 outside the footprint.
 */
export function sampleElementHeightMm(
	field: ElementStlHeightField,
	rawX: number,
	rawY: number,
): number {
	const { gridSize, heightGridMm, cellW, cellL, stlMinX, stlMinY } = field;
	const gx = (rawX - stlMinX) / cellW;
	const gy = (rawY - stlMinY) / cellL;
	if (gx < 0 || gx > gridSize - 1 || gy < 0 || gy > gridSize - 1) return 0;
	const gxi = Math.min(gridSize - 2, Math.max(0, Math.floor(gx)));
	const gyi = Math.min(gridSize - 2, Math.max(0, Math.floor(gy)));
	const fx = gx - gxi;
	const fy = gy - gyi;
	const h00 = heightGridMm[gyi * gridSize + gxi];
	const h10 = heightGridMm[gyi * gridSize + gxi + 1];
	const h01 = heightGridMm[(gyi + 1) * gridSize + gxi];
	const h11 = heightGridMm[(gyi + 1) * gridSize + gxi + 1];
	const h =
		h00 * (1 - fx) * (1 - fy) +
		h10 * fx * (1 - fy) +
		h01 * (1 - fx) * fy +
		h11 * fx * fy;
	return h > 0 ? h : 0;
}

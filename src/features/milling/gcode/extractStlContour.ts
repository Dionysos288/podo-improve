/**
 * Extract 2D boundary contour AND 3D heightfield from an STL file or geometry.
 *
 * Uses the same auto-orientation algorithm as CncFixtureView's InsoleSTL component
 * to ensure the NC toolpath matches the visual representation exactly.
 *
 * Output contour: [X, Y] points in block-local NC coordinates
 *   X: 0..blockW (130 mm) — left insole in left half, right in right half
 *   Y: 0..blockH (280 mm) — along the block length
 *
 * Output heightfield: a regular grid of Z depth values covering the insole's
 *   bounding box, used for 3D surface finish passes.
 */

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { applyBaseInsoleTypeShape } from '@/src/features/design/utils/baseInsoleGeometry';
import type { BaseInsoleType } from '@/src/features/design/types/types';
import { BLOCK_W, BLOCK_H, BLOCK_DEPTH } from '../types';
import type { HeightfieldData } from './generateNc';

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export interface StlExtractionResult {
	contour: [number, number][];
	heightfield: HeightfieldData;
}

const HEIGHTFIELD_YIELD_EVERY_ROWS = 8;
const EXPORT_PAIR_SPACING_MM = 15;

const EMPTY_RESULT: StlExtractionResult = {
	contour: [],
	heightfield: { cols: 0, rows: 0, cellSizeMm: 1, zValues: [], originOffsetMm: { x: 0, y: 0 } },
};

function yieldToBrowser(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
			window.requestAnimationFrame(() => resolve());
			return;
		}
		setTimeout(resolve, 0);
	});
}

/**
 * Extract contour + heightfield directly from a THREE.BufferGeometry.
 * Use this when you already have the insole geometry (e.g. from the 3D viewer)
 * instead of fetching an STL file.
 *
 * The geometry does NOT need to be pre-oriented — auto-orientation is applied.
 * No baseInsoleType shape morphing is applied (assumed already done by the viewer).
 */
export function extractContourFromGeometry(
	geometry: THREE.BufferGeometry,
	side: 'left' | 'right',
	blockW = BLOCK_W,
	blockH = BLOCK_H,
): StlExtractionResult {
	const geom = geometry.clone();
	geom.computeBoundingBox();
	const bb = geom.boundingBox;
	const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!bb || !pos || pos.count === 0) return EMPTY_RESULT;

	return extractFromPreparedGeometry(geom, bb, pos, side, blockW, blockH);
}

export async function extractContourFromGeometryAsync(
	geometry: THREE.BufferGeometry,
	side: 'left' | 'right',
	blockW = BLOCK_W,
	blockH = BLOCK_H,
): Promise<StlExtractionResult> {
	const geom = geometry.clone();
	geom.computeBoundingBox();
	const bb = geom.boundingBox;
	const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!bb || !pos || pos.count === 0) return EMPTY_RESULT;

	return extractFromPreparedGeometryAsync(geom, bb, pos, side, blockW, blockH);
}

/**
 * Extract contour + heightfield from already-exported viewer geometry in true mm scale.
 * This preserves the real insole size and places left/right using the same pair spacing
 * as `getExportPairGeometryMm()` in the viewer instead of shrinking into the fixture block.
 */
export async function extractContourFromExportGeometryAsync(
	geometry: THREE.BufferGeometry,
	side: 'left' | 'right',
	pairSpacingMm = EXPORT_PAIR_SPACING_MM,
): Promise<StlExtractionResult> {
	const geom = geometry.clone();
	geom.computeBoundingBox();
	const bb = geom.boundingBox;
	const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!bb || !pos || pos.count === 0) return EMPTY_RESULT;

	const shiftY = side === 'left'
		? -(bb.max.y + pairSpacingMm * 0.5)
		: -(bb.min.y - pairSpacingMm * 0.5);

	const newPos = new Float32Array(pos.count * 3);
	const points2D: [number, number][] = [];
	for (let i = 0; i < pos.count; i++) {
		const exportX = pos.getX(i);
		const exportY = pos.getY(i) + shiftY;
		const exportZ = pos.getZ(i);

		const ncX = exportY;
		const ncY = -exportX;
		const ncZ = exportZ - bb.max.z;

		newPos[i * 3 + 0] = ncX;
		newPos[i * 3 + 1] = ncZ;
		newPos[i * 3 + 2] = ncY;
		points2D.push([ncX, ncY]);
	}

	const remappedGeom = new THREE.BufferGeometry();
	remappedGeom.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
	if (geom.index) remappedGeom.setIndex(geom.index.clone());
	remappedGeom.computeVertexNormals();
	remappedGeom.computeBoundingBox();

	const mesh = new THREE.Mesh(
		remappedGeom,
		new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
	);

	const contour = radialBoundary(points2D, 180);
	await yieldToBrowser();
	const heightfield = await extractHeightfieldAsync(mesh, contour, 0, 0, BLOCK_DEPTH);
	remappedGeom.dispose();

	return { contour, heightfield };
}

/**
 * Fetch an STL file, auto-orient it, and return both the 2D boundary contour
 * AND a 3D heightfield in block-local NC coordinates.
 */
export async function extractStlContour(
	stlUrl: string,
	side: 'left' | 'right',
	blockW = BLOCK_W,
	blockH = BLOCK_H,
	baseInsoleType: BaseInsoleType = 'man',
): Promise<StlExtractionResult> {
	// ── 1. Fetch and parse STL ──
	const response = await fetch(stlUrl);
	if (!response.ok) {
		console.warn(`[extractStlContour] Failed to fetch ${stlUrl}: ${response.status}`);
		return EMPTY_RESULT;
	}
	const buffer = await response.arrayBuffer();
	const loader = new STLLoader();
	const geometry = loader.parse(buffer);
	applyBaseInsoleTypeShape(geometry, baseInsoleType);

	geometry.computeBoundingBox();
	const bb = geometry.boundingBox;
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!bb || !pos || pos.count === 0) return EMPTY_RESULT;

	return extractFromPreparedGeometryAsync(geometry, bb, pos, side, blockW, blockH);
}

// ──────────────────────────────────────────────
// Internal: shared extraction pipeline
// ──────────────────────────────────────────────

/**
 * Core extraction pipeline used by both extractStlContour and extractContourFromGeometry.
 * Auto-orients the geometry, remaps to NC coordinates, extracts contour + heightfield.
 */
function extractFromPreparedGeometry(
	geometry: THREE.BufferGeometry,
	bb: THREE.Box3,
	pos: THREE.BufferAttribute,
	side: 'left' | 'right',
	blockW: number,
	blockH: number,
): StlExtractionResult {
	// ── Auto-orient — identical logic to InsoleSTL in CncFixtureView ──
	const size = bb.getSize(new THREE.Vector3());
	type Axis = 'x' | 'y' | 'z';
	const axes: Axis[] = ['x', 'y', 'z'];
	const sizes: Record<Axis, number> = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);

	const heightAxis = axes[0]; // thinnest = thickness (up/down)
	const widthAxis = axes[1]; // middle dimension = width
	const lengthAxis = axes[2]; // longest dimension = toe-heel

	const getVal = (i: number, axis: Axis): number =>
		axis === 'x' ? pos.getX(i) : axis === 'y' ? pos.getY(i) : pos.getZ(i);

	const minLen = bb.min[lengthAxis];
	const maxLen = bb.max[lengthAxis];
	const lenSpan = maxLen - minLen;

	const minH = bb.min[heightAxis];
	const maxH = bb.max[heightAxis];
	const hSpan = maxH - minH;

	const centerW = bb.min[widthAxis] + sizes[widthAxis] / 2;

	// Detect heel end (the wider end of the insole)
	const slicePct = lenSpan * 0.1;
	let minEndW = 0, maxEndW = 0, minC = 0, maxC = 0;
	for (let i = 0; i < pos.count; i++) {
		const lv = getVal(i, lengthAxis);
		const wv = getVal(i, widthAxis);
		if (lv <= minLen + slicePct) { minEndW += Math.abs(wv - centerW); minC++; }
		if (lv >= maxLen - slicePct) { maxEndW += Math.abs(wv - centerW); maxC++; }
	}
	const heelAtMin = minC > 0 && maxC > 0
		? (minEndW / minC) >= (maxEndW / maxC)
		: true;

	// Scale to fit half-block (same margins as InsoleSTL)
	const halfSpace = blockW / 2 - 6; // 6 mm margin from block edge / center divider
	const lenSpace = blockH - 16; // 8 mm margin at each end
	const rawWidth = sizes[widthAxis];
	const fitScale = Math.min(halfSpace / rawWidth, lenSpace / lenSpan);

	// ── Build remapped geometry for raycasting ──
	// Remap: X = width, Y = height (up), Z = length
	const halfCenterX = side === 'left' ? blockW / 4 : (3 * blockW) / 4;
	const lengthCenter = blockH / 2;

	const newPos = new Float32Array(pos.count * 3);
	const points2D: [number, number][] = [];

	for (let i = 0; i < pos.count; i++) {
		const lv = getVal(i, lengthAxis);
		const wv = getVal(i, widthAxis);
		const hv = getVal(i, heightAxis);

		const canonLen = heelAtMin ? (lv - minLen) : (maxLen - lv);
		const canonW = wv - centerW;
		const canonH = hv - minH; // 0 = bottom surface, hSpan = top surface

		const ncX = canonW * fitScale + halfCenterX;
		const ncY = (canonLen - lenSpan / 2) * fitScale + lengthCenter;
		// NC Z: 0 = stock top surface, negative = into stock
		// Map the insole's height range so the top of the insole is at Z=0
		// and the deepest point goes to -maxDepth
		const ncZ = (canonH - hSpan) * fitScale; // top=0, bottom=-depth

		newPos[i * 3 + 0] = ncX;
		newPos[i * 3 + 1] = ncZ; // Y axis in Three.js = NC Z
		newPos[i * 3 + 2] = ncY;

		points2D.push([ncX, ncY]);
	}

	// Build Three.js mesh for raycasting
	const remappedGeom = new THREE.BufferGeometry();
	remappedGeom.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
	if (geometry.index) remappedGeom.setIndex(geometry.index.clone());
	remappedGeom.computeVertexNormals();
	remappedGeom.computeBoundingBox();

	const mesh = new THREE.Mesh(
		remappedGeom,
		new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
	);

	// ── Extract outer boundary contour ──
	const contour = radialBoundary(points2D, 120);

	// ── Extract heightfield via raycasting ──
	const heightfield = extractHeightfield(mesh, contour, blockW, blockH, BLOCK_DEPTH);

	// Dispose
	remappedGeom.dispose();

	return { contour, heightfield };
}

async function extractFromPreparedGeometryAsync(
	geometry: THREE.BufferGeometry,
	bb: THREE.Box3,
	pos: THREE.BufferAttribute,
	side: 'left' | 'right',
	blockW: number,
	blockH: number,
): Promise<StlExtractionResult> {
	const size = bb.getSize(new THREE.Vector3());
	type Axis = 'x' | 'y' | 'z';
	const axes: Axis[] = ['x', 'y', 'z'];
	const sizes: Record<Axis, number> = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);

	const heightAxis = axes[0];
	const widthAxis = axes[1];
	const lengthAxis = axes[2];

	const getVal = (i: number, axis: Axis): number =>
		axis === 'x' ? pos.getX(i) : axis === 'y' ? pos.getY(i) : pos.getZ(i);

	const minLen = bb.min[lengthAxis];
	const maxLen = bb.max[lengthAxis];
	const lenSpan = maxLen - minLen;
	const minH = bb.min[heightAxis];
	const maxH = bb.max[heightAxis];
	const hSpan = maxH - minH;
	const centerW = bb.min[widthAxis] + sizes[widthAxis] / 2;

	const slicePct = lenSpan * 0.1;
	let minEndW = 0, maxEndW = 0, minC = 0, maxC = 0;
	for (let i = 0; i < pos.count; i++) {
		const lv = getVal(i, lengthAxis);
		const wv = getVal(i, widthAxis);
		if (lv <= minLen + slicePct) { minEndW += Math.abs(wv - centerW); minC++; }
		if (lv >= maxLen - slicePct) { maxEndW += Math.abs(wv - centerW); maxC++; }
	}
	const heelAtMin = minC > 0 && maxC > 0
		? (minEndW / minC) >= (maxEndW / maxC)
		: true;

	const halfSpace = blockW / 2 - 6;
	const lenSpace = blockH - 16;
	const rawWidth = sizes[widthAxis];
	const fitScale = Math.min(halfSpace / rawWidth, lenSpace / lenSpan);

	const halfCenterX = side === 'left' ? blockW / 4 : (3 * blockW) / 4;
	const lengthCenter = blockH / 2;

	const newPos = new Float32Array(pos.count * 3);
	const points2D: [number, number][] = [];

	for (let i = 0; i < pos.count; i++) {
		const lv = getVal(i, lengthAxis);
		const wv = getVal(i, widthAxis);
		const hv = getVal(i, heightAxis);

		const canonLen = heelAtMin ? (lv - minLen) : (maxLen - lv);
		const canonW = wv - centerW;
		const canonH = hv - minH;

		const ncX = canonW * fitScale + halfCenterX;
		const ncY = (canonLen - lenSpan / 2) * fitScale + lengthCenter;
		const ncZ = (canonH - hSpan) * fitScale;

		newPos[i * 3 + 0] = ncX;
		newPos[i * 3 + 1] = ncZ;
		newPos[i * 3 + 2] = ncY;
		points2D.push([ncX, ncY]);
	}

	const remappedGeom = new THREE.BufferGeometry();
	remappedGeom.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
	if (geometry.index) remappedGeom.setIndex(geometry.index.clone());
	remappedGeom.computeVertexNormals();
	remappedGeom.computeBoundingBox();

	const mesh = new THREE.Mesh(
		remappedGeom,
		new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
	);

	const contour = radialBoundary(points2D, 120);
	await yieldToBrowser();
	const heightfield = await extractHeightfieldAsync(mesh, contour, blockW, blockH, BLOCK_DEPTH);
	remappedGeom.dispose();

	return { contour, heightfield };
}

// ──────────────────────────────────────────────
// Internal: heightfield extraction via raycasting
// ──────────────────────────────────────────────

/**
 * Sample the 3D surface of the insole mesh at a regular XY grid by casting
 * rays downward (−Y in Three.js space = −Z in NC space) and recording where
 * they hit the surface.
 *
 * Returns a HeightfieldData object with Z values in NC coordinates
 * (0 = stock top, negative = into stock).
 */
function extractHeightfield(
	mesh: THREE.Mesh,
	contour: [number, number][],
	_blockW: number,
	_blockH: number,
	maxDepthMm: number,
): HeightfieldData {
	if (contour.length === 0) {
		return { cols: 0, rows: 0, cellSizeMm: 1, zValues: [], originOffsetMm: { x: 0, y: 0 } };
	}

	// Compute contour bounding box
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const [cx, cy] of contour) {
		if (cx < minX) minX = cx;
		if (cx > maxX) maxX = cx;
		if (cy < minY) minY = cy;
		if (cy > maxY) maxY = cy;
	}

	// Add a small margin around the contour
	const margin = 1;
	minX -= margin;
	maxX += margin;
	minY -= margin;
	maxY += margin;

	// Grid resolution: ~1mm cells for a good balance of detail vs file size
	const cellSize = 1.0;
	const cols = Math.ceil((maxX - minX) / cellSize) + 1;
	const rows = Math.ceil((maxY - minY) / cellSize) + 1;

	const zValues = new Float32Array(rows * cols);
	// Default to 0 (stock surface) for cells outside the insole
	zValues.fill(0);

	const raycaster = new THREE.Raycaster();
	const rayOrigin = new THREE.Vector3();
	const rayDir = new THREE.Vector3(0, -1, 0); // Cast downward in Three.js Y = NC Z

	for (let row = 0; row < rows; row++) {
		const ncY = minY + row * cellSize;
		for (let col = 0; col < cols; col++) {
			const ncX = minX + col * cellSize;

			// Check if point is inside contour (simple ray-casting point-in-polygon)
			if (!pointInContour(ncX, ncY, contour)) {
				zValues[row * cols + col] = 0; // outside = stock surface
				continue;
			}

			// Cast ray from above down into the mesh
			// Three.js coords: X = NC X, Y = NC Z (high above), Z = NC Y
			rayOrigin.set(ncX, 50, ncY); // start 50mm above
			raycaster.set(rayOrigin, rayDir);

			const hits = raycaster.intersectObject(mesh, false);
			if (hits.length > 0) {
				// Take the highest hit point (closest to ray origin)
				const hitZ = hits[0].point.y; // Three.js Y = NC Z
				// Clamp to maxDepth
				const z = Math.max(hitZ, -maxDepthMm);
				zValues[row * cols + col] = z;
			} else {
				// Inside contour but no hit — use max depth as fallback
				zValues[row * cols + col] = -maxDepthMm;
			}
		}
	}

	return {
		cols,
		rows,
		cellSizeMm: cellSize,
		zValues,
		originOffsetMm: { x: minX, y: minY },
	};
}

async function extractHeightfieldAsync(
	mesh: THREE.Mesh,
	contour: [number, number][],
	_blockW: number,
	_blockH: number,
	maxDepthMm: number,
): Promise<HeightfieldData> {
	if (contour.length === 0) {
		return { cols: 0, rows: 0, cellSizeMm: 1, zValues: [], originOffsetMm: { x: 0, y: 0 } };
	}

	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const [cx, cy] of contour) {
		if (cx < minX) minX = cx;
		if (cx > maxX) maxX = cx;
		if (cy < minY) minY = cy;
		if (cy > maxY) maxY = cy;
	}

	const margin = 1;
	minX -= margin;
	maxX += margin;
	minY -= margin;
	maxY += margin;

	const cellSize = 1.0;
	const cols = Math.ceil((maxX - minX) / cellSize) + 1;
	const rows = Math.ceil((maxY - minY) / cellSize) + 1;

	const zValues = new Float32Array(rows * cols);
	zValues.fill(0);

	const raycaster = new THREE.Raycaster();
	const rayOrigin = new THREE.Vector3();
	const rayDir = new THREE.Vector3(0, -1, 0);

	for (let row = 0; row < rows; row++) {
		if (row > 0 && row % HEIGHTFIELD_YIELD_EVERY_ROWS === 0) {
			await yieldToBrowser();
		}
		const ncY = minY + row * cellSize;
		for (let col = 0; col < cols; col++) {
			const ncX = minX + col * cellSize;
			if (!pointInContour(ncX, ncY, contour)) {
				zValues[row * cols + col] = 0;
				continue;
			}

			rayOrigin.set(ncX, 50, ncY);
			raycaster.set(rayOrigin, rayDir);
			const hits = raycaster.intersectObject(mesh, false);
			if (hits.length > 0) {
				const hitZ = hits[0].point.y;
				const z = Math.max(hitZ, -maxDepthMm);
				zValues[row * cols + col] = z;
			} else {
				zValues[row * cols + col] = -maxDepthMm;
			}
		}
	}

	return {
		cols,
		rows,
		cellSizeMm: cellSize,
		zValues,
		originOffsetMm: { x: minX, y: minY },
	};
}

/**
 * Point-in-polygon test using ray casting algorithm.
 */
function pointInContour(px: number, py: number, contour: [number, number][]): boolean {
	let inside = false;
	for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
		const [xi, yi] = contour[i];
		const [xj, yj] = contour[j];
		if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

// ──────────────────────────────────────────────
// Internal: radial boundary extraction
// ──────────────────────────────────────────────

/**
 * Extract the outer boundary of a 2D point cloud using a radial sweep.
 *
 * Divides angular space around the centroid into `numBins` sectors and keeps
 * the farthest point per sector. This produces a star-convex outer boundary
 * which works well for insole shapes (roughly convex from their centre).
 */
function radialBoundary(
	points: [number, number][],
	numBins: number,
): [number, number][] {
	if (points.length === 0) return [];

	// Centroid
	let cx = 0, cy = 0;
	for (const [x, y] of points) { cx += x; cy += y; }
	cx /= points.length;
	cy /= points.length;

	// Bin by angle — keep farthest point per bin
	const bins: { distSq: number; x: number; y: number }[] = Array.from(
		{ length: numBins },
		() => ({ distSq: -1, x: 0, y: 0 }),
	);
	const binSize = (2 * Math.PI) / numBins;

	for (const [x, y] of points) {
		const dx = x - cx;
		const dy = y - cy;
		const distSq = dx * dx + dy * dy;
		let angle = Math.atan2(dy, dx);
		if (angle < 0) angle += 2 * Math.PI;
		const bin = Math.min(Math.floor(angle / binSize), numBins - 1);

		if (distSq > bins[bin].distSq) {
			bins[bin] = { distSq, x, y };
		}
	}

	// Collect non-empty bins → ordered contour
	const contour: [number, number][] = [];
	for (const bin of bins) {
		if (bin.distSq >= 0) {
			contour.push([
				Math.round(bin.x * 100) / 100,
				Math.round(bin.y * 100) / 100,
			]);
		}
	}

	return contour;
}

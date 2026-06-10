import type { BufferAttribute, BufferGeometry } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export type StlSilhouette = { points: [number, number][]; w: number; h: number };

const silhouetteCache = new Map<string, StlSilhouette>();
const SILHOUETTE_CACHE_PREFIX = 'iso:v1:';
const GRID = 96;
const SQRT1_2 = Math.SQRT1_2;

function readVertex(
	pos: BufferAttribute,
	index: number,
	swapYZ: boolean,
): [number, number, number] {
	const x = pos.getX(index);
	if (!swapYZ) return [x, pos.getY(index), pos.getZ(index)];
	return [x, pos.getZ(index), pos.getY(index)];
}

/** Classic isometric screen projection (shows height + footprint, not just top face). */
function projectIsometric(x: number, y: number, z: number): [number, number] {
	return [(x - z) * SQRT1_2, -y + (x + z) * 0.5];
}

function dilateOccupied(occupied: Uint8Array, grid: number, passes: number): void {
	for (let pass = 0; pass < passes; pass++) {
		const next = new Uint8Array(occupied);
		for (let gy = 1; gy < grid - 1; gy++) {
			for (let gx = 1; gx < grid - 1; gx++) {
				if (occupied[gy * grid + gx]) continue;
				let neighbours = 0;
				for (const [dx, dy] of [
					[-1, 0],
					[1, 0],
					[0, -1],
					[0, 1],
				] as const) {
					if (occupied[(gy + dy) * grid + (gx + dx)]) neighbours++;
				}
				if (neighbours >= 2) next[gy * grid + gx] = 1;
			}
		}
		occupied.set(next);
	}
}

function traceBoundary(occupied: Uint8Array, grid: number): [number, number][] {
	const boundary: [number, number][] = [];
	for (let gy = 0; gy < grid; gy++) {
		for (let gx = 0; gx < grid; gx++) {
			if (!occupied[gy * grid + gx]) continue;
			let isBorder =
				gx === 0 || gx === grid - 1 || gy === 0 || gy === grid - 1;
			if (!isBorder) {
				for (const [dx, dy] of [
					[-1, 0],
					[1, 0],
					[0, -1],
					[0, 1],
				] as const) {
					if (!occupied[(gy + dy) * grid + (gx + dx)]) {
						isBorder = true;
						break;
					}
				}
			}
			if (isBorder) boundary.push([(gx + 0.5) / grid, (gy + 0.5) / grid]);
		}
	}
	if (boundary.length > 2) {
		let cx = 0;
		let cy = 0;
		for (const [x, y] of boundary) {
			cx += x;
			cy += y;
		}
		cx /= boundary.length;
		cy /= boundary.length;
		boundary.sort(
			(a, b) =>
				Math.atan2(a[1] - cy, a[0] - cx) -
				Math.atan2(b[1] - cy, b[0] - cx),
		);
	}
	return boundary;
}

/** Build a 2D silhouette from the full STL mesh using an isometric projection. */
export function buildStlSilhouette(
	geom: BufferGeometry,
	swapYZ = false,
): StlSilhouette {
	const pos = geom.getAttribute('position') as BufferAttribute;
	const count = pos.count;
	const projected: [number, number][] = [];
	let minU = Infinity;
	let maxU = -Infinity;
	let minV = Infinity;
	let maxV = -Infinity;

	for (let i = 0; i < count; i++) {
		const [x, y, z] = readVertex(pos, i, swapYZ);
		const [u, v] = projectIsometric(x, y, z);
		projected.push([u, v]);
		if (u < minU) minU = u;
		if (u > maxU) maxU = u;
		if (v < minV) minV = v;
		if (v > maxV) maxV = v;
	}

	const spanU = Math.max(maxU - minU, 1e-6);
	const spanV = Math.max(maxV - minV, 1e-6);
	const occupied = new Uint8Array(GRID * GRID);
	for (const [u, v] of projected) {
		const gx = Math.min(
			GRID - 1,
			Math.max(0, Math.floor(((u - minU) / spanU) * GRID)),
		);
		const gy = Math.min(
			GRID - 1,
			Math.max(0, Math.floor(((v - minV) / spanV) * GRID)),
		);
		occupied[gy * GRID + gx] = 1;
	}
	dilateOccupied(occupied, GRID, 2);

	return {
		points: traceBoundary(occupied, GRID),
		w: spanU,
		h: spanV,
	};
}

export function loadStlSilhouette(
	stlUrls: string[],
	swapYZ = false,
): Promise<StlSilhouette | null> {
	const cacheKey = stlUrls[0] ? `${SILHOUETTE_CACHE_PREFIX}${stlUrls[0]}` : '';
	if (!cacheKey) return Promise.resolve(null);
	const cached = silhouetteCache.get(cacheKey);
	if (cached) return Promise.resolve(cached);

	const loader = new STLLoader();
	const tryLoad = (index: number): Promise<StlSilhouette | null> => {
		const stlUrl = stlUrls[index];
		if (!stlUrl) return Promise.resolve(null);
		return new Promise((resolve) => {
			loader.load(
				stlUrl,
				(geom) => {
					const result = buildStlSilhouette(geom, swapYZ);
					silhouetteCache.set(cacheKey, result);
					resolve(result);
				},
				undefined,
				() => {
					if (index < stlUrls.length - 1) {
						resolve(tryLoad(index + 1));
						return;
					}
					resolve(null);
				},
			);
		});
	};

	return tryLoad(0);
}

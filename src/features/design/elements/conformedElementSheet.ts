/**
 * ──────────────────────────────────────────────
 *  Conformed element pad sheet
 *
 *  Builds an element's on-screen overlay as a smooth raised pad generated from
 *  its top-surface height field (the SAME representation the STL/G-code export
 *  uses) and conformed onto the insole surface via the BVH sampler.
 *
 *  Why a sheet instead of draping the raw STL solid: the authored element STLs
 *  are multi-mm-thick solids (walls + bottom). Draping the whole solid scatters
 *  the walls/skirt onto the insole (torn edges) and compresses the height. A
 *  height-field pad has a clean footprint, melts flush at its boundary, and
 *  rises to exactly the requested peak height for every element.
 *
 *  The insole is read-only here: seating uses InsoleSurfaceSampler, which owns a
 *  private BVH clone, so the live insole geometry is never modified.
 * ──────────────────────────────────────────────
 */
import * as THREE from 'three';
import {
	sampleElementHeightMm,
	type ElementStlHeightField,
} from './elementStlHeightField';
import {
	seatColumnOnSurface,
	type InsoleSurfaceSampler,
} from './conformElementToInsole';

type AxisKey = 'x' | 'y' | 'z';

export interface ConformedSheetParams {
	field: ElementStlHeightField;
	sampler: InsoleSurfaceSampler;
	/** Element centre on the insole, in insole-local world units. */
	centreLengthWorld: number;
	centreWidthWorld: number;
	rotationRad: number;
	/** World units per STL mm. scaleWidth < 0 mirrors the footprint. */
	scaleWidth: number;
	scaleLength: number;
	scaleHeight: number;
	lengthAxis: AxisKey;
	widthAxis: AxisKey;
	heightAxis: AxisKey;
	/** Coarse insole top height (height-axis world) at a footprint point: ray seed. */
	seedHeight: (lengthWorld: number, widthWorld: number) => number;
	/** Peak rise in world units (= targetHeightMm * mmToWorld), for colour fade. */
	maxRiseWorld: number;
	/** Footprint cells over which the rise melts to 0 at the boundary. */
	edgeFadeCells?: number;
	/** Grid Laplacian smoothing passes on the raised body (default 3). */
	smoothingPasses?: number;
	elementColorHex: string;
	insoleColorHex: string;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/** Extra-smooth ramp for the perimeter melt (zero 1st/2nd derivative at both ends). */
function smootherEdgeFade(edge0: number, edge1: number, x: number): number {
	const t = smoothstep(edge0, edge1, x);
	return t * t * (3 - 2 * t);
}

/**
 * Manhattan distance (in cells) from each occupied cell to the nearest
 * unoccupied cell, via a two-pass chamfer. Unoccupied cells are 0.
 */
const DIAG = Math.SQRT2;

function footprintInteriorDistance(occupied: Uint8Array, g: number): Float32Array {
	const dist = new Float32Array(g * g);
	const BIG = g * 2;
	for (let i = 0; i < g * g; i++) dist[i] = occupied[i] ? BIG : 0;
	for (let gy = 0; gy < g; gy++) {
		for (let gx = 0; gx < g; gx++) {
			const i = gy * g + gx;
			if (!occupied[i]) continue;
			if (gx > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
			if (gy > 0) dist[i] = Math.min(dist[i], dist[i - g] + 1);
			if (gx > 0 && gy > 0) dist[i] = Math.min(dist[i], dist[i - g - 1] + DIAG);
			if (gx < g - 1 && gy > 0) dist[i] = Math.min(dist[i], dist[i - g + 1] + DIAG);
			if (gx === 0 || gy === 0) dist[i] = Math.min(dist[i], 1);
		}
	}
	for (let gy = g - 1; gy >= 0; gy--) {
		for (let gx = g - 1; gx >= 0; gx--) {
			const i = gy * g + gx;
			if (!occupied[i]) continue;
			if (gx < g - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
			if (gy < g - 1) dist[i] = Math.min(dist[i], dist[i + g] + 1);
			if (gx < g - 1 && gy < g - 1) dist[i] = Math.min(dist[i], dist[i + g + 1] + DIAG);
			if (gx > 0 && gy < g - 1) dist[i] = Math.min(dist[i], dist[i + g - 1] + DIAG);
			if (gx === g - 1 || gy === g - 1) dist[i] = Math.min(dist[i], 1);
		}
	}
	return dist;
}

function dilateMask(mask: Uint8Array, g: number): Uint8Array {
	const out = new Uint8Array(g * g);
	for (let gy = 0; gy < g; gy++) {
		for (let gx = 0; gx < g; gx++) {
			let hit = 0;
			for (let dy = -1; dy <= 1 && !hit; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = gx + dx;
					const ny = gy + dy;
					if (nx < 0 || nx >= g || ny < 0 || ny >= g) continue;
					if (mask[ny * g + nx]) {
						hit = 1;
						break;
					}
				}
			}
			out[gy * g + gx] = hit;
		}
	}
	return out;
}

function erodeMask(mask: Uint8Array, g: number, minNeighbours = 5): Uint8Array {
	const out = new Uint8Array(g * g);
	for (let gy = 0; gy < g; gy++) {
		for (let gx = 0; gx < g; gx++) {
			const i = gy * g + gx;
			if (!mask[i]) continue;
			let count = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = gx + dx;
					const ny = gy + dy;
					if (nx < 0 || nx >= g || ny < 0 || ny >= g) continue;
					if (mask[ny * g + nx]) count++;
				}
			}
			out[i] = count >= minNeighbours ? 1 : 0;
		}
	}
	return out;
}

function cleanupFootprintMask(occupied: Uint8Array, g: number): Uint8Array {
	// Close small holes, then open one-cell spikes. The permissive erosion keeps
	// narrow authored tips while removing raster noise from the STL vertex mask.
	const closed = erodeMask(dilateMask(occupied, g), g);
	return dilateMask(erodeMask(closed, g), g);
}

function upsampleOccupancyFloat(
	mask: Uint8Array,
	sourceGrid: number,
	renderGrid: number,
): Float32Array {
	const out = new Float32Array(renderGrid * renderGrid);
	for (let gy = 0; gy < renderGrid; gy++) {
		for (let gx = 0; gx < renderGrid; gx++) {
			const u = ((gx + 0.5) / renderGrid) * sourceGrid - 0.5;
			const v = ((gy + 0.5) / renderGrid) * sourceGrid - 0.5;
			const x0 = Math.floor(u);
			const y0 = Math.floor(v);
			const fx = u - x0;
			const fy = v - y0;
			let sum = 0;
			for (let dy = 0; dy <= 1; dy++) {
				for (let dx = 0; dx <= 1; dx++) {
					const sx = Math.min(sourceGrid - 1, Math.max(0, x0 + dx));
					const sy = Math.min(sourceGrid - 1, Math.max(0, y0 + dy));
					const w = (dx === 0 ? 1 - fx : fx) * (dy === 0 ? 1 - fy : fy);
					sum += mask[sy * sourceGrid + sx] * w;
				}
			}
			out[gy * renderGrid + gx] = sum;
		}
	}
	return out;
}

/** Fill zero-rise interior holes surrounded by raised neighbours. */
function fillRiseGridHoles(
	rise: Float32Array,
	active: Uint8Array,
	g: number,
): void {
	for (let pass = 0; pass < 2; pass++) {
		for (let gy = 0; gy < g; gy++) {
			for (let gx = 0; gx < g; gx++) {
				const i = gy * g + gx;
				if (!active[i] || rise[i] > 1e-5) continue;
				let sum = 0;
				let n = 0;
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dy === 0) continue;
						const nx = gx + dx;
						const ny = gy + dy;
						if (nx < 0 || nx >= g || ny < 0 || ny >= g) continue;
						const ni = ny * g + nx;
						if (!active[ni] || rise[ni] <= 1e-5) continue;
						sum += rise[ni];
						n++;
					}
				}
				if (n >= 5) rise[i] = sum / n;
			}
		}
	}
}

/** Box-blur rise values on the render grid so the perimeter ramp is continuous. */
function smoothRiseGrid(
	rise: Float32Array,
	active: Uint8Array,
	g: number,
	passes: number,
): void {
	const scratch = new Float32Array(rise.length);
	let peak = 0;
	for (let i = 0; i < rise.length; i++) {
		if (active[i] && rise[i] > peak) peak = rise[i];
	}
	for (let pass = 0; pass < passes; pass++) {
		scratch.set(rise);
		for (let gy = 0; gy < g; gy++) {
			for (let gx = 0; gx < g; gx++) {
				const i = gy * g + gx;
				if (!active[i]) continue;
				let sum = scratch[i];
				let n = 1;
				if (gx > 0 && active[i - 1]) {
					sum += scratch[i - 1];
					n++;
				}
				if (gx < g - 1 && active[i + 1]) {
					sum += scratch[i + 1];
					n++;
				}
				if (gy > 0 && active[i - g]) {
					sum += scratch[i - g];
					n++;
				}
				if (gy < g - 1 && active[i + g]) {
					sum += scratch[i + g];
					n++;
				}
				rise[i] = sum / n;
			}
		}
	}
	if (peak > 1e-6) {
		let curPeak = 0;
		for (let i = 0; i < rise.length; i++) {
			if (active[i] && rise[i] > curPeak) curPeak = rise[i];
		}
		if (curPeak > 1e-6) {
			const scale = peak / curPeak;
			for (let i = 0; i < rise.length; i++) {
				if (active[i]) rise[i] *= scale;
			}
		}
	}
}

const _anchor = new THREE.Vector3();
const _out = new THREE.Vector3();

export function buildConformedElementSheet(
	p: ConformedSheetParams,
): THREE.BufferGeometry {
	const { field, sampler } = p;
	const g = field.gridSize;
	const { occupied, stlMinX, stlMinY, stlCenterX, stlCenterY } = field;
	const edgeFadeCells = p.edgeFadeCells ?? 7;
	const renderMul = 4;
	const renderGrid = g * renderMul;
	const renderCellW = field.sourceWidthMm / renderGrid;
	const renderCellL = field.sourceLengthMm / renderGrid;
	const edgeFadeRenderCells = edgeFadeCells * renderMul;
	const colorFadeCells = Math.max(1, edgeFadeRenderCells * 0.75);
	const minVisibleRise = p.maxRiseWorld * 0.03;
	const cos = Math.cos(p.rotationRad);
	const sin = Math.sin(p.rotationRad);
	const mirrored = p.scaleWidth < 0;

	const cleanMask = cleanupFootprintMask(occupied, g);
	const softOcc = upsampleOccupancyFloat(cleanMask, g, renderGrid);
	const coreMask = new Uint8Array(renderGrid * renderGrid);
	const render = new Uint8Array(renderGrid * renderGrid);
	for (let i = 0; i < softOcc.length; i++) {
		coreMask[i] = softOcc[i]! >= 0.5 ? 1 : 0;
		render[i] = softOcc[i]! >= 0.04 ? 1 : 0;
	}
	const dist = footprintInteriorDistance(coreMask, renderGrid);

	const elementColor = new THREE.Color(p.elementColorHex);
	const insoleColor = new THREE.Color(p.insoleColorHex);
	const tmpColor = new THREE.Color();
	const maxRise = Math.max(1e-5, p.maxRiseWorld);

	// Build a continuous rise field on the render grid, blur it, then seat columns.
	// Blurring before seating removes the stair-step spikes at the insole seam.
	const riseGrid = new Float32Array(renderGrid * renderGrid);
	for (let gy = 0; gy < renderGrid; gy++) {
		for (let gx = 0; gx < renderGrid; gx++) {
			const i = gy * renderGrid + gx;
			if (!render[i]) continue;
			const rawX = stlMinX + (gx + 0.5) * renderCellW;
			const rawY = stlMinY + (gy + 0.5) * renderCellL;
			const occ = softOcc[i]!;
			const edge = smootherEdgeFade(0, edgeFadeRenderCells, dist[i]);
			const occFeather = smoothstep(0.08, 0.55, occ);
			riseGrid[i] =
				sampleElementHeightMm(field, rawX, rawY) * p.scaleHeight * edge * occFeather;
		}
	}
	fillRiseGridHoles(riseGrid, render, renderGrid);
	smoothRiseGrid(riseGrid, render, renderGrid, 5);

	const vmap = new Int32Array(renderGrid * renderGrid).fill(-1);
	const posArr: number[] = [];
	const colArr: number[] = [];
	const riseArr: number[] = [];
	const riseWorldArr: number[] = [];
	const cellGx: number[] = [];
	const cellGy: number[] = [];

	for (let gy = 0; gy < renderGrid; gy++) {
		for (let gx = 0; gx < renderGrid; gx++) {
			const i = gy * renderGrid + gx;
			if (!render[i]) continue;

			const rawX = stlMinX + (gx + 0.5) * renderCellW;
			const rawY = stlMinY + (gy + 0.5) * renderCellL;
			const rise = riseGrid[i];

			const localWidth = (rawX - stlCenterX) * p.scaleWidth;
			const localLength = (rawY - stlCenterY) * p.scaleLength;
			const rx = localWidth * cos - localLength * sin;
			const ry = localWidth * sin + localLength * cos;
			const lengthWorld = p.centreLengthWorld + ry;
			const widthWorld = p.centreWidthWorld + rx;

			_anchor.set(0, 0, 0);
			_anchor[p.lengthAxis] = lengthWorld;
			_anchor[p.widthAxis] = widthWorld;
			_anchor[p.heightAxis] = p.seedHeight(lengthWorld, widthWorld);

			const normal = seatColumnOnSurface(sampler, _anchor, rise, { mode: 'auto' }, _out);
			if (!normal) {
				_out.copy(_anchor).addScaledVector(sampler.upAxis, rise);
			}
			const vi = posArr.length / 3;
			vmap[i] = vi;
			posArr.push(_out.x, _out.y, _out.z);

			const ratio = Math.min(1, rise / maxRise);
			const seamT = smoothstep(0, colorFadeCells, dist[i]);
			riseArr.push(ratio);
			riseWorldArr.push(rise);
			cellGx.push(gx);
			cellGy.push(gy);
			tmpColor.copy(insoleColor).lerp(elementColor, seamT);
			colArr.push(tmpColor.r, tmpColor.g, tmpColor.b);
		}
	}

	const indices: number[] = [];
	for (let gy = 0; gy < renderGrid - 1; gy++) {
		for (let gx = 0; gx < renderGrid - 1; gx++) {
			const a = vmap[gy * renderGrid + gx];
			const b = vmap[gy * renderGrid + gx + 1];
			const cc = vmap[(gy + 1) * renderGrid + gx];
			const d = vmap[(gy + 1) * renderGrid + gx + 1];
			if (a < 0 || b < 0 || cc < 0 || d < 0) continue;
			const quadPeak = Math.max(
				riseWorldArr[a]!,
				riseWorldArr[b]!,
				riseWorldArr[cc]!,
				riseWorldArr[d]!,
			);
			// Drop invisible perimeter quads so hover/raycast matches the visible pad.
			if (quadPeak < minVisibleRise) continue;
			if (mirrored) {
				indices.push(a, d, b, a, cc, d);
			} else {
				indices.push(a, b, d, a, d, cc);
			}
		}
	}

	// Grid Laplacian: relax the body and lightly smooth the seam ring, then re-seat
	// seam vertices on the insole so contact stays flush (zero gap).
	const positions = Float32Array.from(posArr);
	const riseRatio = Float32Array.from(riseArr);
	const scratch = new Float32Array(positions.length);
	const seamRiseThreshold = 0.22;
	const reseatVertex = (vi: number): void => {
		const gx = cellGx[vi]!;
		const gy = cellGy[vi]!;
		const rise = riseWorldArr[vi]!;
		const rawX = stlMinX + (gx + 0.5) * renderCellW;
		const rawY = stlMinY + (gy + 0.5) * renderCellL;
		const localWidth = (rawX - stlCenterX) * p.scaleWidth;
		const localLength = (rawY - stlCenterY) * p.scaleLength;
		const rx = localWidth * cos - localLength * sin;
		const ry = localWidth * sin + localLength * cos;
		const lengthWorld = p.centreLengthWorld + ry;
		const widthWorld = p.centreWidthWorld + rx;
		_anchor.set(0, 0, 0);
		_anchor[p.lengthAxis] = lengthWorld;
		_anchor[p.widthAxis] = widthWorld;
		_anchor[p.heightAxis] = p.seedHeight(lengthWorld, widthWorld);
		const hit = seatColumnOnSurface(sampler, _anchor, rise, { mode: 'auto' }, _out);
		if (!hit) _out.copy(_anchor).addScaledVector(sampler.upAxis, rise);
		const o = vi * 3;
		positions[o] = _out.x;
		positions[o + 1] = _out.y;
		positions[o + 2] = _out.z;
	};
	const smoothingPasses = p.smoothingPasses ?? 3;
	for (let pass = 0; pass < smoothingPasses; pass++) {
		scratch.set(positions);
		for (let gy = 0; gy < renderGrid; gy++) {
			for (let gx = 0; gx < renderGrid; gx++) {
				const vi = vmap[gy * renderGrid + gx];
				if (vi < 0) continue;
				const ratio = riseRatio[vi]!;
				const w =
					ratio <= seamRiseThreshold
						? 0.5 * (1 - ratio / seamRiseThreshold)
						: ratio * 0.6;
				if (w <= 0) continue;
				let sx = 0;
				let sy = 0;
				let sz = 0;
				let n = 0;
				const nbrs = [
					gx > 0 ? vmap[gy * renderGrid + gx - 1] : -1,
					gx < renderGrid - 1 ? vmap[gy * renderGrid + gx + 1] : -1,
					gy > 0 ? vmap[(gy - 1) * renderGrid + gx] : -1,
					gy < renderGrid - 1 ? vmap[(gy + 1) * renderGrid + gx] : -1,
				];
				for (const nv of nbrs) {
					if (nv < 0) continue;
					sx += scratch[nv * 3];
					sy += scratch[nv * 3 + 1];
					sz += scratch[nv * 3 + 2];
					n++;
				}
				if (n === 0) continue;
				const inv = 1 / n;
				const o = vi * 3;
				positions[o] += (sx * inv - scratch[o]) * w;
				positions[o + 1] += (sy * inv - scratch[o + 1]) * w;
				positions[o + 2] += (sz * inv - scratch[o + 2]) * w;
			}
		}
		for (let vi = 0; vi < riseRatio.length; vi++) {
			if (riseRatio[vi]! <= seamRiseThreshold) reseatVertex(vi);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(colArr), 3));
	geometry.setAttribute('rise', new THREE.BufferAttribute(riseRatio, 1));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;
}

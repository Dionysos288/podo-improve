import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildConformedElementSheet } from '@/src/features/design/elements/conformedElementSheet';
import { getInsoleSurfaceSampler } from '@/src/features/design/elements/conformElementToInsole';
import {
	getElementStlHeightField,
	rctbLengthProfileTaper,
	type ElementStlHeightField,
} from '@/src/features/design/elements/elementStlHeightField';

const INSOLE_TOP_Y = 4;

function createFlatInsole(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(120, 8, 40, 24, 2, 12); // top face at y=+4
	geom.computeVertexNormals();
	geom.computeBoundingBox();
	return geom;
}

function rampHeight(x: number): number {
	return 4 + 10 * ((x + 60) / 120);
}
function createRampedInsole(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(120, 8, 40, 48, 2, 16);
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		if (pos.getY(i) > 3.9) pos.setY(i, rampHeight(pos.getX(i)));
	}
	pos.needsUpdate = true;
	geom.computeVertexNormals();
	geom.computeBoundingBox();
	return geom;
}

/** Flat-top pad field: a central occupied rectangle at full source height. */
function makeFlatTopField(
	g: number,
	sourceWidthMm: number,
	sourceLengthMm: number,
	sourceHeightMm: number,
): ElementStlHeightField {
	const heightGridMm = new Float32Array(g * g);
	const occupied = new Uint8Array(g * g);
	const lo = Math.floor(g * 0.2);
	const hi = Math.ceil(g * 0.8);
	for (let gy = 0; gy < g; gy++) {
		for (let gx = 0; gx < g; gx++) {
			if (gx >= lo && gx < hi && gy >= lo && gy < hi) {
				occupied[gy * g + gx] = 1;
				heightGridMm[gy * g + gx] = sourceHeightMm;
			}
		}
	}
	return {
		gridSize: g,
		heightGridMm,
		occupied,
		sourceWidthMm,
		sourceLengthMm,
		sourceHeightMm,
		stlMinX: -sourceWidthMm / 2,
		stlMinY: -sourceLengthMm / 2,
		stlCenterX: 0,
		stlCenterY: 0,
		stlBaseZ: 0,
		cellW: sourceWidthMm / g,
		cellL: sourceLengthMm / g,
	};
}

function makeLowRiseInteriorField(
	g: number,
	sourceWidthMm: number,
	sourceLengthMm: number,
): ElementStlHeightField {
	const field = makeFlatTopField(g, sourceWidthMm, sourceLengthMm, 10);
	for (let i = 0; i < field.heightGridMm.length; i++) {
		if (field.occupied[i]) field.heightGridMm[i] = 1;
	}
	return field;
}

function buildSheet(
	insole: THREE.BufferGeometry,
	field: ElementStlHeightField,
	opts: {
		heightMm: number;
		targetWidthMm?: number;
		targetLengthMm?: number;
		smoothingPasses?: number;
		spanFillWidth?: boolean;
	},
): THREE.BufferGeometry {
	const sampler = getInsoleSurfaceSampler(insole);
	const tW = opts.targetWidthMm ?? field.sourceWidthMm;
	const tL = opts.targetLengthMm ?? field.sourceLengthMm;
	const tH = Math.max(0.2, Math.abs(opts.heightMm));
	return buildConformedElementSheet({
		field,
		sampler,
		centreLengthWorld: 0,
		centreWidthWorld: 0,
		rotationRad: 0,
		scaleWidth: tW / field.sourceWidthMm,
		scaleLength: tL / field.sourceLengthMm,
		scaleHeight: tH / field.sourceHeightMm,
		lengthAxis: 'x',
		widthAxis: 'z',
		heightAxis: 'y',
		seedHeight: () => 20,
		maxRiseWorld: tH,
		edgeFadeCells: 3,
		smoothingPasses: opts.smoothingPasses,
		elementColorHex: '#d7dadd',
		insoleColorHex: '#d7dadd',
		spanFillWidth: opts.spanFillWidth,
	});
}

/** Central occupied rect with deterministic per-cell height noise. */
function makeNoisyField(
	g: number,
	sourceWidthMm: number,
	sourceLengthMm: number,
	baseHeightMm: number,
	noiseMm: number,
): ElementStlHeightField {
	const heightGridMm = new Float32Array(g * g);
	const occupied = new Uint8Array(g * g);
	const lo = Math.floor(g * 0.2);
	const hi = Math.ceil(g * 0.8);
	for (let gy = 0; gy < g; gy++) {
		for (let gx = 0; gx < g; gx++) {
			if (gx >= lo && gx < hi && gy >= lo && gy < hi) {
				const r = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
				const frac = r - Math.floor(r);
				occupied[gy * g + gx] = 1;
				heightGridMm[gy * g + gx] = baseHeightMm + (frac * 2 - 1) * noiseMm;
			}
		}
	}
	return {
		gridSize: g,
		heightGridMm,
		occupied,
		sourceWidthMm,
		sourceLengthMm,
		sourceHeightMm: baseHeightMm + noiseMm,
		stlMinX: -sourceWidthMm / 2,
		stlMinY: -sourceLengthMm / 2,
		stlCenterX: 0,
		stlCenterY: 0,
		stlBaseZ: 0,
		cellW: sourceWidthMm / g,
		cellL: sourceLengthMm / g,
	};
}

/** Mean angle (radians) between the normals of edge-sharing triangles. */
function adjacentNormalRoughness(geom: THREE.BufferGeometry): number {
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const index = geom.getIndex()!;
	const normals: THREE.Vector3[] = [];
	const edgeTris = new Map<string, number[]>();
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	for (let t = 0; t < index.count; t += 3) {
		const ia = index.getX(t);
		const ib = index.getX(t + 1);
		const ic = index.getX(t + 2);
		a.fromBufferAttribute(pos, ia);
		b.fromBufferAttribute(pos, ib);
		c.fromBufferAttribute(pos, ic);
		const n = new THREE.Vector3().subVectors(b, a).cross(c.clone().sub(a)).normalize();
		const ti = t / 3;
		normals[ti] = n;
		for (const [u, v] of [
			[ia, ib],
			[ib, ic],
			[ic, ia],
		] as const) {
			const key = `${Math.min(u, v)}_${Math.max(u, v)}`;
			const list = edgeTris.get(key);
			if (list) list.push(ti);
			else edgeTris.set(key, [ti]);
		}
	}
	let sum = 0;
	let count = 0;
	for (const tris of edgeTris.values()) {
		if (tris.length !== 2) continue;
		const ang = normals[tris[0]!].angleTo(normals[tris[1]!]);
		if (Number.isFinite(ang)) {
			sum += ang;
			count++;
		}
	}
	return count > 0 ? sum / count : 0;
}

/** Min/max of an axis over only the vertices referenced by the index. */
function referencedRange(
	geom: THREE.BufferGeometry,
	axis: 'x' | 'y' | 'z',
): { min: number; max: number; span: number } {
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const index = geom.getIndex()!;
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < index.count; i++) {
		const v = index.getX(i);
		const value = axis === 'x' ? pos.getX(v) : axis === 'y' ? pos.getY(v) : pos.getZ(v);
		if (value < min) min = value;
		if (value > max) max = value;
	}
	return { min, max, span: max - min };
}

describe('buildConformedElementSheet', () => {
	it('peak rise equals the requested height for tall and thin source meshes', () => {
		const insole = createFlatInsole();
		for (const srcHeight of [10, 1.5]) {
			const field = makeFlatTopField(24, 48, 48, srcHeight);
			const r2 = referencedRange(buildSheet(insole, field, { heightMm: 2 }), 'y');
			const r4 = referencedRange(buildSheet(insole, field, { heightMm: 4 }), 'y');
			expect(r2.max - INSOLE_TOP_Y).toBeCloseTo(2, 0);
			expect(r4.max - INSOLE_TOP_Y).toBeCloseTo(4, 0);
			// Doubling the height roughly doubles the peak, regardless of native Z.
			expect(r4.max - INSOLE_TOP_Y).toBeGreaterThan((r2.max - INSOLE_TOP_Y) * 1.7);
		}
		insole.dispose();
	});

	it('melts flush to the surface at the footprint boundary (zero gap)', () => {
		const insole = createFlatInsole();
		const field = makeFlatTopField(24, 48, 48, 10);
		const sheet = buildSheet(insole, field, { heightMm: 3 });
		const r = referencedRange(sheet, 'y');
		// Lowest pad vertices sit on the insole top, not floating above or sunk in.
		expect(r.min).toBeGreaterThan(INSOLE_TOP_Y - 0.2);
		expect(r.min).toBeLessThan(INSOLE_TOP_Y + 0.3);
		sheet.dispose();
		insole.dispose();
	});

	it('conforms to a curved/ramped insole with no vertex floating or sunk', () => {
		const insole = createRampedInsole();
		const field = makeFlatTopField(24, 48, 48, 10);
		const sheet = buildSheet(insole, field, { heightMm: 3 });
		const pos = sheet.getAttribute('position') as THREE.BufferAttribute;
		const index = sheet.getIndex()!;
		for (let i = 0; i < index.count; i++) {
			const v = index.getX(i);
			const surface = rampHeight(pos.getX(v));
			const y = pos.getY(v);
			expect(y).toBeGreaterThan(surface - 0.25); // never below the surface
			expect(y).toBeLessThan(surface + 3 + 0.6); // never floats past peak height
		}
		sheet.dispose();
		insole.dispose();
	});

	it('footprint fill scales with the target width', () => {
		const insole = createFlatInsole();
		const field = makeFlatTopField(24, 48, 48, 10);
		// Both target widths stay within the 40mm-wide insole, so they are not
		// clamped at the rim (a wider-than-insole target is correctly clamped).
		const narrow = referencedRange(
			buildSheet(insole, field, { heightMm: 2, targetWidthMm: 24 }),
			'z',
		);
		const wide = referencedRange(
			buildSheet(insole, field, { heightMm: 2, targetWidthMm: 48 }),
			'z',
		);
		expect(wide.span).toBeGreaterThan(narrow.span * 1.7);
		insole.dispose();
	});

	it('builds the sheet on an upsampled render grid for smoother edges', () => {
		const insole = createFlatInsole();
		const field = makeFlatTopField(24, 48, 48, 10);
		const sheet = buildSheet(insole, field, { heightMm: 3, smoothingPasses: 0 });
		const pos = sheet.getAttribute('position') as THREE.BufferAttribute;

		// The rendered sheet is denser than the source 24x24 height-field footprint,
		// giving curved outlines twice the boundary resolution.
		expect(pos.count).toBeGreaterThan(24 * 24);

		sheet.dispose();
		insole.dispose();
	});

	it('uses neutral insole colour across the pad interior', () => {
		const insole = createFlatInsole();
		const field = makeLowRiseInteriorField(24, 48, 48);
		const sheet = buildSheet(insole, field, { heightMm: 5, smoothingPasses: 0 });
		const pos = sheet.getAttribute('position') as THREE.BufferAttribute;
		const color = sheet.getAttribute('color') as THREE.BufferAttribute;
		const insoleTint = new THREE.Color('#d7dadd');
		let bestInteriorMatch = -1;

		for (let i = 0; i < pos.count; i++) {
			const y = pos.getY(i);
			if (y <= INSOLE_TOP_Y + 0.25) continue;
			const dr = Math.abs(color.getX(i) - insoleTint.r);
			const dg = Math.abs(color.getY(i) - insoleTint.g);
			const db = Math.abs(color.getZ(i) - insoleTint.b);
			const match = 1 - Math.max(dr, dg, db);
			if (match > bestInteriorMatch) bestInteriorMatch = match;
		}

		expect(bestInteriorMatch).toBeGreaterThan(0.98);
		sheet.dispose();
		insole.dispose();
	});

	it('Laplacian smoothing keeps a noisy pad surface bounded without flattening it', () => {
		const insole = createFlatInsole();
		const field = makeNoisyField(24, 48, 48, 10, 4); // 10mm ± 4mm per-cell noise
		const rough0 = adjacentNormalRoughness(
			buildSheet(insole, field, { heightMm: 3, smoothingPasses: 0 }),
		);
		const rough3 = adjacentNormalRoughness(
			buildSheet(insole, field, { heightMm: 3, smoothingPasses: 3 }),
		);
		// Upsampling already cleans much of the raster noise; smoothing should not
		// introduce a rougher surface or flatten the pad away.
		expect(rough3).toBeLessThan(rough0 * 1.2);
		const r = referencedRange(
			buildSheet(insole, field, { heightMm: 3, smoothingPasses: 3 }),
			'y',
		);
		expect(r.max - INSOLE_TOP_Y).toBeGreaterThan(1);
		insole.dispose();
	});

	it('height field blur preserves the peak height (rescaled)', () => {
		// Dense, jagged top surface over a 20x20 footprint, heights in [0,10].
		const verts: number[] = [];
		let seed = 1;
		const rnd = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		for (let n = 0; n < 4000; n++) {
			const cx = (rnd() * 2 - 1) * 10;
			const cy = (rnd() * 2 - 1) * 10;
			const z = rnd() * 10;
			verts.push(cx, cy, z, cx + 0.4, cy, z, cx, cy + 0.4, z);
		}
		const stl = new THREE.BufferGeometry();
		stl.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(verts), 3));
		const field = getElementStlHeightField(stl, false);
		let maxH = 0;
		for (let i = 0; i < field.heightGridMm.length; i++) {
			if (field.occupied[i] && field.heightGridMm[i] > maxH) maxH = field.heightGridMm[i];
		}
		// Peak is restored to ~ the raw tallest vertex after the smoothing blur.
		expect(maxH).toBeGreaterThan(7);
		stl.dispose();
	});

	it('rctbLengthProfileTaper is a smooth dome with zero slope at heel and toe', () => {
		expect(rctbLengthProfileTaper(0)).toBe(0);
		expect(rctbLengthProfileTaper(0.25)).toBeCloseTo(Math.sin(0.25 * Math.PI));
		expect(rctbLengthProfileTaper(0.5)).toBeCloseTo(1);
		expect(rctbLengthProfileTaper(0.75)).toBeCloseTo(Math.sin(0.75 * Math.PI));
		expect(rctbLengthProfileTaper(1)).toBe(0);
	});

	it('spanFillWidth peak rise tracks the requested height setting', () => {
		const insole = createFlatInsole();
		const field = makeFlatTopField(24, 80, 48, 6);
		const low = buildSheet(insole, field, {
			heightMm: 2,
			targetWidthMm: 80,
			spanFillWidth: true,
			smoothingPasses: 0,
		});
		const high = buildSheet(insole, field, {
			heightMm: 4,
			targetWidthMm: 80,
			spanFillWidth: true,
			smoothingPasses: 0,
		});
		const lowY = referencedRange(low, 'y');
		const highY = referencedRange(high, 'y');
		const lowPeak = lowY.max - INSOLE_TOP_Y;
		const highPeak = highY.max - INSOLE_TOP_Y;
		expect(lowPeak).toBeGreaterThan(1.2);
		expect(highPeak / lowPeak).toBeCloseTo(2, 0);
		low.dispose();
		high.dispose();
		insole.dispose();
	});

	it('spanFillWidth applies height along heel-to-toe and tapers to zero at the ends', () => {
		const insole = new THREE.BoxGeometry(120, 8, 100, 24, 2, 24);
		insole.computeVertexNormals();
		const g = 24;
		const sourceWidthMm = 100;
		const sourceLengthMm = 48;
		const heightGridMm = new Float32Array(g * g);
		const occupied = new Uint8Array(g * g);
		const lo = Math.floor(g * 0.2);
		const hi = Math.ceil(g * 0.8);
		for (let gy = 0; gy < g; gy++) {
			for (let gx = 0; gx < g; gx++) {
				if (gx < lo || gx >= hi || gy < lo || gy >= hi) continue;
				occupied[gy * g + gx] = 1;
				const t = gx / (g - 1);
				// Mimic solid-bar side walls: high at edges, low in the middle.
				heightGridMm[gy * g + gx] = 2 + 8 * Math.abs(t - 0.5) * 1.8;
			}
		}
		const field: ElementStlHeightField = {
			gridSize: g,
			heightGridMm,
			occupied,
			sourceWidthMm,
			sourceLengthMm,
			sourceHeightMm: 10,
			stlMinX: -sourceWidthMm / 2,
			stlMinY: -sourceLengthMm / 2,
			stlCenterX: 0,
			stlCenterY: 0,
			stlBaseZ: 0,
			cellW: sourceWidthMm / g,
			cellL: sourceLengthMm / g,
		};
		const sheet = buildSheet(insole, field, {
			heightMm: 4,
			targetWidthMm: 100,
			spanFillWidth: true,
			smoothingPasses: 0,
		});
		const pos = sheet.getAttribute('position') as THREE.BufferAttribute;
		const rise = sheet.getAttribute('rise') as THREE.BufferAttribute;
		let centerRise = 0;
		let edgeRise = 0;
		let edgeCount = 0;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const r = rise.getX(i);
			if (Math.abs(x) > 18) {
				edgeRise += r;
				edgeCount++;
			} else if (Math.abs(x) < 6) {
				centerRise = Math.max(centerRise, r);
			}
		}
		expect(centerRise).toBeGreaterThan(0.2);
		expect(edgeRise / Math.max(edgeCount, 1)).toBeLessThan(centerRise * 0.35);
		sheet.dispose();
		insole.dispose();
	});

	it('spanFillWidth stretches a narrow footprint to the full target width', () => {
		const insole = new THREE.BoxGeometry(120, 8, 100, 24, 2, 24);
		insole.computeVertexNormals();
		const field = makeFlatTopField(24, 100, 48, 10);
		const narrow = buildSheet(insole, field, {
			heightMm: 4,
			targetWidthMm: 100,
			spanFillWidth: false,
			smoothingPasses: 0,
		});
		const full = buildSheet(insole, field, {
			heightMm: 4,
			targetWidthMm: 100,
			spanFillWidth: true,
			smoothingPasses: 0,
		});
		const narrowZ = referencedRange(narrow, 'z');
		const fullZ = referencedRange(full, 'z');
		expect(fullZ.span).toBeGreaterThan(narrowZ.span);
		expect(fullZ.span).toBeGreaterThan(80);
		narrow.dispose();
		full.dispose();
		insole.dispose();
	});

	it('never mutates the insole geometry', () => {
		const insole = createRampedInsole();
		const before = Float32Array.from(
			(insole.getAttribute('position') as THREE.BufferAttribute).array,
		);
		const field = makeFlatTopField(24, 48, 48, 10);
		buildSheet(insole, field, { heightMm: 3 });
		expect(
			Float32Array.from((insole.getAttribute('position') as THREE.BufferAttribute).array),
		).toEqual(before);
		insole.dispose();
	});
});

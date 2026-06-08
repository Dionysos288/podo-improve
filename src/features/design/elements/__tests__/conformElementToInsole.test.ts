import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
	getInsoleSurfaceSampler,
	seatColumnOnSurface,
	conformElementGeometryToInsole,
} from '@/src/features/design/elements/conformElementToInsole';

/** Flat insole: top face at y = +4, footprint x in [-60,60], z in [-20,20]. */
function createFlatInsole(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(120, 8, 40, 24, 2, 12);
	geom.computeVertexNormals();
	geom.computeBoundingBox();
	return geom;
}

/** Top surface ramps from y=4 at the heel (x=-60) to y=14 at the toe (x=60). */
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

/** Insole whose thickness (and therefore up-axis) is X, not Y. Top face at x=+4. */
function createXUpInsole(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(8, 120, 40, 2, 24, 12);
	geom.computeVertexNormals();
	geom.computeBoundingBox();
	return geom;
}

/** Element box; base plane at its min-Y. Returns geom + the base-vertex indices. */
function createElementBox(centerY: number): {
	geom: THREE.BufferGeometry;
	baseY: number;
	baseIndices: number[];
} {
	const sizeY = 4;
	const geom = new THREE.BoxGeometry(24, sizeY, 24, 6, 2, 6);
	geom.translate(0, centerY, 0);
	const baseY = centerY - sizeY / 2;
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const baseIndices: number[] = [];
	for (let i = 0; i < pos.count; i++) {
		if (Math.abs(pos.getY(i) - baseY) < 1e-4) baseIndices.push(i);
	}
	return { geom, baseY, baseIndices };
}

describe('getInsoleSurfaceSampler + seatColumnOnSurface', () => {
	it('returns the top surface point and an upward normal for a flat insole', () => {
		const insole = createFlatInsole();
		const sampler = getInsoleSurfaceSampler(insole);

		const down = sampler.raycastDown(new THREE.Vector3(10, 0, 5));
		expect(down).not.toBeNull();
		expect(down!.point.y).toBeCloseTo(4, 2);
		expect(down!.normal.y).toBeGreaterThan(0.95);

		const near = sampler.closestPoint(new THREE.Vector3(10, 6, 5));
		expect(near).not.toBeNull();
		expect(near!.point.y).toBeCloseTo(4, 2);

		insole.dispose();
	});

	it('seats a column on the surface (zero gap) and offsets height along the normal', () => {
		const insole = createFlatInsole();
		const sampler = getInsoleSurfaceSampler(insole);
		const out = new THREE.Vector3();

		// Height 0 → exactly on the surface.
		seatColumnOnSurface(sampler, new THREE.Vector3(0, 6, 0), 0, { mode: 'auto' }, out);
		expect(out.y).toBeCloseTo(4, 2);

		// Height 3 → 3 above the surface along the +Y normal.
		seatColumnOnSurface(sampler, new THREE.Vector3(0, 6, 0), 3, { mode: 'auto' }, out);
		expect(out.y).toBeCloseTo(7, 2);

		insole.dispose();
	});

	it('detects a non-Y up-axis (insole thickness along X)', () => {
		const insole = createXUpInsole();
		const sampler = getInsoleSurfaceSampler(insole);
		expect(Math.abs(sampler.upAxis.x)).toBeGreaterThan(0.95);

		const out = new THREE.Vector3();
		seatColumnOnSurface(sampler, new THREE.Vector3(6, 10, 5), 0, { mode: 'auto' }, out);
		expect(out.x).toBeCloseTo(4, 2);
		insole.dispose();
	});
});

describe('conformElementGeometryToInsole', () => {
	it('snaps the element base onto a flat surface with zero gap and preserves thickness', () => {
		const insole = createFlatInsole();
		const sampler = getInsoleSurfaceSampler(insole);
		const { geom, baseY, baseIndices } = createElementBox(6); // floating 2mm above

		conformElementGeometryToInsole(geom, sampler, {
			upAxis: new THREE.Vector3(0, 1, 0),
			baseAlongUp: baseY,
			heightScale: 1,
			mode: 'auto',
		});

		const pos = geom.getAttribute('position') as THREE.BufferAttribute;
		for (const i of baseIndices) {
			expect(pos.getY(i)).toBeCloseTo(4, 1); // base now ON the surface, no gap
		}
		let minY = Infinity;
		let maxY = -Infinity;
		for (let i = 0; i < pos.count; i++) {
			minY = Math.min(minY, pos.getY(i));
			maxY = Math.max(maxY, pos.getY(i));
		}
		expect(minY).toBeCloseTo(4, 1);
		expect(maxY - minY).toBeCloseTo(4, 1); // 4mm thickness preserved

		insole.dispose();
		geom.dispose();
	});

	it('conforms the base to a curved/ramped surface (follows curvature, no gap)', () => {
		const insole = createRampedInsole();
		const sampler = getInsoleSurfaceSampler(insole);
		const { geom, baseY, baseIndices } = createElementBox(10);

		conformElementGeometryToInsole(geom, sampler, {
			upAxis: new THREE.Vector3(0, 1, 0),
			baseAlongUp: baseY,
			heightScale: 1,
			mode: 'auto',
		});

		const pos = geom.getAttribute('position') as THREE.BufferAttribute;
		const baseYs = baseIndices.map((i) => pos.getY(i));
		// Base rides the ramp: each base vertex sits at the ramp height for its x.
		for (const i of baseIndices) {
			expect(pos.getY(i)).toBeCloseTo(rampHeight(pos.getX(i)), 0);
		}
		// And the base is not flat (it followed the slope).
		expect(Math.max(...baseYs) - Math.min(...baseYs)).toBeGreaterThan(1);

		insole.dispose();
		geom.dispose();
	});

	it('never mutates the insole geometry (position, index, normal byte-identical)', () => {
		const insole = createRampedInsole();
		const posBefore = Float32Array.from(
			(insole.getAttribute('position') as THREE.BufferAttribute).array,
		);
		const normalBefore = Float32Array.from(
			(insole.getAttribute('normal') as THREE.BufferAttribute).array,
		);
		const indexBefore = insole.getIndex()
			? Array.from(insole.getIndex()!.array)
			: null;

		const sampler = getInsoleSurfaceSampler(insole);
		const { geom, baseY } = createElementBox(10);
		conformElementGeometryToInsole(geom, sampler, {
			upAxis: new THREE.Vector3(0, 1, 0),
			baseAlongUp: baseY,
			heightScale: 1,
		});

		expect(
			Float32Array.from((insole.getAttribute('position') as THREE.BufferAttribute).array),
		).toEqual(posBefore);
		expect(
			Float32Array.from((insole.getAttribute('normal') as THREE.BufferAttribute).array),
		).toEqual(normalBefore);
		expect(insole.getIndex() ? Array.from(insole.getIndex()!.array) : null).toEqual(
			indexBefore,
		);
		// We build via `new MeshBVH`, so the source never gains a `.boundsTree`.
		expect((insole as unknown as { boundsTree?: unknown }).boundsTree).toBeUndefined();

		insole.dispose();
		geom.dispose();
	});
});

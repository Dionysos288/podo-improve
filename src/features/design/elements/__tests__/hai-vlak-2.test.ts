import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildElementOverlayGeometries } from '@/src/features/design/elements/applyElements';
import {
	getElementByKey,
	getElementPreferredStlUrl,
} from '@/src/features/design/elements/catalog';
import type { PlacedElement } from '@/src/features/design/elements/types';

function getAxisRange(
	geometry: THREE.BufferGeometry,
	axis: 'x' | 'y' | 'z',
): { min: number; max: number; span: number } {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
	const read =
		axis === 'x'
			? (i: number) => pos.getX(i)
			: axis === 'y'
				? (i: number) => pos.getY(i)
				: (i: number) => pos.getZ(i);
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < pos.count; i++) {
		const value = read(i);
		if (value < min) min = value;
		if (value > max) max = value;
	}
	return { min, max, span: max - min };
}

/** Arch cup with medial wall rising toward midfoot. */
function createArchCupInsole(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(120, 16, 100, 48, 4, 24);
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getZ(i);
		const y = pos.getY(i);
		if (y < 6) continue;
		const u = (x + 60) / 120;
		if (u < 0.22 || u > 0.68) continue;
		const archT = (u - 0.22) / 0.46;
		const medialWall = 12 * (1 - archT * 0.35) * (1 - Math.abs(z - 42) / 42);
		if (z > 20) pos.setY(i, y + medialWall);
	}
	pos.needsUpdate = true;
	geom.computeVertexNormals();
	return geom;
}

function loadHaiVlakStl(): Map<string, THREE.BufferGeometry> {
	const item = getElementByKey('hai-vlak-2');
	const stlUrl = item ? getElementPreferredStlUrl(item) : undefined;
	expect(stlUrl).toBeTruthy();
	const buf = readFileSync(
		resolve(process.cwd(), 'public/base/elements/HAI Vlak 2.stl'),
	);
	const loader = new STLLoader();
	const stl = loader.parse(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	);
	return new Map([[stlUrl!, stl]]);
}

function mockHaiVlak(overrides: Partial<PlacedElement> = {}): PlacedElement {
	return {
		id: 'hai-vlak-test',
		libraryKey: 'hai-vlak-2',
		side: 'left',
		profile: 'vlak',
		heightMm: 2,
		blendMm: 5,
		trimOffsetMm: 0,
		floorMode: 'sole',
		split: false,
		positionU: 0.45,
		positionV: 0.5,
		rotationRad: 0,
		scaleU: 1,
		scaleV: 1,
		stackOrder: 0,
		...overrides,
	};
}

describe('HAI Vlak 2 arch placement', () => {
	it('snaps flush to the medial wall on a flat insole', () => {
		const insole = new THREE.BoxGeometry(120, 8, 100, 24, 2, 24);
		insole.computeVertexNormals();
		const insoleZ = getAxisRange(insole, 'z');
		const stlMap = loadHaiVlakStl();

		const overlays = buildElementOverlayGeometries(
			insole,
			[mockHaiVlak({ side: 'left' })],
			{ mmToWorld: 1, stlGeometries: stlMap },
		);

		expect(overlays).toHaveLength(1);
		const overlayZ = getAxisRange(overlays[0]!.geometry, 'z');
		expect(overlayZ.max).toBeGreaterThan(insoleZ.max - 2);

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('hugs the medial arch wall instead of sitting on the floor only', () => {
		const insole = createArchCupInsole();
		const stlMap = loadHaiVlakStl();
		const insolePos = insole.getAttribute('position') as THREE.BufferAttribute;
		let archMaxZ = -Infinity;
		for (let i = 0; i < insolePos.count; i++) {
			const u = (insolePos.getX(i) + 60) / 120;
			if (u < 0.28 || u > 0.62) continue;
			const z = insolePos.getZ(i);
			if (z > archMaxZ) archMaxZ = z;
		}

		const overlays = buildElementOverlayGeometries(
			insole,
			[mockHaiVlak({ side: 'left' })],
			{ mmToWorld: 1, stlGeometries: stlMap },
		);

		expect(overlays).toHaveLength(1);
		const overlayZ = getAxisRange(overlays[0]!.geometry, 'z');
		expect(archMaxZ - overlayZ.max).toBeLessThan(2.5);

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('aligns rotation to the medial rim tangent', () => {
		const insole = new THREE.BoxGeometry(120, 8, 100, 24, 2, 24);
		insole.computeVertexNormals();
		const stlMap = loadHaiVlakStl();

		const aligned = buildElementOverlayGeometries(
			insole,
			[mockHaiVlak({ side: 'left' })],
			{ mmToWorld: 1, stlGeometries: stlMap },
		);
		const neutral = buildElementOverlayGeometries(
			insole,
			[
				mockHaiVlak({
					side: 'left',
					rotationRad: Math.PI / 6,
				}),
			],
			{ mmToWorld: 1, stlGeometries: stlMap },
		);

		expect(aligned).toHaveLength(1);
		expect(neutral).toHaveLength(1);
		const alignedX = getAxisRange(aligned[0]!.geometry, 'x');
		const neutralX = getAxisRange(neutral[0]!.geometry, 'x');
		expect(Math.abs(alignedX.span - neutralX.span)).toBeGreaterThan(5);

		insole.dispose();
		aligned[0]?.geometry.dispose();
		neutral[0]?.geometry.dispose();
	});
});

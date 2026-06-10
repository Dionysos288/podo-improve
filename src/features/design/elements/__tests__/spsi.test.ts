import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	applyElements,
	buildElementOverlayGeometries,
} from '@/src/features/design/elements/applyElements';
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

/** Deep heel cup: floor vertices have low heightNorm but face upward. */
function createHeelCupInsole(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(120, 24, 100, 48, 8, 24);
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getZ(i);
		const y = pos.getY(i);
		if (y < 8) continue;
		const u = (x + 60) / 120;
		if (u > 0.28) continue;
		const cupR = Math.hypot((u - 0.08) * 120, z / 48);
		if (cupR < 38) {
			const depression = 10 * (1 - cupR / 38) ** 1.4;
			pos.setY(i, y - depression);
		}
	}
	pos.needsUpdate = true;
	geom.computeVertexNormals();
	geom.computeBoundingBox();
	return geom;
}

function loadSpsiStl(): Map<string, THREE.BufferGeometry> {
	const item = getElementByKey('spsi');
	const stlUrl = item ? getElementPreferredStlUrl(item) : undefined;
	expect(stlUrl).toBeTruthy();
	const buf = readFileSync(
		resolve(process.cwd(), 'public/base/elements/SPSI.stl'),
	);
	const loader = new STLLoader();
	const stl = loader.parse(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	);
	return new Map([[stlUrl!, stl]]);
}

function mockSpsi(overrides: Partial<PlacedElement> = {}): PlacedElement {
	return {
		id: 'spsi-test',
		libraryKey: 'spsi',
		side: 'left',
		profile: 'vlak',
		heightMm: 4,
		blendMm: 5,
		trimOffsetMm: 0,
		floorMode: 'sole',
		split: false,
		positionU: 0.08,
		positionV: 0.5,
		rotationRad: 0,
		scaleU: 1,
		scaleV: 1,
		stackOrder: 0,
		...overrides,
	};
}

describe('SPSI heel placement and height', () => {
	it('STL overlay rises above the insole top on a heel cup', () => {
		const insole = createHeelCupInsole();
		const insoleY = getAxisRange(insole, 'y');
		const stlMap = loadSpsiStl();

		const overlays = buildElementOverlayGeometries(insole, [mockSpsi()], {
			mmToWorld: 1,
			stlGeometries: stlMap,
		});

		expect(overlays).toHaveLength(1);
		const overlayY = getAxisRange(overlays[0]!.geometry, 'y');
		expect(overlayY.max).toBeGreaterThan(insoleY.max + 0.5);

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('displaces the heel-cup floor even when heightNorm is below the default gate', () => {
		const insole = createHeelCupInsole();
		const before = Float32Array.from(
			(insole.getAttribute('position') as THREE.BufferAttribute).array,
		);
		const stlMap = loadSpsiStl();

		applyElements(insole, [mockSpsi()], {
			mmToWorld: 1,
			stlGeometries: stlMap,
		});

		const after = (insole.getAttribute('position') as THREE.BufferAttribute)
			.array;
		let maxDelta = 0;
		for (let i = 0; i < after.length; i++) {
			const d = Math.abs(after[i]! - before[i]!);
			if (d > maxDelta) maxDelta = d;
		}
		expect(maxDelta).toBeGreaterThan(0.5);

		insole.dispose();
	});

	it('snaps flush to the medial wall on a left foot', () => {
		const insole = new THREE.BoxGeometry(120, 8, 100, 24, 2, 24);
		insole.computeVertexNormals();
		const insoleZ = getAxisRange(insole, 'z');
		const stlMap = loadSpsiStl();

		const overlays = buildElementOverlayGeometries(
			insole,
			[mockSpsi({ side: 'left' })],
			{ mmToWorld: 1, stlGeometries: stlMap },
		);

		expect(overlays).toHaveLength(1);
		const overlayZ = getAxisRange(overlays[0]!.geometry, 'z');
		expect(overlayZ.max).toBeGreaterThan(insoleZ.max - 2);

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('extends along the heel wall instead of collapsing to the heel tip', () => {
		const insole = createHeelCupInsole();
		const stlMap = loadSpsiStl();

		const overlays = buildElementOverlayGeometries(
			insole,
			[mockSpsi({ side: 'left' })],
			{ mmToWorld: 1, stlGeometries: stlMap },
		);

		expect(overlays).toHaveLength(1);
		const overlayX = getAxisRange(overlays[0]!.geometry, 'x');
		expect(overlayX.span).toBeGreaterThan(25);

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('snaps flush to the medial wall on a heel cup', () => {
		const insole = createHeelCupInsole();
		const stlMap = loadSpsiStl();
		const insolePos = insole.getAttribute('position') as THREE.BufferAttribute;
		let heelMaxZ = -Infinity;
		for (let i = 0; i < insolePos.count; i++) {
			const u = (insolePos.getX(i) + 60) / 120;
			if (u > 0.22) continue;
			const z = insolePos.getZ(i);
			if (z > heelMaxZ) heelMaxZ = z;
		}

		const overlays = buildElementOverlayGeometries(
			insole,
			[mockSpsi({ side: 'left' })],
			{ mmToWorld: 1, stlGeometries: stlMap },
		);

		expect(overlays).toHaveLength(1);
		const overlayZ = getAxisRange(overlays[0]!.geometry, 'z');
		expect(heelMaxZ - overlayZ.max).toBeLessThan(0.5);

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});
});

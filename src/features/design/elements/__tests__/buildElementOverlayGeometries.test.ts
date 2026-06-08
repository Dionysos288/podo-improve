import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
	buildElementOverlayGeometries,
	isThicknessOnlyElement,
} from '@/src/features/design/elements/applyElements';
import {
	getElementByKey,
	getElementPreferredStlUrl,
} from '@/src/features/design/elements/catalog';
import type { PlacedElement } from '@/src/features/design/elements/types';

function createTestInsoleGeometry(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(120, 8, 40, 24, 2, 12);
	geom.computeVertexNormals();
	return geom;
}

/**
 * Insole whose top surface ramps along its length (heel low, toe high), so the
 * surface height under an element footprint varies. Used to prove the overlay
 * base follows the local surface per-vertex instead of being pinned to the
 * element-centre height (which would leave a gap on a curved insole).
 */
function createRampedInsoleGeometry(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(120, 8, 40, 48, 2, 16);
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		if (pos.getY(i) > 3.9) {
			const t = (pos.getX(i) + 60) / 120; // 0 at heel, 1 at toe
			pos.setY(i, 4 + 10 * t);
		}
	}
	pos.needsUpdate = true;
	geom.computeVertexNormals();
	geom.computeBoundingBox();
	return geom;
}

function mockElement(
	id: string,
	libraryKey: string,
	overrides: Partial<PlacedElement> = {},
): PlacedElement {
	return {
		id,
		libraryKey,
		side: 'left',
		profile: 'vlak',
		heightMm: 2,
		blendMm: 5,
		trimOffsetMm: 0,
		floorMode: 'sole',
		split: false,
		positionU: 0.28,
		positionV: 0.5,
		rotationRad: 0,
		scaleU: 1,
		scaleV: 1,
		stackOrder: 0,
		...overrides,
	};
}

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

function countSidewaysNormals(geometry: THREE.BufferGeometry): number {
	geometry.computeVertexNormals();
	const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
	let count = 0;
	for (let i = 0; i < normals.count; i++) {
		if (Math.abs(normals.getY(i)) < 0.25) count++;
	}
	return count;
}

function snapshotPositions(geometry: THREE.BufferGeometry): Float32Array {
	const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
	return new Float32Array(positions.array);
}

function createMockElementStlGeometry(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(40, 30, 4, 8, 6, 2);
	geom.computeVertexNormals();
	return geom;
}

describe('buildElementOverlayGeometries', () => {
	it('returns procedural overlays when STL map is empty', () => {
		const insole = createTestInsoleGeometry();
		const elements = [
			mockElement('el-1', 'spsa-vlak', { stackOrder: 0 }),
			mockElement('el-2', 'sc-bol', {
				stackOrder: 1,
				positionU: 0.08,
			}),
		];

		const overlays = buildElementOverlayGeometries(insole, elements, {
			mmToWorld: 1,
			stlGeometries: new Map(),
		});

		// Both sole-floor pads render as (conformed) overlays — one per element.
		expect(overlays).toHaveLength(2);
		for (const overlay of overlays) {
			expect(overlay.geometry.getAttribute('position').count).toBeGreaterThan(0);
			expect(overlay.colorHex).toMatch(/^#[0-9a-f]{6}$/i);
		}

		insole.dispose();
		for (const overlay of overlays) {
			overlay.geometry.dispose();
		}
	});

	it('still returns an overlay for non-sole floor when trim grid is sparse', () => {
		const insole = createTestInsoleGeometry();
		const element = mockElement('el-scan', 'spsa-vlak', {
			floorMode: 'scan',
			positionU: 0.28,
			positionV: 0.5,
		});

		const overlays = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: new Map(),
		});

		expect(overlays).toHaveLength(1);
		expect(overlays[0]?.elementId).toBe('el-scan');

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('procedural fallback has meaningful raised height, not a flat decal', () => {
		const insole = createTestInsoleGeometry();
		const insoleY = getAxisRange(insole, 'y');
		const element = mockElement('el-height', 'hai-vlak-2', {
			heightMm: 4,
			positionU: 0.35,
			positionV: 0.5,
			floorMode: 'free',
		});

		const overlays = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: new Map(),
		});

		expect(overlays).toHaveLength(1);
		const overlayY = getAxisRange(overlays[0]!.geometry, 'y');
		expect(overlayY.max).toBeGreaterThanOrEqual(insoleY.max);
		

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('SPSA fallback covers a wide heel-to-arch footprint on the insole', () => {
		const insole = createTestInsoleGeometry();
		const insoleX = getAxisRange(insole, 'x');
		const element = mockElement('el-spsa', 'spsa-vlak', {
			side: 'right',
			positionU: 0.28,
			positionV: 0.5,
		});

		const overlays = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: new Map(),
		});

		expect(overlays).toHaveLength(1);
		const overlayX = getAxisRange(overlays[0]!.geometry, 'x');
		expect(overlayX.span).toBeGreaterThan(insoleX.span * 0.35);

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('thickness-only blue overlay grows upward without a bottom skirt', () => {
		const insole = createTestInsoleGeometry();
		const insoleY = getAxisRange(insole, 'y');
		const low = buildElementOverlayGeometries(
			insole,
			[
				mockElement('el-low', 'sd-1', {
					heightMm: 2,
					positionU: 0.45,
					positionV: 0.5,
					floorMode: 'free',
				}),
			],
			{ mmToWorld: 1, stlGeometries: new Map() },
		);
		const high = buildElementOverlayGeometries(
			insole,
			[
				mockElement('el-high', 'sd-1', {
					heightMm: 6,
					positionU: 0.45,
					positionV: 0.5,
					floorMode: 'free',
				}),
			],
			{ mmToWorld: 1, stlGeometries: new Map() },
		);
		const volumetric = buildElementOverlayGeometries(
			insole,
			[
				mockElement('el-red', 'sd-1', {
					heightMm: 6,
					positionU: 0.45,
					positionV: 0.5,
				}),
			],
			{ mmToWorld: 1, stlGeometries: new Map() },
		);

		expect(low).toHaveLength(1);
		expect(high).toHaveLength(1);
		expect(volumetric).toHaveLength(1);
		expect(isThicknessOnlyElement({ color: 'blue' })).toBe(false);

		const lowY = getAxisRange(low[0]!.geometry, 'y');
		const highY = getAxisRange(high[0]!.geometry, 'y');
		expect(lowY.max).toBeGreaterThanOrEqual(insoleY.max);
		expect(highY.max).toBeGreaterThanOrEqual(lowY.max);
		expect(lowY.min).toBeGreaterThan(insoleY.max - 0.5);
		expect(highY.min).toBeGreaterThan(insoleY.max - 0.5);

		expect(countSidewaysNormals(volumetric[0]!.geometry)).toBeGreaterThan(0);

		insole.dispose();
		low[0]?.geometry.dispose();
		high[0]?.geometry.dispose();
		volumetric[0]?.geometry.dispose();
	});

	it('orange element falls back to a volumetric overlay when no STL is loaded', () => {
		const insole = createTestInsoleGeometry();
		const element = mockElement('el-hai', 'hai-vlak-2', {
			heightMm: 4,
			positionU: 0.35,
			positionV: 0.5,
		});

		const overlays = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: new Map(),
		});

		expect(overlays).toHaveLength(1);
		const overlayY = getAxisRange(overlays[0]!.geometry, 'y');
		const insoleY = getAxisRange(insole, 'y');
		// Rises to its therapeutic height and stays seated on the insole surface.
		expect(overlayY.max).toBeGreaterThan(insoleY.max + 2);
		expect(overlayY.min).toBeGreaterThan(insoleY.max - 0.5);

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('orange hai-vlak-2 overlay uses the loaded STL drape, not the procedural blob', () => {
		const insole = createTestInsoleGeometry();
		const element = mockElement('el-stable', 'hai-vlak-2', {
			heightMm: 3.5,
			positionU: 0.35,
			positionV: 0.5,
		});
		const item = getElementByKey('hai-vlak-2');
		const stlUrl = item ? getElementPreferredStlUrl(item) : undefined;
		expect(stlUrl).toBeTruthy();

		const proceduralOnly = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: new Map(),
		});
		const stlMap = new Map<string, THREE.BufferGeometry>();
		stlMap.set(stlUrl!, createMockElementStlGeometry());
		const withLoadedStl = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: stlMap,
		});

		expect(proceduralOnly).toHaveLength(1);
		expect(withLoadedStl).toHaveLength(1);

		// The STL drape geometry differs from the procedural fallback shape.
		const proceduralPositions = snapshotPositions(proceduralOnly[0]!.geometry);
		const loadedStlPositions = snapshotPositions(withLoadedStl[0]!.geometry);
		expect(loadedStlPositions.length).not.toBe(proceduralPositions.length);

		// The draped STL still seats on the surface and rises above it.
		const insoleY = getAxisRange(insole, 'y');
		const loadedStlY = getAxisRange(withLoadedStl[0]!.geometry, 'y');
		expect(loadedStlY.min).toBeGreaterThan(insoleY.max - 0.5);
		expect(loadedStlY.max).toBeGreaterThan(insoleY.max);

		insole.dispose();
		proceduralOnly[0]?.geometry.dispose();
		withLoadedStl[0]?.geometry.dispose();
		for (const geometry of stlMap.values()) {
			geometry.dispose();
		}
	});

	it('additive volumetric overlay base sits on the insole surface (no lift gap)', () => {
		const insole = createTestInsoleGeometry();
		const insoleY = getAxisRange(insole, 'y');
		const element = mockElement('el-contact', 'sd-1', {
			heightMm: 3,
			positionU: 0.45,
			positionV: 0.5,
		});

		const overlays = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: new Map(),
		});

		expect(overlays).toHaveLength(1);
		const overlayY = getAxisRange(overlays[0]!.geometry, 'y');
		// Base must be flush with the insole top — never floating above it.
		expect(overlayY.min).toBeLessThanOrEqual(insoleY.max + 0.03);
		expect(overlayY.min).toBeGreaterThan(insoleY.max - 0.3);
		// And it must still rise to its therapeutic height.
		expect(overlayY.max).toBeGreaterThan(insoleY.max + 1);

		insole.dispose();
		overlays[0]?.geometry.dispose();
	});

	it('STL additive overlay base follows a ramped surface, not the centre height', () => {
		const insole = createRampedInsoleGeometry();
		const element = mockElement('el-ramp', 'sd-2-5', {
			floorMode: 'free',
			heightMm: 2,
			positionU: 0.5,
			positionV: 0.5,
			scaleU: 0.4,
			scaleV: 0.4,
		});
		const item = getElementByKey('sd-2-5');
		const stlUrl = item ? getElementPreferredStlUrl(item) : undefined;
		expect(stlUrl).toBeTruthy();

		const stlMap = new Map<string, THREE.BufferGeometry>();
		stlMap.set(stlUrl!, createMockElementStlGeometry());

		const overlays = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: stlMap,
		});

		expect(overlays).toHaveLength(1);
		const overlayY = getAxisRange(overlays[0]!.geometry, 'y');
		// Centre surface height on this ramp is ~9. If the base were pinned to the
		// centre height (the old bug) the minimum would sit near 9. With per-vertex
		// surface contact the low edge of the footprint reaches well below it.
		expect(overlayY.min).toBeLessThan(8.6);
		// Top still rises above the centre surface (~9) onto its plateau.
		expect(overlayY.max).toBeGreaterThan(9.05);

		insole.dispose();
		overlays[0]?.geometry.dispose();
		for (const geometry of stlMap.values()) {
			geometry.dispose();
		}
	});

	it('RCTB STL overlay conforms to the insole width without side-wall skirts', () => {
		const insole = createTestInsoleGeometry();
		const element = mockElement('el-rctb', 'rctb-3', {
			heightMm: 4,
			positionU: 0.45,
			positionV: 0.5,
		});
		const item = getElementByKey('rctb-3');
		const stlUrl = item ? getElementPreferredStlUrl(item) : undefined;
		expect(stlUrl).toBeTruthy();

		const stlMap = new Map<string, THREE.BufferGeometry>();
		stlMap.set(stlUrl!, createMockElementStlGeometry());
		const overlays = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: stlMap,
		});

		expect(overlays).toHaveLength(1);
		const overlay = overlays[0]!;
		const insoleZ = getAxisRange(insole, 'z');
		const insoleY = getAxisRange(insole, 'y');
		const overlayY = getAxisRange(overlay.geometry, 'y');
		const pos = overlay.geometry.getAttribute('position') as THREE.BufferAttribute;
		for (let i = 0; i < pos.count; i++) {
			expect(pos.getZ(i)).toBeGreaterThanOrEqual(insoleZ.min - 0.02);
			expect(pos.getZ(i)).toBeLessThanOrEqual(insoleZ.max + 0.02);
		}
		expect(overlayY.min).toBeGreaterThan(insoleY.max - 0.1);

		insole.dispose();
		overlay.geometry.dispose();
		for (const geometry of stlMap.values()) {
			geometry.dispose();
		}
	});

	it('sole-floor sc-bol renders one conformed, colour-faded overlay (insole untouched)', () => {
		const insole = createTestInsoleGeometry();
		const insolePosBefore = Float32Array.from(
			(insole.getAttribute('position') as THREE.BufferAttribute).array,
		);
		const element = mockElement('el-sc-bol', 'sc-bol', {
			heightMm: 4,
			positionU: 0.45,
			positionV: 0.5,
			floorMode: 'sole',
		});
		const item = getElementByKey('sc-bol');
		const stlUrl = item ? getElementPreferredStlUrl(item) : undefined;
		expect(stlUrl).toBeTruthy();

		const stlMap = new Map<string, THREE.BufferGeometry>();
		stlMap.set(stlUrl!, createMockElementStlGeometry());
		const overlays = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: stlMap,
		});

		// Conform keeps the element as its own (colour-faded) overlay mesh...
		expect(overlays).toHaveLength(1);
		expect(overlays[0]!.vertexColors).toBe(true);
		expect(overlays[0]!.geometry.getAttribute('position').count).toBeGreaterThan(0);
		// ...and never mutates the insole geometry while doing so.
		expect(
			Float32Array.from((insole.getAttribute('position') as THREE.BufferAttribute).array),
		).toEqual(insolePosBefore);

		insole.dispose();
		overlays[0]?.geometry.dispose();
		for (const geometry of stlMap.values()) {
			geometry.dispose();
		}
	});

	it('free-floor sc-bol still uses the loaded STL drape overlay', () => {
		const insole = createTestInsoleGeometry();
		const element = mockElement('el-sc-bol-free', 'sc-bol', {
			heightMm: 4,
			positionU: 0.45,
			positionV: 0.5,
			floorMode: 'free',
		});
		const item = getElementByKey('sc-bol');
		const stlUrl = item ? getElementPreferredStlUrl(item) : undefined;
		expect(stlUrl).toBeTruthy();

		const proceduralOnly = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: new Map(),
		});
		const stlMap = new Map<string, THREE.BufferGeometry>();
		stlMap.set(stlUrl!, createMockElementStlGeometry());
		const withLoadedStl = buildElementOverlayGeometries(insole, [element], {
			mmToWorld: 1,
			stlGeometries: stlMap,
		});

		expect(proceduralOnly).toHaveLength(1);
		expect(withLoadedStl).toHaveLength(1);

		const proceduralPositions = snapshotPositions(proceduralOnly[0]!.geometry);
		const loadedStlPositions = snapshotPositions(withLoadedStl[0]!.geometry);
		expect(loadedStlPositions.length).not.toBe(proceduralPositions.length);

		insole.dispose();
		proceduralOnly[0]?.geometry.dispose();
		withLoadedStl[0]?.geometry.dispose();
		for (const geometry of stlMap.values()) {
			geometry.dispose();
		}
	});
});

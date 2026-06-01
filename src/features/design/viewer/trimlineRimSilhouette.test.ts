import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { TrimlineHandleProfile } from '@/src/shared/components/design/TrimlineEditOverlay';
import { createHeelToToeMapper } from '@/src/features/design/utils/geometryAxes';
import { applyTrimlineRimSilhouette } from './trimlineRimSilhouette';

const LENGTH_STEPS = 5;

function buildSideWallGeometry(opts?: {
	maxHeight?: number;
	heightSteps?: number;
	widths?: number[];
}): THREE.BufferGeometry {
	const heightSteps = opts?.heightSteps ?? 3;
	const maxHeight = opts?.maxHeight ?? 10;
	const widths = opts?.widths ?? [20, -20];
	const positions: number[] = [];
	const indices: number[] = [];

	const addSide = (width: number) => {
		const start = positions.length / 3;
		for (let ix = 0; ix < LENGTH_STEPS; ix++) {
			const x = (ix / (LENGTH_STEPS - 1)) * 100;
			for (let iz = 0; iz < heightSteps; iz++) {
				const z = (iz / (heightSteps - 1)) * maxHeight;
				positions.push(x, width, z);
			}
		}

		for (let ix = 0; ix < LENGTH_STEPS - 1; ix++) {
			for (let iz = 0; iz < heightSteps - 1; iz++) {
				const a = start + ix * heightSteps + iz;
				const b = start + (ix + 1) * heightSteps + iz;
				const c = start + (ix + 1) * heightSteps + iz + 1;
				const d = start + ix * heightSteps + iz + 1;
				indices.push(a, b, c, a, c, d);
			}
		}
	};

	widths.forEach(addSide);

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	return geometry;
}

function profileWithHeightOffsets(
	rightHeightOffsetsMm: number[],
	leftHeightOffsetsMm?: number[],
): TrimlineHandleProfile {
	const bins = rightHeightOffsetsMm.length;
	return {
		bins,
		tValues: rightHeightOffsetsMm.map((_, i) => i / Math.max(1, bins - 1)),
		rightOffsetsMm: new Array(bins).fill(0),
		leftOffsetsMm: new Array(bins).fill(0),
		rightHeightOffsetsMm,
		leftHeightOffsetsMm: leftHeightOffsetsMm ?? new Array(bins).fill(0),
		version: 2,
	};
}

// Captures a profile whose right-side bins sit at non-linear length stations (as the
// arc-length contour resampling produces), so projection vs linear placement diverge.
function profileWithContour(
	rightLengths: number[],
	rightHeightOffsetsMm: number[],
): TrimlineHandleProfile {
	const bins = rightLengths.length;
	const leftLengths = rightLengths.map((_, i) => (i / Math.max(1, bins - 1)) * 100);
	const points3D = [
		...rightLengths.map((length) => ({ x: length, y: 20, z: 10 })),
		...leftLengths.map((length) => ({ x: length, y: -20, z: 10 })),
	];
	return {
		bins,
		tValues: rightLengths.map((_, i) => i / Math.max(1, bins - 1)),
		rightOffsetsMm: new Array(bins).fill(0),
		leftOffsetsMm: new Array(bins).fill(0),
		rightHeightOffsetsMm,
		leftHeightOffsetsMm: new Array(bins).fill(0),
		widthAxis: 'y',
		points3D,
		version: 2,
	};
}

describe('applyTrimlineRimSilhouette', () => {
	it('lowers only the edited side of the rim', () => {
		const geometry = buildSideWallGeometry();
		applyTrimlineRimSilhouette(geometry, profileWithHeightOffsets([-4, -4, -4, -4, -4]), 1);

		const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
		const rightTop = positions.getZ(2);
		const leftTop = positions.getZ(5 * 3 + 2);

		expect(rightTop).toBeCloseTo(6, 4);
		expect(leftTop).toBeCloseTo(10, 6);
	});

	it('keeps local trimline dips instead of flattening the full wall to one height', () => {
		const geometry = buildSideWallGeometry();
		applyTrimlineRimSilhouette(geometry, profileWithHeightOffsets([-2, -8, -2, -2, -2]), 1);

		const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
		const heelTop = positions.getZ(2);
		const dippedTop = positions.getZ(1 * 3 + 2);
		const toeTop = positions.getZ(4 * 3 + 2);

		expect(dippedTop).toBeLessThan(heelTop - 1);
		expect(toeTop).toBeGreaterThan(dippedTop + 1);
	});

	it('leaves the footbed interior untouched', () => {
		const geometry = buildSideWallGeometry({ widths: [20, 0, -20] });
		applyTrimlineRimSilhouette(geometry, profileWithHeightOffsets([-4, -4, -4, -4, -4]), 1);

		const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
		const rightTop = positions.getZ(2);
		// Interior strip (width 0) starts after the first side: 5 length steps x 3 height steps.
		const interiorTop = positions.getZ(15 + 2);

		expect(rightTop).toBeCloseTo(6, 4);
		expect(interiorTop).toBeCloseTo(10, 6);
	});

	it('keeps the lower wall below the rim band continuous', () => {
		const geometry = buildSideWallGeometry({ maxHeight: 30, heightSteps: 4 });
		applyTrimlineRimSilhouette(geometry, profileWithHeightOffsets([-6, -6, -6, -6, -6]), 1);

		const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
		const rimTop = positions.getZ(3);
		const wallBottom = positions.getZ(0);

		expect(rimTop).toBeLessThan(30);
		expect(wallBottom).toBeCloseTo(0, 6);
	});

	it('edits the left and right rims independently', () => {
		const geometry = buildSideWallGeometry();
		applyTrimlineRimSilhouette(
			geometry,
			profileWithHeightOffsets([-4, -4, -4, -4, -4], [3, 3, 3, 3, 3]),
			1,
		);

		const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
		const rightTop = positions.getZ(2);
		const leftTop = positions.getZ(5 * 3 + 2);

		expect(rightTop).toBeCloseTo(6, 4);
		expect(leftTop).toBeCloseTo(13, 4);
	});

	it('places the dip at the points3D station, not the linear-length position', () => {
		const geometry = buildSideWallGeometry();
		// Bin 1 (the dip) sits at length 50 on the contour, far from its linear station (25).
		const rightLengths = [0, 50, 75, 90, 100];
		applyTrimlineRimSilhouette(
			geometry,
			profileWithContour(rightLengths, [0, -8, 0, 0, 0]),
			1,
		);

		const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
		// Top vertices (iz=2) at lengths 25, 50, 75 -> indices 5, 8, 11.
		const topAt25 = positions.getZ(5);
		const topAt50 = positions.getZ(8);
		const topAt75 = positions.getZ(11);

		// The deepest cut follows the contour to length 50, not the linear-length 25.
		expect(topAt50).toBeLessThan(topAt25);
		expect(topAt50).toBeLessThan(topAt75);
		expect(topAt50).toBeCloseTo(6.8, 1);
	});
});

describe('createHeelToToeMapper', () => {
	it('uses the same wider-end heel heuristic as trimline canonicalization', () => {
		const positions: number[] = [];
		for (let i = 0; i < 12; i++) {
			positions.push(0, -24 + i * 4, 0);
			positions.push(100, -10 + i * 2, 0);
		}

		const attr = new THREE.Float32BufferAttribute(positions, 3);
		const bbox = new THREE.Box3().setFromBufferAttribute(attr);
		const mapper = createHeelToToeMapper({
			positions: attr,
			lengthAxis: 'x',
			widthAxis: 'y',
			bbox,
			lengthSpan: 100,
		});

		expect(mapper.heelAtMin).toBe(true);
		expect(mapper.getT(0)).toBe(0);
		expect(mapper.getT(100)).toBe(1);
	});
});

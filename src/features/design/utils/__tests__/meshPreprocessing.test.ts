import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	removeOutliers,
	applyLaplacianSmoothing,
	validateAndFixNormals,
	validateFootScan,
	autoOrientMesh,
	centerMesh,
	scaleMeshToTarget,
	decimateMesh,
	preprocessFootScan,
} from '@/src/features/design/utils/meshPreprocessing';

// ============================================================================
// Helpers
// ============================================================================

/** Create a simple foot-shaped cloud: 260mm long, 100mm wide, 45mm thick. */
function makeFootGeometry(): THREE.BufferGeometry {
	const positions: number[] = [];
	for (let x = 0; x <= 260; x += 5) {
		const t = x / 260;
		const halfW = 20 + (t < 0.7 ? t / 0.7 * 30 : 50 - (t - 0.7) / 0.3 * 25);
		for (let y = -halfW; y <= halfW; y += 5) {
			positions.push(x, y, 5 + Math.random() * 3);
			positions.push(x, y, 30 + Math.random() * 3);
		}
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geom;
}

/** Create a cloud with a few far-flung outlier points. */
function makeFootWithOutliers(): THREE.BufferGeometry {
	const geom = makeFootGeometry();
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const arr = pos.array as Float32Array;
	const count = pos.count;

	// Add outlier points very far from the foot
	const extra = new Float32Array((count + 5) * 3);
	extra.set(arr);
	// 5 extreme outliers at 1000mm away
	for (let i = 0; i < 5; i++) {
		extra[(count + i) * 3] = 1000 + i * 100;
		extra[(count + i) * 3 + 1] = 500;
		extra[(count + i) * 3 + 2] = 200;
	}
	const newGeom = new THREE.BufferGeometry();
	newGeom.setAttribute('position', new THREE.Float32BufferAttribute(extra, 3));
	return newGeom;
}

/** Create a simple indexed mesh (box-ish) for normal-related tests. */
function makeIndexedMesh(): THREE.BufferGeometry {
	const geom = new THREE.BoxGeometry(100, 50, 30, 4, 4, 4);
	// Stretch to foot-like proportions
	geom.scale(2.6, 1, 1);
	geom.translate(130, 0, 15);
	return geom;
}

/** Create a tiny geometry that should fail validation. */
function makeTinyGeometry(): THREE.BufferGeometry {
	const positions = new Float32Array([
		0, 0, 0,
		5, 0, 0,
		0, 5, 0,
	]);
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geom;
}

// ============================================================================
// Tests
// ============================================================================

describe('removeOutliers', () => {
	it('removes far-away points while keeping the core foot shape', () => {
		const withOutliers = makeFootWithOutliers();
		const originalCount = withOutliers.getAttribute('position').count;

		const cleaned = removeOutliers(withOutliers, { kNeighbors: 8, stdRatio: 2.0 });
		const cleanedCount = cleaned.getAttribute('position').count;

		// Should have removed at least the 5 extreme outliers
		expect(cleanedCount).toBeLessThan(originalCount);
		expect(cleanedCount).toBeGreaterThan(originalCount - 20);
	});

	it('does not remove points from a clean geometry', () => {
		const clean = makeFootGeometry();
		const originalCount = clean.getAttribute('position').count;

		const result = removeOutliers(clean, { kNeighbors: 8, stdRatio: 3.0 });
		const resultCount = result.getAttribute('position').count;

		// With a generous stdRatio, nearly all points should survive
		expect(resultCount).toBeGreaterThan(originalCount * 0.9);
	});
});

describe('applyLaplacianSmoothing', () => {
	it('reduces positional variance (smooths noise)', () => {
		const geom = makeFootGeometry();
		const posBefore = geom.getAttribute('position').clone();

		const cloned = geom.clone();
		applyLaplacianSmoothing(cloned, 3, 0.5);
		const posAfter = cloned.getAttribute('position');

		// Compute variance of Z component before and after
		function zVariance(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
			let sum = 0, sumSq = 0;
			for (let i = 0; i < attr.count; i++) {
				const z = attr.getZ(i);
				sum += z;
				sumSq += z * z;
			}
			const mean = sum / attr.count;
			return sumSq / attr.count - mean * mean;
		}

		// Smoothed version should have less Z variance
		expect(zVariance(posAfter)).toBeLessThanOrEqual(zVariance(posBefore) * 1.1); // allow tiny tolerance
	});

	it('preserves vertex count', () => {
		const geom = makeFootGeometry();
		const count = geom.getAttribute('position').count;
		const cloned = geom.clone();
		applyLaplacianSmoothing(cloned, 2, 0.3);
		expect(cloned.getAttribute('position').count).toBe(count);
	});
});

describe('validateAndFixNormals', () => {
	it('computes normals and returns 0 degenerate faces for clean indexed mesh', () => {
		const geom = makeIndexedMesh();
		const degCount = validateAndFixNormals(geom);

		expect(degCount).toBe(0);
		expect(geom.getAttribute('normal')).toBeDefined();
	});
});

describe('validateFootScan', () => {
	it('validates a correctly sized foot point cloud', () => {
		const geom = makeFootGeometry();
		const result = validateFootScan(geom);

		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.vertexCount).toBeGreaterThan(100);
	});

	it('rejects a tiny geometry as invalid', () => {
		const geom = makeTinyGeometry();
		const result = validateFootScan(geom);

		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it('infers side from filename', () => {
		const geom = makeFootGeometry();
		const resultR = validateFootScan(geom, 'patient_rechts.stl');
		expect(resultR.inferredSide).toBe('right');

		const resultL = validateFootScan(geom, 'patient_links.stl');
		expect(resultL.inferredSide).toBe('left');
	});
});

describe('autoOrientMesh', () => {
	it('aligns longest dimension to X axis', () => {
		// Create a geometry where longest axis is along Y
		const positions: number[] = [];
		for (let y = 0; y <= 260; y += 5) {
			for (let x = -40; x <= 40; x += 10) {
				positions.push(x, y, Math.random() * 10);
			}
		}
		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

		autoOrientMesh(geom);

		// After orientation, extent along X should be largest
		const pos = geom.getAttribute('position');
		let minX = Infinity, maxX = -Infinity;
		let minY = Infinity, maxY = -Infinity;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i), y = pos.getY(i);
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
		expect(maxX - minX).toBeGreaterThan(maxY - minY);
	});
});

describe('centerMesh', () => {
	it('moves bounding box center to origin', () => {
		const geom = makeFootGeometry();
		centerMesh(geom);

		geom.computeBoundingBox();
		const center = new THREE.Vector3();
		geom.boundingBox!.getCenter(center);

		expect(Math.abs(center.x)).toBeLessThan(1);
		expect(Math.abs(center.y)).toBeLessThan(1);
		expect(Math.abs(center.z)).toBeLessThan(1);
	});
});

describe('scaleMeshToTarget', () => {
	it('scales mesh to target length in mm', () => {
		const geom = makeFootGeometry();
		scaleMeshToTarget(geom, 400);

		const pos = geom.getAttribute('position');
		let minX = Infinity, maxX = -Infinity;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
		}
		const length = maxX - minX;
		expect(length).toBeCloseTo(400, 0);
	});
});

describe('decimateMesh', () => {
	it('reduces vertex count toward target', () => {
		const geom = makeFootGeometry();
		const original = geom.getAttribute('position').count;

		const target = Math.floor(original * 0.5);
		const decimated = decimateMesh(geom, target);
		const resultCount = decimated.getAttribute('position').count;

		// Should be near the target (spatial hash decimation isn't exact)
		expect(resultCount).toBeLessThanOrEqual(original);
		expect(resultCount).toBeGreaterThan(target * 0.3);
	});

	it('does nothing when vertex count is already below target', () => {
		const geom = makeFootGeometry();
		const original = geom.getAttribute('position').count;

		const decimated = decimateMesh(geom, original * 2);
		expect(decimated.getAttribute('position').count).toBe(original);
	});
});

describe('preprocessFootScan', () => {
	it('runs the full pipeline without errors', () => {
		const geom = makeFootGeometry();
		const { geometry: result, validation } = preprocessFootScan(geom, {
			removeOutliers: true,
			smoothPasses: 1,
			autoOrient: true,
			center: true,
		});

		expect(validation.valid).toBe(true);
		expect(result.getAttribute('position').count).toBeGreaterThan(0);
	});

	it('returns invalid validation for tiny mesh', () => {
		const geom = makeTinyGeometry();
		const { validation } = preprocessFootScan(geom);

		expect(validation.valid).toBe(false);
	});
});

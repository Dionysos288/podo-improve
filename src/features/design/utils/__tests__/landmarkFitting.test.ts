import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	buildInsolePlan,
	completeLandmarksToLegacy,
	computeFootGeometryFrom3Points,
	computeFootReference,
	type LandmarkPoints,
} from '@/src/features/design/utils/landmarkFitting';

function makeFootLikeGeometry(): THREE.BufferGeometry {
	const positions: number[] = [];
	// Simple synthetic foot cloud in mm:
	// length ~260mm (x), width ~100mm (y), thickness ~45mm (z)
	for (let x = 0; x <= 260; x += 10) {
		for (let y = -50; y <= 50; y += 10) {
			const arch = Math.max(0, 22 - Math.abs(y) * 0.25);
			const heelLift = x < 60 ? 8 : 0;
			const toeRise = x > 220 ? (x - 220) * 0.25 : 0;
			const z = 5 + arch + heelLift + toeRise;
			positions.push(x, y, z);
		}
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geom;
}

describe('landmark fitting invariants', () => {
	it('computeFootGeometryFrom3Points uses toe-tip projection for realistic foot length', () => {
		const geom = makeFootLikeGeometry();
		const threePoints = {
			heel: [0, 0, 6] as [number, number, number],
			meta1: [180, -25, 8] as [number, number, number],
			meta5: [180, 25, 8] as [number, number, number],
		};

		const { footGeometry, derived } = computeFootGeometryFrom3Points(threePoints, geom);
		const heelToForefoot = new THREE.Vector3(...threePoints.meta1)
			.add(new THREE.Vector3(...threePoints.meta5))
			.multiplyScalar(0.5)
			.distanceTo(new THREE.Vector3(...threePoints.heel));

		expect(footGeometry.footLength).toBeGreaterThan(heelToForefoot);
		expect(derived.toeTip[0]).toBeGreaterThan(230);
	});

	it('completeLandmarksToLegacy keeps toeTip so downstream frame can use full length', () => {
		const complete = {
			heel: [0, 0, 0] as [number, number, number],
			meta1: [180, -20, 0] as [number, number, number],
			meta5: [180, 20, 0] as [number, number, number],
			navicular: [120, -10, 14] as [number, number, number],
			calcaneus: [15, 0, -4] as [number, number, number],
			toeTip: [255, 0, 2] as [number, number, number],
			lateralEdge: [140, 45, 2] as [number, number, number],
		};

		const legacy = completeLandmarksToLegacy(complete);
		expect(legacy.toeTip).toEqual([255, 0, 2]);
	});

	it('computeFootReference prefers toeTip length over forefoot midpoint proxy', () => {
		const points: LandmarkPoints = {
			heel: [0, 0, 0],
			meta1: [170, -25, 0],
			meta5: [170, 25, 0],
			navicular: [120, -10, 12],
			calcaneus: [10, 0, -5],
			toeTip: [250, 0, 0],
		};

		const frame = computeFootReference(points);
		expect(frame.footLength).toBeGreaterThan(220);
		expect(frame.footLength).toBeLessThan(260);
	});

	it('buildInsolePlan frame length follows toeTip-aware foot length', () => {
		const points: LandmarkPoints = {
			heel: [0, 0, 0],
			meta1: [165, -22, 0],
			meta5: [165, 22, 0],
			navicular: [115, -10, 11],
			calcaneus: [12, 0, -3],
			toeTip: [248, 1, 1],
		};

		const plan = buildInsolePlan(points);
		expect(plan.frame.footLength).toBeGreaterThan(230);
		expect(plan.frame.footLength).toBeLessThan(260);
	});
});

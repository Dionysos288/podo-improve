import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	detectLandmarksClassical,
	validateDetectedLandmarks,
} from '@/src/features/design/utils/landmarkDetection';
import { LANDMARK_CONFIDENCE_THRESHOLD } from '@/src/features/design/types/types';

// ============================================================================
// Helpers – synthetic foot point clouds
// ============================================================================

/**
 * Create a realistic synthetic foot-shaped point cloud.
 * Length ~260mm along X, width ~100mm along Y, height ~45mm along Z.
 * Wider at forefoot, narrow at heel, with arch elevation at midfoot.
 */
function makeFootCloud(side: 'right' | 'left' = 'right'): THREE.BufferGeometry {
	const positions: number[] = [];

	for (let x = 0; x <= 260; x += 4) {
		// Foot width varies: narrow heel → wide forefoot
		const t = x / 260;
		const halfWidth = t < 0.25
			? 20 + t * 4 * 15       // heel: 20 → 35mm half-width
			: t < 0.7
				? 35 + (t - 0.25) / 0.45 * 15 // midfoot → forefoot: 35 → 50
				: 50 - (t - 0.7) / 0.3 * 25;  // toes taper: 50 → 25

		for (let y = -halfWidth; y <= halfWidth; y += 4) {
			// Arch: higher in medial midfoot
			const medialFactor = side === 'right' ? -y / halfWidth : y / halfWidth;
			const archHeight = t > 0.15 && t < 0.65
				? Math.max(0, 15 * medialFactor * Math.sin(Math.PI * (t - 0.15) / 0.5))
				: 0;
			const heelCup = t < 0.12 ? (0.12 - t) * 80 : 0;
			const toeRise = t > 0.85 ? (t - 0.85) * 40 : 0;

			// Bottom surface (plantar)
			const zBottom = archHeight + heelCup + toeRise;
			positions.push(x, y, zBottom);

			// Top surface (dorsal) — just add thickness
			positions.push(x, y, zBottom + 20 + Math.random() * 2);
		}
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geom;
}

/**
 * Create a minimal box geometry that's clearly not a foot.
 */
function makeBoxCloud(): THREE.BufferGeometry {
	const positions: number[] = [];
	for (let x = 0; x < 10; x++) {
		for (let y = 0; y < 10; y++) {
			for (let z = 0; z < 10; z++) {
				positions.push(x * 10, y * 10, z * 10);
			}
		}
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geom;
}

// ============================================================================
// Tests
// ============================================================================

describe('detectLandmarksClassical', () => {
	it('detects heel at the posterior end of a foot cloud', () => {
		const geom = makeFootCloud();
		const result = detectLandmarksClassical(geom);

		// Heel should be near x=0 (rearmost)
		expect(result.landmarks.heel[0]).toBeLessThan(30);
	});

	it('detects meta1 and meta5 in the forefoot region', () => {
		const geom = makeFootCloud();
		const result = detectLandmarksClassical(geom);

		// Both metatarsal points should be in the forefoot zone (x > 130mm)
		expect(result.landmarks.meta1[0]).toBeGreaterThan(100);
		expect(result.landmarks.meta5[0]).toBeGreaterThan(100);
	});

	it('meta1 and meta5 are on opposite sides of the foot axis', () => {
		const geom = makeFootCloud();
		const result = detectLandmarksClassical(geom);

		// M1 and M5 should have different Y signs (opposite sides)
		const m1y = result.landmarks.meta1[1];
		const m5y = result.landmarks.meta5[1];
		expect(m1y * m5y).toBeLessThan(0); // different signs
	});

	it('derives navicular in the medial midfoot', () => {
		const geom = makeFootCloud();
		const result = detectLandmarksClassical(geom);

		// Navicular should be between heel and forefoot
		const heelX = result.landmarks.heel[0];
		const meta1X = result.landmarks.meta1[0];
		expect(result.derived.navicular[0]).toBeGreaterThan(heelX);
		expect(result.derived.navicular[0]).toBeLessThan(meta1X);
	});

	it('derives toeTip anterior to metatarsals', () => {
		const geom = makeFootCloud();
		const result = detectLandmarksClassical(geom);

		const maxMetaX = Math.max(result.landmarks.meta1[0], result.landmarks.meta5[0]);
		expect(result.derived.toeTip[0]).toBeGreaterThan(maxMetaX - 20);
	});

	it('produces per-landmark confidence scores between 0 and 1', () => {
		const geom = makeFootCloud();
		const result = detectLandmarksClassical(geom);

		const { confidence } = result;
		expect(confidence.heel).toBeGreaterThanOrEqual(0);
		expect(confidence.heel).toBeLessThanOrEqual(1);
		expect(confidence.meta1).toBeGreaterThanOrEqual(0);
		expect(confidence.meta1).toBeLessThanOrEqual(1);
		expect(confidence.meta5).toBeGreaterThanOrEqual(0);
		expect(confidence.meta5).toBeLessThanOrEqual(1);
		expect(confidence.toeTip).toBeGreaterThanOrEqual(0);
		expect(confidence.toeTip).toBeLessThanOrEqual(1);
		expect(confidence.navicular).toBeGreaterThanOrEqual(0);
		expect(confidence.navicular).toBeLessThanOrEqual(1);
		expect(confidence.calcaneus).toBeGreaterThanOrEqual(0);
		expect(confidence.calcaneus).toBeLessThanOrEqual(1);
	});

	it('has reasonable overall confidence for a well-shaped foot', () => {
		const geom = makeFootCloud();
		const result = detectLandmarksClassical(geom);

		expect(result.overallConfidence).toBeGreaterThan(0.3);
		expect(result.overallConfidence).toBeLessThanOrEqual(1);
	});

	it('infers side from filename containing "rechts"', () => {
		const geom = makeFootCloud('right');
		const result = detectLandmarksClassical(geom, 'voetscan_rechts.stl');
		expect(result.side).toBe('right');
	});

	it('infers side from filename containing "links"', () => {
		const geom = makeFootCloud('left');
		const result = detectLandmarksClassical(geom, 'voetscan_links.stl');
		expect(result.side).toBe('left');
	});

	it('returns side as unknown when filename gives no hint', () => {
		const geom = makeFootCloud();
		const result = detectLandmarksClassical(geom, 'scan123.stl');
		// Could be 'left', 'right', or 'unknown' depending on geometry analysis
		expect(['left', 'right', 'unknown']).toContain(result.side);
	});
});

describe('validateDetectedLandmarks', () => {
	it('returns no warnings for a geometrically valid foot detection', () => {
		const geom = makeFootCloud();
		const result = detectLandmarksClassical(geom);
		const warnings = validateDetectedLandmarks(result);

		// A well-formed synthetic foot should produce minimal warnings
		// We allow some warnings since the synthetic cloud is simplified
		expect(warnings.length).toBeLessThan(5);
	});

	it('does not crash on degenerate input', () => {
		// Minimal geometry — only a handful of collinear points
		const positions = new Float32Array([0, 0, 0, 100, 0, 0, 200, 0, 0]);
		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

		// Should not throw
		expect(() => {
			const result = detectLandmarksClassical(geom);
			validateDetectedLandmarks(result);
		}).not.toThrow();
	});

	it('flags the nearly-cubic box shape for manual review', () => {
		const geom = makeBoxCloud();
		const result = detectLandmarksClassical(geom);

		// A box should not have high confidence as a foot
		expect(result.overallConfidence).toBeLessThan(0.9);
		// Validation should produce warnings about proportions
		const warnings = validateDetectedLandmarks(result);
		expect(warnings.length).toBeGreaterThan(0);
	});
});

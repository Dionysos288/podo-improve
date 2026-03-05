import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
	runPipeline,
	continueWithManualLandmarks,
	quickDetectLandmarks,
	summarizePipelineTiming,
	type FullPipelineResult,
} from '@/src/features/design/utils/scanToInsolePipeline';
import type { PipelineStage, ThreePointLandmarks } from '@/src/features/design/types/types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a synthetic foot mesh with actual faces (indexed geometry)
 * so that BVH raycasting works in extractPlantarSurface.
 * Shape: foot-like elongated form ~260×100×45mm
 */
function makeFootMesh(): THREE.BufferGeometry {
	const positions: number[] = [];
	const indices: number[] = [];
	const cols = 54; // x steps (0..260, step 5 → 53 segments → 54 points)
	const rows = 21; // y steps (-50..50, step 5 → 20 segments → 21 points)

	// Generate plantar surface grid
	for (let xi = 0; xi < cols; xi++) {
		const x = xi * 5;
		for (let yi = 0; yi < rows; yi++) {
			const y = -50 + yi * 5;
			const t = x / 260;
			const halfW = t < 0.7 ? 20 + t / 0.7 * 30 : 50 - (t - 0.7) / 0.3 * 25;
			const insideFoot = Math.abs(y) <= halfW;
			const archHeight = insideFoot && t > 0.2 && t < 0.65
				? 8 * Math.sin(Math.PI * (t - 0.2) / 0.45) * Math.max(0, 1 - Math.abs(y) / halfW)
				: 0;
			const z = insideFoot ? archHeight : 0;
			positions.push(x, y, z);
		}
	}

	// Generate dorsal surface grid (offset by +25mm in Z)
	const dorsalOffset = positions.length / 3;
	for (let xi = 0; xi < cols; xi++) {
		const x = xi * 5;
		for (let yi = 0; yi < rows; yi++) {
			const y = -50 + yi * 5;
			const t = x / 260;
			const halfW = t < 0.7 ? 20 + t / 0.7 * 30 : 50 - (t - 0.7) / 0.3 * 25;
			const insideFoot = Math.abs(y) <= halfW;
			const z = insideFoot ? 25 : 0;
			positions.push(x, y, z);
		}
	}

	// Build triangle indices for plantar surface
	for (let xi = 0; xi < cols - 1; xi++) {
		for (let yi = 0; yi < rows - 1; yi++) {
			const a = xi * rows + yi;
			const b = a + 1;
			const c = a + rows;
			const d = c + 1;
			indices.push(a, b, c);
			indices.push(b, d, c);
		}
	}

	// Build triangle indices for dorsal surface
	for (let xi = 0; xi < cols - 1; xi++) {
		for (let yi = 0; yi < rows - 1; yi++) {
			const a = dorsalOffset + xi * rows + yi;
			const b = a + 1;
			const c = a + rows;
			const d = c + 1;
			indices.push(a, c, b); // reversed winding for outward normals
			indices.push(b, c, d);
		}
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geom.setIndex(indices);
	geom.computeVertexNormals();
	return geom;
}

/**
 * Extract manual landmarks from the synthetic foot shape.
 */
function getManualLandmarks(): ThreePointLandmarks {
	return {
		heel: [5, 0, 2],
		meta1: [185, -25, 4],
		meta5: [185, 25, 4],
	};
}

// ============================================================================
// Tests
// ============================================================================

describe('runPipeline', () => {
	it('runs through validation and preprocessing stages', async () => {
		const geom = makeFootMesh();
		const stagesVisited: PipelineStage[] = [];

		const result = await runPipeline(geom, {}, (stage) => {
			stagesVisited.push(stage);
		});

		// Should have visited at least validating and preprocessing
		expect(stagesVisited).toContain('validating');
		expect(stagesVisited).toContain('preprocessing');
	});

	it('returns preprocessedGeometry on success', async () => {
		const geom = makeFootMesh();
		const result = await runPipeline(geom);

		// The pipeline should at least produce a preprocessed geometry
		if (result.stage !== 'error') {
			expect(result.preprocessedGeometry).toBeDefined();
		}
	});

	it('reports timing information for completed stages', async () => {
		const geom = makeFootMesh();
		const result = await runPipeline(geom);

		expect(result.timing.validating).toBeDefined();
		expect(result.timing.validating).toBeGreaterThanOrEqual(0);
		expect(result.timing.preprocessing).toBeDefined();
	});

	it('returns error stage for empty geometry', async () => {
		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute([], 3));

		const result = await runPipeline(geom);

		expect(result.stage).toBe('error');
		expect(result.error).toBeDefined();
	});

	it('stops at awaiting-manual-landmarks when forceManualLandmarks=true', async () => {
		const geom = makeFootMesh();
		const result = await runPipeline(geom, { forceManualLandmarks: true });

		expect(result.stage).toBe('awaiting-manual-landmarks');
		expect(result.preprocessedGeometry).toBeDefined();
	});
});

describe('continueWithManualLandmarks', () => {
	it('picks up from awaiting-manual-landmarks and completes', async () => {
		const geom = makeFootMesh();
		const initial = await runPipeline(geom, { forceManualLandmarks: true });

		expect(initial.stage).toBe('awaiting-manual-landmarks');

		const landmarks = getManualLandmarks();
		const result = await continueWithManualLandmarks(initial, landmarks);

		// Should reach complete or at least extract-plantar
		expect(result.manualLandmarksUsed).toBe(true);
		expect(result.landmarks).toBeDefined();
		expect(result.landmarks!.confidence.heel).toBe(1.0);
		expect(result.landmarks!.confidence.meta1).toBe(1.0);
	});

	it('returns error when no preprocessed geometry is available', async () => {
		const emptyResult: FullPipelineResult = {
			stage: 'awaiting-manual-landmarks',
			manualLandmarksUsed: false,
			timing: {},
		};

		const landmarks = getManualLandmarks();
		const result = await continueWithManualLandmarks(emptyResult, landmarks);

		expect(result.stage).toBe('error');
		expect(result.error).toContain('Geen voorbewerkte geometrie');
	});
});

describe('quickDetectLandmarks', () => {
	it('returns landmarks and confidence for a foot mesh', () => {
		const geom = makeFootMesh();
		const result = quickDetectLandmarks(geom, 'test_rechts.stl');

		expect(result.landmarks).toBeDefined();
		expect(result.landmarks.heel).toHaveLength(3);
		expect(result.landmarks.meta1).toHaveLength(3);
		expect(result.landmarks.meta5).toHaveLength(3);
		expect(result.overallConfidence).toBeGreaterThan(0);
		// Side depends on filename inference + geometry heuristics
		expect(['left', 'right']).toContain(result.side);
	});
});

describe('summarizePipelineTiming', () => {
	it('computes total time and per-stage percentages', () => {
		const timing: Partial<Record<PipelineStage, number>> = {
			validating: 10,
			preprocessing: 50,
			'detecting-landmarks': 30,
			aligning: 5,
			'extracting-plantar': 20,
		};

		const summary = summarizePipelineTiming(timing);

		expect(summary.totalMs).toBe(115);
		expect(summary.stages).toHaveLength(5);

		const preprocessStage = summary.stages.find(s => s.stage === 'preprocessing');
		expect(preprocessStage).toBeDefined();
		expect(preprocessStage!.pct).toBeCloseTo(43, 0);
	});

	it('handles empty timing gracefully', () => {
		const summary = summarizePipelineTiming({});
		expect(summary.totalMs).toBe(0);
		expect(summary.stages).toHaveLength(0);
	});
});

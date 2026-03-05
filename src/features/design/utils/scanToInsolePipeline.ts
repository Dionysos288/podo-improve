'use client';

import * as THREE from 'three';
import type {
	ThreePointLandmarks,
	PipelineConfig,
	PipelineResult,
	PipelineStage,
	AutoLandmarkResult,
} from '../types/types';
import { DEFAULT_PIPELINE_CONFIG } from '../types/types';
import { detectLandmarksClassical, validateDetectedLandmarks } from './landmarkDetection';
import { preprocessFootScan, validateFootScan } from './meshPreprocessing';
import { computeFootGeometryFrom3Points } from './landmarkFitting';
import { extractPlantarSurface } from './plantarExtraction';

// ============================================================================
// Scan-to-Insole Pipeline Orchestrator
// ============================================================================
//
// Chains the full automated workflow:
//   1. Validate scan
//   2. Preprocess mesh (clean, smooth, orient)
//   3. Auto-detect landmarks (or receive manual landmarks)
//   4. Compute foot geometry from landmarks
//   5. Extract plantar surface
//   6. (Caller generates insole + applies corrections using existing modules)
//
// The pipeline is designed to be called step-by-step or all-at-once,
// with support for interrupting at the landmark stage for manual override.
// ============================================================================

/**
 * Callback for pipeline progress reporting.
 */
export type PipelineProgressCallback = (
	stage: PipelineStage,
	progress: number, // 0–1 within current stage
	message: string
) => void;

/**
 * Full pipeline result including intermediate data.
 * Extends PipelineResult (which already carries footGeometry and plantarData)
 * with the preprocessed mesh needed for manual-landmark fallback.
 */
export interface FullPipelineResult extends PipelineResult {
	/** The preprocessed (clean, oriented) geometry — needed for manual landmark fallback */
	preprocessedGeometry?: THREE.BufferGeometry;
}

/**
 * Run the complete scan-to-insole pipeline.
 *
 * This function handles everything from raw scan to ready-for-insole-generation state.
 * The caller is responsible for the final insole generation step (using generatePrecisionInsole
 * or buildBasicInsole) and applying corrections (applyAllCorrections).
 *
 * If automatic landmark detection confidence is low, the function returns with
 * stage='awaiting-manual-landmarks' and the caller should provide manual landmarks
 * via `continueWithManualLandmarks()`.
 *
 * @param geometry   Raw foot scan BufferGeometry
 * @param config     Pipeline configuration (optional, uses defaults)
 * @param onProgress Optional progress callback
 * @returns Pipeline result with all intermediate data
 */
export async function runPipeline(
	geometry: THREE.BufferGeometry,
	config: Partial<PipelineConfig> = {},
	onProgress?: PipelineProgressCallback
): Promise<FullPipelineResult> {
	const cfg: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...config };
	const timing: Partial<Record<PipelineStage, number>> = {};
	const result: FullPipelineResult = {
		stage: 'idle',
		manualLandmarksUsed: false,
		timing,
	};

	try {
		// ---------------------------------------------------------------
		// Stage 1: Validate
		// ---------------------------------------------------------------
		result.stage = 'validating';
		onProgress?.('validating', 0, 'Scan valideren...');
		const t0 = performance.now();

		const validation = validateFootScan(geometry, cfg.filename);
		result.validation = validation;
		timing.validating = performance.now() - t0;

		if (!validation.valid) {
			result.stage = 'error';
			result.error = `Scan validatie mislukt: ${validation.errors.join('; ')}`;
			return result;
		}

		onProgress?.('validating', 1, 'Validatie voltooid.');

		// ---------------------------------------------------------------
		// Stage 2: Preprocess
		// ---------------------------------------------------------------
		result.stage = 'preprocessing';
		onProgress?.('preprocessing', 0, 'Mesh voorbewerken...');
		const t1 = performance.now();

		const { geometry: preprocessed } = preprocessFootScan(geometry, {
			removeOutliers: true,
			smoothPasses: cfg.preprocessingSmoothPasses,
			autoOrient: true,
			center: true,
			targetVertexCount: cfg.targetVertexCount,
			filename: cfg.filename,
		});
		result.preprocessedGeometry = preprocessed;
		timing.preprocessing = performance.now() - t1;

		onProgress?.('preprocessing', 1, 'Voorbewerking voltooid.');

		// ---------------------------------------------------------------
		// Stage 3: Detect landmarks
		// ---------------------------------------------------------------
		if (cfg.forceManualLandmarks) {
			result.stage = 'awaiting-manual-landmarks';
			onProgress?.('awaiting-manual-landmarks', 0, 'Wacht op handmatige landmark selectie...');
			return result;
		}

		result.stage = 'detecting-landmarks';
		onProgress?.('detecting-landmarks', 0, 'Landmarks detecteren...');
		const t2 = performance.now();

		const autoResult = detectLandmarksClassical(preprocessed, cfg.filename);
		const validationWarnings = validateDetectedLandmarks(autoResult);
		autoResult.warnings.push(...validationWarnings);
		result.landmarks = autoResult;
		timing['detecting-landmarks'] = performance.now() - t2;

		onProgress?.('detecting-landmarks', 1, `Detectie voltooid (${(autoResult.overallConfidence * 100).toFixed(0)}% vertrouwen).`);

		// Check confidence threshold
		if (autoResult.overallConfidence < cfg.confidenceThreshold) {
			result.stage = 'awaiting-manual-landmarks';
			onProgress?.(
				'awaiting-manual-landmarks',
				0,
				`Lage betrouwbaarheid (${(autoResult.overallConfidence * 100).toFixed(0)}%). Handmatige controle vereist.`
			);
			return result;
		}

		// ---------------------------------------------------------------
		// Stage 4: Compute foot geometry
		// ---------------------------------------------------------------
		result.stage = 'aligning';
		onProgress?.('aligning', 0, 'Voetgeometrie berekenen...');
		const t3 = performance.now();

		const { footGeometry } = computeFootGeometryFrom3Points(
			autoResult.landmarks,
			preprocessed,
			cfg.filename
		);
		result.footGeometry = footGeometry;
		timing.aligning = performance.now() - t3;

		onProgress?.('aligning', 1, 'Geometrie berekend.');

		// ---------------------------------------------------------------
		// Stage 5: Extract plantar surface
		// ---------------------------------------------------------------
		result.stage = 'extracting-plantar';
		onProgress?.('extracting-plantar', 0, 'Plantair oppervlak extraheren...');
		const t4 = performance.now();

		const plantarData = extractPlantarSurface(
			preprocessed,
			footGeometry,
			cfg.insoleConfig.resolutionScale ?? 1.0
		);
		result.plantarData = plantarData;
		timing['extracting-plantar'] = performance.now() - t4;

		onProgress?.('extracting-plantar', 1, 'Extractie voltooid.');

		// ---------------------------------------------------------------
		// Complete
		// ---------------------------------------------------------------
		result.stage = 'complete';
		onProgress?.('complete', 1, 'Pipeline voltooid. Klaar voor inlegzool generatie.');
		return result;

	} catch (err) {
		result.stage = 'error';
		result.error = err instanceof Error ? err.message : String(err);
		return result;
	}
}

/**
 * Continue the pipeline after manual landmark selection.
 * Use this when `runPipeline()` returned with stage='awaiting-manual-landmarks'.
 *
 * @param previousResult  The result from runPipeline() that stopped for manual input
 * @param manualLandmarks The 3 landmarks selected by the user
 * @param config          Pipeline config (same as used in runPipeline)
 * @param onProgress      Optional progress callback
 */
export async function continueWithManualLandmarks(
	previousResult: FullPipelineResult,
	manualLandmarks: ThreePointLandmarks,
	config: Partial<PipelineConfig> = {},
	onProgress?: PipelineProgressCallback
): Promise<FullPipelineResult> {
	const cfg: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...config };
	const result = { ...previousResult };
	result.manualLandmarksUsed = true;

	const geometry = result.preprocessedGeometry;
	if (!geometry) {
		result.stage = 'error';
		result.error = 'Geen voorbewerkte geometrie beschikbaar. Voer eerst runPipeline() uit.';
		return result;
	}

	try {
		// Build an AutoLandmarkResult from manual input
		const { footGeometry, derived } = computeFootGeometryFrom3Points(
			manualLandmarks,
			geometry,
			cfg.filename
		);

		result.landmarks = {
			landmarks: manualLandmarks,
			derived,
			confidence: {
				heel: 1.0,
				meta1: 1.0,
				meta5: 1.0,
				toeTip: 0.9,
				navicular: 0.9,
				calcaneus: 0.9,
			},
			overallConfidence: 0.95,
			needsManualReview: false,
			warnings: ['Handmatig geselecteerde landmarks.'],
			side: footGeometry.side,
		};

		// Compute foot geometry
		result.stage = 'aligning';
		onProgress?.('aligning', 0, 'Voetgeometrie berekenen...');
		result.footGeometry = footGeometry;
		onProgress?.('aligning', 1, 'Geometrie berekend.');

		// Extract plantar surface
		result.stage = 'extracting-plantar';
		onProgress?.('extracting-plantar', 0, 'Plantair oppervlak extraheren...');

		const plantarData = extractPlantarSurface(
			geometry,
			footGeometry,
			cfg.insoleConfig.resolutionScale ?? 1.0
		);
		result.plantarData = plantarData;
		onProgress?.('extracting-plantar', 1, 'Extractie voltooid.');

		result.stage = 'complete';
		onProgress?.('complete', 1, 'Pipeline voltooid met handmatige landmarks.');
		return result;

	} catch (err) {
		result.stage = 'error';
		result.error = err instanceof Error ? err.message : String(err);
		return result;
	}
}

/**
 * Quick auto-detect landmarks without the full pipeline (for UI preview).
 * Useful when the user loads a scan and wants immediate landmark visualization.
 */
export function quickDetectLandmarks(
	geometry: THREE.BufferGeometry,
	filename?: string
): AutoLandmarkResult {
	const result = detectLandmarksClassical(geometry, filename);
	const validationWarnings = validateDetectedLandmarks(result);
	result.warnings.push(...validationWarnings);
	return result;
}

/**
 * Compute a summary of pipeline timing for performance monitoring.
 */
export function summarizePipelineTiming(
	timing: Partial<Record<PipelineStage, number>>
): {
	totalMs: number;
	stages: Array<{ stage: string; ms: number; pct: number }>;
} {
	const entries = Object.entries(timing).filter(
		([, ms]) => ms !== undefined
	) as Array<[string, number]>;

	const totalMs = entries.reduce((sum, [, ms]) => sum + ms, 0);

	const stages = entries.map(([stage, ms]) => ({
		stage,
		ms: Math.round(ms),
		pct: totalMs > 0 ? Math.round((ms / totalMs) * 100) : 0,
	}));

	return { totalMs: Math.round(totalMs), stages };
}

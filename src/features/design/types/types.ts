/**
 * 3D/CAD related types
 */

export type InsoleTemplate =
	| 'classic'
	| 'dunes'
	| 'finncomfort'
	| 'man'
	| 'woman'
	| '3quarter';

export type BaseInsoleType =
	| 'man'
	| 'driekwart'
	| 'durea'
	| 'fincomfort'
	| 'vrouw';

export type InsoleMaterial = 'eva-foam' | 'tpu-flex' | 'gel' | 'carbon-weave';

export type InsoleParameters = {
	thickness: number;
	archBoost: number;
	heelCupDepth: number;
	toeSpring: number;
	edgeLip: number;
	fitOffset: number;
	template: InsoleTemplate;
	material: InsoleMaterial;
};

export type DesignElement = {
	id: string;
	type: 'patch' | 'zone' | 'modification' | 'insole';
	position: [number, number, number];
	parameters: InsoleParameters | Record<string, unknown>;
	footSide?: 'left' | 'right';
	template?: InsoleTemplate;
};

export type DesignParameters = {
	thickness?: number;
	material?: string;
	hardness?: number;
	general?: {
		sizeLabel: 'EU' | 'US' | 'UK';
		baseInsoleType?: BaseInsoleType;
		shoeSize: { left: number; right: number };
		soleThicknessMm: { left: number; right: number };
		maxInsoleHeightMm: { left: number; right: number };
	};
	zones?: Array<{
		id: string;
		name: string;
		hardness: number;
		area: number[];
	}>;
};

export type MatchTransform = {
	translation: [number, number, number];
	rotation: [number, number, number];
	scale: number;
};

export const DEFAULT_INSOLE_PARAMETERS: InsoleParameters = {
	thickness: 3.2,
	archBoost: 4,
	heelCupDepth: 2.4,
	toeSpring: 1.6,
	edgeLip: 0.9,
	fitOffset: 0.6,
	template: 'classic',
	material: 'eva-foam',
};

export function isInsoleParameters(
	value: InsoleParameters | Record<string, unknown>
): value is InsoleParameters {
	return (
		typeof value === 'object' &&
		value !== null &&
		'thickness' in value &&
		'template' in value
	);
}

export type InsoleZone = 'heel' | 'midfoot' | 'forefoot' | 'arch';

export type InsoleAttributes = {
	gridCols: number;
	gridRows: number;
	zones: InsoleZone[];
	materials: Array<{
		zone: InsoleZone;
		materialId: string;
	}>;
};

export type LandmarkSet = {
	heel: [number, number, number];
	toeTip: [number, number, number];
	arch: [number, number, number];
	meta1?: [number, number, number];
	meta5?: [number, number, number];
	navicular?: [number, number, number];
	calcaneus?: [number, number, number];
};

export type GridEdit = {
	colIndex: number;
	rowIndex: number;
	amount: number;
	timestamp: number;
};

export type ZoneAdjustment = {
	zone: InsoleZone;
	amount: number;
	timestamp: number;
};

// ============================================
// 3-Point Landmark System
// ============================================

/**
 * The three required anatomical landmarks that the user picks on the 3D scan.
 * - meta5: Metatarsal 5, top right forefoot (lateral). Also determines lateral edge.
 * - meta1: Metatarsal 1, top left forefoot (medial).
 * - heel:  Center of the heel.
 */
export type ThreePointLandmarks = {
	meta5: [number, number, number];
	meta1: [number, number, number];
	heel: [number, number, number];
};

/**
 * Auto-derived anatomical reference points computed from the 3 manual landmarks
 * plus the foot mesh geometry.
 */
export type DerivedLandmarks = {
	navicular: [number, number, number]; // medial arch peak
	calcaneus: [number, number, number]; // lowest posterior vertex
	toeTip: [number, number, number]; // most distal vertex along foot axis
	lateralEdge: [number, number, number]; // lateral midfoot edge
};

/**
 * Complete landmark set: 3 manual + auto-derived.
 */
export type CompleteLandmarkSet = ThreePointLandmarks & DerivedLandmarks;

/**
 * Computed foot geometry from landmarks + mesh analysis.
 */
export type FootGeometry = {
	/** Foot length in world units (heel to most distal point) */
	footLength: number;
	/** Forefoot width: M1→M5 projected onto lateral axis */
	forefootWidth: number;
	/** Normalized foot axis: heel → forefoot direction */
	footAxis: [number, number, number];
	/** Lateral axis: perpendicular to foot axis in ground plane */
	lateralAxis: [number, number, number];
	/** Ground plane normal (up direction from plantar surface) */
	groundNormal: [number, number, number];
	/** Origin point (heel position) */
	origin: [number, number, number];
	/** Forefoot midpoint between M1 and M5 */
	forefootMid: [number, number, number];
	/** Medial arch height at navicular relative to ground plane */
	archHeight: number;
	/** Foot side inferred from scan filename or landmark positions */
	side: 'left' | 'right' | 'unknown';
};

/**
 * Plantar surface data extracted via downward raycasting.
 */
export type PlantarData = {
	/** 2D outline of the plantar surface (concave hull), in local XZ coords */
	outline: Array<[number, number]>;
	/** Dense height grid of the plantar surface */
	heightmap: Float32Array;
	/** Grid resolution: [cols, rows] */
	gridSize: [number, number];
	/** Grid cell spacing in world units */
	cellSize: number;
	/** Bounding box of the plantar region [minU, maxU, minV, maxV] */
	bounds: [number, number, number, number];
	/** Foot axis used during extraction (for coordinate transforms) */
	footAxis: [number, number, number];
	/** Ground plane normal used during extraction */
	groundNormal: [number, number, number];
	/** Origin used during extraction */
	origin: [number, number, number];
};

/**
 * Configuration for precision insole generation.
 */
export type PrecisionInsoleConfig = {
	/** Shell thickness in world units (default ~3mm) */
	thickness: number;
	/** Gaussian smoothing sigma in mm for plantar surface noise removal */
	smoothingSigma: number;
	/** Arch boost multiplier (0 = flat, 1 = natural, >1 = enhanced) */
	archBoost: number;
	/** Heel cup depth in world units */
	heelCupDepth: number;
	/** Toe offset gap in world units (1–2mm typically) */
	toeOffsetMm: number;
	/** Whether to flatten the forefoot zone */
	flattenForefoot: boolean;
	/** Rim/edge lip height in world units */
	rimHeight: number;
	/** Resolution multiplier (1 = standard ~1mm, 2 = high) */
	resolutionScale: number;
};

export const DEFAULT_PRECISION_INSOLE_CONFIG: PrecisionInsoleConfig = {
	thickness: 3.0,
	smoothingSigma: 3.0,
	archBoost: 1.0,
	heelCupDepth: 6.0,
	toeOffsetMm: 1.5,
	flattenForefoot: false,
	rimHeight: 0,
	resolutionScale: 1,
};

/**
 * Scan validation result returned before landmark selection begins.
 */
export type ScanValidationResult = {
	valid: boolean;
	warnings: string[];
	errors: string[];
	vertexCount: number;
	boundingBoxMm: [number, number, number]; // [length, width, height]
	isManifold: boolean;
	inferredSide: 'left' | 'right' | 'unknown';
};

// ============================================
// Automatic Landmark Detection
// ============================================

/**
 * Confidence level for an individual detected landmark.
 * 0 = no confidence (detection failed), 1 = fully confident.
 */
export type LandmarkConfidence = {
	heel: number;
	meta1: number;
	meta5: number;
	toeTip: number;
	navicular: number;
	calcaneus: number;
};

/**
 * Result from automatic landmark detection.
 */
export type AutoLandmarkResult = {
	/** The 3 primary landmarks needed for the pipeline */
	landmarks: ThreePointLandmarks;
	/** Additionally derived points (navicular, calcaneus, toeTip, lateral edge) */
	derived: DerivedLandmarks;
	/** Per-landmark confidence scores (0–1) */
	confidence: LandmarkConfidence;
	/** Overall confidence (geometric mean of individual scores) */
	overallConfidence: number;
	/** Whether manual override is recommended (overallConfidence < threshold) */
	needsManualReview: boolean;
	/** Descriptive warnings/notes about detection quality */
	warnings: string[];
	/** Detected foot side */
	side: 'left' | 'right' | 'unknown';
};

/** Threshold below which the system recommends manual landmark review */
export const LANDMARK_CONFIDENCE_THRESHOLD = 0.65;

// ============================================
// Scan-to-Insole Pipeline
// ============================================

/** Pipeline processing stage */
export type PipelineStage =
	| 'idle'
	| 'validating'
	| 'preprocessing'
	| 'detecting-landmarks'
	| 'awaiting-manual-landmarks'
	| 'aligning'
	| 'extracting-plantar'
	| 'generating-insole'
	| 'applying-corrections'
	| 'smoothing'
	| 'complete'
	| 'error';

/**
 * Configuration for the automated scan-to-insole pipeline.
 */
export type PipelineConfig = {
	/** Skip automatic landmark detection and require manual picking */
	forceManualLandmarks: boolean;
	/** Confidence threshold for auto-detection (default LANDMARK_CONFIDENCE_THRESHOLD) */
	confidenceThreshold: number;
	/** Light Laplacian smoothing iterations for mesh preprocessing */
	preprocessingSmoothPasses: number;
	/** Target vertex count for decimation (0 = no decimation) */
	targetVertexCount: number;
	/** Insole generation configuration */
	insoleConfig: PrecisionInsoleConfig;
	/** Filename hint (for left/right inference) */
	filename?: string;
};

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
	forceManualLandmarks: false,
	confidenceThreshold: LANDMARK_CONFIDENCE_THRESHOLD,
	preprocessingSmoothPasses: 1,
	targetVertexCount: 0,
	insoleConfig: DEFAULT_PRECISION_INSOLE_CONFIG,
};

/**
 * Result of the full scan-to-insole pipeline.
 */
export type PipelineResult = {
	/** Current stage of the pipeline */
	stage: PipelineStage;
	/** Validated scan info */
	validation?: ScanValidationResult;
	/** Detected or manually provided landmarks */
	landmarks?: AutoLandmarkResult;
	/** Computed foot geometry */
	footGeometry?: FootGeometry;
	/** Extracted plantar data */
	plantarData?: PlantarData;
	/** Whether manual landmark intervention was required */
	manualLandmarksUsed: boolean;
	/** Processing times for each stage (ms) */
	timing: Partial<Record<PipelineStage, number>>;
	/** Any errors encountered */
	error?: string;
};
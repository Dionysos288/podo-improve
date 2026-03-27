/**
 * Milling / CNC production types for Frezen EVA workflow.
 *
 * Designed around the Mekanika CNC Pro + PlanetCNC TNG controller.
 * Slot mapping uses G54–G59.2 work coordinate systems (8 slots).
 */

// ──────────────────────────────────────────────
// Milling mode (step 4 – direct produce question)
// ──────────────────────────────────────────────

export type MillingMode =
	| 'enkelzijdig'
	| 'dubbelzijdig-32'
	| 'dubbelzijdig-34'
	| 'dubbelzijdig-36';

export const MILLING_MODE_OPTIONS: {
	value: MillingMode;
	label: string;
	stockThicknessMm: number | null;
}[] = [
	{ value: 'enkelzijdig', label: 'Enkelzijdig', stockThicknessMm: null },
	{ value: 'dubbelzijdig-32', label: 'Dubbelzijdig 32mm', stockThicknessMm: 32 },
	{ value: 'dubbelzijdig-34', label: 'Dubbelzijdig 34mm', stockThicknessMm: 34 },
	{ value: 'dubbelzijdig-36', label: 'Dubbelzijdig 37mm', stockThicknessMm: 37 },
];

export function getStockThickness(mode: MillingMode): number | null {
	return MILLING_MODE_OPTIONS.find((o) => o.value === mode)?.stockThicknessMm ?? null;
}

export function isDoubleSided(mode: MillingMode): boolean {
	return mode !== 'enkelzijdig';
}

// ──────────────────────────────────────────────
// EVA preparation settings (step 3 – EVA panel)
// ──────────────────────────────────────────────

export interface EvaPreparationSettings {
	/** "elementen vloeien" = flow/blend mode. true = blended (single body), false = split zones */
	elementsFlow: boolean;
	/** Heel edge / rim thickness in mm (wall thickness) */
	heelEdgeThicknessMm: number;
}

export const DEFAULT_EVA_SETTINGS: EvaPreparationSettings = {
	elementsFlow: false,
	heelEdgeThicknessMm: 1,
};

// ──────────────────────────────────────────────
// Fixture dimensions (shared with CncFixtureView)
// ──────────────────────────────────────────────

/** Vertical EVA block width in mm */
export const BLOCK_W = 130;
/** Vertical EVA block length in mm */
export const BLOCK_H = 280;
/** EVA block thickness (Z) in mm */
export const BLOCK_DEPTH = 30;
/** Gap between blocks in mm */
export const BLOCK_GAP = 24;
/** Horizontal EVA block width (= BLOCK_H rotated) */
export const HBLOCK_W = BLOCK_H; // 280
/** Horizontal EVA block length (= BLOCK_W rotated) */
export const HBLOCK_H = BLOCK_W; // 130

// ──────────────────────────────────────────────
// Fixture / slot system (8 workholding slots)
// ──────────────────────────────────────────────

/**
 * PlanetCNC coordinate system mapping for 8 fixture slots.
 * G54–G59 = slots 1-6, G59.1 = slot 7, G59.2 = slot 8.
 */
export const SLOT_COORDINATE_SYSTEMS: string[] = [
	'G54', // Slot 1
	'G55', // Slot 2
	'G56', // Slot 3
	'G57', // Slot 4
	'G58', // Slot 5
	'G59', // Slot 6
	'G59.1', // Slot 7
	'G59.2', // Slot 8
];

export const SLOT_COUNT = 8;

export type PartId = 'left' | 'right';

export interface SlotOffset {
	x: number;
	y: number;
	z: number;
}

export interface SlotAssignment {
	slotIndex: number;
	partId: PartId;
	/** Patient name for display on the NC file and planning board */
	label: string;
}

export interface FixtureLayout {
	slotCount: number;
	/** Physical offsets per slot in mm, relative to fixture origin */
	slotOffsets: SlotOffset[];
	assignments: SlotAssignment[];
}

/**
 * Default slot offsets for the 3+3+2 fixture layout.
 * Values are the work origin (lower-left corner) of each block
 * relative to the fixture datum (slot 1 origin).
 *
 * Layout (viewed from above, Y increasing toward back of machine):
 *   Top row:    [7] [8]         ← 2 horizontal blocks (280×130mm)
 *   Middle row: [4] [5] [6]     ← 3 vertical blocks   (130×280mm)
 *   Bottom row: [1] [2] [3]     ← 3 vertical blocks   (130×280mm)
 */
export const DEFAULT_SLOT_OFFSETS: SlotOffset[] = (() => {
	const step = BLOCK_W + BLOCK_GAP; // 154mm between vertical block origins
	const rowStep = BLOCK_H + BLOCK_GAP; // 304mm between row origins
	const hStep = HBLOCK_W + BLOCK_GAP; // 304mm between horizontal block origins

	return [
		// Bottom row: slots 1-3 (vertical blocks)
		{ x: 0, y: 0, z: 0 },
		{ x: step, y: 0, z: 0 },
		{ x: step * 2, y: 0, z: 0 },
		// Middle row: slots 4-6 (vertical blocks)
		{ x: 0, y: rowStep, z: 0 },
		{ x: step, y: rowStep, z: 0 },
		{ x: step * 2, y: rowStep, z: 0 },
		// Top row: slots 7-8 (horizontal blocks)
		// NOTE: horizontal blocks have rotated local coordinate space
		{ x: 0, y: rowStep * 2, z: 0 },
		{ x: hStep, y: rowStep * 2, z: 0 },
	];
})();

export function createDefaultFixtureLayout(): FixtureLayout {
	return {
		slotCount: SLOT_COUNT,
		slotOffsets: [...DEFAULT_SLOT_OFFSETS],
		assignments: [],
	};
}

// ──────────────────────────────────────────────
// CNC post-processor / tool settings
// ──────────────────────────────────────────────

export interface CncToolSettings {
	toolDiameterMm: number;
	toolType: 'ball-nose' | 'flat-end' | 'bull-nose';
	spindleSpeedRpm: number;
	feedRateXYMmMin: number;
	feedRateZMmMin: number;
	stepoverPercent: number;
	safeZMm: number;
	depthOfCutMm: number;
}

export const DEFAULT_CNC_TOOL_SETTINGS: CncToolSettings = {
	toolDiameterMm: 6,
	toolType: 'ball-nose',
	spindleSpeedRpm: 18000,
	feedRateXYMmMin: 2000,
	feedRateZMmMin: 600,
	stepoverPercent: 40,
	safeZMm: 5,
	depthOfCutMm: 2,
};

export interface CncPostSettings {
	units: 'mm';
	/** Work offset strategy: 'per-slot' uses G54-G59.2 per slot */
	offsetStrategy: 'per-slot';
	/** Whether to embed G10 L2 offset definitions in the file */
	embedOffsets: boolean;
	/** Program end style */
	programEnd: 'M30' | 'M2';
}

export const DEFAULT_CNC_POST_SETTINGS: CncPostSettings = {
	units: 'mm',
	offsetStrategy: 'per-slot',
	embedOffsets: true,
	programEnd: 'M30',
};

// ──────────────────────────────────────────────
// Combined CNC production state
// ──────────────────────────────────────────────

export interface CncProductionState {
	millingMode: MillingMode | null;
	evaSettings: EvaPreparationSettings;
	fixture: FixtureLayout;
	toolSettings: CncToolSettings;
	postSettings: CncPostSettings;
}

export function createDefaultCncState(): CncProductionState {
	return {
		millingMode: null,
		evaSettings: { ...DEFAULT_EVA_SETTINGS },
		fixture: createDefaultFixtureLayout(),
		toolSettings: { ...DEFAULT_CNC_TOOL_SETTINGS },
		postSettings: { ...DEFAULT_CNC_POST_SETTINGS },
	};
}

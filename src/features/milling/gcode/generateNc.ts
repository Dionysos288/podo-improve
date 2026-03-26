/**
 * NC / G-code generator for Mekanika CNC Pro + PlanetCNC TNG
 *
 * Generates RS274/NGC-compliant .nc files that:
 * - Load and visualize correctly in PlanetCNC TNG software
 * - Use metric units (G21), absolute positioning (G90)
 * - Use per-slot work coordinate systems (G54–G59.2) for 8-slot fixture
 * - Generate real insole contour toolpaths (roughing + finishing)
 * - Use ball-nose cutter compensation
 * - Follow Mekanika CNC Pro safety practices
 *
 * PlanetCNC TNG requirements:
 * - Each line = one block (N-number optional)
 * - Comments in parentheses on SAME line as G-code
 * - % program delimiter at start and end
 * - Standard RS274/NGC motion codes: G0, G1, G2, G3
 * - Coordinate words: X Y Z F S
 * - Work offsets: G54-G59, G59.1, G59.2, G59.3
 * - G10 L2 Px for setting work offsets in program
 * - G4 Pn for dwell (seconds)
 */

import {
	SLOT_COORDINATE_SYSTEMS,
	type FixtureLayout,
	type CncToolSettings,
	type CncPostSettings,
	type MillingMode,
	type SlotAssignment,
	isDoubleSided,
	getStockThickness,
} from '../types';

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export interface GenerateNcOptions {
	millingMode: MillingMode;
	fixture: FixtureLayout;
	toolSettings: CncToolSettings;
	postSettings: CncPostSettings;
	/** Export in competitor-like absolute post style for machine compatibility. */
	compatibilityMode?: boolean;
	patientName: string;
	projectId: string;
	/** Heightfield data per part (keyed by partId). If absent, generates contour-based toolpath. */
	heightfields?: Record<string, HeightfieldData>;
	/** Dynamic contour points extracted from STL files. Overrides hardcoded fallback contours. */
	contours?: {
		left?: [number, number][];
		right?: [number, number][];
	};
}

export interface HeightfieldData {
	/** Grid width (columns) */
	cols: number;
	/** Grid height (rows) */
	rows: number;
	/** Cell size in mm */
	cellSizeMm: number;
	/** Z values in mm, row-major. Z=0 is stock top surface. Negative is into the stock. */
	zValues: Float32Array | number[];
	/** Origin offset of the grid relative to the part's local (0,0) in mm */
	originOffsetMm: { x: number; y: number };
}

// ── Insole contour points ──
// Anatomically correct insole outline, ~60 points per side.
// Coordinates in mm relative to the slot origin (0,0 = block corner).
// Block is 130mm wide × 280mm long.
// Left insole occupies X≈[3,62], right X≈[68,127]. Y from 5 (toe) to 270 (heel).
//
// Left foot viewed from above:
//   Lateral edge (outside, LEFT edge) = relatively straight/convex
//   Medial edge (inside, RIGHT edge) = arch indentation in midfoot

const INSOLE_CONTOUR_LEFT: [number, number][] = [
	// ── Toe area (y 5→40) — rounded front ──
	[30, 5],
	[35, 5],
	[40, 6],
	[44, 8],
	[48, 12],
	[51, 18],
	[53, 25],
	[54, 32],
	[55, 40],
	// ── Forefoot lateral → ball of foot (y 40→90) — widest zone ──
	[56, 50],
	[57, 60],
	[58, 70],
	[58, 80],
	[57, 90],
	// ── Lateral midfoot (y 90→160) — gentle curve ──
	[56, 100],
	[55, 110],
	[54, 120],
	[53, 130],
	[52, 140],
	[51, 150],
	[50, 160],
	// ── Lateral rearfoot → heel (y 160→230) ──
	[49, 170],
	[48, 180],
	[47, 190],
	[46, 200],
	[45, 210],
	[44, 220],
	[43, 230],
	// ── Heel bottom (y 230→270) — rounded ──
	[42, 240],
	[40, 250],
	[37, 258],
	[33, 264],
	[30, 268],
	[27, 270],
	[23, 268],
	[20, 264],
	[17, 258],
	[15, 250],
	[14, 240],
	// ── Medial heel → rearfoot (y 240→160) — going back up ──
	[13, 230],
	[12, 220],
	[12, 210],
	[12, 200],
	[13, 190],
	[14, 180],
	// ── Medial ARCH zone (y 180→100) — distinctive inward curve ──
	[16, 170],
	[19, 160],
	[22, 150],
	[24, 140],
	[25, 130],
	[24, 120],
	[22, 110],
	[19, 100],
	// ── Medial forefoot (y 100→40) — widening back out ──
	[16, 90],
	[13, 80],
	[10, 70],
	[8, 60],
	[7, 50],
	[6, 40],
	// ── Medial toe (y 40→5) — closing back to start ──
	[6, 32],
	[7, 25],
	[9, 18],
	[12, 12],
	[16, 8],
	[21, 6],
	[25, 5],
];

// Right insole: mirror of left within the right half of the block (X offset by 65mm)
const INSOLE_CONTOUR_RIGHT: [number, number][] = INSOLE_CONTOUR_LEFT.map(
	([x, y]) => [130 - x, y] as [number, number]
);

/**
 * Generate a complete .nc file as a string.
 * Produces valid PlanetCNC TNG compatible G-code.
 */
export function generateNcFile(options: GenerateNcOptions): string {
	const {
		millingMode,
		fixture,
		toolSettings,
		postSettings,
		compatibilityMode,
		patientName,
		projectId,
		heightfields,
	} = options;

	const lines: string[] = [];
	const emit = (line: string) => lines.push(line);
	const compatMode = compatibilityMode === true;

	// ── Program start ──
	emit('%');
	if (compatMode) {
		emit('G90');
		emit('G21');
		emit('T1');
		emit(`S${toolSettings.spindleSpeedRpm} M03`);
		emit(`F${toolSettings.feedRateXYMmMin.toFixed(1)}`);
	} else {
		emit('(Mekanika CNC Pro - PlanetCNC TNG)');
		emit(`(Patient: ${patientName})`);
		emit(`(Project: ${projectId})`);
		emit(`(Mode: ${millingMode})`);
		emit(`(Date: ${new Date().toISOString().slice(0, 10)})`);
		emit('(Generated by PODO v1.0)');
		emit('');

		// ── Safety / initialization ──
		emit('G90 (Absolute positioning)');
		emit('G21 (Metric - millimeters)');
		emit('G17 (XY plane select)');
		emit('G94 (Feed rate in mm/min)');
		emit('G40 (Cancel cutter compensation)');
		emit('G49 (Cancel tool length offset)');
		emit('G80 (Cancel canned cycles)');
		emit('');

		// ── Tool selection ──
		emit('T1 M6 (Select tool 1)');
		emit(`(Tool: ${toolSettings.toolType} D=${toolSettings.toolDiameterMm}mm)`);
		emit(`S${toolSettings.spindleSpeedRpm} M3 (Spindle ON CW at ${toolSettings.spindleSpeedRpm} RPM)`);
		emit('G4 P5 (Dwell 5s - wait for spindle speed)');
		emit('');
	}

	// ── Embed fixture offsets ──
	if (!compatMode && postSettings.embedOffsets) {
		emit('(--- Fixture slot offsets ---)');
		for (let i = 0; i < fixture.slotCount; i++) {
			const offset = fixture.slotOffsets[i];
			if (!offset) continue;
			const pNumber = coordinateSystemToPNumber(i);
			emit(`G10 L2 P${pNumber} X${fmt(offset.x)} Y${fmt(offset.y)} Z${fmt(offset.z)}`);
		}
		emit('');
	}

	// ── Per-slot toolpaths ──
	const sortedAssignments = [...fixture.assignments].sort(
		(a, b) => a.slotIndex - b.slotIndex
	);

	if (sortedAssignments.length === 0) {
		if (!compatMode) emit('(WARNING: No slots assigned - empty program)');
		emit(`G0 Z${fmt(toolSettings.safeZMm)}${compatMode ? '' : ' (Retract to safe Z)'}`);
		if (!compatMode) emit('M5 (Spindle OFF)');
		emit(`${postSettings.programEnd}${compatMode ? '' : ' (Program end)'}`);
		emit('%');
		return lines.join('\n');
	}

	for (const assignment of sortedAssignments) {
		const slotContour = assignment.partId === 'left'
			? (options.contours?.left ?? INSOLE_CONTOUR_LEFT)
			: (options.contours?.right ?? INSOLE_CONTOUR_RIGHT);
		emitSlotProgram(
			lines,
			assignment,
			toolSettings,
			millingMode,
			heightfields?.[assignment.partId] ?? null,
			slotContour,
			'top',
			compatMode,
		);
	}

	// ── Double-sided: pause for flip ──
	if (isDoubleSided(millingMode)) {
		if (!compatMode) {
			emit('');
			emit('(========================================)');
			emit('(FLIP STOCK - dubbelzijdig frezen)');
			const thickness = getStockThickness(millingMode);
			if (thickness) emit(`(Blok dikte: ${thickness}mm)`);
			emit('(Draai alle EVA blokken om en herpositioneer)');
			emit('(Controleer Z-nulpunt na het omdraaien)');
			emit('(========================================)');
			emit('M0 (Programma pauze - draai blokken om)');
			emit('');
			emit('(--- Bottom side passes ---)');
		}
		for (const assignment of sortedAssignments) {
			const slotContour = assignment.partId === 'left'
				? (options.contours?.left ?? INSOLE_CONTOUR_LEFT)
				: (options.contours?.right ?? INSOLE_CONTOUR_RIGHT);
			emitSlotProgram(lines, assignment, toolSettings, millingMode, null, slotContour, 'bottom', compatMode);
		}
	}

	// ── Program end ──
	if (compatMode) {
		emit(`G0 Z${fmt(Math.max(toolSettings.safeZMm, 60))}`);
		emit('M30');
	} else {
		emit('');
		emit('(--- Program end ---)');
		emit(`G53 G0 Z0 (Retract Z to machine zero)`);
		emit('G53 G0 X0 Y0 (Return to machine origin)');
		emit('M5 (Spindle OFF)');
		emit(`${postSettings.programEnd} (Program end)`);
	}
	emit('%');

	return (compatMode ? lines.map(toCompatibilityPostLine) : lines).join('\n');
}

/**
 * Download a .nc file in the browser.
 */
export function downloadNcFile(content: string, filename: string): void {
	const blob = new Blob([content], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

function emitSlotProgram(
	lines: string[],
	assignment: SlotAssignment,
	tool: CncToolSettings,
	_millingMode: MillingMode,
	heightfield: HeightfieldData | null,
	contour: [number, number][],
	side: 'top' | 'bottom' = 'top',
	compatMode = false,
): void {
	const emit = (line: string) => lines.push(line);
	const coordSys = SLOT_COORDINATE_SYSTEMS[assignment.slotIndex] ?? 'G54';

	if (!compatMode) {
		emit('');
		emit(`(==== Slot ${assignment.slotIndex + 1} - ${assignment.label} [${side}] ====)`);
		emit(`${coordSys} (Select work offset for slot ${assignment.slotIndex + 1})`);
		emit(`G0 Z${fmt(tool.safeZMm)} (Safe Z)`);
		emit('G0 X0 Y0 (Rapid to slot origin)');
		emit('');
	}

	if (heightfield && heightfield.cols > 0 && heightfield.rows > 0) {
		// Full 3D toolpath: roughing pocket + 3D surface finish from heightfield
		emitInsoleContourRoughing(lines, contour, tool, heightfield, side);
		emitContourParallelFinishPass(lines, heightfield, tool, contour);
	} else {
		// Fallback: flat contour-only toolpath (roughing + flat finish)
		emitInsoleContourToolpath(lines, contour, tool, side);
	}

	if (!compatMode) {
		emit(`G0 Z${fmt(tool.safeZMm)} (Retract after slot ${assignment.slotIndex + 1})`);
	}
}

/**
 * Roughing-only passes (used when a heightfield is available for 3D finish).
 * Clears the pocket down to just above the deepest point of the heightfield,
 * leaving a finish allowance for the 3D surface pass.
 */
function emitInsoleContourRoughing(
	lines: string[],
	contour: [number, number][],
	tool: CncToolSettings,
	heightfield: HeightfieldData,
	side: 'top' | 'bottom',
): void {
	const emit = (line: string) => lines.push(line);

	// Compute bounding box from the actual contour
	let minY = Infinity, maxY = -Infinity;
	for (const [, cy] of contour) {
		if (cy < minY) minY = cy;
		if (cy > maxY) maxY = cy;
	}

	// Find the deepest Z value in the heightfield to know how deep to rough
	let minZ = 0;
	for (let i = 0; i < heightfield.zValues.length; i++) {
		const z = heightfield.zValues[i];
		if (typeof z === 'number' && z < minZ) minZ = z;
	}
	const totalDepth = Math.abs(minZ);
	if (totalDepth < 0.5) return; // Nothing to rough

	const depthPerPass = tool.depthOfCutMm;
	const finishAllowance = 0.5; // Leave 0.5mm for the 3D surface finish pass
	const stepover = (tool.toolDiameterMm * tool.stepoverPercent) / 100;
	const roughDepth = totalDepth - finishAllowance;
	if (roughDepth <= 0) return;

	const numRoughPasses = Math.ceil(roughDepth / depthPerPass);

	emit(`(--- Roughing: ${numRoughPasses} passes, DOC=${depthPerPass}mm, total=${roughDepth.toFixed(1)}mm ---)`);

	for (let pass = 1; pass <= numRoughPasses; pass++) {
		const zDepth = -Math.min(pass * depthPerPass, roughDepth);
		emit(`(Rough pass ${pass}/${numRoughPasses} at Z=${fmt(zDepth)})`);
		emit(`G0 Z${fmt(tool.safeZMm)}`);

		let zigzag = false;
		let firstLine = true;
		const margin = tool.toolDiameterMm / 2 + 1;

		for (let y = minY + margin; y < maxY - margin; y += stepover) {
			const xRange = getContourXRange(contour, y, margin);
			if (!xRange) continue;
			const [xMin, xMax] = xRange;

			if (firstLine) {
				if (!zigzag) {
					emit(`G0 X${fmt(xMin)} Y${fmt(y)}`);
					emit(`G1 Z${fmt(zDepth)} F${tool.feedRateZMmMin}`);
					emit(`G1 X${fmt(xMax)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
				} else {
					emit(`G0 X${fmt(xMax)} Y${fmt(y)}`);
					emit(`G1 Z${fmt(zDepth)} F${tool.feedRateZMmMin}`);
					emit(`G1 X${fmt(xMin)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
				}
				firstLine = false;
			} else {
				if (!zigzag) {
					emit(`G1 X${fmt(xMin)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
					emit(`G1 X${fmt(xMax)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
				} else {
					emit(`G1 X${fmt(xMax)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
					emit(`G1 X${fmt(xMin)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
				}
			}
			zigzag = !zigzag;
		}
		emit(`G0 Z${fmt(tool.safeZMm)}`);
	}
}

/**
 * Generate a full insole milling toolpath from contour points (FLAT fallback).
 * Used when no heightfield is available.
 * 1. Roughing passes — zigzag raster pocket clearing at incremental Z depths
 * 2. Finish contour pass at final depth
 * 3. Spring pass — repeat contour for surface quality
 *
 * This generates G1 cutting moves that PlanetCNC TNG displays as toolpath lines.
 */
function emitInsoleContourToolpath(
	lines: string[],
	contour: [number, number][],
	tool: CncToolSettings,
	side: 'top' | 'bottom'
): void {
	const emit = (line: string) => lines.push(line);

	// Compute bounding box from the actual contour
	let minY = Infinity, maxY = -Infinity;
	for (const [, cy] of contour) {
		if (cy < minY) minY = cy;
		if (cy > maxY) maxY = cy;
	}
	const insoleH = maxY - minY;
	const totalDepth = side === 'top' ? 15 : 10;
	const depthPerPass = tool.depthOfCutMm;
	const finishAllowance = 0.3;
	const stepover = (tool.toolDiameterMm * tool.stepoverPercent) / 100;
	const numRoughPasses = Math.ceil((totalDepth - finishAllowance) / depthPerPass);

	// ── Roughing passes ──
	emit(`(--- Roughing: ${numRoughPasses} passes, DOC=${depthPerPass}mm ---)`);

	for (let pass = 1; pass <= numRoughPasses; pass++) {
		const zDepth = -Math.min(pass * depthPerPass, totalDepth - finishAllowance);
		emit(`(Rough pass ${pass}/${numRoughPasses} at Z=${fmt(zDepth)})`);
		emit(`G0 Z${fmt(tool.safeZMm)}`);

		let zigzag = false;
		let firstLine = true;
		const margin = tool.toolDiameterMm / 2 + 1;

		for (let y = minY + margin; y < maxY - margin; y += stepover) {
			const xRange = getContourXRange(contour, y, margin);
			if (!xRange) continue;
			const [xMin, xMax] = xRange;

			if (firstLine) {
				// First line of pass: rapid to position at safe Z, then plunge
				if (!zigzag) {
					emit(`G0 X${fmt(xMin)} Y${fmt(y)}`);
					emit(`G1 Z${fmt(zDepth)} F${tool.feedRateZMmMin}`);
					emit(`G1 X${fmt(xMax)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
				} else {
					emit(`G0 X${fmt(xMax)} Y${fmt(y)}`);
					emit(`G1 Z${fmt(zDepth)} F${tool.feedRateZMmMin}`);
					emit(`G1 X${fmt(xMin)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
				}
				firstLine = false;
			} else {
				// Subsequent lines: link at cutting depth using G1 feed moves
				// (NOT G0 rapid — tool is at Z depth, rapid would gouge material)
				if (!zigzag) {
					emit(`G1 X${fmt(xMin)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
					emit(`G1 X${fmt(xMax)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
				} else {
					emit(`G1 X${fmt(xMax)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
					emit(`G1 X${fmt(xMin)} Y${fmt(y)} F${tool.feedRateXYMmMin}`);
				}
			}
			zigzag = !zigzag;
		}
		emit(`G0 Z${fmt(tool.safeZMm)}`);
	}

	// ── Finish contour pass ──
	const finishZ = -totalDepth;
	const finishFeed = Math.round(tool.feedRateXYMmMin * 0.6);

	emit('');
	emit(`(--- Finish contour pass at Z=${fmt(finishZ)} ---)`);
	emit(`G0 Z${fmt(tool.safeZMm)}`);

	const [startX, startY] = contour[0];
	emit(`G0 X${fmt(startX)} Y${fmt(startY)}`);
	emit(`G1 Z${fmt(finishZ)} F${tool.feedRateZMmMin} (Plunge to finish depth)`);

	for (let i = 1; i < contour.length; i++) {
		const [cx, cy] = contour[i];
		emit(`G1 X${fmt(cx)} Y${fmt(cy)} F${finishFeed}`);
	}
	emit(`G1 X${fmt(startX)} Y${fmt(startY)} F${finishFeed} (Close contour)`);

	// Spring pass
	emit('(Spring pass - repeat contour for surface finish)');
	for (let i = 1; i < contour.length; i++) {
		const [cx, cy] = contour[i];
		emit(`G1 X${fmt(cx)} Y${fmt(cy)} F${finishFeed}`);
	}
	emit(`G1 X${fmt(startX)} Y${fmt(startY)} F${finishFeed}`);
	emit(`G0 Z${fmt(tool.safeZMm)}`);
}

/**
 * Find the X range where a horizontal Y-line intersects the insole contour.
 */
function getContourXRange(
	contour: [number, number][],
	y: number,
	margin: number
): [number, number] | null {
	const intersections: number[] = [];

	for (let i = 0; i < contour.length; i++) {
		const [x1, y1] = contour[i];
		const [x2, y2] = contour[(i + 1) % contour.length];
		if ((y1 <= y && y2 >= y) || (y2 <= y && y1 >= y)) {
			if (Math.abs(y2 - y1) < 0.001) continue;
			const t = (y - y1) / (y2 - y1);
			intersections.push(x1 + t * (x2 - x1));
		}
	}

	if (intersections.length < 2) return null;
	const xMin = Math.min(...intersections) + margin;
	const xMax = Math.max(...intersections) - margin;
	return xMax > xMin ? [xMin, xMax] : null;
}

/**
 * Emit a raster 3D surface-following finishing pass from heightfield data.
 * Uses constant-X scanlines varying Y with Z sampled from the heightfield,
 * matching the competitor toolpath style. Zigzag between scanlines for efficiency.
 * This naturally fills everything including the arch area with no gaps or rapid plunges.
 */
function emitContourParallelFinishPass(
	lines: string[],
	hf: HeightfieldData,
	tool: CncToolSettings,
	contour?: [number, number][],
): void {
	const emit = (line: string) => lines.push(line);
	const stepoverMm = (tool.toolDiameterMm * tool.stepoverPercent) / 100;
	const finishStepover = stepoverMm * 0.5; // Finer stepover for finish pass
	const ballNoseRadius = tool.toolType === 'ball-nose' ? tool.toolDiameterMm / 2 : 0;
	const finishFeed = Math.round(tool.feedRateXYMmMin * 0.6);
	const yScanStep = 1.0; // 1mm step along Y scanlines (matches competitor)

	emit('');
	emit(`(--- 3D surface finish pass ---)`);
	emit(`(Raster finish: X-stepover=${finishStepover.toFixed(2)}mm, Y-step=${yScanStep}mm)`);

	if (!contour || contour.length < 3) {
		emit(`(WARNING: Missing contour; skipping 3D finish pass)`);
		return;
	}

	// Get bounding box from contour
	let minX = Infinity, maxX = -Infinity;
	for (const [x] of contour) {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
	}

	const toolRadius = tool.toolDiameterMm / 2;
	let zigzag = false;

	for (let x = minX + toolRadius; x <= maxX - toolRadius; x += finishStepover) {
		// Find all Y segments where this X line is inside the contour
		const segments = getContourYSegments(contour, x);
		if (segments.length === 0) continue;

		for (const [yMin, yMax] of segments) {
			const yStart = zigzag ? yMax : yMin;
			const yEnd = zigzag ? yMin : yMax;
			const yStep = zigzag ? -yScanStep : yScanStep;
			const numSteps = Math.ceil(Math.abs(yMax - yMin) / yScanStep);

			// Rapid to start of scanline
			emit(`G0 Z${fmt(tool.safeZMm)}`);
			emit(`G0 X${fmt(x)} Y${fmt(yStart)}`);
			const zStart = sampleHeightfieldAt(hf, x, yStart) + ballNoseRadius;
			emit(`G1 Z${fmt(zStart)} F${tool.feedRateZMmMin}`);

			// Scan along Y following the 3D surface
			for (let s = 1; s <= numSteps; s++) {
				let y = yStart + yStep * s;
				// Clamp to segment bounds
				if (zigzag) {
					y = Math.max(y, yMin);
				} else {
					y = Math.min(y, yMax);
				}
				const z = sampleHeightfieldAt(hf, x, y) + ballNoseRadius;
				emit(`G1 X${fmt(x)} Y${fmt(y)} Z${fmt(z)} F${finishFeed}`);
			}
		}
		zigzag = !zigzag;
	}

	// Spring pass along contour at the surface edge
	if (contour.length > 2) {
		emit('');
		emit('(--- Contour spring pass ---)');
		emit(`G0 Z${fmt(tool.safeZMm)}`);
		const [sx, sy] = contour[0];
		const szStart = sampleHeightfieldAt(hf, sx, sy) + ballNoseRadius;
		emit(`G0 X${fmt(sx)} Y${fmt(sy)}`);
		emit(`G1 Z${fmt(szStart)} F${tool.feedRateZMmMin}`);

		for (let i = 1; i < contour.length; i++) {
			const [cx, cy] = contour[i];
			const cz = sampleHeightfieldAt(hf, cx, cy) + ballNoseRadius;
			emit(`G1 X${fmt(cx)} Y${fmt(cy)} Z${fmt(cz)} F${finishFeed}`);
		}
		emit(`G1 X${fmt(sx)} Y${fmt(sy)} Z${fmt(szStart)} F${finishFeed} (Close contour)`);
		emit(`G0 Z${fmt(tool.safeZMm)}`);
	}
}

/**
 * Find all Y segments where a vertical line at the given X intersects the contour interior.
 * Returns sorted pairs [yMin, yMax] for each segment. Handles concavities correctly.
 */
function getContourYSegments(
	contour: [number, number][],
	x: number,
): [number, number][] {
	const intersections: number[] = [];

	for (let i = 0; i < contour.length; i++) {
		const [x1, y1] = contour[i];
		const [x2, y2] = contour[(i + 1) % contour.length];
		if ((x1 <= x && x2 >= x) || (x2 <= x && x1 >= x)) {
			if (Math.abs(x2 - x1) < 0.001) continue;
			const t = (x - x1) / (x2 - x1);
			intersections.push(y1 + t * (y2 - y1));
		}
	}

	if (intersections.length < 2) return [];

	// Sort intersections and pair them up as entry/exit
	intersections.sort((a, b) => a - b);
	const segments: [number, number][] = [];
	for (let i = 0; i + 1 < intersections.length; i += 2) {
		const yMin = intersections[i];
		const yMax = intersections[i + 1];
		if (yMax - yMin > 1.0) { // Skip tiny segments
			segments.push([yMin, yMax]);
		}
	}
	return segments;
}

function dedupeClosePoints(
	points: [number, number][],
	minDistance: number,
): [number, number][] {
	if (points.length === 0) return [];
	const filtered: [number, number][] = [points[0]];
	for (let i = 1; i < points.length; i++) {
		const prev = filtered[filtered.length - 1];
		const point = points[i];
		if (Math.hypot(point[0] - prev[0], point[1] - prev[1]) >= minDistance) {
			filtered.push(point);
		}
	}
	if (filtered.length > 2) {
		const first = filtered[0];
		const last = filtered[filtered.length - 1];
		if (Math.hypot(first[0] - last[0], first[1] - last[1]) < minDistance) {
			filtered.pop();
		}
	}
	return filtered;
}

function polygonArea(points: [number, number][]): number {
	if (points.length < 3) return 0;
	let area = 0;
	for (let i = 0; i < points.length; i++) {
		const [x1, y1] = points[i];
		const [x2, y2] = points[(i + 1) % points.length];
		area += x1 * y2 - x2 * y1;
	}
	return Math.abs(area) * 0.5;
}

function getHeightfieldZ(hf: HeightfieldData, row: number, col: number): number {
	const idx = row * hf.cols + col;
	const val = hf.zValues[idx];
	return typeof val === 'number' && Number.isFinite(val) ? val : 0;
}

/**
 * Sample the heightfield at an arbitrary XY position using bilinear interpolation.
 * Used for contour spring pass where points don't align to the grid.
 */
function sampleHeightfieldAt(hf: HeightfieldData, x: number, y: number): number {
	if (hf.cols === 0 || hf.rows === 0) return 0;

	const col = (x - hf.originOffsetMm.x) / hf.cellSizeMm;
	const row = (y - hf.originOffsetMm.y) / hf.cellSizeMm;

	const c0 = Math.floor(col);
	const r0 = Math.floor(row);
	const c1 = Math.min(c0 + 1, hf.cols - 1);
	const r1 = Math.min(r0 + 1, hf.rows - 1);
	const ct = col - c0;
	const rt = row - r0;

	const cc0 = Math.max(0, Math.min(c0, hf.cols - 1));
	const rr0 = Math.max(0, Math.min(r0, hf.rows - 1));

	const z00 = getHeightfieldZ(hf, rr0, cc0);
	const z10 = getHeightfieldZ(hf, rr0, c1);
	const z01 = getHeightfieldZ(hf, r1, cc0);
	const z11 = getHeightfieldZ(hf, r1, c1);

	// Bilinear interpolation
	const z0 = z00 + (z10 - z00) * ct;
	const z1 = z01 + (z11 - z01) * ct;
	return z0 + (z1 - z0) * rt;
}

function coordinateSystemToPNumber(slotIndex: number): number {
	return slotIndex + 1;
}

function toCompatibilityPostLine(line: string): string {
	return line
		.replace(/\bG0\b/g, 'G00')
		.replace(/\bG1\b/g, 'G01')
		.replace(/\bM3\b/g, 'M03');
}

function fmt(value: number): string {
	return value.toFixed(3);
}

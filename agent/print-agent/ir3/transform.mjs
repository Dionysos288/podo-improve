/**
 * IR3 V2 Belt Printer — G-code Coordinate Transform
 *
 * The IdeaFormer IR3 V2 is a conveyor-belt printer with a 45° tilted nozzle.
 * PrusaSlicer generates standard planar G-code (XYZ) assuming a vertical Z axis.
 * This module post-processes that G-code, mapping the toolpath into the IR3's
 * tilted belt coordinate system.
 *
 * Coordinate mapping (IR3 V2 Klipper default):
 *   Slicer X  → IR3 X  (belt-width axis, unchanged)
 *   Slicer Y  → mapped into IR3 Y (belt-advance) and IR3 Z (belt-normal)
 *   Slicer Z  → mapped into IR3 Y (belt-advance) and IR3 Z (belt-normal)
 *
 * The transform is a rotation around the X axis by the tilt angle θ:
 *   IR3_Y =  slicer_Y · cos(θ) + slicer_Z · sin(θ)
 *   IR3_Z = -slicer_Y · sin(θ) + slicer_Z · cos(θ) + beltNormalOffset
 *
 * Safety:
 *  - Rejects NaN / Inf coordinates
 *  - Hard caps belt travel (Y) to ir3MaxBeltLengthMm
 *  - Preserves feedrates and extrusion values exactly
 *  - Passes through non-motion lines untouched
 */

/**
 * @param {string} gcodeText   Raw G-code from PrusaSlicer
 * @param {object} opts
 * @param {number} opts.tiltAngleDeg        Nozzle tilt in degrees (default 45)
 * @param {number} opts.beltNormalOffsetMm   Z offset along belt normal (default -0.15)
 * @param {number} opts.ir3MaxBeltLengthMm   Safety cap for belt axis travel (default 1000)
 * @returns {{ gcode: string, stats: { linesTotal: number, linesTransformed: number, maxBeltTravel: number } }}
 */
export function transformForIR3(gcodeText, opts = {}) {
	const tiltDeg = opts.tiltAngleDeg ?? 45;
	const beltOffset = opts.beltNormalOffsetMm ?? -0.15;
	const maxBelt = opts.ir3MaxBeltLengthMm ?? 1000;

	const tiltRad = (tiltDeg * Math.PI) / 180;
	const cosT = Math.cos(tiltRad);
	const sinT = Math.sin(tiltRad);

	const lines = gcodeText.split('\n');
	const output = [];

	// Track current position in slicer coordinates (absolute mode)
	let curX = 0, curY = 0, curZ = 0;
	let absolute = true; // G90 = true, G91 = false
	let linesTransformed = 0;
	let maxBeltTravel = 0;

	for (const line of lines) {
		const stripped = line.trimStart();

		// Detect absolute/relative mode switches
		if (/^G90\b/i.test(stripped)) { absolute = true; output.push(line); continue; }
		if (/^G91\b/i.test(stripped)) { absolute = false; output.push(line); continue; }

		// Only transform G0 and G1 motion commands
		const motionMatch = stripped.match(/^G[01]\b/i);
		if (!motionMatch) {
			output.push(line);
			continue;
		}

		// Parse parameters from the line
		const params = parseGcodeLine(stripped);
		const cmd = motionMatch[0].toUpperCase();

		// Get target slicer coordinates
		let targetX, targetY, targetZ;
		if (absolute) {
			targetX = params.X ?? curX;
			targetY = params.Y ?? curY;
			targetZ = params.Z ?? curZ;
		} else {
			// Relative: deltas added to current position
			targetX = curX + (params.X ?? 0);
			targetY = curY + (params.Y ?? 0);
			targetZ = curZ + (params.Z ?? 0);
		}

		// Apply rotation around X axis
		const ir3X = targetX;
		const ir3Y = targetY * cosT + targetZ * sinT;
		const ir3Z = -targetY * sinT + targetZ * cosT + beltOffset;

		// Safety checks
		if (!Number.isFinite(ir3X) || !Number.isFinite(ir3Y) || !Number.isFinite(ir3Z)) {
			output.push(`; IR3_TRANSFORM_ERROR: NaN/Inf at line – original: ${line}`);
			continue;
		}
		if (Math.abs(ir3Y) > maxBelt) {
			output.push(`; IR3_TRANSFORM_ERROR: belt travel ${ir3Y.toFixed(2)}mm exceeds safety limit ${maxBelt}mm – original: ${line}`);
			continue;
		}

		// Track max belt travel
		if (Math.abs(ir3Y) > maxBeltTravel) maxBeltTravel = Math.abs(ir3Y);

		// Rebuild the line with transformed coordinates
		let rebuilt = cmd;
		// Only emit axes that were present in the original command
		if (params.X != null) rebuilt += ` X${formatNum(ir3X)}`;
		if (params.Y != null) rebuilt += ` Y${formatNum(ir3Y)}`;
		if (params.Z != null) rebuilt += ` Z${formatNum(ir3Z)}`;
		if (params.E != null) rebuilt += ` E${formatNum(params.E)}`;
		if (params.F != null) rebuilt += ` F${Math.round(params.F)}`;

		// Preserve inline comment
		const commentIdx = stripped.indexOf(';');
		if (commentIdx > 0) {
			rebuilt += ' ' + stripped.slice(commentIdx);
		}

		output.push(rebuilt);
		linesTransformed++;

		// Update current position (in slicer space for next iteration)
		curX = targetX;
		curY = targetY;
		curZ = targetZ;
	}

	return {
		gcode: output.join('\n'),
		stats: {
			linesTotal: lines.length,
			linesTransformed,
			maxBeltTravel: Math.round(maxBeltTravel * 100) / 100,
		},
	};
}

/**
 * Parse G-code motion line parameters (X, Y, Z, E, F)
 * Returns an object with only the parameters present in the line.
 */
function parseGcodeLine(line) {
	const result = {};
	// Remove any inline comment for parsing
	const code = line.includes(';') ? line.slice(0, line.indexOf(';')) : line;
	const axes = ['X', 'Y', 'Z', 'E', 'F'];
	for (const axis of axes) {
		const match = code.match(new RegExp(`${axis}(-?\\d+\\.?\\d*)`, 'i'));
		if (match) {
			result[axis] = parseFloat(match[1]);
		}
	}
	return result;
}

/**
 * Format a number for G-code output: up to 4 decimal places, no trailing zeros
 */
function formatNum(val) {
	return parseFloat(val.toFixed(4)).toString();
}

// ---------- IR3 V2 start / end G-code templates ----------

/**
 * Generate IR3 V2 start G-code (Klipper firmware).
 * @param {object} opts
 * @param {number} opts.nozzleTemp        First layer nozzle temperature
 * @param {number} opts.bedTemp           Bed (belt heater) temperature
 * @param {number} opts.beltNormalOffsetMm Belt-normal offset
 * @returns {string}
 */
export function ir3StartGcode(opts = {}) {
	const nozzleTemp = opts.nozzleTemp ?? 220;
	const bedTemp = opts.bedTemp ?? 50;
	const offset = opts.beltNormalOffsetMm ?? -0.15;

	return [
		'; === IR3 V2 Start G-code (Klipper) ===',
		'G21                ; mm units',
		'G90                ; absolute positioning',
		'M83                ; relative extrusion',
		'',
		`M104 S${Math.max(0, nozzleTemp - 30)}   ; pre-warm nozzle`,
		`M140 S${bedTemp}            ; set belt heater`,
		'',
		'G28                ; home all axes',
		'; BED_MESH_PROFILE LOAD=default   ; uncomment if Klipper mesh configured',
		'',
		`M190 S${bedTemp}            ; wait belt heater`,
		`M109 S${nozzleTemp}          ; wait nozzle`,
		'',
		`; Belt-normal offset: ${offset} mm`,
		`SET_GCODE_OFFSET Z=${offset} MOVE=1`,
		'',
		'; Prime line',
		'G92 E0',
		'G1 X5 Y5 F6000',
		'G1 X200 Y5 E15 F1200  ; prime',
		'G92 E0',
		'; === End start G-code ===',
		'',
	].join('\n');
}

/**
 * Generate IR3 V2 end G-code.
 * @returns {string}
 */
export function ir3EndGcode() {
	return [
		'',
		'; === IR3 V2 End G-code ===',
		'M104 S0            ; nozzle off',
		'M140 S0            ; bed off',
		'M107               ; fan off',
		'',
		'G92 E0',
		'G1 E-3 F1800       ; retract',
		'',
		'G1 X0 Y0 F6000     ; park',
		'M84                ; motors off',
		'; === End ===',
	].join('\n');
}

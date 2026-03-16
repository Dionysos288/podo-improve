#!/usr/bin/env node

/**
 * Podo Improve Print Agent
 *
 * This agent runs on the user's PC and:
 * 1. Fetches its configuration from the server
 * 2. Polls for slicing jobs
 * 3. Runs PrusaSlicer locally to slice STL files
 * 4. Uploads the generated Gcode back to the server
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { gzipSync } from 'zlib';

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--url') args.url = argv[++i];
		else if (a === '--token') args.token = argv[++i];
	}
	return args;
}

const { url, token } = parseArgs(process.argv);

if (!url || !token) {
	console.error(
		'Usage: node agent/print-agent/agent.mjs --url http://localhost:3000 --token YOUR_TOKEN'
	);
	process.exit(1);
}

const baseUrl = url.replace(/\/$/, '');
const DEFAULT_E2_BUNDLE_URL = 'https://raw.githubusercontent.com/Allram/Raise3D-E2/main/Raise3D%20-%20E2.ini';

async function ensureDefaultE2Bundle() {
	const profileDir = path.join(os.homedir(), '.podo-improve', 'profiles');
	const bundlePath = path.join(profileDir, 'Raise3D-E2.bundle.ini');

	if (fs.existsSync(bundlePath)) {
		return bundlePath;
	}

	fs.mkdirSync(profileDir, { recursive: true });
	const res = await fetch(DEFAULT_E2_BUNDLE_URL);
	if (!res.ok) {
		throw new Error(`Failed to download default E2 config bundle (${res.status}) from ${DEFAULT_E2_BUNDLE_URL}`);
	}
	const text = await res.text();
	if (!text || !text.trim()) {
		throw new Error('Downloaded default E2 config bundle is empty');
	}
	fs.writeFileSync(bundlePath, text, 'utf8');
	return bundlePath;
}

/**
 * Parse a PrusaSlicer config bundle into named sections.
 * Bundle format: [type:name] followed by key = value lines.
 */
function parseConfigBundle(text) {
	const sections = {};
	let currentKey = null;
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const sectionMatch = line.match(/^\[(\w+):(.+)\]$/);
		if (sectionMatch) {
			currentKey = `${sectionMatch[1]}:${sectionMatch[2].trim()}`;
			if (!sections[currentKey]) sections[currentKey] = {};
			continue;
		}
		const simpleMatch = line.match(/^\[(\w+)\]$/);
		if (simpleMatch) {
			currentKey = simpleMatch[1];
			if (!sections[currentKey]) sections[currentKey] = {};
			continue;
		}
		if (currentKey) {
			const eqIdx = line.indexOf('=');
			if (eqIdx > 0) {
				sections[currentKey][line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
			}
		}
	}
	return sections;
}

const DEFAULT_HARDNESS_PERCENT = 26;

function normalizeHardnessPercent(value, fallback = DEFAULT_HARDNESS_PERCENT) {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	return Math.max(1, Math.min(100, Math.round(num)));
}

function normalizeStep3Side(raw) {
	const overall = normalizeHardnessPercent(raw?.infillPercent);
	const elementsSplit = raw?.elementsSplit === true;
	return {
		elementsSplit,
		overall,
		front: normalizeHardnessPercent(raw?.infillFrontPercent, overall),
		middle: normalizeHardnessPercent(raw?.infillMiddlePercent, overall),
		back: normalizeHardnessPercent(raw?.infillBackPercent, overall),
	};
}

function buildHardnessPlan(settings) {
	const left = normalizeStep3Side(settings?.step3?.left);
	const right = normalizeStep3Side(settings?.step3?.right);
	const requestedPercents = [left.overall, right.overall];
	if (left.elementsSplit) requestedPercents.push(left.front, left.middle, left.back);
	if (right.elementsSplit) requestedPercents.push(right.front, right.middle, right.back);
	const basePercent = Math.max(...requestedPercents);
	return {
		left,
		right,
		basePercent,
		headerLines: [
			`; PODO_HARDNESS_BASE_FILL_DENSITY=${basePercent}%`,
			`; PODO_HARDNESS_LEFT=${left.elementsSplit ? `split(front=${left.front}%,middle=${left.middle}%,back=${left.back}%)` : `overall(${left.overall}%)`}`,
			`; PODO_HARDNESS_RIGHT=${right.elementsSplit ? `split(front=${right.front}%,middle=${right.middle}%,back=${right.back}%)` : `overall(${right.overall}%)`}`,
		],
	};
}

function formatGcodeNumber(value, decimals = 5) {
	if (!Number.isFinite(value)) return '0';
	return Number(value.toFixed(decimals)).toString();
}

function extractGcodeCoord(line, axis) {
	const match = line.match(new RegExp(`(?:^|\\s)${axis}(-?\\d*\\.?\\d+)`, 'i'));
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : null;
}

/**
 * Pick the best-matching printer, print, and filament profiles from a parsed
 * Raise3D E2 config bundle based on the user's printer settings.
 */
function selectProfiles(sections, settings) {
	const nozzle = parseFloat(settings?.nozzle) || 0.8;
	const extruder = (settings?.extruder || 'Links').toLowerCase();
	const material = (settings?.material || '').toLowerCase();

	// The bundle ships 0.4 and 0.6 profiles – pick the closest.
	const nozzleStr = nozzle <= 0.5 ? '0.4' : '0.6';

	// Head selection
	let head = 'Left head';
	if (extruder === 'rechts' || extruder === 'right') head = 'Right head';

	// --- Printer profile ---
	let printerProfile = sections[`printer:Raise3D E2 ${nozzleStr} - ${head}`];
	if (!printerProfile) {
		const fb = Object.keys(sections).find(k => k.startsWith('printer:') && k.includes(nozzleStr) && k.includes(head));
		printerProfile = fb ? sections[fb] : {};
		if (!fb) console.warn(`⚠ No printer profile found for nozzle=${nozzleStr} head=${head}`);
	}

	// --- Print profile (default 0.20 mm layer height) ---
	let printProfile = sections[`print:0.20mm @E2 ${nozzleStr}`];
	if (!printProfile) {
		const fb = Object.keys(sections).find(k => k.startsWith('print:') && k.includes(nozzleStr));
		printProfile = fb ? sections[fb] : {};
	}

	// --- Filament profile (map material name to bundle type) ---
	let filType = 'FLEX'; // default for TPU / flex
	if (material.includes('pla')) filType = 'PLA';
	else if (material.includes('abs')) filType = 'ABS';
	else if (material.includes('petg') || material.includes('pet')) filType = 'PETG';
	else if (material.includes('pva')) filType = 'PVA';
	else if (material.includes('wood')) filType = 'WOOD';

	const filSuffix = nozzleStr === '0.6' ? ` ${nozzleStr}n` : '';
	let filamentProfile = sections[`filament:${filType} @E2${filSuffix}`];
	if (!filamentProfile) filamentProfile = sections[`filament:${filType} @E2`] || {};

	console.log(`  Profile selection: printer="Raise3D E2 ${nozzleStr} - ${head}" print="0.20mm @E2 ${nozzleStr}" filament="${filType} @E2${filSuffix}"`);
	return { printerProfile, printProfile, filamentProfile };
}

// Keys that are bundle metadata and should not go into the flat config
const BUNDLE_SKIP_KEYS = new Set([
	'compatible_printers', 'compatible_printers_condition',
	'compatible_prints', 'compatible_prints_condition',
	'inherits', 'print_settings_id', 'filament_settings_id',
	'printer_settings_id', 'printer_variant', 'printer_vendor',
	'default_print_profile', 'default_filament_profile',
	'bed_custom_texture', 'bed_custom_model',
]);

// PrusaSlicer keys that are per-extruder (comma-separated for multi-extruder).
// When forcing single-extruder mode we pick only the active extruder's value.
const PER_EXTRUDER_KEYS = new Set([
	'nozzle_diameter', 'extruder_colour', 'extruder_offset',
	'retract_length', 'retract_lift', 'retract_speed', 'deretract_speed',
	'retract_before_travel', 'retract_layer_change', 'retract_before_wipe',
	'retract_length_toolchange', 'retract_restart_extra',
	'retract_restart_extra_toolchange', 'wipe',
	'filament_colour', 'filament_diameter', 'filament_density',
	'filament_type', 'filament_soluble', 'filament_cost',
	'filament_spool_weight', 'filament_max_volumetric_speed',
	'extrusion_multiplier', 'temperature', 'first_layer_temperature',
	'bed_temperature', 'first_layer_bed_temperature',
	'fan_always_on', 'cooling', 'min_fan_speed', 'max_fan_speed',
	'bridge_fan_speed', 'disable_fan_first_layers',
	'full_fan_speed_layer', 'min_print_speed',
	'max_layer_height', 'min_layer_height',
]);

/**
 * Merge selected bundle profiles into a single flat .ini that PrusaSlicer's
 * --load flag can consume.
 *
 * IMPORTANT: The Raise3D E2 is a dual-extruder (IDEX) printer.  Many settings
 * in the bundle have two comma-separated values (one per extruder).  If we
 * pass those as-is, PrusaSlicer generates wipe-tower / tool-change paths that
 * produce chaotic G-code.  We therefore force single-extruder mode by picking
 * only the active extruder's value from every multi-value key and disabling
 * all multi-material features.
 */
function generateFlatConfig(bundleSections, settings, outputDir) {
	const { printerProfile, printProfile, filamentProfile } = selectProfiles(bundleSections, settings);
	const hardnessPlan = buildHardnessPlan(settings);
	const merged = {};
	// Merge: print → filament → printer (printer wins for shared keys like nozzle_diameter)
	for (const [k, v] of Object.entries(printProfile))    { if (!BUNDLE_SKIP_KEYS.has(k)) merged[k] = v; }
	for (const [k, v] of Object.entries(filamentProfile)) { if (!BUNDLE_SKIP_KEYS.has(k)) merged[k] = v; }
	for (const [k, v] of Object.entries(printerProfile))  { if (!BUNDLE_SKIP_KEYS.has(k)) merged[k] = v; }

	// --- Force single-extruder mode ---
	const extruder = (settings?.extruder || 'Links').toLowerCase();
	const extIdx = (extruder === 'rechts' || extruder === 'right') ? 1 : 0;
	console.log(`  Forcing single-extruder mode (extruder index=${extIdx})`);

	// Strip multi-value per-extruder keys to single value
	for (const key of PER_EXTRUDER_KEYS) {
		if (merged[key] && typeof merged[key] === 'string' && merged[key].includes(',')) {
			const parts = merged[key].split(',').map(s => s.trim());
			if (parts.length > 1) {
				merged[key] = parts[extIdx] || parts[0];
			}
		}
	}

	// Also catch any remaining comma-separated keys in the printer profile
	// that look like per-extruder values (heuristic: exactly 2 comma-separated
	// numeric-ish values)
	for (const [k, v] of Object.entries(merged)) {
		if (typeof v === 'string' && v.includes(',') && !PER_EXTRUDER_KEYS.has(k)) {
			const parts = v.split(',').map(s => s.trim());
			// bed_shape uses "XxY,XxY" format with 'x' – skip those
			if (parts.length === 2 && !v.includes('x') && k !== 'bed_shape') {
				const allNumeric = parts.every(p => /^-?\d*\.?\d+$/.test(p));
				if (allNumeric) {
					merged[k] = parts[extIdx] || parts[0];
				}
			}
		}
	}

	// Override nozzle with user's actual value (single value!)
	if (settings?.nozzle) {
		merged['nozzle_diameter'] = String(settings.nozzle).replace(/\s*mm$/i, '').split(',')[0].trim();
	}

	// ── Material-aware tuning ────────────────────────────────────────────
	// The community bundle profiles are generic.  We apply material-specific
	// overrides so that speeds, flow rates, widths and retraction match what
	// the E2 direct-drive can actually handle for each material.
	{
		const filType = (merged['filament_type'] || '').toUpperCase();
		const nozzleDia = parseFloat(merged['nozzle_diameter']) || 0.6;
		const layerH = parseFloat(merged['layer_height']) || 0.2;

		// ── 1. Extrusion widths ──────────────────────────────────────────
		// The bundle's 0.6 profile hardcodes 0.65-0.68mm widths.  If the
		// actual nozzle is larger (0.8, 1.0) these are too narrow → more
		// passes → more time.  Standard rule of thumb: width ≈ 1.1 × nozzle.
		const profileNozzle = parseFloat(merged['extrusion_width']) || nozzleDia;
		if (nozzleDia > profileNozzle + 0.05) {
			const w  = Math.round(nozzleDia * 1.1  * 100) / 100;  // general
			const ew = Math.round(nozzleDia * 1.05 * 100) / 100;  // external (slightly tighter)
			const fw = Math.round(nozzleDia * 1.0  * 100) / 100;  // first layer
			console.log(`  Adjusting extrusion widths for ${nozzleDia}mm nozzle: general=${w} external=${ew} first_layer=${fw}`);
			merged['extrusion_width']                    = String(w);
			merged['perimeter_extrusion_width']          = String(w);
			merged['external_perimeter_extrusion_width'] = String(ew);
			merged['infill_extrusion_width']             = String(w);
			merged['solid_infill_extrusion_width']       = String(w);
			merged['top_infill_extrusion_width']         = String(ew);
			merged['first_layer_extrusion_width']        = String(fw);
		}

		// ── 2. Material-specific speed & flow tuning ─────────────────────
		if (filType === 'FLEX' || filType === 'TPU') {
			// --- Volumetric flow limit ---
			// Bundle ships 1.2 mm³/s for FLEX – way too low for direct-drive.
			// Safe values for TPU 95A on Raise3D E2 direct-drive:
			let maxVol;
			if (nozzleDia <= 0.4)      maxVol = 2.5;
			else if (nozzleDia <= 0.6)  maxVol = 4;
			else if (nozzleDia <= 0.8)  maxVol = 5;
			else                        maxVol = 6;

			const oldVol = parseFloat(merged['filament_max_volumetric_speed']) || 0;
			if (oldVol > 0 && oldVol < maxVol) {
				console.log(`  FLEX: volumetric flow ${oldVol} → ${maxVol} mm³/s (nozzle=${nozzleDia}mm)`);
				merged['filament_max_volumetric_speed'] = String(maxVol);
			}

			// --- Speeds ---
			// TPU likes moderate, steady speeds.  Too fast → under-extrusion
			// on corners; too slow → oozing and blobs.
			// These are linear speeds in mm/s.  The volumetric limit above
			// acts as the real safety cap.
			const speedTable = {
				'perimeter_speed':              nozzleDia >= 0.6 ? 40 : 30,
				'external_perimeter_speed':     nozzleDia >= 0.6 ? 30 : 25,
				'infill_speed':                 nozzleDia >= 0.6 ? 50 : 40,
				'solid_infill_speed':           nozzleDia >= 0.6 ? 40 : 35,
				'top_solid_infill_speed':       nozzleDia >= 0.6 ? 30 : 25,
				'small_perimeter_speed':        20,
				'gap_fill_speed':               nozzleDia >= 0.6 ? 30 : 20,
				'bridge_speed':                 20,
				'first_layer_speed':            15,
				'travel_speed':                 150,
				'max_print_speed':              nozzleDia >= 0.6 ? 60 : 50,
			};
			const speedChanges = [];
			for (const [key, val] of Object.entries(speedTable)) {
				const old = parseFloat(merged[key]) || 0;
				// Only override if the profile value is significantly different
				// (avoid overriding sensible custom values)
				if (old > 0 && Math.abs(old - val) > 5) {
					merged[key] = String(val);
					speedChanges.push(`${key}: ${old}→${val}`);
				} else if (old === 0) {
					merged[key] = String(val);
					speedChanges.push(`${key}: (unset)→${val}`);
				}
			}
			if (speedChanges.length > 0) {
				console.log(`  FLEX speed tuning: ${speedChanges.join(', ')}`);
			}

			// --- Retraction ---
			// TPU is flexible – long/fast retractions cause jams.
			// Direct-drive E2 needs very little retraction.
			const retLen = parseFloat(merged['retract_length']) || 0;
			if (retLen > 1.5) {
				console.log(`  FLEX: retract_length ${retLen} → 0.8mm (direct-drive TPU)`);
				merged['retract_length'] = '0.8';
			}
			const retSpeed = parseFloat(merged['retract_speed']) || 0;
			if (retSpeed > 30) {
				console.log(`  FLEX: retract_speed ${retSpeed} → 25mm/s (gentle for TPU)`);
				merged['retract_speed'] = '25';
			}

			// --- Cooling ---
			// TPU benefits from moderate cooling to set the layer before the
			// next one, but not full blast (causes warping on thin sections).
			merged['cooling'] = '1';
			merged['fan_always_on'] = '0';
			merged['min_fan_speed'] = '30';
			merged['max_fan_speed'] = '50';
			merged['bridge_fan_speed'] = '80';
			merged['disable_fan_first_layers'] = '3';
			merged['slowdown_below_layer_time'] = '10';
			merged['min_print_speed'] = '10';

			console.log(`  FLEX: cooling=moderate (30-50%), retract=${merged['retract_length']}mm@${merged['retract_speed']}mm/s`);

		} else if (filType === 'PLA') {
			// PLA is forgiving – the bundle speeds are fine.
			// Just ensure volumetric limit isn't needlessly restrictive.
			const oldVol = parseFloat(merged['filament_max_volumetric_speed']) || 0;
			const maxVol = nozzleDia >= 0.6 ? 15 : 11;
			if (oldVol > 0 && oldVol < maxVol) {
				merged['filament_max_volumetric_speed'] = String(maxVol);
			}

		} else if (filType === 'PET' || filType === 'PETG') {
			// PETG – moderate speeds, good cooling needed
			const oldVol = parseFloat(merged['filament_max_volumetric_speed']) || 0;
			const maxVol = nozzleDia >= 0.6 ? 10 : 8;
			if (oldVol > 0 && oldVol < maxVol) {
				merged['filament_max_volumetric_speed'] = String(maxVol);
			}
		}
	}

	// Disable multi-extruder / multi-material features
	merged['single_extruder_multi_material'] = '0';
	merged['wipe_tower'] = '0';
	merged['wipe_tower_x'] = '0';
	merged['wipe_tower_y'] = '0';
	merged['wipe_tower_rotation_angle'] = '0';
	merged['ooze_prevention'] = '0';
	merged['extruders_count'] = '1';
	merged['fill_pattern'] = merged['fill_pattern'] || 'gyroid';
	merged['fill_density'] = `${hardnessPlan.basePercent}%`;
	console.log(`  Hardness base fill density: ${hardnessPlan.basePercent}%`);

	// Compute bed center from bed_shape (format: "X1xY1,X2xY2,...")
	let bedCenter = null;
	let bedSize = null;
	const bedShape = merged['bed_shape'];
	if (bedShape) {
		try {
			const points = bedShape.split(',').map(p => {
				const [x, y] = p.trim().split('x').map(Number);
				return { x, y };
			}).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
			if (points.length >= 2) {
				const xs = points.map(p => p.x);
				const ys = points.map(p => p.y);
				bedCenter = {
					x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
					y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
				};
				bedSize = {
					x: Math.max(...xs) - Math.min(...xs),
					y: Math.max(...ys) - Math.min(...ys),
				};
				console.log(`  Bed: ${bedSize.x}×${bedSize.y}mm, center: ${bedCenter.x},${bedCenter.y}`);
			}
		} catch { /* ignore parse errors */ }
	}
	const maxPrintHeight = parseFloat(merged['max_print_height']) || 240;

	const lines = ['# Auto-generated Raise3D E2 flat config (single-extruder forced)'];
	for (const [k, v] of Object.entries(merged)) lines.push(`${k} = ${v}`);

	const flatPath = path.join(outputDir, 'raise3d-e2.ini');
	fs.writeFileSync(flatPath, lines.join('\n'), 'utf8');
	console.log(`  Wrote flat config (${Object.keys(merged).length} keys) → ${flatPath}`);
	return { configPath: flatPath, bedCenter, bedSize, maxPrintHeight };
}

async function fetchConfig() {
	const res = await fetch(`${baseUrl}/api/agent/config`, {
		headers: { authorization: `Bearer ${token}` },
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Failed to fetch config (${res.status}): ${text}`);
	}

	return await res.json();
}

async function ping() {
	const res = await fetch(`${baseUrl}/api/agent/ping`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Ping failed (${res.status}): ${text}`);
	}

	return await res.json();
}

async function getNextJob() {
	const res = await fetch(`${baseUrl}/api/agent/jobs/next`, {
		headers: { authorization: `Bearer ${token}` },
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Failed to get job (${res.status}): ${text}`);
	}

	return await res.json();
}

/**
 * Read a binary STL, auto-orient so the thinnest dimension becomes Z
 * (model lies flat), align longest dimension with longest bed axis,
 * center XY on bed, and drop to Z=0.
 */
function centerSTLOnBed(inPath, outPath, bedCenter, bedSize, maxPrintHeight) {
	const buf = fs.readFileSync(inPath);
	if (buf.length < 84) throw new Error('STL file too small to be valid');

	const triCount = buf.readUInt32LE(80);
	const expectedLen = 84 + triCount * 50;
	if (buf.length < expectedLen) {
		console.log(`  STL: ${buf.length} bytes, ${triCount} triangles (expected ${expectedLen}) – treating as ASCII, skipping orient`);
		if (inPath !== outPath) fs.copyFileSync(inPath, outPath);
		return { perm: [0, 1, 2], translation: { dx: 0, dy: 0, dz: 0 } };
	}

	// Pass 1: compute bounding box
	const mins = [Infinity, Infinity, Infinity];
	const maxs = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < triCount; i++) {
		const base = 84 + i * 50 + 12; // skip normal
		for (let v = 0; v < 3; v++) {
			const off = base + v * 12;
			for (let a = 0; a < 3; a++) {
				const val = buf.readFloatLE(off + a * 4);
				if (val < mins[a]) mins[a] = val;
				if (val > maxs[a]) maxs[a] = val;
			}
		}
	}
	const spans = [0, 1, 2].map(a => maxs[a] - mins[a]);
	console.log(`  STL bounds: X[${mins[0].toFixed(1)}, ${maxs[0].toFixed(1)}] Y[${mins[1].toFixed(1)}, ${maxs[1].toFixed(1)}] Z[${mins[2].toFixed(1)}, ${maxs[2].toFixed(1)}]`);
	console.log(`  STL spans: ${spans.map(s => s.toFixed(1)).join(' × ')} mm`);

	// Check if model already fits on bed without reorienting
	const fitsAsIs = spans[2] <= maxPrintHeight &&
		spans[0] <= bedSize.x && spans[1] <= bedSize.y;

	// Build axis permutation: perm[newAxis] = oldAxis
	let perm;
	if (fitsAsIs) {
		perm = [0, 1, 2];
		console.log(`  Model fits on bed as-is (no reorientation needed)`);
	} else {
		// Sort spans to find thinnest (→ Z), medium, longest
		const indexed = spans.map((s, a) => ({ axis: a, span: s }));
		indexed.sort((a, b) => a.span - b.span);
		const thinnest = indexed[0]; // → becomes new Z
		const remaining = [indexed[1], indexed[2]]; // medium, longest

		// Assign longest model span to longest bed axis
		let assignX, assignY;
		if (bedSize.x >= bedSize.y) {
			assignX = remaining[1]; // largest model span → bed X (longest)
			assignY = remaining[0]; // medium → bed Y
		} else {
			assignX = remaining[0];
			assignY = remaining[1];
		}
		perm = [assignX.axis, assignY.axis, thinnest.axis];
		console.log(`  Auto-orient: axis permutation [${perm}] – thinnest span ${thinnest.span.toFixed(1)}mm → Z`);
	}

	// Determine if permutation is odd (flips winding) and we need to swap
	// two vertices per triangle to keep normals correct
	const permSign = (
		(perm[0] === 0 && perm[1] === 1 && perm[2] === 2) ||
		(perm[0] === 1 && perm[1] === 2 && perm[2] === 0) ||
		(perm[0] === 2 && perm[1] === 0 && perm[2] === 1)
	) ? 1 : -1;

	// Compute new bounds after permutation
	const newMins = perm.map(a => mins[a]);
	const newMaxs = perm.map(a => maxs[a]);

	// Translation: center XY on bed, drop Z to 0
	const dx = bedCenter.x - (newMins[0] + newMaxs[0]) / 2;
	const dy = bedCenter.y - (newMins[1] + newMaxs[1]) / 2;
	const dz = -newMins[2];

	const finalSpans = perm.map(a => spans[a]);
	console.log(`  After orient: ${finalSpans[0].toFixed(1)}×${finalSpans[1].toFixed(1)}×${finalSpans[2].toFixed(1)} mm (XYZ)`);
	console.log(`  Translate: (${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(1)})`);

	// Pass 2: apply permutation + translation to all normals and vertices
	const out = Buffer.from(buf); // copy
	for (let i = 0; i < triCount; i++) {
		const triBase = 84 + i * 50;

		// Permute normal (3 floats at triBase)
		const n = [buf.readFloatLE(triBase), buf.readFloatLE(triBase + 4), buf.readFloatLE(triBase + 8)];
		out.writeFloatLE(n[perm[0]], triBase);
		out.writeFloatLE(n[perm[1]], triBase + 4);
		out.writeFloatLE(n[perm[2]], triBase + 8);

		// Read original 3 vertices
		const verts = [];
		for (let v = 0; v < 3; v++) {
			const off = triBase + 12 + v * 12;
			verts.push([buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8)]);
		}

		// If odd permutation, swap vertices 1 and 2 to preserve winding
		if (permSign === -1) {
			const tmp = verts[1];
			verts[1] = verts[2];
			verts[2] = tmp;
		}

		// Write permuted + translated vertices
		for (let v = 0; v < 3; v++) {
			const off = triBase + 12 + v * 12;
			out.writeFloatLE(verts[v][perm[0]] + dx, off);
			out.writeFloatLE(verts[v][perm[1]] + dy, off + 4);
			out.writeFloatLE(verts[v][perm[2]] + dz, off + 8);
		}
	}

	fs.writeFileSync(outPath, out);
	return { perm, translation: { dx, dy, dz } };
}

function analyzeInsoleLayout(stlPath, orientationMeta = null) {
	const buf = fs.readFileSync(stlPath);
	if (buf.length < 84) return null;
	const triCount = buf.readUInt32LE(80);
	const expectedLen = 84 + triCount * 50;
	if (buf.length < expectedLen || triCount < 2) return null;

	const perm = Array.isArray(orientationMeta?.perm) && orientationMeta.perm.length === 3
		? orientationMeta.perm
		: [0, 1, 2];
	const axisKeys = ['x', 'y', 'z'];
	const separationAxisIndex = Math.max(0, perm.findIndex((axis) => axis === 0));
	const lengthAxisIndex = Math.max(0, perm.findIndex((axis) => axis === 1));
	const separationAxis = axisKeys[separationAxisIndex];
	const lengthAxis = axisKeys[lengthAxisIndex];

	const triangles = [];
	for (let i = 0; i < triCount; i++) {
		const triBase = 84 + i * 50 + 12;
		const verts = [];
		let sumX = 0;
		let sumY = 0;
		for (let v = 0; v < 3; v++) {
			const off = triBase + v * 12;
			const x = buf.readFloatLE(off);
			const y = buf.readFloatLE(off + 4);
			const z = buf.readFloatLE(off + 8);
			verts.push({ x, y, z });
			sumX += x;
			sumY += y;
		}
		triangles.push({
			verts,
			centroid: { x: sumX / 3, y: sumY / 3 },
		});
	}

	let centers = [
		{ ...triangles[0].centroid },
		{ ...triangles[triangles.length - 1].centroid },
	];
	for (let i = 0; i < 6; i++) {
		const sums = [
			{ x: 0, y: 0, count: 0 },
			{ x: 0, y: 0, count: 0 },
		];
		for (const tri of triangles) {
			const d0 = (tri.centroid.x - centers[0].x) ** 2 + (tri.centroid.y - centers[0].y) ** 2;
			const d1 = (tri.centroid.x - centers[1].x) ** 2 + (tri.centroid.y - centers[1].y) ** 2;
			const idx = d0 <= d1 ? 0 : 1;
			sums[idx].x += tri.centroid.x;
			sums[idx].y += tri.centroid.y;
			sums[idx].count += 1;
		}
		for (let idx = 0; idx < 2; idx++) {
			if (sums[idx].count > 0) {
				centers[idx] = {
					x: sums[idx].x / sums[idx].count,
					y: sums[idx].y / sums[idx].count,
				};
			}
		}
	}

	const clusters = [
		{ tris: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, center: centers[0] },
		{ tris: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, center: centers[1] },
	];
	for (const tri of triangles) {
		const d0 = (tri.centroid.x - centers[0].x) ** 2 + (tri.centroid.y - centers[0].y) ** 2;
		const d1 = (tri.centroid.x - centers[1].x) ** 2 + (tri.centroid.y - centers[1].y) ** 2;
		const idx = d0 <= d1 ? 0 : 1;
		const cluster = clusters[idx];
		cluster.tris.push(tri);
		for (const vert of tri.verts) {
			if (vert.x < cluster.minX) cluster.minX = vert.x;
			if (vert.x > cluster.maxX) cluster.maxX = vert.x;
			if (vert.y < cluster.minY) cluster.minY = vert.y;
			if (vert.y > cluster.maxY) cluster.maxY = vert.y;
		}
	}

	if (!clusters[0].tris.length || !clusters[1].tris.length) return null;

	const ordered = [...clusters].sort((a, b) => a.center[separationAxis] - b.center[separationAxis]);
	const mapCluster = (cluster) => ({
		minX: cluster.minX,
		maxX: cluster.maxX,
		minY: cluster.minY,
		maxY: cluster.maxY,
		centerX: cluster.center.x,
		centerY: cluster.center.y,
		lengthMin: lengthAxis === 'x' ? cluster.minX : cluster.minY,
		lengthMax: lengthAxis === 'x' ? cluster.maxX : cluster.maxY,
	});

	return {
		separationAxis,
		lengthAxis,
		left: mapCluster(ordered[0]),
		right: mapCluster(ordered[1]),
	};
}

function resolveHardnessRegion(layout, x, y) {
	const point = { x, y };
	const within = (box, pad = 2) =>
		point.x >= box.minX - pad && point.x <= box.maxX + pad && point.y >= box.minY - pad && point.y <= box.maxY + pad;
	let side = 'left';
	if (within(layout.right) && !within(layout.left)) side = 'right';
	else if (!within(layout.left) && !within(layout.right)) {
		const leftDist = (point.x - layout.left.centerX) ** 2 + (point.y - layout.left.centerY) ** 2;
		const rightDist = (point.x - layout.right.centerX) ** 2 + (point.y - layout.right.centerY) ** 2;
		side = rightDist < leftDist ? 'right' : 'left';
	}
	const box = layout[side];
	const lengthCoord = layout.lengthAxis === 'x' ? point.x : point.y;
	const span = Math.max(1e-6, box.lengthMax - box.lengthMin);
	const t = (lengthCoord - box.lengthMin) / span;
	const zone = t > 0.55 ? 'front' : t > 0.25 ? 'middle' : 'back';
	return { side, zone };
}

function applyHardnessPostProcess(gcodePath, stlPath, settings, orientationMeta = null) {
	if (!fs.existsSync(gcodePath)) {
		return { applied: false, scaledMoves: 0, reason: 'missing-gcode' };
	}

	const plan = buildHardnessPlan(settings);
	const original = fs.readFileSync(gcodePath, 'utf8');
	const layout = analyzeInsoleLayout(stlPath, orientationMeta);
	if (!layout) {
		fs.writeFileSync(gcodePath, `${plan.headerLines.join('\n')}\n${original}`, 'utf8');
		return { applied: false, basePercent: plan.basePercent, scaledMoves: 0, reason: 'layout-unavailable' };
	}

	const lines = original.split(/\r?\n/);
	const output = [...plan.headerLines, '; PODO_HARDNESS_METHOD=base-density-plus-infill-scaling'];
	let featureType = '';
	let absoluteExtrusion = true;
	let currentX = 0;
	let currentY = 0;
	let currentE = 0;
	let scaledMoves = 0;

	for (let line of lines) {
		if (line.startsWith(';TYPE:')) {
			featureType = line.slice(6).trim();
			output.push(line);
			continue;
		}
		if (/^M82\b/i.test(line)) {
			absoluteExtrusion = true;
			output.push(line);
			continue;
		}
		if (/^M83\b/i.test(line)) {
			absoluteExtrusion = false;
			output.push(line);
			continue;
		}
		if (/^G92\b/i.test(line)) {
			const eReset = extractGcodeCoord(line, 'E');
			if (eReset != null) currentE = eReset;
			output.push(line);
			continue;
		}

		if (/^G0?1\b/i.test(line)) {
			const nextX = extractGcodeCoord(line, 'X');
			const nextY = extractGcodeCoord(line, 'Y');
			const nextE = extractGcodeCoord(line, 'E');
			const resolvedX = nextX != null ? nextX : currentX;
			const resolvedY = nextY != null ? nextY : currentY;

			if (nextE != null) {
				const deltaE = absoluteExtrusion ? nextE - currentE : nextE;
				const isInternalInfill = /^internal infill$/i.test(featureType);
				if (deltaE > 0 && isInternalInfill) {
					const region = resolveHardnessRegion(layout, (currentX + resolvedX) / 2, (currentY + resolvedY) / 2);
					const sidePlan = plan[region.side];
					const targetPercent = sidePlan.elementsSplit ? sidePlan[region.zone] : sidePlan.overall;
					const scale = Math.max(0.05, Math.min(1, targetPercent / plan.basePercent));
					if (Math.abs(scale - 1) > 0.001) {
						const scaledDelta = deltaE * scale;
						const replacementE = absoluteExtrusion ? currentE + scaledDelta : scaledDelta;
						line = line.replace(/([\s])E-?\d*\.?\d+/i, `$1E${formatGcodeNumber(replacementE)}`);
						scaledMoves += 1;
						currentE = absoluteExtrusion ? replacementE : currentE + scaledDelta;
					} else {
						currentE = absoluteExtrusion ? nextE : currentE + deltaE;
					}
				} else {
					currentE = absoluteExtrusion ? nextE : currentE + deltaE;
				}
			}

			currentX = resolvedX;
			currentY = resolvedY;
		}

		output.push(line);
	}

	fs.writeFileSync(gcodePath, output.join('\n'), 'utf8');
	return { applied: true, basePercent: plan.basePercent, scaledMoves, reason: null };
}

function runPrusaSlicer(prusaSlicerPath, configPaths, stlPath, outputPath, settings, disableBinaryGcode = true) {
	return new Promise((resolve, reject) => {
		const nozzle = typeof settings?.nozzle === 'string' ? settings.nozzle.replace(/\s*mm$/i, '').trim() : '';
		const adhesion = typeof settings?.adhesion === 'string' ? settings.adhesion.toLowerCase() : '';
		const topLayers = Number.isFinite(Number(settings?.topLayers)) ? Number(settings.topLayers) : null;
		const bottomLayers = Number.isFinite(Number(settings?.bottomLayers)) ? Number(settings.bottomLayers) : null;

		const args = ['--export-gcode'];
		for (const cfg of configPaths) {
			args.push('--load', cfg);
		}
		if (nozzle) args.push('--nozzle-diameter', nozzle);
		if (topLayers != null) args.push('--top-solid-layers', String(Math.max(0, topLayers)));
		if (bottomLayers != null) args.push('--bottom-solid-layers', String(Math.max(0, bottomLayers)));
		if (adhesion === 'geen' || adhesion === 'none') {
			args.push('--brim-width', '0', '--skirts', '0');
		} else if (adhesion === 'brim') {
			args.push('--brim-width', '4', '--skirts', '0');
		} else if (adhesion === 'skirt') {
			args.push('--skirts', '2', '--skirt-distance', '6');
		}
		// Some PrusaSlicer builds do not accept a value for --binary-gcode,
		// and can interpret "0" as an input filename ("No such file: 0").
		// To avoid cross-version CLI issues, we omit the flag when ASCII output
		// is requested and rely on profile/default behavior.
		if (!disableBinaryGcode) {
			args.push('--binary-gcode');
		}
		args.push('--output', outputPath, stlPath);

		console.log(`  Running: "${prusaSlicerPath}" ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);
		const slicer = spawn(prusaSlicerPath, args, { windowsHide: true });
		let stderr = '';
		let stdout = '';
		const timeoutSec = Number(settings?.slicerTimeoutSec ?? 120);
		const timeoutMs = Math.max(30, timeoutSec) * 1000;
		const timer = setTimeout(() => {
			try {
				slicer.kill('SIGKILL');
			} catch {
				// ignore
			}
			reject(new Error(`PrusaSlicer timeout after ${Math.round(timeoutMs / 1000)}s`));
		}, timeoutMs);

		slicer.stdout.on('data', (data) => {
			stdout += data.toString();
		});
		slicer.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		slicer.on('close', (code) => {
			clearTimeout(timer);
			console.log(`  PrusaSlicer exited with code ${code}`);
			if (stdout.trim()) console.log(`  stdout: ${stdout.trim().slice(0, 500)}`);
			if (stderr.trim()) console.log(`  stderr: ${stderr.trim().slice(0, 500)}`);
			if (code !== 0) {
				reject(
					new Error(
						`PrusaSlicer exited with code ${code}. stderr: ${stderr || '(empty)'} stdout: ${stdout || '(empty)'}`
					)
				);
				return;
			}

			if (fs.existsSync(outputPath)) {
				resolve({ outputPath, stdout, stderr, args });
				return;
			}

			// Some PrusaSlicer builds/configs ignore explicit output filename and
			// emit *.gcode or *.bgcode next to the input STL.
			const outputDir = path.dirname(outputPath);
			const candidates = fs
				.readdirSync(outputDir)
				.filter((name) => /\.(gcode|bgcode)$/i.test(name))
				.map((name) => path.join(outputDir, name))
				.filter((p) => {
					try {
						return fs.statSync(p).isFile();
					} catch {
						return false;
					}
				})
				.sort((a, b) => {
					try {
						return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
					} catch {
						return 0;
					}
				});

			if (candidates.length > 0) {
				resolve({ outputPath: candidates[0], stdout, stderr, args });
				return;
			}

			reject(new Error(
				`PrusaSlicer finished (exit 0) but created no .gcode/.bgcode file.\n` +
				`  stdout: ${stdout || '(empty)'}\n` +
				`  stderr: ${stderr || '(empty)'}\n` +
				`  dir contents: ${fs.readdirSync(path.dirname(outputPath)).join(', ') || '(empty)'}\n` +
				`  args: ${args.join(' ')}`
			));
		});

		slicer.on('error', (err) => {
			clearTimeout(timer);
			reject(new Error(`Failed to start PrusaSlicer: ${err.message}`));
		});
	});
}

function createSlicerAdapter(config, bundleSections) {
	return {
		name: 'prusaslicer',
		printerModel: 'raise3d-e2',
		slice: (stlPath, outputPath, settings) => {
			let orientationMeta = { perm: [0, 1, 2], translation: { dx: 0, dy: 0, dz: 0 } };
			const { configPath, bedCenter, bedSize, maxPrintHeight } =
				generateFlatConfig(bundleSections, settings, path.dirname(outputPath));

			// Auto-orient + center the STL on the bed before slicing.
			// PrusaSlicer CLI doesn't auto-center or auto-orient.
			if (bedCenter && bedSize) {
				try {
					orientationMeta = centerSTLOnBed(stlPath, stlPath, bedCenter, bedSize, maxPrintHeight) || orientationMeta;
				} catch (err) {
					console.warn(`  ⚠ Failed to auto-orient/center STL: ${err.message}`);
				}
			}

			return runPrusaSlicer(
				config.prusaSlicerPath,
				[configPath],
				stlPath,
				outputPath,
				settings,
				config.disableBinaryGcode !== false
			).then((sliceResult) => {
				const generatedPath =
					sliceResult && typeof sliceResult.outputPath === 'string'
						? sliceResult.outputPath
						: outputPath;
				const hardnessMeta = applyHardnessPostProcess(generatedPath, stlPath, settings, orientationMeta);
				console.log(`  Hardness post-process: applied=${hardnessMeta.applied}, scaledMoves=${hardnessMeta.scaledMoves}, base=${hardnessMeta.basePercent}%, reason=${hardnessMeta.reason ?? 'ok'}`);
				return { ...sliceResult, outputPath: generatedPath, hardnessMeta };
			});
		},
	};
}

// ═══════════════════════════════════════════════════════════════════════════
//  IR3 V2 Belt Printer — G-code Coordinate Transform (inlined)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse G-code motion line parameters (X, Y, Z, E, F).
 * Returns an object with only the parameters present in the line.
 */
function parseGcodeLine(line) {
	const result = {};
	const code = line.includes(';') ? line.slice(0, line.indexOf(';')) : line;
	for (const axis of ['X', 'Y', 'Z', 'E', 'F']) {
		const match = code.match(new RegExp(`${axis}(-?\\d+\\.?\\d*)`, 'i'));
		if (match) result[axis] = parseFloat(match[1]);
	}
	return result;
}

/** Format a number for G-code output: up to 4 decimals, no trailing zeros */
function formatNum(val) {
	return parseFloat(val.toFixed(4)).toString();
}

/**
 * Transform standard PrusaSlicer G-code into IR3 V2 belt coordinates.
 *
 * Rotation around the X axis by tilt angle θ:
 *   IR3_Y =  slicer_Y · cos(θ) + slicer_Z · sin(θ)
 *   IR3_Z = -slicer_Y · sin(θ) + slicer_Z · cos(θ) + beltNormalOffset
 */
function transformForIR3(gcodeText, opts = {}) {
	const tiltDeg = opts.tiltAngleDeg ?? 45;
	const beltOffset = opts.beltNormalOffsetMm ?? -0.15;
	const maxBelt = opts.ir3MaxBeltLengthMm ?? 1000;

	const tiltRad = (tiltDeg * Math.PI) / 180;
	const cosT = Math.cos(tiltRad);
	const sinT = Math.sin(tiltRad);

	const lines = gcodeText.split('\n');
	const output = [];
	let curX = 0, curY = 0, curZ = 0;
	let absolute = true;
	let linesTransformed = 0;
	let maxBeltTravel = 0;

	for (const line of lines) {
		const stripped = line.trimStart();
		if (/^G90\b/i.test(stripped)) { absolute = true; output.push(line); continue; }
		if (/^G91\b/i.test(stripped)) { absolute = false; output.push(line); continue; }

		const motionMatch = stripped.match(/^G[01]\b/i);
		if (!motionMatch) { output.push(line); continue; }

		const params = parseGcodeLine(stripped);
		const cmd = motionMatch[0].toUpperCase();

		let targetX, targetY, targetZ;
		if (absolute) {
			targetX = params.X ?? curX;
			targetY = params.Y ?? curY;
			targetZ = params.Z ?? curZ;
		} else {
			targetX = curX + (params.X ?? 0);
			targetY = curY + (params.Y ?? 0);
			targetZ = curZ + (params.Z ?? 0);
		}

		const ir3X = targetX;
		const ir3Y = targetY * cosT + targetZ * sinT;
		const ir3Z = -targetY * sinT + targetZ * cosT + beltOffset;

		if (!Number.isFinite(ir3X) || !Number.isFinite(ir3Y) || !Number.isFinite(ir3Z)) {
			output.push(`; IR3_TRANSFORM_ERROR: NaN/Inf – original: ${line}`);
			continue;
		}
		if (Math.abs(ir3Y) > maxBelt) {
			output.push(`; IR3_TRANSFORM_ERROR: belt travel ${ir3Y.toFixed(2)}mm exceeds limit ${maxBelt}mm – original: ${line}`);
			continue;
		}

		if (Math.abs(ir3Y) > maxBeltTravel) maxBeltTravel = Math.abs(ir3Y);

		let rebuilt = cmd;
		if (params.X != null) rebuilt += ` X${formatNum(ir3X)}`;
		if (params.Y != null) rebuilt += ` Y${formatNum(ir3Y)}`;
		if (params.Z != null) rebuilt += ` Z${formatNum(ir3Z)}`;
		if (params.E != null) rebuilt += ` E${formatNum(params.E)}`;
		if (params.F != null) rebuilt += ` F${Math.round(params.F)}`;

		const commentIdx = stripped.indexOf(';');
		if (commentIdx > 0) rebuilt += ' ' + stripped.slice(commentIdx);

		output.push(rebuilt);
		linesTransformed++;
		curX = targetX; curY = targetY; curZ = targetZ;
	}

	return {
		gcode: output.join('\n'),
		stats: { linesTotal: lines.length, linesTransformed, maxBeltTravel: Math.round(maxBeltTravel * 100) / 100 },
	};
}

/** Generate IR3 V2 start G-code (Klipper firmware). */
function ir3StartGcode(opts = {}) {
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

/** Generate IR3 V2 end G-code. */
function ir3EndGcode() {
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

// ═══════════════════════════════════════════════════════════════════════════
//  IdeaFormer IR3 V2 — belt printer adapter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * IR3 V2 virtual bed profile for PrusaSlicer.
 *
 * The IR3 has a 250×250mm belt surface.  We create a "tall" virtual bed so
 * that PrusaSlicer slices the part using conventional planar layers.  The
 * belt post-processor then rotates the toolpath into IR3 coordinates.
 */
function generateIR3FlatConfig(settings, outputDir) {
	const nozzle = settings?.nozzle || '0.4';
	const material = (settings?.material || '').toLowerCase();
	const hardnessPlan = buildHardnessPlan(settings);

	// Nozzle temp defaults per material
	let nozzleTemp = 220;
	let bedTemp = 50;
	if (material.includes('tpu') || material.includes('flex')) { nozzleTemp = 230; bedTemp = 40; }
	else if (material.includes('pla'))  { nozzleTemp = 210; bedTemp = 50; }
	else if (material.includes('petg')) { nozzleTemp = 240; bedTemp = 70; }
	else if (material.includes('abs'))  { nozzleTemp = 250; bedTemp = 100; }

	// The IR3 belt is 250×250mm; virtual Z can be very tall because the belt
	// axis is "infinite".  We use 500mm to give PrusaSlicer room.
	const bedW = 250;
	const bedD = 250;
	const virtualZ = 500;

	const merged = {
		// Bed
		bed_shape: `0x0,${bedW}x0,${bedW}x${bedD},0x${bedD}`,
		max_print_height: String(virtualZ),

		// Nozzle
		nozzle_diameter: nozzle,

		// Speeds (IR3 V2 can do 400mm/s but TPU is much slower)
		max_print_speed: material.includes('tpu') || material.includes('flex') ? '60' : '150',
		max_volumetric_speed: '0',

		// Layers
		layer_height: '0.2',
		first_layer_height: '0.25',

		// Temperatures
		temperature: String(nozzleTemp),
		first_layer_temperature: String(nozzleTemp),
		bed_temperature: String(bedTemp),
		first_layer_bed_temperature: String(bedTemp),

		// Retraction (Klipper direct drive typical)
		retract_length: '1',
		retract_speed: '40',
		deretract_speed: '40',
		retract_lift: '0',
		retract_before_travel: '2',

		// Extrusion
		extrusion_multiplier: '1',
		filament_diameter: '1.75',

		// Single extruder
		extruders_count: '1',
		wipe_tower: '0',

		// Firmware
		gcode_flavor: 'reprap',

		// No supports by default (belt printers handle overhangs in belt direction)
		support_material: '0',

		// Infill
		fill_density: `${hardnessPlan.basePercent}%`,
		fill_pattern: 'gyroid',

		// Cooling
		fan_always_on: '1',
		min_fan_speed: '100',
		max_fan_speed: '100',
		bridge_fan_speed: '100',
	};

	// Apply user overrides
	const adhesion = (settings?.adhesion || '').toLowerCase();
	if (adhesion === 'geen' || adhesion === 'none') {
		merged.brim_width = '0';
		merged.skirts = '0';
	} else if (adhesion === 'brim') {
		merged.brim_width = '4';
		merged.skirts = '0';
	} else if (adhesion === 'skirt') {
		merged.skirts = '2';
		merged.skirt_distance = '6';
	}

	const topLayers = Number.isFinite(Number(settings?.topLayers)) ? Number(settings.topLayers) : 3;
	const bottomLayers = Number.isFinite(Number(settings?.bottomLayers)) ? Number(settings.bottomLayers) : 3;
	merged.top_solid_layers = String(topLayers);
	merged.bottom_solid_layers = String(bottomLayers);

	const bedCenter = { x: Math.round(bedW / 2), y: Math.round(bedD / 2) };
	const bedSize = { x: bedW, y: bedD };

	console.log(`  IR3 V2 virtual bed: ${bedW}×${bedD}mm, virtual Z=${virtualZ}mm`);
	console.log(`  IR3 V2 temps: nozzle=${nozzleTemp}°C, bed=${bedTemp}°C, material="${settings?.material}"`);
	console.log(`  Hardness base fill density: ${hardnessPlan.basePercent}%`);

	const lines = ['# Auto-generated IdeaFormer IR3 V2 flat config'];
	for (const [k, v] of Object.entries(merged)) lines.push(`${k} = ${v}`);

	const flatPath = path.join(outputDir, 'ir3-v2.ini');
	fs.writeFileSync(flatPath, lines.join('\n'), 'utf8');
	console.log(`  Wrote IR3 flat config (${Object.keys(merged).length} keys) → ${flatPath}`);

	return { configPath: flatPath, bedCenter, bedSize, maxPrintHeight: virtualZ, nozzleTemp, bedTemp };
}

/**
 * Create a slicer adapter for the IdeaFormer IR3 V2 belt printer.
 *
 * Pipeline:
 *   1. Generate a virtual-bed PrusaSlicer config
 *   2. Auto-orient + center STL
 *   3. Run PrusaSlicer to get conventional G-code
 *   4. Apply belt coordinate transform (45° rotation)
 *   5. Inject IR3-specific start/end G-code
 */
function createIR3SlicerAdapter(config) {
	return {
		name: 'prusaslicer-ir3v2',
		printerModel: 'ir3-v2',
		slice: async (stlPath, outputPath, settings) => {
			const outputDir = path.dirname(outputPath);
			let orientationMeta = { perm: [0, 1, 2], translation: { dx: 0, dy: 0, dz: 0 } };
			const { configPath, bedCenter, bedSize, maxPrintHeight, nozzleTemp, bedTemp } =
				generateIR3FlatConfig(settings, outputDir);

			// Auto-orient + center
			if (bedCenter && bedSize) {
				try {
					orientationMeta = centerSTLOnBed(stlPath, stlPath, bedCenter, bedSize, maxPrintHeight) || orientationMeta;
				} catch (err) {
					console.warn(`  ⚠ Failed to auto-orient/center STL for IR3: ${err.message}`);
				}
			}

			// Run PrusaSlicer to get standard G-code
			const sliceResult = await runPrusaSlicer(
				config.prusaSlicerPath,
				[configPath],
				stlPath,
				outputPath,
				settings,
				true // always ASCII for IR3 (we need to post-process the text)
			);

			// Read the standard G-code
			const standardGcodePath =
				sliceResult && typeof sliceResult.outputPath === 'string'
					? sliceResult.outputPath
					: outputPath;
			const hardnessMeta = applyHardnessPostProcess(standardGcodePath, stlPath, settings, orientationMeta);
			console.log(`  Hardness post-process: applied=${hardnessMeta.applied}, scaledMoves=${hardnessMeta.scaledMoves}, base=${hardnessMeta.basePercent}%, reason=${hardnessMeta.reason ?? 'ok'}`);
			const standardGcode = fs.readFileSync(standardGcodePath, 'utf8');

			// Apply IR3 belt coordinate transform
			const tiltAngleDeg = settings?.beltAngleDeg ?? 45;
			const beltNormalOffsetMm = settings?.beltNormalOffsetMm ?? -0.15;
			const ir3MaxBeltLengthMm = settings?.ir3MaxBeltLengthMm ?? 1000;

			console.log(`  IR3 transform: tilt=${tiltAngleDeg}°, offset=${beltNormalOffsetMm}mm, maxBelt=${ir3MaxBeltLengthMm}mm`);

			const { gcode: transformedGcode, stats } = transformForIR3(standardGcode, {
				tiltAngleDeg,
				beltNormalOffsetMm,
				ir3MaxBeltLengthMm,
			});

			console.log(`  IR3 transform stats: ${stats.linesTransformed}/${stats.linesTotal} lines transformed, max belt travel=${stats.maxBeltTravel}mm`);

			// Inject start / end G-code
			const startGcode = ir3StartGcode({ nozzleTemp, bedTemp, beltNormalOffsetMm });
			const endGcode = ir3EndGcode();

			// Remove PrusaSlicer's own start/end blocks and wrap with IR3 ones
			const finalGcode = startGcode + '\n' + transformedGcode + '\n' + endGcode;

			// Write final G-code back
			const ir3OutputPath = standardGcodePath.replace(/\.gcode$/i, '_ir3.gcode');
			fs.writeFileSync(ir3OutputPath, finalGcode, 'utf8');
			console.log(`  IR3 final G-code: ${(finalGcode.length / 1024).toFixed(0)} KB → ${ir3OutputPath}`);

			return { outputPath: ir3OutputPath, stdout: sliceResult?.stdout, stderr: sliceResult?.stderr, args: sliceResult?.args, ir3Stats: stats, hardnessMeta };
		},
	};
}

async function completeJob(jobId, gcodeGzipBase64, filename, slicerMeta) {
	const res = await fetch(`${baseUrl}/api/agent/jobs/${jobId}/complete`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ gcodeGzipBase64, filename, slicerMeta }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Complete callback failed (${res.status}): ${text}`);
	}
}

async function failJob(jobId, errorMessage) {
	const res = await fetch(`${baseUrl}/api/agent/jobs/${jobId}/fail`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ errorMessage: String(errorMessage || 'Unknown slicing error') }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Fail callback failed (${res.status}): ${text}`);
	}
}

async function processJob(job, slicerAdapter) {
	console.log(`Processing job ${job.jobId}...`);

	// Create temp directory
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podo-agent-'));
	const stlPath = path.join(tempDir, 'input.stl');
	const gcodePath = path.join(tempDir, 'output.gcode');

	try {
		// Write STL file
		const stlBuffer = Buffer.from(job.stlData, 'base64');
		fs.writeFileSync(stlPath, stlBuffer);

		// Run slicer
		const sliceResult = await slicerAdapter.slice(stlPath, gcodePath, job.printerSettings);
		const generatedPath =
			sliceResult && typeof sliceResult.outputPath === 'string'
				? sliceResult.outputPath
				: gcodePath;

		// Read generated Gcode and gzip-compress before upload
		const gcodeBuffer = fs.readFileSync(generatedPath);
		const gzipped = gzipSync(gcodeBuffer);
		const gcodeGzipBase64 = gzipped.toString('base64');
		console.log(`  Gcode: ${(gcodeBuffer.length / 1024).toFixed(0)} KB raw → ${(gzipped.length / 1024).toFixed(0)} KB gzip → ${(gcodeGzipBase64.length / 1024).toFixed(0)} KB base64`);

		await completeJob(
			job.jobId,
			gcodeGzipBase64,
			(job.filename || 'insole.stl').replace(/\.stl$/i, '.gcode'),
			{
				slicer: slicerAdapter.name,
				note: 'Printer/material/nozzle settings and step3 hardness settings applied during slicing/post-processing.',
				printerSettings: job.printerSettings ?? {},
				hardnessMeta: sliceResult?.hardnessMeta ?? null,
			}
		);

		console.log(`Job ${job.jobId} completed successfully`);
	} catch (err) {
		try {
			await failJob(job.jobId, err instanceof Error ? err.message : String(err));
		} catch (callbackErr) {
			console.error('Failed to report job failure:', callbackErr.message || callbackErr);
		}
		throw err;
	} finally {
		// Cleanup
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

async function main() {
	console.log('Podo Improve Print Agent starting...');

	// Initial ping to mark as connected
	try {
		await ping();
		console.log('✓ Connected to server');
	} catch (err) {
		console.error('Failed to connect:', err.message);
		process.exit(1);
	}

	// Fetch configuration
	let config;
	try {
		config = await fetchConfig();
		console.log('✓ Config loaded', {
			prusaSlicerPath: config.prusaSlicerPath || 'NOT SET',
		});
	} catch (err) {
		console.error('Failed to fetch config:', err.message);
		process.exit(1);
	}

	if (!config.prusaSlicerPath) {
		console.error('ERROR: prusaSlicerPath is not configured in Settings → Lokale Print Agent');
		process.exit(1);
	}
	if (!fs.existsSync(config.prusaSlicerPath)) {
		console.error(`ERROR: PrusaSlicer not found at: ${config.prusaSlicerPath}`);
		process.exit(1);
	}

	// Load Raise3D E2 config bundle (non-fatal — IR3 jobs don't need it)
	let bundleSections = {};
	try {
		const bundlePath = await ensureDefaultE2Bundle();
		const bundleText = fs.readFileSync(bundlePath, 'utf8');
		bundleSections = parseConfigBundle(bundleText);
		const sectionCount = Object.keys(bundleSections).length;
		console.log(`✓ Raise3D E2 config bundle loaded (${sectionCount} profiles): ${bundlePath}`);
	} catch (err) {
		console.warn(
			`⚠ Failed to load Raise3D E2 profile bundle (IR3 jobs will still work). ${err.message}`
		);
	}

	console.log('✓ PrusaSlicer found');

	// Create slicer adapters for both printers
	const raise3dAdapter = createSlicerAdapter(config, bundleSections);
	const ir3Adapter = createIR3SlicerAdapter(config);

	console.log('✓ Slicer adapters ready: Raise3D E2, IdeaFormer IR3 V2');
	console.log('\nAgent is ready. Polling for jobs...\n');

	/**
	 * Select the correct slicer adapter based on the job's printerSettings.
	 * The printerModel field is set by the UI when the user selects a printer.
	 */
	function selectAdapter(job) {
		const model = (job.printerSettings?.printerModel || '').toLowerCase();
		if (model === 'ir3-v2') {
			console.log(`  → Using IR3 V2 belt printer adapter`);
			return ir3Adapter;
		}
		// Default: Raise3D E2
		if (model && model !== 'raise3d-e2') {
			console.warn(`  ⚠ Unknown printer model "${model}", falling back to Raise3D E2`);
		}
		console.log(`  → Using Raise3D E2 adapter`);
		return raise3dAdapter;
	}

	// Main loop: ping every 30s, poll for jobs every 5s
	let pingInterval = setInterval(async () => {
		try {
			await ping();
		} catch (err) {
			console.error('Ping failed:', err.message);
		}
	}, 30000);

	let jobInterval = setInterval(async () => {
		try {
			const { job } = await getNextJob();
			if (job) {
				clearInterval(jobInterval);
				clearInterval(pingInterval);
				const adapter = selectAdapter(job);
				await processJob(job, adapter);
				// Restart intervals after job completes
				main();
			}
		} catch (err) {
			console.error('Job poll failed:', err.message);
		}
	}, 5000);

	// Handle graceful shutdown
	process.on('SIGINT', () => {
		console.log('\nShutting down...');
		clearInterval(pingInterval);
		clearInterval(jobInterval);
		process.exit(0);
	});
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});

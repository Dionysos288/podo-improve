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

	// Disable multi-extruder / multi-material features
	merged['single_extruder_multi_material'] = '0';
	merged['wipe_tower'] = '0';
	merged['wipe_tower_x'] = '0';
	merged['wipe_tower_y'] = '0';
	merged['wipe_tower_rotation_angle'] = '0';
	merged['ooze_prevention'] = '0';
	merged['extruders_count'] = '1';

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
		return;
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
		slice: (stlPath, outputPath, settings) => {
			const { configPath, bedCenter, bedSize, maxPrintHeight } =
				generateFlatConfig(bundleSections, settings, path.dirname(outputPath));

			// Auto-orient + center the STL on the bed before slicing.
			// PrusaSlicer CLI doesn't auto-center or auto-orient.
			if (bedCenter && bedSize) {
				try {
					centerSTLOnBed(stlPath, stlPath, bedCenter, bedSize, maxPrintHeight);
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
			);
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
				note: 'Printer/material/nozzle settings passed as best-effort slicer args.',
				printerSettings: job.printerSettings ?? {},
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
	let bundleSections = {};
	try {
		const bundlePath = await ensureDefaultE2Bundle();
		const bundleText = fs.readFileSync(bundlePath, 'utf8');
		bundleSections = parseConfigBundle(bundleText);
		const sectionCount = Object.keys(bundleSections).length;
		console.log(`✓ Raise3D E2 config bundle loaded (${sectionCount} profiles): ${bundlePath}`);
	} catch (err) {
		console.error(
			`ERROR: Failed to load Raise3D E2 profile bundle. ${err.message}`
		);
		process.exit(1);
	}
	console.log('✓ PrusaSlicer found');
	console.log('\nAgent is ready. Polling for jobs...\n');
	const slicerAdapter = createSlicerAdapter(config, bundleSections);

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
				await processJob(job, slicerAdapter);
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

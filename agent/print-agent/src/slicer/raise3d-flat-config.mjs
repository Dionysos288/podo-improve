import fs from 'fs';
import path from 'path';
import { buildHardnessPlan } from './hardness.mjs';
import {
	BUNDLE_SKIP_KEYS,
	PER_EXTRUDER_KEYS,
	selectProfiles,
	applyMaterialOverrides,
} from './raise3d-profiles.mjs';

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
export function generateFlatConfig(bundleSections, settings, outputDir) {
	const { printerProfile, printProfile, filamentProfile } = selectProfiles(bundleSections, settings);
	const hardnessPlan = buildHardnessPlan(settings);
	const merged = {};
	for (const [k, v] of Object.entries(printProfile)) { if (!BUNDLE_SKIP_KEYS.has(k)) merged[k] = v; }
	for (const [k, v] of Object.entries(filamentProfile)) { if (!BUNDLE_SKIP_KEYS.has(k)) merged[k] = v; }
	for (const [k, v] of Object.entries(printerProfile)) { if (!BUNDLE_SKIP_KEYS.has(k)) merged[k] = v; }

	const extruder = (settings?.extruder || 'Links').toLowerCase();
	const extIdx = (extruder === 'rechts' || extruder === 'right') ? 1 : 0;
	console.log(`  Forcing single-extruder mode (extruder index=${extIdx})`);

	for (const key of PER_EXTRUDER_KEYS) {
		if (merged[key] && typeof merged[key] === 'string' && merged[key].includes(',')) {
			const parts = merged[key].split(',').map((s) => s.trim());
			if (parts.length > 1) {
				merged[key] = parts[extIdx] || parts[0];
			}
		}
	}

	for (const [k, v] of Object.entries(merged)) {
		if (typeof v === 'string' && v.includes(',') && !PER_EXTRUDER_KEYS.has(k)) {
			const parts = v.split(',').map((s) => s.trim());
			if (parts.length === 2 && !v.includes('x') && k !== 'bed_shape') {
				const allNumeric = parts.every((p) => /^-?\d*\.?\d+$/.test(p));
				if (allNumeric) {
					merged[k] = parts[extIdx] || parts[0];
				}
			}
		}
	}

	if (settings?.nozzle) {
		merged['nozzle_diameter'] = String(settings.nozzle).replace(/\s*mm$/i, '').split(',')[0].trim();
	}

	// ── Material-aware tuning ────────────────────────────────────────────
	{
		const filType = (merged['filament_type'] || '').toUpperCase();
		const nozzleDia = parseFloat(merged['nozzle_diameter']) || 0.6;

		const profileNozzle = parseFloat(merged['extrusion_width']) || nozzleDia;
		if (nozzleDia > profileNozzle + 0.05) {
			const w = Math.round(nozzleDia * 1.1 * 100) / 100;
			const ew = Math.round(nozzleDia * 1.05 * 100) / 100;
			const fw = Math.round(nozzleDia * 1.0 * 100) / 100;
			console.log(`  Adjusting extrusion widths for ${nozzleDia}mm nozzle: general=${w} external=${ew} first_layer=${fw}`);
			merged['extrusion_width'] = String(w);
			merged['perimeter_extrusion_width'] = String(w);
			merged['external_perimeter_extrusion_width'] = String(ew);
			merged['infill_extrusion_width'] = String(w);
			merged['solid_infill_extrusion_width'] = String(w);
			merged['top_infill_extrusion_width'] = String(ew);
			merged['first_layer_extrusion_width'] = String(fw);
		}

		if (filType === 'FLEX' || filType === 'TPU') {
			let maxVol;
			if (nozzleDia <= 0.4) maxVol = 2.5;
			else if (nozzleDia <= 0.6) maxVol = 4;
			else if (nozzleDia <= 0.8) maxVol = 5;
			else maxVol = 6;

			const oldVol = parseFloat(merged['filament_max_volumetric_speed']) || 0;
			if (oldVol > 0 && oldVol < maxVol) {
				console.log(`  FLEX: volumetric flow ${oldVol} → ${maxVol} mm³/s (nozzle=${nozzleDia}mm)`);
				merged['filament_max_volumetric_speed'] = String(maxVol);
			}

			const speedTable = {
				'perimeter_speed': nozzleDia >= 0.6 ? 40 : 30,
				'external_perimeter_speed': nozzleDia >= 0.6 ? 30 : 25,
				'infill_speed': nozzleDia >= 0.6 ? 50 : 40,
				'solid_infill_speed': nozzleDia >= 0.6 ? 40 : 35,
				'top_solid_infill_speed': nozzleDia >= 0.6 ? 30 : 25,
				'small_perimeter_speed': 20,
				'gap_fill_speed': nozzleDia >= 0.6 ? 30 : 20,
				'bridge_speed': 20,
				'first_layer_speed': 15,
				'travel_speed': 150,
				'max_print_speed': nozzleDia >= 0.6 ? 60 : 50,
			};
			const speedChanges = [];
			for (const [key, val] of Object.entries(speedTable)) {
				const old = parseFloat(merged[key]) || 0;
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
			const oldVol = parseFloat(merged['filament_max_volumetric_speed']) || 0;
			const maxVol = nozzleDia >= 0.6 ? 15 : 11;
			if (oldVol > 0 && oldVol < maxVol) {
				merged['filament_max_volumetric_speed'] = String(maxVol);
			}
		} else if (filType === 'PET' || filType === 'PETG') {
			const oldVol = parseFloat(merged['filament_max_volumetric_speed']) || 0;
			const maxVol = nozzleDia >= 0.6 ? 10 : 8;
			if (oldVol > 0 && oldVol < maxVol) {
				merged['filament_max_volumetric_speed'] = String(maxVol);
			}
		}
	}

	applyMaterialOverrides(merged, settings, 300);

	merged['single_extruder_multi_material'] = '0';
	merged['wipe_tower'] = '0';
	merged['wipe_tower_x'] = '0';
	merged['wipe_tower_y'] = '0';
	merged['wipe_tower_rotation_angle'] = '0';
	merged['ooze_prevention'] = '0';
	merged['extruders_count'] = '1';
	const fillPattern = (settings?.infill || merged['fill_pattern'] || 'gyroid').toLowerCase();
	merged['fill_pattern'] = fillPattern;
	merged['fill_density'] = `${hardnessPlan.basePercent}%`;
	console.log(`  Hardness base fill density: ${hardnessPlan.basePercent}%`);

	let bedCenter = null;
	let bedSize = null;
	const bedShape = merged['bed_shape'];
	if (bedShape) {
		try {
			const points = bedShape.split(',').map((p) => {
				const [x, y] = p.trim().split('x').map(Number);
				return { x, y };
			}).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
			if (points.length >= 2) {
				const xs = points.map((p) => p.x);
				const ys = points.map((p) => p.y);
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

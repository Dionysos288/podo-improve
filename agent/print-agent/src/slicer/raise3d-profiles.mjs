// Keys that are bundle metadata and should not go into the flat config
export const BUNDLE_SKIP_KEYS = new Set([
	'compatible_printers', 'compatible_printers_condition',
	'compatible_prints', 'compatible_prints_condition',
	'inherits', 'print_settings_id', 'filament_settings_id',
	'printer_settings_id', 'printer_variant', 'printer_vendor',
	'default_print_profile', 'default_filament_profile',
	'bed_custom_texture', 'bed_custom_model',
]);

// PrusaSlicer keys that are per-extruder (comma-separated for multi-extruder).
// When forcing single-extruder mode we pick only the active extruder's value.
export const PER_EXTRUDER_KEYS = new Set([
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
 * Pick the best-matching printer, print, and filament profiles from a parsed
 * Raise3D E2 config bundle based on the user's printer settings.
 */
export function selectProfiles(sections, settings) {
	const nozzle = parseFloat(settings?.nozzle) || 0.8;
	const extruder = (settings?.extruder || 'Links').toLowerCase();
	const material = (settings?.material || '').toLowerCase();

	const nozzleStr = nozzle <= 0.5 ? '0.4' : '0.6';

	let head = 'Left head';
	if (extruder === 'rechts' || extruder === 'right') head = 'Right head';

	let printerProfile = sections[`printer:Raise3D E2 ${nozzleStr} - ${head}`];
	if (!printerProfile) {
		const fb = Object.keys(sections).find((k) => k.startsWith('printer:') && k.includes(nozzleStr) && k.includes(head));
		printerProfile = fb ? sections[fb] : {};
		if (!fb) console.warn(`⚠ No printer profile found for nozzle=${nozzleStr} head=${head}`);
	}

	const strategy = (settings?.strategy || '0.20mm').trim();
	const layerKey = strategy.includes('mm') ? strategy : '0.20mm';
	let printProfile = sections[`print:${layerKey} @E2 ${nozzleStr}`];
	if (!printProfile) {
		const fb = Object.keys(sections).find(
			(k) => k.startsWith('print:') && k.includes(layerKey) && k.includes(nozzleStr)
		);
		if (!fb) {
			const fb2 = Object.keys(sections).find(
				(k) => k.startsWith('print:') && k.includes(nozzleStr)
			);
			printProfile = fb2 ? sections[fb2] : {};
		} else {
			printProfile = sections[fb];
		}
	}

	let filType = (settings?.filamentType || '').toUpperCase();
	if (!filType) {
		filType = 'FLEX';
		if (material.includes('pla')) filType = 'PLA';
		else if (material.includes('abs')) filType = 'ABS';
		else if (material.includes('petg') || material.includes('pet')) filType = 'PETG';
		else if (material.includes('pva')) filType = 'PVA';
		else if (material.includes('wood')) filType = 'WOOD';
	}

	const filSuffix = nozzleStr === '0.6' ? ` ${nozzleStr}n` : '';
	let filamentProfile = sections[`filament:${filType} @E2${filSuffix}`];
	if (!filamentProfile) filamentProfile = sections[`filament:${filType} @E2`] || {};

	console.log(`  Profile selection: printer="Raise3D E2 ${nozzleStr} - ${head}" print="${layerKey} @E2 ${nozzleStr}" filament="${filType} @E2${filSuffix}"`);
	return { printerProfile, printProfile, filamentProfile };
}

/**
 * Apply explicit per-material print parameters (from the org material catalog)
 * onto a flat PrusaSlicer config object. Values are clamped to the printer's
 * max nozzle temperature. No-ops for fields the material leaves unset.
 */
export function applyMaterialOverrides(merged, settings, maxNozzleTempC) {
	const nozzleTemp = Number(settings?.materialNozzleTempC);
	if (Number.isFinite(nozzleTemp) && nozzleTemp > 0) {
		const t = Math.min(maxNozzleTempC, Math.round(nozzleTemp));
		merged['temperature'] = String(t);
		merged['first_layer_temperature'] = String(t);
		console.log(`  Material override: nozzle temp → ${t}°C`);
	}
	const bedTemp = Number(settings?.materialBedTempC);
	if (Number.isFinite(bedTemp) && bedTemp >= 0) {
		const t = Math.round(bedTemp);
		merged['bed_temperature'] = String(t);
		merged['first_layer_bed_temperature'] = String(t);
		console.log(`  Material override: bed temp → ${t}°C`);
	}
	const maxSpeed = Number(settings?.materialMaxSpeedMmS);
	if (Number.isFinite(maxSpeed) && maxSpeed > 0) {
		merged['max_print_speed'] = String(Math.round(maxSpeed));
		console.log(`  Material override: max print speed → ${Math.round(maxSpeed)}mm/s`);
	}
}

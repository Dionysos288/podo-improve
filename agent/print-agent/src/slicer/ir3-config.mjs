import fs from 'fs';
import path from 'path';
import { buildHardnessPlan } from './hardness.mjs';

/**
 * IR3 V2 virtual bed profile for PrusaSlicer.
 *
 * The IR3 has a 250×250mm belt surface.  We create a "tall" virtual bed so
 * that PrusaSlicer slices the part using conventional planar layers.  The
 * belt post-processor then rotates the toolpath into IR3 coordinates.
 */
export function generateIR3FlatConfig(settings, outputDir) {
	const nozzle = settings?.nozzle || '0.4';
	const material = (settings?.material || '').toLowerCase();
	const hardnessPlan = buildHardnessPlan(settings);

	let nozzleTemp = 220;
	let bedTemp = 50;
	if (material.includes('tpu') || material.includes('flex')) { nozzleTemp = 230; bedTemp = 40; }
	else if (material.includes('pla')) { nozzleTemp = 210; bedTemp = 50; }
	else if (material.includes('petg')) { nozzleTemp = 240; bedTemp = 70; }
	else if (material.includes('abs')) { nozzleTemp = 250; bedTemp = 100; }

	const explicitNozzle = Number(settings?.materialNozzleTempC);
	if (Number.isFinite(explicitNozzle) && explicitNozzle > 0) {
		nozzleTemp = Math.min(290, Math.round(explicitNozzle));
	}
	const explicitBed = Number(settings?.materialBedTempC);
	if (Number.isFinite(explicitBed) && explicitBed >= 0) {
		bedTemp = Math.min(90, Math.round(explicitBed));
	}

	const bedW = 250;
	const bedD = 250;
	const virtualZ = 500;

	const merged = {
		bed_shape: `0x0,${bedW}x0,${bedW}x${bedD},0x${bedD}`,
		max_print_height: String(virtualZ),

		nozzle_diameter: nozzle,

		max_print_speed: (() => {
			const explicit = Number(settings?.materialMaxSpeedMmS);
			if (Number.isFinite(explicit) && explicit > 0) return String(Math.round(explicit));
			return material.includes('tpu') || material.includes('flex') ? '60' : '150';
		})(),
		max_volumetric_speed: '0',

		layer_height: '0.2',
		first_layer_height: '0.25',

		temperature: String(nozzleTemp),
		first_layer_temperature: String(nozzleTemp),
		bed_temperature: String(bedTemp),
		first_layer_bed_temperature: String(bedTemp),

		retract_length: '1',
		retract_speed: '40',
		deretract_speed: '40',
		retract_lift: '0',
		retract_before_travel: '2',

		extrusion_multiplier: '1',
		filament_diameter: '1.75',

		extruders_count: '1',
		wipe_tower: '0',

		gcode_flavor: 'reprap',

		support_material: '0',

		fill_density: `${hardnessPlan.basePercent}%`,
		fill_pattern: (settings?.infill || 'gyroid').toLowerCase(),

		fan_always_on: '1',
		min_fan_speed: '100',
		max_fan_speed: '100',
		bridge_fan_speed: '100',
	};

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

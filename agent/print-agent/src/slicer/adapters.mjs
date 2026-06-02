import fs from 'fs';
import path from 'path';
import { centerSTLOnBed } from './stl.mjs';
import { applyHardnessPostProcess } from './hardness.mjs';
import { generateFlatConfig } from './raise3d-flat-config.mjs';
import { generateIR3FlatConfig } from './ir3-config.mjs';
import { runPrusaSlicer } from './run-prusaslicer.mjs';
import { transformForIR3, ir3StartGcode, ir3EndGcode } from '../../ir3/transform.mjs';

const IDENTITY_ORIENTATION = { perm: [0, 1, 2], translation: { dx: 0, dy: 0, dz: 0 } };

/** Raise3D E2 (IDEX) adapter — forced single extruder + hardness post-process. */
export function createSlicerAdapter(config, bundleSections) {
	return {
		name: 'prusaslicer',
		printerModel: 'raise3d-e2',
		slice: (stlPath, outputPath, settings) => {
			let orientationMeta = { ...IDENTITY_ORIENTATION };
			const { configPath, bedCenter, bedSize, maxPrintHeight } =
				generateFlatConfig(bundleSections, settings, path.dirname(outputPath));

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

/**
 * IdeaFormer IR3 V2 belt printer adapter.
 *
 * Pipeline: virtual-bed config → auto-orient → PrusaSlicer → belt transform
 * (45° rotation) → inject IR3 start/end G-code.
 */
export function createIR3SlicerAdapter(config) {
	return {
		name: 'prusaslicer-ir3v2',
		printerModel: 'ir3-v2',
		slice: async (stlPath, outputPath, settings) => {
			const outputDir = path.dirname(outputPath);
			let orientationMeta = { ...IDENTITY_ORIENTATION };
			const { configPath, bedCenter, bedSize, maxPrintHeight, nozzleTemp, bedTemp } =
				generateIR3FlatConfig(settings, outputDir);

			if (bedCenter && bedSize) {
				try {
					orientationMeta = centerSTLOnBed(stlPath, stlPath, bedCenter, bedSize, maxPrintHeight) || orientationMeta;
				} catch (err) {
					console.warn(`  ⚠ Failed to auto-orient/center STL for IR3: ${err.message}`);
				}
			}

			const sliceResult = await runPrusaSlicer(
				config.prusaSlicerPath,
				[configPath],
				stlPath,
				outputPath,
				settings,
				true // always ASCII for IR3 (we post-process the text)
			);

			const standardGcodePath =
				sliceResult && typeof sliceResult.outputPath === 'string'
					? sliceResult.outputPath
					: outputPath;
			const hardnessMeta = applyHardnessPostProcess(standardGcodePath, stlPath, settings, orientationMeta);
			console.log(`  Hardness post-process: applied=${hardnessMeta.applied}, scaledMoves=${hardnessMeta.scaledMoves}, base=${hardnessMeta.basePercent}%, reason=${hardnessMeta.reason ?? 'ok'}`);
			const standardGcode = fs.readFileSync(standardGcodePath, 'utf8');

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

			const startGcode = ir3StartGcode({ nozzleTemp, bedTemp, beltNormalOffsetMm });
			const endGcode = ir3EndGcode();
			const finalGcode = startGcode + '\n' + transformedGcode + '\n' + endGcode;

			const ir3OutputPath = standardGcodePath.replace(/\.gcode$/i, '_ir3.gcode');
			fs.writeFileSync(ir3OutputPath, finalGcode, 'utf8');
			console.log(`  IR3 final G-code: ${(finalGcode.length / 1024).toFixed(0)} KB → ${ir3OutputPath}`);

			return { outputPath: ir3OutputPath, stdout: sliceResult?.stdout, stderr: sliceResult?.stderr, args: sliceResult?.args, ir3Stats: stats, hardnessMeta };
		},
	};
}

/** Select the correct slicer adapter based on the job's printerSettings. */
export function selectAdapter(job, { raise3dAdapter, ir3Adapter }) {
	const model = (job.printerSettings?.printerModel || '').toLowerCase();
	if (model === 'ir3-v2') {
		console.log(`  → Using IR3 V2 belt printer adapter`);
		return ir3Adapter;
	}
	if (model && model !== 'raise3d-e2') {
		console.warn(`  ⚠ Unknown printer model "${model}", falling back to Raise3D E2`);
	}
	console.log(`  → Using Raise3D E2 adapter`);
	return raise3dAdapter;
}

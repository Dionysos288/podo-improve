import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Run PrusaSlicer CLI to export G-code from an STL using one or more flat
 * config files. Resolves with the produced output path (handles builds that
 * emit the file next to the input instead of honoring --output).
 */
export function runPrusaSlicer(prusaSlicerPath, configPaths, stlPath, outputPath, settings, disableBinaryGcode = true) {
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

		console.log(`  Running: "${prusaSlicerPath}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
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

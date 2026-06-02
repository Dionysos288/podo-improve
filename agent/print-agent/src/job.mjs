import fs from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { log } from './log.mjs';

/**
 * Process a single slicing job end-to-end. Always reports the outcome back to
 * the server and NEVER throws — a failed job must not stop the polling loop.
 *
 * @returns {Promise<boolean>} true on success, false on failure
 */
export async function processJob(job, adapter, api) {
	log.info(`Processing job ${job.jobId}…`);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podo-agent-'));
	const stlPath = path.join(tempDir, 'input.stl');
	const gcodePath = path.join(tempDir, 'output.gcode');

	try {
		fs.writeFileSync(stlPath, Buffer.from(job.stlData, 'base64'));

		const sliceResult = await adapter.slice(stlPath, gcodePath, job.printerSettings);
		const generatedPath =
			sliceResult && typeof sliceResult.outputPath === 'string'
				? sliceResult.outputPath
				: gcodePath;

		const gcodeBuffer = fs.readFileSync(generatedPath);
		const gzipped = gzipSync(gcodeBuffer);
		const gcodeGzipBase64 = gzipped.toString('base64');
		log.info(`  Gcode: ${(gcodeBuffer.length / 1024).toFixed(0)} KB raw → ${(gzipped.length / 1024).toFixed(0)} KB gzip`);

		await api.completeJob(
			job.jobId,
			gcodeGzipBase64,
			(job.filename || 'insole.stl').replace(/\.stl$/i, '.gcode'),
			{
				slicer: adapter.name,
				note: 'Printer/material/nozzle settings and step3 hardness settings applied during slicing/post-processing.',
				printerSettings: job.printerSettings ?? {},
				hardnessMeta: sliceResult?.hardnessMeta ?? null,
			}
		);

		log.info(`Job ${job.jobId} completed successfully`);
		return true;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error(`Job ${job.jobId} failed:`, message);
		try {
			await api.failJob(job.jobId, message);
		} catch (callbackErr) {
			log.error('Failed to report job failure:', callbackErr.message || callbackErr);
		}
		return false;
	} finally {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
}

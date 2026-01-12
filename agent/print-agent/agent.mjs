#!/usr/bin/env node

/**
 * Podo Improve Print Agent
 *
 * This agent runs on the user's PC and:
 * 1. Fetches its configuration (ideamakerPath) from the server
 * 2. Polls for slicing jobs
 * 3. Runs IdeaMaker locally to slice STL files
 * 4. Uploads the generated Gcode back to the server
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

function runIdeaMaker(ideamakerPath, stlPath, outputPath, settings) {
	return new Promise((resolve, reject) => {
		// Example IdeaMaker CLI call (adjust based on actual CLI docs)
		const args = [
			'--slice',
			'--input',
			stlPath,
			'--output',
			outputPath,
			// Add printer/material settings here
		];

		const ideamaker = spawn(ideamakerPath, args);

		let stderr = '';

		ideamaker.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		ideamaker.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`IdeaMaker exited with code ${code}: ${stderr}`));
				return;
			}
			resolve(outputPath);
		});

		ideamaker.on('error', (err) => {
			reject(new Error(`Failed to start IdeaMaker: ${err.message}`));
		});
	});
}

async function processJob(job, ideamakerPath) {
	console.log(`Processing job ${job.jobId}...`);

	// Create temp directory
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podo-agent-'));
	const stlPath = path.join(tempDir, 'input.stl');
	const gcodePath = path.join(tempDir, 'output.gcode');

	try {
		// Write STL file
		const stlBuffer = Buffer.from(job.stlData, 'base64');
		fs.writeFileSync(stlPath, stlBuffer);

		// Run IdeaMaker
		await runIdeaMaker(ideamakerPath, stlPath, gcodePath, job.printerSettings);

		// Read generated Gcode
		const gcodeBuffer = fs.readFileSync(gcodePath);
		const gcodeBase64 = gcodeBuffer.toString('base64');

		// TODO: Upload Gcode back to server
		// await fetch(`${baseUrl}/api/agent/jobs/${job.jobId}/complete`, {
		//   method: 'POST',
		//   headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		//   body: JSON.stringify({ gcodeData: gcodeBase64 })
		// });

		console.log(`Job ${job.jobId} completed successfully`);
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
		console.log(
			`✓ Config loaded (ideamakerPath: ${config.ideamakerPath || 'NOT SET'})`
		);
	} catch (err) {
		console.error('Failed to fetch config:', err.message);
		process.exit(1);
	}

	if (!config.ideamakerPath) {
		console.error(
			'ERROR: ideamakerPath is not configured in Settings → Basis → Lokale Print Agent'
		);
		console.error(
			'Please set the IdeaMaker path in the web app and try again.'
		);
		process.exit(1);
	}

	if (!fs.existsSync(config.ideamakerPath)) {
		console.error(`ERROR: IdeaMaker not found at: ${config.ideamakerPath}`);
		console.error(
			'Please check the path in Settings → Basis → Lokale Print Agent'
		);
		process.exit(1);
	}

	console.log('✓ IdeaMaker found');
	console.log('\nAgent is ready. Polling for jobs...\n');

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
				await processJob(job, config.ideamakerPath);
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

import fs from 'fs';
import { spawn } from 'child_process';
import { loadConfig, autodetectPrusaSlicer } from './config.mjs';
import { createApi } from './api.mjs';
import { createTray } from './tray.mjs';
import { log } from './log.mjs';
import { dataDir, lockPath } from './paths.mjs';
import { AGENT_VERSION } from './version.mjs';
import { ensureDefaultE2Bundle, parseConfigBundle } from './slicer/bundle.mjs';
import { createSlicerAdapter, createIR3SlicerAdapter, selectAdapter } from './slicer/adapters.mjs';
import { processJob } from './job.mjs';
import { maybeSelfUpdate } from './updater.mjs';

const PING_MS = 30_000;
const POLL_MS = 5_000;
const UPDATE_CHECK_MS = 30 * 60_000;
const SLICER_RESCAN_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err.code === 'EPERM';
	}
}

/** Single-instance guard. Returns a release fn, or null if another agent runs. */
function acquireLock() {
	const file = lockPath();
	try {
		fs.mkdirSync(dataDir(), { recursive: true });
	} catch {
		// ignore
	}
	try {
		const fd = fs.openSync(file, 'wx');
		fs.writeFileSync(fd, String(process.pid));
		fs.closeSync(fd);
	} catch (err) {
		if (err.code !== 'EEXIST') return null;
		let pid = 0;
		try {
			pid = parseInt(fs.readFileSync(file, 'utf8'), 10);
		} catch {
			pid = 0;
		}
		if (pid && isAlive(pid)) return null;
		try {
			fs.writeFileSync(file, String(process.pid));
		} catch {
			return null;
		}
	}
	return () => {
		try {
			fs.rmSync(file, { force: true });
		} catch {
			// ignore
		}
	};
}

function openInShell(target) {
	try {
		if (process.platform === 'win32') {
			spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
		} else if (process.platform === 'darwin') {
			spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
		} else {
			spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
		}
	} catch (err) {
		log.warn('Failed to open', target, err.message);
	}
}

export async function runAgent(overrideConfig) {
	const config = overrideConfig ?? loadConfig();
	if (!config) {
		log.error('Agent is not installed (no config). Run: podo-print-agent install --url <url> --token <token>');
		process.exit(1);
	}

	const release = acquireLock();
	if (!release) {
		log.warn('Another Podo Print Agent instance is already running. Exiting.');
		process.exit(0);
	}

	const api = createApi(config);
	let slicerPath = autodetectPrusaSlicer(config.prusaSlicerPath);
	let lastSlicerRescan = Date.now();
	let running = true;
	let pingTimer = null;
	let updateTimer = null;
	let tray = { setStatus() {}, destroy() {} };

	function shutdown(code) {
		if (!running) return;
		running = false;
		if (pingTimer) clearInterval(pingTimer);
		if (updateTimer) clearInterval(updateTimer);
		tray.destroy();
		release();
		log.info('Agent stopped.');
		process.exit(code ?? 0);
	}

	tray = await createTray({
		onOpenLog: () => openInShell(log.file()),
		onQuit: () => shutdown(0),
	});

	function statusBody() {
		return {
			version: AGENT_VERSION,
			slicerOk: Boolean(slicerPath),
			slicerPath: slicerPath || null,
			platform: process.platform,
		};
	}

	// Independent heartbeat — runs regardless of slicing so the server never
	// flips us "offline" mid-job.
	pingTimer = setInterval(async () => {
		try {
			await api.ping(statusBody());
		} catch (err) {
			log.warn('Ping failed:', err.message);
		}
	}, PING_MS);

	updateTimer = setInterval(() => {
		maybeSelfUpdate(api, tray).catch((err) => log.warn('Update check failed:', err.message));
	}, UPDATE_CHECK_MS);

	process.on('SIGINT', () => shutdown(0));
	process.on('SIGTERM', () => shutdown(0));

	log.info(`Podo Print Agent v${AGENT_VERSION} starting → ${api.baseUrl}`);
	try {
		await api.ping(statusBody());
		log.info('Connected to server.');
	} catch (err) {
		log.warn('Initial connection failed (will keep retrying):', err.message);
	}

	// Load the Raise3D E2 bundle once (non-fatal; IR3 jobs do not need it).
	let bundleSections = {};
	try {
		const bundlePath = await ensureDefaultE2Bundle();
		bundleSections = parseConfigBundle(fs.readFileSync(bundlePath, 'utf8'));
		log.info(`Raise3D E2 bundle loaded (${Object.keys(bundleSections).length} profiles).`);
	} catch (err) {
		log.warn('Could not load Raise3D E2 bundle (IR3 still works):', err.message);
	}

	let adapters = buildAdapters();
	function buildAdapters() {
		const adapterConfig = { prusaSlicerPath: slicerPath, disableBinaryGcode: true };
		return {
			raise3dAdapter: createSlicerAdapter(adapterConfig, bundleSections),
			ir3Adapter: createIR3SlicerAdapter(adapterConfig),
		};
	}

	tray.setStatus(slicerPath ? 'connected' : 'error', slicerPath ? undefined : 'PrusaSlicer niet gevonden');
	maybeSelfUpdate(api, tray).catch(() => {});

	// Main loop — never exits on a job error.
	while (running) {
		if (!slicerPath) {
			if (Date.now() - lastSlicerRescan >= SLICER_RESCAN_MS) {
				lastSlicerRescan = Date.now();
				slicerPath = autodetectPrusaSlicer(config.prusaSlicerPath);
				if (slicerPath) {
					adapters = buildAdapters();
					tray.setStatus('connected');
					log.info('PrusaSlicer detected at', slicerPath);
				}
			}
			tray.setStatus('error', 'PrusaSlicer niet gevonden');
			await sleep(POLL_MS);
			continue;
		}

		try {
			const { job } = await api.getNextJob();
			if (!job) {
				tray.setStatus('connected');
				await sleep(POLL_MS);
				continue;
			}
			tray.setStatus('slicing');
			const adapter = selectAdapter(job, adapters);
			await processJob(job, adapter, api);
			tray.setStatus('connected');
		} catch (err) {
			log.error('Job loop error:', err.message);
			tray.setStatus('error', err.message);
			await sleep(POLL_MS);
		}
	}
}

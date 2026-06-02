import fs from 'fs';
import path from 'path';
import { configPath, dataDir } from './paths.mjs';

/**
 * @typedef {Object} AgentConfig
 * @property {string} url    Web app origin (e.g. https://app.example.com)
 * @property {string} token  Per-user agent token
 * @property {string} [prusaSlicerPath]  Optional explicit slicer path override
 */

/** Load config.json from the data dir. Returns null when not yet installed. */
export function loadConfig() {
	try {
		const raw = fs.readFileSync(configPath(), 'utf8');
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed.url === 'string' && typeof parsed.token === 'string') {
			return parsed;
		}
	} catch {
		// not installed / unreadable
	}
	return null;
}

/** Persist config.json (creates the data dir). */
export function saveConfig(config) {
	fs.mkdirSync(dataDir(), { recursive: true });
	fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
	return config;
}

const WINDOWS_CANDIDATES = [
	'C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe',
	'C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer.exe',
	'C:/Program Files (x86)/Prusa3D/PrusaSlicer/prusa-slicer-console.exe',
];

function globProgramFilesVersions() {
	// Some installers nest the binary under a versioned folder.
	const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean);
	const found = [];
	for (const root of roots) {
		const base = path.join(root, 'Prusa3D');
		let entries = [];
		try {
			entries = fs.readdirSync(base, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			for (const exe of ['prusa-slicer-console.exe', 'prusa-slicer.exe']) {
				found.push(path.join(base, entry.name, exe));
			}
		}
	}
	return found;
}

const POSIX_CANDIDATES = [
	'/usr/bin/prusa-slicer',
	'/usr/local/bin/prusa-slicer',
	'/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
	'/Applications/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
];

/**
 * Find a PrusaSlicer executable on this machine. Prefers an explicit override,
 * then well-known install locations. Returns null when nothing is found.
 */
export function autodetectPrusaSlicer(explicitPath) {
	if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;

	const candidates =
		process.platform === 'win32'
			? [...WINDOWS_CANDIDATES, ...globProgramFilesVersions()]
			: POSIX_CANDIDATES;

	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) return candidate;
		} catch {
			// ignore
		}
	}
	return null;
}

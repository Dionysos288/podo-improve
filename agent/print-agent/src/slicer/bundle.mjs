import fs from 'fs';
import path from 'path';
import os from 'os';

const DEFAULT_E2_BUNDLE_URL =
	'https://raw.githubusercontent.com/Allram/Raise3D-E2/main/Raise3D%20-%20E2.ini';

/**
 * Download (once) and cache the community Raise3D E2 PrusaSlicer config bundle.
 * Returns the local path to the cached bundle.
 */
export async function ensureDefaultE2Bundle() {
	const profileDir = path.join(os.homedir(), '.podo-improve', 'profiles');
	const bundlePath = path.join(profileDir, 'Raise3D-E2.bundle.ini');

	if (fs.existsSync(bundlePath)) {
		return bundlePath;
	}

	fs.mkdirSync(profileDir, { recursive: true });
	const res = await fetch(DEFAULT_E2_BUNDLE_URL);
	if (!res.ok) {
		throw new Error(
			`Failed to download default E2 config bundle (${res.status}) from ${DEFAULT_E2_BUNDLE_URL}`
		);
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
export function parseConfigBundle(text) {
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
				sections[currentKey][line.slice(0, eqIdx).trim()] = line
					.slice(eqIdx + 1)
					.trim();
			}
		}
	}
	return sections;
}

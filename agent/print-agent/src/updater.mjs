import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { log } from './log.mjs';
import { AGENT_VERSION } from './version.mjs';
import { installedExePath, isPackaged } from './paths.mjs';

/** Compare dotted versions. Returns true when `candidate` is newer than `base`. */
export function isNewer(candidate, base) {
	const toParts = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
	const a = toParts(candidate);
	const b = toParts(base);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const da = a[i] ?? 0;
		const db = b[i] ?? 0;
		if (da !== db) return da > db;
	}
	return false;
}

async function downloadTo(url, dest) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Download failed (${res.status}) from ${url}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length < 1024) throw new Error(`Downloaded agent is suspiciously small (${buf.length} bytes)`);
	fs.writeFileSync(dest, buf);
	return buf;
}

function verifySha256(buf, expected) {
	if (!expected) return true;
	const actual = crypto.createHash('sha256').update(buf).digest('hex');
	return actual.toLowerCase() === String(expected).toLowerCase();
}

/**
 * Spawn a detached helper that waits for this process to exit, swaps the new
 * exe over the running one (retrying while it is locked), then relaunches it.
 */
function swapAndRelaunch(newExe, targetExe) {
	if (process.platform !== 'win32') {
		// On POSIX we can overwrite directly; rely on the supervisor to relaunch.
		fs.renameSync(newExe, targetExe);
		fs.chmodSync(targetExe, 0o755);
		return;
	}
	const cmdPath = path.join(os.tmpdir(), `podo-agent-update-${Date.now()}.cmd`);
	const script = [
		'@echo off',
		'timeout /t 2 /nobreak >nul',
		':retry',
		`move /y "${newExe}" "${targetExe}" >nul 2>&1`,
		'if errorlevel 1 (',
		'  timeout /t 2 /nobreak >nul',
		'  goto retry',
		')',
		`start "" "${targetExe}"`,
		'del "%~f0"',
		'',
	].join('\r\n');
	fs.writeFileSync(cmdPath, script, 'utf8');
	spawn('cmd', ['/c', cmdPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/**
 * Check for a newer agent and, when packaged, download + relaunch it.
 * Best-effort: any failure is logged and swallowed.
 *
 * @returns {Promise<boolean>} true when an update was started (process will exit)
 */
export async function maybeSelfUpdate(api, tray) {
	let latest;
	try {
		latest = await api.getLatestVersion();
	} catch (err) {
		log.warn('Version check failed:', err.message);
		return false;
	}
	if (!latest?.version || !isNewer(latest.version, AGENT_VERSION)) return false;

	log.info(`Update available: v${latest.version} (current v${AGENT_VERSION}).`);
	if (!isPackaged()) {
		log.info('Running unpackaged (dev) — skipping self-update.');
		return false;
	}
	if (!latest.url) {
		log.warn('Update advertised without a download URL — skipping.');
		return false;
	}

	try {
		tray?.setStatus('update');
		const target = installedExePath();
		const tmp = `${target}.new`;
		const buf = await downloadTo(latest.url, tmp);
		if (!verifySha256(buf, latest.sha256)) {
			fs.rmSync(tmp, { force: true });
			throw new Error('Checksum mismatch on downloaded agent');
		}
		log.info(`Downloaded agent v${latest.version}; swapping and relaunching…`);
		swapAndRelaunch(tmp, target);
		setTimeout(() => process.exit(0), 500);
		return true;
	} catch (err) {
		log.warn('Self-update failed:', err.message);
		return false;
	}
}

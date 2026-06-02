import path from 'path';
import os from 'os';
import process from 'process';

export const APP_DIR_NAME = 'PodoPrintAgent';
export const TASK_NAME = 'Podo Improve Print Agent';

/** Base data dir: %LOCALAPPDATA%\PodoPrintAgent on Windows, ~/.podo-print-agent elsewhere. */
export function dataDir() {
	const base =
		process.platform === 'win32'
			? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
			: path.join(os.homedir(), '.local', 'share');
	return path.join(base, APP_DIR_NAME);
}

export function configPath() {
	return path.join(dataDir(), 'config.json');
}

export function logPath() {
	return path.join(dataDir(), 'agent.log');
}

export function lockPath() {
	return path.join(dataDir(), 'agent.lock');
}

/** Path the installed agent executable lives at after install. */
export function installedExePath() {
	const ext = process.platform === 'win32' ? '.exe' : '';
	return path.join(dataDir(), `podo-print-agent${ext}`);
}

/** Absolute path of the currently running executable (pkg) or node script. */
export function currentExePath() {
	// When packaged with pkg/SEA, process.execPath is the bundled exe.
	return process.execPath;
}

/** True when running as a packaged single executable rather than via `node`. */
export function isPackaged() {
	return typeof process.pkg !== 'undefined' || process.env.PODO_AGENT_PACKAGED === '1';
}

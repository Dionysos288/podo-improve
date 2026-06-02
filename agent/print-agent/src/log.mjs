import fs from 'fs';
import path from 'path';
import { logPath, dataDir } from './paths.mjs';

const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2 MB, then rotate to .1

let stream = null;

function ensureStream() {
	if (stream) return stream;
	try {
		fs.mkdirSync(dataDir(), { recursive: true });
		const file = logPath();
		try {
			const stat = fs.statSync(file);
			if (stat.size > MAX_LOG_BYTES) {
				fs.renameSync(file, `${file}.1`);
			}
		} catch {
			// no existing log
		}
		stream = fs.createWriteStream(file, { flags: 'a' });
	} catch {
		stream = null; // logging is best-effort; never block the agent
	}
	return stream;
}

function write(level, parts) {
	const line = `[${new Date().toISOString()}] ${level} ${parts
		.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'object' ? safeJson(p) : String(p)))
		.join(' ')}`;
	const out = level === 'ERROR' ? console.error : console.log;
	out(line);
	try {
		ensureStream()?.write(line + '\n');
	} catch {
		// ignore
	}
}

function safeJson(value) {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export const log = {
	info: (...parts) => write('INFO', parts),
	warn: (...parts) => write('WARN', parts),
	error: (...parts) => write('ERROR', parts),
	file: () => logPath(),
};

#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const exe = path.join(process.cwd(), 'dist', 'podo-print-agent.exe');
if (!fs.existsSync(exe)) {
	console.error('Build first: dist/podo-print-agent.exe not found. Run `npm run build`.');
	process.exit(1);
}
const buf = fs.readFileSync(exe);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
console.log(`sha256: ${sha256}`);
console.log(`bytes:  ${buf.length}`);
console.log('\nSet these on the web app:');
console.log(`  AGENT_VERSION   = (matches src/version.mjs)`);
console.log(`  AGENT_EXE_URL   = <download url for this exe>`);
console.log(`  AGENT_EXE_SHA256= ${sha256}`);

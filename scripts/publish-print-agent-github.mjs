#!/usr/bin/env node
/**
 * Publish podo-print-agent.exe to GitHub Releases (for files > Supabase 50MB limit).
 *
 * Requires: gh CLI logged in, exe built at agent/print-agent/dist/podo-print-agent.exe
 *
 * Usage:
 *   node scripts/publish-print-agent-github.mjs
 *   node scripts/publish-print-agent-github.mjs --tag agent-v2.0.0
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = path.join(ROOT, 'agent', 'print-agent');
const EXE_PATH = path.join(AGENT_DIR, 'dist', 'podo-print-agent.exe');

function readVersion() {
	const text = fs.readFileSync(path.join(AGENT_DIR, 'src', 'version.mjs'), 'utf8');
	const m = text.match(/AGENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
	if (!m) throw new Error('Could not read AGENT_VERSION');
	return m[1];
}

function getRemoteRepo() {
	const url = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
	const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/i);
	if (!m) throw new Error(`Could not parse GitHub repo from origin: ${url}`);
	return m[1];
}

function main() {
	const version = readVersion();
	const tag = process.argv.includes('--tag')
		? process.argv[process.argv.indexOf('--tag') + 1]
		: `agent-v${version}`;

	if (!fs.existsSync(EXE_PATH)) {
		console.error('Missing exe. Run: npm run agent:build');
		process.exit(1);
	}

	const buf = fs.readFileSync(EXE_PATH);
	const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
	const repo = getRemoteRepo();

	console.log(`Creating release ${tag} on ${repo}…`);
	try {
		execSync(
			`gh release create "${tag}" "${EXE_PATH}" --repo "${repo}" --title "Podo Print Agent ${version}" --notes "Windows Print Agent v${version}. Download podo-print-agent.exe and run the setup from Settings, or use the web app installer."`,
			{ cwd: ROOT, stdio: 'inherit' },
		);
	} catch {
		console.log('Release may already exist — uploading asset with gh release upload…');
		execSync(
			`gh release upload "${tag}" "${EXE_PATH}" --repo "${repo}" --clobber`,
			{ cwd: ROOT, stdio: 'inherit' },
		);
	}

	const url = `https://github.com/${repo}/releases/download/${tag}/podo-print-agent.exe`;
	const manifest = {
		version,
		tag,
		url,
		sha256,
		uploadedAt: new Date().toISOString(),
		bytes: buf.length,
		host: 'github-releases',
	};
	const manifestPath = path.join(AGENT_DIR, 'release.manifest.json');
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

	console.log('\n--- GitHub Release OK ---\n');
	console.log('Download URL:', url);
	console.log('sha256:      ', sha256);
	console.log('\nVercel environment variables:\n');
	console.log(`AGENT_VERSION=${version}`);
	console.log(`AGENT_EXE_URL=${url}`);
	console.log(`AGENT_EXE_SHA256=${sha256}`);
	console.log(`\nManifest: ${manifestPath}`);
}

main();

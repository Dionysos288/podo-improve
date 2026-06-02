#!/usr/bin/env node
/**
 * Build (if missing) and upload podo-print-agent.exe to Supabase Storage.
 * Note: Supabase free/pro plans often cap uploads at 50MB; the built exe is ~60MB.
 * Use `npm run agent:publish` (GitHub Releases) instead when upload fails.
 *
 * Requires in .env (repo root):
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SUPABASE_URL  (or DATABASE_URL pointing at Supabase Postgres)
 *
 * Usage:
 *   node scripts/upload-print-agent.mjs
 *   node scripts/upload-print-agent.mjs --skip-build
 *
 * Prints AGENT_* values to paste into Vercel Environment Variables.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = path.join(ROOT, 'agent', 'print-agent');
const EXE_PATH = path.join(AGENT_DIR, 'dist', 'podo-print-agent.exe');
/** Prefer dedicated bucket; falls back to public `scans` if bucket cannot be created. */
const PREFERRED_BUCKET = 'agent-releases';
const FALLBACK_BUCKET = 'scans';
const FALLBACK_PREFIX = '_system/agent-releases';
const VERSION = readVersion();

loadEnv({ path: path.join(ROOT, '.env') });

function readVersion() {
	const text = fs.readFileSync(path.join(AGENT_DIR, 'src', 'version.mjs'), 'utf8');
	const m = text.match(/AGENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
	if (!m) throw new Error('Could not read AGENT_VERSION from src/version.mjs');
	return m[1];
}

function deriveSupabaseUrlFromDatabaseUrl(databaseUrl) {
	try {
		const parsed = new URL(databaseUrl.replace(/^postgresql:/i, 'postgres:'));
		const userMatch = parsed.username.match(/^postgres\.([a-z0-9]+)$/i);
		if (userMatch) return `https://${userMatch[1]}.supabase.co`;
		const hostMatch = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
		if (hostMatch) return `https://${hostMatch[1]}.supabase.co`;
	} catch {
		return null;
	}
	return null;
}

function resolveSupabaseUrl() {
	const explicit = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
	if (explicit) return explicit;
	const derived = process.env.DATABASE_URL
		? deriveSupabaseUrlFromDatabaseUrl(process.env.DATABASE_URL)
		: null;
	if (derived) return derived;
	throw new Error('Set NEXT_PUBLIC_SUPABASE_URL or a Supabase DATABASE_URL in .env');
}

function resolveServiceKey() {
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in .env');
	return key;
}

async function resolveBucket(supabase) {
	const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
	if (listErr) throw new Error(`listBuckets: ${listErr.message}`);
	if (buckets?.some((b) => b.name === PREFERRED_BUCKET)) {
		return { bucket: PREFERRED_BUCKET, pathPrefix: '' };
	}

	const { error: createErr } = await supabase.storage.createBucket(PREFERRED_BUCKET, {
		public: true,
	});
	if (!createErr) {
		console.log(`Created public bucket "${PREFERRED_BUCKET}"`);
		return { bucket: PREFERRED_BUCKET, pathPrefix: '' };
	}

	console.warn(
		`Could not create "${PREFERRED_BUCKET}" (${createErr.message}); using public "${FALLBACK_BUCKET}" bucket.`,
	);
	return { bucket: FALLBACK_BUCKET, pathPrefix: FALLBACK_PREFIX };
}

async function maybeBuild() {
	if (process.argv.includes('--skip-build') && fs.existsSync(EXE_PATH)) return;
	console.log('Building agent (npm run build)…');
	const { execSync } = await import('child_process');
	execSync('npm run build', { cwd: AGENT_DIR, stdio: 'inherit' });
	if (!fs.existsSync(EXE_PATH)) {
		throw new Error(`Build finished but ${EXE_PATH} is missing`);
	}
}

async function main() {
	await maybeBuild();

	const buf = fs.readFileSync(EXE_PATH);
	const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
	const supabase = createClient(resolveSupabaseUrl(), resolveServiceKey(), {
		auth: { persistSession: false },
	});

	const { bucket, pathPrefix } = await resolveBucket(supabase);
	const objectPath = pathPrefix
		? `${pathPrefix}/v${VERSION}/podo-print-agent.exe`
		: `v${VERSION}/podo-print-agent.exe`;

	console.log(`Uploading ${(buf.length / 1024 / 1024).toFixed(1)} MB → ${bucket}/${objectPath}…`);
	const { error: uploadErr } = await supabase.storage
		.from(bucket)
		.upload(objectPath, buf, {
			contentType: 'application/octet-stream',
			upsert: true,
		});
	if (uploadErr) throw new Error(`upload: ${uploadErr.message}`);

	const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(objectPath);
	const publicUrl = urlData.publicUrl;

	const manifest = {
		version: VERSION,
		url: publicUrl,
		sha256,
		uploadedAt: new Date().toISOString(),
		bytes: buf.length,
	};
	const manifestPath = path.join(AGENT_DIR, 'release.manifest.json');
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

	console.log('\n--- Upload OK ---\n');
	console.log('Public URL:', publicUrl);
	console.log('sha256:    ', sha256);
	console.log('\nAdd these to Vercel → Project → Settings → Environment Variables:\n');
	console.log(`AGENT_VERSION=${VERSION}`);
	console.log(`AGENT_EXE_URL=${publicUrl}`);
	console.log(`AGENT_EXE_SHA256=${sha256}`);
	console.log(`\nManifest written: ${manifestPath}`);
}

main().catch((err) => {
	console.error(err.message || err);
	process.exit(1);
});

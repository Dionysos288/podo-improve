import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase Storage API URL (https://<project-ref>.supabase.co).
 * Not the same as DATABASE_URL, which is only the Postgres connection for Prisma.
 */
function deriveSupabaseUrlFromDatabaseUrl(databaseUrl: string): string | null {
	try {
		const parsed = new URL(databaseUrl.replace(/^postgresql:/i, 'postgres:'));
		const userMatch = parsed.username.match(/^postgres\.([a-z0-9]+)$/i);
		if (userMatch) {
			return `https://${userMatch[1]}.supabase.co`;
		}
		const hostMatch = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
		if (hostMatch) {
			return `https://${hostMatch[1]}.supabase.co`;
		}
	} catch {
		return null;
	}
	return null;
}

function resolveSupabaseUrl(): string {
	const explicit = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
	if (explicit) return explicit;

	const derived = process.env.DATABASE_URL
		? deriveSupabaseUrlFromDatabaseUrl(process.env.DATABASE_URL)
		: null;
	if (derived) return derived;

	throw new Error(
		'Set NEXT_PUBLIC_SUPABASE_URL (https://<project-ref>.supabase.co) for Storage uploads. ' +
			'DATABASE_URL is the Postgres connection for Prisma only, not the Storage API.',
	);
}

function resolveSupabaseServiceKey(): string {
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (key) return key;
	throw new Error(
		'SUPABASE_SERVICE_ROLE_KEY is required for STL/scan uploads to Supabase Storage.',
	);
}

let client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
	if (!client) {
		client = createClient(resolveSupabaseUrl(), resolveSupabaseServiceKey(), {
			auth: { persistSession: false },
		});
	}
	return client;
}

/**
 * Upload an STL (or any binary) file to a Supabase Storage bucket.
 * Returns the public URL.
 */
export async function uploadFile(
	bucket: string,
	path: string,
	file: Buffer | ArrayBuffer | Uint8Array,
	contentType = 'application/octet-stream'
): Promise<string> {
	const supabase = getSupabase();
	const { error } = await supabase.storage
		.from(bucket)
		.upload(path, file, {
			contentType,
			upsert: true,
		});

	if (error) {
		throw new Error(`Supabase upload failed: ${error.message}`);
	}

	const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);

	return urlData.publicUrl;
}

/**
 * Delete a file from a Supabase Storage bucket.
 */
export async function deleteFile(bucket: string, path: string): Promise<void> {
	const { error } = await getSupabase().storage.from(bucket).remove([path]);
	if (error) {
		throw new Error(`Supabase delete failed: ${error.message}`);
	}
}

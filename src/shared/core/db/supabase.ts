import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Server-side Supabase client using the service-role key.
 * Only use on the server (Server Actions, Route Handlers).
 */
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
	auth: { persistSession: false },
});

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
	const { error } = await supabase.storage
		.from(bucket)
		.upload(path, file, {
			contentType,
			upsert: true,
		});

	if (error) {
		throw new Error(`Supabase upload failed: ${error.message}`);
	}

	const { data: urlData } = supabase.storage
		.from(bucket)
		.getPublicUrl(path);

	return urlData.publicUrl;
}

/**
 * Delete a file from a Supabase Storage bucket.
 */
export async function deleteFile(bucket: string, path: string): Promise<void> {
	const { error } = await supabase.storage.from(bucket).remove([path]);
	if (error) {
		throw new Error(`Supabase delete failed: ${error.message}`);
	}
}

const DEFAULT_APP_URL = 'http://localhost:3000';

/** Normalize env URLs like `podo-improve.vercel.app` → `https://podo-improve.vercel.app`. */
export function resolveAppUrl(
	value: string | undefined,
	fallback = DEFAULT_APP_URL,
): string {
	const raw = value?.trim();
	if (!raw) return fallback;

	const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

	try {
		return new URL(withProtocol).origin;
	} catch {
		return fallback;
	}
}

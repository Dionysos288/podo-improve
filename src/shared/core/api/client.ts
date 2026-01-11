/**
 * API Client utilities
 * Centralized fetch wrapper for API calls
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export class ApiError extends Error {
	constructor(
		public status: number,
		public message: string,
		public details?: unknown
	) {
		super(message);
		this.name = 'ApiError';
	}
}

interface FetchOptions extends RequestInit {
	params?: Record<string, string | number | boolean>;
}

export async function apiFetch<T>(
	endpoint: string,
	options: FetchOptions = {}
): Promise<T> {
	const { params, ...fetchOptions } = options;

	// Build URL with query params
	const url = new URL(endpoint, API_BASE_URL || window.location.origin);
	if (params) {
		Object.entries(params).forEach(([key, value]) => {
			url.searchParams.append(key, String(value));
		});
	}

	// Set default headers
	const headers = new Headers(fetchOptions.headers);
	if (!headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}

	try {
		const response = await fetch(url.toString(), {
			...fetchOptions,
			headers,
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new ApiError(
				response.status,
				errorData.message || response.statusText,
				errorData
			);
		}

		return response.json();
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		throw new ApiError(500, 'Network error', error);
	}
}

// Convenience methods
export const api = {
	get: <T>(endpoint: string, options?: FetchOptions) =>
		apiFetch<T>(endpoint, { ...options, method: 'GET' }),
	post: <T>(endpoint: string, data?: unknown, options?: FetchOptions) =>
		apiFetch<T>(endpoint, {
			...options,
			method: 'POST',
			body: JSON.stringify(data),
		}),
	put: <T>(endpoint: string, data?: unknown, options?: FetchOptions) =>
		apiFetch<T>(endpoint, {
			...options,
			method: 'PUT',
			body: JSON.stringify(data),
		}),
	delete: <T>(endpoint: string, options?: FetchOptions) =>
		apiFetch<T>(endpoint, { ...options, method: 'DELETE' }),
};


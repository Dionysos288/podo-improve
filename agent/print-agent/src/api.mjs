/**
 * Server client for the Podo Improve Print Agent.
 * All calls are authenticated with the per-user bearer token.
 */
export function createApi({ url, token }) {
	const baseUrl = url.replace(/\/$/, '');
	const authHeaders = { authorization: `Bearer ${token}` };

	async function jsonOrThrow(res, label) {
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`${label} (${res.status}): ${text}`);
		}
		return res.json();
	}

	return {
		baseUrl,

		/** Heartbeat + report agent status. Non-fatal: caller decides. */
		async ping(status = {}) {
			const res = await fetch(`${baseUrl}/api/agent/ping`, {
				method: 'POST',
				headers: { ...authHeaders, 'content-type': 'application/json' },
				body: JSON.stringify(status),
			});
			return jsonOrThrow(res, 'Ping failed');
		},

		async fetchConfig() {
			const res = await fetch(`${baseUrl}/api/agent/config`, { headers: authHeaders });
			return jsonOrThrow(res, 'Failed to fetch config');
		},

		/** Returns { job } where job is null when nothing is queued. */
		async getNextJob() {
			const res = await fetch(`${baseUrl}/api/agent/jobs/next`, { headers: authHeaders });
			return jsonOrThrow(res, 'Failed to get job');
		},

		async completeJob(jobId, gcodeGzipBase64, filename, slicerMeta) {
			const res = await fetch(`${baseUrl}/api/agent/jobs/${jobId}/complete`, {
				method: 'POST',
				headers: { ...authHeaders, 'content-type': 'application/json' },
				body: JSON.stringify({ gcodeGzipBase64, filename, slicerMeta }),
			});
			await jsonOrThrow(res, 'Complete callback failed');
		},

		async failJob(jobId, errorMessage) {
			const res = await fetch(`${baseUrl}/api/agent/jobs/${jobId}/fail`, {
				method: 'POST',
				headers: { ...authHeaders, 'content-type': 'application/json' },
				body: JSON.stringify({ errorMessage: String(errorMessage || 'Unknown slicing error') }),
			});
			await jsonOrThrow(res, 'Fail callback failed');
		},

		/** Latest available agent version: { version, url, sha256 }. */
		async getLatestVersion() {
			const res = await fetch(`${baseUrl}/api/agent/version`, { headers: authHeaders });
			return jsonOrThrow(res, 'Failed to fetch version');
		},
	};
}

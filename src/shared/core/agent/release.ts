/**
 * Print Agent release metadata + status helpers, shared across agent routes.
 *
 * AGENT_VERSION must match `agent/print-agent/src/version.mjs`. Hosting of the
 * built exe is configured via env so the binary can live on GitHub Releases,
 * Vercel Blob, or any static host without redeploying the app.
 */
export const AGENT_VERSION = process.env.AGENT_VERSION || '2.0.1';
export const AGENT_EXE_URL = process.env.AGENT_EXE_URL || '';
export const AGENT_EXE_SHA256 = process.env.AGENT_EXE_SHA256 || '';

/** Heartbeat freshness window. Agent pings every 30s; allow 3 missed pings. */
const ONLINE_WINDOW_MS = 90_000;

export function isAgentOnline(lastSeenAt?: string | null): boolean {
	if (!lastSeenAt) return false;
	const ms = Date.parse(lastSeenAt);
	return Number.isFinite(ms) && Date.now() - ms <= ONLINE_WINDOW_MS;
}

/** True when the reported agent version is older than the released version. */
export function isUpdateAvailable(agentVersion?: string | null): boolean {
	if (!agentVersion) return false;
	const toParts = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
	const current = toParts(agentVersion);
	const latest = toParts(AGENT_VERSION);
	for (let i = 0; i < Math.max(current.length, latest.length); i++) {
		const a = current[i] ?? 0;
		const b = latest[i] ?? 0;
		if (a !== b) return a < b;
	}
	return false;
}

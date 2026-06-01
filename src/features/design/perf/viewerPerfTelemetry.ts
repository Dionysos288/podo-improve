/**
 * Dev-only metrics for geometry rebuilds (?perf=1 overlay).
 * Lightweight module — no deps on THREE or R3F.
 */

export type ViewerPerfSnapshot = {
	lastFinalRebuildMs: number | null;
	lastFinalRebuildVertices: number | null;
	lastOverlayRebuildMs: number | null;
	lastFinalRebuildAt: number | null;
	lastOverlayRebuildAt: number | null;
};

let snapshot: ViewerPerfSnapshot = {
	lastFinalRebuildMs: null,
	lastFinalRebuildVertices: null,
	lastOverlayRebuildMs: null,
	lastFinalRebuildAt: null,
	lastOverlayRebuildAt: null,
};

export function recordFinalGeometryRebuild(payload: {
	ms: number;
	vertices?: number;
}): void {
	snapshot = {
		...snapshot,
		lastFinalRebuildMs: payload.ms,
		lastFinalRebuildVertices:
			payload.vertices != null ? payload.vertices : snapshot.lastFinalRebuildVertices,
		lastFinalRebuildAt: typeof performance !== 'undefined' ? performance.now() : null,
	};
}

export function recordOverlayRebuild(ms: number): void {
	snapshot = {
		...snapshot,
		lastOverlayRebuildMs: ms,
		lastOverlayRebuildAt: typeof performance !== 'undefined' ? performance.now() : null,
	};
}

export function getViewerPerfSnapshot(): ViewerPerfSnapshot {
	return snapshot;
}

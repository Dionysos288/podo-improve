import * as THREE from 'three';
import { getGeometryAxes, getAxisValue, setAxisValue } from '@/src/features/design/utils/geometryAxes';

export interface FlattenInsoleBottomOptions {
	mmToWorld: number;
	/** Coplanarity tolerance in mm for the flat core. Default 0.01. */
	epsilonMm?: number;
	/**
	 * Lower edge of the down-facing ramp. A face must point down by at least this
	 * much (height-axis normal <= -threshold) before it contributes any bottom
	 * weight, which keeps side walls out of the flattened region. Default 0.55.
	 */
	bottomNormalThreshold?: number;
	/**
	 * Laplacian diffusion passes over the bottom-weight field. More passes widen
	 * the smooth blend band between the flat core and the side wall, removing the
	 * hard rim / "comb" striations. Default 14.
	 */
	blendPasses?: number;
	/**
	 * Uniform flat layer (mm) added below the natural deepest core point. Positive
	 * pushes the flat plane deeper (thicker sole), negative raises it (thinner).
	 * This is how the zooldikte / sole-thickness control adds or removes material,
	 * so the slider and the flattened bottom stay one synced plane. Default 0.
	 */
	bottomLayerOffsetMm?: number;
	/** Optional mask (1 = skip) for already-engraved paths so text recesses survive. */
	excludeTextMask?: Uint8Array | null;
}

export interface FlattenInsoleBottomResult {
	changed: boolean;
	planeHeightWorld: number;
	bottomVertexCount: number;
	movedVertexCount: number;
}

const NO_CHANGE: FlattenInsoleBottomResult = {
	changed: false,
	planeHeightWorld: Number.NaN,
	bottomVertexCount: 0,
	movedVertexCount: 0,
};

/** Upper edge of the down-facing ramp; faces this close to straight-down get full weight. */
const RAMP_EDGE_HIGH = 0.92;
/** Diffused weight at/above which a vertex is treated as flat core (snapped fully to the plane). */
const CORE_WEIGHT = 0.7;
const DIFFUSE_ALPHA = 0.5;

function smoothstep(edge0: number, edge1: number, x: number): number {
	const span = edge1 - edge0;
	if (span <= 0) return x >= edge1 ? 1 : 0;
	const t = Math.max(0, Math.min(1, (x - edge0) / span));
	return t * t * (3 - 2 * t);
}

/**
 * Levels the insole underside toward a single deepest plane while blending the
 * perimeter smoothly into the side wall. A per-vertex bottom weight is built
 * from how far each face points straight down, diffused across the mesh so the
 * flat core meets the wall through a soft fillet (no hard rim or vertical
 * striations). Mutates `geometry` in place; only the thickness coordinate
 * changes, so faces/indices stay intact and the shell remains watertight.
 * Idempotent: a second run over already-flat geometry moves nothing.
 */
export function flattenInsoleBottom(
	geometry: THREE.BufferGeometry,
	options: FlattenInsoleBottomOptions,
): FlattenInsoleBottomResult {
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!posAttr || posAttr.count < 3) return NO_CHANGE;

	if (!geometry.getAttribute('normal')) {
		geometry.computeVertexNormals();
	}
	const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
	if (!normAttr) return NO_CHANGE;

	const axes = getGeometryAxes(geometry);
	const heightAxis = axes.heightAxis;

	const mmToWorld = options.mmToWorld || 1;
	const epsilonWorld = Math.max(0, (options.epsilonMm ?? 0.01) * mmToWorld);
	const rampEdgeLow = options.bottomNormalThreshold ?? 0.55;
	const blendPasses = Math.max(0, options.blendPasses ?? 14);
	const excludeTextMask = options.excludeTextMask ?? null;

	const count = posAttr.count;

	// --- Step 1: continuous down-facing weight (no hard boundary) ---
	const weights = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		if (excludeTextMask && excludeTextMask[i]) continue;
		const down = -getAxisValue(normAttr, i, heightAxis);
		weights[i] = smoothstep(rampEdgeLow, RAMP_EDGE_HIGH, down);
	}

	// --- Step 2: diffuse the weight field across mesh adjacency ---
	// Spreads the flat-core/wall boundary over several rings so the join is a
	// smooth fillet instead of a sharp crease with jagged per-vertex striations.
	const idxAttr = geometry.getIndex();
	if (idxAttr && blendPasses > 0) {
		const adj: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
		const idx = idxAttr.array;
		for (let f = 0; f < idx.length; f += 3) {
			const a = idx[f], b = idx[f + 1], c = idx[f + 2];
			adj[a].add(b); adj[a].add(c);
			adj[b].add(a); adj[b].add(c);
			adj[c].add(a); adj[c].add(b);
		}
		const tmp = new Float32Array(count);
		for (let pass = 0; pass < blendPasses; pass++) {
			for (let i = 0; i < count; i++) {
				const nbrs = adj[i];
				if (nbrs.size === 0) { tmp[i] = weights[i]; continue; }
				let sum = 0;
				for (const n of nbrs) sum += weights[n];
				tmp[i] = weights[i] * (1 - DIFFUSE_ALPHA) + (sum / nbrs.size) * DIFFUSE_ALPHA;
			}
			weights.set(tmp);
		}
	}

	// --- Step 3: reference plane = deepest core point, shifted by the layer offset ---
	let bottomVertexCount = 0;
	let coreMin = Number.POSITIVE_INFINITY;
	for (let i = 0; i < count; i++) {
		if (weights[i] < CORE_WEIGHT) continue;
		bottomVertexCount++;
		const h = getAxisValue(posAttr, i, heightAxis);
		if (h < coreMin) coreMin = h;
	}
	if (bottomVertexCount === 0 || !Number.isFinite(coreMin)) {
		return { ...NO_CHANGE };
	}
	const layerOffsetWorld = (options.bottomLayerOffsetMm ?? 0) * mmToWorld;
	const planeHeightWorld = coreMin - layerOffsetWorld;

	// --- Step 4: feathered snap toward the plane (both directions) ---
	// Core (effective weight 1) lands exactly on the plane → flat. The blend band
	// pulls partially so the bottom rounds up into the wall naturally. Vertices
	// move down when a layer is added (offset > 0) and up when removed (offset < 0).
	let movedVertexCount = 0;
	for (let i = 0; i < count; i++) {
		const w = smoothstep(0, CORE_WEIGHT, weights[i]);
		if (w <= 1e-3) continue;
		const h = getAxisValue(posAttr, i, heightAxis);
		const target = h + w * (planeHeightWorld - h);
		if (Math.abs(target - h) <= epsilonWorld) continue;
		setAxisValue(posAttr, i, heightAxis, target);
		movedVertexCount++;
	}

	if (movedVertexCount === 0) {
		return { changed: false, planeHeightWorld, bottomVertexCount, movedVertexCount };
	}

	posAttr.needsUpdate = true;
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();

	return { changed: true, planeHeightWorld, bottomVertexCount, movedVertexCount };
}

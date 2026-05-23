import * as THREE from 'three';

export type OverlayRegistrationLike = {
	matrix: THREE.Matrix4;
	valid?: boolean;
};

/** Defaults consumed by `EnhancedSTLViewer` scan overlay alignment. */
export const DEFAULT_EMBED_SCAN_HEIGHT_FRACTION = 0.58;
export const DEFAULT_SINK_BIAS_MM = 2;

/** Match EnhancedSTLViewer STLMesh rotations (no per-call allocation). */
const INSOLE_SCENE_ROT = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

const OVERLAY_MESH_ROT = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI));

const TOP_NORMAL_DOT = 0.25;
const MAX_SAMPLES = 400;
const MIN_SAMPLES = 16;
const FOOTPRINT_PAD = 0.05;

function getAxesAndBounds(geometry: THREE.BufferGeometry) {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	if (!bbox) return null;
	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	return {
		bbox,
		heightAxis: axes[0]!,
	};
}

/** @deprecated Prefer approxPercentile; kept for tests. */
export function percentileSorted(sorted: Float32Array, q: number): number {
	const n = sorted.length;
	if (n === 0) return 0;
	const idx = Math.max(0, Math.min(n - 1, Math.floor(q * (n - 1))));
	return sorted[idx]!;
}

/** Subsample at most MAX_SAMPLES then sort — small O(m log m). */
function approxPercentile(values: readonly number[], q: number): number {
	if (values.length === 0) return 0;
	const step = Math.max(1, Math.floor(values.length / MAX_SAMPLES));
	const collected: number[] = [];
	for (let i = 0; i < values.length && collected.length < MAX_SAMPLES; i += step) {
		collected.push(values[i]!);
	}
	collected.sort((a, b) => a - b);
	const idx = Math.max(0, Math.min(collected.length - 1, Math.floor(q * (collected.length - 1))));
	return collected[idx]!;
}

/**
 * Vertically aligns the overlay foot scan into the sole volume so the visible plantar impression
 * sits near the top surface (competitor-style), embedding ~fraction of measured scan thickness.
 *
 * Returns **world (0, deltaY, 0)** — only Y is populated; rotations / lateral stay in JSX.
 */
export function computeOverlayTopSurfaceAlignOffset(
	insoleGeometry: THREE.BufferGeometry | null,
	overlayGeometry: THREE.BufferGeometry | null,
	registration: OverlayRegistrationLike,
	_insoleUpWorld: THREE.Vector3,
	options?: {
		embedScanHeightFraction?: number;
		sinkBiasMm?: number;
		maxDeltaWorld?: number;
		mmToWorld?: number;
	},
): THREE.Vector3 {
	void _insoleUpWorld;
	const out = new THREE.Vector3(0, 0, 0);
	if (!insoleGeometry || !overlayGeometry) return out;
	const posI = insoleGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	const posO = overlayGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!posI || !posO || posI.count < MIN_SAMPLES || posO.count < MIN_SAMPLES) return out;

	const meta = getAxesAndBounds(insoleGeometry);
	if (!meta) return out;

	const nI =
		(insoleGeometry.getAttribute('normal') as THREE.BufferAttribute | undefined) ?? null;
	let normalI = nI;
	if (!normalI || normalI.count !== posI.count) {
		insoleGeometry.computeVertexNormals();
		normalI = (insoleGeometry.getAttribute('normal') as THREE.BufferAttribute | undefined) ?? null;
	}

	const { heightAxis } = meta;

	const mw = options?.mmToWorld && options.mmToWorld > 1e-9 ? options.mmToWorld : 0.4;

	const hIdx = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;

	const reg = registration.matrix ?? new THREE.Matrix4().identity();
	const overlayFull = new THREE.Matrix4().multiplyMatrices(reg, OVERLAY_MESH_ROT);

	const iStep = Math.max(1, Math.floor(posI.count / MAX_SAMPLES));
	const ovStep = Math.max(1, Math.floor(posO.count / MAX_SAMPLES));
	const tmp = new THREE.Vector3();

	const insoleDotsY: number[] = [];
	const insoleDotsTopFiltered: number[] = [];
	const hasNormals = !!(normalI && normalI.count === posI.count);

	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (let i = 0; i < posI.count; i += iStep) {
		tmp.set(posI.getX(i), posI.getY(i), posI.getZ(i)).applyMatrix4(INSOLE_SCENE_ROT);
		const wy = tmp.y;
		insoleDotsY.push(wy);
		minX = Math.min(minX, tmp.x);
		maxX = Math.max(maxX, tmp.x);
		minZ = Math.min(minZ, tmp.z);
		maxZ = Math.max(maxZ, tmp.z);

		if (hasNormals && normalI) {
			const nx = normalI.getX(i);
			const ny = normalI.getY(i);
			const nz = normalI.getZ(i);
			const nd = hIdx === 0 ? nx : hIdx === 1 ? ny : nz;
			const normalH = Math.abs(nd);
			if (nd > TOP_NORMAL_DOT && normalH >= TOP_NORMAL_DOT) {
				insoleDotsTopFiltered.push(wy);
			}
		}
	}

	if (insoleDotsY.length < MIN_SAMPLES) return out;

	const spanX = Math.max(1e-6, maxX - minX);
	const spanZ = Math.max(1e-6, maxZ - minZ);
	const pad = FOOTPRINT_PAD;
	const xmin = minX - spanX * pad;
	const xmax = maxX + spanX * pad;
	const zmin = minZ - spanZ * pad;
	const zmax = maxZ + spanZ * pad;

	const scanFootprintYs: number[] = [];
	const scanAllYs: number[] = [];

	for (let i = 0; i < posO.count; i += ovStep) {
		tmp.set(posO.getX(i), posO.getY(i), posO.getZ(i)).applyMatrix4(overlayFull);
		const wy = tmp.y;
		scanAllYs.push(wy);
		if (tmp.x >= xmin && tmp.x <= xmax && tmp.z >= zmin && tmp.z <= zmax) {
			scanFootprintYs.push(wy);
		}
	}

	const scanYs = scanFootprintYs.length >= MIN_SAMPLES ? scanFootprintYs : scanAllYs;
	if (scanYs.length < MIN_SAMPLES) return out;

	const sortedInFiltered =
		insoleDotsTopFiltered.length >= MIN_SAMPLES ? insoleDotsTopFiltered : null;
	const inTop = sortedInFiltered
		? approxPercentile(sortedInFiltered, 0.85)
		: approxPercentile(insoleDotsY, 0.94);

	const plantarY = approxPercentile(scanYs, 0.22);
	const scanTopY = approxPercentile(scanYs, 0.82);
	const medianScanY = approxPercentile(scanYs, 0.5);
	const scanPeak = approxPercentile(scanYs, 0.99);
	const solePeak = approxPercentile(insoleDotsY, 0.99);

	const scanSpan = Math.max(1e-3 * mw, scanTopY - plantarY);

	const embedFrac = options?.embedScanHeightFraction ?? DEFAULT_EMBED_SCAN_HEIGHT_FRACTION;
	const sinkBiasMm =
		typeof options?.sinkBiasMm === 'number' && Number.isFinite(options.sinkBiasMm)
			? options.sinkBiasMm
			: DEFAULT_SINK_BIAS_MM;
	const sinkBiasWorld = Math.max(0, sinkBiasMm) * mw;

	const targetY = inTop - embedFrac * scanSpan - sinkBiasWorld;
	const deltaPlantar = targetY - plantarY;
	const deltaMedian = targetY - medianScanY;
	let deltaY = deltaPlantar * 0.75 + deltaMedian * 0.25;

	if (scanTopY > inTop + mw * 0.1) {
		deltaY -= (scanTopY - inTop) * 0.88 + embedFrac * scanSpan * 0.22;
	}

	if (scanPeak > solePeak + mw * 0.14) {
		deltaY -= (scanPeak - solePeak) * 0.92;
	}

	const maxDw = options?.maxDeltaWorld ?? mw * 35;
	deltaY = Math.max(-maxDw, Math.min(maxDw, deltaY));

	if (medianScanY > inTop + mw * 0.2) {
		deltaY = Math.min(deltaY, deltaMedian);
	}

	const noiseGate = mw * 0.5;
	if (Math.abs(deltaY) < noiseGate && Math.abs(deltaY) > 1e-12) {
		deltaY *= 0.35;
	}

	out.set(0, deltaY, 0);
	return out;
}

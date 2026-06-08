import * as THREE from 'three';

export type OverlayRegistrationLike = {
	matrix: THREE.Matrix4;
	valid?: boolean;
};

/**
 * Defaults consumed by `EnhancedSTLViewer` scan overlay alignment.
 *
 * The plantar surface is seated ON the insole's neutral top surface (like a real
 * foot resting on the insole, no floating gap). `EMBED_SCAN_HEIGHT_FRACTION` then
 * seats it slightly deeper as a fraction of the support relief (0 = rest exactly
 * on the surface, higher = press in further), and `SINK_BIAS` adds a small fixed
 * seating depth in mm. Both stay bounded so the scan never sinks through the
 * insole bottom.
 */
export const DEFAULT_EMBED_SCAN_HEIGHT_FRACTION = 0;
export const DEFAULT_SINK_BIAS_MM = 0.5;

/** Match EnhancedSTLViewer STLMesh rotations (no per-call allocation). */
const INSOLE_SCENE_ROT = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

const OVERLAY_MESH_ROT = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI));

const TOP_NORMAL_DOT = 0.25;
const MAX_SAMPLES = 400;
const MIN_SAMPLES = 16;
const FOOTPRINT_PAD = 0.05;

/**
 * Percentiles used by the neutral-baseline estimator. These are applied through
 * the SAME winsorized `robustPercentile` for both feet so comparable scans yield
 * comparable embed depth (no per-foot noisy-percentile divergence).
 */
const NEUTRAL_PCT = 0.3; // low envelope of insole top surface = un-raised / neutral level
const SUPPORT_PCT = 0.88; // high envelope = raised / support level
const SCAN_PLANTAR_PCT = 0.22; // low envelope of scan = plantar impression
const SCAN_MIN_PCT = 0.02; // lowest scan surface (winsorized) for the never-below-bottom floor
const INSOLE_BOTTOM_PCT = 0.04; // lowest insole surface (winsorized)
const FALLBACK_NEUTRAL_PCT = 0.6; // when top-facing insole verts are unavailable
const FALLBACK_SUPPORT_PCT = 0.95;

/** Winsorization clamp (reject the most extreme samples before indexing). */
const WINSOR_LO = 0.02;
const WINSOR_HI = 0.98;

/** Upper bound on the measured support span (mm). Keeps embed comparable per side. */
const MAX_SUPPORT_MM = 14;
/** Upper bound on how deep embedFrac may seat the plantar below neutral (mm). */
const MAX_SEAT_MM = 6;
/** The lowest scan point stays at least this far above the insole bottom. */
const BOTTOM_MARGIN_MM = 0.5;

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

/** @deprecated Prefer robustPercentile; kept for tests. */
export function percentileSorted(sorted: Float32Array, q: number): number {
	const n = sorted.length;
	if (n === 0) return 0;
	const idx = Math.max(0, Math.min(n - 1, Math.floor(q * (n - 1))));
	return sorted[idx]!;
}

/**
 * Deterministic, winsorized percentile.
 *
 * Subsamples at a fixed stride (input order is preserved, so identical inputs
 * always produce identical output), sorts, then clamps the result to the
 * [WINSOR_LO, WINSOR_HI] band so a few noisy outliers cannot drag the estimate.
 * This is the single estimator used for every percentile on both feet — it is
 * what makes comparable scans embed by comparable amounts.
 */
export function robustPercentile(values: readonly number[], q: number): number {
	if (values.length === 0) return 0;
	const step = Math.max(1, Math.floor(values.length / MAX_SAMPLES));
	const collected: number[] = [];
	for (let i = 0; i < values.length && collected.length < MAX_SAMPLES; i += step) {
		collected.push(values[i]!);
	}
	collected.sort((a, b) => a - b);
	const n = collected.length;
	const at = (frac: number) =>
		collected[Math.max(0, Math.min(n - 1, Math.floor(frac * (n - 1))))]!;
	const lo = at(WINSOR_LO);
	const hi = at(WINSOR_HI);
	const v = at(q);
	return Math.min(hi, Math.max(lo, v));
}

/**
 * Vertically aligns the overlay foot scan into the sole volume so the plantar
 * impression sits at the insole's NEUTRAL baseline (the low envelope of the
 * corrected top surface). The depth prepass then occludes the scan exactly where
 * the corrected shell rises above neutral — i.e. occlusion tracks the correction
 * field per-location (support => hidden, neutral => visible skin).
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

	const nI = (insoleGeometry.getAttribute('normal') as THREE.BufferAttribute | undefined) ?? null;
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

	const insoleAllY: number[] = [];
	const insoleTopY: number[] = [];
	const hasNormals = !!(normalI && normalI.count === posI.count);

	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (let i = 0; i < posI.count; i += iStep) {
		tmp.set(posI.getX(i), posI.getY(i), posI.getZ(i)).applyMatrix4(INSOLE_SCENE_ROT);
		const wy = tmp.y;
		insoleAllY.push(wy);
		minX = Math.min(minX, tmp.x);
		maxX = Math.max(maxX, tmp.x);
		minZ = Math.min(minZ, tmp.z);
		maxZ = Math.max(maxZ, tmp.z);

		if (hasNormals && normalI) {
			const nd = hIdx === 0 ? normalI.getX(i) : hIdx === 1 ? normalI.getY(i) : normalI.getZ(i);
			if (nd > TOP_NORMAL_DOT) {
				insoleTopY.push(wy);
			}
		}
	}

	if (insoleAllY.length < MIN_SAMPLES) return out;

	const spanX = Math.max(1e-6, maxX - minX);
	const spanZ = Math.max(1e-6, maxZ - minZ);
	const xmin = minX - spanX * FOOTPRINT_PAD;
	const xmax = maxX + spanX * FOOTPRINT_PAD;
	const zmin = minZ - spanZ * FOOTPRINT_PAD;
	const zmax = maxZ + spanZ * FOOTPRINT_PAD;

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

	// Neutral baseline (low envelope) and support ceiling (high envelope) of the
	// insole TOP surface. Corrections only ever raise the top surface above
	// neutral, so the low percentile is invariant to support => deterministic and
	// identical-method for both feet.
	const useTop = insoleTopY.length >= MIN_SAMPLES;
	const neutralBaselineY = useTop
		? robustPercentile(insoleTopY, NEUTRAL_PCT)
		: robustPercentile(insoleAllY, FALLBACK_NEUTRAL_PCT);
	const supportCeilingY = useTop
		? robustPercentile(insoleTopY, SUPPORT_PCT)
		: robustPercentile(insoleAllY, FALLBACK_SUPPORT_PCT);

	const scanPlantarY = robustPercentile(scanYs, SCAN_PLANTAR_PCT);
	const scanMinY = robustPercentile(scanYs, SCAN_MIN_PCT);
	const insoleBottomY = robustPercentile(insoleAllY, INSOLE_BOTTOM_PCT);

	// Bounded raise magnitude — clamped so a noisy ceiling cannot make one foot
	// embed differently from the other.
	const supportSpan = Math.min(
		MAX_SUPPORT_MM * mw,
		Math.max(0, supportCeilingY - neutralBaselineY),
	);

	const embedFrac = Math.max(
		0,
		Math.min(1, options?.embedScanHeightFraction ?? DEFAULT_EMBED_SCAN_HEIGHT_FRACTION),
	);
	const sinkBiasMm =
		typeof options?.sinkBiasMm === 'number' && Number.isFinite(options.sinkBiasMm)
			? options.sinkBiasMm
			: DEFAULT_SINK_BIAS_MM;
	const sinkBiasWorld = Math.max(0, sinkBiasMm) * mw;

	// Seat the plantar ON the neutral top surface so the scan rests on the insole
	// like a real foot (no floating gap). Support regions rise above this datum and
	// occlude the scan via the depth prepass. embedFrac / sinkBias press it slightly
	// deeper, bounded so it never sinks through the insole bottom.
	const seatSinkWorld = sinkBiasWorld + embedFrac * Math.min(supportSpan, MAX_SEAT_MM * mw);
	let plantarTargetY = neutralBaselineY - seatSinkWorld;

	// Hard guarantee: the lowest scan point may never drop below the insole bottom
	// surface, so the solid shell always occludes the scan from beneath.
	const minPlantarFromBottom = insoleBottomY + BOTTOM_MARGIN_MM * mw + (scanPlantarY - scanMinY);
	plantarTargetY = Math.max(plantarTargetY, minPlantarFromBottom);

	let deltaY = plantarTargetY - scanPlantarY;

	const maxDw = options?.maxDeltaWorld ?? mw * 35;
	deltaY = Math.max(-maxDw, Math.min(maxDw, deltaY));

	out.set(0, deltaY, 0);
	return out;
}

/** Fraction of footprint length used for the heel contact band. */
const REST_HEEL_END_FRACTION = 0.28;
/** Narrower toe band so contact tracks the toe tip, not the whole forefoot. */
const REST_TOE_END_FRACTION = 0.22;
/** Winsorized minimum of scan Y in a band = bottom of the foot at that end. */
const REST_SCAN_PLANTAR_PCT = 0.02;
/** Heel end: low envelope of insole top = cup floor / supporting surface. */
const REST_INSOLE_HEEL_PCT = 0.3;
/** Toe end: high envelope of insole top = the surface the toe bottom rests on. */
const REST_INSOLE_TOE_PCT = 0.85;
/** Maximum resting pitch (radians) so a bad fit cannot tip the scan absurdly. */
const MAX_PITCH_RAD = 0.5;
/**
 * Optional per-end bias (mm). Default 0 => the heel and toe bottoms are pinned
 * exactly on the insole top (zero gap). `heelDrop` seats the heel deeper;
 * `toeLift` raises the toe end.
 */
export const DEFAULT_HEEL_DROP_MM = 0;
export const DEFAULT_TOE_LIFT_MM = 0;

export type OverlayRestingPose = {
	/** World-Y seat offset applied as the scan group position Y. */
	offsetY: number;
	/** Pitch rotation (radians) about `pivotWorld`, through footprint centre. */
	pitchRad: number;
	/** Pre-anchor world pivot for the primary pitch. */
	pivotWorld: THREE.Vector3;
	/** Horizontal axis (world) the pitch rotates about. */
	lateralAxisWorld: THREE.Vector3;
	/** Pitch (radians) about `heelPivotWorld` to lift the toe off the insole without moving the heel. */
	toeAntiPenPitchRad: number;
	/** Pre-anchor heel-band pivot for `toeAntiPenPitchRad`. */
	heelPivotWorld: THREE.Vector3;
	/** Extra pitch (radians) about `toePivotWorld` to seat the heel without moving toes. */
	heelSeatPitchRad: number;
	/** Pre-anchor toe-band pivot for `heelSeatPitchRad`. */
	toePivotWorld: THREE.Vector3;
};

function rotationAboutPivot(
	axis: THREE.Vector3,
	angleRad: number,
	pivot: THREE.Vector3,
): THREE.Matrix4 {
	const rot = new THREE.Matrix4().makeRotationAxis(axis.clone().normalize(), angleRad);
	const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
	const fromPivot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
	return fromPivot.multiply(rot).multiply(toPivot);
}

/**
 * Composite affine transform for the vertical seat + pitch chain. The matrices
 * depend only on the pose parameters (not the point), so building this once and
 * reusing it across all sampled points avoids per-vertex matrix allocation.
 *
 * Equivalent to: R(heelSeat) * R(toeAntiPen) * R(pitch) * T(0, offsetY, 0).
 */
function buildRestedTransform(
	offsetY: number,
	pitchRad: number,
	pivotWorld: THREE.Vector3,
	lateralAxisWorld: THREE.Vector3,
	toeAntiPenPitchRad = 0,
	heelPivotWorld?: THREE.Vector3,
	heelSeatPitchRad = 0,
	toePivotWorld?: THREE.Vector3,
): THREE.Matrix4 {
	const m = new THREE.Matrix4().makeTranslation(0, offsetY, 0);
	m.premultiply(rotationAboutPivot(lateralAxisWorld, pitchRad, pivotWorld));
	if (Math.abs(toeAntiPenPitchRad) > 1e-9 && heelPivotWorld) {
		m.premultiply(rotationAboutPivot(lateralAxisWorld, toeAntiPenPitchRad, heelPivotWorld));
	}
	if (Math.abs(heelSeatPitchRad) > 1e-9 && toePivotWorld) {
		m.premultiply(rotationAboutPivot(lateralAxisWorld, heelSeatPitchRad, toePivotWorld));
	}
	return m;
}

/** World Y after vertical seat + pitch chain (matches the viewer's anchored transform). */
function restedWorldY(
	p: { x: number; y: number; z: number },
	offsetY: number,
	pitchRad: number,
	pivotWorld: THREE.Vector3,
	lateralAxisWorld: THREE.Vector3,
	toeAntiPenPitchRad = 0,
	heelPivotWorld?: THREE.Vector3,
	heelSeatPitchRad = 0,
	toePivotWorld?: THREE.Vector3,
): number {
	const m = buildRestedTransform(
		offsetY,
		pitchRad,
		pivotWorld,
		lateralAxisWorld,
		toeAntiPenPitchRad,
		heelPivotWorld,
		heelSeatPitchRad,
		toePivotWorld,
	);
	return new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(m).y;
}

/**
 * Computes a resting pose for the foot scan: a vertical seat plus a pitch so the
 * heel and forefoot plantar contacts both land on the insole top surface (like a
 * real foot resting on the insole, free to tilt). Falls back to a pure vertical
 * seat when the two contact bands cannot be measured.
 */
export function computeOverlayRestingPose(
	insoleGeometry: THREE.BufferGeometry | null,
	overlayGeometry: THREE.BufferGeometry | null,
	registration: OverlayRegistrationLike,
	insoleUpWorld: THREE.Vector3,
	options?: {
		embedScanHeightFraction?: number;
		sinkBiasMm?: number;
		maxDeltaWorld?: number;
		mmToWorld?: number;
		disablePitch?: boolean;
		/** Extra depth (mm) to seat the heel end and close the heel-cup gap. */
		heelDropMm?: number;
		/** Extra lift (mm) for the toe end so the toe bottom rides on the insole. */
		toeLiftMm?: number;
	},
): OverlayRestingPose {
	const mw = options?.mmToWorld && options.mmToWorld > 1e-9 ? options.mmToWorld : 0.4;
	const fallbackOffset = computeOverlayTopSurfaceAlignOffset(
		insoleGeometry,
		overlayGeometry,
		registration,
		insoleUpWorld,
		options,
	).y;
	const fallback: OverlayRestingPose = {
		offsetY: fallbackOffset,
		pitchRad: 0,
		pivotWorld: new THREE.Vector3(0, 0, 0),
		lateralAxisWorld: new THREE.Vector3(1, 0, 0),
		toeAntiPenPitchRad: 0,
		heelPivotWorld: new THREE.Vector3(0, 0, 0),
		heelSeatPitchRad: 0,
		toePivotWorld: new THREE.Vector3(0, 0, 0),
	};
	if (options?.disablePitch) return fallback;
	if (!insoleGeometry || !overlayGeometry) return fallback;

	const posI = insoleGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	const posO = overlayGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!posI || !posO || posI.count < MIN_SAMPLES || posO.count < MIN_SAMPLES) return fallback;

	let normalI = (insoleGeometry.getAttribute('normal') as THREE.BufferAttribute | undefined) ?? null;
	if (!normalI || normalI.count !== posI.count) {
		insoleGeometry.computeVertexNormals();
		normalI = (insoleGeometry.getAttribute('normal') as THREE.BufferAttribute | undefined) ?? null;
	}
	const meta = getAxesAndBounds(insoleGeometry);
	if (!meta) return fallback;
	const hIdx = meta.heightAxis === 'x' ? 0 : meta.heightAxis === 'y' ? 1 : 2;
	const hasNormals = !!(normalI && normalI.count === posI.count);

	const reg = registration.matrix ?? new THREE.Matrix4().identity();
	const overlayFull = new THREE.Matrix4().multiplyMatrices(reg, OVERLAY_MESH_ROT);
	const iStep = Math.max(1, Math.floor(posI.count / MAX_SAMPLES));
	const ovStep = Math.max(1, Math.floor(posO.count / MAX_SAMPLES));
	const tmp = new THREE.Vector3();

	const insoleTop: Array<{ x: number; y: number; z: number }> = [];
	const insoleAllY: number[] = [];
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (let i = 0; i < posI.count; i += iStep) {
		tmp.set(posI.getX(i), posI.getY(i), posI.getZ(i)).applyMatrix4(INSOLE_SCENE_ROT);
		insoleAllY.push(tmp.y);
		minX = Math.min(minX, tmp.x);
		maxX = Math.max(maxX, tmp.x);
		minZ = Math.min(minZ, tmp.z);
		maxZ = Math.max(maxZ, tmp.z);
		if (hasNormals && normalI) {
			const nd = hIdx === 0 ? normalI.getX(i) : hIdx === 1 ? normalI.getY(i) : normalI.getZ(i);
			if (nd > TOP_NORMAL_DOT) insoleTop.push({ x: tmp.x, y: tmp.y, z: tmp.z });
		}
	}
	if (insoleAllY.length < MIN_SAMPLES || insoleTop.length < MIN_SAMPLES) return fallback;

	const spanX = Math.max(1e-6, maxX - minX);
	const spanZ = Math.max(1e-6, maxZ - minZ);
	const longIsZ = spanZ >= spanX;
	const longOf = (p: { x: number; z: number }) => (longIsZ ? p.z : p.x);
	const longSpan = longIsZ ? spanZ : spanX;
	const longMin = longIsZ ? minZ : minX;
	const pad = FOOTPRINT_PAD;
	const xmin = minX - spanX * pad;
	const xmax = maxX + spanX * pad;
	const zmin = minZ - spanZ * pad;
	const zmax = maxZ + spanZ * pad;

	const scan: Array<{ x: number; y: number; z: number }> = [];
	for (let i = 0; i < posO.count; i += ovStep) {
		tmp.set(posO.getX(i), posO.getY(i), posO.getZ(i)).applyMatrix4(overlayFull);
		if (tmp.x >= xmin && tmp.x <= xmax && tmp.z >= zmin && tmp.z <= zmax) {
			scan.push({ x: tmp.x, y: tmp.y, z: tmp.z });
		}
	}
	if (scan.length < MIN_SAMPLES) return fallback;

	const endHeel = longMin + REST_HEEL_END_FRACTION * longSpan;
	const endToe = longMin + (1 - REST_TOE_END_FRACTION) * longSpan;
	const inEndBand = (l: number, which: 'heel' | 'toe') =>
		which === 'heel' ? l <= endHeel : l >= endToe;

	const bandContact = (
		pts: Array<{ x: number; y: number; z: number }>,
		which: 'heel' | 'toe',
		surface: 'scan' | 'insole',
	): { y: number; l: number } | null => {
		const ys: number[] = [];
		let lSum = 0;
		let n = 0;
		for (const p of pts) {
			const l = longOf(p);
			if (!inEndBand(l, which)) continue;
			ys.push(p.y);
			lSum += l;
			n++;
		}
		if (n < 6) return null;
		const pct =
			surface === 'scan'
				? REST_SCAN_PLANTAR_PCT
				: which === 'heel'
					? REST_INSOLE_HEEL_PCT
					: REST_INSOLE_TOE_PCT;
		return { y: robustPercentile(ys, pct), l: lSum / n };
	};

	const iLo = bandContact(insoleTop, 'heel', 'insole');
	const iHi = bandContact(insoleTop, 'toe', 'insole');
	const pLo = bandContact(scan, 'heel', 'scan');
	const pHi = bandContact(scan, 'toe', 'scan');
	if (!iLo || !iHi || !pLo || !pHi) return fallback;
	if (Math.abs(pHi.l - pLo.l) < longSpan * 0.2) return fallback;

	// Wider end = heel (same heuristic as createHeelToToeMapper / STL canonicalization).
	const bandWidth = (which: 'heel' | 'toe'): number => {
		let lo = Infinity;
		let hi = -Infinity;
		for (const p of insoleTop) {
			const l = longOf(p);
			if (!inEndBand(l, which)) continue;
			const lat = longIsZ ? p.x : p.z;
			lo = Math.min(lo, lat);
			hi = Math.max(hi, lat);
		}
		return hi - lo;
	};
	const heelIsLo = bandWidth('heel') >= bandWidth('toe');

	// Per-end bias: seat the heel deeper (close the cup gap) and lift the toe so
	// its bottom rides on top of the insole instead of sinking in.
	const heelDrop = Math.max(0, options?.heelDropMm ?? DEFAULT_HEEL_DROP_MM) * mw;
	const toeLift = Math.max(0, options?.toeLiftMm ?? DEFAULT_TOE_LIFT_MM) * mw;
	const iLoT = iLo.y + (heelIsLo ? -heelDrop : toeLift);
	const iHiT = iHi.y + (heelIsLo ? toeLift : -heelDrop);

	const centerL = longIsZ ? (minZ + maxZ) * 0.5 : (minX + maxX) * 0.5;

	// Solve seat (offsetY) + slope (m) so both ends rest on the insole top.
	// Pitch rotates about the footprint centre, so dY/dL = m with pivot at centerL.
	const m = (iHiT - iLoT - (pHi.y - pLo.y)) / (pHi.l - pLo.l);
	let offsetY = iLoT - pLo.y - m * (pLo.l - centerL);

	// Rotation about the lateral axis that yields dY/dL = m (right-handed three.js).
	let pitchRad = longIsZ ? -m : m;
	pitchRad = Math.max(-MAX_PITCH_RAD, Math.min(MAX_PITCH_RAD, pitchRad));

	const centerX = (minX + maxX) * 0.5;
	const centerZ = (minZ + maxZ) * 0.5;
	const pivotWorld = new THREE.Vector3(centerX, (iLoT + iHiT) * 0.5, centerZ);
	const lateralAxisWorld = longIsZ
		? new THREE.Vector3(1, 0, 0)
		: new THREE.Vector3(0, 0, 1);

	const anatomToeBand: 'heel' | 'toe' = heelIsLo ? 'toe' : 'heel';
	const anatomHeelBand: 'heel' | 'toe' = heelIsLo ? 'heel' : 'toe';
	const longLo = pLo.l;
	const longHi = pHi.l;
	const insoleLo = iLoT;
	const insoleHi = iHiT;
	const longDenom = Math.max(1e-6, longHi - longLo);
	const insoleTopAt = (l: number) => {
		const t = Math.max(0, Math.min(1, (l - longLo) / longDenom));
		return insoleLo + t * (insoleHi - insoleLo);
	};

	// `scan` is already footprint-filtered, world-space (overlayFull applied) and
	// subsampled at `ovStep`, so reuse it instead of re-walking the raw geometry.
	const bandCentroid = (which: 'heel' | 'toe'): { x: number; y: number; z: number } | null => {
		let cx = 0;
		let cy = 0;
		let cz = 0;
		let n = 0;
		for (const p of scan) {
			if (!inEndBand(longOf(p), which)) continue;
			cx += p.x;
			cy += p.y;
			cz += p.z;
			n++;
		}
		if (n < 6) return null;
		return { x: cx / n, y: cy / n, z: cz / n };
	};

	const pivotAt = (
		centroid: { x: number; y: number; z: number },
		toeAntiPenPitchRad: number,
		heelPivotWorld: THREE.Vector3,
	): THREE.Vector3 =>
		new THREE.Vector3(
			centroid.x,
			restedWorldY(
				centroid,
				offsetY,
				pitchRad,
				pivotWorld,
				lateralAxisWorld,
				toeAntiPenPitchRad,
				heelPivotWorld,
			),
			centroid.z,
		);

	const measureBands = (
		toeAntiPenPitchRad: number,
		heelPivotWorld: THREE.Vector3,
		heelSeatPitchRad: number,
		toePivotWorld: THREE.Vector3,
	) => {
		// Build the pose transform once per probe and apply it to the prebuilt,
		// subsampled `scan` points (no per-vertex matrix allocation, no re-walk).
		const transform = buildRestedTransform(
			offsetY,
			pitchRad,
			pivotWorld,
			lateralAxisWorld,
			toeAntiPenPitchRad,
			heelPivotWorld,
			heelSeatPitchRad,
			toePivotWorld,
		);
		const v = new THREE.Vector3();
		let maxToePen = 0;
		let maxHeelGap = 0;
		for (const p of scan) {
			const l = longOf(p);
			const targetY = insoleTopAt(l);
			const restedY = v.set(p.x, p.y, p.z).applyMatrix4(transform).y;
			if (inEndBand(l, anatomToeBand)) {
				maxToePen = Math.max(maxToePen, targetY - restedY);
			}
			if (inEndBand(l, anatomHeelBand)) {
				maxHeelGap = Math.max(maxHeelGap, restedY - targetY);
			}
		}
		return { maxToePen, maxHeelGap };
	};

	const searchPitch = (
		probe: (delta: number) => { maxToePen: number; maxHeelGap: number },
		pick: 'toePen' | 'heelGap',
		maxRad: number,
		toePenLimit: number,
	): number => {
		const base = probe(0);
		const target = pick === 'toePen' ? base.maxToePen : base.maxHeelGap;
		if (target <= 1e-6) return 0;
		const gapP = probe(0.015)[pick === 'toePen' ? 'maxToePen' : 'maxHeelGap'];
		const gapN = probe(-0.015)[pick === 'toePen' ? 'maxToePen' : 'maxHeelGap'];
		const sign = gapP < gapN ? 1 : -1;
		let bestDelta = 0;
		let bestMetric = target;
		const steps = 48;
		for (let s = 1; s <= steps; s++) {
			const delta = sign * (s / steps) * maxRad;
			const m = probe(delta);
			if (m.maxToePen > toePenLimit + 1e-6) continue;
			const metric = pick === 'toePen' ? m.maxToePen : m.maxHeelGap;
			if (metric < bestMetric - 1e-9) {
				bestMetric = metric;
				bestDelta = delta;
			}
		}
		return bestDelta;
	};

	const heelCentroid = bandCentroid(anatomHeelBand);
	const toeCentroid = bandCentroid(anatomToeBand);
	const heelPivotWorld = new THREE.Vector3(0, 0, 0);
	const toePivotWorld = new THREE.Vector3(0, 0, 0);
	let toeAntiPenPitchRad = 0;
	let heelSeatPitchRad = 0;

	if (heelCentroid && toeCentroid) {
		heelPivotWorld.copy(pivotAt(heelCentroid, 0, heelPivotWorld));

		const toeTol = mw * 0.15;
		toeAntiPenPitchRad = searchPitch(
			(delta) => measureBands(delta, heelPivotWorld, 0, toePivotWorld),
			'toePen',
			0.35,
			toeTol,
		);

		const toeLockedPen = measureBands(
			toeAntiPenPitchRad,
			heelPivotWorld,
			0,
			toePivotWorld,
		).maxToePen;

		toePivotWorld.copy(pivotAt(toeCentroid, toeAntiPenPitchRad, heelPivotWorld));

		heelSeatPitchRad = searchPitch(
			(delta) => measureBands(toeAntiPenPitchRad, heelPivotWorld, delta, toePivotWorld),
			'heelGap',
			0.45,
			Math.max(toeTol, toeLockedPen + 1e-6),
		);
	}

	const maxDw = options?.maxDeltaWorld ?? mw * 35;
	offsetY = Math.max(-maxDw, Math.min(maxDw, offsetY));

	return {
		offsetY,
		pitchRad,
		pivotWorld,
		lateralAxisWorld,
		toeAntiPenPitchRad,
		heelPivotWorld,
		heelSeatPitchRad,
		toePivotWorld,
	};
}

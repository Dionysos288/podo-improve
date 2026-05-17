import * as THREE from 'three';

export type SideInspectionProfileBuffers = {
	top: THREE.Vector3[];
	bottom: THREE.Vector3[];
	fillGeometry: THREE.BufferGeometry;
};

const DEFAULT_BINS = 256;

function snapOrthonormalBasis(
	cameraPosition: THREE.Vector3,
	viewTarget: THREE.Vector3,
	cameraUp: THREE.Vector3,
): { forward: THREE.Vector3; up: THREE.Vector3; lateral: THREE.Vector3 } | null {
	const forward = new THREE.Vector3().subVectors(viewTarget, cameraPosition);
	if (forward.lengthSq() < 1e-12) return null;
	forward.normalize();

	let up = cameraUp.clone();
	if (up.lengthSq() < 1e-12) up.set(0, 1, 0);
	up.normalize();

	let lateral = new THREE.Vector3().crossVectors(up, forward);
	if (lateral.lengthSq() < 1e-10) {
		up.set(0, 0, 1);
		lateral.crossVectors(up, forward);
	}
	lateral.normalize();
	up.crossVectors(forward, lateral).normalize();

	return { forward, up, lateral };
}

function smoothEnvelope(arr: Float32Array, hit: Uint8Array, n: number, passes = 4): void {
	const tmp = new Float32Array(n);
	for (let p = 0; p < passes; p++) {
		tmp.set(arr);
		for (let i = 1; i < n - 1; i++) {
			if (!hit[i]) continue;
			let s = 0;
			let c = 0;
			for (const j of [i - 1, i, i + 1]) {
				if (hit[j]) {
					s += tmp[j];
					c++;
				}
			}
			if (c) arr[i] = s / c;
		}
	}
}

/** Limits bin-to-bin slope so tessellation noise does not jag the silhouette. */
function slopeLimitEnvelope(values: Float32Array, hit: Uint8Array, n: number, maxStep: number): void {
	const iterations = 4;
	for (let iter = 0; iter < iterations; iter++) {
		for (let i = 1; i < n; i++) {
			if (!hit[i] || !hit[i - 1]) continue;
			const lo = values[i - 1]! - maxStep;
			const hi = values[i - 1]! + maxStep;
			values[i] = THREE.MathUtils.clamp(values[i]!, lo, hi);
		}
		for (let i = n - 2; i >= 0; i--) {
			if (!hit[i] || !hit[i + 1]) continue;
			const lo = values[i + 1]! - maxStep;
			const hi = values[i + 1]! + maxStep;
			values[i] = THREE.MathUtils.clamp(values[i]!, lo, hi);
		}
	}
}

function fillBinGaps(bottom: Float32Array, top: Float32Array, hit: Uint8Array, n: number): void {
	let last = -1;
	for (let i = 0; i < n; i++) {
		if (hit[i]) {
			last = i;
			continue;
		}
		if (last >= 0) {
			bottom[i] = bottom[last];
			top[i] = top[last];
			hit[i] = 1;
		}
	}
	last = -1;
	for (let i = n - 1; i >= 0; i--) {
		if (hit[i]) {
			last = i;
			continue;
		}
		if (last >= 0) {
			bottom[i] = bottom[last];
			top[i] = top[last];
			hit[i] = 1;
		}
	}
}

function worldFromUV(
	origin: THREE.Vector3,
	lateral: THREE.Vector3,
	up: THREE.Vector3,
	u: number,
	v: number,
	target: THREE.Vector3,
): THREE.Vector3 {
	return target.copy(origin).addScaledVector(lateral, u).addScaledVector(up, v);
}

/**
 * Builds camera-aligned top/bottom envelopes and a thin profile fill mesh (world space).
 * Per-bin min/max in the viewing plane — good for thickness readout; not a full CAD silhouette.
 */
export function buildSideInspectionProfile(
	geometry: THREE.BufferGeometry,
	meshWorldMatrix: THREE.Matrix4,
	cameraPosition: THREE.Vector3,
	viewTarget: THREE.Vector3,
	cameraUp: THREE.Vector3,
	binCount = DEFAULT_BINS,
): SideInspectionProfileBuffers | null {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos || pos.count < 3) return null;

	const basis = snapOrthonormalBasis(cameraPosition, viewTarget, cameraUp);
	if (!basis) return null;
	const { up, lateral } = basis;

	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	if (!bbox) return null;

	const origin = new THREE.Vector3();
	bbox.getCenter(origin).applyMatrix4(meshWorldMatrix);

	const wp = new THREE.Vector3();
	const local = new THREE.Vector3();
	let uMin = Infinity;
	let uMax = -Infinity;
	const us = new Float32Array(pos.count);
	const vs = new Float32Array(pos.count);

	for (let i = 0; i < pos.count; i++) {
		local.fromBufferAttribute(pos, i).applyMatrix4(meshWorldMatrix);
		wp.copy(local).sub(origin);
		const u = wp.dot(lateral);
		const v = wp.dot(up);
		us[i] = u;
		vs[i] = v;
		uMin = Math.min(uMin, u);
		uMax = Math.max(uMax, u);
	}

	const span = Math.max(1e-6, uMax - uMin);
	const bins = Math.max(48, Math.min(binCount, Math.floor(pos.count / 4)));
	const du = span / bins;

	const bottom = new Float32Array(bins).fill(Number.POSITIVE_INFINITY);
	const top = new Float32Array(bins).fill(Number.NEGATIVE_INFINITY);
	const hit = new Uint8Array(bins);

	for (let i = 0; i < pos.count; i++) {
		const u = us[i]!;
		const v = vs[i]!;
		let b = Math.floor((u - uMin) / du);
		if (b >= bins) b = bins - 1;
		if (b < 0) b = 0;
		hit[b] = 1;
		bottom[b] = Math.min(bottom[b], v);
		top[b] = Math.max(top[b], v);
	}

	fillBinGaps(bottom, top, hit, bins);
	for (let i = 0; i < bins; i++) {
		if (!Number.isFinite(bottom[i]) || !Number.isFinite(top[i])) hit[i] = 0;
	}
	smoothEnvelope(bottom, hit, bins);
	smoothEnvelope(top, hit, bins);

	const maxSlopeStep = du * 3.5;
	slopeLimitEnvelope(bottom, hit, bins, maxSlopeStep);
	slopeLimitEnvelope(top, hit, bins, maxSlopeStep);
	smoothEnvelope(bottom, hit, bins, 2);
	smoothEnvelope(top, hit, bins, 2);

	const topPtsSparse: THREE.Vector3[] = [];
	const botPtsSparse: THREE.Vector3[] = [];
	const scratch = new THREE.Vector3();
	for (let i = 0; i < bins; i++) {
		if (!hit[i]) continue;
		const uC = uMin + (i + 0.5) * du;
		botPtsSparse.push(worldFromUV(origin, lateral, up, uC, bottom[i]!, scratch.clone()));
		topPtsSparse.push(worldFromUV(origin, lateral, up, uC, top[i]!, scratch.clone()));
	}

	if (topPtsSparse.length < 2 || botPtsSparse.length < 2) {
		return null;
	}

	const divisions = Math.min(480, Math.max(bins * 3, 72)) - 1;
	const curveBot = new THREE.CatmullRomCurve3(botPtsSparse, false, 'centripetal');
	const curveTop = new THREE.CatmullRomCurve3(topPtsSparse, false, 'centripetal');
	const botPts = curveBot.getPoints(divisions);
	const topPts = curveTop.getPoints(divisions);

	const verts: number[] = [];
	const indices: number[] = [];
	let vIdx = 0;
	const pushVert = (v: THREE.Vector3) => {
		verts.push(v.x, v.y, v.z);
		return vIdx++;
	};

	for (let i = 0; i < botPts.length - 1; i++) {
		const i00 = pushVert(botPts[i]!.clone());
		const i01 = pushVert(botPts[i + 1]!.clone());
		const i10 = pushVert(topPts[i]!.clone());
		const i11 = pushVert(topPts[i + 1]!.clone());
		indices.push(i00, i01, i11, i00, i11, i10);
	}

	const fillGeometry = new THREE.BufferGeometry();
	fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
	fillGeometry.setIndex(indices);
	fillGeometry.computeVertexNormals();

	return { top: topPts, bottom: botPts, fillGeometry };
}

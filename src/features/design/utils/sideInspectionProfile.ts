import * as THREE from 'three';

export type SideInspectionProfileBuffers = {
	top: THREE.Vector3[];
	bottom: THREE.Vector3[];
};

export type SideInspectionProfileBasis = {
	up: THREE.Vector3;
	lateral: THREE.Vector3;
};

const DEFAULT_BINS = 200;

function normalizeProfileBasis(basis: SideInspectionProfileBasis): SideInspectionProfileBasis | null {
	const up = basis.up.clone();
	if (up.lengthSq() < 1e-12) up.set(0, 1, 0);
	up.normalize();

	const lateral = basis.lateral.clone();
	if (lateral.lengthSq() < 1e-12) return null;
	lateral.addScaledVector(up, -lateral.dot(up));
	if (lateral.lengthSq() < 1e-12) return null;
	lateral.normalize();

	return { up, lateral };
}

function smoothEnvelope(arr: Float32Array, hit: Uint8Array, n: number, passes = 2): void {
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
 * Builds fixed-axis top/bottom envelopes in world space.
 * Per-bin min/max in the viewing plane — good for thickness readout; not a full CAD silhouette.
 */
export function buildSideInspectionProfile(
	geometry: THREE.BufferGeometry,
	meshWorldMatrix: THREE.Matrix4,
	profileBasis: SideInspectionProfileBasis,
	binCount = DEFAULT_BINS,
): SideInspectionProfileBuffers | null {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos || pos.count < 3) return null;

	const basis = normalizeProfileBasis(profileBasis);
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

	const topPts: THREE.Vector3[] = [];
	const botPts: THREE.Vector3[] = [];
	const scratch = new THREE.Vector3();
	for (let i = 0; i < bins; i++) {
		if (!hit[i]) continue;
		const uC = uMin + (i + 0.5) * du;
		botPts.push(worldFromUV(origin, lateral, up, uC, bottom[i]!, scratch.clone()));
		topPts.push(worldFromUV(origin, lateral, up, uC, top[i]!, scratch.clone()));
	}

	if (topPts.length < 2 || botPts.length < 2) {
		return null;
	}

	return { top: topPts, bottom: botPts };
}

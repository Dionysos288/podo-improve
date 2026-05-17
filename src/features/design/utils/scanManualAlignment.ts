import * as THREE from 'three';

import type { ScanManualAlignment } from '@/src/features/design/types/types';

export function findMeshWithGeometry(
	root: THREE.Object3D | null,
	geom: THREE.BufferGeometry | null,
): THREE.Mesh | null {
	if (!root || !geom) return null;
	let found: THREE.Mesh | null = null;
	root.traverse((obj) => {
		if (found) return;
		const m = obj as THREE.Mesh;
		if (m.isMesh && m.geometry === geom) {
			found = m;
		}
	});
	return found;
}

export function worldHeightAxisFromProcessedGeometry(
	mesh: THREE.Mesh,
	geometry: THREE.BufferGeometry,
): THREE.Vector3 {
	geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	if (!box) {
		return new THREE.Vector3(0, 1, 0);
	}
	const size = box.getSize(new THREE.Vector3());
	const axes = ['x', 'y', 'z'] as const;
	const ranked = [...axes].sort((a, b) => size[a] - size[b]);
	const h = ranked[0]!;
	const local =
		h === 'x'
			? new THREE.Vector3(1, 0, 0)
			: h === 'y'
				? new THREE.Vector3(0, 1, 0)
				: new THREE.Vector3(0, 0, 1);
	return local.transformDirection(mesh.matrixWorld);
}

export function composeOverlayManualYawMatrix(
	anchorTranslation: THREE.Vector3Tuple,
	overlayRegistration: THREE.Matrix4,
	alignment: ScanManualAlignment | null,
	upWorld: THREE.Vector3,
): THREE.Matrix4 {
	const composed = overlayRegistration.clone();
	if (!alignment) return composed;

	const up = upWorld.clone();
	if (up.lengthSq() < 1e-12) {
		up.set(0, 1, 0);
	} else {
		up.normalize();
	}

	const rot = new THREE.Matrix4().makeRotationAxis(up, alignment.yawRad);
	const pivot = new THREE.Vector3(
		alignment.pivot[0],
		alignment.pivot[1],
		alignment.pivot[2],
	);
	const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
	const fromPivot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
	const rw = new THREE.Matrix4().multiplyMatrices(fromPivot, rot);
	rw.multiply(toPivot);

	const anchorMat = new THREE.Matrix4().makeTranslation(
		anchorTranslation[0],
		anchorTranslation[1],
		anchorTranslation[2],
	);
	const invAnchor = anchorMat.clone().invert();
	const sandwich = new THREE.Matrix4().multiplyMatrices(invAnchor, rw);
	sandwich.multiply(anchorMat);
	sandwich.multiply(composed);
	return sandwich;
}

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

/** Optional resting pitch applied in the anchored world frame. */
export type OverlayRestingPitch = {
	axisWorld: THREE.Vector3;
	angleRad: number;
	/** Pivot in the anchored world frame (pre-anchor pivot + anchor translation). */
	pivotWorld: THREE.Vector3;
};

function rotationAboutPivot(
	axis: THREE.Vector3,
	angleRad: number,
	pivot: THREE.Vector3,
): THREE.Matrix4 {
	const rot = new THREE.Matrix4().makeRotationAxis(axis, angleRad);
	const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
	const fromPivot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
	return fromPivot.multiply(rot).multiply(toPivot);
}

export function composeOverlayManualYawMatrix(
	anchorTranslation: THREE.Vector3Tuple,
	overlayRegistration: THREE.Matrix4,
	alignment: ScanManualAlignment | null,
	upWorld: THREE.Vector3,
	pitch?: OverlayRestingPitch | null,
	toeAntiPenPitch?: OverlayRestingPitch | null,
	heelSeatPitch?: OverlayRestingPitch | null,
): THREE.Matrix4 {
	const composed = overlayRegistration.clone();
	const hasPitch = !!pitch && Math.abs(pitch.angleRad) > 1e-6 && pitch.axisWorld.lengthSq() > 1e-12;
	const hasToeAntiPen =
		!!toeAntiPenPitch &&
		Math.abs(toeAntiPenPitch.angleRad) > 1e-6 &&
		toeAntiPenPitch.axisWorld.lengthSq() > 1e-12;
	const hasHeelSeat =
		!!heelSeatPitch &&
		Math.abs(heelSeatPitch.angleRad) > 1e-6 &&
		heelSeatPitch.axisWorld.lengthSq() > 1e-12;
	if (!alignment && !hasPitch && !hasToeAntiPen && !hasHeelSeat) return composed;

	// World rotation applied to the anchored, registered scan. Apply yaw first,
	// then centre pitch, heel-pivot toe lift, toe-pivot heel seat.
	let rw = new THREE.Matrix4().identity();
	if (alignment) {
		const up = upWorld.clone();
		if (up.lengthSq() < 1e-12) {
			up.set(0, 1, 0);
		} else {
			up.normalize();
		}
		const yawPivot = new THREE.Vector3(
			alignment.pivot[0],
			alignment.pivot[1],
			alignment.pivot[2],
		);
		rw = rotationAboutPivot(up, alignment.yawRad, yawPivot);
	}
	if (hasPitch && pitch) {
		const axis = pitch.axisWorld.clone().normalize();
		const pitchMat = rotationAboutPivot(axis, pitch.angleRad, pitch.pivotWorld.clone());
		rw = pitchMat.multiply(rw);
	}
	if (hasToeAntiPen && toeAntiPenPitch) {
		const axis = toeAntiPenPitch.axisWorld.clone().normalize();
		const toeMat = rotationAboutPivot(
			axis,
			toeAntiPenPitch.angleRad,
			toeAntiPenPitch.pivotWorld.clone(),
		);
		rw = toeMat.multiply(rw);
	}
	if (hasHeelSeat && heelSeatPitch) {
		const axis = heelSeatPitch.axisWorld.clone().normalize();
		const heelMat = rotationAboutPivot(
			axis,
			heelSeatPitch.angleRad,
			heelSeatPitch.pivotWorld.clone(),
		);
		rw = heelMat.multiply(rw);
	}

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

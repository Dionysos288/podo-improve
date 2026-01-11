import * as THREE from 'three';
import type { MatchTransform } from '../types/types';

/**
 * Center a mesh geometry at the origin
 */
export function centerMesh(geometry: THREE.BufferGeometry): THREE.Matrix4 {
	geometry.computeBoundingBox();
	const box = geometry.boundingBox!;
	const center = new THREE.Vector3();
	box.getCenter(center);

	const matrix = new THREE.Matrix4();
	matrix.makeTranslation(-center.x, -center.y, -center.z);

	return matrix;
}

/**
 * Scale a mesh geometry to a target size
 */
export function scaleMesh(
	geometry: THREE.BufferGeometry,
	targetSize: number
): THREE.Matrix4 {
	geometry.computeBoundingBox();
	const box = geometry.boundingBox!;
	const size = new THREE.Vector3();
	box.getSize(size);

	const maxDimension = Math.max(size.x, size.y, size.z);
	const scale = targetSize / maxDimension;

	const matrix = new THREE.Matrix4();
	matrix.makeScale(scale, scale, scale);

	return matrix;
}

/**
 * Align a mesh geometry along a direction vector
 * Note: For production, use ICP (Iterative Closest Point) algorithm
 */
export function alignMesh(
	geometry: THREE.BufferGeometry,
	direction: THREE.Vector3
): THREE.Matrix4 {
	const up = new THREE.Vector3(0, 1, 0);
	const quaternion = new THREE.Quaternion();
	quaternion.setFromUnitVectors(direction.normalize(), up);

	const matrix = new THREE.Matrix4();
	matrix.makeRotationFromQuaternion(quaternion);

	return matrix;
}

/**
 * Convert transformation matrix to MatchTransform type
 */
export function matrixToMatchTransform(matrix: THREE.Matrix4): MatchTransform {
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3();

	matrix.decompose(position, quaternion, scale);

	const euler = new THREE.Euler().setFromQuaternion(quaternion);

	return {
		translation: [position.x, position.y, position.z],
		rotation: [euler.x, euler.y, euler.z],
		scale: scale.x, // Assuming uniform scaling
	};
}

/**
 * Apply MatchTransform to a matrix
 */
export function applyMatchTransform(
	matrix: THREE.Matrix4,
	transform: MatchTransform
): THREE.Matrix4 {
	const result = new THREE.Matrix4();

	// Apply translation
	result.makeTranslation(...transform.translation);

	// Apply rotation
	const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(
		new THREE.Euler(...transform.rotation)
	);
	result.multiply(rotationMatrix);

	// Apply scale
	const scaleMatrix = new THREE.Matrix4().makeScale(
		transform.scale,
		transform.scale,
		transform.scale
	);
	result.multiply(scaleMatrix);

	return result;
}

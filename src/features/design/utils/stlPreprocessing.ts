import * as THREE from 'three';
import type { InsoleZone, LandmarkSet } from '../types/types';

export interface PreprocessingOptions {
	gridCols?: number;
	gridRows?: number;
	decimateTarget?: number;
}

export interface PreprocessedGeometry {
	geometry: THREE.BufferGeometry;
	gridCols: number;
	gridRows: number;
	landmarks: LandmarkSet;
}

export function computeGridIndices(
	geometry: THREE.BufferGeometry,
	cols: number = 10,
	rows: number = 25
): THREE.BufferAttribute {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const positions = geometry.attributes.position as THREE.BufferAttribute;

	const minX = bbox.min.x;
	const maxX = bbox.max.x;
	const minY = bbox.min.y;
	const maxY = bbox.max.y;

	const gridAttr = new Float32Array(positions.count * 3);

	for (let i = 0; i < positions.count; i++) {
		const x = positions.getX(i);
		const y = positions.getY(i);

		const col = Math.floor(((x - minX) / (maxX - minX)) * (cols - 1));
		const row = Math.floor(((y - minY) / (maxY - minY)) * (rows - 1));

		const normalizedCol = cols > 1 ? col / (cols - 1) : 0;
		const normalizedRow = rows > 1 ? row / (rows - 1) : 0;

		gridAttr[i * 3] = normalizedCol;
		gridAttr[i * 3 + 1] = normalizedRow;
		gridAttr[i * 3 + 2] = 0;
	}

	return new THREE.BufferAttribute(gridAttr, 3);
}

export function assignZones(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const positions = geometry.attributes.position as THREE.BufferAttribute;

	const minY = bbox.min.y;
	const maxY = bbox.max.y;
	const length = maxY - minY;

	const zonesAttr = new Float32Array(positions.count * 3);

	for (let i = 0; i < positions.count; i++) {
		const y = positions.getY(i) - minY;
		const relativeY = length > 0 ? y / length : 0;

		let zoneColor: [number, number, number];

		if (relativeY < 0.2) {
			zoneColor = [1, 0, 0];
		} else if (relativeY < 0.5) {
			zoneColor = [0, 1, 0];
		} else {
			zoneColor = [0, 0, 1];
		}

		zonesAttr[i * 3] = zoneColor[0];
		zonesAttr[i * 3 + 1] = zoneColor[1];
		zonesAttr[i * 3 + 2] = zoneColor[2];
	}

	return new THREE.BufferAttribute(zonesAttr, 3);
}

export function computeLandmarks(
	geometry: THREE.BufferGeometry
): LandmarkSet {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const positions = geometry.attributes.position as THREE.BufferAttribute;

	const centerX = (bbox.min.x + bbox.max.x) / 2;
	const centerZ = (bbox.min.z + bbox.max.z) / 2;

	const length = bbox.max.y - bbox.min.y;
	const midY = (bbox.min.y + bbox.max.y) / 2;
	let maxZMidY = -Infinity;

	for (let i = 0; i < positions.count; i++) {
		const y = positions.getY(i);
		const z = positions.getZ(i);

		const yDist = Math.abs(y - midY);
		if (yDist < length * 0.1 && z > maxZMidY) {
			maxZMidY = z;
		}
	}

	return {
		heel: [centerX, bbox.min.y, centerZ],
		toeTip: [centerX, bbox.max.y, centerZ],
		arch: [centerX, (bbox.min.y + bbox.max.y) / 2, bbox.max.z],
	};
}

export function initializeMaterialAttribute(
	geometry: THREE.BufferGeometry
): THREE.BufferAttribute {
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const materialsAttr = new Float32Array(positions.count * 3);

	for (let i = 0; i < positions.count; i++) {
		materialsAttr[i * 3] = 0;
		materialsAttr[i * 3 + 1] = 0;
		materialsAttr[i * 3 + 2] = 0;
	}

	return new THREE.BufferAttribute(materialsAttr, 3);
}

export function decimateMesh(
	geometry: THREE.BufferGeometry,
	targetVertices: number
): THREE.BufferGeometry {
	if (targetVertices <= 0) {
		return geometry.clone();
	}

	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const currentVertices = positions.count;

	if (currentVertices <= targetVertices) {
		return geometry.clone();
	}

	return geometry.clone();
}

export function preprocessInsoleGeometry(
	geometry: THREE.BufferGeometry,
	options: PreprocessingOptions = {}
): PreprocessedGeometry {
	const {
		gridCols = 10,
		gridRows = 25,
		decimateTarget = 40000,
	} = options;

	let processedGeometry = geometry.clone();

	if (decimateTarget > 0) {
		const positions = processedGeometry.attributes.position as THREE.BufferAttribute;
		if (positions.count > decimateTarget) {
			processedGeometry = decimateMesh(processedGeometry, decimateTarget);
		}
	}

	processedGeometry.computeBoundingBox();
	processedGeometry.computeVertexNormals();

	const gridIndices = computeGridIndices(processedGeometry, gridCols, gridRows);
	const zones = assignZones(processedGeometry);
	const materials = initializeMaterialAttribute(processedGeometry);
	const landmarks = computeLandmarks(processedGeometry);

	processedGeometry.setAttribute('gridIndex', gridIndices);
	processedGeometry.setAttribute('zones', zones);
	processedGeometry.setAttribute('materials', materials);

	return {
		geometry: processedGeometry,
		gridCols,
		gridRows,
		landmarks,
	};
}

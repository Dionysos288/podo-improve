import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as THREE from 'three';

export type STLFormat = 'binary' | 'ascii';

/**
 * Exports a Three.js geometry or mesh to STL format and triggers a download.
 */
export function exportGeometryToSTL(
	geometry: THREE.BufferGeometry,
	filename: string = 'insole.stl'
): void {
	// Create a mesh from the geometry if needed
	const material = new THREE.MeshBasicMaterial();
	const mesh = new THREE.Mesh(geometry, material);

	// Export to STL
	const exporter = new STLExporter();
	const stlString = exporter.parse(mesh, { binary: false });

	// Create and trigger download
	downloadSTL(stlString, filename);
}

/**
 * Exports a Three.js mesh to STL format and triggers a download.
 */
export function exportMeshToSTL(
	mesh: THREE.Mesh,
	filename: string = 'insole.stl'
): void {
	const exporter = new STLExporter();
	const stlString = exporter.parse(mesh, { binary: false });
	downloadSTL(stlString, filename);
}

/**
 * Exports a Three.js scene or group to STL format and triggers a download.
 */
export function exportSceneToSTL(
	scene: THREE.Object3D,
	filename: string = 'insole.stl'
): void {
	const exporter = new STLExporter();
	const stlString = exporter.parse(scene, { binary: false });
	downloadSTL(stlString, filename);
}

/**
 * Downloads an STL string as a file
 */
function downloadSTL(stlString: string, filename: string): void {
	const blob = new Blob([stlString], { type: 'application/octet-stream' });
	const url = URL.createObjectURL(blob);

	const link = document.createElement('a');
	link.href = url;
	link.download = filename.endsWith('.stl') ? filename : `${filename}.stl`;
	link.style.display = 'none';

	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);

	// Clean up the URL object
	setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Exports binary STL for better file size and compatibility
 */
export function exportGeometryToSTLBinary(
	geometry: THREE.BufferGeometry,
	filename: string = 'insole.stl',
	format: STLFormat = 'binary'
): void {
	const material = new THREE.MeshBasicMaterial();
	const mesh = new THREE.Mesh(geometry, material);

	const exporter = new STLExporter();
	const payload = exporter.parse(mesh, { binary: format === 'binary' });

	const blob = new Blob([payload], { type: 'application/octet-stream' });
	const url = URL.createObjectURL(blob);

	const link = document.createElement('a');
	link.href = url;
	link.download = filename.endsWith('.stl') ? filename : `${filename}.stl`;
	link.style.display = 'none';

	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);

	setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Convert geometry to binary STL ArrayBuffer (for API upload / agent jobs).
 */
export function geometryToBinarySTLArrayBuffer(
	geometry: THREE.BufferGeometry
): ArrayBuffer {
	const material = new THREE.MeshBasicMaterial();
	const mesh = new THREE.Mesh(geometry, material);
	const exporter = new STLExporter();
	const payload = exporter.parse(mesh, { binary: true });
	if (payload instanceof ArrayBuffer) return payload;
	if (payload instanceof DataView) return payload.buffer.slice(0);
	throw new Error('Unexpected binary STL payload type');
}

/**
 * Convert geometry to binary STL base64 string.
 */
export function geometryToBinarySTLBase64(
	geometry: THREE.BufferGeometry
): string {
	const arrayBuffer = geometryToBinarySTLArrayBuffer(geometry);
	const bytes = new Uint8Array(arrayBuffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

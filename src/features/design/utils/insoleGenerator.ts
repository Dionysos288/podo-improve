import * as THREE from 'three';
import type { InsoleTemplate } from '../types/types';

/**
 * Generate a realistic 3D insole geometry from foot geometry
 */
export function generateInsoleGeometry(
	footGeometry: THREE.BufferGeometry,
	template: InsoleTemplate = 'classic'
): THREE.BufferGeometry {
	// Compute bounding box
	footGeometry.computeBoundingBox();
	const bbox = footGeometry.boundingBox!;
	const minY = bbox.min.y;
	const maxY = bbox.max.y;
	const width = bbox.max.x - bbox.min.x;
	const depth = bbox.max.z - bbox.min.z;
	const centerX = (bbox.min.x + bbox.max.x) / 2;
	const centerZ = (bbox.min.z + bbox.max.z) / 2;

	// Extract bottom surface vertices
	const positions = footGeometry.attributes.position;
	const bottomVertices: THREE.Vector3[] = [];
	const threshold = (maxY - minY) * 0.1; // Bottom 10% of the foot

	for (let i = 0; i < positions.count; i++) {
		const y = positions.getY(i);
		if (y <= minY + threshold) {
			bottomVertices.push(
				new THREE.Vector3(
					positions.getX(i),
					positions.getY(i),
					positions.getZ(i)
				)
			);
		}
	}

	// Create a shape from bottom vertices
	const shape = createInsoleShape(
		bottomVertices,
		width,
		depth,
		centerX,
		centerZ,
		template
	);

	// Extrude the shape to create 3D geometry
	const extrudeSettings = {
		depth: 2, // 2mm thickness
		bevelEnabled: true,
		bevelThickness: 0.1,
		bevelSize: 0.1,
		bevelSegments: 3,
	};

	const extrudeGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

	// Position at the bottom of the foot
	extrudeGeometry.translate(0, minY + 1, 0); // 1mm above bottom
	extrudeGeometry.rotateX(-Math.PI / 2); // Rotate to be horizontal

	extrudeGeometry.computeVertexNormals();
	return extrudeGeometry;
}

/**
 * Create a 2D shape for the insole based on template
 */
function createInsoleShape(
	bottomVertices: THREE.Vector3[],
	width: number,
	depth: number,
	centerX: number,
	centerZ: number,
	template: InsoleTemplate
): THREE.Shape {
	const shape = new THREE.Shape();

	if (bottomVertices.length === 0) {
		// Fallback: create basic shape
		return createBasicInsoleShape(width, depth, template);
	}

	// Sort vertices by angle from center to create outline
	const sortedVertices = [...bottomVertices].sort((a, b) => {
		const angleA = Math.atan2(a.z - centerZ, a.x - centerX);
		const angleB = Math.atan2(b.z - centerZ, b.x - centerX);
		return angleA - angleB;
	});

	// Create shape from sorted vertices
	if (sortedVertices.length > 0) {
		const first = sortedVertices[0];
		shape.moveTo(first.x - centerX, first.z - centerZ);

		for (let i = 1; i < sortedVertices.length; i++) {
			const v = sortedVertices[i];
			shape.lineTo(v.x - centerX, v.z - centerZ);
		}

		shape.lineTo(first.x - centerX, first.z - centerZ); // Close the shape
	} else {
		return createBasicInsoleShape(width, depth, template);
	}

	// Apply template-specific modifications
	applyTemplateModifications(shape, width, depth, template);

	return shape;
}

/**
 * Create a basic insole shape based on template
 */
function createBasicInsoleShape(
	width: number,
	depth: number,
	template: InsoleTemplate
): THREE.Shape {
	const shape = new THREE.Shape();
	const halfWidth = width / 2;
	const halfDepth = depth / 2;

	// Base foot shape (oval-like)
	const toeRadius = halfWidth * 0.6;
	const heelRadius = halfWidth * 0.5;
	const archWidth = halfWidth * 0.4;

	// Start at heel
	shape.moveTo(0, -halfDepth);

	// Heel curve
	shape.quadraticCurveTo(
		heelRadius * 0.5,
		-halfDepth * 0.8,
		heelRadius,
		-halfDepth * 0.6
	);

	// Outer edge
	shape.lineTo(halfWidth * 0.7, -halfDepth * 0.3);

	// Arch (inner side)
	if (template !== '3quarter') {
		shape.quadraticCurveTo(archWidth, 0, archWidth * 0.8, halfDepth * 0.3);
	} else {
		// 3/4 sole - no arch, straight line
		shape.lineTo(archWidth * 0.8, halfDepth * 0.3);
	}

	// Toe area
	shape.quadraticCurveTo(
		toeRadius * 0.8,
		halfDepth * 0.7,
		toeRadius,
		halfDepth
	);

	// Toe curve
	shape.quadraticCurveTo(0, halfDepth * 0.9, -toeRadius, halfDepth);

	// Inner toe
	shape.quadraticCurveTo(
		-toeRadius * 0.8,
		halfDepth * 0.7,
		-archWidth * 0.8,
		halfDepth * 0.3
	);

	// Inner arch
	if (template !== '3quarter') {
		shape.quadraticCurveTo(-archWidth, 0, -halfWidth * 0.7, -halfDepth * 0.3);
	} else {
		shape.lineTo(-halfWidth * 0.7, -halfDepth * 0.3);
	}

	// Inner heel
	shape.lineTo(-heelRadius, -halfDepth * 0.6);
	shape.quadraticCurveTo(-heelRadius * 0.5, -halfDepth * 0.8, 0, -halfDepth);

	// Apply template-specific modifications
	applyTemplateModifications(shape, width, depth, template);

	return shape;
}

/**
 * Apply template-specific modifications to the shape
 */
function applyTemplateModifications(
	shape: THREE.Shape,
	width: number,
	depth: number,
	template: InsoleTemplate
): void {
	const halfWidth = width / 2;
	const halfDepth = depth / 2;

	switch (template) {
		case 'man':
			// Wider, more robust shape
			// Already handled in basic shape
			break;

		case 'woman':
			// Narrower, more refined shape
			// Could adjust arch height here
			break;

		case 'dunes':
			// More pronounced arch support
			// Add arch support curve
			break;

		case 'finncomfort':
			// Comfort-focused, softer curves
			break;

		case '3quarter':
			// 3/4 length - already handled
			break;

		case 'classic':
		default:
			// Standard shape
			break;
	}
}

/**
 * Create a heightmap-based insole for more realistic contours
 */
export function generateContouredInsole(
	footGeometry: THREE.BufferGeometry,
	template: InsoleTemplate = 'classic'
): THREE.BufferGeometry {
	// Get foot bounding box
	footGeometry.computeBoundingBox();
	const bbox = footGeometry.boundingBox!;
	const minY = bbox.min.y;
	const maxY = bbox.max.y;
	const width = bbox.max.x - bbox.min.x;
	const depth = bbox.max.z - bbox.min.z;

	// Create a detailed plane with many segments
	const segmentsX = 64;
	const segmentsZ = 64;
	const planeGeometry = new THREE.PlaneGeometry(
		width,
		depth,
		segmentsX,
		segmentsZ
	);

	// Get positions
	const positions = planeGeometry.attributes.position;
	const centerX = (bbox.min.x + bbox.max.x) / 2;
	const centerZ = (bbox.min.z + bbox.max.z) / 2;

	// Sample foot geometry to create heightmap
	const footPositions = footGeometry.attributes.position;
	const sampleRadius = Math.min(width, depth) * 0.05; // 5% of size

	for (let i = 0; i < positions.count; i++) {
		const localX = positions.getX(i);
		const localZ = positions.getZ(i);
		const x = localX + centerX;
		const z = localZ + centerZ;

		// Find closest foot vertices within radius
		let closestY = minY;
		let totalWeight = 0;
		let weightedY = 0;

		for (let j = 0; j < footPositions.count; j++) {
			const fx = footPositions.getX(j);
			const fz = footPositions.getZ(j);
			const fy = footPositions.getY(j);

			const dist = Math.sqrt((x - fx) ** 2 + (z - fz) ** 2);

			// Only consider bottom surface vertices
			if (dist < sampleRadius && fy <= minY + (maxY - minY) * 0.1) {
				const weight = 1 / (1 + dist * 10); // Inverse distance weighting
				weightedY += fy * weight;
				totalWeight += weight;
			}
		}

		if (totalWeight > 0) {
			closestY = weightedY / totalWeight;
		}

		// Set height based on foot contour + template modifications
		// After rotation -PI/2 around X, Y becomes -Z
		// So we set Y to negative values to position insole "below" foot (which becomes +Z after rotation)
		const baseHeight = -(closestY - minY + 1); // Negative because Y becomes -Z after rotation
		const templateHeight = applyTemplateHeight(
			localX,
			localZ,
			width,
			depth,
			template
		);
		positions.setY(i, baseHeight - templateHeight); // Subtract because we want it below
	}

	positions.needsUpdate = true;

	// Don't rotate geometry here - let the mesh handle rotation
	// Plane geometry stays in XZ plane, mesh will rotate it to match foot

	planeGeometry.computeVertexNormals();

	console.log('Generated insole geometry:', {
		width,
		depth,
		minY,
		vertices: positions.count,
		template,
	});

	return planeGeometry;
}

/**
 * Apply template-specific height modifications
 */
function applyTemplateHeight(
	x: number,
	z: number,
	width: number,
	depth: number,
	template: InsoleTemplate
): number {
	const normalizedX = x / width;
	const normalizedZ = z / depth;

	// Arch support (around middle of foot)
	const archX = Math.abs(normalizedX);
	const archZ = Math.abs(normalizedZ - 0.3); // Arch is in middle-third
	const archDist = Math.sqrt(archX ** 2 + archZ ** 2);

	let height = 0;

	// Arch support
	if (archDist < 0.15) {
		height += 2 * (1 - archDist / 0.15); // 2mm arch support
	}

	// Heel cup
	if (normalizedZ < -0.3) {
		const heelDist = Math.sqrt(normalizedX ** 2 + (normalizedZ + 0.3) ** 2);
		if (heelDist < 0.2) {
			height += 1.5 * (1 - heelDist / 0.2); // 1.5mm heel cup
		}
	}

	// Template-specific adjustments
	switch (template) {
		case 'dunes':
			// More pronounced arch
			if (archDist < 0.15) {
				height *= 1.3;
			}
			break;

		case 'finncomfort':
			// Softer, more gradual contours
			height *= 0.8;
			break;

		case 'man':
			// Wider support areas
			break;

		case 'woman':
			// Narrower, higher arch
			if (archDist < 0.12) {
				height *= 1.2;
			}
			break;
	}

	return height;
}

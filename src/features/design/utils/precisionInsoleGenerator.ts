'use client';

import * as THREE from 'three';
import type {
	FootGeometry,
	PlantarData,
	PrecisionInsoleConfig,
	DEFAULT_PRECISION_INSOLE_CONFIG,
} from '../types/types';
import { smoothPlantarHeightmap, applyToeOffset } from './plantarExtraction';

/**
 * Generate a precision insole mesh from plantar surface data.
 *
 * The insole is built from the actual plantar heightmap captured from the foot scan,
 * ensuring exact geometric match to the patient's foot contour.
 *
 * Process:
 * 1. Start with the plantar heightmap (from raycasting)
 * 2. Apply Gaussian smoothing to remove scan noise
 * 3. Apply parametric arch boost (Gaussian at navicular)
 * 4. Apply heel cup depression (Gaussian at calcaneus)
 * 5. Optionally flatten the forefoot zone
 * 6. Apply toe offset (1–2mm anterior shrink)
 * 7. Build watertight manifold mesh: top surface + bottom surface + side walls
 *
 * @param plantarData  Extracted plantar surface data from extractPlantarSurface()
 * @param footGeom     Computed foot geometry from computeFootGeometryFrom3Points()
 * @param navicular    Auto-derived navicular position [x,y,z]
 * @param calcaneus    Auto-derived calcaneus position [x,y,z]
 * @param config       Insole generation parameters
 */
export function generatePrecisionInsole(
	plantarData: PlantarData,
	footGeom: FootGeometry,
	navicular: [number, number, number],
	calcaneus: [number, number, number],
	config: PrecisionInsoleConfig
): THREE.BufferGeometry | null {
	const [cols, rows] = plantarData.gridSize;
	const cellSize = plantarData.cellSize;
	const [minU, maxU, minV, maxV] = plantarData.bounds;

	if (cols < 5 || rows < 5) return null;

	// 1. Smooth the plantar heightmap
	const sigmaInCells = config.smoothingSigma / cellSize;
	const smoothedHeightmap = smoothPlantarHeightmap(
		plantarData.heightmap,
		cols,
		rows,
		sigmaInCells,
		2 // two passes
	);

	// 2. Build the anatomical frame vectors
	const origin = new THREE.Vector3(...footGeom.origin);
	const footAxis = new THREE.Vector3(...footGeom.footAxis);
	const lateralAxis = new THREE.Vector3(...footGeom.lateralAxis);
	const groundNormal = new THREE.Vector3(...footGeom.groundNormal);

	// 3. Compute navicular and calcaneus in local UV frame
	const navVec = new THREE.Vector3(...navicular);
	const calcVec = new THREE.Vector3(...calcaneus);
	const navRel = navVec.clone().sub(origin);
	const calcRel = calcVec.clone().sub(origin);
	const navU = navRel.dot(footAxis);
	const navV = navRel.dot(lateralAxis);
	const calcU = calcRel.dot(footAxis);
	const calcV = calcRel.dot(lateralAxis);

	// 4. Create a mask of valid cells (non-NaN in the smoothed heightmap)
	const validMask = new Uint8Array(cols * rows);
	for (let i = 0; i < cols * rows; i++) {
		validMask[i] = isNaN(smoothedHeightmap[i]) ? 0 : 1;
	}

	// 5. Apply the toe offset to the plantar outline
	let outline = plantarData.outline;
	if (config.toeOffsetMm > 0) {
		outline = applyToeOffset(
			outline,
			footGeom.footLength,
			0, // heel is at U=0 in the anatomical frame
			config.toeOffsetMm,
			0.80
		);
	}

	// 6. Apply arch boost and heel cup modifications to the heightmap
	const modifiedHeightmap = new Float32Array(smoothedHeightmap);

	const archSigmaU = 0.22 * footGeom.footLength;
	const archSigmaV = 0.35 * footGeom.forefootWidth;
	const heelSigmaU = 0.12 * footGeom.footLength;
	const heelSigmaV = 0.35 * footGeom.forefootWidth;

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const idx = row * cols + col;
			if (!validMask[idx]) continue;

			const u = minU + (col + 0.5) * cellSize;
			const v = minV + (row + 0.5) * cellSize;

			// Arch boost: Gaussian centered at navicular
			if (config.archBoost > 0 && archSigmaU > 0 && archSigmaV > 0) {
				const duNav = (u - navU) / archSigmaU;
				const dvNav = (v - navV) / archSigmaV;
				const archGauss = Math.exp(-(duNav * duNav + dvNav * dvNav));
				modifiedHeightmap[idx] += config.archBoost * footGeom.archHeight * archGauss;
			}

			// Heel cup depression: Gaussian centered at calcaneus
			if (config.heelCupDepth > 0 && heelSigmaU > 0 && heelSigmaV > 0) {
				const duH = (u - calcU) / heelSigmaU;
				const dvH = (v - calcV) / heelSigmaV;
				const heelGauss = Math.exp(-(duH * duH + dvH * dvH));
				modifiedHeightmap[idx] -= config.heelCupDepth * heelGauss;
			}

			// Forefoot flattening: blend toward a flat plane in the forefoot zone
			if (config.flattenForefoot) {
				const tU = u / footGeom.footLength;
				if (tU > 0.65) {
					const flattenWeight = smoothstep(0.65, 0.85, tU);
					// Flatten toward the average height in the forefoot zone
					modifiedHeightmap[idx] = modifiedHeightmap[idx] * (1 - flattenWeight * 0.6);
				}
			}

			// Rim height: raise edges
			if (config.rimHeight > 0) {
				const halfWidth = (maxV - minV) / 2;
				const centerV = (minV + maxV) / 2;
				const edge = Math.abs(v - centerV) / halfWidth;
				const rimWeight = smoothstep(0.65, 1.0, edge);
				modifiedHeightmap[idx] += config.rimHeight * rimWeight;
			}
		}
	}

	// 7. Count valid cells to determine vertex count
	let validCount = 0;
	const cellToVertexIdx = new Int32Array(cols * rows).fill(-1);
	for (let i = 0; i < cols * rows; i++) {
		if (validMask[i]) {
			cellToVertexIdx[i] = validCount;
			validCount++;
		}
	}

	if (validCount < 3) return null;

	// 8. Build top + bottom vertices
	const totalVertices = validCount * 2; // top + bottom
	const positions = new Float32Array(totalVertices * 3);
	const thickness = config.thickness;

	let vertIdx = 0;
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const idx = row * cols + col;
			if (!validMask[idx]) continue;

			const u = minU + (col + 0.5) * cellSize;
			const v = minV + (row + 0.5) * cellSize;
			const h = modifiedHeightmap[idx];

			// Top surface: at plantar height
			const worldPos = origin.clone()
				.add(footAxis.clone().multiplyScalar(u))
				.add(lateralAxis.clone().multiplyScalar(v))
				.add(groundNormal.clone().multiplyScalar(h));

			const topIdx = vertIdx * 3;
			positions[topIdx] = worldPos.x;
			positions[topIdx + 1] = worldPos.y;
			positions[topIdx + 2] = worldPos.z;

			// Bottom surface: offset downward by thickness
			const bottomPos = worldPos.clone()
				.add(groundNormal.clone().multiplyScalar(-thickness));

			const botIdx = (validCount + vertIdx) * 3;
			positions[botIdx] = bottomPos.x;
			positions[botIdx + 1] = bottomPos.y;
			positions[botIdx + 2] = bottomPos.z;

			vertIdx++;
		}
	}

	// 9. Build triangle indices for top and bottom surfaces
	const indices: number[] = [];

	for (let row = 0; row < rows - 1; row++) {
		for (let col = 0; col < cols - 1; col++) {
			const a = cellToVertexIdx[row * cols + col];
			const b = cellToVertexIdx[row * cols + col + 1];
			const c = cellToVertexIdx[(row + 1) * cols + col + 1];
			const d = cellToVertexIdx[(row + 1) * cols + col];

			// Skip quads with any invalid vertex
			if (a < 0 || b < 0 || c < 0 || d < 0) continue;

			// Top face (CCW winding)
			indices.push(a, b, d);
			indices.push(b, c, d);

			// Bottom face (CW winding = inverted)
			const a2 = validCount + a;
			const b2 = validCount + b;
			const c2 = validCount + c;
			const d2 = validCount + d;
			indices.push(a2, d2, b2);
			indices.push(b2, d2, c2);
		}
	}

	// 10. Build side walls: connect top and bottom boundary edges
	for (let row = 0; row < rows - 1; row++) {
		for (let col = 0; col < cols - 1; col++) {
			const idx = row * cols + col;

			// Check each edge of the quad to see if it's on the boundary
			const vIdx = cellToVertexIdx[idx];
			if (vIdx < 0) continue;

			// Right edge
			const rightIdx = row * cols + col + 1;
			const rightV = cellToVertexIdx[rightIdx];
			// Down edge
			const downIdx = (row + 1) * cols + col;
			const downV = cellToVertexIdx[downIdx];

			// Left boundary: this cell is valid but left neighbor is not
			if (col === 0 || cellToVertexIdx[row * cols + col - 1] < 0) {
				if (downV >= 0) {
					// Left wall: connect top(vIdx,downV) to bottom
					indices.push(vIdx, validCount + vIdx, downV);
					indices.push(downV, validCount + vIdx, validCount + downV);
				}
			}

			// Right boundary: right neighbor is invalid or at edge
			if (rightV >= 0 && (col + 1 === cols - 1 || cellToVertexIdx[row * cols + col + 2] < 0)) {
				if (cellToVertexIdx[(row + 1) * cols + col + 1] >= 0) {
					const nextDown = cellToVertexIdx[(row + 1) * cols + col + 1];
					indices.push(rightV, nextDown, validCount + rightV);
					indices.push(nextDown, validCount + nextDown, validCount + rightV);
				}
			}

			// Top boundary: this cell is valid but up neighbor is not
			if (row === 0 || cellToVertexIdx[(row - 1) * cols + col] < 0) {
				if (rightV >= 0) {
					indices.push(vIdx, rightV, validCount + vIdx);
					indices.push(rightV, validCount + rightV, validCount + vIdx);
				}
			}

			// Bottom boundary: down neighbor is invalid or at edge
			if (downV >= 0 && (row + 1 === rows - 1 || cellToVertexIdx[(row + 2) * cols + col] < 0)) {
				const rightDown = cellToVertexIdx[(row + 1) * cols + col + 1];
				if (rightDown >= 0) {
					indices.push(downV, validCount + downV, rightDown);
					indices.push(rightDown, validCount + downV, validCount + rightDown);
				}
			}
		}
	}

	// 11. Assemble final geometry
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();

	return geometry;
}

/**
 * Full pipeline: takes foot scan + 3-point landmarks + config and produces
 * a precision insole geometry in one call.
 */
export function generateInsoleFromScan(
	footScanGeometry: THREE.BufferGeometry,
	landmarks: {
		meta5: [number, number, number];
		meta1: [number, number, number];
		heel: [number, number, number];
	},
	footGeom: FootGeometry,
	derived: {
		navicular: [number, number, number];
		calcaneus: [number, number, number];
	},
	plantarData: PlantarData,
	config: PrecisionInsoleConfig
): THREE.BufferGeometry | null {
	return generatePrecisionInsole(
		plantarData,
		footGeom,
		derived.navicular,
		derived.calcaneus,
		config
	);
}

// ============================================
// Helpers
// ============================================

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

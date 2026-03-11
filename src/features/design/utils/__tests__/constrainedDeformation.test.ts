import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSurfaceModel, VertexZone, AnatomicalRegion } from '../insoleSurfaceModel';
import { solveConstrainedDeformation } from '../constrainedDeformation';
import type { DisplacementField } from '../constrainedDeformation';
import { computeWidthFitTargets } from '../scanCorrespondence';

function makeInsoleGeometry(): THREE.BufferGeometry {
	const positions: number[] = [];
	const indices: number[] = [];
	const resX = 40;
	const resY = 20;
	const resZ = 4;
	const lengthMm = 250;
	const widthMm = 90;
	const thicknessMm = 8;

	for (let xi = 0; xi <= resX; xi++) {
		const x = (xi / resX) * lengthMm;
		const t = xi / resX;
		const halfW = widthMm * 0.5 * (0.6 + 0.4 * Math.sin(Math.PI * t));
		for (let yi = 0; yi <= resY; yi++) {
			const yNorm = yi / resY;
			const y = -halfW + yNorm * halfW * 2;
			const archHeight = t > 0.15 && t < 0.5
				? 4 * Math.sin(Math.PI * (t - 0.15) / 0.35) * (1 - Math.abs(yNorm - 0.5) * 2)
				: 0;
			const h = thicknessMm + 2 * Math.sin(Math.PI * t) * (1 - Math.abs(yNorm - 0.5) * 2) + archHeight;
			positions.push(x, y, h);
		}
	}

	for (let xi = 0; xi <= resX; xi++) {
		const halfW = widthMm * 0.5 * (0.6 + 0.4 * Math.sin(Math.PI * (xi / resX)));
		for (let yi = 0; yi <= resY; yi++) {
			const x = (xi / resX) * lengthMm;
			const yNorm = yi / resY;
			const y = -halfW + yNorm * halfW * 2;
			positions.push(x, y, 0);
		}
	}

	const topStart = 0;
	const bottomStart = (resX + 1) * (resY + 1);

	for (let xi = 0; xi < resX; xi++) {
		for (let yi = 0; yi < resY; yi++) {
			const tl = topStart + xi * (resY + 1) + yi;
			const tr = topStart + (xi + 1) * (resY + 1) + yi;
			indices.push(tl, tr, tl + 1);
			indices.push(tl + 1, tr, tr + 1);

			const bl = bottomStart + xi * (resY + 1) + yi;
			const br = bottomStart + (xi + 1) * (resY + 1) + yi;
			indices.push(bl, bl + 1, br);
			indices.push(bl + 1, br + 1, br);
		}
	}

	const wallStart = positions.length / 3;
	for (const border of [0, resY]) {
		for (let xi = 0; xi <= resX; xi++) {
			for (let zi = 0; zi <= resZ; zi++) {
				const topIdx = topStart + xi * (resY + 1) + border;
				const botIdx = bottomStart + xi * (resY + 1) + border;
				const tx = positions[topIdx * 3], ty = positions[topIdx * 3 + 1], tz = positions[topIdx * 3 + 2];
				const bx = positions[botIdx * 3], by = positions[botIdx * 3 + 1], bz = positions[botIdx * 3 + 2];
				const frac = zi / resZ;
				positions.push(tx + (bx - tx) * frac, ty + (by - ty) * frac, tz + (bz - tz) * frac);
			}
		}
	}

	for (let side = 0; side < 2; side++) {
		const base = wallStart + side * (resX + 1) * (resZ + 1);
		for (let xi = 0; xi < resX; xi++) {
			for (let zi = 0; zi < resZ; zi++) {
				const a = base + xi * (resZ + 1) + zi;
				const b = base + (xi + 1) * (resZ + 1) + zi;
				indices.push(a, b, a + 1);
				indices.push(a + 1, b, b + 1);
			}
		}
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geom.setIndex(indices);
	geom.computeVertexNormals();
	return geom;
}

function makeWidthExpandField(
	geom: THREE.BufferGeometry,
	model: ReturnType<typeof buildSurfaceModel>,
	scaleFactor: number,
): DisplacementField {
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const vertCount = pos.count;
	const { widthAxis, widthSpan, bbox } = model.axes;
	const wIdx = widthAxis === 'x' ? 0 : widthAxis === 'y' ? 1 : 2;
	const centerW = (bbox.min[widthAxis] + bbox.max[widthAxis]) * 0.5;

	const targets = new Float32Array(vertCount * 3);
	const weights = new Float32Array(vertCount);
	const budgets = new Float32Array(vertCount);

	for (let v = 0; v < vertCount; v++) {
		targets[v * 3] = pos.getX(v);
		targets[v * 3 + 1] = pos.getY(v);
		targets[v * 3 + 2] = pos.getZ(v);

		const wVal = wIdx === 0 ? pos.getX(v) : wIdx === 1 ? pos.getY(v) : pos.getZ(v);
		targets[v * 3 + wIdx] = centerW + (wVal - centerW) * scaleFactor;

		weights[v] = 1.0;

		switch (model.zones[v]) {
			case VertexZone.Bottom: budgets[v] = 0; break;
			case VertexZone.Wall: budgets[v] = widthSpan * 0.05; break;
			case VertexZone.Rim: budgets[v] = widthSpan * 0.10; break;
			default: budgets[v] = widthSpan * 0.15; break;
		}
	}

	return { targetPositions: targets, weights, budgets, confidence: 1.0 };
}

function getHeightValues(
	geom: THREE.BufferGeometry,
	model: ReturnType<typeof buildSurfaceModel>,
	regionFilter?: number,
): number[] {
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const heights: number[] = [];
	for (let i = 0; i < model.vertCount; i++) {
		if (model.zones[i] !== VertexZone.Top) continue;
		if (regionFilter !== undefined && model.regions[i] !== regionFilter) continue;
		heights.push(pos.getZ(i));
	}
	return heights;
}

function getLengthValues(
	geom: THREE.BufferGeometry,
	model: ReturnType<typeof buildSurfaceModel>,
): number[] {
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const values: number[] = [];
	for (let i = 0; i < model.vertCount; i++) {
		if (model.zones[i] !== VertexZone.Top) continue;
		values.push(pos.getX(i));
	}
	return values;
}

describe('solveConstrainedDeformation - direction isolation', () => {
	it('does not move non-width axes (height and length stay at base)', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const baseHeights = new Map<number, number>();
		const baseLengths = new Map<number, number>();
		for (let i = 0; i < model.vertCount; i++) {
			baseHeights.set(i, pos.getZ(i));
			baseLengths.set(i, pos.getX(i));
		}

		const field = makeWidthExpandField(geom, model, 1.15);
		solveConstrainedDeformation(geom, model, field);

		for (let i = 0; i < model.vertCount; i++) {
			expect(pos.getZ(i)).toBeCloseTo(baseHeights.get(i)!, 5);
			expect(pos.getX(i)).toBeCloseTo(baseLengths.get(i)!, 5);
		}
	});

	it('only moves the width axis for Top vertices', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const baseWidths = new Map<number, number>();
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Top) {
				baseWidths.set(i, pos.getY(i));
			}
		}

		const field = makeWidthExpandField(geom, model, 1.15);
		solveConstrainedDeformation(geom, model, field);

		let movedCount = 0;
		for (const [idx, baseW] of baseWidths) {
			if (Math.abs(pos.getY(idx) - baseW) > 0.001) movedCount++;
		}
		expect(movedCount).toBeGreaterThan(0);
	});
});

describe('solveConstrainedDeformation - region isolation', () => {
	it('arch midfoot deforms less than forefoot through the full pipeline', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const baseWidths = new Float32Array(model.vertCount);
		for (let i = 0; i < model.vertCount; i++) baseWidths[i] = pos.getY(i);

		const profile = {
			halfWidthsWorld: Array.from({ length: 48 }, (_, i) => {
				const t = i / 47;
				return 55 * (0.6 + 0.4 * Math.sin(Math.PI * t));
			}),
			lengthWorld: 250,
		};

		const field = computeWidthFitTargets(geom, model, {
			side: 'right',
			mmToWorld: 1,
			trimlineProfile: profile,
			trimOffsetWorld: 5,
		});

		expect(field).not.toBeNull();
		if (!field) return;

		solveConstrainedDeformation(geom, model, field);

		let archDisp = 0, archCount = 0;
		let foreDisp = 0, foreCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] !== VertexZone.Top) continue;
			const dw = Math.abs(pos.getY(i) - baseWidths[i]);
			if (model.regions[i] === AnatomicalRegion.ArchMidfoot) {
				archDisp += dw; archCount++;
			} else if (model.regions[i] === AnatomicalRegion.Forefoot) {
				foreDisp += dw; foreCount++;
			}
		}

		const avgArch = archCount > 0 ? archDisp / archCount : 0;
		const avgFore = foreCount > 0 ? foreDisp / foreCount : 0;
		expect(avgArch).toBeLessThan(avgFore);
	});

	it('heel deforms less than forefoot under same width expansion', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const baseWidths = new Float32Array(model.vertCount);
		for (let i = 0; i < model.vertCount; i++) baseWidths[i] = pos.getY(i);

		const field = makeWidthExpandField(geom, model, 1.2);
		solveConstrainedDeformation(geom, model, field);

		let heelDisp = 0, heelCount = 0;
		let foreDisp = 0, foreCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] !== VertexZone.Top) continue;
			const dw = Math.abs(pos.getY(i) - baseWidths[i]);
			if (model.regions[i] === AnatomicalRegion.Heel) {
				heelDisp += dw; heelCount++;
			} else if (model.regions[i] === AnatomicalRegion.Forefoot) {
				foreDisp += dw; foreCount++;
			}
		}

		const avgHeel = heelCount > 0 ? heelDisp / heelCount : 0;
		const avgFore = foreCount > 0 ? foreDisp / foreCount : 0;
		expect(avgHeel).toBeLessThan(avgFore);
	});
});

describe('solveConstrainedDeformation - arch curvature preservation', () => {
	it('arch top surface retains monotonic height profile after deformation', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const archHeightsBefore: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Top && model.regions[i] === AnatomicalRegion.ArchMidfoot) {
				archHeightsBefore.push(pos.getZ(i));
			}
		}

		const field = makeWidthExpandField(geom, model, 1.15);
		solveConstrainedDeformation(geom, model, field);

		const archHeightsAfter: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Top && model.regions[i] === AnatomicalRegion.ArchMidfoot) {
				archHeightsAfter.push(pos.getZ(i));
			}
		}

		for (let i = 0; i < archHeightsBefore.length; i++) {
			expect(archHeightsAfter[i]).toBeCloseTo(archHeightsBefore[i], 5);
		}
	});

	it('high-curvature vertices move less than low-curvature vertices', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const baseWidths = new Float32Array(model.vertCount);
		for (let i = 0; i < model.vertCount; i++) baseWidths[i] = pos.getY(i);

		const field = makeWidthExpandField(geom, model, 1.2);
		solveConstrainedDeformation(geom, model, field);

		let highCurvDisp = 0, highCurvCount = 0;
		let lowCurvDisp = 0, lowCurvCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] !== VertexZone.Top) continue;
			const dw = Math.abs(pos.getY(i) - baseWidths[i]);
			if (model.curvature[i] > 0.5) {
				highCurvDisp += dw; highCurvCount++;
			} else if (model.curvature[i] < 0.2) {
				lowCurvDisp += dw; lowCurvCount++;
			}
		}

		if (highCurvCount > 0 && lowCurvCount > 0) {
			const avgHigh = highCurvDisp / highCurvCount;
			const avgLow = lowCurvDisp / lowCurvCount;
			expect(avgHigh).toBeLessThanOrEqual(avgLow);
		}
	});
});

describe('solveConstrainedDeformation - top-to-wall isolation', () => {
	it('top surface deformation does not propagate into unrelated wall regions', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const wallBefore = new Map<number, [number, number, number]>();
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Wall) {
				wallBefore.set(i, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
			}
		}

		const field = makeWidthExpandField(geom, model, 1.2);
		solveConstrainedDeformation(geom, model, field);

		let maxHeightDrift = 0;
		let maxLengthDrift = 0;
		for (const [idx, [bx, _by, bz]] of wallBefore) {
			maxHeightDrift = Math.max(maxHeightDrift, Math.abs(pos.getZ(idx) - bz));
			maxLengthDrift = Math.max(maxLengthDrift, Math.abs(pos.getX(idx) - bx));
		}

		expect(maxHeightDrift).toBeLessThan(0.001);
		expect(maxLengthDrift).toBeLessThan(0.001);
	});
});

describe('solveConstrainedDeformation - bottom stays frozen', () => {
	it('bottom vertices are never modified', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const bottomBefore = new Map<number, [number, number, number]>();
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				bottomBefore.set(i, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
			}
		}

		const field = makeWidthExpandField(geom, model, 1.2);
		solveConstrainedDeformation(geom, model, field);

		for (const [idx, [bx, by, bz]] of bottomBefore) {
			expect(pos.getX(idx)).toBeCloseTo(bx, 5);
			expect(pos.getY(idx)).toBeCloseTo(by, 5);
			expect(pos.getZ(idx)).toBeCloseTo(bz, 5);
		}
	});
});

describe('computeWidthFitTargets - region-aware budgets', () => {
	it('arch midfoot budgets are smaller than forefoot budgets', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		const profile = {
			halfWidthsWorld: Array.from({ length: 48 }, (_, i) => {
				const t = i / 47;
				return 50 * (0.6 + 0.4 * Math.sin(Math.PI * t));
			}),
			lengthWorld: 250,
		};

		const field = computeWidthFitTargets(geom, model, {
			side: 'right',
			mmToWorld: 1,
			trimlineProfile: profile,
			trimOffsetWorld: 3,
		});

		expect(field).not.toBeNull();
		if (!field) return;

		let archBudgetSum = 0, archCount = 0;
		let foreBudgetSum = 0, foreCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Top) {
				if (model.regions[i] === AnatomicalRegion.ArchMidfoot) {
					archBudgetSum += field.budgets[i]; archCount++;
				} else if (model.regions[i] === AnatomicalRegion.Forefoot) {
					foreBudgetSum += field.budgets[i]; foreCount++;
				}
			}
		}

		const avgArchBudget = archCount > 0 ? archBudgetSum / archCount : 0;
		const avgForeBudget = foreCount > 0 ? foreBudgetSum / foreCount : 0;
		expect(avgArchBudget).toBeLessThan(avgForeBudget);
	});

	it('weights are attenuated at region transitions', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		const profile = {
			halfWidthsWorld: Array.from({ length: 48 }, (_, i) => {
				const t = i / 47;
				return 50 * (0.6 + 0.4 * Math.sin(Math.PI * t));
			}),
			lengthWorld: 250,
		};

		const field = computeWidthFitTargets(geom, model, {
			side: 'right',
			mmToWorld: 1,
			trimlineProfile: profile,
			trimOffsetWorld: 3,
		});

		expect(field).not.toBeNull();
		if (!field) return;

		let transitionWeightSum = 0, transitionCount = 0;
		let interiorWeightSum = 0, interiorCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] !== VertexZone.Top) continue;
			if (model.regionTransition[i] > 0.5) {
				transitionWeightSum += field.weights[i]; transitionCount++;
			} else if (model.regionTransition[i] < 0.1) {
				interiorWeightSum += field.weights[i]; interiorCount++;
			}
		}

		if (transitionCount > 0 && interiorCount > 0) {
			const avgTransition = transitionWeightSum / transitionCount;
			const avgInterior = interiorWeightSum / interiorCount;
			expect(avgTransition).toBeLessThan(avgInterior);
		}
	});
});

describe('surface model - deformable mask', () => {
	it('arch and heel regions are explicitly protected and stiffened', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		let archProtected = 0;
		let heelProtected = 0;

		for (let i = 0; i < model.vertCount; i++) {
			if (model.archSupportMask[i] === 1) {
				archProtected++;
				expect(model.protectedMask[i]).toBe(1);
				expect(model.shapePreservingWeight[i]).toBeGreaterThan(0.8);
				expect(model.tangentialAllowance[i]).toBeGreaterThan(0);
			}
			if (model.heelSupportMask[i] === 1) {
				heelProtected++;
				expect(model.protectedMask[i]).toBe(1);
				expect(model.shapePreservingWeight[i]).toBeGreaterThan(0.85);
				expect(model.tangentialAllowance[i]).toBeGreaterThan(0);
			}
		}

		expect(archProtected).toBeGreaterThan(0);
		expect(heelProtected).toBeGreaterThan(0);
	});

	it('top-to-wall and heel-arch transitions are never deformable', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		for (let i = 0; i < model.vertCount; i++) {
			if (model.topToWallTransition[i] === 1 || model.heelArchTransition[i] === 1) {
				expect(model.deformableMask[i]).toBe(0);
				expect(model.smoothingExclusionMask[i]).toBe(1);
			}
		}
	});

	it('Rim and Wall zones are never deformable', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		for (let i = 0; i < model.vertCount; i++) {
			if (
				model.zones[i] === VertexZone.Rim ||
				model.zones[i] === VertexZone.Wall ||
				model.zones[i] === VertexZone.Bottom
			) {
				expect(model.deformableMask[i]).toBe(0);
			}
		}
	});

	it('some interior forefoot vertices are deformable', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		let deformableCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.deformableMask[i] === 1) deformableCount++;
		}
		expect(deformableCount).toBeGreaterThan(0);
	});
});

describe('surface model - anatomical regions', () => {
	it('assigns all four anatomical regions', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		const regionCounts = new Uint32Array(4);
		for (let i = 0; i < model.vertCount; i++) {
			regionCounts[model.regions[i]]++;
		}

		expect(regionCounts[AnatomicalRegion.Heel]).toBeGreaterThan(0);
		expect(regionCounts[AnatomicalRegion.ArchMidfoot]).toBeGreaterThan(0);
		expect(regionCounts[AnatomicalRegion.Forefoot]).toBeGreaterThan(0);
		expect(regionCounts[AnatomicalRegion.Toe]).toBeGreaterThan(0);
	});

	it('computes non-trivial curvature values', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		let nonZero = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.curvature[i] > 0.01) nonZero++;
		}
		expect(nonZero).toBeGreaterThan(model.vertCount * 0.1);
	});

	it('marks region transitions near boundaries', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		let transitionCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.regionTransition[i] > 0.5) transitionCount++;
		}
		expect(transitionCount).toBeGreaterThan(0);
		expect(transitionCount).toBeLessThan(model.vertCount * 0.3);
	});
});

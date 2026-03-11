import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	buildSurfaceModel,
	enforceBottomPlanarity,
	constrainedLaplacianSmooth,
	smoothShellSurface,
	finishInsoleShell,
	computeInsoleAxes,
	VertexZone,
} from '@/src/features/design/utils/insoleSurfaceModel';
import { applyAllCorrections } from '@/src/features/design/utils/insoleCorrections';
import type { OntwerpCorrections } from '@/src/shared/components/design/OntwerpPanel';

function makeInsoleGeometry(): THREE.BufferGeometry {
	const positions: number[] = [];
	const indices: number[] = [];
	const resX = 40;
	const resY = 20;
	const resZ = 4;
	const lengthMm = 250;
	const widthMm = 90;
	const thicknessMm = 8;

	// Top surface
	for (let xi = 0; xi <= resX; xi++) {
		const x = (xi / resX) * lengthMm;
		const t = xi / resX;
		const halfW = widthMm * 0.5 * (0.6 + 0.4 * Math.sin(Math.PI * t));
		for (let yi = 0; yi <= resY; yi++) {
			const yNorm = yi / resY;
			const y = -halfW + yNorm * halfW * 2;
			const h = thicknessMm + 2 * Math.sin(Math.PI * t) * (1 - Math.abs(yNorm - 0.5) * 2);
			positions.push(x, y, h);
		}
	}

	// Bottom surface
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

	// Side walls connecting top edge to bottom edge (left and right borders)
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

function makeDefaultCorrections(): OntwerpCorrections {
	return {
		kuipHoogte: { left: 3, right: 3 },
		voorvoetUitvlakken: { enabled: true },
		hielHeffing: { value: { left: 2, right: 2 }, length: { left: 'midden', right: 'midden' } },
		medialeBoogCorrectie: { left: 4, right: 4 },
		gladstrijken: 5,
		pronatie: { correctie: { left: 3, right: 3 }, regio: { left: 'gehele-zool', right: 'gehele-zool' } },
		supinatie: { correctie: { left: 0, right: 0 }, regio: { left: 'gehele-zool', right: 'gehele-zool' } },
		mediaalVlak: { waarde: { left: 0, right: 0 }, hoogte: { left: 'midden', right: 'midden' } },
		lateraalVlak: { waarde: { left: 0, right: 0 }, hoogte: { left: 'midden', right: 'midden' } },
		apexMiddenvoet: { left: 0, right: 0 },
		apexHiel: { left: 0, right: 0 },
		hielbeenCorrectie: { waarde: { left: 0, right: 0 }, zijde: { left: 'mediaal', right: 'mediaal' } },
		hielbreedteCorrectie: { left: 0, right: 0 },
		zoolbreedte: { left: 0, right: 0 },
	} as OntwerpCorrections;
}

describe('buildSurfaceModel', () => {
	it('classifies all vertices into known zones', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		expect(model.vertCount).toBe(geom.getAttribute('position').count);
		for (let i = 0; i < model.vertCount; i++) {
			expect([VertexZone.Top, VertexZone.Rim, VertexZone.Wall, VertexZone.Bottom]).toContain(model.zones[i]);
		}
	});

	it('identifies bottom vertices', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		let bottomCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) bottomCount++;
		}
		expect(bottomCount).toBeGreaterThan(0);
	});

	it('identifies top surface vertices', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		let topCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Top) topCount++;
		}
		expect(topCount).toBeGreaterThan(0);
	});
});

describe('enforceBottomPlanarity', () => {
	it('sets all bottom vertices to the same height after corrections', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				pos.setZ(i, pos.getZ(i) + Math.random() * 2);
			}
		}
		pos.needsUpdate = true;

		enforceBottomPlanarity(geom, model);

		const updatedPos = geom.getAttribute('position') as THREE.BufferAttribute;
		const heights: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				heights.push(updatedPos.getZ(i));
			}
		}

		const maxDev = Math.max(...heights) - Math.min(...heights);
		expect(maxDev).toBeLessThan(0.001);
	});
});

describe('corrections preserve bottom planarity', () => {
	it('bottom vertices stay flat after applyAllCorrections with surface model', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const corrections = makeDefaultCorrections();

		const pos = geom.getAttribute('position') as THREE.BufferAttribute;
		const bottomHeightsBefore: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				bottomHeightsBefore.push(pos.getZ(i));
			}
		}

		applyAllCorrections(geom, corrections, 'right', {
			mmToWorld: 1,
			surfaceModel: model,
		});

		const bottomHeightsAfter: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				bottomHeightsAfter.push(pos.getZ(i));
			}
		}

		for (let i = 0; i < bottomHeightsBefore.length; i++) {
			expect(Math.abs(bottomHeightsAfter[i] - bottomHeightsBefore[i])).toBeLessThan(0.001);
		}
	});
});

describe('silhouette preservation', () => {
	it('non-width corrections do not change width-axis extents', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		geom.computeBoundingBox();
		const beforeWidth = geom.boundingBox!.max.y - geom.boundingBox!.min.y;
		const beforeLength = geom.boundingBox!.max.x - geom.boundingBox!.min.x;

		const corrections = makeDefaultCorrections();
		corrections.zoolbreedte = { left: 0, right: 0 } as OntwerpCorrections['zoolbreedte'];
		corrections.hielbreedteCorrectie = { left: 0, right: 0 } as OntwerpCorrections['hielbreedteCorrectie'];

		applyAllCorrections(geom, corrections, 'right', {
			mmToWorld: 1,
			surfaceModel: model,
		});

		geom.computeBoundingBox();
		const afterWidth = geom.boundingBox!.max.y - geom.boundingBox!.min.y;
		const afterLength = geom.boundingBox!.max.x - geom.boundingBox!.min.x;

		expect(Math.abs(afterWidth - beforeWidth)).toBeLessThan(1);
		expect(Math.abs(afterLength - beforeLength)).toBeLessThan(0.01);
	});
});

describe('constrainedLaplacianSmooth', () => {
	it('only modifies top surface vertices', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const bottomBefore = new Map<number, number>();
		const wallBefore = new Map<number, [number, number, number]>();
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				bottomBefore.set(i, pos.getZ(i));
			} else if (model.zones[i] === VertexZone.Wall) {
				wallBefore.set(i, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
			}
		}

		constrainedLaplacianSmooth(geom, model, 5, 0.3);

		for (const [idx, h] of bottomBefore) {
			expect(pos.getZ(idx)).toBeCloseTo(h, 5);
		}
		for (const [idx, [x, y, z]] of wallBefore) {
			expect(pos.getX(idx)).toBeCloseTo(x, 5);
			expect(pos.getY(idx)).toBeCloseTo(y, 5);
			expect(pos.getZ(idx)).toBeCloseTo(z, 5);
		}
	});
});

describe('computeInsoleAxes', () => {
	it('identifies length as the longest axis', () => {
		const geom = makeInsoleGeometry();
		const axes = computeInsoleAxes(geom);

		expect(axes.lengthSpan).toBeGreaterThan(axes.widthSpan);
		expect(axes.widthSpan).toBeGreaterThan(axes.heightSpan);
	});
});

describe('bottom planarity covers full perimeter', () => {
	it('the vast majority of z=0 vertices are classified as Bottom', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		let totalFlat = 0;
		let classifiedBottom = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (Math.abs(pos.getZ(i)) < 0.01) {
				totalFlat++;
				if (model.zones[i] === VertexZone.Bottom) classifiedBottom++;
			}
		}
		expect(totalFlat).toBeGreaterThan(0);
		expect(classifiedBottom / totalFlat).toBeGreaterThan(0.95);
	});

	it('enforceBottomPlanarity flattens all bottom-zone vertices including perimeter', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 3);
			}
		}
		pos.needsUpdate = true;

		enforceBottomPlanarity(geom, model);

		const heights: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				heights.push(pos.getZ(i));
			}
		}
		const maxDev = Math.max(...heights) - Math.min(...heights);
		expect(maxDev).toBeLessThan(0.001);
	});
});

describe('smoothShellSurface', () => {
	it('does not modify Top vertices', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const topBefore = new Map<number, [number, number, number]>();
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Top) {
				topBefore.set(i, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
			}
		}

		smoothShellSurface(geom, model, 5, 0.4);

		for (const [idx, [x, y, z]] of topBefore) {
			expect(pos.getX(idx)).toBeCloseTo(x, 5);
			expect(pos.getY(idx)).toBeCloseTo(y, 5);
			expect(pos.getZ(idx)).toBeCloseTo(z, 5);
		}
	});

	it('reduces wall vertex variance (smooths step artifacts)', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Wall) {
				pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 2);
			}
		}
		pos.needsUpdate = true;

		const wallHeightsBefore: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Wall) {
				wallHeightsBefore.push(pos.getZ(i));
			}
		}
		const varianceBefore = variance(wallHeightsBefore);

		smoothShellSurface(geom, model, 5, 0.4);

		const wallHeightsAfter: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Wall) {
				wallHeightsAfter.push(pos.getZ(i));
			}
		}
		const varianceAfter = variance(wallHeightsAfter);

		expect(varianceAfter).toBeLessThan(varianceBefore);
	});

	it('bottom stays flat after shell smoothing', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);

		smoothShellSurface(geom, model, 5, 0.4);

		const pos = geom.getAttribute('position') as THREE.BufferAttribute;
		const bottomH: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				bottomH.push(pos.getZ(i));
			}
		}
		const maxDev = Math.max(...bottomH) - Math.min(...bottomH);
		expect(maxDev).toBeLessThan(0.001);
	});
});

describe('perimeter classification', () => {
	it('reclassifies Top vertices adjacent to Wall as Rim', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		let rimCount = 0;
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Rim) rimCount++;
		}
		expect(rimCount).toBeGreaterThan(0);

		const idx = geom.index!;
		const ia = idx.array;
		const fc = ia.length / 3;
		for (let f = 0; f < fc; f++) {
			const tri = [ia[f * 3], ia[f * 3 + 1], ia[f * 3 + 2]];
			const hasWallOrBottom = tri.some(v =>
				model.zones[v] === VertexZone.Wall || model.zones[v] === VertexZone.Bottom
			);
			if (!hasWallOrBottom) continue;
			for (const v of tri) {
				expect(model.zones[v]).not.toBe(VertexZone.Top);
			}
		}
	});

	it('most vertices at the very tip of toe/heel are Rim, not Top', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const axes = computeInsoleAxes(geom);
		const lenMax = axes.bbox.max[axes.lengthAxis];
		const tipSlice = axes.lengthSpan * 0.005;

		let tipTotal = 0;
		let tipRim = 0;
		for (let i = 0; i < model.vertCount; i++) {
			const lv = axes.lengthAxis === 'x' ? pos.getX(i)
				: axes.lengthAxis === 'y' ? pos.getY(i) : pos.getZ(i);
			const h = pos.getZ(i);
			if (lv >= lenMax - tipSlice && h > model.bottomPlaneH + 1) {
				tipTotal++;
				if (model.zones[i] === VertexZone.Rim) tipRim++;
			}
		}
		expect(tipTotal).toBeGreaterThan(0);
		expect(tipRim / tipTotal).toBeGreaterThan(0.8);
	});
});

describe('transition blending', () => {
	it('wall-to-bottom step variance decreases after smoothShellSurface', () => {
		const geom = makeInsoleGeometry();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Wall) {
				pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 3);
			}
		}
		pos.needsUpdate = true;

		const transitionRange = model.axes.heightSpan * 0.15;
		const collectNearBottomWall = () => {
			const heights: number[] = [];
			for (let i = 0; i < model.vertCount; i++) {
				if (model.zones[i] !== VertexZone.Wall) continue;
				const h = pos.getZ(i);
				if (Math.abs(h - model.bottomPlaneH) < transitionRange) heights.push(h);
			}
			return heights;
		};

		const before = collectNearBottomWall();
		const varBefore = variance(before);

		smoothShellSurface(geom, model, 6, 0.35);

		const after = collectNearBottomWall();
		const varAfter = variance(after);

		expect(varAfter).toBeLessThan(varBefore);
	});
});

describe('finishInsoleShell', () => {
	it('preserves Top vertex heights', () => {
		const geom = makeInsoleGeometry();
		const base = geom.clone();
		const model = buildSurfaceModel(geom);
		const pos = geom.getAttribute('position') as THREE.BufferAttribute;

		const topBefore = new Map<number, number>();
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Top) {
				topBefore.set(i, pos.getZ(i));
			}
		}

		finishInsoleShell(geom, base, model);

		for (const [idx, h] of topBefore) {
			expect(pos.getZ(idx)).toBeCloseTo(h, 2);
		}
	});

	it('keeps bottom flat after full finishing', () => {
		const geom = makeInsoleGeometry();
		const base = geom.clone();
		const model = buildSurfaceModel(geom);

		finishInsoleShell(geom, base, model);

		const pos = geom.getAttribute('position') as THREE.BufferAttribute;
		const bottomH: number[] = [];
		for (let i = 0; i < model.vertCount; i++) {
			if (model.zones[i] === VertexZone.Bottom) {
				bottomH.push(pos.getZ(i));
			}
		}
		const maxDev = Math.max(...bottomH) - Math.min(...bottomH);
		expect(maxDev).toBeLessThan(0.001);
	});

	it('does not shrink the corrected top-surface bounding envelope', () => {
		const geom = makeInsoleGeometry();
		const base = geom.clone();
		const model = buildSurfaceModel(geom);

		geom.computeBoundingBox();
		const beforeBox = geom.boundingBox!.clone();

		finishInsoleShell(geom, base, model);

		geom.computeBoundingBox();
		const afterBox = geom.boundingBox!;

		expect(afterBox.max.x).toBeGreaterThanOrEqual(beforeBox.max.x - 1.5);
		expect(afterBox.max.y).toBeGreaterThanOrEqual(beforeBox.max.y - 1.5);
		expect(afterBox.min.x).toBeLessThanOrEqual(beforeBox.min.x + 1.5);
		expect(afterBox.min.y).toBeLessThanOrEqual(beforeBox.min.y + 1.5);
	});
});

function variance(arr: number[]): number {
	if (arr.length === 0) return 0;
	const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
	return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}

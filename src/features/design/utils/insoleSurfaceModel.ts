import * as THREE from 'three';

export interface InsoleAxes {
	lengthAxis: 'x' | 'y' | 'z';
	widthAxis: 'x' | 'y' | 'z';
	heightAxis: 'x' | 'y' | 'z';
	bbox: THREE.Box3;
	lengthSpan: number;
	widthSpan: number;
	heightSpan: number;
}

export interface HeelToToeMapper {
	heelAtMin: boolean;
	getT: (lengthVal: number) => number;
}

export const enum VertexZone {
	Top = 0,
	Rim = 1,
	Wall = 2,
	Bottom = 3,
}

export const enum AnatomicalRegion {
	Heel = 0,
	ArchMidfoot = 1,
	Forefoot = 2,
	Toe = 3,
}

export interface InsoleSurfaceModel {
	axes: InsoleAxes;
	heelMapper: HeelToToeMapper;
	zones: Uint8Array;
	regions: Uint8Array;
	vertCount: number;
	bottomPlaneH: number;
	rimEdgeMask: Uint8Array;
	curvature: Float32Array;
	regionTransition: Float32Array;
	/** 1 = vertex is Top or Rim adjacent to Wall; must not deform to preserve blend */
	topToWallTransition: Uint8Array;
	/** 1 = vertex is in heel-arch or arch-forefoot transition band; must not deform */
	heelArchTransition: Uint8Array;
	/** 1 = interior Top only; safe to deform. 0 = Rim, Wall, Bottom, or Top adjacent to Rim */
	deformableMask: Uint8Array;
}

function axGet(pos: THREE.BufferAttribute, i: number, axis: 'x' | 'y' | 'z'): number {
	return axis === 'x' ? pos.getX(i) : axis === 'y' ? pos.getY(i) : pos.getZ(i);
}

function axSet(pos: THREE.BufferAttribute, i: number, axis: 'x' | 'y' | 'z', v: number) {
	if (axis === 'x') pos.setX(i, v);
	else if (axis === 'y') pos.setY(i, v);
	else pos.setZ(i, v);
}

export function computeInsoleAxes(geometry: THREE.BufferGeometry): InsoleAxes {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const sizeX = bbox.max.x - bbox.min.x;
	const sizeY = bbox.max.y - bbox.min.y;
	const sizeZ = bbox.max.z - bbox.min.z;

	const sorted = [
		{ axis: 'x' as const, size: sizeX },
		{ axis: 'y' as const, size: sizeY },
		{ axis: 'z' as const, size: sizeZ },
	].sort((a, b) => b.size - a.size);

	return {
		lengthAxis: sorted[0].axis,
		widthAxis: sorted[1].axis,
		heightAxis: sorted[2].axis,
		bbox,
		lengthSpan: sorted[0].size,
		widthSpan: sorted[1].size,
		heightSpan: sorted[2].size,
	};
}

export function createHeelToToeMapper(
	positions: THREE.BufferAttribute,
	axes: InsoleAxes,
): HeelToToeMapper {
	const { lengthAxis, widthAxis, bbox, lengthSpan } = axes;
	const minLen = bbox.min[lengthAxis];
	const maxLen = bbox.max[lengthAxis];
	const slice = Math.max(lengthSpan * 0.08, 1e-6);

	let minEndMinW = Infinity, minEndMaxW = -Infinity, minEndCount = 0;
	let maxEndMinW = Infinity, maxEndMaxW = -Infinity, maxEndCount = 0;

	for (let i = 0; i < positions.count; i++) {
		const lv = axGet(positions, i, lengthAxis);
		const wv = axGet(positions, i, widthAxis);
		if (lv <= minLen + slice) {
			minEndMinW = Math.min(minEndMinW, wv);
			minEndMaxW = Math.max(minEndMaxW, wv);
			minEndCount++;
		}
		if (lv >= maxLen - slice) {
			maxEndMinW = Math.min(maxEndMinW, wv);
			maxEndMaxW = Math.max(maxEndMaxW, wv);
			maxEndCount++;
		}
	}

	const minSpan = minEndCount > 10 ? Math.max(0, minEndMaxW - minEndMinW) : Infinity;
	const maxSpan = maxEndCount > 10 ? Math.max(0, maxEndMaxW - maxEndMinW) : Infinity;
	const heelAtMin = Number.isFinite(minSpan) && Number.isFinite(maxSpan) ? minSpan >= maxSpan : true;

	return {
		heelAtMin,
		getT: (lengthVal: number) => {
			const raw = (lengthVal - minLen) / lengthSpan;
			const clamped = Math.max(0, Math.min(1, raw));
			return heelAtMin ? clamped : 1 - clamped;
		},
	};
}

function detectBoundaryVertices(geometry: THREE.BufferGeometry): Set<number> {
	if (!geometry.index) return new Set();
	const idxArr = geometry.index.array;
	const vc = (geometry.getAttribute('position') as THREE.BufferAttribute).count;
	const fc = idxArr.length / 3;
	const halfEdges = new Set<number>();
	for (let f = 0; f < fc; f++) {
		const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
		halfEdges.add(a * vc + b);
		halfEdges.add(b * vc + c);
		halfEdges.add(c * vc + a);
	}
	const boundary = new Set<number>();
	for (const key of halfEdges) {
		const a = Math.floor(key / vc);
		const b = key % vc;
		if (!halfEdges.has(b * vc + a)) {
			boundary.add(a);
			boundary.add(b);
		}
	}
	return boundary;
}

function computeLaplacianCurvature(
	pos: THREE.BufferAttribute,
	vertCount: number,
	neighbors: number[][],
): Float32Array {
	const curv = new Float32Array(vertCount);
	for (let v = 0; v < vertCount; v++) {
		const nbs = neighbors[v];
		if (nbs.length === 0) continue;
		let dx = 0, dy = 0, dz = 0;
		for (const n of nbs) {
			dx += pos.getX(n) - pos.getX(v);
			dy += pos.getY(n) - pos.getY(v);
			dz += pos.getZ(n) - pos.getZ(v);
		}
		dx /= nbs.length; dy /= nbs.length; dz /= nbs.length;
		curv[v] = Math.sqrt(dx * dx + dy * dy + dz * dz);
	}
	let mx = 0;
	for (let i = 0; i < vertCount; i++) if (curv[i] > mx) mx = curv[i];
	if (mx > 1e-8) for (let i = 0; i < vertCount; i++) curv[i] /= mx;
	return curv;
}

export function buildSurfaceModel(geometry: THREE.BufferGeometry): InsoleSurfaceModel {
	const axes = computeInsoleAxes(geometry);
	const { heightAxis, widthAxis, bbox, heightSpan, widthSpan } = axes;
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
	const vertCount = pos.count;
	const heelMapper = createHeelToToeMapper(pos, axes);
	const minH = bbox.min[heightAxis];
	const centerW = (bbox.min[widthAxis] + bbox.max[widthAxis]) * 0.5;
	const halfW = widthSpan * 0.5;

	// Build per-vertex downward-facing score from face normals so we can
	// reliably classify underside vertices even near the perimeter.
	const downScore = new Float32Array(vertCount);
	const faceCount_arr = new Uint16Array(vertCount);
	const idx = geometry.index;
	if (idx) {
		const hA = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;
		const idxArr = idx.array;
		const fc = idxArr.length / 3;
		const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
		const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
		for (let f = 0; f < fc; f++) {
			const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
			vA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
			vB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
			vC.set(pos.getX(c), pos.getY(c), pos.getZ(c));
			ab.subVectors(vB, vA);
			ac.subVectors(vC, vA);
			n.crossVectors(ab, ac).normalize();
			const d = -n.getComponent(hA);
			for (const vi of [a, b, c]) {
				downScore[vi] += d;
				faceCount_arr[vi]++;
			}
		}
		for (let i = 0; i < vertCount; i++) {
			if (faceCount_arr[i] > 0) downScore[i] /= faceCount_arr[i];
		}
	}

	const zones = new Uint8Array(vertCount);
	const rimEdgeMask = new Uint8Array(vertCount);

	const bottomThreshold = minH + heightSpan * 0.18;
	const topThreshold = minH + heightSpan * 0.35;

	let bottomSum = 0;
	let bottomCount = 0;

	for (let i = 0; i < vertCount; i++) {
		const h = axGet(pos, i, heightAxis);
		const w = axGet(pos, i, widthAxis);
		const edgeDist = Math.abs(w - centerW) / halfW;
		const isDownFacing = downScore[i] > 0.3;

		if ((h <= bottomThreshold && edgeDist < 0.97) || (isDownFacing && h <= bottomThreshold)) {
			zones[i] = VertexZone.Bottom;
			bottomSum += h;
			bottomCount++;
		} else if (edgeDist > 0.78 && h > bottomThreshold) {
			if (h > topThreshold) {
				zones[i] = VertexZone.Rim;
				rimEdgeMask[i] = 1;
			} else {
				zones[i] = VertexZone.Wall;
			}
		} else if (h > topThreshold) {
			zones[i] = VertexZone.Top;
		} else {
			zones[i] = VertexZone.Wall;
		}
	}

	// Reclassify Top vertices adjacent to Wall/Bottom as Rim (catches toe/heel edges)
	if (idx) {
		const ia = idx.array;
		const fc2 = ia.length / 3;
		for (let f = 0; f < fc2; f++) {
			const tri = [ia[f * 3], ia[f * 3 + 1], ia[f * 3 + 2]];
			const hasShell = tri.some(v => zones[v] === VertexZone.Wall || zones[v] === VertexZone.Bottom);
			if (!hasShell) continue;
			for (const v of tri) {
				if (zones[v] === VertexZone.Top) {
					zones[v] = VertexZone.Rim;
					rimEdgeMask[v] = 1;
				}
			}
		}
	}

	const boundaryVerts = detectBoundaryVertices(geometry);
	for (const vi of boundaryVerts) {
		if (zones[vi] === VertexZone.Top) {
			zones[vi] = VertexZone.Rim;
			rimEdgeMask[vi] = 1;
		}
	}

	const bottomPlaneH = bottomCount > 0 ? bottomSum / bottomCount : minH;

	const regions = new Uint8Array(vertCount);
	const regionTransition = new Float32Array(vertCount);
	for (let i = 0; i < vertCount; i++) {
		const lv = axGet(pos, i, axes.lengthAxis);
		const t = heelMapper.getT(lv);
		regions[i] = t < 0.22 ? AnatomicalRegion.Heel
			: t < 0.55 ? AnatomicalRegion.ArchMidfoot
			: t < 0.82 ? AnatomicalRegion.Forefoot
			: AnatomicalRegion.Toe;
		const bd = Math.min(
			Math.abs(t - 0.22), Math.abs(t - 0.55), Math.abs(t - 0.82),
		);
		regionTransition[i] = Math.max(0, 1 - bd / 0.08);
	}

	const nb = buildNeighborGraph(geometry, vertCount);
	const curvature = computeLaplacianCurvature(pos, vertCount, nb);

	const topToWallTransition = new Uint8Array(vertCount);
	const heelArchTransition = new Uint8Array(vertCount);
	const deformableMask = new Uint8Array(vertCount);

	for (let i = 0; i < vertCount; i++) {
		const zone = zones[i];
		const region = regions[i];
		const trans = regionTransition[i];

		const hasWallOrRimNeighbor = nb[i].some(
			n => zones[n] === VertexZone.Wall || zones[n] === VertexZone.Rim,
		);
		const isTopOrRim = zone === VertexZone.Top || zone === VertexZone.Rim;

		if (isTopOrRim && hasWallOrRimNeighbor) topToWallTransition[i] = 1;
		if (trans > 0.3) heelArchTransition[i] = 1;

		const isInteriorTop =
			zone === VertexZone.Top &&
			!hasWallOrRimNeighbor &&
			trans < 0.2 &&
			(region === AnatomicalRegion.Forefoot || region === AnatomicalRegion.Toe);

		if (isInteriorTop) deformableMask[i] = 1;
	}

	return {
		axes, heelMapper, zones, regions, vertCount,
		bottomPlaneH, rimEdgeMask, curvature, regionTransition,
		topToWallTransition, heelArchTransition, deformableMask,
	};
}

export function enforceBottomPlanarity(
	geometry: THREE.BufferGeometry,
	model: InsoleSurfaceModel,
): void {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
	const { heightAxis } = model.axes;

	for (let i = 0; i < model.vertCount; i++) {
		if (model.zones[i] === VertexZone.Bottom) {
			axSet(pos, i, heightAxis, model.bottomPlaneH);
		}
	}
	pos.needsUpdate = true;
}

export function constrainedLaplacianSmooth(
	geometry: THREE.BufferGeometry,
	model: InsoleSurfaceModel,
	passes: number,
	alpha: number,
): void {
	if (!geometry.index) return;

	const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
	const { heightAxis } = model.axes;
	const vertCount = pos.count;
	const idxArr = geometry.index.array;
	const faceCount = idxArr.length / 3;

	const neighbors: number[][] = Array.from({ length: vertCount }, () => []);
	for (let f = 0; f < faceCount; f++) {
		const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
		if (!neighbors[a].includes(b)) neighbors[a].push(b);
		if (!neighbors[a].includes(c)) neighbors[a].push(c);
		if (!neighbors[b].includes(a)) neighbors[b].push(a);
		if (!neighbors[b].includes(c)) neighbors[b].push(c);
		if (!neighbors[c].includes(a)) neighbors[c].push(a);
		if (!neighbors[c].includes(b)) neighbors[c].push(b);
	}

	const heights = new Float32Array(vertCount);
	for (let i = 0; i < vertCount; i++) {
		heights[i] = axGet(pos, i, heightAxis);
	}

	const tmp = new Float32Array(vertCount);
	for (let p = 0; p < passes; p++) {
		tmp.set(heights);
		for (let v = 0; v < vertCount; v++) {
			if (model.zones[v] !== VertexZone.Top) continue;
			const nbs = neighbors[v];
			if (nbs.length === 0) continue;

			let topNeighborSum = 0;
			let topNeighborCount = 0;
			for (const nb of nbs) {
				if (model.zones[nb] === VertexZone.Top || model.zones[nb] === VertexZone.Rim) {
					topNeighborSum += heights[nb];
					topNeighborCount++;
				}
			}
			if (topNeighborCount === 0) continue;
			const avg = topNeighborSum / topNeighborCount;
			tmp[v] = heights[v] + alpha * (avg - heights[v]);
		}
		heights.set(tmp);
	}

	for (let i = 0; i < vertCount; i++) {
		if (model.zones[i] === VertexZone.Top) {
			axSet(pos, i, heightAxis, heights[i]);
		}
	}
	pos.needsUpdate = true;
}

function buildNeighborGraph(
	geometry: THREE.BufferGeometry,
	vertCount: number,
): number[][] {
	if (!geometry.index) return Array.from({ length: vertCount }, () => []);

	const idxArr = geometry.index.array;
	const faceCount = idxArr.length / 3;
	const neighbors: number[][] = Array.from({ length: vertCount }, () => []);

	for (let f = 0; f < faceCount; f++) {
		const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
		if (!neighbors[a].includes(b)) neighbors[a].push(b);
		if (!neighbors[a].includes(c)) neighbors[a].push(c);
		if (!neighbors[b].includes(a)) neighbors[b].push(a);
		if (!neighbors[b].includes(c)) neighbors[b].push(c);
		if (!neighbors[c].includes(a)) neighbors[c].push(a);
		if (!neighbors[c].includes(b)) neighbors[c].push(b);
	}

	return neighbors;
}

function buildRelaxationMask(
	model: InsoleSurfaceModel,
	neighbors: number[][],
): Uint8Array {
	const mask = new Uint8Array(model.vertCount);
	for (let v = 0; v < model.vertCount; v++) {
		const zone = model.zones[v];
		if (zone === VertexZone.Top || zone === VertexZone.Rim) {
			mask[v] = 1;
			continue;
		}
		if (zone !== VertexZone.Wall) continue;
		for (const nb of neighbors[v]) {
			if (
				model.zones[nb] === VertexZone.Top ||
				model.zones[nb] === VertexZone.Rim
			) {
				mask[v] = 1;
				break;
			}
		}
	}
	return mask;
}

function taubinRelaxSurface(
	geometry: THREE.BufferGeometry,
	model: InsoleSurfaceModel,
	baseGeometry?: THREE.BufferGeometry,
	passes = 10,
	lambda = 0.32,
	mu = -0.34,
): void {
	if (!geometry.index) return;

	const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
	const vertCount = pos.count;
	const neighbors = buildNeighborGraph(geometry, vertCount);
	const original = new Float32Array((pos.array as Float32Array).slice());
	const mask = buildRelaxationMask(model, neighbors);
	const basePos = baseGeometry?.getAttribute('position') as
		| THREE.BufferAttribute
		| undefined;
	const hasBase = Boolean(basePos && basePos.count === vertCount);

	const runStep = (step: number) => {
		const curX = new Float32Array(vertCount);
		const curY = new Float32Array(vertCount);
		const curZ = new Float32Array(vertCount);
		for (let i = 0; i < vertCount; i++) {
			curX[i] = pos.getX(i);
			curY[i] = pos.getY(i);
			curZ[i] = pos.getZ(i);
		}

		for (let v = 0; v < vertCount; v++) {
			if (!mask[v]) continue;

			let sx = 0;
			let sy = 0;
			let sz = 0;
			let cnt = 0;

			for (const nb of neighbors[v]) {
				if (model.zones[nb] === VertexZone.Bottom) continue;
				if (!mask[nb] && model.zones[nb] !== VertexZone.Rim) continue;
				sx += curX[nb];
				sy += curY[nb];
				sz += curZ[nb];
				cnt++;
			}
			if (cnt === 0) continue;

			const zone = model.zones[v];
			const localStep =
				zone === VertexZone.Top
					? step * 0.9
					: zone === VertexZone.Rim
						? step * 1.05
						: step * 0.88;

			let nx = curX[v] + (sx / cnt - curX[v]) * localStep;
			let ny = curY[v] + (sy / cnt - curY[v]) * localStep;
			let nz = curZ[v] + (sz / cnt - curZ[v]) * localStep;

			const pullToOriginal =
				zone === VertexZone.Top
					? 0.84
					: zone === VertexZone.Rim
						? 0.76
						: 0.66;
			nx += (original[v * 3] - nx) * pullToOriginal;
			ny += (original[v * 3 + 1] - ny) * pullToOriginal;
			nz += (original[v * 3 + 2] - nz) * pullToOriginal;

			if (hasBase && basePos && zone !== VertexZone.Top) {
				const baseBlend =
					zone === VertexZone.Rim ? 0.06 : 0.04;
				nx += (basePos.getX(v) - nx) * baseBlend;
				ny += (basePos.getY(v) - ny) * baseBlend;
				nz += (basePos.getZ(v) - nz) * baseBlend;
			}

			pos.setXYZ(v, nx, ny, nz);
		}
	};

	for (let pass = 0; pass < passes; pass++) {
		runStep(lambda);
		runStep(mu);
	}

	pos.needsUpdate = true;
}

/**
 * Smooth Wall and Bottom vertices while keeping Top and Rim locked.
 * Bottom vertices are smoothed only laterally (width/length); their height
 * stays locked to the flat plane throughout. After all passes a transition
 * band blends near-bottom Wall vertices toward the flat plane so there is
 * no hard step between zones.
 */
export function smoothShellSurface(
	geometry: THREE.BufferGeometry,
	model: InsoleSurfaceModel,
	passes = 10,
	alpha = 0.42,
	baseGeometry?: THREE.BufferGeometry,
): void {
	if (!geometry.index) return;

	const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
	const { heightAxis } = model.axes;
	const hIdx = heightAxis === 'x' ? 0 : heightAxis === 'y' ? 1 : 2;
	const vertCount = pos.count;
	const idxArr = geometry.index.array;
	const faceCount = idxArr.length / 3;

	const neighbors: number[][] = Array.from({ length: vertCount }, () => []);
	for (let f = 0; f < faceCount; f++) {
		const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
		if (!neighbors[a].includes(b)) neighbors[a].push(b);
		if (!neighbors[a].includes(c)) neighbors[a].push(c);
		if (!neighbors[b].includes(a)) neighbors[b].push(a);
		if (!neighbors[b].includes(c)) neighbors[b].push(c);
		if (!neighbors[c].includes(a)) neighbors[c].push(a);
		if (!neighbors[c].includes(b)) neighbors[c].push(b);
	}

	const px = new Float32Array(vertCount);
	const py = new Float32Array(vertCount);
	const pz = new Float32Array(vertCount);
	for (let i = 0; i < vertCount; i++) {
		px[i] = pos.getX(i);
		py[i] = pos.getY(i);
		pz[i] = pos.getZ(i);
	}

	const tmpX = new Float32Array(vertCount);
	const tmpY = new Float32Array(vertCount);
	const tmpZ = new Float32Array(vertCount);
	const basePos =
		baseGeometry && (baseGeometry.getAttribute('position') as THREE.BufferAttribute | undefined);
	const hasBaseAnchors = Boolean(basePos && basePos.count === vertCount);
	const transitionToTop = new Uint8Array(vertCount);

	for (let v = 0; v < vertCount; v++) {
		if (model.zones[v] !== VertexZone.Wall && model.zones[v] !== VertexZone.Rim) {
			continue;
		}
		for (const nb of neighbors[v]) {
			if (model.zones[nb] === VertexZone.Top || model.zones[nb] === VertexZone.Rim) {
				transitionToTop[v] = 1;
				break;
			}
		}
	}

	for (let p = 0; p < passes; p++) {
		tmpX.set(px); tmpY.set(py); tmpZ.set(pz);
		for (let v = 0; v < vertCount; v++) {
			const zone = model.zones[v];
			if (zone === VertexZone.Top) continue;
			const nbs = neighbors[v];
			if (nbs.length === 0) continue;

			let sx = 0, sy = 0, sz = 0, cnt = 0;
			for (const nb of nbs) {
				if (zone === VertexZone.Rim && model.zones[nb] === VertexZone.Bottom) {
					continue;
				}
				sx += px[nb];
				sy += py[nb];
				sz += pz[nb];
				cnt++;
			}
			if (cnt === 0) continue;
			const ax = sx / cnt, ay = sy / cnt, az = sz / cnt;

			if (zone === VertexZone.Bottom) {
				const localA = alpha * 0.5;
				tmpX[v] = px[v] + localA * (ax - px[v]);
				tmpY[v] = py[v] + localA * (ay - py[v]);
				tmpZ[v] = pz[v] + localA * (az - pz[v]);
				if (hIdx === 0) tmpX[v] = model.bottomPlaneH;
				else if (hIdx === 1) tmpY[v] = model.bottomPlaneH;
				else tmpZ[v] = model.bottomPlaneH;
			} else if (zone === VertexZone.Rim) {
				const rimAlpha = alpha * 0.18;
				tmpX[v] = px[v] + rimAlpha * (ax - px[v]);
				tmpY[v] = py[v] + rimAlpha * (ay - py[v]);
				tmpZ[v] = pz[v] + rimAlpha * (az - pz[v]);
			} else {
				const wallAlpha = transitionToTop[v] ? alpha * 1.05 : alpha * 0.82;
				tmpX[v] = px[v] + wallAlpha * (ax - px[v]);
				tmpY[v] = py[v] + wallAlpha * (ay - py[v]);
				tmpZ[v] = pz[v] + wallAlpha * (az - pz[v]);
			}

			if (hasBaseAnchors && (zone === VertexZone.Wall || zone === VertexZone.Rim) && basePos) {
				const blendToBase =
					zone === VertexZone.Rim
						? 0.1
						: transitionToTop[v]
							? 0.14
							: 0.26;
				tmpX[v] += (basePos.getX(v) - tmpX[v]) * blendToBase;
				tmpY[v] += (basePos.getY(v) - tmpY[v]) * blendToBase;
				tmpZ[v] += (basePos.getZ(v) - tmpZ[v]) * blendToBase;
			}
		}
		px.set(tmpX); py.set(tmpY); pz.set(tmpZ);
	}

	// Transition blending: pull near-bottom Wall vertices toward the flat plane
	const transitionRange = model.axes.heightSpan * 0.12;
	if (transitionRange > 1e-6) {
		for (let v = 0; v < vertCount; v++) {
			if (model.zones[v] !== VertexZone.Wall) continue;
			const h = hIdx === 0 ? px[v] : hIdx === 1 ? py[v] : pz[v];
			const dist = h - model.bottomPlaneH;
			if (dist > 0 && dist < transitionRange) {
				const t = dist / transitionRange;
				const blend = (1 - t) * (1 - t) * 0.6;
				const newH = h + blend * (model.bottomPlaneH - h);
				if (hIdx === 0) px[v] = newH;
				else if (hIdx === 1) py[v] = newH;
				else pz[v] = newH;
			}
		}
	}

	// Upper transition blending: soften the bowl-to-side junction without moving
	// the corrected top surface itself.
	for (let pass = 0; pass < 3; pass++) {
		tmpX.set(px); tmpY.set(py); tmpZ.set(pz);
		for (let v = 0; v < vertCount; v++) {
			const zone = model.zones[v];
			if (zone !== VertexZone.Wall && zone !== VertexZone.Rim) continue;
			if (!transitionToTop[v] && zone !== VertexZone.Rim) continue;

			let sx = 0;
			let sy = 0;
			let sz = 0;
			let cnt = 0;
			for (const nb of neighbors[v]) {
				if (model.zones[nb] === VertexZone.Bottom) continue;
				sx += px[nb];
				sy += py[nb];
				sz += pz[nb];
				cnt++;
			}
			if (cnt === 0) continue;

			const localBlend = zone === VertexZone.Rim ? 0.22 : 0.16;
			tmpX[v] = px[v] + (sx / cnt - px[v]) * localBlend;
			tmpY[v] = py[v] + (sy / cnt - py[v]) * localBlend;
			tmpZ[v] = pz[v] + (sz / cnt - pz[v]) * localBlend;

			if (hasBaseAnchors && basePos) {
				const baseBlend = zone === VertexZone.Rim ? 0.08 : 0.12;
				tmpX[v] += (basePos.getX(v) - tmpX[v]) * baseBlend;
				tmpY[v] += (basePos.getY(v) - tmpY[v]) * baseBlend;
				tmpZ[v] += (basePos.getZ(v) - tmpZ[v]) * baseBlend;
			}
		}
		px.set(tmpX); py.set(tmpY); pz.set(tmpZ);
	}

	// Final bottom snap
	for (let v = 0; v < vertCount; v++) {
		if (model.zones[v] !== VertexZone.Bottom) continue;
		if (hIdx === 0) px[v] = model.bottomPlaneH;
		else if (hIdx === 1) py[v] = model.bottomPlaneH;
		else pz[v] = model.bottomPlaneH;
	}

	for (let i = 0; i < vertCount; i++) {
		const zone = model.zones[i];
		if (zone === VertexZone.Top) continue;
		pos.setXYZ(i, px[i], py[i], pz[i]);
	}
	pos.needsUpdate = true;
}

export function finishInsoleShell(
	geometry: THREE.BufferGeometry,
	baseGeometry: THREE.BufferGeometry,
	model: InsoleSurfaceModel,
): void {
	taubinRelaxSurface(geometry, model, baseGeometry, 3, 0.12, -0.14);
	smoothShellSurface(geometry, model, 3, 0.22, baseGeometry);
}

/** @deprecated Use finishInsoleShell instead */
export function blendWallsToAnchors(
	geometry: THREE.BufferGeometry,
	baseGeometry: THREE.BufferGeometry,
	model: InsoleSurfaceModel,
): void {
	finishInsoleShell(geometry, baseGeometry, model);
}

export { axGet, axSet };

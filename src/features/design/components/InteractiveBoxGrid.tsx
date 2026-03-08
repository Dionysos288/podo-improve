'use client';

import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ── Types ──────────────────────────────────────────────────────────────
export interface BoxGridPoint {
	/** Flat index into the instanced mesh */
	index: number;
	/** Position in local geometry space (x,y = plane, z = height) */
	baseX: number;
	baseY: number;
	baseZ: number;
	/** Current Z offset in mm (the user's edit) */
	offsetZ: number;
	/** Grid row/col for neighbor distance computation */
	gridRow: number;
	gridCol: number;
}

// ── Constants ──────────────────────────────────────────────────────────
const HANDLE_RADIUS = 0.5;
const HANDLE_RADIUS_HOVER = 0.7;
const HANDLE_RADIUS_SELECTED = 0.65;
const SMOOTH_RADIUS = 3;

const COLOR_DEFAULT = new THREE.Color('#00d9ff');
const COLOR_SELECTED = new THREE.Color('#a78bfa');
const COLOR_HOVER = new THREE.Color('#56f2d6');

const MAX_GRID_POINTS = 300;
const _sphereGeo = new THREE.SphereGeometry(1, 8, 6);
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

function estimateAveragePointSpacing(points: BoxGridPoint[]): number {
	let total = 0;
	let count = 0;

	for (let i = 0; i < points.length; i++) {
		const src = points[i];
		let nearest = Infinity;
		for (let j = 0; j < points.length; j++) {
			if (i === j) continue;
			const dst = points[j];
			const isNeighbor =
				(src.gridRow === dst.gridRow && Math.abs(src.gridCol - dst.gridCol) === 1) ||
				(src.gridCol === dst.gridCol && Math.abs(src.gridRow - dst.gridRow) === 1);
			if (!isNeighbor) continue;
			const dx = src.baseX - dst.baseX;
			const dy = src.baseY - dst.baseY;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > 1e-6 && dist < nearest) nearest = dist;
		}
		if (Number.isFinite(nearest)) {
			total += nearest;
			count++;
		}
	}

	return count > 0 ? total / count : 1;
}

// ── Smoothing helper ───────────────────────────────────────────────────
function applyDeltaWithSmoothing(
	points: BoxGridPoint[],
	startOffsets: Float32Array,
	draggedIndices: number[],
	deltaMm: number,
	radius: number,
	avgSpacing: number,
) {
	const worldRadius = Math.max(avgSpacing * radius, avgSpacing * 0.75);
	const sigma = worldRadius / 2.25;
	const effects = new Float32Array(points.length);

	for (const idx of draggedIndices) {
		const src = points[idx];
		for (let j = 0; j < points.length; j++) {
			const dst = points[j];
			const dx = src.baseX - dst.baseX;
			const dy = src.baseY - dst.baseY;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > worldRadius) continue;
			const falloff = dist < 1e-6 ? 1.0 : Math.exp(-0.5 * (dist / sigma) ** 2);
			const effect = deltaMm * falloff;
			if (Math.abs(effect) > Math.abs(effects[j])) {
				effects[j] = effect;
			}
		}
	}

	for (let i = 0; i < points.length; i++) {
		if (effects[i] !== 0) {
			points[i].offsetZ = Math.max(-8, Math.min(8, startOffsets[i] + effects[i]));
		}
	}
}

// ── Build grid points inside the insole silhouette ─────────────────────
function buildSilhouetteGrid(
	geometry: THREE.BufferGeometry,
	gridCols: number,
	gridRows: number,
	mmToWorld: number,
): BoxGridPoint[] {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	if (!bbox || !positions) return [];

	const minX = bbox.min.x, maxX = bbox.max.x;
	const minY = bbox.min.y, maxY = bbox.max.y;
	const spanX = maxX - minX, spanY = maxY - minY;
	if (spanX < 0.01 || spanY < 0.01) return [];

	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	const heightAxis = axes[0];
	const planeAxes = [axes[1], axes[2]] as const;

	const pIdx = (a: 'x' | 'y' | 'z') => ({ x: 0, y: 1, z: 2 }[a]);
	const p0 = pIdx(planeAxes[0]), p1 = pIdx(planeAxes[1]), hIdx = pIdx(heightAxis);

	const pMin0 = bbox.min[planeAxes[0]], pMax0 = bbox.max[planeAxes[0]];
	const pMin1 = bbox.min[planeAxes[1]], pMax1 = bbox.max[planeAxes[1]];
	const pSpan0 = pMax0 - pMin0, pSpan1 = pMax1 - pMin1;

	const CELL = Math.max(pSpan0, pSpan1) / 40;
	const spatialHash = new Map<string, number[]>();
	for (let i = 0; i < positions.count; i++) {
		const v0 = positions.array[i * 3 + p0];
		const v1 = positions.array[i * 3 + p1];
		const cx = Math.floor((v0 - pMin0) / CELL);
		const cy = Math.floor((v1 - pMin1) / CELL);
		const key = `${cx},${cy}`;
		const bucket = spatialHash.get(key);
		if (bucket) bucket.push(i);
		else spatialHash.set(key, [i]);
	}

	const margin = 1.5 * mmToWorld;
	const gridMin0 = pMin0 + margin;
	const gridMax0 = pMax0 - margin;
	const gridMin1 = pMin1 + margin;
	const gridMax1 = pMax1 - margin;
	const gridSpan0 = gridMax0 - gridMin0;
	const gridSpan1 = gridMax1 - gridMin1;

	const maxSearchDist = Math.max(pSpan0 / gridCols, pSpan1 / gridRows) * 0.9;

	const result: BoxGridPoint[] = [];
	let index = 0;

	for (let row = 0; row < gridRows; row++) {
		for (let col = 0; col < gridCols; col++) {
			const t0 = gridCols === 1 ? 0.5 : col / (gridCols - 1);
			const t1 = gridRows === 1 ? 0.5 : row / (gridRows - 1);
			const v0 = gridMin0 + t0 * gridSpan0;
			const v1 = gridMin1 + t1 * gridSpan1;

			const cx = Math.floor((v0 - pMin0) / CELL);
			const cy = Math.floor((v1 - pMin1) / CELL);
			let bestDist2 = Infinity;
			let bestH = 0;
			const searchRadius = Math.ceil(maxSearchDist / CELL) + 1;

			for (let dx = -searchRadius; dx <= searchRadius; dx++) {
				for (let dy = -searchRadius; dy <= searchRadius; dy++) {
					const key = `${cx + dx},${cy + dy}`;
					const bucket = spatialHash.get(key);
					if (!bucket) continue;
					for (const i of bucket) {
						const vx = positions.array[i * 3 + p0];
						const vy = positions.array[i * 3 + p1];
						const d2 = (vx - v0) ** 2 + (vy - v1) ** 2;
						if (d2 < bestDist2) {
							bestDist2 = d2;
							bestH = positions.array[i * 3 + hIdx];
						}
					}
				}
			}

			if (bestDist2 < maxSearchDist * maxSearchDist) {
				const pos = [0, 0, 0];
				pos[p0] = v0;
				pos[p1] = v1;
				pos[hIdx] = bestH;
				result.push({
					index,
					baseX: pos[0],
					baseY: pos[1],
					baseZ: pos[2],
					offsetZ: 0,
					gridRow: row,
					gridCol: col,
				});
				index++;
			}
		}
	}

	return result;
}

// ── Apply grid edits to geometry ───────────────────────────────────────
export function applyBoxGridDeformation(
	geometry: THREE.BufferGeometry,
	points: BoxGridPoint[],
	influenceRadius: number,
): void {
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	if (!positions) return;

	const movedPoints = points.filter(p => Math.abs(p.offsetZ) > 0.001);
	if (movedPoints.length === 0) return;

	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	if (!bbox) return;
	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	const heightAxis = axes[0];
	const planeAxes = [axes[1], axes[2]] as const;
	const pIdx = (a: 'x' | 'y' | 'z') => ({ x: 0, y: 1, z: 2 }[a]);
	const p0 = pIdx(planeAxes[0]), p1 = pIdx(planeAxes[1]), hIdx = pIdx(heightAxis);

	const smoothstep = (t: number) => {
		t = Math.max(0, Math.min(1, t));
		return t * t * (3 - 2 * t);
	};

	for (let i = 0; i < positions.count; i++) {
		const vp0 = positions.array[i * 3 + p0];
		const vp1 = positions.array[i * 3 + p1];
		let totalWeight = 0;
		let totalDisp = 0;

		for (const mp of movedPoints) {
			const mpPos = [mp.baseX, mp.baseY, mp.baseZ];
			const dp0 = vp0 - mpPos[p0];
			const dp1 = vp1 - mpPos[p1];
			const dist = Math.sqrt(dp0 * dp0 + dp1 * dp1);
			if (dist < influenceRadius) {
				const norm = dist / influenceRadius;
				const w = smoothstep(smoothstep(1 - norm));
				totalWeight += w;
				totalDisp += w * mp.offsetZ;
			}
		}

		if (totalWeight > 0) {
			const finalDisp = totalDisp / totalWeight;
			const arr = positions.array as Float32Array;
			arr[i * 3 + hIdx] += finalDisp;
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

// ── Main component ─────────────────────────────────────────────────────
interface InteractiveBoxGridProps {
	insoleGeometry: THREE.BufferGeometry | null;
	mmToWorld: number;
	active: boolean;
	onGridPointsChange?: (points: BoxGridPoint[]) => void;
	onDeformationChange?: (points: BoxGridPoint[]) => void;
}

export function InteractiveBoxGrid({
	insoleGeometry,
	mmToWorld,
	active,
	onDeformationChange,
}: InteractiveBoxGridProps) {
	const { camera, gl, raycaster } = useThree();
	const groupRef = useRef<THREE.Group>(null);
	const instanceRef = useRef<THREE.InstancedMesh>(null);
	const needsInstanceUpdate = useRef(true);

	// ── Build grid points (once only – ignore subsequent deformed geometry) ──
	const initialGeoRef = useRef<THREE.BufferGeometry | null>(null);
	const pointsRef = useRef<BoxGridPoint[]>([]);
	const avgPointSpacingRef = useRef(1);

	useEffect(() => {
		if (!insoleGeometry) {
			initialGeoRef.current = null;
			pointsRef.current = [];
			avgPointSpacingRef.current = 1;
			needsInstanceUpdate.current = true;
			return;
		}
		if (initialGeoRef.current) return;
		initialGeoRef.current = insoleGeometry;
		const pts = buildSilhouetteGrid(insoleGeometry, 14, 20, mmToWorld);
		pointsRef.current = pts.map(p => ({ ...p }));
		avgPointSpacingRef.current = estimateAveragePointSpacing(pointsRef.current);
		needsInstanceUpdate.current = true;
	}, [insoleGeometry, mmToWorld]);

	// ── Selection / hover (refs only) ──
	const hoveredIdxRef = useRef(-1);
	const selectedSet = useRef<Set<number>>(new Set());
	const lastHoverRaycastAtRef = useRef(0);

	// ── Drag refs ──
	const dragging = useRef(false);
	const dragStartNDC = useRef(new THREE.Vector2());
	const dragNdcPerMm = useRef(new THREE.Vector2());
	const dragStartOffsets = useRef<Float32Array>(new Float32Array(0));
	const dragHandleIndices = useRef<number[]>([]);

	// ── Box selection refs ──
	const boxSelecting = useRef(false);
	const boxStartScreen = useRef({ x: 0, y: 0 });
	const boxOverlayRef = useRef<HTMLDivElement | null>(null);

	// ── Debounce timer for geometry deformation ──
	const deformTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Stable refs ──
	const cameraRef = useRef(camera);
	cameraRef.current = camera;
	const onDeformRef = useRef(onDeformationChange);
	onDeformRef.current = onDeformationChange;
	const mmToWorldRef = useRef(mmToWorld);
	mmToWorldRef.current = mmToWorld;

	// ── Emit changes (debounced — avoids re-render storms) ──
	const emitChange = useCallback(() => {
		if (deformTimerRef.current) clearTimeout(deformTimerRef.current);
		deformTimerRef.current = setTimeout(() => {
			deformTimerRef.current = null;
			// Snapshot a copy so the parent gets an immutable array
			onDeformRef.current?.(pointsRef.current.map(p => ({ ...p })));
		}, 120);
	}, []);

	// ── InstancedMesh visual update (runs in requestAnimationFrame) ──
	const _mat4 = useMemo(() => new THREE.Matrix4(), []);
	const _color = useMemo(() => new THREE.Color(), []);

	const updateInstances = useCallback(() => {
		if (!instanceRef.current) return;
		const inst = instanceRef.current;
		const pts = pointsRef.current;
		const sel = selectedSet.current;
		const mw = mmToWorldRef.current;

		for (let i = pts.length; i < MAX_GRID_POINTS; i++) {
			inst.setMatrixAt(i, _zeroMatrix);
		}

		for (let i = 0; i < pts.length; i++) {
			const pt = pts[i];
			const isSelected = sel.has(i);
			const isHov = hoveredIdxRef.current === i;
			const r = isSelected ? HANDLE_RADIUS_SELECTED
				: isHov ? HANDLE_RADIUS_HOVER
					: HANDLE_RADIUS;

			_mat4.makeScale(r, r, r).setPosition(
				pt.baseX,
				pt.baseY,
				pt.baseZ + pt.offsetZ * mw,
			);
			inst.setMatrixAt(i, _mat4);

			_color.copy(
				isSelected ? COLOR_SELECTED
					: isHov ? COLOR_HOVER
						: COLOR_DEFAULT
			);
			inst.setColorAt(i, _color);
		}

		inst.instanceMatrix.needsUpdate = true;
		if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
	}, [_mat4, _color]);

	useFrame(() => {
		if (needsInstanceUpdate.current || dragging.current) {
			updateInstances();
			needsInstanceUpdate.current = false;
		}
	});

	// ── Raycast helper: check if pointer hits a handle ──
	const hitTestHandle = useCallback((clientX: number, clientY: number): number | null => {
		if (!instanceRef.current) return null;
		const rect = gl.domElement.getBoundingClientRect();
		const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
		const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
		raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraRef.current);
		const hits = raycaster.intersectObject(instanceRef.current, false);
		if (hits.length > 0 && hits[0].instanceId != null) {
			return hits[0].instanceId;
		}
		return null;
	}, [gl, raycaster]);

	// ── Start drag ──
	const startDrag = useCallback((handleIdx: number, screenX: number, screenY: number) => {
		const sel = selectedSet.current;
		const indices = sel.has(handleIdx) && sel.size > 1
			? Array.from(sel)
			: [handleIdx];

		dragging.current = true;
		dragHandleIndices.current = indices;

		const snapshot = new Float32Array(pointsRef.current.length);
		for (let i = 0; i < pointsRef.current.length; i++) {
			snapshot[i] = pointsRef.current[i].offsetZ;
		}
		dragStartOffsets.current = snapshot;

		const rect = gl.domElement.getBoundingClientRect();
		const startNdcX = ((screenX - rect.left) / rect.width) * 2 - 1;
		const startNdcY = -((screenY - rect.top) / rect.height) * 2 + 1;
		dragStartNDC.current.set(startNdcX, startNdcY);

		if (instanceRef.current && groupRef.current) {
			const m4 = new THREE.Matrix4();
			instanceRef.current.getMatrixAt(handleIdx, m4);
			const localPos = new THREE.Vector3().setFromMatrixPosition(m4);

			const offsetPos = localPos.clone();
			offsetPos.z += mmToWorldRef.current;

			const worldA = localPos.clone();
			groupRef.current.localToWorld(worldA);
			const worldB = offsetPos.clone();
			groupRef.current.localToWorld(worldB);

			const ndcA = worldA.project(cameraRef.current);
			const ndcB = worldB.project(cameraRef.current);
			dragNdcPerMm.current.set(ndcB.x - ndcA.x, ndcB.y - ndcA.y);
		} else {
			dragNdcPerMm.current.set(0, 0.01);
		}

		gl.domElement.style.cursor = 'grabbing';
	}, [gl]);

	// ── All pointer logic via native DOM events on the canvas ──
	// No invisible plane, no R3F event props → zero overhead during orbit/zoom.
	useEffect(() => {
		if (!active) return;
		const el = gl.domElement;

		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0) return; // left-click only

			const hitIdx = hitTestHandle(e.clientX, e.clientY);

			if (hitIdx != null) {
				// Hit a handle sphere → select / start drag
				e.stopPropagation();

				if (e.shiftKey) {
					const sel = selectedSet.current;
					if (sel.has(hitIdx)) sel.delete(hitIdx);
					else sel.add(hitIdx);
					needsInstanceUpdate.current = true;
					return;
				}

				if (!selectedSet.current.has(hitIdx)) {
					selectedSet.current = new Set([hitIdx]);
					needsInstanceUpdate.current = true;
				}

				startDrag(hitIdx, e.clientX, e.clientY);
				return;
			}

			// No handle hit → start box selection
			boxSelecting.current = true;
			boxStartScreen.current = { x: e.clientX, y: e.clientY };
			selectedSet.current = new Set();
			needsInstanceUpdate.current = true;
		};

		const onPointerMove = (e: PointerEvent) => {
			// Box selection overlay
			if (boxSelecting.current) {
				const overlay = boxOverlayRef.current;
				if (overlay) {
					const parent = el.parentElement;
					if (parent) {
						const pr = parent.getBoundingClientRect();
						const sx = boxStartScreen.current.x - pr.left;
						const sy = boxStartScreen.current.y - pr.top;
						const cx = e.clientX - pr.left;
						const cy = e.clientY - pr.top;
						overlay.style.display = 'block';
						overlay.style.left = `${Math.min(sx, cx)}px`;
						overlay.style.top = `${Math.min(sy, cy)}px`;
						overlay.style.width = `${Math.abs(cx - sx)}px`;
						overlay.style.height = `${Math.abs(cy - sy)}px`;
					}
				}
				return;
			}

			// Handle dragging
			if (dragging.current) {
				const rect = el.getBoundingClientRect();
				const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
				const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

				const dNdcX = ndcX - dragStartNDC.current.x;
				const dNdcY = ndcY - dragStartNDC.current.y;
				const ndcPMm = dragNdcPerMm.current;
				const ndcPerMmLen = ndcPMm.lengthSq();
				const deltaMm = ndcPerMmLen > 1e-12
					? (dNdcX * ndcPMm.x + dNdcY * ndcPMm.y) / ndcPerMmLen
					: 0;

				applyDeltaWithSmoothing(
					pointsRef.current,
					dragStartOffsets.current,
					dragHandleIndices.current,
					deltaMm,
					SMOOTH_RADIUS,
					avgPointSpacingRef.current,
				);
				needsInstanceUpdate.current = true;
				return;
			}

			if (e.buttons !== 0) {
				if (hoveredIdxRef.current !== -1) {
					hoveredIdxRef.current = -1;
					needsInstanceUpdate.current = true;
					el.style.cursor = dragging.current ? 'grabbing' : 'auto';
				}
				return;
			}

			// Hover detection (only when idle — very cheap manual raycast)
			const now = performance.now();
			if (now - lastHoverRaycastAtRef.current < 32) return;
			lastHoverRaycastAtRef.current = now;
			const hitIdx = hitTestHandle(e.clientX, e.clientY);
			if (hitIdx != null) {
				if (hitIdx !== hoveredIdxRef.current) {
					hoveredIdxRef.current = hitIdx;
					needsInstanceUpdate.current = true;
					el.style.cursor = 'grab';
				}
			} else if (hoveredIdxRef.current !== -1) {
				hoveredIdxRef.current = -1;
				needsInstanceUpdate.current = true;
				el.style.cursor = 'auto';
			}
		};

		const onPointerUp = (e: PointerEvent) => {
			// End box selection
			if (boxSelecting.current) {
				boxSelecting.current = false;
				if (boxOverlayRef.current) boxOverlayRef.current.style.display = 'none';

				if (instanceRef.current && groupRef.current) {
					const pts = pointsRef.current;
					const sel = new Set<number>();
					const rect = el.getBoundingClientRect();

					const sx = boxStartScreen.current.x;
					const sy = boxStartScreen.current.y;
					const ex = e.clientX;
					const ey = e.clientY;

					// Only select if dragged at least a few pixels
					if (Math.abs(ex - sx) > 5 || Math.abs(ey - sy) > 5) {
						const x1 = Math.min(sx, ex);
						const y1 = Math.min(sy, ey);
						const x2 = Math.max(sx, ex);
						const y2 = Math.max(sy, ey);

						const _v = new THREE.Vector3();
						const m4 = new THREE.Matrix4();

						for (let i = 0; i < pts.length; i++) {
							instanceRef.current.getMatrixAt(i, m4);
							_v.setFromMatrixPosition(m4);
							groupRef.current.localToWorld(_v);
							_v.project(cameraRef.current);

							const screenX = ((_v.x + 1) / 2) * rect.width + rect.left;
							const screenY = ((1 - _v.y) / 2) * rect.height + rect.top;

							if (screenX >= x1 && screenX <= x2 && screenY >= y1 && screenY <= y2) {
								sel.add(i);
							}
						}
					}

					selectedSet.current = sel;
					needsInstanceUpdate.current = true;
				}
				return;
			}

			// End drag
			if (dragging.current) {
				dragging.current = false;
				el.style.cursor = 'auto';
				needsInstanceUpdate.current = true;
				emitChange();
			}
		};

		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('pointermove', onPointerMove);
		el.addEventListener('pointerup', onPointerUp);
		return () => {
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('pointermove', onPointerMove);
			el.removeEventListener('pointerup', onPointerUp);
		};
	}, [active, gl, hitTestHandle, startDrag, emitChange]);

	// ── Box selection overlay DOM element ──
	useEffect(() => {
		if (!active) return;
		const parent = gl.domElement.parentElement;
		if (!parent) return;
		const div = document.createElement('div');
		div.style.cssText = [
			'position:absolute',
			'border:1.5px dashed rgba(167,139,250,0.85)',
			'background:rgba(167,139,250,0.12)',
			'pointer-events:none',
			'display:none',
			'z-index:10',
			'border-radius:2px',
		].join(';');
		parent.style.position = 'relative';
		parent.appendChild(div);
		boxOverlayRef.current = div;
		return () => {
			div.remove();
			boxOverlayRef.current = null;
		};
	}, [active, gl]);

	// ── Keyboard arrow nudge ──
	useEffect(() => {
		if (!active) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
			const sel = selectedSet.current;
			if (sel.size === 0) return;

			e.preventDefault();
			const step = e.key === 'ArrowUp' ? 0.5 : -0.5;

			const snapshot = new Float32Array(pointsRef.current.length);
			for (let i = 0; i < pointsRef.current.length; i++) {
				snapshot[i] = pointsRef.current[i].offsetZ;
			}
			applyDeltaWithSmoothing(
				pointsRef.current,
				snapshot,
				Array.from(sel),
				step,
				SMOOTH_RADIUS,
				avgPointSpacingRef.current,
			);

			needsInstanceUpdate.current = true;
			emitChange();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [active, emitChange]);

	// ── Clean up debounce timer ──
	useEffect(() => {
		return () => {
			if (deformTimerRef.current) clearTimeout(deformTimerRef.current);
		};
	}, []);

	if (!active) return null;

	return (
		<group ref={groupRef}>
			<instancedMesh
				ref={instanceRef}
				args={[_sphereGeo, undefined, MAX_GRID_POINTS]}
				renderOrder={11}
				frustumCulled={false}
			>
				<meshBasicMaterial transparent opacity={0.85} depthTest={false} />
			</instancedMesh>
		</group>
	);
}

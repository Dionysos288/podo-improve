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
const HANDLE_RADIUS = 0.36;
const HANDLE_RADIUS_HOVER = 0.48;
const HANDLE_RADIUS_SELECTED = 0.58;
const SMOOTH_RADIUS = 3;

const COLOR_DEFAULT = new THREE.Color('#ff62c7');
const COLOR_SELECTED = new THREE.Color('#ffd84d');
const COLOR_HOVER = new THREE.Color('#ffffff');

const MAX_GRID_POINTS = 220;
const _sphereGeo = new THREE.SphereGeometry(1, 6, 4);
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
				points[i].offsetZ = Math.max(-20, Math.min(20, startOffsets[i] + effects[i]));
		}
	}
}

// ── Build grid points inside the insole silhouette ─────────────────────
export function buildSilhouetteGrid(
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
	const sampleStride = positions.count > 240000 ? 12 : positions.count > 120000 ? 8 : positions.count > 60000 ? 4 : 2;

	const pMin0 = bbox.min[planeAxes[0]], pMax0 = bbox.max[planeAxes[0]];
	const pMin1 = bbox.min[planeAxes[1]], pMax1 = bbox.max[planeAxes[1]];
	const pSpan0 = pMax0 - pMin0, pSpan1 = pMax1 - pMin1;
	const lengthAxisIndex = pSpan0 >= pSpan1 ? p0 : p1;
	const widthAxisIndex = lengthAxisIndex === p0 ? p1 : p0;
	const lengthMin = lengthAxisIndex === p0 ? pMin0 : pMin1;
	const lengthMax = lengthAxisIndex === p0 ? pMax0 : pMax1;
	const lengthSpan = Math.max(1e-6, lengthMax - lengthMin);
	const widthSpan = Math.max(1e-6, widthAxisIndex === p0 ? pSpan0 : pSpan1);
	const profileBins = Math.max(48, gridRows * 3);
	const profileMin = new Float32Array(profileBins).fill(Number.POSITIVE_INFINITY);
	const profileMax = new Float32Array(profileBins).fill(Number.NEGATIVE_INFINITY);
	const profileHits = new Uint16Array(profileBins);
	for (let i = 0; i < positions.count; i += sampleStride) {
		const lenVal = positions.array[i * 3 + lengthAxisIndex];
		const widVal = positions.array[i * 3 + widthAxisIndex];
		const t = Math.max(0, Math.min(1, (lenVal - lengthMin) / lengthSpan));
		const bin = Math.min(profileBins - 1, Math.max(0, Math.round(t * (profileBins - 1))));
		if (widVal < profileMin[bin]) profileMin[bin] = widVal;
		if (widVal > profileMax[bin]) profileMax[bin] = widVal;
		profileHits[bin]++;
	}
	for (let i = 0; i < profileBins; i++) {
		if (profileHits[i] > 0) continue;
		let left = i - 1;
		while (left >= 0 && profileHits[left] === 0) left--;
		let right = i + 1;
		while (right < profileBins && profileHits[right] === 0) right++;
		if (left >= 0 && right < profileBins) {
			profileMin[i] = (profileMin[left] + profileMin[right]) * 0.5;
			profileMax[i] = (profileMax[left] + profileMax[right]) * 0.5;
		} else if (left >= 0) {
			profileMin[i] = profileMin[left];
			profileMax[i] = profileMax[left];
		} else if (right < profileBins) {
			profileMin[i] = profileMin[right];
			profileMax[i] = profileMax[right];
		}
	}
	const sampleProfile = (t: number) => {
		const x = Math.max(0, Math.min(1, t)) * (profileBins - 1);
		const i0 = Math.floor(x);
		const i1 = Math.min(profileBins - 1, i0 + 1);
		const blend = x - i0;
		return {
			min: profileMin[i0] + (profileMin[i1] - profileMin[i0]) * blend,
			max: profileMax[i0] + (profileMax[i1] - profileMax[i0]) * blend,
		};
	};

	const CELL = Math.max(pSpan0, pSpan1) / 40;
	const spatialHash = new Map<string, number[]>();
	for (let i = 0; i < positions.count; i += sampleStride) {
		const v0 = positions.array[i * 3 + p0];
		const v1 = positions.array[i * 3 + p1];
		const cx = Math.floor((v0 - pMin0) / CELL);
		const cy = Math.floor((v1 - pMin1) / CELL);
		const key = `${cx},${cy}`;
		const bucket = spatialHash.get(key);
		if (bucket) bucket.push(i);
		else spatialHash.set(key, [i]);
	}

	const margin = 2.6 * mmToWorld;
	const gridMin0 = pMin0 + margin;
	const gridMax0 = pMax0 - margin;
	const gridMin1 = pMin1 + margin;
	const gridMax1 = pMax1 - margin;
	const gridSpan0 = gridMax0 - gridMin0;
	const gridSpan1 = gridMax1 - gridMin1;

	const maxSearchDist = Math.max(pSpan0 / Math.max(1, gridCols), pSpan1 / Math.max(1, gridRows)) * 0.92;

	const result: BoxGridPoint[] = [];
	let index = 0;

	for (let row = 0; row < gridRows; row++) {
		for (let col = 0; col < gridCols; col++) {
			const t0 = gridCols === 1 ? 0.5 : col / (gridCols - 1);
			const t1 = gridRows === 1 ? 0.5 : row / (gridRows - 1);
			const v0 = gridMin0 + t0 * gridSpan0;
			const v1 = gridMin1 + t1 * gridSpan1;
			const candidateLength = lengthAxisIndex === p0 ? v0 : v1;
			const candidateWidth = widthAxisIndex === p0 ? v0 : v1;
			const profile = sampleProfile((candidateLength - lengthMin) / lengthSpan);
			const edgeInset = Math.min(Math.max(maxSearchDist * 0.55, 1.6 * mmToWorld), widthSpan * 0.08);
			if (!Number.isFinite(profile.min) || !Number.isFinite(profile.max)) continue;
			if (candidateWidth <= profile.min + edgeInset || candidateWidth >= profile.max - edgeInset) continue;

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
				const bestDist = Math.sqrt(bestDist2);
				if (bestDist > maxSearchDist * 0.72) continue;
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
	mmToWorld: number,
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

	// Gaussian sigma  →  smooth bell-curve, extends well past nearest neighbours
	// sigma IS the shape control; cutoff is just for performance (at 4σ the weight is ~0.03%)
	const sigma = influenceRadius * 0.45;
	const sigSq2 = 2 * sigma * sigma;
	const cutoff = 4.0 * sigma;            // fade to near-zero before we clip
	const cutoffSq = cutoff * cutoff;
	const mw = Math.max(1e-6, mmToWorld);

	const arr = positions.array as Float32Array;

	for (let i = 0; i < positions.count; i++) {
		const vp0 = arr[i * 3 + p0];
		const vp1 = arr[i * 3 + p1];
		let disp = 0;

		// Additive blending: each moved point contributes its own Gaussian bump.
		// Nearby points naturally merge into one smooth hill.
		for (const mp of movedPoints) {
			const mpPos = [mp.baseX, mp.baseY, mp.baseZ];
			const dp0 = vp0 - mpPos[p0];
			const dp1 = vp1 - mpPos[p1];
			const distSq = dp0 * dp0 + dp1 * dp1;
			if (distSq > cutoffSq) continue;
			const w = Math.exp(-distSq / sigSq2);
			disp += w * mp.offsetZ * mw;
		}

		if (disp !== 0) {
			// Soft-clamp to avoid extreme spikes
			const maxDisp = 10 * mw;
			disp = Math.max(-maxDisp, Math.min(maxDisp, disp));
			arr[i * 3 + hIdx] += disp;
		}
	}

	positions.needsUpdate = true;
	geometry.computeVertexNormals();
}

/** Reconstruct BoxGridPoint[] from saved offsets + insole geometry (for non-interactive replay). */
export function reconstructGridPointsFromSaved(
	geometry: THREE.BufferGeometry,
	saved: BoxGridSavedOffsets,
	mmToWorld: number,
): BoxGridPoint[] {
	const pts = buildSilhouetteGrid(geometry, saved.cols, saved.rows, mmToWorld);
	for (const p of pts) {
		const key = p.gridRow * saved.cols + p.gridCol;
		if (key >= 0 && key < saved.offsets.length) {
			p.offsetZ = saved.offsets[key];
		}
	}
	return pts;
}

/** Default grid dimensions used by InteractiveBoxGrid */
export const BOX_GRID_COLS = 9;
export const BOX_GRID_ROWS = 13;

// ── Main component ─────────────────────────────────────────────────────
/** Serialisable offset data for persistence */
export interface BoxGridSavedOffsets {
	/** Grid dimensions used when these offsets were created */
	cols: number;
	rows: number;
	/** offsetZ values indexed by `row * cols + col` */
	offsets: number[];
}

interface InteractiveBoxGridProps {
	insoleGeometry: THREE.BufferGeometry | null;
	mmToWorld: number;
	active: boolean;
	/** Previously saved offsets – will be restored when the grid is built */
	savedOffsets?: BoxGridSavedOffsets | null;
	onGridPointsChange?: (points: BoxGridPoint[]) => void;
	onDeformationChange?: (points: BoxGridPoint[]) => void;
	/** Called when the user explicitly saves (Opslaan) */
	onSave?: (offsets: BoxGridSavedOffsets) => void;
}

export function InteractiveBoxGrid({
	insoleGeometry,
	mmToWorld,
	active,
	savedOffsets,
	onDeformationChange,
	onSave,
}: InteractiveBoxGridProps) {
	const { camera, gl, raycaster } = useThree();
	const groupRef = useRef<THREE.Group>(null);
	const instanceRef = useRef<THREE.InstancedMesh>(null);
	const needsInstanceUpdate = useRef(true);

	// ── Build grid points (once only – ignore subsequent deformed geometry) ──
	const initialGeoRef = useRef<THREE.BufferGeometry | null>(null);
	const pointsRef = useRef<BoxGridPoint[]>([]);
	const avgPointSpacingRef = useRef(1);

	/** Expose a snapshot so the parent can call getSaveData() at any time */
	const getSaveData = useCallback((): BoxGridSavedOffsets => {
		const pts = pointsRef.current;
		const COLS = 9, ROWS = 13;
		const offsets = new Array<number>(ROWS * COLS).fill(0);
		for (const p of pts) {
			const key = p.gridRow * COLS + p.gridCol;
			if (key >= 0 && key < offsets.length) offsets[key] = p.offsetZ;
		}
		return { cols: COLS, rows: ROWS, offsets };
	}, []);

	// Store the latest getSaveData ref so onSave always gets current data
	const getSaveDataRef = useRef(getSaveData);
	getSaveDataRef.current = getSaveData;
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;

	/** Trigger save from parent via imperative handle — but we expose via callback */
	const triggerSave = useCallback(() => {
		onSaveRef.current?.(getSaveDataRef.current());
	}, []);

	// Attach triggerSave to the group so the parent can call it
	const triggerSaveRef = useRef(triggerSave);
	triggerSaveRef.current = triggerSave;

	// ── Stable refs (must be before any useEffect that references them) ──
	const cameraRef = useRef(camera);
	cameraRef.current = camera;
	const onDeformRef = useRef(onDeformationChange);
	onDeformRef.current = onDeformationChange;
	const mmToWorldRef = useRef(mmToWorld);
	mmToWorldRef.current = mmToWorld;

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
		const COLS = 9, ROWS = 13;
		const pts = buildSilhouetteGrid(insoleGeometry, COLS, ROWS, mmToWorld);
		// Restore saved offsets if available
		if (savedOffsets && savedOffsets.cols === COLS && savedOffsets.rows === ROWS) {
			for (const p of pts) {
				const key = p.gridRow * COLS + p.gridCol;
				if (key >= 0 && key < savedOffsets.offsets.length) {
					p.offsetZ = savedOffsets.offsets[key];
				}
			}
		}
		pointsRef.current = pts.map(p => ({ ...p }));
		avgPointSpacingRef.current = estimateAveragePointSpacing(pointsRef.current);
		needsInstanceUpdate.current = true;
		// If there are saved offsets with non-zero values, emit the deformation immediately
		if (savedOffsets && savedOffsets.offsets.some(v => Math.abs(v) > 0.001)) {
			// Defer to next tick so the parent geometry ref is ready
			setTimeout(() => {
				onDeformRef.current?.(pointsRef.current.map(p => ({ ...p })));
			}, 0);
		}
	}, [insoleGeometry, mmToWorld, savedOffsets]);

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
	const previewRafRef = useRef<number | null>(null);

	// ── Emit changes (debounced — avoids re-render storms) ──
	const emitChange = useCallback(() => {
		if (deformTimerRef.current) clearTimeout(deformTimerRef.current);
		deformTimerRef.current = setTimeout(() => {
			deformTimerRef.current = null;
			// Snapshot a copy so the parent gets an immutable array
			onDeformRef.current?.(pointsRef.current.map(p => ({ ...p })));
			// Auto-persist grid offsets to parent so "Opslaan" always has latest data
			onSaveRef.current?.(getSaveDataRef.current());
		}, 120);
	}, []);

	const emitPreview = useCallback(() => {
		if (previewRafRef.current != null) return;
		previewRafRef.current = requestAnimationFrame(() => {
			previewRafRef.current = null;
			onDeformRef.current?.(pointsRef.current.map(p => ({ ...p })));
		});
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
		const stopCanvasInteraction = (e: PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (typeof e.stopImmediatePropagation === 'function') {
				e.stopImmediatePropagation();
			}
		};

		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0) return; // left-click only

			// Ensure canvas can receive keyboard events
			if (el.tabIndex < 0) el.tabIndex = 0;
			el.focus({ preventScroll: true });

			const hitIdx = hitTestHandle(e.clientX, e.clientY);

			if (hitIdx != null) {
				// Hit a handle sphere → select / start drag
				stopCanvasInteraction(e);

				if (e.ctrlKey) {
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

			if (!e.ctrlKey) {
				if (selectedSet.current.size > 0) {
					selectedSet.current = new Set();
					needsInstanceUpdate.current = true;
				}
				return;
			}

			// Ctrl + empty click → start box selection
			stopCanvasInteraction(e);
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
				emitPreview();
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
			if (now - lastHoverRaycastAtRef.current < 72) return;
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
	}, [active, gl, hitTestHandle, startDrag, emitChange, emitPreview]);

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
		const el = gl.domElement;

		// Ensure canvas can receive keyboard events
		if (el.tabIndex < 0) el.tabIndex = 0;

		const STEP_MM = 0.35; // mm per keypress / repeat

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
			const sel = selectedSet.current;
			if (sel.size === 0) return;

			e.preventDefault();
			e.stopPropagation();

			const dir: number = e.key === 'ArrowUp' ? 1 : -1;
			const deltaMm = dir * STEP_MM;

			// Snapshot current offsets, apply incremental delta
			const pts = pointsRef.current;
			const snapshot = new Float32Array(pts.length);
			for (let i = 0; i < pts.length; i++) snapshot[i] = pts[i].offsetZ;

			applyDeltaWithSmoothing(
				pts,
				snapshot,
				Array.from(sel),
				deltaMm,
				SMOOTH_RADIUS,
				avgPointSpacingRef.current,
			);

			// Update handle visuals immediately
			needsInstanceUpdate.current = true;

			// Send deformation to parent directly (synchronous, no rAF delay)
			onDeformRef.current?.(pts.map(p => ({ ...p })));
			// Persist offsets to parent state for autosave
			onSaveRef.current?.(getSaveDataRef.current());
		};

		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('keydown', onKeyDown, true);
		};
	}, [active, gl]);

	// ── Clean up debounce timer ──
	useEffect(() => {
		return () => {
			if (deformTimerRef.current) clearTimeout(deformTimerRef.current);
			if (previewRafRef.current != null) cancelAnimationFrame(previewRafRef.current);
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
				<meshBasicMaterial transparent opacity={0.98} depthTest={false} />
			</instancedMesh>
		</group>
	);
}

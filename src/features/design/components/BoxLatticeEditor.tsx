'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { LatticeEditKit } from '@/src/features/design/components/boxLatticeTypes';
import type {
	BoxGridSavedOffsets,
	LatticeOffsetVec,
} from '@/src/features/design/types/boxGrid';
import {
	latticeVecsToSavePayload,
	normalizeSavedOffsets,
} from '@/src/features/design/types/boxGrid';
import type { ObLatticeFrame } from '@/src/features/design/utils/boxLattice';
import { hydrateLatticeOffsets } from '@/src/features/design/utils/boxLattice';
import {
	applyVecDeltaWithSmoothing,
	estimateAverageNodeSpacing,
	getMaxDhForSpan,
	MAX_ABS_DU_DV,
} from '@/src/features/design/utils/boxLatticeSmoothing';

// Control points are the primary affordance, so they read larger and brighter than the
// lattice that frames them.
const HANDLE_R = 0.3;
const HANDLE_HOVER_R = 0.38;
const HANDLE_SEL_R = 0.4;
const COLOR_DEFAULT = new THREE.Color('#ffffff');
const COLOR_SELECTED = new THREE.Color('#22d3ee');
const COLOR_DIM = new THREE.Color('#334155');
const COLOR_HOVER = new THREE.Color('#a5f3fc');
// Green lattice is context, not the focus: the interior grid is kept faint so layers
// stay distinguishable without the lines blending into a solid mass, and the outer
// frame is only slightly stronger so the editable box still reads.
const COLOR_GRID_LINE = '#34d399';
const COLOR_FRAME = '#34d399';
const GRID_LINE_OPACITY = 0.22;
const FRAME_OPACITY = 0.6;
const SMOOTH_RADIUS = 3;

const _sphere = new THREE.SphereGeometry(1, 6, 4);
const _scaleZero = new THREE.Matrix4().makeScale(0, 0, 0);
const _ndc = new THREE.Vector2();
const _hitW = new THREE.Vector3();
const _deltaW = new THREE.Vector3();
const _camW = new THREE.Vector3();
const _planeN = new THREE.Vector3();
const _instPosScratch = new THREE.Vector3();
const _axisU = new THREE.Vector3();
const _axisV = new THREE.Vector3();
const _axisH = new THREE.Vector3();

function corner(u: number, v: number, h: number, frame: ObLatticeFrame) {
	const o: [number, number, number] = [0, 0, 0];
	o[frame.uIdx] = u;
	o[frame.vIdx] = v;
	o[frame.hIdx] = h;
	return o;
}

function buildLatticeGridLines(
	frame: ObLatticeFrame,
	cols: number,
	rows: number,
	layers: number,
) {
	const { uMin, uMax, vMin, vMax, hMin, hMax } = frame;
	const pos: number[] = [];
	const L = Math.max(1, layers);
	const pushSeg = (u0: number, v0: number, u1: number, v1: number, h: number) => {
		const a = corner(u0, v0, h, frame);
		const b = corner(u1, v1, h, frame);
		pos.push(...a, ...b);
	};
	for (let layer = 0; layer < L; layer++) {
		const nh = L === 1 ? 1 : layer / (L - 1);
		const h = hMin + nh * (hMax - hMin);
		for (let c = 0; c < cols; c++) {
			const nu = cols === 1 ? 0.5 : c / (cols - 1);
			const u = uMin + nu * (uMax - uMin);
			pushSeg(u, vMin, u, vMax, h);
		}
		for (let r = 0; r < rows; r++) {
			const nv = rows === 1 ? 0.5 : r / (rows - 1);
			const v = vMin + nv * (vMax - vMin);
			pushSeg(uMin, v, uMax, v, h);
		}
	}
	if (L > 1) {
		const corners: [number, number][] = [
			[uMin, vMin],
			[uMax, vMin],
			[uMax, vMax],
			[uMin, vMax],
		];
		for (let layer = 0; layer < L - 1; layer++) {
			const nh0 = layer / (L - 1);
			const nh1 = (layer + 1) / (L - 1);
			const h0 = hMin + nh0 * (hMax - hMin);
			const h1 = hMin + nh1 * (hMax - hMin);
			for (const [uc, vc] of corners) {
				const a = corner(uc, vc, h0, frame);
				const b = corner(uc, vc, h1, frame);
				pos.push(...a, ...b);
			}
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	return geo;
}

function buildFrameEdges(frame: ObLatticeFrame) {
	const { uMin, uMax, vMin, vMax, hMin, hMax } = frame;
	const c0 = corner(uMin, vMin, hMin, frame);
	const c1 = corner(uMax, vMin, hMin, frame);
	const c2 = corner(uMax, vMax, hMin, frame);
	const c3 = corner(uMin, vMax, hMin, frame);
	const c4 = corner(uMin, vMin, hMax, frame);
	const c5 = corner(uMax, vMin, hMax, frame);
	const c6 = corner(uMax, vMax, hMax, frame);
	const c7 = corner(uMin, vMax, hMax, frame);
	const corners = [c0, c1, c2, c3, c4, c5, c6, c7];
	const pos: number[] = [];
	const seg = (a: number[], b: number[]) => {
		pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
	};
	for (let i = 0; i < 4; i++) seg(corners[i]!, corners[(i + 1) % 4]!);
	for (let i = 0; i < 4; i++) seg(corners[i + 4]!, corners[((i + 1) % 4) + 4]!);
	for (let i = 0; i < 4; i++) seg(corners[i]!, corners[i + 4]!);
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	return geo;
}

function setAxis(out: THREE.Vector3, idx: 0 | 1 | 2) {
	out.set(idx === 0 ? 1 : 0, idx === 1 ? 1 : 0, idx === 2 ? 1 : 0);
}

function worldAxis(
	out: THREE.Vector3,
	idx: 0 | 1 | 2,
	meshParent: THREE.Object3D | null,
) {
	setAxis(out, idx);
	if (meshParent) out.transformDirection(meshParent.matrixWorld);
	else out.normalize();
}

function decomposeWorldDeltaToLatticeMm(
	deltaW: THREE.Vector3,
	frame: ObLatticeFrame,
	meshParent: THREE.Object3D | null,
	mmToWorld: number,
	out: { du: number; dv: number; dh: number },
) {
	const mw = Math.max(1e-9, mmToWorld);
	worldAxis(_axisU, frame.uIdx, meshParent);
	worldAxis(_axisV, frame.vIdx, meshParent);
	worldAxis(_axisH, frame.hIdx, meshParent);
	out.du = deltaW.dot(_axisU) / mw;
	out.dv = deltaW.dot(_axisV) / mw;
	out.dh = deltaW.dot(_axisH) / mw;
}

function applyModifierLocks(
	du: number,
	dv: number,
	dh: number,
	shift: boolean,
	alt: boolean,
) {
	if (alt) return { du: 0, dv: 0, dh };
	if (!shift) return { du, dv, dh };
	const adu = Math.abs(du);
	const adv = Math.abs(dv);
	const adh = Math.abs(dh);
	if (adu >= adv && adu >= adh) return { du, dv: 0, dh: 0 };
	if (adv >= adu && adv >= adh) return { du: 0, dv, dh: 0 };
	return { du: 0, dv: 0, dh };
}

export interface BoxLatticeEditorProps {
	latticeKit: LatticeEditKit;
	mmToWorld: number;
	active: boolean;
	savedOffsets?: BoxGridSavedOffsets | null;
	onSave?: (offsets: BoxGridSavedOffsets) => void;
	onOffsetsLiveChange?: (offsets: LatticeOffsetVec[]) => void;
	onDragEnd?: () => void;
}

export function BoxLatticeEditor({
	latticeKit,
	mmToWorld,
	active,
	savedOffsets,
	onSave,
	onOffsetsLiveChange,
	onDragEnd,
}: BoxLatticeEditorProps) {
	const { camera, gl, raycaster, invalidate } = useThree();
	const groupRef = useRef<THREE.Group>(null);
	const instanceRef = useRef<THREE.InstancedMesh>(null);
	const needsInstanceUpdate = useRef(true);

	// The canvas renders on demand (frameloop="demand"), so any handle/selection change
	// must request a frame or it won't paint until an unrelated render happens.
	const invalidateRef = useRef(invalidate);
	invalidateRef.current = invalidate;
	const markDirty = useCallback(() => {
		needsInstanceUpdate.current = true;
		invalidateRef.current();
	}, []);

	const frame = latticeKit.frame;
	const nodes = latticeKit.nodes;
	const cols = latticeKit.cols;
	const rows = latticeKit.rows;

	const offsetsRef = useRef<LatticeOffsetVec[]>([]);
	const hydratedKeyRef = useRef<string>('');

	const layers = latticeKit.layers;
	const sphereCap = cols * rows * layers + 8;
	const gridLinesGeo = useMemo(
		() => buildLatticeGridLines(frame, cols, rows, layers),
		[frame, cols, rows, layers],
	);
	const frameGeo = useMemo(() => buildFrameEdges(frame), [frame]);

	const avgSpacingRef = useRef(1);
	const maxDhRef = useRef(10);

	useEffect(() => {
		avgSpacingRef.current = estimateAverageNodeSpacing(nodes);
		const hSpan = frame.hMax - frame.hMin;
		maxDhRef.current = getMaxDhForSpan(hSpan, mmToWorld);
	}, [nodes, frame, mmToWorld]);

	const keySuffix = useMemo(() => {
		if (!savedOffsets || savedOffsets.cols !== cols || savedOffsets.rows !== rows) {
			return `zero:${cols}x${rows}x${layers}:${nodes.length}`;
		}
		return `${JSON.stringify(normalizeSavedOffsets(savedOffsets, layers))}#n${nodes.length}`;
	}, [cols, rows, layers, savedOffsets, nodes.length]);

	useEffect(() => {
		if (hydratedKeyRef.current === keySuffix) return;
		hydratedKeyRef.current = keySuffix;
		if (savedOffsets && savedOffsets.cols === cols && savedOffsets.rows === rows) {
			offsetsRef.current = hydrateLatticeOffsets(
				nodes,
				cols,
				rows,
				layers,
				savedOffsets,
			);
		} else {
			const n = cols * rows * layers;
			offsetsRef.current = Array.from({ length: n }, () => ({
				du: 0,
				dv: 0,
				dh: 0,
			}));
		}
		markDirty();
		if (
			savedOffsets &&
			Array.isArray(savedOffsets.offsets) &&
			savedOffsets.offsets.some(
				(o) =>
					typeof o === 'number'
						? Math.abs(o) > 1e-3
						: Math.abs((o as LatticeOffsetVec).du) > 1e-3 ||
								Math.abs((o as LatticeOffsetVec).dv) > 1e-3 ||
								Math.abs((o as LatticeOffsetVec).dh) > 1e-3,
			)
		) {
			setTimeout(() => onOffsetsLiveChangeRef.current?.([...offsetsRef.current]), 0);
		}
	}, [cols, rows, layers, keySuffix, markDirty]);

	const cameraRef = useRef(camera);
	cameraRef.current = camera;

	const mmToWorldRef = useRef(mmToWorld);
	mmToWorldRef.current = mmToWorld;

	const frameRef = useRef(frame);
	frameRef.current = frame;

	const onLiveRef = useRef(onOffsetsLiveChange);
	onLiveRef.current = onOffsetsLiveChange;

	const onDragEndRef = useRef(onDragEnd);
	onDragEndRef.current = onDragEnd;

	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;

	function getMeshParent(): THREE.Mesh | null {
		const g = groupRef.current;
		if (!g?.parent) return null;
		return g.parent instanceof THREE.Mesh ? g.parent : null;
	}

	const getSavePayload = useCallback((): BoxGridSavedOffsets => {
		return latticeVecsToSavePayload(cols, rows, layers, offsetsRef.current);
	}, [cols, rows, layers]);

	const saveDataRef = useRef(getSavePayload);
	saveDataRef.current = getSavePayload;

	const onOffsetsLiveChangeRef = useRef(onOffsetsLiveChange);
	onOffsetsLiveChangeRef.current = onOffsetsLiveChange;

	const previewRafRef = useRef<number | null>(null);
	const emitPreview = useCallback(() => {
		if (previewRafRef.current != null) return;
		previewRafRef.current = requestAnimationFrame(() => {
			previewRafRef.current = null;
			onLiveRef.current?.(offsetsRef.current);
		});
	}, []);

	const deformTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const emitCommit = useCallback(() => {
		if (deformTimerRef.current) clearTimeout(deformTimerRef.current);
		deformTimerRef.current = setTimeout(() => {
			deformTimerRef.current = null;
			onLiveRef.current?.(offsetsRef.current);
			onSaveRef.current?.(saveDataRef.current());
			onDragEndRef.current?.();
		}, 120);
	}, []);

	const hoveredIdxRef = useRef(-1);
	const selectedSetRef = useRef<Set<number>>(new Set());

	const dragging = useRef(false);
	const dragMovedRef = useRef(false);
	const dragSnap = useRef<LatticeOffsetVec[]>([]);
	const dragHandles = useRef<number[]>([]);
	const dragPlaneRef = useRef(new THREE.Plane());
	const planePointerStartWorldRef = useRef(new THREE.Vector3());

	const boxSelecting = useRef(false);
	const boxStartScreen = useRef({ x: 0, y: 0 });
	const boxOverlayRef = useRef<HTMLDivElement | null>(null);

	const lastHoverTs = useRef(0);

	const _mat4 = useMemo(() => new THREE.Matrix4(), []);
	const _color = useMemo(() => new THREE.Color(), []);

	const handleMeshLocal = (
		index: number,
		out: THREE.Vector3,
	) => {
		const n = nodes[index];
		const o = offsetsRef.current[index];
		const mw = mmToWorldRef.current;
		const f = frameRef.current;
		const nu = n.normalizedU;
		const nv = n.normalizedV;
		const nh = n.normalizedH;
		const u = f.uMin + nu * (f.uMax - f.uMin) + (o?.du ?? 0) * mw;
		const v = f.vMin + nv * (f.vMax - f.vMin) + (o?.dv ?? 0) * mw;
		const hBase = f.hMin + nh * (f.hMax - f.hMin);
		const h = hBase + (o?.dh ?? 0) * mw;
		out.set(0, 0, 0);
		out.setComponent(f.uIdx, u);
		out.setComponent(f.vIdx, v);
		out.setComponent(f.hIdx, h);
	};

	const updateInstances = useCallback(() => {
		const inst = instanceRef.current;
		if (!inst) return;
		const sel = selectedSetRef.current;
		const hover = hoveredIdxRef.current;
		for (let i = nodes.length; i < sphereCap; i++) {
			inst.setMatrixAt(i, _scaleZero);
		}
		for (let i = 0; i < nodes.length; i++) {
			const n = nodes[i];
			const isSel = sel.has(i);
			const isHov = hover === i;
			const r = isSel ? HANDLE_SEL_R : isHov ? HANDLE_HOVER_R : HANDLE_R;
			const act = n.active;
			if (!act) {
				inst.setMatrixAt(i, _scaleZero);
				continue;
			}
			handleMeshLocal(i, _instPosScratch);
			_mat4.makeScale(r, r, r).setPosition(_instPosScratch);
			inst.setMatrixAt(i, _mat4);
			_color.copy(
				!act ? COLOR_DIM : isSel ? COLOR_SELECTED : isHov ? COLOR_HOVER : COLOR_DEFAULT,
			);
			inst.setColorAt(i, _color);
		}
		inst.instanceMatrix.needsUpdate = true;
		if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
	}, [_mat4, _color, nodes]);

	useFrame(() => {
		if (!needsInstanceUpdate.current) return;
		updateInstances();
		needsInstanceUpdate.current = false;
	});

	const hitTestHandle = useCallback(
		(clientX: number, clientY: number): number | null => {
			const inst = instanceRef.current;
			if (!inst) return null;
			const rect = gl.domElement.getBoundingClientRect();
			_ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
			_ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(_ndc, cameraRef.current);
			const hits = raycaster.intersectObject(inst, false);
			if (hits.length > 0 && hits[0].instanceId != null) {
				const id = hits[0].instanceId;
				if (id < nodes.length && nodes[id].active) return id;
				return null;
			}
			return null;
		},
		[gl, raycaster, nodes],
	);

	const startPlaneDrag = useCallback(
		(screenX: number, screenY: number) => {
			const rect = gl.domElement.getBoundingClientRect();
			_ndc.x = ((screenX - rect.left) / rect.width) * 2 - 1;
			_ndc.y = -((screenY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(_ndc, cameraRef.current);
			const mh = getMeshParent();
			const hid = dragHandles.current[0] ?? 0;
			handleMeshLocal(hid, _hitW);
			if (mh) _hitW.applyMatrix4(mh.matrixWorld);

			cameraRef.current.getWorldPosition(_camW);
			const planeNorm = _planeN.copy(_camW).sub(_hitW).normalize();
			dragPlaneRef.current.setFromNormalAndCoplanarPoint(planeNorm, _hitW);

			if (
				!raycaster.ray.intersectPlane(
					dragPlaneRef.current,
					planePointerStartWorldRef.current,
				)
			)
				planePointerStartWorldRef.current.copy(_hitW);
		},
		[gl, raycaster],
	);

	const movePlaneDrag = useCallback(
		(screenX: number, screenY: number, e: PointerEvent) => {
			const rect = gl.domElement.getBoundingClientRect();
			_ndc.x = ((screenX - rect.left) / rect.width) * 2 - 1;
			_ndc.y = -((screenY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(_ndc, cameraRef.current);
			const mh = getMeshParent();
			if (
				!raycaster.ray.intersectPlane(dragPlaneRef.current, _hitW)
			)
				return;

			_deltaW.copy(_hitW).sub(planePointerStartWorldRef.current);
			const raw = { du: 0, dv: 0, dh: 0 };
			decomposeWorldDeltaToLatticeMm(
				_deltaW,
				frameRef.current,
				mh,
				mmToWorldRef.current,
				raw,
			);
			const mod = applyModifierLocks(raw.du, raw.dv, raw.dh, e.shiftKey, e.altKey);
			applyVecDeltaWithSmoothing(
				nodes,
				offsetsRef.current,
				dragSnap.current,
				dragHandles.current,
				mod.du,
				mod.dv,
				mod.dh,
				SMOOTH_RADIUS,
				avgSpacingRef.current,
				MAX_ABS_DU_DV,
				MAX_ABS_DU_DV,
				maxDhRef.current,
			);
		},
		[gl, raycaster, nodes],
	);

	useEffect(() => {
		if (!active) return;
		const el = gl.domElement;
		const stop = (ev: PointerEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			ev.stopImmediatePropagation?.();
		};

		const onDown = (e: PointerEvent) => {
			if (e.button !== 0) return;
			if (el.tabIndex < 0) el.tabIndex = 0;
			el.focus({ preventScroll: true });

			const hit = hitTestHandle(e.clientX, e.clientY);
			if (hit != null) {
				stop(e);
				if (e.ctrlKey) {
					const s = selectedSetRef.current;
					if (s.has(hit)) s.delete(hit);
					else s.add(hit);
					markDirty();
					return;
				}
				if (!selectedSetRef.current.has(hit)) {
					selectedSetRef.current = new Set([hit]);
					markDirty();
				}
				dragging.current = true;
				dragMovedRef.current = false;
				dragHandles.current =
					selectedSetRef.current.has(hit) && selectedSetRef.current.size > 1
						? Array.from(selectedSetRef.current)
						: [hit];
				dragSnap.current = offsetsRef.current.map((o) => ({
					du: o.du,
					dv: o.dv,
					dh: o.dh,
				}));
				startPlaneDrag(e.clientX, e.clientY);
				el.style.cursor = 'grabbing';
				return;
			}
			if (!e.ctrlKey) {
				if (selectedSetRef.current.size > 0) {
					selectedSetRef.current = new Set();
					markDirty();
				}
				return;
			}
			stop(e);
			boxSelecting.current = true;
			boxStartScreen.current = { x: e.clientX, y: e.clientY };
			selectedSetRef.current = new Set();
			markDirty();
		};

		const onMove = (e: PointerEvent) => {
			if (boxSelecting.current) {
				const overlay = boxOverlayRef.current;
				const parent = el.parentElement;
				if (overlay && parent) {
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
				return;
			}
			if (dragging.current) {
				movePlaneDrag(e.clientX, e.clientY, e);
				dragMovedRef.current = true;
				markDirty();
				emitPreview();
				return;
			}
			if (e.buttons !== 0) {
				if (hoveredIdxRef.current !== -1) {
					hoveredIdxRef.current = -1;
					markDirty();
					el.style.cursor = 'auto';
				}
				return;
			}
			const now = performance.now();
			if (now - lastHoverTs.current < 72) return;
			lastHoverTs.current = now;
			const h = hitTestHandle(e.clientX, e.clientY);
			if (h != null) {
				if (h !== hoveredIdxRef.current) {
					hoveredIdxRef.current = h;
					markDirty();
					el.style.cursor = 'grab';
				}
			} else if (hoveredIdxRef.current !== -1) {
				hoveredIdxRef.current = -1;
				markDirty();
				el.style.cursor = 'auto';
			}
		};

		const onUp = (e: PointerEvent) => {
			if (boxSelecting.current) {
				boxSelecting.current = false;
				if (boxOverlayRef.current) boxOverlayRef.current.style.display = 'none';
				const inst = instanceRef.current;
				const grp = groupRef.current;
				if (inst && grp) {
					const sel = new Set<number>();
					const rect = el.getBoundingClientRect();
					const sx = boxStartScreen.current.x;
					const sy = boxStartScreen.current.y;
					const ex = e.clientX;
					const ey = e.clientY;
					if (Math.abs(ex - sx) > 5 || Math.abs(ey - sy) > 5) {
						const x1 = Math.min(sx, ex);
						const y1 = Math.min(sy, ey);
						const x2 = Math.max(sx, ex);
						const y2 = Math.max(sy, ey);
						const v = new THREE.Vector3();
						const m4 = new THREE.Matrix4();
						for (let i = 0; i < nodes.length; i++) {
							if (!nodes[i].active) continue;
							inst.getMatrixAt(i, m4);
							v.setFromMatrixPosition(m4);
							grp.localToWorld(v);
							v.project(cameraRef.current);
							const sx2 = ((v.x + 1) / 2) * rect.width + rect.left;
							const sy2 = ((1 - v.y) / 2) * rect.height + rect.top;
							if (sx2 >= x1 && sx2 <= x2 && sy2 >= y1 && sy2 <= y2) {
								sel.add(i);
							}
						}
					}
					selectedSetRef.current = sel;
					markDirty();
				}
				return;
			}
			if (dragging.current) {
				dragging.current = false;
				el.style.cursor = 'auto';
				markDirty();
				// Only a real move needs the expensive deform commit; a plain selection
				// click must not trigger a full geometry rebuild.
				if (dragMovedRef.current) emitCommit();
				dragMovedRef.current = false;
			}
		};

		el.addEventListener('pointerdown', onDown);
		el.addEventListener('pointermove', onMove);
		el.addEventListener('pointerup', onUp);
		return () => {
			el.removeEventListener('pointerdown', onDown);
			el.removeEventListener('pointermove', onMove);
			el.removeEventListener('pointerup', onUp);
		};
	}, [
		active,
		gl,
		hitTestHandle,
		startPlaneDrag,
		movePlaneDrag,
		emitPreview,
		emitCommit,
		markDirty,
		nodes,
	]);

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

	useEffect(() => {
		if (!active) return;
		const el = gl.domElement;
		if (el.tabIndex < 0) el.tabIndex = 0;
		const step = 0.35;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')
				return;
			const s = selectedSetRef.current;
			if (s.size === 0) return;
			e.preventDefault();
			e.stopPropagation();
			const snap = offsetsRef.current.map((o) => ({ ...o }));
			let du = 0;
			let dv = 0;
			let dh = 0;
			const planar = e.ctrlKey || e.metaKey;
			if (planar) {
				if (e.key === 'ArrowUp') du = -step;
				else if (e.key === 'ArrowDown') du = step;
				else if (e.key === 'ArrowLeft') dv = step;
				else if (e.key === 'ArrowRight') dv = -step;
			} else if (e.key === 'ArrowUp') {
				dh = step;
			} else if (e.key === 'ArrowDown') {
				dh = -step;
			} else {
				return;
			}
			const mod = applyModifierLocks(du, dv, dh, e.shiftKey, e.altKey);
			applyVecDeltaWithSmoothing(
				nodes,
				offsetsRef.current,
				snap,
				Array.from(s),
				mod.du,
				mod.dv,
				mod.dh,
				SMOOTH_RADIUS,
				avgSpacingRef.current,
				MAX_ABS_DU_DV,
				MAX_ABS_DU_DV,
				maxDhRef.current,
			);
			markDirty();
			onLiveRef.current?.(offsetsRef.current);
			onSaveRef.current?.(saveDataRef.current());
			onDragEndRef.current?.();
		};
		document.addEventListener('keydown', onKey, true);
		return () => document.removeEventListener('keydown', onKey, true);
	}, [active, gl, nodes, markDirty]);

	useEffect(() => {
		return () => {
			if (deformTimerRef.current) clearTimeout(deformTimerRef.current);
			if (previewRafRef.current != null) cancelAnimationFrame(previewRafRef.current);
		};
	}, []);

	if (!active) return null;

	return (
		<group ref={groupRef}>
			<lineSegments geometry={gridLinesGeo} renderOrder={9}>
				<lineBasicMaterial
					color={COLOR_GRID_LINE}
					transparent
					opacity={GRID_LINE_OPACITY}
					depthTest={false}
					depthWrite={false}
					toneMapped={false}
				/>
			</lineSegments>
			<lineSegments geometry={frameGeo} renderOrder={10}>
				<lineBasicMaterial
					color={COLOR_FRAME}
					transparent
					opacity={FRAME_OPACITY}
					depthTest={false}
					depthWrite={false}
					toneMapped={false}
				/>
			</lineSegments>
			<instancedMesh
				ref={instanceRef}
				args={[_sphere, undefined, sphereCap]}
				renderOrder={11}
				frustumCulled={false}
			>
				<meshBasicMaterial
					transparent={false}
					depthTest={false}
					depthWrite={false}
					toneMapped={false}
				/>
			</instancedMesh>
		</group>
	);
}

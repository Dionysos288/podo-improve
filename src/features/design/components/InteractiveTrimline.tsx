'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { TrimlineHandleProfile } from '@/src/shared/components/design/TrimlineEditOverlay';
import {
	extractContour,
	type ContourData,
} from '@/src/features/design/utils/interactiveTrimlineContour';

const MIN_MM = -5;
const MAX_MM = 8;
const BINS = 48;
const SMOOTH_RADIUS = 4;
const GAUSS_SIGMA = 2;

function clampMm(v: number): number {
	return Math.max(MIN_MM, Math.min(MAX_MM, v));
}

function buildCurveFlatOrder(bins: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < bins; i++) out.push(i);
	for (let j = bins - 1; j >= 0; j--) out.push(bins + j);
	return out;
}

function cyclicVertexDistance(a: number, b: number, n: number): number {
	const d = Math.abs(a - b);
	return Math.min(d, n - d);
}

function gaussianFalloff(vertexDist: number, radius: number, sigma: number): number {
	if (vertexDist > radius) return 0;
	return Math.exp(-0.5 * (vertexDist / sigma) ** 2);
}

function fillOriginals(contour: ContourData, out: Float32Array): void {
	const bins = contour.bins;
	for (let i = 0; i < bins; i++) {
		const ri = i * 3;
		out[ri] = contour.rightPos[ri];
		out[ri + 1] = contour.rightPos[ri + 1];
		out[ri + 2] = contour.rightPos[ri + 2];
	}
	for (let j = 0; j < bins; j++) {
		const fi = (bins + j) * 3;
		const li = j * 3;
		out[fi] = contour.leftPos[li];
		out[fi + 1] = contour.leftPos[li + 1];
		out[fi + 2] = contour.leftPos[li + 2];
	}
}

function hydratePoints(originals: Float32Array, out: Float32Array): void {
	out.set(originals);
}

function buildTrimlineProfileFromPoints(
	contour: ContourData,
	points: Float32Array,
	originals: Float32Array,
	mw: number,
	prevProfile: TrimlineHandleProfile | null | undefined,
): TrimlineHandleProfile {
	const bins = contour.bins;
	const points3D: { x: number; y: number; z: number }[] = [];
	const rightOffsetsMm: number[] = [];
	const leftOffsetsMm: number[] = [];
	const rightHeightOffsetsMm: number[] = [];
	const leftHeightOffsetsMm: number[] = [];
	const ha = contour.heightAxis;
	const hxN = ha === 'x' ? 1 : 0;
	const hyN = ha === 'y' ? 1 : 0;
	const hzN = ha === 'z' ? 1 : 0;

	const hasPrev =
		prevProfile &&
		prevProfile.bins === bins &&
		prevProfile.rightOffsetsMm.length === bins &&
		prevProfile.leftOffsetsMm.length === bins;
	const prevR = hasPrev ? prevProfile.rightOffsetsMm : null;
	const prevL = hasPrev ? prevProfile.leftOffsetsMm : null;
	const prevRH = hasPrev ? prevProfile.rightHeightOffsetsMm : null;
	const prevLH = hasPrev ? prevProfile.leftHeightOffsetsMm : null;

	for (let i = 0; i < bins; i++) {
		const ri = i * 3;
		const dx = points[ri] - originals[ri];
		const dy = points[ri + 1] - originals[ri + 1];
		const dz = points[ri + 2] - originals[ri + 2];
		const nx = contour.rightNormals[ri];
		const ny = contour.rightNormals[ri + 1];
		const nz = contour.rightNormals[ri + 2];
		const dW = (dx * nx + dy * ny + dz * nz) / mw;
		const dH = (dx * hxN + dy * hyN + dz * hzN) / mw;
		rightOffsetsMm.push(clampMm((prevR?.[i] ?? 0) + dW));
		rightHeightOffsetsMm.push(clampMm((prevRH?.[i] ?? 0) + dH));
		points3D.push({ x: points[ri], y: points[ri + 1], z: points[ri + 2] });
	}
	for (let j = 0; j < bins; j++) {
		const fi = (bins + j) * 3;
		const li = j * 3;
		const dx = points[fi] - originals[fi];
		const dy = points[fi + 1] - originals[fi + 1];
		const dz = points[fi + 2] - originals[fi + 2];
		const nx = contour.leftNormals[li];
		const ny = contour.leftNormals[li + 1];
		const nz = contour.leftNormals[li + 2];
		const dW = (dx * nx + dy * ny + dz * nz) / mw;
		const dH = (dx * hxN + dy * hyN + dz * hzN) / mw;
		leftOffsetsMm.push(clampMm((prevL?.[j] ?? 0) + dW));
		leftHeightOffsetsMm.push(clampMm((prevLH?.[j] ?? 0) + dH));
		points3D.push({ x: points[fi], y: points[fi + 1], z: points[fi + 2] });
	}

	return {
		bins,
		tValues: Array.from(contour.tValues),
		rightOffsetsMm,
		leftOffsetsMm,
		rightHeightOffsetsMm,
		leftHeightOffsetsMm,
		widthAxis: contour.widthAxis,
		points3D,
		version: 2,
	};
}

function closestFlatIndex(hitLocal: THREE.Vector3, points: Float32Array, bins: number): number {
	let best = 0;
	let bestD = Infinity;
	const n = bins * 2;
	for (let flat = 0; flat < n; flat++) {
		const o = flat * 3;
		const dx = hitLocal.x - points[o];
		const dy = hitLocal.y - points[o + 1];
		const dz = hitLocal.z - points[o + 2];
		const d = dx * dx + dy * dy + dz * dz;
		if (d < bestD) {
			bestD = d;
			best = flat;
		}
	}
	return best;
}

function applyGaussianDeltaToSnapshot(
	contour: ContourData,
	snapshot: Float32Array,
	out: Float32Array,
	deltaLocal: THREE.Vector3,
	centerFlat: number,
	curveOrder: number[],
): void {
	const bins = contour.bins;
	const N = curveOrder.length;
	const cvCenter = curveOrder.indexOf(centerFlat);
	if (cvCenter < 0) return;

	out.set(snapshot);

	const totalFlat = bins * 2;
	for (let flat = 0; flat < totalFlat; flat++) {
		const cv = curveOrder.indexOf(flat);
		if (cv < 0) continue;
		const dist = cyclicVertexDistance(cv, cvCenter, N);
		const w = gaussianFalloff(dist, SMOOTH_RADIUS, GAUSS_SIGMA);
		if (w < 1e-9) continue;
		const o = flat * 3;
		out[o] += deltaLocal.x * w;
		out[o + 1] += deltaLocal.y * w;
		out[o + 2] += deltaLocal.z * w;
	}
}

function OutlineLine({ geometry }: { geometry: THREE.BufferGeometry }) {
	const lineObj = useMemo(() => {
		const mat = new THREE.LineBasicMaterial({
			color: '#56f2d6',
			transparent: false,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
		});
		const line = new THREE.Line(geometry, mat);
		line.renderOrder = 11;
		return line;
	}, [geometry]);

	useEffect(
		() => () => {
			(lineObj.material as THREE.Material).dispose();
		},
		[lineObj],
	);

	return <primitive object={lineObj} />;
}

export interface InteractiveTrimlineProps {
	insoleGeometry: THREE.BufferGeometry | null;
	profile?: TrimlineHandleProfile | null;
	onPendingProfileChange?: (profile: TrimlineHandleProfile) => void;
	mmToWorld: number;
	active: boolean;
	onDragActiveChange?: (active: boolean) => void;
}

export function InteractiveTrimline({
	insoleGeometry,
	profile,
	onPendingProfileChange,
	mmToWorld,
	active,
	onDragActiveChange,
}: InteractiveTrimlineProps) {
	const { camera, gl, raycaster } = useThree();
	const invalidate = useThree((s) => s.invalidate);
	const groupRef = useRef<THREE.Group>(null);

	const contour = useMemo(() => {
		if (!insoleGeometry) return null;
		return extractContour(insoleGeometry, BINS);
	}, [insoleGeometry]);

	const curveOrder = useMemo(() => (contour ? buildCurveFlatOrder(contour.bins) : []), [contour]);

	const originalsRef = useRef<Float32Array>(new Float32Array(0));
	const pointsRef = useRef<Float32Array>(new Float32Array(0));
	const trimDragActiveRef = useRef(false);
	const dragPlane = useRef(new THREE.Plane());
	const dragSnap = useRef<Float32Array>(new Float32Array(0));
	const dragStartLocal = useRef(new THREE.Vector3());
	const dragCenterFlat = useRef(0);

	const [curveTick, setCurveTick] = useState(0);
	const bumpCurve = useCallback(() => setCurveTick((t) => t + 1), []);

	useEffect(() => {
		if (!contour) return;
		if (trimDragActiveRef.current) return;
		const n = contour.bins * 2 * 3;
		originalsRef.current = new Float32Array(n);
		fillOriginals(contour, originalsRef.current);
		pointsRef.current = new Float32Array(n);
		hydratePoints(originalsRef.current, pointsRef.current);
		bumpCurve();
	}, [contour, bumpCurve]);

	const flushEmit = useCallback(() => {
		const c = contour;
		if (!c || !onPendingProfileChange) return;
		onPendingProfileChange(
			buildTrimlineProfileFromPoints(c, pointsRef.current, originalsRef.current, mmToWorld, profile),
		);
		originalsRef.current = pointsRef.current.slice();
	}, [contour, mmToWorld, onPendingProfileChange, profile]);

	const outlineGeo = useMemo(() => {
		if (!contour || pointsRef.current.length === 0) return null;
		const pts = pointsRef.current;
		const ptsVec: THREE.Vector3[] = [];
		for (const flatIdx of curveOrder) {
			const o = flatIdx * 3;
			ptsVec.push(new THREE.Vector3(pts[o], pts[o + 1], pts[o + 2]));
		}
		if (ptsVec.length > 0) ptsVec.push(ptsVec[0]!.clone());
		const geo = new THREE.BufferGeometry().setFromPoints(ptsVec);
		return geo;
	}, [contour, curveTick, curveOrder]);

	const tubeGeo = useMemo(() => {
		if (!contour || pointsRef.current.length === 0) return null;
		const pts = pointsRef.current;
		const ptsVec: THREE.Vector3[] = [];
		for (const flatIdx of curveOrder) {
			const o = flatIdx * 3;
			ptsVec.push(new THREE.Vector3(pts[o], pts[o + 1], pts[o + 2]));
		}
		if (ptsVec.length < 4) return null;
		const curve = new THREE.CatmullRomCurve3(ptsVec, true, 'catmullrom', 0.35);
		const radius = Math.max(mmToWorld * 0.55, 0.28);
		const geo = new THREE.TubeGeometry(curve, 72, radius, 6, true);
		return geo;
	}, [contour, curveTick, curveOrder, mmToWorld]);

	useEffect(() => () => outlineGeo?.dispose(), [outlineGeo]);
	useEffect(() => () => tubeGeo?.dispose(), [tubeGeo]);

	const cameraRef = useRef(camera);
	cameraRef.current = camera;
	const contourRef = useRef(contour);
	contourRef.current = contour;
	const curveOrderRef = useRef(curveOrder);
	curveOrderRef.current = curveOrder;

	const _ndc = useRef(new THREE.Vector2());
	const _hitWorld = useRef(new THREE.Vector3());
	const _hitLocal = useRef(new THREE.Vector3());
	const _deltaLocal = useRef(new THREE.Vector3());
	const _planeNorm = useRef(new THREE.Vector3());

	useEffect(() => {
		return () => {
			if (!trimDragActiveRef.current) return;
			trimDragActiveRef.current = false;
			onDragActiveChange?.(false);
		};
	}, [onDragActiveChange]);

	useEffect(() => {
		if (active || !trimDragActiveRef.current) return;
		trimDragActiveRef.current = false;
		onDragActiveChange?.(false);
	}, [active, onDragActiveChange]);

	const onTubePointerDown = useCallback(
		(e: ThreeEvent<PointerEvent>) => {
			e.stopPropagation();
			const ne = e.nativeEvent as PointerEvent;
			if (typeof ne.stopImmediatePropagation === 'function') {
				ne.stopImmediatePropagation();
			}
			ne.preventDefault?.();
			const grp = groupRef.current;
			const c = contourRef.current;
			if (!grp || !c || e.nativeEvent.button !== 0) return;
			const inter = e.intersections[0];
			if (!inter?.point) return;

			const planeNorm = _planeNorm.current;
			cameraRef.current.getWorldDirection(planeNorm).negate();
			dragPlane.current.setFromNormalAndCoplanarPoint(planeNorm, inter.point);

			_hitLocal.current.copy(inter.point);
			grp.worldToLocal(_hitLocal.current);
			dragStartLocal.current.copy(_hitLocal.current);
			dragSnap.current = pointsRef.current.slice();
			dragCenterFlat.current = closestFlatIndex(_hitLocal.current, pointsRef.current, c.bins);
			trimDragActiveRef.current = true;
			onDragActiveChange?.(true);

			if (typeof e.nativeEvent.pointerId === 'number') {
				gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
			}
			// eslint-disable-next-line react-hooks/immutability -- canvas cursor UX; not React state
			gl.domElement.style.cursor = 'grabbing';
		},
		[gl, onDragActiveChange],
	);

	useEffect(() => {
		if (!active) return;
		const el = gl.domElement;

		const onMove = (ev: PointerEvent) => {
			if (!trimDragActiveRef.current) return;
			const grp = groupRef.current;
			const c = contourRef.current;
			if (!grp || !c) return;

			const rect = el.getBoundingClientRect();
			_ndc.current.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
			_ndc.current.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(_ndc.current, cameraRef.current);

			if (!raycaster.ray.intersectPlane(dragPlane.current, _hitWorld.current)) return;

			_hitLocal.current.copy(_hitWorld.current);
			grp.worldToLocal(_hitLocal.current);

			_deltaLocal.current.subVectors(_hitLocal.current, dragStartLocal.current);

			applyGaussianDeltaToSnapshot(
				c,
				dragSnap.current,
				pointsRef.current,
				_deltaLocal.current,
				dragCenterFlat.current,
				curveOrderRef.current,
			);

			bumpCurve();
			invalidate();
		};

		const endDrag = (ev: PointerEvent) => {
			if (!trimDragActiveRef.current) return;
			trimDragActiveRef.current = false;
			onDragActiveChange?.(false);

			if (typeof ev.pointerId === 'number') {
				try {
					el.releasePointerCapture(ev.pointerId);
				} catch {
					/* ignore */
				}
			}
			el.style.cursor = 'auto';
			flushEmit();
			invalidate();
		};

		el.addEventListener('pointermove', onMove);
		el.addEventListener('pointerup', endDrag);
		el.addEventListener('pointercancel', endDrag);
		return () => {
			el.removeEventListener('pointermove', onMove);
			el.removeEventListener('pointerup', endDrag);
			el.removeEventListener('pointercancel', endDrag);
		};
	}, [active, bumpCurve, flushEmit, gl.domElement, invalidate, onDragActiveChange, raycaster]);

	if (!active || !contour || outlineGeo === null || tubeGeo === null) return null;

	return (
		<group ref={groupRef}>
			<OutlineLine geometry={outlineGeo} />
			<mesh
				geometry={tubeGeo}
				renderOrder={12}
				frustumCulled={false}
				onPointerDown={onTubePointerDown}
			>
				<meshBasicMaterial
					transparent
					opacity={0}
					depthTest={false}
					depthWrite={false}
				/>
			</mesh>
		</group>
	);
}

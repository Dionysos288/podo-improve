'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { ScanManualAlignment } from '@/src/features/design/types/types';

export interface InteractiveScanRotateProps {
	insoleGeometry: THREE.BufferGeometry | null;
	scanGeometry: THREE.BufferGeometry | null;
	insolePickRootRef: React.MutableRefObject<THREE.Group | null>;
	overlayPickRootRef: React.MutableRefObject<THREE.Group | null>;
	upAxisWorld: THREE.Vector3;
	alignment: ScanManualAlignment | null;
	onPendingAlignmentChange: (a: ScanManualAlignment | null) => void;
	active: boolean;
	onDragActiveChange?: (active: boolean) => void;
	mmToWorld: number;
}

function buildPlaneBasis(up: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
	const refDir = Math.abs(up.z) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
	const u = new THREE.Vector3().crossVectors(refDir, up).normalize();
	const v = new THREE.Vector3().crossVectors(up, u).normalize();
	return { u, v };
}

function tangentAngleOnPlane(dx: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3): number {
	return Math.atan2(dx.dot(v), dx.dot(u));
}

export function InteractiveScanRotate({
	insolePickRootRef,
	overlayPickRootRef,
	upAxisWorld,
	alignment,
	onPendingAlignmentChange,
	active,
	onDragActiveChange,
	mmToWorld,
}: InteractiveScanRotateProps) {
	const normalizedUp = useMemo(() => {
		const u = upAxisWorld.clone().normalize();
		if (u.lengthSq() < 1e-12) u.set(0, 1, 0);
		return u;
	}, [upAxisWorld]);

	const { camera, gl, raycaster, invalidate } = useThree();

	const ndc = useRef(new THREE.Vector2());
	const pivotHandlersRef = useRef<THREE.Vector3 | null>(null);
	useEffect(() => {
		pivotHandlersRef.current =
			alignment?.pivot != null
				? new THREE.Vector3(alignment.pivot[0], alignment.pivot[1], alignment.pivot[2])
				: null;
	}, [alignment]);

	const pivotWorldVisual = useMemo(
		() =>
			alignment?.pivot != null
				? new THREE.Vector3(alignment.pivot[0], alignment.pivot[1], alignment.pivot[2])
				: null,
		[alignment],
	);

	const [interactionPhase, setInteractionPhase] = useState<
		'idle' | 'have_pivot' | 'rotating'
	>('idle');
	const interactionPhaseRef = useRef(interactionPhase);

	useLayoutEffect(() => {
		interactionPhaseRef.current = interactionPhase;
	}, [interactionPhase]);

	const [pickedRadialWorld, setPickedRadialWorld] = useState<number | null>(null);

	const pivotPlane = useRef(new THREE.Plane());
	const planeScratch = useRef(new THREE.Plane());
	const dxScratch = useRef(new THREE.Vector3());
	const projScratch = useRef(new THREE.Vector3());
	const rayHit = useRef(new THREE.Vector3());

	const initialAngleRef = useRef(0);
	const initialYawRef = useRef(0);
	const rotatingRef = useRef(false);

	const projectOntoPivotPlane = useCallback(
		(raw: THREE.Vector3, pivot: THREE.Vector3, target: THREE.Vector3) => {
			planeScratch.current.setFromNormalAndCoplanarPoint(normalizedUp, pivot);
			return planeScratch.current.projectPoint(raw, target);
		},
		[normalizedUp],
	);

	const ringRadiusWorld = Math.max(mmToWorld * 6, 0.35);
	const minRadialWorld = Math.max(mmToWorld * 22, 1);
	const radialWorld = Math.max(pickedRadialWorld ?? minRadialWorld, minRadialWorld);
	const tubeWorld = Math.max(mmToWorld * 0.35, 0.045);
	const handleRadius = Math.max(mmToWorld * 2.6, 0.18);

	const intersectCanvas = useCallback(
		(ev: PointerEvent): THREE.Vector3 | null => {
			const el = gl.domElement;
			const rect = el.getBoundingClientRect();
			ndc.current.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
			ndc.current.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(ndc.current, camera);
			const roots = [overlayPickRootRef.current, insolePickRootRef.current].filter(
				Boolean,
			) as THREE.Object3D[];
			const hits = raycaster.intersectObjects(roots, true);
			return hits.length > 0 ? hits[0]!.point.clone() : null;
		},
		[camera, gl.domElement, insolePickRootRef, overlayPickRootRef, raycaster],
	);

	useEffect(() => {
		if (!active) return undefined;
		const el = gl.domElement;

		const bindPlane = () => {
			const piv = pivotHandlersRef.current;
			if (piv) pivotPlane.current.setFromNormalAndCoplanarPoint(normalizedUp, piv);
		};

		const onDown = (ev: PointerEvent) => {
			if (ev.button !== 0) return;
			const ne = ev as PointerEvent;
			if (typeof ne.stopImmediatePropagation === 'function') ne.stopImmediatePropagation();
			ne.preventDefault?.();

			if (interactionPhaseRef.current === 'idle') {
				const hit = intersectCanvas(ev);
				if (!hit) return;
				setPickedRadialWorld(Math.max(ringRadiusWorld * 5, mmToWorld * 24));
				pivotHandlersRef.current = hit.clone();
				onPendingAlignmentChange({
					pivot: hit.toArray() as [number, number, number],
					yawRad: alignment?.yawRad ?? 0,
				});
				bindPlane();
				setInteractionPhase('have_pivot');
				interactionPhaseRef.current = 'have_pivot';
				invalidate();
				return;
			}

			if (interactionPhaseRef.current === 'have_pivot') {
				const piv = pivotHandlersRef.current;
				if (!piv) return;
				bindPlane();

				const rect = el.getBoundingClientRect();
				ndc.current.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
				ndc.current.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
				raycaster.setFromCamera(ndc.current, camera);

				const surfaceHit = intersectCanvas(ev);
				const planeHitPt = rayHit.current;
				if (!raycaster.ray.intersectPlane(pivotPlane.current, planeHitPt)) {
					if (!surfaceHit) return;
					projectOntoPivotPlane(surfaceHit, piv, planeHitPt);
				} else {
					projectOntoPivotPlane(planeHitPt, piv, planeHitPt);
				}

				if (surfaceHit) {
					const pr = projScratch.current.copy(surfaceHit);
					projectOntoPivotPlane(pr, piv, pr);
					setPickedRadialWorld(Math.max(pr.distanceTo(piv), ringRadiusWorld * 3));
				}

				const basis = buildPlaneBasis(normalizedUp);
				dxScratch.current.subVectors(planeHitPt, piv);
				initialAngleRef.current = tangentAngleOnPlane(dxScratch.current, basis.u, basis.v);
				initialYawRef.current = alignment?.yawRad ?? 0;

				rotatingRef.current = true;
				onDragActiveChange?.(true);
				el.setPointerCapture(ev.pointerId);
				el.style.cursor = 'grabbing';

				setInteractionPhase('rotating');
				interactionPhaseRef.current = 'rotating';
				invalidate();
			}
		};

		const onMove = (ev: PointerEvent) => {
			if (!rotatingRef.current) return;
			const piv = pivotHandlersRef.current;
			if (!piv) return;

			const rect = el.getBoundingClientRect();
			ndc.current.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
			ndc.current.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(ndc.current, camera);
			const planeHitPt = rayHit.current;
			if (!raycaster.ray.intersectPlane(pivotPlane.current, planeHitPt)) return;

			projectOntoPivotPlane(planeHitPt, piv, planeHitPt);

			const basis = buildPlaneBasis(normalizedUp);
			dxScratch.current.subVectors(planeHitPt, piv);
			const angle = tangentAngleOnPlane(dxScratch.current, basis.u, basis.v);
			const yaw = initialYawRef.current + angle - initialAngleRef.current;
			onPendingAlignmentChange({
				pivot: piv.toArray() as [number, number, number],
				yawRad: yaw,
			});
			invalidate();
		};

		const onEnd = (ev: PointerEvent) => {
			if (!rotatingRef.current) return;
			rotatingRef.current = false;
			onDragActiveChange?.(false);
			try {
				el.releasePointerCapture(ev.pointerId);
			} catch {
				/* noop */
			}
			el.style.cursor = '';

			setInteractionPhase('idle');
			interactionPhaseRef.current = 'idle';
			invalidate();
		};

		bindPlane();

		el.addEventListener('pointerdown', onDown);
		el.addEventListener('pointermove', onMove);
		el.addEventListener('pointerup', onEnd);
		el.addEventListener('pointercancel', onEnd);
		el.addEventListener('lostpointercapture', onEnd);

		return () => {
			el.removeEventListener('pointerdown', onDown);
			el.removeEventListener('pointermove', onMove);
			el.removeEventListener('pointerup', onEnd);
			el.removeEventListener('pointercancel', onEnd);
			el.removeEventListener('lostpointercapture', onEnd);
		};
	}, [
		active,
		alignment,
		camera,
		gl.domElement,
		invalidate,
		intersectCanvas,
		mmToWorld,
		normalizedUp,
		onDragActiveChange,
		onPendingAlignmentChange,
		projectOntoPivotPlane,
		raycaster,
		ringRadiusWorld,
	]);

	useEffect(() => {
		return () => {
			if (!rotatingRef.current) return;
			rotatingRef.current = false;
			onDragActiveChange?.(false);
		};
	}, [onDragActiveChange]);

	const canShowLever =
		active &&
		Boolean(alignment && pivotWorldVisual) &&
		(interactionPhase === 'have_pivot' || interactionPhase === 'rotating');

	const yaw = alignment?.yawRad ?? 0;

	const leverEnd =
		canShowLever && pivotWorldVisual
			? (() => {
					const basis = buildPlaneBasis(normalizedUp);
					return pivotWorldVisual
						.clone()
						.addScaledVector(basis.u, Math.cos(yaw) * radialWorld)
						.addScaledVector(basis.v, Math.sin(yaw) * radialWorld);
				})()
			: null;

	return (
		<group renderOrder={12}>
			{pivotWorldVisual && alignment && (
				<group position={pivotWorldVisual}>
					<mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={12}>
						<torusGeometry args={[ringRadiusWorld, tubeWorld, 26, 48]} />
						<meshBasicMaterial
							color="#56f2d6"
							transparent
							opacity={0.92}
							depthTest={false}
							depthWrite={false}
							wireframe
							toneMapped={false}
						/>
					</mesh>
				</group>
			)}

			{canShowLever && leverEnd && pivotWorldVisual && (
				<>
					<Line
						points={[pivotWorldVisual, leverEnd]}
						color="#56f2d6"
						lineWidth={1.75}
						depthTest={false}
						renderOrder={12}
						transparent
						opacity={0.82}
						toneMapped={false}
					/>
					<mesh position={leverEnd} renderOrder={12}>
						<circleGeometry args={[handleRadius, 24]} />
						<meshBasicMaterial
							color="#56f2d6"
							transparent
							opacity={0.35}
							depthTest={false}
							depthWrite={false}
							toneMapped={false}
							side={THREE.DoubleSide}
						/>
					</mesh>
				</>
			)}
		</group>
	);
}

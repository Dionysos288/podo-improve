'use client';

import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { buildSideInspectionProfile } from '@/src/features/design/utils/sideInspectionProfile';

export type SideInspectionLayersProps = {
	geometry: THREE.BufferGeometry;
	meshRef: RefObject<THREE.Mesh | null>;
	enabled: boolean;
};

const MIN_REBUILD_MS = 100;

/** Profile overlays for Links/Rechts camera — world-space lines + translucent fill */
export function SideInspectionLayers({ geometry, meshRef, enabled }: SideInspectionLayersProps) {
	const camera = useThree((s) => s.camera);
	const [top, setTop] = useState<THREE.Vector3[]>([]);
	const [bottom, setBottom] = useState<THREE.Vector3[]>([]);
	const [fillGeometry, setFillGeometry] = useState<THREE.BufferGeometry | null>(null);
	const lastSigRef = useRef('');
	const lastRebuildRef = useRef(0);
	const fillDisposableRef = useRef<THREE.BufferGeometry | null>(null);

	const disposeFill = () => {
		fillDisposableRef.current?.dispose();
		fillDisposableRef.current = null;
	};

	useEffect(() => {
		return () => disposeFill();
	}, []);

	useEffect(() => {
		if (!enabled) {
			lastSigRef.current = '';
			disposeFill();
			setFillGeometry(null);
			setTop([]);
			setBottom([]);
		}
	}, [enabled]);

	useFrame(() => {
		if (!enabled) return;
		const mesh = meshRef.current;
		if (!mesh) return;

		const posAttr = geometry.getAttribute('position');
		if (!(posAttr instanceof THREE.BufferAttribute)) return;

		mesh.updateWorldMatrix(true, false);
		const mw = mesh.matrixWorld;

		const camPos = new THREE.Vector3();
		camera.getWorldPosition(camPos);
		const box = new THREE.Box3().setFromObject(mesh);
		const target = box.getCenter(new THREE.Vector3());
		const camUp = camera.up.clone();

		const sig = [
			geometry.uuid,
			posAttr.version,
			Array.from(mw.elements).map((n) => n.toFixed(5)).join(','),
			camPos.toArray().map((n) => n.toFixed(4)).join(','),
			target.toArray().map((n) => n.toFixed(4)).join(','),
			camUp.toArray().map((n) => n.toFixed(4)).join(','),
		].join('|');

		if (sig === lastSigRef.current) return;

		const now = performance.now();
		if (now - lastRebuildRef.current < MIN_REBUILD_MS) return;

		lastSigRef.current = sig;
		lastRebuildRef.current = now;

		const built = buildSideInspectionProfile(geometry, mw, camPos, target, camUp);
		if (!built) {
			disposeFill();
			setFillGeometry(null);
			setTop([]);
			setBottom([]);
			return;
		}

		disposeFill();
		fillDisposableRef.current = built.fillGeometry;
		setFillGeometry(built.fillGeometry);
		setTop(built.top);
		setBottom(built.bottom);
	});

	if (!enabled) return null;

	return (
		<group>
			{fillGeometry ? (
				<mesh geometry={fillGeometry} renderOrder={2}>
					<meshBasicMaterial
						color="#4fd1c5"
						transparent
						opacity={0.17}
						depthWrite={false}
						side={THREE.DoubleSide}
						polygonOffset
						polygonOffsetFactor={1}
						polygonOffsetUnits={1}
					/>
				</mesh>
			) : null}
			{bottom.length > 1 ? (
				<Line points={bottom} color="#94a3b8" lineWidth={2} renderOrder={4} />
			) : null}
			{top.length > 1 ? (
				<Line points={top} color="#56f2d6" lineWidth={2.5} renderOrder={4} />
			) : null}
		</group>
	);
}

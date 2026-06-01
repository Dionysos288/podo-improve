'use client';

import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { buildSideInspectionProfile } from '@/src/features/design/utils/sideInspectionProfile';

export type SideInspectionLayerStyle = {
	topColor?: string;
	bottomColor?: string;
	fillColor?: string;
	fillOpacity?: number;
	topSurfaceColor?: string;
	topSurfaceOpacity?: number;
	topSurfaceDepthWorld?: number;
	showTopLine?: boolean;
	lineWidth?: number;
	renderOrder?: number;
};

export type SideInspectionLayersProps = {
	geometry: THREE.BufferGeometry;
	meshRef: RefObject<THREE.Object3D | null>;
	enabled: boolean;
	sideView: 'left' | 'right';
	style?: SideInspectionLayerStyle;
};

const MIN_REBUILD_MS = 100;
const SIDE_PROFILE_RENDER_ORDER = 9;
const SIDE_PROFILE_AXES = {
	left: {
		up: new THREE.Vector3(0, 1, 0),
		lateral: new THREE.Vector3(0, 0, -1),
	},
	right: {
		up: new THREE.Vector3(0, 1, 0),
		lateral: new THREE.Vector3(0, 0, 1),
	},
} as const;

function buildProfileFillGeometry(top: THREE.Vector3[], bottom: THREE.Vector3[]): THREE.BufferGeometry | null {
	const count = Math.min(top.length, bottom.length);
	if (count < 2) return null;

	const verts: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i < count; i++) {
		const b = bottom[i]!;
		const t = top[i]!;
		verts.push(b.x, b.y, b.z, t.x, t.y, t.z);
	}
	for (let i = 0; i < count - 1; i++) {
		const b0 = i * 2;
		const t0 = b0 + 1;
		const b1 = b0 + 2;
		const t1 = b0 + 3;
		indices.push(b0, b1, t1, b0, t1, t0);
	}

	const fill = new THREE.BufferGeometry();
	fill.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
	fill.setIndex(indices);
	fill.computeVertexNormals();
	return fill;
}

function buildTopSurfaceLayerGeometry(
	top: THREE.Vector3[],
	up: THREE.Vector3,
	thicknessWorld: number,
): THREE.BufferGeometry | null {
	if (top.length < 2) return null;

	const innerOffset = up.clone();
	if (innerOffset.lengthSq() < 1e-12) innerOffset.set(0, 1, 0);
	innerOffset.normalize().multiplyScalar(-Math.max(0.05, thicknessWorld));

	const verts: number[] = [];
	const indices: number[] = [];
	for (const topPoint of top) {
		const inner = topPoint.clone().add(innerOffset);
		verts.push(topPoint.x, topPoint.y, topPoint.z, inner.x, inner.y, inner.z);
	}

	for (let i = 0; i < top.length - 1; i++) {
		const t0 = i * 2;
		const b0 = t0 + 1;
		const t1 = t0 + 2;
		const b1 = t0 + 3;
		indices.push(t0, b0, b1, t0, b1, t1);
	}

	const layer = new THREE.BufferGeometry();
	layer.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
	layer.setIndex(indices);
	layer.computeVertexNormals();
	return layer;
}

/** Stable Links/Rechts side profile: top surface + dark bottom baseline only. */
export function SideInspectionLayers({
	geometry,
	meshRef,
	enabled,
	sideView,
	style,
}: SideInspectionLayersProps) {
	const [top, setTop] = useState<THREE.Vector3[]>([]);
	const [bottom, setBottom] = useState<THREE.Vector3[]>([]);
	const [fillGeometry, setFillGeometry] = useState<THREE.BufferGeometry | null>(null);
	const [topSurfaceGeometry, setTopSurfaceGeometry] = useState<THREE.BufferGeometry | null>(null);
	const lastSigRef = useRef('');
	const lastRebuildRef = useRef(0);
	const fillRef = useRef<THREE.BufferGeometry | null>(null);
	const topSurfaceRef = useRef<THREE.BufferGeometry | null>(null);

	useEffect(() => {
		return () => {
			fillRef.current?.dispose();
			fillRef.current = null;
			topSurfaceRef.current?.dispose();
			topSurfaceRef.current = null;
		};
	}, []);

	useFrame(() => {
		if (!enabled) return;
		const mesh = meshRef.current;
		if (!mesh) return;

		const posAttr = geometry.getAttribute('position');
		if (!(posAttr instanceof THREE.BufferAttribute)) return;

		mesh.updateWorldMatrix(true, false);
		const mw = mesh.matrixWorld;

		const sig = [
			geometry.uuid,
			posAttr.version,
			Array.from(mw.elements).map((n) => n.toFixed(5)).join(','),
			sideView,
			style?.fillColor ?? '',
			style?.topSurfaceColor ?? '',
			style?.topSurfaceDepthWorld?.toFixed(4) ?? '',
			style?.showTopLine === false ? 'hideTop' : 'showTop',
		].join('|');

		if (sig === lastSigRef.current) return;

		const now = performance.now();
		if (now - lastRebuildRef.current < MIN_REBUILD_MS) return;

		lastSigRef.current = sig;
		lastRebuildRef.current = now;

		const built = buildSideInspectionProfile(geometry, mw, SIDE_PROFILE_AXES[sideView]);
		if (!built) {
			setTop([]);
			setBottom([]);
			fillRef.current?.dispose();
			fillRef.current = null;
			topSurfaceRef.current?.dispose();
			topSurfaceRef.current = null;
			setFillGeometry(null);
			setTopSurfaceGeometry(null);
			return;
		}

		fillRef.current?.dispose();
		fillRef.current = style?.fillColor
			? buildProfileFillGeometry(built.top, built.bottom)
			: null;
		topSurfaceRef.current?.dispose();
		topSurfaceRef.current = style?.topSurfaceColor
			? buildTopSurfaceLayerGeometry(
					built.top,
					SIDE_PROFILE_AXES[sideView].up,
					style.topSurfaceDepthWorld ?? 0.45,
				)
			: null;
		setTop(built.top);
		setBottom(built.bottom);
		setFillGeometry(fillRef.current);
		setTopSurfaceGeometry(topSurfaceRef.current);
	});

	if (!enabled) return null;
	const renderOrder = style?.renderOrder ?? SIDE_PROFILE_RENDER_ORDER;
	const lineWidth = style?.lineWidth ?? 3;
	const showTopLine = style?.showTopLine ?? !style?.topSurfaceColor;

	return (
		<group>
			{topSurfaceGeometry && style?.topSurfaceColor ? (
				<mesh geometry={topSurfaceGeometry} renderOrder={renderOrder}>
					<meshBasicMaterial
						color={style.topSurfaceColor}
						transparent
						opacity={style.topSurfaceOpacity ?? 0.96}
						depthTest={false}
						depthWrite={false}
						side={THREE.DoubleSide}
						toneMapped={false}
					/>
				</mesh>
			) : null}
			{fillGeometry && style?.fillColor ? (
				<mesh geometry={fillGeometry} renderOrder={renderOrder}>
					<meshBasicMaterial
						color={style.fillColor}
						transparent
						opacity={style.fillOpacity ?? 0.7}
						depthTest={false}
						depthWrite={false}
						side={THREE.DoubleSide}
						toneMapped={false}
					/>
				</mesh>
			) : null}
			{bottom.length > 1 ? (
				<Line
					points={bottom}
					color={style?.bottomColor ?? '#020617'}
					lineWidth={style?.lineWidth ?? 2.6}
					renderOrder={renderOrder + 10}
					depthTest={false}
					toneMapped={false}
				/>
			) : null}
			{showTopLine && top.length > 1 ? (
				<Line
					points={top}
					color={style?.topColor ?? '#56f2d6'}
					lineWidth={lineWidth}
					renderOrder={renderOrder + 2}
					depthTest={false}
					toneMapped={false}
				/>
			) : null}
		</group>
	);
}

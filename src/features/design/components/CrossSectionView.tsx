'use client';

import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { computeMeshPlaneSection } from '@/src/features/design/utils/meshPlaneSection';
import { buildSideInspectionProfile } from '@/src/features/design/utils/sideInspectionProfile';

export type CrossSectionFeature = {
	key: string;
	geometry: THREE.BufferGeometry;
	color: string;
	opacity?: number;
};

export type CrossSectionViewProps = {
	geometry: THREE.BufferGeometry;
	meshRef: RefObject<THREE.Object3D | null>;
	enabled: boolean;
	sideView: 'left' | 'right';
	/** Updated in place each rebuild so live meshes can clip against it. */
	clipPlane?: THREE.Plane;
	features?: CrossSectionFeature[];
	baseFillColor?: string;
	baseFillOpacity?: number;
	outlineColor?: string;
	outlineWidth?: number;
	showBaseline?: boolean;
	baselineColor?: string;
};

const MIN_REBUILD_MS = 120;
const BASE_RENDER_ORDER = 30;
const SECTION_NORMALS = {
	left: new THREE.Vector3(1, 0, 0),
	right: new THREE.Vector3(-1, 0, 0),
} as const;
const ENVELOPE_AXES = {
	left: { up: new THREE.Vector3(0, 1, 0), lateral: new THREE.Vector3(0, 0, -1) },
	right: { up: new THREE.Vector3(0, 1, 0), lateral: new THREE.Vector3(0, 0, 1) },
} as const;

/**
 * Lateral projection (min/max envelope collapsed along the viewing axis) as a
 * filled quad-strip slab. Unlike a single-plane section this always captures a
 * feature's full vertical depth regardless of its medial/lateral position, so
 * off-centre elements and insets stay visible in the side profile.
 */
function buildLateralProjection(
	geometry: THREE.BufferGeometry,
	worldMatrix: THREE.Matrix4,
	sideView: 'left' | 'right',
): { cap: THREE.BufferGeometry | null; loops: THREE.Vector3[][] } {
	const built = buildSideInspectionProfile(geometry, worldMatrix, ENVELOPE_AXES[sideView]);
	if (!built) return { cap: null, loops: [] };
	const count = Math.min(built.top.length, built.bottom.length);
	if (count < 2) return { cap: null, loops: [] };

	const verts: number[] = [];
	for (let i = 0; i < count - 1; i++) {
		const b0 = built.bottom[i]!;
		const t0 = built.top[i]!;
		const b1 = built.bottom[i + 1]!;
		const t1 = built.top[i + 1]!;
		verts.push(b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, t1.x, t1.y, t1.z);
		verts.push(b0.x, b0.y, b0.z, t1.x, t1.y, t1.z, t0.x, t0.y, t0.z);
	}
	const cap = new THREE.BufferGeometry();
	cap.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
	const loop = [...built.top, ...[...built.bottom].reverse()];
	return { cap, loops: [loop] };
}

type FeatureSection = {
	key: string;
	color: string;
	opacity: number;
	cap: THREE.BufferGeometry | null;
	loops: THREE.Vector3[][];
};

type SectionState = {
	baseCap: THREE.BufferGeometry | null;
	baseLoops: THREE.Vector3[][];
	baseline: [THREE.Vector3, THREE.Vector3] | null;
	features: FeatureSection[];
};

const EMPTY_STATE: SectionState = { baseCap: null, baseLoops: [], baseline: null, features: [] };

function deriveBaseline(loops: THREE.Vector3[][]): [THREE.Vector3, THREE.Vector3] | null {
	let minY = Infinity;
	let zMin = Infinity;
	let zMax = -Infinity;
	let planeX = 0;
	let found = false;
	for (const loop of loops) {
		for (const p of loop) {
			found = true;
			planeX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.z < zMin) zMin = p.z;
			if (p.z > zMax) zMax = p.z;
		}
	}
	if (!found || !Number.isFinite(minY)) return null;
	return [new THREE.Vector3(planeX, minY, zMin), new THREE.Vector3(planeX, minY, zMax)];
}

function disposeState(state: SectionState): void {
	state.baseCap?.dispose();
	for (const f of state.features) f.cap?.dispose();
}

/**
 * True planar cross-section of the insole at its sagittal centerline. The base
 * material renders as a transparent zooldikte slab; placed elements and the
 * extracted bottom-text engraving render as opaque masses so their vertical
 * depth inside the slab is readable.
 */
export function CrossSectionView({
	geometry,
	meshRef,
	enabled,
	sideView,
	clipPlane,
	features = [],
	baseFillColor = '#1e293b',
	baseFillOpacity = 0.18,
	outlineColor = '#f8fafc',
	outlineWidth = 2,
	showBaseline = true,
	baselineColor = '#475569',
}: CrossSectionViewProps) {
	const [state, setState] = useState<SectionState>(EMPTY_STATE);
	const stateRef = useRef<SectionState>(EMPTY_STATE);
	const lastSigRef = useRef('');
	const lastRebuildRef = useRef(0);
	const invalidate = useThree((s) => s.invalidate);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	useEffect(() => {
		return () => {
			disposeState(stateRef.current);
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

		const featureSig = features
			.map((f) => {
				const attr = f.geometry.getAttribute('position');
				const version = attr instanceof THREE.BufferAttribute ? attr.version : 0;
				return `${f.key}:${f.geometry.uuid}:${version}`;
			})
			.join(';');
		const sig = [
			geometry.uuid,
			posAttr.version,
			Array.from(mw.elements).map((n) => n.toFixed(4)).join(','),
			sideView,
			featureSig,
		].join('|');

		if (sig === lastSigRef.current) return;
		const now = performance.now();
		if (now - lastRebuildRef.current < MIN_REBUILD_MS) return;
		lastSigRef.current = sig;
		lastRebuildRef.current = now;

		const center = new THREE.Vector3();
		geometry.computeBoundingBox();
		const bbox = geometry.boundingBox;
		if (!bbox) return;
		bbox.getCenter(center).applyMatrix4(mw);

		const normal = SECTION_NORMALS[sideView].clone();
		if (clipPlane) clipPlane.setFromNormalAndCoplanarPoint(normal, center);

		let baseSection = computeMeshPlaneSection(geometry, mw, { origin: center, normal });
		if (baseSection.loops.length === 0) {
			baseSection = buildLateralProjection(geometry, mw, sideView);
		}
		// Features use a lateral projection (not a single-plane slice) so their
		// depth reads in the profile even when placed off the centreline.
		const featureSections: FeatureSection[] = features.map((f) => {
			const proj = buildLateralProjection(f.geometry, mw, sideView);
			return {
				key: f.key,
				color: f.color,
				opacity: f.opacity ?? 0.92,
				cap: proj.cap,
				loops: proj.loops,
			};
		});

		disposeState(stateRef.current);
		const next: SectionState = {
			baseCap: baseSection.cap,
			baseLoops: baseSection.loops,
			baseline: showBaseline ? deriveBaseline(baseSection.loops) : null,
			features: featureSections,
		};
		stateRef.current = next;
		setState(next);
		invalidate();
	});

	if (!enabled) return null;

	return (
		<group>
			{state.baseCap ? (
				<mesh geometry={state.baseCap} renderOrder={BASE_RENDER_ORDER}>
					<meshBasicMaterial
						color={baseFillColor}
						transparent
						opacity={baseFillOpacity}
						depthTest={false}
						depthWrite={false}
						side={THREE.DoubleSide}
						toneMapped={false}
					/>
				</mesh>
			) : null}

			{state.features.map((f, fi) =>
				f.cap ? (
					<mesh key={`cap-${f.key}`} geometry={f.cap} renderOrder={BASE_RENDER_ORDER + 2 + fi}>
						<meshBasicMaterial
							color={f.color}
							transparent
							opacity={f.opacity}
							depthTest={false}
							depthWrite={false}
							side={THREE.DoubleSide}
							toneMapped={false}
						/>
					</mesh>
				) : null,
			)}

			{state.features.map((f) =>
				f.loops.map((loop, li) =>
					loop.length > 1 ? (
						<Line
							key={`fline-${f.key}-${li}`}
							points={[...loop, loop[0]!]}
							color={f.color}
							lineWidth={Math.max(1, outlineWidth - 0.6)}
							renderOrder={BASE_RENDER_ORDER + 20}
							depthTest={false}
							toneMapped={false}
						/>
					) : null,
				),
			)}

			{state.baseLoops.map((loop, li) =>
				loop.length > 1 ? (
					<Line
						key={`bline-${li}`}
						points={[...loop, loop[0]!]}
						color={outlineColor}
						lineWidth={outlineWidth}
						renderOrder={BASE_RENDER_ORDER + 24}
						depthTest={false}
						toneMapped={false}
					/>
				) : null,
			)}

			{state.baseline ? (
				<Line
					points={state.baseline}
					color={baselineColor}
					lineWidth={Math.max(1, outlineWidth - 0.8)}
					renderOrder={BASE_RENDER_ORDER + 22}
					depthTest={false}
					toneMapped={false}
				/>
			) : null}
		</group>
	);
}

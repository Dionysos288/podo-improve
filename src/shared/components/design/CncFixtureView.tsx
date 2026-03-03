'use client';

import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { cn } from '@/src/shared/lib/cn';
import type { FixtureLayout, SlotAssignment } from '@/src/features/milling/types';
import { SLOT_COORDINATE_SYSTEMS } from '@/src/features/milling/types';

// ──────────────────────────────────────────────
// 3D CNC Fixture View — EVA blocks with real STL insoles
// Layout (viewed from above, numbered bottom→top, left→right):
//   Top row:    [7] [8]         ← 2 horizontal blocks, centered
//   Middle row: [4] [5] [6]     ← 3 vertical blocks
//   Bottom row: [1] [2] [3]     ← 3 vertical blocks
// ──────────────────────────────────────────────

// ── Block dimensions (scene units ≈ mm) ──
const BLOCK_W = 130; // vertical block width
const BLOCK_H = 280; // vertical block height (depth in Z)
const BLOCK_DEPTH = 30; // EVA block thickness (Y axis)
const GAP = 24;

// Horizontal block: rotated 90° → width becomes height and vice versa
const HBLOCK_W = BLOCK_H; // 280
const HBLOCK_H = BLOCK_W; // 130

// Row widths
const VERT_ROW_W = 3 * BLOCK_W + 2 * GAP; // 438
const HORZ_ROW_W = 2 * HBLOCK_W + GAP; // 584
const GRID_W = Math.max(VERT_ROW_W, HORZ_ROW_W); // 584

// Total height: 2 vertical rows + 1 horizontal row + 2 gaps
const TOTAL_H = 2 * BLOCK_H + HBLOCK_H + 2 * GAP; // 690 + 24*2 = 738... 2*280+130+2*24 = 738

// Slot position + dimensions descriptor
interface SlotDesc {
	x: number; // center X
	z: number; // center Z
	w: number; // width (X)
	h: number; // depth (Z)
	horizontal: boolean;
}

const SLOT_DESCS: SlotDesc[] = (() => {
	const cx = GRID_W / 2;
	const cz = TOTAL_H / 2;

	// Vertical rows offset to center within the wider grid
	const vertOff = (GRID_W - VERT_ROW_W) / 2;
	// Horizontal row offset
	const horzOff = (GRID_W - HORZ_ROW_W) / 2;

	const raw: SlotDesc[] = [
		// Slots 0,1,2 (labeled 1,2,3) — BOTTOM row, 3 vertical blocks
		{ x: vertOff + BLOCK_W / 2, z: TOTAL_H - BLOCK_H / 2, w: BLOCK_W, h: BLOCK_H, horizontal: false },
		{ x: vertOff + BLOCK_W + GAP + BLOCK_W / 2, z: TOTAL_H - BLOCK_H / 2, w: BLOCK_W, h: BLOCK_H, horizontal: false },
		{ x: vertOff + 2 * (BLOCK_W + GAP) + BLOCK_W / 2, z: TOTAL_H - BLOCK_H / 2, w: BLOCK_W, h: BLOCK_H, horizontal: false },

		// Slots 3,4,5 (labeled 4,5,6) — MIDDLE row, 3 vertical blocks
		{ x: vertOff + BLOCK_W / 2, z: TOTAL_H - BLOCK_H - GAP - BLOCK_H / 2, w: BLOCK_W, h: BLOCK_H, horizontal: false },
		{ x: vertOff + BLOCK_W + GAP + BLOCK_W / 2, z: TOTAL_H - BLOCK_H - GAP - BLOCK_H / 2, w: BLOCK_W, h: BLOCK_H, horizontal: false },
		{ x: vertOff + 2 * (BLOCK_W + GAP) + BLOCK_W / 2, z: TOTAL_H - BLOCK_H - GAP - BLOCK_H / 2, w: BLOCK_W, h: BLOCK_H, horizontal: false },

		// Slots 6,7 (labeled 7,8) — TOP row, 2 horizontal blocks, centered
		{ x: horzOff + HBLOCK_W / 2, z: HBLOCK_H / 2, w: HBLOCK_W, h: HBLOCK_H, horizontal: true },
		{ x: horzOff + HBLOCK_W + GAP + HBLOCK_W / 2, z: HBLOCK_H / 2, w: HBLOCK_W, h: HBLOCK_H, horizontal: true },
	];

	// Center everything around the origin
	return raw.map((s) => ({
		...s,
		x: s.x - cx,
		z: s.z - cz,
	}));
})();

// ── Material constants ──
const BLOCK_COLOR_EMPTY = '#2a3048';
const BLOCK_COLOR_FILLED = '#3d5078';
const BLOCK_EDGE_COLOR = '#5a7aaa';
const INSOLE_COLOR = '#d4dff0';
const DIVIDER_COLOR = '#ffffff';
const OFFSET_LINE_COLOR = '#88bbff'; // safety margin offset line
const SAFETY_MARGIN = 5; // mm safety margin around insole area

// ── Props ──
interface CncFixtureViewProps {
	fixture: FixtureLayout;
	className?: string;
	leftStlUrl?: string;
	rightStlUrl?: string;
}

function getSlotParts(fixture: FixtureLayout, slotIndex: number): SlotAssignment[] {
	return fixture.assignments.filter((a) => a.slotIndex === slotIndex);
}

// ────────────────────────────────────────
// InsoleSTL — loads an STL, auto-orients, and scales to fit a block half
// ────────────────────────────────────────
function InsoleSTL({
	url,
	side,
	blockW,
	blockH,
	horizontal,
}: {
	url: string;
	side: 'left' | 'right';
	blockW: number;
	blockH: number;
	horizontal: boolean;
}) {
	const rawGeometry = useLoader(STLLoader, url);

	const geometry = useMemo(() => {
		const g = rawGeometry.clone();
		g.computeBoundingBox();
		const bb = g.boundingBox;
		const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
		if (!bb || !pos) return g;

		const size = bb.getSize(new THREE.Vector3());
		const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
		const sizes = { x: size.x, y: size.y, z: size.z };
		axes.sort((a, b) => sizes[a] - sizes[b]);

		const heightAxis = axes[0]; // thinnest = thickness
		const widthAxis = axes[1];
		const lengthAxis = axes[2]; // longest = toe-heel

		const getVal = (i: number, axis: 'x' | 'y' | 'z') =>
			axis === 'x' ? pos.getX(i) : axis === 'y' ? pos.getY(i) : pos.getZ(i);

		const minLen = lengthAxis === 'x' ? bb.min.x : lengthAxis === 'y' ? bb.min.y : bb.min.z;
		const maxLen = lengthAxis === 'x' ? bb.max.x : lengthAxis === 'y' ? bb.max.y : bb.max.z;
		const lenSpan = maxLen - minLen;

		const centerW = (
			widthAxis === 'x' ? bb.min.x + size.x / 2 :
			widthAxis === 'y' ? bb.min.y + size.y / 2 :
			bb.min.z + size.z / 2
		);
		const minH = heightAxis === 'x' ? bb.min.x : heightAxis === 'y' ? bb.min.y : bb.min.z;

		// Detect heel end (wider end)
		const slice = lenSpan * 0.1;
		let minEndW = 0, maxEndW = 0, minC = 0, maxC = 0;
		for (let i = 0; i < pos.count; i++) {
			const lv = getVal(i, lengthAxis);
			const wv = getVal(i, widthAxis);
			if (lv <= minLen + slice) { minEndW += Math.abs(wv - centerW); minC++; }
			if (lv >= maxLen - slice) { maxEndW += Math.abs(wv - centerW); maxC++; }
		}
		const heelAtMin = minC > 0 && maxC > 0 ? (minEndW / minC) >= (maxEndW / maxC) : true;

		// For vertical blocks: insole half = blockW/2, length = blockH
		// For horizontal blocks: insole laid sideways → half = blockH/2, length = blockW
		const halfSpace = horizontal ? (blockH / 2 - 6) : (blockW / 2 - 6);
		const lenSpace = horizontal ? (blockW - 16) : (blockH - 16);

		const rawWidth = widthAxis === 'x' ? size.x : widthAxis === 'y' ? size.y : size.z;
		const fitScale = Math.min(halfSpace / rawWidth, lenSpace / lenSpan);

		// Remap vertices into canonical form:
		// For vertical blocks: X=width, Y=up, Z=length (heel at +Z)
		// For horizontal blocks: X=length (heel at +X), Y=up, Z=width
		const newPos = new Float32Array(pos.count * 3);
		for (let i = 0; i < pos.count; i++) {
			const lv = getVal(i, lengthAxis);
			const wv = getVal(i, widthAxis);
			const hv = getVal(i, heightAxis);

			const canonLen = heelAtMin ? (lv - minLen) : (maxLen - lv);
			const canonW = wv - centerW;
			const canonH = hv - minH;

			if (horizontal) {
				// Length along X, width along Z
				newPos[i * 3 + 0] = (canonLen - lenSpan / 2) * fitScale;
				newPos[i * 3 + 1] = canonH * fitScale;
				newPos[i * 3 + 2] = canonW * fitScale;
			} else {
				// Width along X, length along Z
				newPos[i * 3 + 0] = canonW * fitScale;
				newPos[i * 3 + 1] = canonH * fitScale;
				newPos[i * 3 + 2] = (canonLen - lenSpan / 2) * fitScale;
			}
		}

		const newGeom = new THREE.BufferGeometry();
		newGeom.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
		if (g.index) newGeom.setIndex(g.index.clone());
		newGeom.computeVertexNormals();
		newGeom.computeBoundingBox();

		return newGeom;
	}, [rawGeometry, blockW, blockH, horizontal]);

	// Position: shift to left or right half of the block
	let xOff: number;
	let zOff: number;
	if (horizontal) {
		// Horizontal block: L/R split along Z axis
		xOff = 0;
		zOff = side === 'left' ? -blockH / 4 : blockH / 4;
	} else {
		// Vertical block: L/R split along X axis
		xOff = side === 'left' ? -blockW / 4 : blockW / 4;
		zOff = 0;
	}

	return (
		<mesh
			geometry={geometry}
			position={[xOff, 2, zOff]}
			renderOrder={1}
		>
			<meshStandardMaterial
				color={INSOLE_COLOR}
				roughness={0.3}
				metalness={0.02}
				side={THREE.DoubleSide}
			/>
		</mesh>
	);
}

// ────────────────────────────────────────
// EVA Block — single 3D block with optional insoles
// ────────────────────────────────────────
function EvaBlock({
	position,
	slotIndex,
	slotDesc,
	parts,
	leftStlUrl,
	rightStlUrl,
}: {
	position: [number, number, number];
	slotIndex: number;
	slotDesc: SlotDesc;
	parts: SlotAssignment[];
	leftStlUrl?: string;
	rightStlUrl?: string;
}) {
	const { w, h, horizontal } = slotDesc;
	const isEmpty = parts.length === 0;
	const hasLeft = parts.some((p) => p.partId === 'left');
	const hasRight = parts.some((p) => p.partId === 'right');

	const edgesRef = useRef<THREE.LineSegments>(null);

	const blockGeom = useMemo(() => new THREE.BoxGeometry(w, BLOCK_DEPTH, h), [w, h]);
	const edgeGeom = useMemo(() => new THREE.EdgesGeometry(blockGeom), [blockGeom]);

	// Center divider line — splits L/R
	// Vertical blocks: divider along Z (top to bottom)
	// Horizontal blocks: divider along X (left to right)
	const dividerPoints = useMemo(() => {
		if (horizontal) {
			return [
				new THREE.Vector3(-w / 2 + 8, BLOCK_DEPTH / 2 + 0.2, 0),
				new THREE.Vector3(w / 2 - 8, BLOCK_DEPTH / 2 + 0.2, 0),
			];
		}
		return [
			new THREE.Vector3(0, BLOCK_DEPTH / 2 + 0.2, -h / 2 + 8),
			new THREE.Vector3(0, BLOCK_DEPTH / 2 + 0.2, h / 2 - 8),
		];
	}, [w, h, horizontal]);

	const dividerLine = useMemo(() => {
		const geom = new THREE.BufferGeometry().setFromPoints(dividerPoints);
		const mat = new THREE.LineDashedMaterial({
			color: DIVIDER_COLOR,
			dashSize: 6,
			gapSize: 4,
			transparent: true,
			opacity: 0.35,
		});
		const line = new THREE.Line(geom, mat);
		line.computeLineDistances();
		return line;
	}, [dividerPoints]);

	useMemo(() => {
		const mat = dividerLine.material as THREE.LineDashedMaterial;
		mat.opacity = isEmpty ? 0.08 : 0.35;
	}, [dividerLine, isEmpty]);

	// Label positions depend on orientation
	const numPos: [number, number, number] = horizontal
		? [-w / 2 + 12, BLOCK_DEPTH / 2 + 0.5, -h / 2 + 10]
		: [-w / 2 + 10, BLOCK_DEPTH / 2 + 0.5, -h / 2 + 14];
	const coordPos: [number, number, number] = horizontal
		? [w / 2 - 12, BLOCK_DEPTH / 2 + 0.5, -h / 2 + 10]
		: [w / 2 - 10, BLOCK_DEPTH / 2 + 0.5, -h / 2 + 14];

	// L/R label positions
	let lPos: [number, number, number];
	let rPos: [number, number, number];
	if (horizontal) {
		lPos = [0, BLOCK_DEPTH / 2 + 0.5, -h / 4];
		rPos = [0, BLOCK_DEPTH / 2 + 0.5, h / 4];
	} else {
		lPos = [-w / 4, BLOCK_DEPTH / 2 + 0.5, h / 2 - 12];
		rPos = [w / 4, BLOCK_DEPTH / 2 + 0.5, h / 2 - 12];
	}

	// Safety offset margin lines — dashed rectangle inset from block edge
	const offsetLines = useMemo(() => {
		const m = SAFETY_MARGIN;
		const hw = w / 2 - m;
		const hh = h / 2 - m;
		const y = BLOCK_DEPTH / 2 + 0.3;
		const pts = [
			new THREE.Vector3(-hw, y, -hh),
			new THREE.Vector3(hw, y, -hh),
			new THREE.Vector3(hw, y, hh),
			new THREE.Vector3(-hw, y, hh),
			new THREE.Vector3(-hw, y, -hh), // close the loop
		];
		const geom = new THREE.BufferGeometry().setFromPoints(pts);
		const mat = new THREE.LineDashedMaterial({
			color: OFFSET_LINE_COLOR,
			dashSize: 5,
			gapSize: 3,
			transparent: true,
			opacity: 0.4,
		});
		const line = new THREE.Line(geom, mat);
		line.computeLineDistances();
		return line;
	}, [w, h]);

	return (
		<group position={position}>
			{/* Block body — transparent so insoles inside are visible */}
			<mesh geometry={blockGeom} renderOrder={2}>
				<meshStandardMaterial
					color={isEmpty ? BLOCK_COLOR_EMPTY : BLOCK_COLOR_FILLED}
					roughness={0.7}
					metalness={0.05}
					transparent
					opacity={isEmpty ? 0.25 : 0.55}
					depthWrite={false}
				/>
			</mesh>

			{/* Block edges */}
			<lineSegments geometry={edgeGeom} ref={edgesRef}>
				<lineBasicMaterial
					color={isEmpty ? '#3a4a60' : BLOCK_EDGE_COLOR}
					transparent
					opacity={isEmpty ? 0.2 : 0.4}
				/>
			</lineSegments>

			{/* Center divider line */}
			<primitive object={dividerLine} />

			{/* Safety offset margin */}
			{!isEmpty && <primitive object={offsetLines} />}

			{/* Slot number label */}
			<Text
				position={numPos}
				fontSize={14}
				color={isEmpty ? '#ffffff' : '#ffffff'}
				fillOpacity={isEmpty ? 0.1 : 0.35}
				anchorX="left"
				anchorY="middle"
				rotation={[-Math.PI / 2, 0, 0]}
				font={undefined}
			>
				{String(slotIndex + 1)}
			</Text>

			{/* Coordinate system label */}
			<Text
				position={coordPos}
				fontSize={10}
				color="#ffffff"
				fillOpacity={0.15}
				anchorX="right"
				anchorY="middle"
				rotation={[-Math.PI / 2, 0, 0]}
				font={undefined}
			>
				{SLOT_COORDINATE_SYSTEMS[slotIndex]}
			</Text>

			{/* L / R labels */}
			{hasLeft && (
				<Text
					position={lPos}
					fontSize={11}
					color="#63f7d6"
					fillOpacity={0.5}
					anchorX="center"
					anchorY="middle"
					rotation={[-Math.PI / 2, 0, 0]}
					font={undefined}
				>
					L
				</Text>
			)}
			{hasRight && (
				<Text
					position={rPos}
					fontSize={11}
					color="#63f7d6"
					fillOpacity={0.5}
					anchorX="center"
					anchorY="middle"
					rotation={[-Math.PI / 2, 0, 0]}
					font={undefined}
				>
					R
				</Text>
			)}

			{/* STL Insoles */}
			{hasLeft && leftStlUrl && (
				<Suspense fallback={null}>
					<InsoleSTL url={leftStlUrl} side="left" blockW={w} blockH={h} horizontal={horizontal} />
				</Suspense>
			)}
			{hasRight && rightStlUrl && (
				<Suspense fallback={null}>
					<InsoleSTL url={rightStlUrl} side="right" blockW={w} blockH={h} horizontal={horizontal} />
				</Suspense>
			)}
		</group>
	);
}

// ────────────────────────────────────────
// Orthographic camera that auto-fits the grid
// ────────────────────────────────────────
function OrthoSetup() {
	const { camera, size } = useThree();
	useMemo(() => {
		const cam = camera as THREE.OrthographicCamera;
		const aspect = size.width / size.height;
		// Add padding so the grid never gets clipped
		const halfH = (TOTAL_H / 2) * 1.15;
		const halfW = halfH * aspect;
		cam.left = -halfW;
		cam.right = halfW;
		cam.top = halfH;
		cam.bottom = -halfH;
		cam.near = 1;
		cam.far = 2000;
		cam.position.set(0, 800, 0);
		cam.lookAt(0, 0, 0);
		cam.updateProjectionMatrix();
	}, [camera, size]);
	return null;
}

// ────────────────────────────────────────
// Main export
// ────────────────────────────────────────
export function CncFixtureView({
	fixture,
	className,
	leftStlUrl,
	rightStlUrl,
}: CncFixtureViewProps) {
	return (
		<div className={cn('w-full h-full bg-gray-900', className)}>
			<Canvas
				orthographic
				gl={{ antialias: true, alpha: false }}
				dpr={[1, 2]}
				camera={{ position: [0, 800, 0], zoom: 1, near: 1, far: 2000 }}
			>
				<OrthoSetup />
				<color attach="background" args={['#111827']} />

				{/* Lighting — optimized for top-down view */}
				<ambientLight intensity={0.6} />
				<directionalLight position={[0, 800, 0]} intensity={1.0} />
				<directionalLight position={[200, 600, 200]} intensity={0.4} />
				<directionalLight position={[-200, 600, -200]} intensity={0.3} />

				{/* Orbit controls — top-down, zoom only, allow slight tilt */}
				<OrbitControls
					target={[0, 0, 0]}
					maxPolarAngle={Math.PI * 0.35}
					minPolarAngle={0}
					enableDamping
					dampingFactor={0.05}
					minZoom={0.3}
					maxZoom={4}
				/>

				{/* EVA Blocks */}
				<Suspense fallback={null}>
					{SLOT_DESCS.map((desc, i) => {
						const parts = getSlotParts(fixture, i);
						return (
							<EvaBlock
								key={i}
								position={[desc.x, 0, desc.z]}
								slotIndex={i}
								slotDesc={desc}
								parts={parts}
								leftStlUrl={leftStlUrl}
								rightStlUrl={rightStlUrl}
							/>
						);
					})}
				</Suspense>
			</Canvas>
		</div>
	);
}

'use client';

import { useRef, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import { cn } from '@/src/shared/lib/cn';
import {
	SLOT_COUNT,
	SLOT_COORDINATE_SYSTEMS,
	DEFAULT_SLOT_OFFSETS,
	type FixtureLayout,
	type SlotAssignment,
} from '@/src/features/milling/types';

// ──────────────────────────────────────────────
// CNC Machine 3D Viewer — Mekanika CNC Pro Mk2
// Shows realistic 3D machine with bed, gantry, spindle,
// EVA blocks, insole contours, and toolpath lines.
// ──────────────────────────────────────────────

// Machine dimensions (mm) — Mekanika CNC Pro Mk2
const BED_X = 1030;
const BED_Y = 1030;
const BED_THICKNESS = 18; // MDF spoilboard
const FRAME_HEIGHT = 160; // aluminum extrusion frame height
const FRAME_WIDTH = 80; // extrusion profile width
const GANTRY_HEIGHT = 200; // gantry bridge height above bed
const GANTRY_BEAM_SIZE = 80; // gantry beam cross section
const Z_TRAVEL = 130; // Z axis travel
const SPINDLE_DIAMETER = 43; // ER20 spindle (VFD 2.2kW)
const SPINDLE_LENGTH = 200;

// EVA block dimensions
const BLOCK_W = 130;
const BLOCK_H = 300;
const BLOCK_THICKNESS = 32; // default EVA block thickness

// Insole contour for visualization (simplified, same as in generateNc)
const INSOLE_CONTOUR_LEFT: [number, number][] = [
	[45, 0], [55, 5], [65, 15], [72, 30], [78, 50],
	[82, 70], [84, 90], [85, 110], [84, 130], [82, 150],
	[78, 170], [72, 190], [64, 210], [56, 230], [48, 248],
	[42, 260], [35, 270], [28, 275], [20, 278], [14, 275],
	[10, 268], [8, 255], [7, 240], [8, 220], [10, 200],
	[14, 180], [18, 160], [22, 140], [26, 120], [28, 100],
	[30, 80], [32, 60], [35, 40], [38, 20], [42, 5], [45, 0],
];

const INSOLE_CONTOUR_RIGHT: [number, number][] = INSOLE_CONTOUR_LEFT.map(
	([x, y]) => [100 - x, y] as [number, number]
);

// ── Props ──
interface CncMachine3DViewProps {
	fixture: FixtureLayout;
	className?: string;
	showToolpath?: boolean;
}

// ── Helper: get slot parts ──
function getSlotParts(fixture: FixtureLayout, slotIndex: number): SlotAssignment[] {
	return fixture.assignments.filter((a) => a.slotIndex === slotIndex);
}

// ══════════════════════════════════════════════
// Sub-components (inside Canvas)
// ══════════════════════════════════════════════

/** Spoilboard / MDF bed */
function Bed() {
	return (
		<mesh position={[BED_X / 2, -BED_THICKNESS / 2, BED_Y / 2]} receiveShadow>
			<boxGeometry args={[BED_X, BED_THICKNESS, BED_Y]} />
			<meshStandardMaterial color="#3a3528" roughness={0.9} />
		</mesh>
	);
}

/** Aluminum frame rails around the bed */
function Frame() {
	const railColor = '#6b6e72';
	const rails = useMemo(() => {
		const r: { pos: [number, number, number]; size: [number, number, number] }[] = [];
		// Front rail (Y=0)
		r.push({ pos: [BED_X / 2, FRAME_HEIGHT / 2, -FRAME_WIDTH / 2], size: [BED_X + FRAME_WIDTH * 2, FRAME_HEIGHT, FRAME_WIDTH] });
		// Back rail (Y=BED_Y)
		r.push({ pos: [BED_X / 2, FRAME_HEIGHT / 2, BED_Y + FRAME_WIDTH / 2], size: [BED_X + FRAME_WIDTH * 2, FRAME_HEIGHT, FRAME_WIDTH] });
		// Left rail (X=0)
		r.push({ pos: [-FRAME_WIDTH / 2, FRAME_HEIGHT / 2, BED_Y / 2], size: [FRAME_WIDTH, FRAME_HEIGHT, BED_Y] });
		// Right rail (X=BED_X)
		r.push({ pos: [BED_X + FRAME_WIDTH / 2, FRAME_HEIGHT / 2, BED_Y / 2], size: [FRAME_WIDTH, FRAME_HEIGHT, BED_Y] });
		return r;
	}, []);

	return (
		<group>
			{rails.map((rail, i) => (
				<mesh key={i} position={rail.pos}>
					<boxGeometry args={rail.size} />
					<meshStandardMaterial color={railColor} roughness={0.4} metalness={0.6} />
				</mesh>
			))}
		</group>
	);
}

/** T-slot grooves on the spoilboard */
function TSlots() {
	const slotCount = 6;
	const spacing = BED_Y / (slotCount + 1);

	return (
		<group>
			{Array.from({ length: slotCount }, (_, i) => {
				const z = spacing * (i + 1);
				return (
					<mesh key={i} position={[BED_X / 2, 0.5, z]}>
						<boxGeometry args={[BED_X - 20, 3, 8]} />
						<meshStandardMaterial color="#2a2520" roughness={1} />
					</mesh>
				);
			})}
		</group>
	);
}

/** Gantry bridge (moves along Y axis) */
function Gantry({ yPosition }: { yPosition: number }) {
	const gantryY = FRAME_HEIGHT + GANTRY_HEIGHT / 2;

	return (
		<group position={[0, 0, yPosition]}>
			{/* Gantry beam (horizontal, along X) */}
			<mesh position={[BED_X / 2, gantryY, 0]}>
				<boxGeometry args={[BED_X + FRAME_WIDTH * 2, GANTRY_BEAM_SIZE, GANTRY_BEAM_SIZE]} />
				<meshStandardMaterial color="#4a4e52" roughness={0.3} metalness={0.7} />
			</mesh>
			{/* Left gantry plate */}
			<mesh position={[-FRAME_WIDTH / 2, FRAME_HEIGHT + GANTRY_HEIGHT * 0.4, 0]}>
				<boxGeometry args={[FRAME_WIDTH + 20, GANTRY_HEIGHT * 0.8, FRAME_WIDTH]} />
				<meshStandardMaterial color="#5a5e62" roughness={0.4} metalness={0.5} />
			</mesh>
			{/* Right gantry plate */}
			<mesh position={[BED_X + FRAME_WIDTH / 2, FRAME_HEIGHT + GANTRY_HEIGHT * 0.4, 0]}>
				<boxGeometry args={[FRAME_WIDTH + 20, GANTRY_HEIGHT * 0.8, FRAME_WIDTH]} />
				<meshStandardMaterial color="#5a5e62" roughness={0.4} metalness={0.5} />
			</mesh>
		</group>
	);
}

/** Spindle + Z-axis carriage */
function SpindleUnit({ position }: { position: [number, number, number] }) {
	const [x, _y, z] = position;
	const carriageY = FRAME_HEIGHT + GANTRY_HEIGHT;

	return (
		<group position={[x, 0, z]}>
			{/* Z carriage plate */}
			<mesh position={[0, carriageY - 30, 0]}>
				<boxGeometry args={[60, 120, 60]} />
				<meshStandardMaterial color="#555" roughness={0.3} metalness={0.6} />
			</mesh>
			{/* Spindle body (cylinder) */}
			<mesh position={[0, carriageY - 130, 0]} rotation={[0, 0, 0]}>
				<cylinderGeometry args={[SPINDLE_DIAMETER / 2, SPINDLE_DIAMETER / 2, SPINDLE_LENGTH, 16]} />
				<meshStandardMaterial color="#333" roughness={0.2} metalness={0.8} />
			</mesh>
			{/* Tool (small cone at bottom) */}
			<mesh position={[0, carriageY - 130 - SPINDLE_LENGTH / 2 - 15, 0]}>
				<coneGeometry args={[3, 30, 8]} />
				<meshStandardMaterial color="#c0c0c0" roughness={0.1} metalness={0.9} />
			</mesh>
		</group>
	);
}

/** Single EVA block on the bed */
function EvaBlock({
	position,
	slotIndex,
	parts,
}: {
	position: [number, number, number];
	slotIndex: number;
	parts: SlotAssignment[];
}) {
	const hasLeft = parts.some((p) => p.partId === 'left');
	const hasRight = parts.some((p) => p.partId === 'right');
	const isEmpty = parts.length === 0;

	if (isEmpty) return null;

	const [x, y, z] = position;

	return (
		<group position={[x, y + BLOCK_THICKNESS / 2, z]}>
			{/* EVA block body */}
			<mesh castShadow>
				<boxGeometry args={[BLOCK_W, BLOCK_THICKNESS, BLOCK_H]} />
				<meshStandardMaterial
					color="#6588b5"
					roughness={0.7}
					transparent
					opacity={0.85}
				/>
			</mesh>

			{/* Insole contour lines on top surface */}
			{hasLeft && (
				<InsoleContourLine
					contour={INSOLE_CONTOUR_LEFT}
					offsetX={-BLOCK_W / 4}
					yOffset={BLOCK_THICKNESS / 2 + 0.5}
					scale={0.55}
				/>
			)}
			{hasRight && (
				<InsoleContourLine
					contour={INSOLE_CONTOUR_RIGHT}
					offsetX={BLOCK_W / 4}
					yOffset={BLOCK_THICKNESS / 2 + 0.5}
					scale={0.55}
				/>
			)}

			{/* Slot label */}
			<Text
				position={[0, BLOCK_THICKNESS / 2 + 1, -BLOCK_H / 2 + 15]}
				fontSize={12}
				color="#ffffff"
				anchorX="center"
				anchorY="middle"
				rotation={[-Math.PI / 2, 0, 0]}
			>
				{`${slotIndex + 1} (${SLOT_COORDINATE_SYSTEMS[slotIndex]})`}
			</Text>
		</group>
	);
}

/** Insole outline drawn on top of EVA block */
function InsoleContourLine({
	contour,
	offsetX,
	yOffset,
	scale,
}: {
	contour: [number, number][];
	offsetX: number;
	yOffset: number;
	scale: number;
}) {
	const points = useMemo(() => {
		return contour.map(
			([x, y]) =>
				new THREE.Vector3(
					(x - 50) * scale + offsetX,
					yOffset,
					(y - 140) * scale
				)
		);
	}, [contour, offsetX, yOffset, scale]);

	return (
		<Line
			points={points}
			color="#63f7d6"
			lineWidth={1.5}
			transparent
			opacity={0.7}
		/>
	);
}

/** Toolpath visualization (zigzag lines for roughing + contour for finishing) */
function ToolpathVisualization({ fixture }: { fixture: FixtureLayout }) {
	const toolpathLines = useMemo(() => {
		const allLines: { points: THREE.Vector3[]; color: string }[] = [];

		for (const assignment of fixture.assignments) {
			const offset = DEFAULT_SLOT_OFFSETS[assignment.slotIndex];
			if (!offset) continue;

			const contour = assignment.partId === 'left' ? INSOLE_CONTOUR_LEFT : INSOLE_CONTOUR_RIGHT;

			// Grid origin: center the block in the slot
			const gridW = 4;
			const cols = gridW;
			const rows = 2;
			const blockCenterX = offset.x + (assignment.slotIndex % cols) * 0 + BLOCK_W / 2;
			const blockCenterZ = offset.y + Math.floor(assignment.slotIndex / cols) * 0 + BLOCK_H / 2;

			// Center the slots properly
			const slotCol = assignment.slotIndex % 4;
			const slotRow = Math.floor(assignment.slotIndex / 4);
			const baseX = (BED_X - (4 * BLOCK_W + 3 * 40)) / 2 + slotCol * (BLOCK_W + 40);
			const baseZ = (BED_Y - (2 * BLOCK_H + 1 * 60)) / 2 + slotRow * (BLOCK_H + 60);

			// Finish contour pass
			const finishPoints: THREE.Vector3[] = contour.map(([cx, cy]) =>
				new THREE.Vector3(
					baseX + cx * (BLOCK_W / 100),
					BLOCK_THICKNESS + 2,
					baseZ + cy * (BLOCK_H / 280)
				)
			);
			allLines.push({ points: finishPoints, color: '#ff6644' });

			// A few roughing pass lines (simplified)
			for (let y = 20; y < 260; y += 30) {
				const xRange = getSimpleXRange(contour, y);
				if (!xRange) continue;
				const [xMin, xMax] = xRange;
				const roughPoints = [
					new THREE.Vector3(
						baseX + xMin * (BLOCK_W / 100),
						BLOCK_THICKNESS + 1,
						baseZ + y * (BLOCK_H / 280)
					),
					new THREE.Vector3(
						baseX + xMax * (BLOCK_W / 100),
						BLOCK_THICKNESS + 1,
						baseZ + y * (BLOCK_H / 280)
					),
				];
				allLines.push({ points: roughPoints, color: '#4488ff' });
			}
		}

		return allLines;
	}, [fixture.assignments]);

	return (
		<group>
			{toolpathLines.map((line, i) => (
				<Line
					key={i}
					points={line.points}
					color={line.color}
					lineWidth={1}
					transparent
					opacity={0.6}
				/>
			))}
		</group>
	);
}

function getSimpleXRange(contour: [number, number][], y: number): [number, number] | null {
	const intersections: number[] = [];
	for (let i = 0; i < contour.length; i++) {
		const [x1, y1] = contour[i];
		const [x2, y2] = contour[(i + 1) % contour.length];
		if ((y1 <= y && y2 >= y) || (y2 <= y && y1 >= y)) {
			if (Math.abs(y2 - y1) < 0.001) continue;
			const t = (y - y1) / (y2 - y1);
			intersections.push(x1 + t * (x2 - x1));
		}
	}
	if (intersections.length < 2) return null;
	return [Math.min(...intersections), Math.max(...intersections)];
}

/** Animated spindle position */
function AnimatedSpindle() {
	const ref = useRef<THREE.Group>(null);

	useFrame(({ clock }) => {
		if (!ref.current) return;
		// Gentle idle motion
		const t = clock.getElapsedTime();
		ref.current.position.x = BED_X / 2 + Math.sin(t * 0.3) * 50;
		ref.current.position.z = BED_Y / 2 + Math.cos(t * 0.2) * 50;
	});

	return (
		<group ref={ref}>
			<SpindleUnit position={[0, 0, 0]} />
		</group>
	);
}

/** Camera setup */
function CameraSetup() {
	const { camera } = useThree();

	useMemo(() => {
		camera.position.set(BED_X * 0.8, BED_Y * 0.6, BED_Y * 1.2);
		camera.lookAt(BED_X / 2, 0, BED_Y / 2);
	}, [camera]);

	return null;
}

// ══════════════════════════════════════════════
// Main component
// ══════════════════════════════════════════════

export function CncMachine3DView({ fixture, className, showToolpath = true }: CncMachine3DViewProps) {
	// Calculate EVA block positions (centered on bed)
	const blockPositions = useMemo(() => {
		const cols = 4;
		const gapX = 40;
		const gapY = 60;
		const gridW = cols * BLOCK_W + (cols - 1) * gapX;
		const gridH = 2 * BLOCK_H + gapY;
		const x0 = (BED_X - gridW) / 2;
		const z0 = (BED_Y - gridH) / 2;

		return Array.from({ length: SLOT_COUNT }, (_, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			return {
				x: x0 + col * (BLOCK_W + gapX),
				z: z0 + row * (BLOCK_H + gapY),
			};
		});
	}, []);

	return (
		<div className={cn('w-full h-full bg-[#0a0e18]', className)}>
			<Canvas
				shadows
				gl={{ antialias: true, alpha: false }}
				dpr={[1, 2]}
			>
				<CameraSetup />

				{/* Lighting */}
				<ambientLight intensity={0.4} />
				<directionalLight
					position={[BED_X, BED_Y, BED_Y / 2]}
					intensity={0.8}
					castShadow
					shadow-mapSize={[1024, 1024]}
				/>
				<directionalLight
					position={[-200, 500, -200]}
					intensity={0.3}
				/>
				<pointLight position={[BED_X / 2, 400, BED_Y / 2]} intensity={0.2} />

				{/* Background color */}
				<color attach="background" args={['#0a0e18']} />
				<fog attach="fog" args={['#0a0e18', 2000, 4000]} />

				{/* Machine components */}
				<Bed />
				<TSlots />
				<Frame />
				<Gantry yPosition={BED_Y / 2} />
				<AnimatedSpindle />

				{/* EVA blocks */}
				{blockPositions.map((pos, i) => {
					const parts = getSlotParts(fixture, i);
					return (
						<EvaBlock
							key={i}
							position={[pos.x + BLOCK_W / 2, BED_THICKNESS / 2, pos.z + BLOCK_H / 2]}
							slotIndex={i}
							parts={parts}
						/>
					);
				})}

				{/* Toolpath lines */}
				{showToolpath && <ToolpathVisualization fixture={fixture} />}

				{/* Floor grid */}
				<Grid
					position={[BED_X / 2, -BED_THICKNESS - 5, BED_Y / 2]}
					args={[2000, 2000]}
					cellSize={50}
					cellThickness={0.5}
					cellColor="#1a2030"
					sectionSize={200}
					sectionThickness={1}
					sectionColor="#253050"
					fadeDistance={2500}
					infiniteGrid
				/>

				{/* Orbit controls */}
				<OrbitControls
					target={[BED_X / 2, FRAME_HEIGHT / 2, BED_Y / 2]}
					minDistance={300}
					maxDistance={3000}
					maxPolarAngle={Math.PI * 0.85}
					enableDamping
					dampingFactor={0.05}
				/>
			</Canvas>

			{/* Overlay labels */}
			<div className="absolute top-3 left-3 flex flex-col gap-1 pointer-events-none">
				<span className="text-[10px] font-mono text-white/30">
					MEKANIKA CNC PRO MK2
				</span>
				<span className="text-[10px] font-mono text-white/20">
					1030 × 1030 mm • PlanetCNC TNG
				</span>
			</div>

			{/* Legend */}
			{showToolpath && fixture.assignments.length > 0 && (
				<div className="absolute bottom-3 right-3 flex flex-col gap-1 pointer-events-none">
					<div className="flex items-center gap-2">
						<div className="w-3 h-0.5 bg-[#4488ff]" />
						<span className="text-[9px] font-mono text-white/30">Roughing</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="w-3 h-0.5 bg-[#ff6644]" />
						<span className="text-[9px] font-mono text-white/30">Finish contour</span>
					</div>
				</div>
			)}
		</div>
	);
}

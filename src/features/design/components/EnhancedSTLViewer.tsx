'use client';

import {
	Suspense,
	useRef,
	useState,
	useCallback,
	useImperativeHandle,
	forwardRef,
	useMemo,
	useEffect,
} from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Text } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
// Note: Full THREE import needed for react-three-fiber compatibility
import { centerMesh, scaleMesh } from '@/src/features/design/utils/matching';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import {
	buildBasicInsole,
	type LandmarkPoints,
} from '@/src/features/design/utils/landmarkFitting';
import { applyAllCorrections } from '@/src/features/design/utils/insoleCorrections';
import type { OntwerpCorrections } from '@/src/shared/components/design/OntwerpPanel';
import type { CorrectionKey } from '@/src/shared/components/design/correctionsCatalog';
import {
	buildInteractiveGridPoints,
	applyGridPointDeformation,
	moveSelectedGridPoints,
	type GridPoint,
} from '@/src/features/design/utils/gridPointInteraction';

interface STLMeshProps {
	url: string;
	color?: string;
	position?: [number, number, number];
	interactive?: boolean;
	rotationOffset?: [number, number, number];
	opacity?: number;
	onGeometryReady?: (
		geometry: THREE.BufferGeometry,
		meta?: { mmToWorld: number }
	) => void;
	onPickPoint?: (point: THREE.Vector3) => void;
	pointPickMode?: boolean;
	showZones?: boolean;
	heatmap?: boolean;
	transparentMode?: boolean;
	probeEnabled?: boolean;
	onProbe?: (payload: {
		point: THREE.Vector3;
		heightMm: number;
		side: 'left' | 'right';
	}) => void;
	selected?: boolean;
	onSelect?: (side: 'left' | 'right') => void;
	showBoxGrid?: boolean;
	corrections?: OntwerpCorrections;
	activeCorrections?: CorrectionKey[];
	side?: 'left' | 'right';
	gridEditMode?: boolean;
	textPlacementEnabled?: boolean;
	textPlacementText?: string;
	onTextPlace?: (payload: {
		side: 'left' | 'right';
		point: [number, number, number];
		normal: [number, number, number];
	}) => void;
}

export type TextAnnotation = {
	id: string;
	side: 'left' | 'right';
	text: string;
	position: [number, number, number];
	normal: [number, number, number];
	sizeMm: number;
};

export type BottomTextOverlay = {
	enabled: boolean;
	text: string;
	sizeMm: number;
	orientation?: 'vertical' | 'horizontal';
	color?: string;
};

// Zone colors
const ZONE_COLORS = {
	heel: new THREE.Color('#ef4444'),      // Red
	midfoot: new THREE.Color('#22c55e'),   // Green  
	forefoot: new THREE.Color('#3b82f6'),  // Blue
	arch: new THREE.Color('#f59e0b'),      // Orange/Yellow
	neutral: new THREE.Color('#d7dadd'),   // Default gray
};

// Smooth interpolation for zone boundaries
function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

// Calculate zone weights for a vertex position
function getZoneWeights(relativeY: number, relativeZ: number): { heel: number; midfoot: number; forefoot: number; arch: number } {
	const transitionWidth = 0.1;
	
	// Heel weight
	const heel = smoothstep(0.2 + transitionWidth, 0.2 - transitionWidth, relativeY);
	
	// Midfoot weight
	let midfoot = 0;
	if (relativeY < 0.2 + transitionWidth) {
		midfoot = smoothstep(0.2 - transitionWidth, 0.2 + transitionWidth, relativeY);
	} else if (relativeY > 0.5 - transitionWidth) {
		midfoot = smoothstep(0.5 + transitionWidth, 0.5 - transitionWidth, relativeY);
	} else {
		midfoot = 1;
	}
	
	// Forefoot weight
	const forefoot = smoothstep(0.5 - transitionWidth, 0.5 + transitionWidth, relativeY);
	
	// Arch weight (based on Z height)
	const archZ = smoothstep(0.2, 0.6, relativeZ);
	let archY = 1;
	if (relativeY < 0.05) {
		archY = smoothstep(0, 0.05, relativeY);
	} else if (relativeY > 0.8) {
		archY = smoothstep(1.0, 0.8, relativeY);
	}
	const arch = archZ * archY;
	
	return { heel, midfoot, forefoot, arch };
}

// Apply zone colors to geometry
function applyZoneColors(geometry: THREE.BufferGeometry): void {
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const colors = new Float32Array(positions.count * 3);
	
	// Compute bounding box
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	
	// Determine which axis is the length (heel-to-toe) - it's the longest one
	const sizeX = bbox.max.x - bbox.min.x;
	const sizeY = bbox.max.y - bbox.min.y;
	const sizeZ = bbox.max.z - bbox.min.z;
	
	// For insoles, typically Y is the longest (length), Z is height
	// But we need to detect this dynamically
	let lengthAxis: string = 'y';
	let heightAxis: string = 'z';
	
	if (sizeX > sizeY && sizeX > sizeZ) {
		lengthAxis = 'x';
		heightAxis = 'z';
	} else if (sizeY > sizeX && sizeY > sizeZ) {
		lengthAxis = 'y';
		heightAxis = 'z';
	} else {
		lengthAxis = 'z';
		heightAxis = 'y';
	}
	
	const minLength = lengthAxis === 'x' ? bbox.min.x : lengthAxis === 'y' ? bbox.min.y : bbox.min.z;
	const maxLength = lengthAxis === 'x' ? bbox.max.x : lengthAxis === 'y' ? bbox.max.y : bbox.max.z;
	const minHeight = heightAxis === 'x' ? bbox.min.x : heightAxis === 'y' ? bbox.min.y : bbox.min.z;
	const maxHeight = heightAxis === 'x' ? bbox.max.x : heightAxis === 'y' ? bbox.max.y : bbox.max.z;
	
	const lengthSpan = maxLength - minLength;
	const heightSpan = maxHeight - minHeight;
	
	const tempColor = new THREE.Color();
	
	console.log('Zone coloring - length axis:', lengthAxis, 'height axis:', heightAxis);
	console.log('Bounding box:', { sizeX, sizeY, sizeZ });
	
	for (let i = 0; i < positions.count; i++) {
		const x = positions.getX(i);
		const y = positions.getY(i);
		const z = positions.getZ(i);
		
		const lengthVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
		const heightVal = heightAxis === 'x' ? x : heightAxis === 'y' ? y : z;
		
		const relativeLength = lengthSpan > 0 ? (lengthVal - minLength) / lengthSpan : 0;
		const relativeHeight = heightSpan > 0 ? (heightVal - minHeight) / heightSpan : 0;
		
		const weights = getZoneWeights(relativeLength, relativeHeight);
		
		// Find dominant zone
		const maxWeight = Math.max(weights.heel, weights.midfoot, weights.forefoot, weights.arch);
		
		if (maxWeight < 0.1) {
			tempColor.copy(ZONE_COLORS.neutral);
		} else if (weights.arch > 0.3 && weights.arch >= maxWeight * 0.8) {
			// Arch has priority when significant
			tempColor.copy(ZONE_COLORS.arch);
		} else if (weights.heel >= maxWeight) {
			tempColor.copy(ZONE_COLORS.heel);
		} else if (weights.forefoot >= maxWeight) {
			tempColor.copy(ZONE_COLORS.forefoot);
		} else {
			tempColor.copy(ZONE_COLORS.midfoot);
		}
		
		colors[i * 3] = tempColor.r;
		colors[i * 3 + 1] = tempColor.g;
		colors[i * 3 + 2] = tempColor.b;
	}
	
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	console.log('Zone colors applied to', positions.count, 'vertices');
}

function applyHeightmapColors(geometry: THREE.BufferGeometry): void {
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const colors = new Float32Array(positions.count * 3);

	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const sizeX = bbox.max.x - bbox.min.x;
	const sizeY = bbox.max.y - bbox.min.y;
	const sizeZ = bbox.max.z - bbox.min.z;

	// Height axis = smallest extent (insole thickness direction)
	const sizes = [
		{ axis: 'x' as const, size: sizeX },
		{ axis: 'y' as const, size: sizeY },
		{ axis: 'z' as const, size: sizeZ },
	].sort((a, b) => a.size - b.size);
	const heightAxis = sizes[0].axis;
	const minH =
		heightAxis === 'x'
			? bbox.min.x
			: heightAxis === 'y'
				? bbox.min.y
				: bbox.min.z;
	const maxH =
		heightAxis === 'x'
			? bbox.max.x
			: heightAxis === 'y'
				? bbox.max.y
				: bbox.max.z;
	const span = Math.max(1e-6, maxH - minH);

	const low = new THREE.Color('#1d4ed8'); // blue
	const mid = new THREE.Color('#22c55e'); // green
	const high = new THREE.Color('#ef4444'); // red
	const temp = new THREE.Color();

	for (let i = 0; i < positions.count; i++) {
		const x = positions.getX(i);
		const y = positions.getY(i);
		const z = positions.getZ(i);
		const h = heightAxis === 'x' ? x : heightAxis === 'y' ? y : z;
		const t = Math.max(0, Math.min(1, (h - minH) / span));
		if (t < 0.5) {
			temp.copy(low).lerp(mid, t / 0.5);
		} else {
			temp.copy(mid).lerp(high, (t - 0.5) / 0.5);
		}
		colors[i * 3] = temp.r;
		colors[i * 3 + 1] = temp.g;
		colors[i * 3 + 2] = temp.b;
	}

	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function STLMesh({
	url,
	color = '#e8b99a',
	position = [0, 0, 0],
	interactive = true,
	rotationOffset = [0, 0, 0],
	opacity,
	onGeometryReady,
	onPickPoint,
	pointPickMode = false,
	showZones = false,
	heatmap = false,
	transparentMode = false,
	probeEnabled = false,
	onProbe,
	selected = false,
	onSelect,
	showBoxGrid = false,
	corrections,
	activeCorrections,
	side = 'left',
	gridEditMode = false,
	textPlacementEnabled = false,
	textPlacementText = '',
	onTextPlace,
}: STLMeshProps) {
	const rawGeometry = useLoader(STLLoader, url);
	const { parameters } = useDesignStore();
	const general = parameters.general;
	const isLRNumber = (value: unknown): value is { left: number; right: number } => {
		if (!value || typeof value !== 'object') return false;
		const maybe = value as Record<string, unknown>;
		return (
			typeof maybe.left === 'number' &&
			Number.isFinite(maybe.left) &&
			typeof maybe.right === 'number' &&
			Number.isFinite(maybe.right)
		);
	};
	const getSideNumber = (value: unknown, fallback: number) => {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (isLRNumber(value)) return side === 'left' ? value.left : value.right;
		return fallback;
	};
	const generalUnknown = general as unknown as Record<string, unknown> | undefined;
	const shoeSize = getSideNumber(generalUnknown?.shoeSize, 40);
	const soleThicknessMm = getSideNumber(generalUnknown?.soleThicknessMm, 2);
	const rimHeightMm = getSideNumber(generalUnknown?.maxInsoleHeightMm, 10);
	const meshRef = useRef<THREE.Mesh>(null);
	const processedRef = useRef(false);
	const lastCorrectionsRef = useRef<string>('');
	const pendingSignatureRef = useRef<string>('');
	const geometryRef = useRef<THREE.BufferGeometry | null>(null);
	const animRafRef = useRef<number | null>(null);
	const correctedGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const correctedSignatureRef = useRef<string>('');
	const generalRafRef = useRef<number | null>(null);
	const [gridPoints, setGridPoints] = useState<GridPoint[]>([]);
	const [selectedGridPoints, setSelectedGridPoints] = useState<Set<string>>(new Set());
	const baseGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const [baselineZ, setBaselineZ] = useState<number | null>(null);

	const applyOrientation = useCallback((mesh: THREE.Mesh) => {
		mesh.rotation.set(
			-Math.PI / 2 + (rotationOffset[0] ?? 0),
			rotationOffset[1] ?? 0,
			rotationOffset[2] ?? 0
		);
	}, [rotationOffset]);
	
	// Create a memoized processed geometry (base without corrections)
	const { baseGeometry, mmToWorld } = useMemo(() => {
		const euSizeToLengthMm = (eu: number) => (eu * 10) / 1.5;
		const DEFAULT_SHOE_SIZE = 40;
		// Rim height is applied after corrections so it responds to corrections like kuiphoogte.

		// Clone the geometry so we don't modify the cached one
		const cloned = rawGeometry.clone();
		
		// Center the geometry
		const centerMatrix = centerMesh(cloned);
		cloned.applyMatrix4(centerMatrix);

		// Normalize to a consistent view size, but keep a conversion so UI values remain in mm.
		const scaleMatrix = scaleMesh(cloned, 100);
		const s = new THREE.Vector3();
		scaleMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
		const nextMmToWorld = s.x || 1;
		cloned.applyMatrix4(scaleMatrix);

		// Apply Algemeen params directly to the *white STL* so changes are visible.
		// IMPORTANT: apply changes as *deltas* relative to the original model,
		// so it remains the same sole and only adjusts length/thickness/side height.
		cloned.computeBoundingBox();
		const bbox = cloned.boundingBox;
		const posAttr = cloned.getAttribute('position') as THREE.BufferAttribute | undefined;
		if (bbox && posAttr) {
			const size = bbox.getSize(new THREE.Vector3());
			const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
			const sizes = { x: size.x, y: size.y, z: size.z };
			axes.sort((a, b) => sizes[a] - sizes[b]);
			const lengthAxis = axes[2];
			const widthAxis = axes[1];

			const minLen = lengthAxis === 'x' ? bbox.min.x : lengthAxis === 'y' ? bbox.min.y : bbox.min.z;
			const maxLen = lengthAxis === 'x' ? bbox.max.x : lengthAxis === 'y' ? bbox.max.y : bbox.max.z;
			const lenSpan = Math.max(1e-6, maxLen - minLen);

			// 1) Shoe size: heel-anchored stretch/compress along length axis (relative to EU40)
			const lengthScale =
				typeof shoeSize === 'number' && Number.isFinite(shoeSize) && shoeSize > 0
					? euSizeToLengthMm(shoeSize) / euSizeToLengthMm(DEFAULT_SHOE_SIZE)
					: 1;

			// Determine heel end via "wider end" heuristic (consistent with corrections mapper)
			const slice = Math.max(lenSpan * 0.08, 1e-6);
			let minEndMinWidth = Number.POSITIVE_INFINITY;
			let minEndMaxWidth = Number.NEGATIVE_INFINITY;
			let minEndCount = 0;
			let maxEndMinWidth = Number.POSITIVE_INFINITY;
			let maxEndMaxWidth = Number.NEGATIVE_INFINITY;
			let maxEndCount = 0;

			for (let i = 0; i < posAttr.count; i++) {
				const x = posAttr.getX(i);
				const y = posAttr.getY(i);
				const z = posAttr.getZ(i);
				const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
				const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
				if (lenVal <= minLen + slice) {
					minEndMinWidth = Math.min(minEndMinWidth, wVal);
					minEndMaxWidth = Math.max(minEndMaxWidth, wVal);
					minEndCount++;
				}
				if (lenVal >= maxLen - slice) {
					maxEndMinWidth = Math.min(maxEndMinWidth, wVal);
					maxEndMaxWidth = Math.max(maxEndMaxWidth, wVal);
					maxEndCount++;
				}
			}
			const minEndWidthSpan =
				minEndCount > 10
					? Math.max(0, minEndMaxWidth - minEndMinWidth)
					: Number.POSITIVE_INFINITY;
			const maxEndWidthSpan =
				maxEndCount > 10
					? Math.max(0, maxEndMaxWidth - maxEndMinWidth)
					: Number.POSITIVE_INFINITY;
			const heelAtMin =
				Number.isFinite(minEndWidthSpan) && Number.isFinite(maxEndWidthSpan)
					? minEndWidthSpan >= maxEndWidthSpan
					: true;

			if (Number.isFinite(lengthScale) && Math.abs(lengthScale - 1) > 1e-4) {
				for (let i = 0; i < posAttr.count; i++) {
					const x = posAttr.getX(i);
					const y = posAttr.getY(i);
					const z = posAttr.getZ(i);
					const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
					const distFromHeel = heelAtMin ? lenVal - minLen : maxLen - lenVal;
					const nextDist = distFromHeel * lengthScale;
					const nextLen = heelAtMin ? minLen + nextDist : maxLen - nextDist;
					if (lengthAxis === 'x') posAttr.setX(i, nextLen);
					else if (lengthAxis === 'y') posAttr.setY(i, nextLen);
					else posAttr.setZ(i, nextLen);
				}
				posAttr.needsUpdate = true;
			}

			// Sole thickness + rim height are applied later as a fast post-step so slider edits blend smoothly.
		}

		// Recompute normals for better lighting
		cloned.computeVertexNormals();
		
		return {
			baseGeometry: cloned,
			mmToWorld: nextMmToWorld,
		};
	}, [rawGeometry, shoeSize]);
	
	// Create a working geometry that includes corrections
	const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
	useEffect(() => {
		geometryRef.current = geometry;
	}, [geometry]);
	
	// Debounced corrections application to prevent UI blocking
	const pendingCorrectionsRef = useRef<OntwerpCorrections | undefined>(undefined);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const smoothstep01 = useCallback((edge0: number, edge1: number, x: number) => {
		const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
		return t * t * (3 - 2 * t);
	}, []);

	const applySoleThicknessAfterCorrections = useCallback(
		(geom: THREE.BufferGeometry) => {
			const DEFAULT_SOLE_THICKNESS_MM = 2;
			const thicknessDeltaMm = (soleThicknessMm ?? DEFAULT_SOLE_THICKNESS_MM) - DEFAULT_SOLE_THICKNESS_MM;
			const thicknessDeltaWorld = thicknessDeltaMm * (mmToWorld || 1);
			if (Math.abs(thicknessDeltaWorld) < 1e-6) return;
			const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
			if (!posAttr) return;
			geom.computeBoundingBox();
			const bbox = geom.boundingBox;
			if (!bbox) return;
			// Zooldikte should affect the *bottom layer* only (outsole), i.e. extrude downward.
			// STLs can come in different axis conventions; pick the smallest bbox dimension
			// as the thickness axis, then only move a narrow band near the bottom.
			const size = bbox.getSize(new THREE.Vector3());
			const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
			const sizes = { x: size.x, y: size.y, z: size.z };
			axes.sort((a, b) => sizes[a] - sizes[b]);
			const thicknessAxis = axes[0];
			const minH = thicknessAxis === 'x' ? bbox.min.x : thicknessAxis === 'y' ? bbox.min.y : bbox.min.z;
			const maxH = thicknessAxis === 'x' ? bbox.max.x : thicknessAxis === 'y' ? bbox.max.y : bbox.max.z;
			const hSpan = Math.max(1e-6, maxH - minH);
			const getH = (i: number) =>
				thicknessAxis === 'x'
					? posAttr.getX(i)
					: thicknessAxis === 'y'
						? posAttr.getY(i)
						: posAttr.getZ(i);
			const setH = (i: number, v: number) => {
				if (thicknessAxis === 'x') posAttr.setX(i, v);
				else if (thicknessAxis === 'y') posAttr.setY(i, v);
				else posAttr.setZ(i, v);
			};

			for (let i = 0; i < posAttr.count; i++) {
				const h = getH(i);
				// Weight = 1 at very bottom, fades quickly to 0.
				const hNorm = (h - minH) / hSpan;
				const bottomWeight = 1 - smoothstep01(0.03, 0.18, hNorm);
				if (bottomWeight <= 0) continue;
				setH(i, h - thicknessDeltaWorld * bottomWeight);
			}
			posAttr.needsUpdate = true;
			geom.computeVertexNormals();
		},
		[soleThicknessMm, mmToWorld, smoothstep01]
	);
	
	const applyRimHeightAfterCorrections = useCallback((geom: THREE.BufferGeometry) => {
		const DEFAULT_RIM_HEIGHT_MM = 10;
		const rimDeltaMm = (rimHeightMm ?? DEFAULT_RIM_HEIGHT_MM) - DEFAULT_RIM_HEIGHT_MM;
		const rimDeltaWorld = rimDeltaMm * (mmToWorld || 1);
		if (Math.abs(rimDeltaWorld) < 1e-6) return;
		const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
		if (!posAttr) return;
		geom.computeBoundingBox();
		const bbox = geom.boundingBox;
		if (!bbox) return;
		const size = bbox.getSize(new THREE.Vector3());
		const center = bbox.getCenter(new THREE.Vector3());
		const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
		const sizes = { x: size.x, y: size.y, z: size.z };
		axes.sort((a, b) => sizes[a] - sizes[b]);
		const heightAxis = axes[0];
		const widthAxis = axes[1];
		const minH = heightAxis === 'x' ? bbox.min.x : heightAxis === 'y' ? bbox.min.y : bbox.min.z;
		const maxH = heightAxis === 'x' ? bbox.max.x : heightAxis === 'y' ? bbox.max.y : bbox.max.z;
		const hSpan = Math.max(1e-6, maxH - minH);
		const halfW = Math.max(
			1e-6,
			(widthAxis === 'x'
				? size.x
				: widthAxis === 'y'
					? size.y
					: size.z) * 0.5
		);
		for (let i = 0; i < posAttr.count; i++) {
			const x = posAttr.getX(i);
			const y = posAttr.getY(i);
			const z = posAttr.getZ(i);
			const wVal = widthAxis === 'x' ? x - center.x : widthAxis === 'y' ? y - center.y : z - center.z;
			const wNorm = Math.abs(wVal) / halfW;
			const rimWeight = smoothstep01(0.7, 1.0, wNorm);
			if (rimWeight <= 0) continue;
			const hVal = heightAxis === 'x' ? x : heightAxis === 'y' ? y : z;
			const hNorm = (hVal - minH) / hSpan; // 0..1
			const verticalWeight = smoothstep01(0.45, 0.95, hNorm);
			let nextH = hVal + rimDeltaWorld * rimWeight * verticalWeight;
			if (rimDeltaWorld > 0) {
				nextH = Math.min(maxH + Math.abs(rimDeltaWorld) * 2, nextH);
			} else {
				nextH = Math.max(minH, nextH);
			}
			if (heightAxis === 'x') posAttr.setX(i, nextH);
			else if (heightAxis === 'y') posAttr.setY(i, nextH);
			else posAttr.setZ(i, nextH);
		}
		posAttr.needsUpdate = true;
		geom.computeVertexNormals();
	}, [rimHeightMm, mmToWorld, smoothstep01]);

	const animateGeometryTo = useCallback((target: THREE.BufferGeometry) => {
		const existing = geometryRef.current;
		if (gridEditMode || !existing) {
			setGeometry(target);
			return;
		}
		const existingPos = existing.getAttribute('position') as THREE.BufferAttribute | undefined;
		const targetPos = target.getAttribute('position') as THREE.BufferAttribute | undefined;
		if (!existingPos || !targetPos || existingPos.count !== targetPos.count) {
			setGeometry(target);
			return;
		}
		if (animRafRef.current) {
			cancelAnimationFrame(animRafRef.current);
			animRafRef.current = null;
		}
		const from = (existingPos.array as Float32Array).slice();
		const to = (targetPos.array as Float32Array).slice();
		const start = performance.now();
		const duration = 140;
		const ease = (t: number) => t * t * (3 - 2 * t);
		const step = (now: number) => {
			const t = Math.max(0, Math.min(1, (now - start) / duration));
			const k = ease(t);
			const arr = existingPos.array as Float32Array;
			for (let i = 0; i < arr.length; i++) {
				arr[i] = from[i] + (to[i] - from[i]) * k;
			}
			existingPos.needsUpdate = true;
			if (t < 1) {
				animRafRef.current = requestAnimationFrame(step);
				return;
			}
			animRafRef.current = null;
			existing.computeVertexNormals();
			// Keep colors in sync when showing heatmap/zones.
			if (showZones) applyZoneColors(existing);
			else if (heatmap) applyHeightmapColors(existing);
			else existing.deleteAttribute('color');
			// Update analysis baseline after geometry changes
			if (meshRef.current) {
				applyOrientation(meshRef.current);
				meshRef.current.updateWorldMatrix(true, false);
				const worldBox = new THREE.Box3().setFromObject(meshRef.current);
				setBaselineZ(worldBox.min.z);
			}
		};
		animRafRef.current = requestAnimationFrame(step);
		// We no longer need the target geometry object.
		target.dispose();
	}, [gridEditMode, showZones, heatmap, applyOrientation]);

	const rebuildFinalGeometryFromCorrected = useCallback(() => {
		const corrected = correctedGeometryRef.current;
		if (!corrected) return;
		const workingGeometry = corrected.clone();
		applySoleThicknessAfterCorrections(workingGeometry);
		applyRimHeightAfterCorrections(workingGeometry);
		animateGeometryTo(workingGeometry);
	}, [applyRimHeightAfterCorrections, applySoleThicknessAfterCorrections, animateGeometryTo]);

	// Initialize corrected geometry (base + corrections) when they change (debounced)
	useEffect(() => {
		if (!baseGeometry) return;

		const correctionsKey = corrections ? JSON.stringify(corrections) : '';
		const signature = `${baseGeometry.uuid}|${mmToWorld || 1}|${side}|${correctionsKey}`;
		pendingSignatureRef.current = signature;

		// Only recompute corrected geometry if base/corrections/side are unchanged
		if (signature === correctedSignatureRef.current && correctedGeometryRef.current) return;
		
		// Store pending corrections
		pendingCorrectionsRef.current = corrections;
		
		// Clear existing timer
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}
		
		// Debounce the expensive geometry update (150ms delay)
		debounceTimerRef.current = setTimeout(() => {
			const pendingCorrections = pendingCorrectionsRef.current;
			lastCorrectionsRef.current = pendingSignatureRef.current;
			
			// Clone base geometry for modifications
			const workingGeometry = baseGeometry.clone();
			
			// Apply corrections if provided
			if (pendingCorrections) {
				try {
					applyAllCorrections(workingGeometry, pendingCorrections, side, {
						mmToWorld,
						activeCorrections,
					});
				} catch (err) {
					console.error('Error applying corrections:', err);
				}
			}

			// Cache corrected geometry and rebuild final (thickness/rim) immediately.
			if (correctedGeometryRef.current) {
				try {
					correctedGeometryRef.current.dispose();
				} catch {
					// ignore
				}
			}
			correctedGeometryRef.current = workingGeometry;
			correctedSignatureRef.current = pendingSignatureRef.current;
			rebuildFinalGeometryFromCorrected();
		}, 150);
		
		// Cleanup timer on unmount or re-render
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, [
		baseGeometry,
		corrections,
		activeCorrections,
		side,
		mmToWorld,
		rebuildFinalGeometryFromCorrected,
	]);

	// Apply general sliders (thickness/rim) immediately without waiting for the debounce.
	useEffect(() => {
		if (!correctedGeometryRef.current) return;
		if (generalRafRef.current != null) {
			cancelAnimationFrame(generalRafRef.current);
		}
		generalRafRef.current = requestAnimationFrame(() => {
			generalRafRef.current = null;
			rebuildFinalGeometryFromCorrected();
		});
		return () => {
			if (generalRafRef.current != null) {
				cancelAnimationFrame(generalRafRef.current);
				generalRafRef.current = null;
			}
		};
	}, [soleThicknessMm, rimHeightMm, rebuildFinalGeometryFromCorrected]);
	
	// Apply zone colors whenever showZones changes
	useEffect(() => {
		if (!geometry) return;
		if (showZones) {
			applyZoneColors(geometry);
			return;
		}
		if (heatmap) {
			applyHeightmapColors(geometry);
			return;
		}
		geometry.deleteAttribute('color');
	}, [geometry, showZones, heatmap]);

	const probeRafRef = useRef<number | null>(null);
	const pendingProbeRef = useRef<{
		point: THREE.Vector3;
		heightMm: number;
		side: 'left' | 'right';
	} | null>(null);

	useEffect(() => {
		if (!meshRef.current || !geometry) return;
		// Ensure consistent STL orientation (avoid per-frame mutation)
		applyOrientation(meshRef.current);
		meshRef.current.updateWorldMatrix(true, false);
		const worldBox = new THREE.Box3().setFromObject(meshRef.current);
		setBaselineZ(worldBox.min.z);
	}, [geometry, applyOrientation]);
	
	// Initialize grid points when entering grid edit mode
	useEffect(() => {
		let cancelled = false;
		const schedule = (fn: () => void) => {
			if (typeof queueMicrotask === 'function') {
				queueMicrotask(fn);
			} else {
				setTimeout(fn, 0);
			}
		};

		if (!geometry || !showBoxGrid || !gridEditMode) {
			baseGeometryRef.current = null;
			schedule(() => {
				if (cancelled) return;
				setGridPoints([]);
				setSelectedGridPoints(new Set());
			});
			return;
		}

		// Build grid points from geometry
		const points = buildInteractiveGridPoints(geometry, 16, 22);
		baseGeometryRef.current = geometry.clone();
		schedule(() => {
			if (cancelled) return;
			setGridPoints(points);
			setSelectedGridPoints(new Set());
		});

		return () => {
			cancelled = true;
		};
	}, [geometry, showBoxGrid, gridEditMode]);

	// Keyboard controls for moving selected grid points
	useEffect(() => {
		if (!gridEditMode || selectedGridPoints.size === 0) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
				e.preventDefault();
				// Keep keyboard movement stable in millimeters, even if the STL is rescaled for viewing.
				const stepMm = 0.3;
				const delta = (e.key === 'ArrowUp' ? stepMm : -stepMm) * (mmToWorld || 1);

				setGridPoints((prev) => {
					const updated = [...prev];
					moveSelectedGridPoints(updated, selectedGridPoints, delta);

					// Apply deformation to geometry with smooth blending
					if (geometry && baseGeometryRef.current) {
						const workingGeom = baseGeometryRef.current.clone();
						const influenceRadiusMm = 4.5;
						applyGridPointDeformation(
							workingGeom,
							updated,
							influenceRadiusMm * (mmToWorld || 1)
						);
						setGeometry(workingGeom);
					}

					return updated;
				});
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [gridEditMode, selectedGridPoints, geometry, mmToWorld]);

	// Notify parent about geometry
	useEffect(() => {
		if (geometry && !processedRef.current && onGeometryReady) {
			processedRef.current = true;
			onGeometryReady(geometry, { mmToWorld: mmToWorld || 1 });
		}
	}, [geometry, onGeometryReady, mmToWorld]);

	// Rotate mesh to face up (STL files often need rotation)
	// Keep useFrame for legacy behavior, but rotation is also set on geometry init.
	useFrame(() => {
		if (meshRef.current && !processedRef.current) {
			applyOrientation(meshRef.current);
		}
	});


	if (!geometry) {
		return null;
	}

	return (
		<mesh
			ref={meshRef}
			geometry={geometry}
			position={position}
			onPointerDown={interactive ? (event) => {
				if (!textPlacementEnabled || !onTextPlace) return;
				if (pointPickMode || gridEditMode) return;
				const text = (textPlacementText || '').trim();
				if (!text) return;
				event.stopPropagation();

				const point = event.point.clone();
				const faceNormal = event.face?.normal
					? event.face.normal.clone()
					: new THREE.Vector3(0, 0, 1);
				const normalMatrix = new THREE.Matrix3().getNormalMatrix(
					(event.object as THREE.Object3D).matrixWorld
				);
				const worldNormal = faceNormal.applyMatrix3(normalMatrix).normalize();

				onTextPlace({
					side,
					point: [point.x, point.y, point.z],
					normal: [worldNormal.x, worldNormal.y, worldNormal.z],
				});
			} : undefined}
			onPointerMove={interactive ? (event) => {
				if (!probeEnabled || !onProbe) return;
				if (pointPickMode || gridEditMode) return;
				const baseline = baselineZ;
				if (baseline == null) return;
				// event.point is in world coordinates
				const worldHeight = event.point.z - baseline;
				const heightMm = worldHeight / (mmToWorld || 1);
				pendingProbeRef.current = {
					point: event.point.clone(),
					heightMm,
					side,
				};
				if (probeRafRef.current != null) return;
				probeRafRef.current = window.requestAnimationFrame(() => {
					probeRafRef.current = null;
					const payload = pendingProbeRef.current;
					if (!payload) return;
					onProbe(payload);
				});
			} : undefined}
			onClick={interactive ? (event) => {
				event.stopPropagation();
				if (textPlacementEnabled) return;
				if (pointPickMode && onPickPoint) {
					onPickPoint(event.point.clone());
					return;
				}
				if (onSelect) {
					onSelect(side);
				}
			} : undefined}
		>
			<meshStandardMaterial
				key={showZones || heatmap ? 'colored' : 'normal'}
				color={showZones ? '#ffffff' : color}
				vertexColors={showZones || heatmap}
				side={THREE.DoubleSide}
				shadowSide={THREE.DoubleSide}
				roughness={0.3}
				metalness={0.0}
				flatShading={false}
				transparent={transparentMode}
				opacity={transparentMode ? (opacity ?? 0.35) : (opacity ?? 1)}
			/>

			{/* Selection highlight */}
			{selected && (
				<>
					<mesh geometry={geometry}>
						<meshStandardMaterial
							color="#22c55e"
							emissive="#16a34a"
							emissiveIntensity={0.15}
							side={THREE.DoubleSide}
							shadowSide={THREE.DoubleSide}
							transparent
							opacity={0.22}
							depthWrite={false}
							polygonOffset
							polygonOffsetFactor={-2}
							polygonOffsetUnits={-2}
						/>
					</mesh>
				</>
			)}

			{/* Interactive Box grid overlay */}
			{showBoxGrid && gridEditMode && (
				<group>
					{gridPoints.map((gp) => {
						const isSelected = selectedGridPoints.has(gp.id);
						return (
							<mesh
								key={gp.id}
								position={[gp.position.x, gp.position.y, gp.position.z]}
								onClick={(e) => {
									e.stopPropagation();
									setSelectedGridPoints((prev) => {
										const next = new Set(prev);
										if (e.shiftKey) {
											// Multi-select with shift
											if (next.has(gp.id)) next.delete(gp.id);
											else next.add(gp.id);
										} else {
											// Single select
											next.clear();
											next.add(gp.id);
										}
										return next;
									});
								}}
							>
								<sphereGeometry args={[0.9, 16, 16]} />
								<meshStandardMaterial
									color={isSelected ? '#22c55e' : '#00d9ff'}
									emissive={isSelected ? '#16a34a' : '#0099bb'}
									emissiveIntensity={isSelected ? 0.6 : 0.4}
									transparent
									opacity={isSelected ? 0.95 : 0.85}
								/>
							</mesh>
						);
					})}
				</group>
			)}
		</mesh>
	);
}

interface EnhancedSTLViewerProps {
	leftUrl?: string;
	rightUrl?: string;
	leftOverlayUrl?: string;
	rightOverlayUrl?: string;
	showGrid?: boolean;
	showBasePreview?: boolean;
	lockTopView?: boolean;
	hideScans?: boolean;
	pointPickMode?: boolean;
	showZones?: boolean;
	showLeft?: boolean;
	showRight?: boolean;
	transparent?: boolean;
	heatmap?: boolean;
	showInsoles?: boolean;
	showModel?: boolean;
	viewPreset?: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';
	controlMode?: 'rotate' | 'pan';
	analysisEnabled?: boolean;
	onProbe?: (payload: {
		point: [number, number, number];
		heightMm: number;
		side: 'left' | 'right';
	}) => void;
	corrections?: import('@/src/shared/components/design/OntwerpPanel').OntwerpCorrections;
	activeCorrections?: import('@/src/shared/components/design/correctionsCatalog').CorrectionKey[];
	textPlacementEnabled?: boolean;
	textPlacementText?: string;
	textPlacementSizeMm?: number;
	textAnnotations?: TextAnnotation[];
	bottomTextOverlay?: BottomTextOverlay;
	onTextPlace?: (payload: {
		side: 'left' | 'right';
		point: [number, number, number];
		normal: [number, number, number];
	}) => void;
	onPickPoint?: (point: [number, number, number]) => void;
	pickedPoints?: Array<[number, number, number]>;
	onRightBBox?: (box: THREE.Box3) => void;
	landmarkPoints?: LandmarkPoints | null;
	showGeneratedInsole?: boolean;
	selectedSide?: 'left' | 'right' | null;
	onSelectSide?: (side: 'left' | 'right') => void;
	onDeselectSide?: () => void;
	boxEnabled?: { left: boolean; right: boolean };
	gridEditMode?: boolean;
}

function BaseInsolePreview({
	position,
}: {
	position: [number, number, number];
}) {
	const gltf = useLoader(GLTFLoader, '/models/footcad-base/scene.gltf');
	const scene = useMemo(() => {
		const cloned = gltf.scene.clone(true);
		const box = new THREE.Box3().setFromObject(cloned);
		const center = box.getCenter(new THREE.Vector3());
		cloned.position.sub(center); // center at origin
		// Rotate 180° around X so heel is nearer, no Y flip
		cloned.rotation.set(Math.PI, 0, 0);
		cloned.traverse((obj) => {
			if ((obj as THREE.Mesh).isMesh) {
				const mesh = obj as THREE.Mesh;
				mesh.material = new THREE.MeshStandardMaterial({
					color: '#6ee7b7',
					opacity: 0.85,
					transparent: true,
					roughness: 0.35,
					metalness: 0.05,
				});
				mesh.castShadow = true;
				mesh.receiveShadow = true;
			}
		});
		return cloned;
	}, [gltf.scene]);

	return <primitive object={scene} position={position} />;
}

export interface EnhancedSTLViewerRef {
	match: () => void;
	reset: () => void;
	getInsoleGeometry: () => THREE.BufferGeometry | null;
	/** Get the right foot scan geometry for external computation */
	getRightGeometry: () => THREE.BufferGeometry | null;
	/** Set a precision insole geometry generated externally */
	setPrecisionInsole: (geom: THREE.BufferGeometry | null) => void;
}

export const EnhancedSTLViewer = forwardRef<
	EnhancedSTLViewerRef,
	EnhancedSTLViewerProps
>(
	(
		{
			leftUrl,
			rightUrl,
			leftOverlayUrl,
			rightOverlayUrl,
			showGrid = true,
			showBasePreview = false,
			lockTopView = false,
			hideScans = false,
			pointPickMode = false,
			showZones = false,
			showLeft = true,
			showRight = true,
			transparent = false,
			heatmap = false,
			showModel,
			viewPreset = 'iso',
			controlMode = 'rotate',
			analysisEnabled = false,
			onProbe,
			selectedSide = null,
			activeCorrections,
			textPlacementEnabled = false,
			textPlacementText = '',
			textPlacementSizeMm = 8,
			textAnnotations = [],
			bottomTextOverlay,
			onTextPlace,
			onSelectSide,
			onDeselectSide,
			boxEnabled = { left: false, right: false },
			gridEditMode = false,
			corrections,
			onPickPoint,
			pickedPoints = [],
			onRightBBox,
			landmarkPoints,
			showGeneratedInsole = false,
		},
		ref
	) => {
		const [leftGeometry, setLeftGeometry] =
			useState<THREE.BufferGeometry | null>(null);
		const [rightGeometry, setRightGeometry] =
			useState<THREE.BufferGeometry | null>(null);
		const [leftMmToWorld, setLeftMmToWorld] = useState<number>(1);
		const [rightMmToWorld, setRightMmToWorld] = useState<number>(1);
		const [localLandmarks, setLocalLandmarks] = useState<LandmarkPoints | null>(
			null
		);
		const [precisionInsole, setPrecisionInsole] = useState<THREE.BufferGeometry | null>(null);
		const { setMatchTransform, parameters } = useDesignStore();
		const general = parameters.general;
		const shoeSize = general?.shoeSize;
		const soleThicknessMm = general?.soleThicknessMm;
		const maxInsoleHeightMm = general?.maxInsoleHeightMm;
		const euSizeToLengthMm = (eu: number) => (eu * 10) / 1.5;
		const generatedInsole = useMemo(() => {
			const shouldShow = showGeneratedInsole;
			if (!shouldShow) return null;
			if (!rightGeometry) return null;
			const mmToWorld = rightMmToWorld || 1;
			const thicknessWorld =
				typeof soleThicknessMm === 'number' && Number.isFinite(soleThicknessMm)
					? Math.max(0.1, soleThicknessMm) * mmToWorld
					: 2 * mmToWorld;
			const lengthScale =
				typeof shoeSize === 'number' && Number.isFinite(shoeSize) && shoeSize > 0
					? euSizeToLengthMm(shoeSize) / euSizeToLengthMm(40)
					: 1;
			const rimHeightWorld =
				typeof maxInsoleHeightMm === 'number' &&
				Number.isFinite(maxInsoleHeightMm) &&
				maxInsoleHeightMm > 0
					? maxInsoleHeightMm * mmToWorld
					: 10 * mmToWorld;

			// If we don't have landmarks yet, still provide a visible response to
			// Algemeen changes by transforming the right geometry.
			if (!localLandmarks) {
				const geom = rightGeometry.clone();
				geom.computeBoundingBox();
				const bbox = geom.boundingBox;
				if (!bbox) return geom;
				const size = bbox.getSize(new THREE.Vector3());
				const center = bbox.getCenter(new THREE.Vector3());
				const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
				const sizes = {
					x: size.x,
					y: size.y,
					z: size.z,
				};
				axes.sort((a, b) => sizes[a] - sizes[b]);
				const heightAxis = axes[0];
				const lengthAxis = axes[2];
				const widthAxis = axes[1];

				const currentHeightWorld = Math.max(1e-6, sizes[heightAxis]);
				const heightScale = thicknessWorld / currentHeightWorld;
				const scaleVec = new THREE.Vector3(1, 1, 1);
				scaleVec[lengthAxis] = Math.max(0.1, lengthScale);
				scaleVec[heightAxis] = Math.max(0.05, heightScale);
				const m = new THREE.Matrix4()
					.makeTranslation(-center.x, -center.y, -center.z)
					.multiply(new THREE.Matrix4().makeScale(scaleVec.x, scaleVec.y, scaleVec.z))
					.multiply(new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
				geom.applyMatrix4(m);

				// Add an edge (rim) boost along the width edges.
				geom.computeBoundingBox();
				const bbox2 = geom.boundingBox;
				const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
				if (!bbox2 || !posAttr || rimHeightWorld <= 0) {
					geom.computeVertexNormals();
					return geom;
				}
				const size2 = bbox2.getSize(new THREE.Vector3());
				const center2 = bbox2.getCenter(new THREE.Vector3());
				const halfW = Math.max(1e-6, (widthAxis === 'x' ? size2.x : widthAxis === 'y' ? size2.y : size2.z) * 0.5);
				const smoothstep = (edge0: number, edge1: number, x: number) => {
					const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
					return t * t * (3 - 2 * t);
				};

				for (let i = 0; i < posAttr.count; i++) {
					const x = posAttr.getX(i);
					const y = posAttr.getY(i);
					const z = posAttr.getZ(i);
					const wVal = widthAxis === 'x' ? x - center2.x : widthAxis === 'y' ? y - center2.y : z - center2.z;
					const wNorm = Math.abs(wVal) / halfW; // 0..1
					const rimWeight = smoothstep(0.65, 1.0, wNorm);
					if (rimWeight <= 0) continue;
					const add = rimHeightWorld * rimWeight;
					if (heightAxis === 'x') posAttr.setX(i, x + add);
					else if (heightAxis === 'y') posAttr.setY(i, y + add);
					else posAttr.setZ(i, z + add);
				}

				posAttr.needsUpdate = true;
				geom.computeVertexNormals();
				return geom;
			}

			return buildBasicInsole(rightGeometry, localLandmarks, {
				padScale: 1.02,
				thickness: thicknessWorld,
				lengthScale,
				rimHeight: rimHeightWorld,
				archBoost: 0.75,
				heelCupDepth: 7 * mmToWorld,
				toeTaper: 0.14,
				heelTaper: 0.08,
				resU: 140,
				resV: 70,
			});
		}, [rightGeometry, localLandmarks, showGeneratedInsole, rightMmToWorld, shoeSize, soleThicknessMm, maxInsoleHeightMm]);
		const leftMeshRef = useRef<THREE.Group>(null);
		const rightMeshRef = useRef<THREE.Group>(null);
		const cameraRef = useRef<THREE.PerspectiveCamera>(null);
		const controlsRef = useRef<OrbitControlsImpl | null>(null);
		const [probeState, setProbeState] = useState<{
			point: [number, number, number];
			heightMm: number;
			side: 'left' | 'right';
		} | null>(null);

		const effectiveShowGeneratedInsole = showGeneratedInsole;
		const effectiveHideScans = hideScans || (typeof showModel === 'boolean' ? !showModel : false);
		const effectiveViewPreset = analysisEnabled ? 'back' : viewPreset;

		const handleLogCamera = () => {
			const cam = cameraRef.current;
			const ctrl = controlsRef.current;
			if (!cam) return;
			// Camera debug info - only in development
			if (process.env.NODE_ENV === 'development') {
				const payload = {
					position: cam.position.toArray(),
					target: ctrl?.target?.toArray ? ctrl.target.toArray() : [0, 0, 0],
					up: cam.up.toArray(),
				};
				console.log('CameraView', payload);
			}
		};

		const handleMatch = () => {
			if (leftGeometry && rightGeometry) {
				// Simple matching: center both and align
				// In production, use ICP algorithm
				const leftCenter = new THREE.Vector3();
				const rightCenter = new THREE.Vector3();
				leftGeometry.computeBoundingBox();
				rightGeometry.computeBoundingBox();
				leftGeometry.boundingBox!.getCenter(leftCenter);
				rightGeometry.boundingBox!.getCenter(rightCenter);

				// Calculate offset to align centers
				const offset = new THREE.Vector3().subVectors(rightCenter, leftCenter);

				const transform = {
					translation: [offset.x, offset.y, offset.z] as [
						number,
						number,
						number,
					],
					rotation: [0, 0, 0] as [number, number, number],
					scale: 1,
				};

				setMatchTransform(transform);
			}
		};

		const handleReset = () => {
			setMatchTransform({
				translation: [0, 0, 0],
				rotation: [0, 0, 0],
				scale: 1,
			});
			if (leftMeshRef.current) {
				leftMeshRef.current.position.set(-50, 0, 0);
			}
			if (rightMeshRef.current) {
				rightMeshRef.current.position.set(50, 0, 0);
			}
		};

		useImperativeHandle(ref, () => ({
			match: handleMatch,
			reset: handleReset,
			getInsoleGeometry: () => precisionInsole ?? generatedInsole,
			getRightGeometry: () => rightGeometry,
			setPrecisionInsole: (geom: THREE.BufferGeometry | null) => setPrecisionInsole(geom),
		}));

		useEffect(() => {
			if (!landmarkPoints || !rightMeshRef.current) {
				Promise.resolve().then(() => setLocalLandmarks(null));
				return;
			}
			rightMeshRef.current.updateWorldMatrix(true, false);
			const inv = new THREE.Matrix4()
				.copy(rightMeshRef.current.matrixWorld)
				.invert();
			const toLocal = (p: [number, number, number]) =>
				new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(inv);

			const next: LandmarkPoints = {
				meta1: toLocal(landmarkPoints.meta1).toArray() as [
					number,
					number,
					number,
				],
				meta5: toLocal(landmarkPoints.meta5).toArray() as [
					number,
					number,
					number,
				],
				navicular: toLocal(landmarkPoints.navicular).toArray() as [
					number,
					number,
					number,
				],
				calcaneus: toLocal(landmarkPoints.calcaneus).toArray() as [
					number,
					number,
					number,
				],
				heel: toLocal(landmarkPoints.heel).toArray() as [
					number,
					number,
					number,
				],
			};
			Promise.resolve().then(() => setLocalLandmarks(next));
		}, [landmarkPoints, rightGeometry]);

		useEffect(() => {
			return () => {
				generatedInsole?.dispose?.();
			};
		}, [generatedInsole]);

		// Log camera + target whenever view is applied so you can copy values
		useEffect(() => {
			// Camera view logging - only in development
			if (
				process.env.NODE_ENV === 'development' &&
				cameraRef.current &&
				controlsRef.current
			) {
				const cam = cameraRef.current;
				const ctrl = controlsRef.current;
				console.log('CameraView', {
					position: cam.position.toArray(),
					target: ctrl.target.toArray(),
					up: cam.up.toArray(),
				});
			}
		});

		useEffect(() => {
			if (!cameraRef.current || !controlsRef.current) return;

			const cam = cameraRef.current;
			const c = controlsRef.current;

			if (lockTopView) {
				// Strict 90° top-down view for point picking.
				c.enableRotate = false;
				c.enablePan = true;
				c.enableZoom = true;
				// Do NOT constrain polar/azimuth — those force the camera to +Y regardless
				c.minPolarAngle = 0;
				c.maxPolarAngle = Math.PI;
				c.minAzimuthAngle = -Infinity;
				c.maxAzimuthAngle = Infinity;

				if (rightMeshRef.current) {
					const box = new THREE.Box3().setFromObject(rightMeshRef.current);
					const center = box.getCenter(new THREE.Vector3());
					const size = box.getSize(new THREE.Vector3());

					// After STL normalization in STLMesh (rotation.x = -PI/2),
					// plantar depth is consistently on Y and heel-to-toe is on Z.
					const footSpan = Math.max(size.x, size.z);
					const halfFovRad = THREE.MathUtils.degToRad((cam.fov || 50) / 2);
					const dist = Math.max((footSpan * 0.7) / Math.tan(halfFovRad), 120);

					cam.position.set(center.x, center.y + dist, center.z);
					cam.up.set(1, 0, 0);
					cam.lookAt(center);
					c.target.copy(center);
				} else {
					cam.position.set(50, 200, 0);
					cam.up.set(2, 0, 0);
					cam.lookAt(50, 0, 0);
					c.target.set(50, 0, 0);
				}
			} else {
				// Preferred angled view - closer to insoles
				cam.position.set(0, -60, 180);
				cam.up.set(0, 1, 0);
				cam.lookAt(0, 0, 0);
				c.enableRotate = true;
				c.enablePan = true;
				c.enableZoom = true;
				c.minPolarAngle = 0.2;
				c.maxPolarAngle = 0.9;
				c.minAzimuthAngle = -Infinity;
				c.maxAzimuthAngle = Infinity;
				c.target.set(0, 0, 0);
			}
			c.update();
			handleLogCamera();
		}, [lockTopView]);

		useEffect(() => {
			if (lockTopView) return;
			if (!cameraRef.current || !controlsRef.current) return;
			const cam = cameraRef.current;
			const c = controlsRef.current;

			// Control mode
			if (controlMode === 'pan') {
				c.enableRotate = false;
				c.enablePan = true;
				c.enableZoom = true;
			} else {
				c.enableRotate = true;
				c.enablePan = true;
				c.enableZoom = true;
			}

			// Compute a world bbox from currently visible scans
			const box = new THREE.Box3();
			let hasBox = false;
			if (showLeft && leftMeshRef.current) {
				box.union(new THREE.Box3().setFromObject(leftMeshRef.current));
				hasBox = true;
			}
			if (showRight && rightMeshRef.current) {
				box.union(new THREE.Box3().setFromObject(rightMeshRef.current));
				hasBox = true;
			}
			const center = hasBox ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);
			const size = hasBox ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(200, 200, 200);
			const span = Math.max(size.x, size.y, size.z);
			const dist = Math.max(180, span * 1.9);

			switch (effectiveViewPreset) {
				case 'top':
					cam.position.set(center.x, center.y + dist, center.z + 0.001);
					cam.up.set(0, 0, 1);
					break;
				case 'bottom':
					cam.position.set(center.x, center.y - dist, center.z - 0.001);
					cam.up.set(0, 0, 1);
					break;
				case 'front':
					cam.position.set(center.x, center.y - dist, center.z + dist * 0.35);
					cam.up.set(0, 1, 0);
					break;
				case 'back':
					cam.position.set(center.x, center.y + dist, center.z + dist * 0.35);
					cam.up.set(0, 1, 0);
					break;
				case 'left':
					cam.position.set(center.x - dist, center.y, center.z + dist * 0.25);
					cam.up.set(0, 1, 0);
					break;
				case 'right':
					cam.position.set(center.x + dist, center.y, center.z + dist * 0.25);
					cam.up.set(0, 1, 0);
					break;
				case 'iso':
				default:
					cam.position.set(center.x + dist * 0.8, center.y - dist * 0.8, center.z + dist * 0.9);
					cam.up.set(0, 1, 0);
					break;
			}

			cam.lookAt(center);
			c.target.copy(center);
			c.update();
			handleLogCamera();
		}, [
			lockTopView,
			controlMode,
			effectiveViewPreset,
			showLeft,
			showRight,
			leftGeometry,
			rightGeometry,
		]);

		// Reframe to the right foot when in top-down pick mode
		useEffect(() => {
			if (
				!lockTopView ||
				!rightGeometry ||
				!rightMeshRef.current ||
				!cameraRef.current ||
				!controlsRef.current
			)
				return;

			const box = new THREE.Box3().setFromObject(rightMeshRef.current);
			const center = box.getCenter(new THREE.Vector3());
			const size = box.getSize(new THREE.Vector3());

			const footSpan = Math.max(size.x, size.z);
			const cam = cameraRef.current;
			const halfFovRad = THREE.MathUtils.degToRad((cam.fov || 50) / 2);
			const dist = Math.max((footSpan * 0.7) / Math.tan(halfFovRad), 120);

			const c = controlsRef.current;
			cam.position.set(center.x, center.y + dist, center.z);
			cam.up.set(1, 0, 0);
			cam.lookAt(center);
			c.target.copy(center);
			c.update();
		}, [lockTopView, rightGeometry]);

		return (
			<div className="w-full h-full bg-gray-900 relative">
				<Canvas
					onPointerMissed={() => {
						if (pointPickMode) return;
						onDeselectSide?.();
					}}
				>
					<PerspectiveCamera
						ref={cameraRef}
						makeDefault
						position={[0, -60, 180]}
						fov={50}
					/>
					<ambientLight intensity={0.4} />
					<directionalLight position={[50, 50, 50]} intensity={1.5} />
					<directionalLight position={[-50, 50, -50]} intensity={1.0} />
					<directionalLight position={[0, 100, 0]} intensity={0.8} />
					<directionalLight position={[0, -50, 50]} intensity={0.6} />

					<Suspense fallback={null}>
						{!effectiveHideScans && showLeft && leftUrl && (
							<group ref={leftMeshRef}>
								<STLMesh
									url={leftUrl}
									color={leftOverlayUrl || rightOverlayUrl ? '#cfe9ff' : '#d7dadd'}
									position={[-50, 0, 0]}
									onGeometryReady={(geom, meta) => {
										setLeftGeometry(geom);
										setLeftMmToWorld(meta?.mmToWorld || 1);
									}}
									onPickPoint={(pt) => onPickPoint?.([pt.x, pt.y, pt.z])}
									pointPickMode={pointPickMode}
									showZones={showZones}
									heatmap={heatmap}
									transparentMode={transparent}
									probeEnabled={analysisEnabled}
									onProbe={(payload) => {
										const next = {
											point: payload.point.toArray() as [number, number, number],
											heightMm: payload.heightMm,
											side: payload.side,
										};
										setProbeState(next);
										onProbe?.(next);
									}}
									selected={selectedSide === 'left'}
									onSelect={onSelectSide}
									showBoxGrid={showGrid && boxEnabled.left}
									gridEditMode={gridEditMode}
									corrections={corrections}
									activeCorrections={activeCorrections}
									textPlacementEnabled={textPlacementEnabled}
									textPlacementText={textPlacementText}
									onTextPlace={onTextPlace}
									side="left"
								/>
							</group>
						)}
						{!effectiveHideScans && showRight && rightUrl && (
							<group ref={rightMeshRef}>
								<STLMesh
									url={rightUrl}
									color={leftOverlayUrl || rightOverlayUrl ? '#cfe9ff' : '#d7dadd'}
									position={[50, 0, 0]}
									onGeometryReady={(geom, meta) => {
										setRightGeometry(geom);
										setRightMmToWorld(meta?.mmToWorld || 1);
										if (onRightBBox) {
											const posAttr = geom.getAttribute(
												'position'
											) as THREE.BufferAttribute;
											const box = new THREE.Box3().setFromBufferAttribute(
												posAttr
											);
											onRightBBox(box);
										}
									}}
									onPickPoint={(pt) => onPickPoint?.([pt.x, pt.y, pt.z])}
									pointPickMode={pointPickMode}
									showZones={showZones}
									heatmap={heatmap}
									transparentMode={transparent}
									probeEnabled={analysisEnabled}
									onProbe={(payload) => {
										const next = {
											point: payload.point.toArray() as [number, number, number],
											heightMm: payload.heightMm,
											side: payload.side,
										};
										setProbeState(next);
										onProbe?.(next);
									}}
									selected={selectedSide === 'right'}
									onSelect={onSelectSide}
									showBoxGrid={showGrid && boxEnabled.right}
									gridEditMode={gridEditMode}
									corrections={corrections}
									activeCorrections={activeCorrections}
									textPlacementEnabled={textPlacementEnabled}
									textPlacementText={textPlacementText}
									onTextPlace={onTextPlace}
									side="right"
								/>
							</group>
						)}

						{/* Scan overlays (non-interactive) shown on top of base insoles */}
						{!effectiveHideScans && showLeft && leftOverlayUrl && (
							<group>
								<STLMesh
									url={leftOverlayUrl}
									color="#d9b5a1"
									position={[-50, 0, 0.25]}
									interactive={false}
									rotationOffset={[Math.PI, 0, Math.PI]}
									transparentMode={true}
									opacity={0.72}
									showZones={false}
									heatmap={false}
									pointPickMode={false}
									side="left"
								/>
							</group>
						)}
						{!effectiveHideScans && showRight && rightOverlayUrl && (
							<group>
								<STLMesh
									url={rightOverlayUrl}
									color="#d9b5a1"
									position={[50, 0, 0.25]}
									interactive={false}
									rotationOffset={[Math.PI, 0, Math.PI]}
									transparentMode={true}
									opacity={0.72}
									showZones={false}
									heatmap={false}
									pointPickMode={false}
									side="right"
								/>
							</group>
						)}

						{/* Base template preview when requested */}
						{showBasePreview && (
							<group>
								<BaseInsolePreview position={[-80, 0, 0]} />
								<BaseInsolePreview position={[80, 0, 0]} />
							</group>
						)}
						{/* Precision insole (from 3-point pipeline) or legacy generated insole */}
						{precisionInsole && (
							<mesh geometry={precisionInsole} position={[50, 0, 0.6]}>
								<meshStandardMaterial
									color="#6ee7b7"
									opacity={0.55}
									transparent
									roughness={0.35}
									metalness={0.05}
								/>
							</mesh>
						)}
						{effectiveShowGeneratedInsole && generatedInsole && !precisionInsole && (
							<mesh geometry={generatedInsole} position={[50, 0, 0.6]}>
								<meshStandardMaterial
									color="#6ee7b7"
									opacity={0.55}
									transparent
									roughness={0.35}
									metalness={0.05}
								/>
							</mesh>
						)}
					</Suspense>

					{textAnnotations
						.filter((a) => {
							if (a.side === 'left' && !showLeft) return false;
							if (a.side === 'right' && !showRight) return false;
							return true;
						})
						.map((a) => {
							const mmToWorld = a.side === 'left' ? leftMmToWorld : rightMmToWorld;
							const sizeMm = Number.isFinite(a.sizeMm) ? a.sizeMm : textPlacementSizeMm;
							const sizeWorld = Math.max(0.5, Math.max(1, sizeMm) * (mmToWorld || 1));
							const normal = new THREE.Vector3(a.normal[0], a.normal[1], a.normal[2]).normalize();
							const pos = new THREE.Vector3(a.position[0], a.position[1], a.position[2]).addScaledVector(
								normal,
								0.2 * (mmToWorld || 1)
							);
							const q = new THREE.Quaternion().setFromUnitVectors(
								new THREE.Vector3(0, 0, 1),
								normal
							);

							return (
								<group key={a.id} position={[pos.x, pos.y, pos.z]} quaternion={q}>
									<Text
										fontSize={sizeWorld}
										color="#d7dadd"
										anchorX="center"
										anchorY="middle"
										outlineWidth={0.02 * sizeWorld}
										outlineColor="#0b1220"
										material-toneMapped={false}
										material-side={THREE.DoubleSide}
										material-depthTest={false}
										renderOrder={999}
									>
										{a.text}
									</Text>
								</group>
							);
						})}

					{bottomTextOverlay?.enabled && bottomTextOverlay.text.trim() && (
						<>
							{([
								{ side: 'left' as const, visible: showLeft, ref: leftMeshRef, mmToWorld: leftMmToWorld },
								{ side: 'right' as const, visible: showRight, ref: rightMeshRef, mmToWorld: rightMmToWorld },
							] as const)
								.filter((s) => s.visible && s.ref.current)
								.map((s) => {
									const box = new THREE.Box3().setFromObject(s.ref.current!);
									const center = box.getCenter(new THREE.Vector3());
									const size = box.getSize(new THREE.Vector3());
									const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
									const sizes = { x: size.x, y: size.y, z: size.z };
									axes.sort((a, b) => sizes[a] - sizes[b]);
									const thicknessAxis = axes[0];
									const widthAxis = axes[1];
									const lengthAxis = axes[2];
									const minThickness =
										thicknessAxis === 'x'
											? box.min.x
											: thicknessAxis === 'y'
												? box.min.y
												: box.min.z;
									const mmToWorld = s.mmToWorld || 1;
									const sizeWorld = Math.max(0.5, Math.max(1, bottomTextOverlay.sizeMm) * mmToWorld);
									const normal =
										thicknessAxis === 'x'
											? new THREE.Vector3(-1, 0, 0)
											: thicknessAxis === 'y'
												? new THREE.Vector3(0, -1, 0)
												: new THREE.Vector3(0, 0, -1);
									const orientation = bottomTextOverlay.orientation ?? 'vertical';
									const baselineAxis = orientation === 'vertical' ? lengthAxis : widthAxis;
									const baselineDir =
										baselineAxis === 'x'
											? new THREE.Vector3(1, 0, 0)
											: baselineAxis === 'y'
												? new THREE.Vector3(0, 1, 0)
												: new THREE.Vector3(0, 0, 1);
									// Build a stable basis: X = baseline direction projected onto the plane, Z = normal.
									const zAxis = normal.clone().normalize();
									const xAxis = baselineDir
										.clone()
										.sub(zAxis.clone().multiplyScalar(baselineDir.dot(zAxis)))
										.normalize();
									const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
									const fixedXAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
									const basis = new THREE.Matrix4().makeBasis(fixedXAxis, yAxis, zAxis);
									const q = new THREE.Quaternion().setFromRotationMatrix(basis);
									const pos = center.clone();
									const offset = 0.3 * mmToWorld;
									if (thicknessAxis === 'x') pos.x = minThickness - offset;
									else if (thicknessAxis === 'y') pos.y = minThickness - offset;
									else pos.z = minThickness - offset;
									const displayText = bottomTextOverlay.text;

									return (
										<group
											key={`bottom-text-${s.side}`}
											position={[pos.x, pos.y, pos.z]}
											quaternion={q}
										>
											<Text
												fontSize={sizeWorld}
												color={bottomTextOverlay.color ?? '#d7dadd'}
												anchorX="center"
												anchorY="middle"
												outlineWidth={0.025 * sizeWorld}
												outlineColor="#0b1220"
												material-toneMapped={false}
												material-side={THREE.DoubleSide}
												material-depthTest={false}
												renderOrder={1000}
											>
												{displayText}
											</Text>
										</group>
									);
								})}
						</>
					)}

					{analysisEnabled && probeState && (
						<mesh position={probeState.point}>
							<sphereGeometry args={[2.2, 18, 18]} />
							<meshStandardMaterial
								color="#111827"
								emissive="#56f2d6"
								emissiveIntensity={0.55}
							/>
						</mesh>
					)}

					{pointPickMode &&
						pickedPoints?.map((pt, idx) => {
							// Professional X marker (cross shape) like orthopedic competitor software
							const markerSize = 4;
							const markerThickness = 0.8;
							return (
								<group key={`${pt.join('-')}-${idx}`} position={pt}>
									{/* Horizontal bar of X */}
									<mesh rotation={[0, 0, Math.PI / 4]}>
										<boxGeometry args={[markerSize, markerThickness, markerThickness]} />
										<meshStandardMaterial
											color="#111827"
											emissive="#000000"
											emissiveIntensity={0.2}
										/>
									</mesh>
									{/* Vertical bar of X */}
									<mesh rotation={[0, 0, -Math.PI / 4]}>
										<boxGeometry args={[markerSize, markerThickness, markerThickness]} />
										<meshStandardMaterial
											color="#111827"
											emissive="#000000"
											emissiveIntensity={0.2}
										/>
									</mesh>
									{/* Small center dot */}
									<mesh>
										<sphereGeometry args={[0.6, 12, 12]} />
										<meshStandardMaterial
											color="#111827"
											emissive="#10b981"
											emissiveIntensity={0.5}
										/>
									</mesh>
								</group>
							);
						})}

					<OrbitControls
						ref={controlsRef}
						enablePan={true}
						enableZoom={true}
						enableRotate={!lockTopView}
						minDistance={50}
						maxDistance={500}
						minPolarAngle={lockTopView ? 0 : Math.PI / 4}
						maxPolarAngle={lockTopView ? 0 : Math.PI / 2}
						minAzimuthAngle={lockTopView ? 0 : undefined}
						maxAzimuthAngle={lockTopView ? 0 : undefined}
					/>
				</Canvas>
			</div>
		);
	}
);

EnhancedSTLViewer.displayName = 'EnhancedSTLViewer';

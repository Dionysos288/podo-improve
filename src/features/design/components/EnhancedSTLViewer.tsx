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
	useLayoutEffect,
	memo,
} from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Text } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
// Note: Full THREE import needed for react-three-fiber compatibility
import { useDesignStore } from '@/src/shared/core/store/designStore';
import {
	buildBasicInsole,
	type LandmarkPoints,
} from '@/src/features/design/utils/landmarkFitting';
import {
	engraveTextIntoInsole,
	loadEngravingFont,
	validateEngravedGeometry,
} from '@/src/features/design/utils/bottomTextEngraving';
import { applyAllCorrections } from '@/src/features/design/utils/insoleCorrections';
import type { OntwerpCorrections } from '@/src/shared/components/design/OntwerpPanel';
import type { CorrectionKey } from '@/src/shared/components/design/correctionsCatalog';
import type { PlacedElement } from '@/src/features/design/elements/types';
import { applyElements, applyElementColors, buildElementOverlayGeometries, DIEPELEMENTEN_ITEMS, ELEMENTEN_ITEMS, getElementByKey, getElementPreferredStlUrl, getElementStlLoadUrls, type ElementOverlayData } from '@/src/features/design/elements';
import { VIEWER_MATERIALS } from '@/src/features/design/viewer/viewerMaterialProfile';
import {
	getScanOverlayMaterialProps,
	INSOLE_SCAN_DEPTH_PREPASS_RENDER_ORDER,
	SCAN_OVERLAY_RENDER_ORDER,
	type ScanOverlayViewerMode,
} from '@/src/features/design/viewer/scanOverlayRender';
import { tessellateAndWeldGeometry } from '@/src/features/design/viewer/smoothOverlayGeometry';
import { applyTrimlineRimSilhouette } from '@/src/features/design/viewer/trimlineRimSilhouette';
import { applyElementTrimlineFootprint } from '@/src/features/design/viewer/elementTrimlineFootprint';
import { ViewerPostFX } from '@/src/features/design/viewer/ViewerPostFX';
import type { PrintZoneId } from '@/src/features/design/print/printZones';
import { resolvePrintZoneFromLocalPoint } from '@/src/features/design/print/printZones';
import {
	applyPrintSplitZoneColors,
	removePrintPrepAttributes,
} from '@/src/features/design/print/printZoneVisuals';
import {
	getViewerPerfSnapshot,
	recordFinalGeometryRebuild,
	recordOverlayRebuild,
} from '@/src/features/design/perf/viewerPerfTelemetry';
import type {
	TrimlineAdjustments,
	TrimlineHandleProfile,
} from '@/src/shared/components/design/TrimlineEditOverlay';
import { InteractiveTrimline } from './InteractiveTrimline';
import { InteractiveScanRotate } from './InteractiveScanRotate';
import { SideInspectionLayers } from './SideInspectionLayers';
import { ScanInsoleUpAxisSampler } from './ScanInsoleUpAxisSampler';
import { composeOverlayManualYawMatrix } from '@/src/features/design/utils/scanManualAlignment';
import {
	computeOverlayTopSurfaceAlignOffset,
	DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
	DEFAULT_SINK_BIAS_MM,
} from '@/src/features/design/utils/scanOverlayAlignment';
import type { ScanManualAlignment } from '@/src/features/design/types/types';
import type { LatticeEditKit } from './boxLatticeTypes';
import type { LatticeOffsetVec, BoxGridSavedOffsets } from '@/src/features/design/types/boxGrid';
import {
	BOX_GRID_COLS,
	BOX_GRID_ROWS,
	BOX_GRID_LAYERS,
	ELEMENT_BOX_GRID_LAYERS,
	ELEMENT_BOX_HEIGHT_PAD_ABOVE_MM,
	ELEMENT_BOX_HEIGHT_PAD_BELOW_MM,
	ELEMENT_BOX_HANDLE_SINK_BELOW_SURFACE_MM,
	latticeVecsToSavePayload,
	normalizeSavedOffsets,
} from '@/src/features/design/types/boxGrid';
import {
	BoxLatticeEditor,
} from './BoxLatticeEditor';
import { buildLattice } from '@/src/features/design/utils/boxLattice';
import {
	precomputeVertexInfluences,
	applyLatticeDeformation,
} from '@/src/features/design/utils/boxDeformation';

interface STLMeshProps {
	url: string;
	color?: string;
	position?: [number, number, number];
	meshRole?: 'scan' | 'overlayScan' | 'insole';
	viewerOverlayMode?: ScanOverlayViewerMode;
	flipLongAxis?: boolean;
	targetForefootWidthMm?: number;
	targetTrimlineProfile?: TrimlineProfile | null;
	trimlineOffsetMm?: number;
	trimlineAdjustments?: TrimlineAdjustments;
	trimlineHandleProfile?: TrimlineHandleProfile | null;
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
	clampDebug?: boolean;
	deviationMap?: boolean;
	transparentMode?: boolean;
	/** Links/Rechts technical profile overlay + inspection opacity */
	sideInspectionActive?: boolean;
	sideInspectionView?: 'left' | 'right';
	probeEnabled?: boolean;
	onProbe?: (payload: {
		point: THREE.Vector3;
		heightMm: number;
		side: 'left' | 'right';
	}) => void;
	selected?: boolean;
	onSelect?: (side: 'left' | 'right') => void;
	onZoneClick?: (zone: 'front' | 'middle' | 'back', side: 'left' | 'right') => void;
	showBoxGrid?: boolean;
	corrections?: OntwerpCorrections;
	activeCorrections?: CorrectionKey[];
	side?: 'left' | 'right';
	gridEditMode?: boolean;
	heelEdgeThicknessMm?: number;
	savedBoxGridOffsets?: BoxGridSavedOffsets | null;
	onBoxGridSave?: (offsets: BoxGridSavedOffsets) => void;
	textPlacementEnabled?: boolean;
	textPlacementText?: string;
	bottomTextOverlay?: BottomTextOverlay;
	onBottomTextLoadingChange?: (payload: {
		side: 'left' | 'right';
		isLoading: boolean;
	}) => void;
	onBottomTextValidityChange?: (payload: {
		side: 'left' | 'right';
		ok: boolean;
		reason?: string;
	}) => void;
	onTextPlace?: (payload: {
		side: 'left' | 'right';
		point: [number, number, number];
		normal: [number, number, number];
	}) => void;
	placedElements?: PlacedElement[];
	elementPlacementMode?: { elementId: string; side: 'left' | 'right' } | null;
	onElementPlace?: (payload: { side: 'left' | 'right'; u: number; v: number }) => void;
	selectedElementTrimlineEdit?: {
		elementId: string;
		side: 'left' | 'right';
		profile: TrimlineHandleProfile | null;
	} | null;
	selectedElementBoxEdit?: {
		elementId: string;
		side: 'left' | 'right';
		savedOffsets: BoxGridSavedOffsets | null;
	} | null;
	onPendingElementTrimlineProfileChange?: (profile: TrimlineHandleProfile) => void;
	onElementBoxGridSave?: (offsets: BoxGridSavedOffsets) => void;
	onTrimDragActiveChange?: (active: boolean) => void;
	/** When true, render a solid rectangular block around the insole (EVA milling mode) */
	evaBlockMode?: boolean;
	/** Print prep: subtle split zones — only meaningful on `meshRole==="insole"` */
	printPrepSplit?: boolean;
	printPrepSelectedZone?: PrintZoneId | null;
	printPrepHoveredZone?: PrintZoneId | null;
	onPrintPrepZoneHover?: (zone: PrintZoneId | null, side: 'left' | 'right') => void;
	printPrepWhole?: boolean;
	onPrintWholeInsoleClick?: (side: 'left' | 'right') => void;
	onPrintElementClick?: (elementId: string, side: 'left' | 'right') => void;
	printSelectedElementId?: string | null;
	/** When true (print prep), selected/hovered elements use highlight emissive; design uses base color only. */
	printElementSelectionHighlight?: boolean;
}

function getAxisValueFromVector(v: THREE.Vector3, axis: 'x' | 'y' | 'z') {
	return axis === 'x' ? v.x : axis === 'y' ? v.y : v.z;
}

function getInsoleUvFromLocalPoint(geometry: THREE.BufferGeometry, localPoint: THREE.Vector3) {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const sizeX = bbox.max.x - bbox.min.x;
	const sizeY = bbox.max.y - bbox.min.y;
	const sizeZ = bbox.max.z - bbox.min.z;
	const sizes = [
		{ axis: 'x' as const, size: sizeX },
		{ axis: 'y' as const, size: sizeY },
		{ axis: 'z' as const, size: sizeZ },
	].sort((a, b) => b.size - a.size);
	const lengthAxis = sizes[0].axis;
	const widthAxis = sizes[1].axis;
	const lengthMin = getAxisValueFromVector(bbox.min, lengthAxis);
	const lengthMax = getAxisValueFromVector(bbox.max, lengthAxis);
	const widthMin = getAxisValueFromVector(bbox.min, widthAxis);
	const widthMax = getAxisValueFromVector(bbox.max, widthAxis);
	const lengthSpan = Math.max(1e-6, lengthMax - lengthMin);
	const widthSpan = Math.max(1e-6, widthMax - widthMin);
	const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
	let minEnd = Infinity;
	let maxEnd = Infinity;
	for (let i = 0; i < positions.count; i++) {
		const lenVal = lengthAxis === 'x' ? positions.getX(i) : lengthAxis === 'y' ? positions.getY(i) : positions.getZ(i);
		const widthVal = widthAxis === 'x' ? positions.getX(i) : widthAxis === 'y' ? positions.getY(i) : positions.getZ(i);
		const distMin = Math.abs(lenVal - lengthMin);
		const distMax = Math.abs(lenVal - lengthMax);
		if (distMin <= lengthSpan * 0.03) minEnd = Math.min(minEnd, widthVal);
		if (distMax <= lengthSpan * 0.03) maxEnd = Math.min(maxEnd, widthVal);
	}
	const heelAtMin = minEnd <= maxEnd;
	const rawU = (getAxisValueFromVector(localPoint, lengthAxis) - lengthMin) / lengthSpan;
	return {
		u: Math.max(0, Math.min(1, heelAtMin ? rawU : 1 - rawU)),
		v: Math.max(0, Math.min(1, (getAxisValueFromVector(localPoint, widthAxis) - widthMin) / widthSpan)),
	};
}

function formatSignatureNumber(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return '';
	return value.toFixed(4);
}

function getBoxGridOffsetsSignature(offsets: BoxGridSavedOffsets | null | undefined): string {
	if (!offsets) return '';
	const parts = offsets.offsets.map((value) => {
		if (typeof value === 'number') return formatSignatureNumber(value);
		const v = value as { du?: number; dv?: number; dh?: number };
		return [formatSignatureNumber(v.du), formatSignatureNumber(v.dv), formatSignatureNumber(v.dh)].join(
			'/',
		);
	});
	return `${offsets.cols}x${offsets.rows}x${offsets.layers ?? 1}v${offsets.version ?? 1}:${parts.join(',')}`;
}

function getBottomTextOverlaySignature(overlay: BottomTextOverlay | null | undefined): string {
	if (!overlay) return '';
	return [
		overlay.enabled ? '1' : '0',
		overlay.text,
		formatSignatureNumber(overlay.sizeMm),
		formatSignatureNumber(overlay.depthMm),
		overlay.orientation ?? '',
		overlay.color ?? '',
	].join('|');
}

function getSelectedElementBoxEditSignature(edit: STLMeshProps['selectedElementBoxEdit']): string {
	if (!edit) return '';
	return [edit.elementId, edit.side, getBoxGridOffsetsSignature(edit.savedOffsets)].join('|');
}

function getPlacedElementsSignature(elements: PlacedElement[] | undefined): string {
	if (!elements || elements.length === 0) return '';
	return elements
		.map((element) =>
			[
				element.id,
				element.libraryKey,
				element.side,
				element.profile,
				formatSignatureNumber(element.heightMm),
				formatSignatureNumber(element.blendMm),
				formatSignatureNumber(element.trimOffsetMm),
				element.floorMode,
				String(element.stackOrder ?? 0),
				element.split ? '1' : '0',
				formatSignatureNumber(element.positionU),
				formatSignatureNumber(element.positionV),
				formatSignatureNumber(element.rotationRad),
				formatSignatureNumber(element.scaleU),
				formatSignatureNumber(element.scaleV),
				JSON.stringify(element.trimlineAdjustments ?? null),
				JSON.stringify(element.trimlineHandleProfile ?? null),
				getBoxGridOffsetsSignature(element.boxGridOffsets),
			].join('|')
		)
		.join('||');
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
	depthMm: number;
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

// Global viewer scale so ALL STLs keep real relative dimensions.
// Source STLs are expected in millimeters.
const MM_TO_WORLD = 0.4;
const SCAN_OVERLAY_LATERAL_WORLD = { left: -30, right: 30 } as const;
const DEFAULT_VEC3: [number, number, number] = [0, 0, 0];
const EMPTY_TEXT_ANNOTATIONS: TextAnnotation[] = [];
const EMPTY_PICKED_POINTS: [number, number, number][] = [];
const DEFAULT_BOX_ENABLED = { left: false, right: false };
const DEFAULT_HEEL_EDGE_THICKNESS = { left: 1, right: 1 };

function copyGeometryPositionsFast(target: THREE.BufferGeometry, source: THREE.BufferGeometry) {
	const srcPos = source.getAttribute('position') as THREE.BufferAttribute | undefined;
	const dstPos = target.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!srcPos || !dstPos) return;
	if (srcPos.count === dstPos.count) {
		(dstPos.array as Float32Array).set(srcPos.array as Float32Array);
		dstPos.needsUpdate = true;
		return;
	}
	target.setAttribute('position', srcPos.clone());
	if (source.index) target.setIndex(source.index.clone());
	else target.setIndex(null);
	if (source.getAttribute('normal')) {
		target.setAttribute('normal', source.getAttribute('normal')!.clone());
	}
}

function copyGeometryAttributes(target: THREE.BufferGeometry, source: THREE.BufferGeometry) {
	const srcPos = source.getAttribute('position') as THREE.BufferAttribute | undefined;
	const dstPos = target.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (srcPos && dstPos && srcPos.count === dstPos.count) {
		(dstPos.array as Float32Array).set(srcPos.array as Float32Array);
		dstPos.needsUpdate = true;
		target.computeVertexNormals();
		target.computeBoundingBox();
		target.computeBoundingSphere();
		return;
	}
	target.setAttribute('position', source.getAttribute('position')!.clone());
	if (source.index) target.setIndex(source.index.clone());
	else target.setIndex(null);
	if (source.getAttribute('normal')) {
		target.setAttribute('normal', source.getAttribute('normal')!.clone());
	}
	target.computeVertexNormals();
	target.computeBoundingBox();
	target.computeBoundingSphere();
}

function restoreGeometryPositions(
	geometry: THREE.BufferGeometry,
	basePositions: Float32Array,
) {
	const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!position) return;
	const array = position.array as Float32Array;
	if (array.length !== basePositions.length) return;
	array.set(basePositions);
	position.needsUpdate = true;
}

function createTessellatedBoxBaseGeometry(
	baseGeometry: THREE.BufferGeometry,
	mmToWorld: number,
): THREE.BufferGeometry {
	return tessellateAndWeldGeometry(baseGeometry, mmToWorld);
}

function boxOffsetsAreNontrivial(offsets: BoxGridSavedOffsets | null | undefined) {
	if (!offsets) return false;
	return offsets.offsets.some((entry) =>
		typeof entry === 'number'
			? Math.abs(entry) > 1e-3
			: Math.abs(entry.du ?? 0) > 1e-3 ||
			Math.abs(entry.dv ?? 0) > 1e-3 ||
			Math.abs(entry.dh ?? 0) > 1e-3,
	);
}

function applySavedBoxGridOffsetsToGeometry(
	geometry: THREE.BufferGeometry,
	offsets: BoxGridSavedOffsets | null | undefined,
	mmToWorld: number,
) {
	if (!boxOffsetsAreNontrivial(offsets)) {
		return geometry;
	}
	let finalGeometry = geometry;
	const posA = finalGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (posA && posA.count < 500000) {
		const welded = tessellateAndWeldGeometry(finalGeometry, mmToWorld);
		if (welded !== finalGeometry) {
			if (finalGeometry !== geometry) finalGeometry.dispose();
			finalGeometry = welded;
		}
	}
	const cols = offsets!.cols;
	const rows = offsets!.rows;
	const layers = Math.max(1, offsets!.layers ?? BOX_GRID_LAYERS);
	const built = buildLattice(finalGeometry, cols, rows, layers, mmToWorld);
	if (!built) return finalGeometry;
	const inf = precomputeVertexInfluences(
		finalGeometry,
		built.frame,
		cols,
		rows,
		layers,
		built.nodes,
	);
	if (!inf) return finalGeometry;
	const vecs = normalizeSavedOffsets(offsets!, layers);
	const need = cols * rows * layers;
	while (vecs.length < need) {
		vecs.push({ du: 0, dv: 0, dh: 0 });
	}
	const posAttr = finalGeometry.getAttribute('position') as THREE.BufferAttribute;
	const arr = posAttr.array as Float32Array;
	const base = new Float32Array(arr);
	applyLatticeDeformation(arr, base, vecs, inf, built.frame, mmToWorld);
	posAttr.needsUpdate = true;
	finalGeometry.computeVertexNormals();
	finalGeometry.computeBoundingBox();
	finalGeometry.computeBoundingSphere();
	return finalGeometry;
}

// Smooth interpolation for zone boundaries
function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

function trimlineHeightOffsetsNeedApply(profile: TrimlineHandleProfile): boolean {
	const { bins } = profile;
	const r = profile.rightHeightOffsetsMm;
	const l = profile.leftHeightOffsetsMm;
	const rl = r?.length ?? 0;
	const ll = l?.length ?? 0;
	for (let i = 0; i < bins; i++) {
		const rv = rl === bins ? r![i]! : 0;
		const lv = ll === bins ? l![i]! : 0;
		if (Math.abs(rv) > 1e-9 || Math.abs(lv) > 1e-9) return true;
	}
	return false;
}


function applyGeometryTotalHeight(
	geom: THREE.BufferGeometry,
	targetHeightMm: number | null | undefined,
	mmToWorld: number
) {
	if (typeof targetHeightMm !== 'number' || !Number.isFinite(targetHeightMm) || targetHeightMm <= 0) {
		return;
	}
	const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!posAttr) return;
	geom.computeBoundingBox();
	const bbox = geom.boundingBox;
	if (!bbox) return;
	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	const heightAxis = axes[0];
	const minH = heightAxis === 'x' ? bbox.min.x : heightAxis === 'y' ? bbox.min.y : bbox.min.z;
	const maxH = heightAxis === 'x' ? bbox.max.x : heightAxis === 'y' ? bbox.max.y : bbox.max.z;
	const currentHeightWorld = Math.max(1e-6, maxH - minH);
	const targetHeightWorld = targetHeightMm * mmToWorld;
	if (!Number.isFinite(targetHeightWorld) || targetHeightWorld <= 0) return;
	const heightScale = targetHeightWorld / currentHeightWorld;
	if (!Number.isFinite(heightScale) || Math.abs(heightScale - 1) < 1e-6) return;

	for (let i = 0; i < posAttr.count; i++) {
		const hVal =
			heightAxis === 'x'
				? posAttr.getX(i)
				: heightAxis === 'y'
					? posAttr.getY(i)
					: posAttr.getZ(i);
		const nextH = minH + (hVal - minH) * heightScale;
		if (heightAxis === 'x') posAttr.setX(i, nextH);
		else if (heightAxis === 'y') posAttr.setY(i, nextH);
		else posAttr.setZ(i, nextH);
	}
	posAttr.needsUpdate = true;
}

function applyHeelEdgeThicknessBand(
	geom: THREE.BufferGeometry,
	heelEdgeThicknessMm: number | null | undefined,
	mmToWorld: number,
	_side: 'left' | 'right' = 'right'
) {
	const targetMm = typeof heelEdgeThicknessMm === 'number' && Number.isFinite(heelEdgeThicknessMm)
		? Math.max(0, heelEdgeThicknessMm)
		: 1;
	// Default baseline is 1mm — values above thicken outward, below thin inward
	const baselineMm = 1;
	const deltaMm = targetMm - baselineMm;
	if (Math.abs(deltaMm) < 0.01) return;

	const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!posAttr) return;

	// Compute smooth vertex normals BEFORE modification — these tell us which
	// vertices are on side walls (normal ≈ horizontal) vs top/bottom surfaces
	// (normal ≈ vertical).
	geom.computeVertexNormals();
	const normalAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined;
	if (!normalAttr) return;

	geom.computeBoundingBox();
	const bbox = geom.boundingBox;
	if (!bbox) return;

	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	const heightAxis = axes[0]; // thinnest = height
	// widthAxis = axes[1], lengthAxis = axes[2] — not needed individually

	// Helper to read the height-axis component of the normal
	const normalH = (i: number) =>
		heightAxis === 'x' ? normalAttr.getX(i) : heightAxis === 'y' ? normalAttr.getY(i) : normalAttr.getZ(i);

	const pushWorld = deltaMm * Math.max(1e-6, mmToWorld);

	const smoothstep01 = (edge0: number, edge1: number, x: number) => {
		const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
		return t * t * (3 - 2 * t);
	};

	for (let i = 0; i < posAttr.count; i++) {
		const nx = normalAttr.getX(i);
		const ny = normalAttr.getY(i);
		const nz = normalAttr.getZ(i);

		// Decompose normal into vertical (height) and horizontal components
		const nH = normalH(i);                                     // vertical component
		const horizSq = nx * nx + ny * ny + nz * nz - nH * nH;    // horizontal² (avoids sqrt for test)
		const horizMag = Math.sqrt(Math.max(0, horizSq));

		// wallWeight: 1.0 for pure side-wall vertices (normal fully horizontal),
		// 0.0 for flat top/bottom surfaces (normal fully vertical).
		// Smooth ramp between 0.25 and 0.7 so the transition is gradual.
		const wallWeight = smoothstep01(0.25, 0.7, horizMag);
		if (wallWeight < 0.001) continue;

		// Horizontal push direction: the horizontal part of the vertex normal,
		// normalized.  This ensures every wall vertex pushes perpendicular to
		// the wall surface → uniform thickening that follows the insole contour.
		if (horizMag < 1e-6) continue;
		const invH = 1 / horizMag;
		// Subtract the height-axis contribution to get horizontal-only direction
		let dX = nx, dY = ny, dZ = nz;
		if (heightAxis === 'x') dX = 0;
		else if (heightAxis === 'y') dY = 0;
		else dZ = 0;
		const dLen = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
		if (dLen < 1e-6) continue;
		dX /= dLen;
		dY /= dLen;
		dZ /= dLen;

		const push = pushWorld * wallWeight;
		posAttr.setXYZ(
			i,
			posAttr.getX(i) + push * dX,
			posAttr.getY(i) + push * dY,
			posAttr.getZ(i) + push * dZ,
		);
	}

	posAttr.needsUpdate = true;
	geom.computeVertexNormals();
	geom.computeBoundingBox();
	geom.computeBoundingSphere();
}

/**
 * Detect and fill interior holes in an indexed mesh.
 *
 * After `mergeVertices` every open edge belongs to exactly one face (its
 * reverse half-edge is absent).  We walk those boundary half-edges into
 * closed loops, skip the largest loop (the outer insole perimeter), then
 * fan-triangulate every smaller loop from its centroid so the mesh becomes
 * one watertight piece with no visible seam.
 *
 * Winding correctness:  for a CCW-wound mesh (outward normals) interior
 * holes have their boundary half-edges traversed *clockwise* when viewed
 * from outside.  Using (centIdx, a, b) for each directed edge a→b in that
 * CW traversal always produces a CCW-wound (outward-facing) fill triangle.
 */
function fillMeshHoles(
	geometry: THREE.BufferGeometry,
	maxHoleEdges = 3000,
	fillAll = false,
): THREE.BufferGeometry {
	if (!geometry.index) return geometry;

	const idx = geometry.index.array as Uint16Array | Uint32Array;
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
	if (!posAttr) return geometry;

	const faceCount = idx.length / 3;
	const vertCount = posAttr.count;
	const positions = posAttr.array as Float32Array;

	// ── Build directed half-edge set ──────────────────────────────────────
	// Encode directed edge (a→b) as a * vertCount + b  (safe up to ~3M verts).
	const dirEdges = new Set<number>();
	for (let f = 0; f < faceCount; f++) {
		const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
		dirEdges.add(a * vertCount + b);
		dirEdges.add(b * vertCount + c);
		dirEdges.add(c * vertCount + a);
	}

	// ── Boundary next-vertex map ──────────────────────────────────────────
	// A directed edge (a→b) is a boundary half-edge if (b→a) is absent.
	// `boundaryNext` maps a → b for each such half-edge.
	const boundaryNext = new Map<number, number>();
	for (let f = 0; f < faceCount; f++) {
		const verts = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]];
		for (let e = 0; e < 3; e++) {
			const a = verts[e], b = verts[(e + 1) % 3];
			if (!dirEdges.has(b * vertCount + a)) {
				boundaryNext.set(a, b);
			}
		}
	}

	if (boundaryNext.size === 0) return geometry; // Watertight – nothing to do.

	// ── Walk boundary loops ───────────────────────────────────────────────
	const visitedV = new Set<number>();
	const loops: number[][] = [];

	for (const [startV] of boundaryNext) {
		if (visitedV.has(startV)) continue;
		const loop: number[] = [];
		let cur = startV;
		let guard = boundaryNext.size + 1;
		while (guard-- > 0) {
			if (visitedV.has(cur)) break;
			loop.push(cur);
			visitedV.add(cur);
			const nxt = boundaryNext.get(cur);
			if (nxt === undefined || nxt === startV) break;
			cur = nxt;
		}
		if (loop.length >= 3) loops.push(loop);
	}

	if (loops.length === 0) return geometry;

	// ── Determine which loops to fill ────────────────────────────────────
	// Sort descending by edge-count so the outer perimeter comes first.
	loops.sort((a, b) => b.length - a.length);

	// When fillAll is true (e.g. for slicer export), close EVERY boundary
	// including the outer insole perimeter so the mesh is fully watertight.
	// Otherwise skip the largest loop (outer perimeter) and only fill
	// interior holes smaller than maxHoleEdges.
	const loopsToFill = fillAll
		? loops
		: loops.slice(1).filter(l => l.length <= maxHoleEdges);

	if (loopsToFill.length === 0) return geometry;

	// ── Fan-triangulate each hole from its centroid ───────────────────────
	const newIndices = Array.from(idx);
	const extraPositions: number[] = [];
	const baseVertCount = posAttr.count;

	for (const loop of loopsToFill) {
		let cx = 0, cy = 0, cz = 0;
		for (const v of loop) {
			cx += positions[v * 3];
			cy += positions[v * 3 + 1];
			cz += positions[v * 3 + 2];
		}
		cx /= loop.length;
		cy /= loop.length;
		cz /= loop.length;

		const centIdx = baseVertCount + extraPositions.length / 3;
		extraPositions.push(cx, cy, cz);

		// (centIdx, a, b) for directed boundary edge a→b gives the correct
		// outward-facing winding (verified for both interior and perimeter loops).
		for (let i = 0; i < loop.length; i++) {
			const a = loop[i];
			const b = loop[(i + 1) % loop.length];
			newIndices.push(centIdx, a, b);
		}
	}

	if (extraPositions.length === 0) return geometry;

	// ── Rebuild geometry ─────────────────────────────────────────────────
	const combinedPos = new Float32Array(positions.length + extraPositions.length);
	combinedPos.set(positions);
	combinedPos.set(extraPositions, positions.length);

	const filled = new THREE.BufferGeometry();
	filled.setAttribute('position', new THREE.BufferAttribute(combinedPos, 3));
	filled.setIndex(newIndices);
	geometry.dispose();
	return filled;
}

/**
 * Weld duplicate vertices, then smooth sharp crease edges so the insole
 * renders as one continuous piece.
 *
 * Podiatry-CAD insole STLs often have sharp crease edges (>90°) where the
 * flat top surface meets the side wall/rim.  When Three.js computes smooth
 * vertex normals, the averaged normals at these creases create visible dark
 * lines that make the insole look like separate pieces.
 *
 * We fix this with:
 *  1. `mergeVertices` to share edges → smooth normals across faces
 *  2. `fillMeshHoles` to close any open-boundary seams in one piece
 *  3. Laplacian position smoothing at crease-edge vertices to physically
 *     round the sharp junctions
 *  4. Multi-pass normal smoothing for a soft, uniform appearance
 */
function weldAndSmoothNormals(
	geometry: THREE.BufferGeometry,
	tolerance = 1e-3
): THREE.BufferGeometry {
	try {
		// 1. Merge duplicate vertices (STL has 3 unique verts per face).
		let merged = BufferGeometryUtils.mergeVertices(geometry, tolerance);

		// 2. Fill any open-boundary holes so the mesh is one continuous piece.
		merged = fillMeshHoles(merged);

		const idx = merged.index;
		if (!idx) {
			merged.computeVertexNormals();
			merged.normalizeNormals();
			if (merged !== geometry) geometry.dispose();
			return merged;
		}

		const posAttr = merged.getAttribute('position') as THREE.BufferAttribute;
		const vertCount = posAttr.count;
		const indices = idx.array;
		const faceCount = indices.length / 3;

		// ---- Build adjacency structures ----
		const neighborSets: Set<number>[] = Array.from({ length: vertCount }, () => new Set());
		const vertFaces: number[][] = Array.from({ length: vertCount }, () => []);

		for (let f = 0; f < faceCount; f++) {
			const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
			neighborSets[a].add(b); neighborSets[a].add(c);
			neighborSets[b].add(a); neighborSets[b].add(c);
			neighborSets[c].add(a); neighborSets[c].add(b);
			vertFaces[a].push(f); vertFaces[b].push(f); vertFaces[c].push(f);
		}

		// ---- Compute per-face normals ----
		const fn = new Float32Array(faceCount * 3);
		for (let f = 0; f < faceCount; f++) {
			const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
			const ax = posAttr.getX(a), ay = posAttr.getY(a), az = posAttr.getZ(a);
			const e1x = posAttr.getX(b) - ax, e1y = posAttr.getY(b) - ay, e1z = posAttr.getZ(b) - az;
			const e2x = posAttr.getX(c) - ax, e2y = posAttr.getY(c) - ay, e2z = posAttr.getZ(c) - az;
			const nx = e1y * e2z - e1z * e2y;
			const ny = e1z * e2x - e1x * e2z;
			const nz = e1x * e2y - e1y * e2x;
			const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
			fn[f * 3] = nx / len; fn[f * 3 + 1] = ny / len; fn[f * 3 + 2] = nz / len;
		}

		// ---- Identify crease vertices ----
		// A vertex sits on a crease if any two of its adjacent faces have
		// normals differing by more than ~35°.
		const creaseThreshold = Math.cos(35 * Math.PI / 180); // ≈ 0.819
		const isCrease = new Uint8Array(vertCount);

		for (let v = 0; v < vertCount; v++) {
			const fList = vertFaces[v];
			let found = false;
			for (let i = 0; !found && i < fList.length; i++) {
				for (let j = i + 1; !found && j < fList.length; j++) {
					const fi = fList[i], fj = fList[j];
					const dot = fn[fi * 3] * fn[fj * 3]
						+ fn[fi * 3 + 1] * fn[fj * 3 + 1]
						+ fn[fi * 3 + 2] * fn[fj * 3 + 2];
					if (dot < creaseThreshold) found = true;
				}
			}
			if (found) isCrease[v] = 1;
		}

		// Expand crease zone by 2 rings so the smoothing blends gradually.
		for (let ring = 0; ring < 2; ring++) {
			const expand = new Uint8Array(isCrease);
			for (let v = 0; v < vertCount; v++) {
				if (!isCrease[v]) continue;
				for (const nb of neighborSets[v]) expand[nb] = 1;
			}
			isCrease.set(expand);
		}

		// ---- Laplacian position smoothing at crease vertices ----
		const pos = posAttr.array as Float32Array;
		const tmp = new Float32Array(pos.length);

		const POSITION_PASSES = 4;
		const POSITION_ALPHA = 0.30;

		for (let pass = 0; pass < POSITION_PASSES; pass++) {
			tmp.set(pos);
			for (let v = 0; v < vertCount; v++) {
				if (!isCrease[v]) continue;
				const nbs = neighborSets[v];
				if (nbs.size === 0) continue;
				let sx = 0, sy = 0, sz = 0;
				for (const nb of nbs) {
					sx += pos[nb * 3]; sy += pos[nb * 3 + 1]; sz += pos[nb * 3 + 2];
				}
				const avg_x = sx / nbs.size;
				const avg_y = sy / nbs.size;
				const avg_z = sz / nbs.size;
				tmp[v * 3] = pos[v * 3] + POSITION_ALPHA * (avg_x - pos[v * 3]);
				tmp[v * 3 + 1] = pos[v * 3 + 1] + POSITION_ALPHA * (avg_y - pos[v * 3 + 1]);
				tmp[v * 3 + 2] = pos[v * 3 + 2] + POSITION_ALPHA * (avg_z - pos[v * 3 + 2]);
			}
			pos.set(tmp);
		}
		posAttr.needsUpdate = true;

		// ---- Compute smooth vertex normals ----
		merged.computeVertexNormals();

		// ---- Additional normal smoothing passes ----
		// Averaging each vertex normal with its neighbors softens the shading
		// transitions at remaining sharp features.
		const normalAttr = merged.getAttribute('normal') as THREE.BufferAttribute;
		const normals = normalAttr.array as Float32Array;
		const ntmp = new Float32Array(normals.length);

		const NORMAL_PASSES = 3;
		for (let pass = 0; pass < NORMAL_PASSES; pass++) {
			for (let v = 0; v < vertCount; v++) {
				const nbs = neighborSets[v];
				let sx = normals[v * 3], sy = normals[v * 3 + 1], sz = normals[v * 3 + 2];
				for (const nb of nbs) {
					sx += normals[nb * 3];
					sy += normals[nb * 3 + 1];
					sz += normals[nb * 3 + 2];
				}
				const len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
				ntmp[v * 3] = sx / len; ntmp[v * 3 + 1] = sy / len; ntmp[v * 3 + 2] = sz / len;
			}
			normals.set(ntmp);
		}
		normalAttr.needsUpdate = true;

		merged.normalizeNormals();
		if (merged !== geometry) geometry.dispose();
		return merged;
	} catch {
		geometry.computeVertexNormals();
		return geometry;
	}
}

/**
 * Smooth the side walls of the insole mesh to remove small chips, notches
 * and scan artifacts that create jagged edges along the rim.
 *
 * Wall vertices are identified by having a mostly-horizontal normal (i.e.
 * the height-axis component is small relative to the horizontal component).
 * A few passes of Laplacian smoothing are applied ONLY to wall positions,
 * keeping the top surface and bottom sole untouched.
 */
function smoothInsoleWalls(
	geometry: THREE.BufferGeometry,
	passes = 6,
	alpha = 0.35,
	wallNormalThreshold = 0.55,
): THREE.BufferGeometry {
	if (!geometry.index) return geometry;
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | null;
	const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | null;
	if (!posAttr || !normalAttr) return geometry;

	const vertCount = posAttr.count;
	const idxArr = geometry.index.array;
	const faceCount = idxArr.length / 3;

	// Determine height axis
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const sz = bbox.getSize(new THREE.Vector3());
	const hAxisIdx: 0 | 1 | 2 = sz.x <= sz.y && sz.x <= sz.z ? 0 : sz.y <= sz.z ? 1 : 2;

	// Build 1-ring neighbour sets
	const neighborSets: Set<number>[] = Array.from({ length: vertCount }, () => new Set<number>());
	for (let f = 0; f < faceCount; f++) {
		const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
		neighborSets[a].add(b); neighborSets[a].add(c);
		neighborSets[b].add(a); neighborSets[b].add(c);
		neighborSets[c].add(a); neighborSets[c].add(b);
	}

	// Identify wall vertices: normal has large horizontal component relative
	// to the height-axis component.  |nH| < wallNormalThreshold means "mostly
	// horizontal" → side wall.
	const normals = normalAttr.array as Float32Array;
	const isWall = new Uint8Array(vertCount);
	for (let v = 0; v < vertCount; v++) {
		const nH = Math.abs(normals[v * 3 + hAxisIdx]);
		if (nH < wallNormalThreshold) isWall[v] = 1;
	}

	// Expand wall zone by 1 ring for a smoother transition
	const expanded = new Uint8Array(isWall);
	for (let v = 0; v < vertCount; v++) {
		if (!isWall[v]) continue;
		for (const nb of neighborSets[v]) expanded[nb] = 1;
	}
	isWall.set(expanded);

	// Laplacian position smoothing on wall vertices only.
	// We smooth ALL 3 coordinates (not just height) so chips/notches get
	// flattened along the wall surface.
	const pos = posAttr.array as Float32Array;
	const tmp = new Float32Array(pos.length);

	for (let p = 0; p < passes; p++) {
		tmp.set(pos);
		for (let v = 0; v < vertCount; v++) {
			if (!isWall[v]) continue;
			const nbs = neighborSets[v];
			if (nbs.size === 0) continue;
			let sx = 0, sy = 0, sz2 = 0;
			for (const nb of nbs) {
				sx += pos[nb * 3];
				sy += pos[nb * 3 + 1];
				sz2 += pos[nb * 3 + 2];
			}
			const inv = 1 / nbs.size;
			tmp[v * 3] = pos[v * 3] + alpha * (sx * inv - pos[v * 3]);
			tmp[v * 3 + 1] = pos[v * 3 + 1] + alpha * (sy * inv - pos[v * 3 + 1]);
			tmp[v * 3 + 2] = pos[v * 3 + 2] + alpha * (sz2 * inv - pos[v * 3 + 2]);
		}
		pos.set(tmp);
	}

	posAttr.needsUpdate = true;
	geometry.computeVertexNormals();
	return geometry;
}

/**
 * Removes high-frequency scan topography from the insole top surface using
 * frequency separation: a heavily-smoothed reference captures the large-scale
 * foot shape; the difference (scan bumps, toe impressions, metatarsal ridges)
 * is reduced to `residualFactor` (default 6%).
 *
 * Also stores per-vertex normalised deviation in geometry.userData.scanDeviations
 * so the "Scan artefacten" overlay can highlight problem areas white→orange→red.
 */
function smoothInsoleTopSurface(
	geometry: THREE.BufferGeometry,
	refPasses = 250,
	residualFactor = 0.06,
	normalThreshold = 0.35,
): THREE.BufferGeometry {
	if (!geometry.index) return geometry;
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | null;
	const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | null;
	if (!posAttr || !normalAttr) return geometry;

	const vertCount = posAttr.count;
	const idxArr = geometry.index.array;
	const faceCount = idxArr.length / 3;

	// Determine height axis (smallest bbox extent = insole thickness direction)
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	const sz = bbox.getSize(new THREE.Vector3());
	const hAxisIdx: 0 | 1 | 2 = sz.x <= sz.y && sz.x <= sz.z ? 0 : sz.y <= sz.z ? 1 : 2;

	// Build 1-ring neighbour sets
	const neighborSets: Set<number>[] = Array.from({ length: vertCount }, () => new Set<number>());
	for (let f = 0; f < faceCount; f++) {
		const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
		neighborSets[a].add(b); neighborSets[a].add(c);
		neighborSets[b].add(a); neighborSets[b].add(c);
		neighborSets[c].add(a); neighborSets[c].add(b);
	}

	// Mark top-facing vertices (normal pointing mostly along height axis)
	const normals = normalAttr.array as Float32Array;
	const topFacing = new Uint8Array(vertCount);
	for (let v = 0; v < vertCount; v++) {
		if (normals[v * 3 + hAxisIdx] > normalThreshold) topFacing[v] = 1;
	}

	// Extract original heights along height axis
	const pos = posAttr.array as Float32Array;
	const origHeights = new Float32Array(vertCount);
	for (let v = 0; v < vertCount; v++) origHeights[v] = pos[v * 3 + hAxisIdx];

	// Compute heavily-smoothed reference.
	// CRITICAL: use ALL 1-ring neighbours (not just topFacing) so that ridge tops
	// get averaged against the side-faces and valleys between them — otherwise
	// ridge peaks only average with other peaks and never flatten.
	// Only topFacing vertices are updated each pass; side/bottom stay fixed,
	// acting as anchors that pull the ridge tops down toward the true surface.
	const smoothRef = origHeights.slice();
	const tmp = new Float32Array(vertCount);
	const alpha = 0.35;
	for (let p = 0; p < refPasses; p++) {
		for (let v = 0; v < vertCount; v++) {
			if (!topFacing[v]) { tmp[v] = smoothRef[v]; continue; }
			const nbs = neighborSets[v];
			if (nbs.size === 0) { tmp[v] = smoothRef[v]; continue; }
			let sum = 0;
			for (const nb of nbs) sum += smoothRef[nb]; // ALL neighbours
			tmp[v] = smoothRef[v] + alpha * (sum / nbs.size - smoothRef[v]);
		}
		smoothRef.set(tmp);
	}

	// Store normalised deviation for the "Scan artefacten" diagnostic colour overlay
	let maxDev = 1e-6;
	for (let v = 0; v < vertCount; v++) {
		if (topFacing[v]) {
			const d = Math.abs(origHeights[v] - smoothRef[v]);
			if (d > maxDev) maxDev = d;
		}
	}
	const deviations = new Float32Array(vertCount);
	for (let v = 0; v < vertCount; v++) {
		if (topFacing[v]) deviations[v] = Math.abs(origHeights[v] - smoothRef[v]) / maxDev;
	}
	geometry.userData.scanDeviations = deviations;

	// Frequency separation: output = smooth_ref + residualFactor × (original − smooth_ref)
	// residualFactor = 0.06 → keeps only 6 % of scan topography, removes 94 %.
	for (let v = 0; v < vertCount; v++) {
		if (!topFacing[v]) continue;
		pos[v * 3 + hAxisIdx] = smoothRef[v] + residualFactor * (origHeights[v] - smoothRef[v]);
	}

	posAttr.needsUpdate = true;
	geometry.computeVertexNormals();
	return geometry;
}

function removeDegenerateTriangles(
	geometry: THREE.BufferGeometry,
	areaEpsilon = 1e-12
): THREE.BufferGeometry {
	const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
	const pos = source.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos || pos.count < 3) return source;

	const out: number[] = [];
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	const ab = new THREE.Vector3();
	const ac = new THREE.Vector3();
	const cross = new THREE.Vector3();

	for (let i = 0; i <= pos.count - 3; i += 3) {
		a.set(pos.getX(i), pos.getY(i), pos.getZ(i));
		b.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
		c.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));

		if (
			!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z) ||
			!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z) ||
			!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)
		) {
			continue;
		}

		ab.subVectors(b, a);
		ac.subVectors(c, a);
		cross.crossVectors(ab, ac);
		const area2 = cross.lengthSq();
		if (!Number.isFinite(area2) || area2 <= areaEpsilon) continue;

		out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
	}

	if (out.length === 0) return source;

	const cleaned = new THREE.BufferGeometry();
	cleaned.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
	cleaned.computeVertexNormals();

	if (source !== geometry) source.dispose();
	return cleaned;
}

/**
 * Remove duplicate / overlapping triangles.
 * Two faces are considered duplicates if they share the same three vertex
 * indices (in any order/winding).  Keeps the first occurrence, discards the
 * rest.  This eliminates doubled faces from CSG / merge artefacts which are
 * a common source of PrusaSlicer "facet intersection" warnings.
 *
 * The geometry **must** be indexed.
 */
function removeDuplicateFaces(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
	const index = geometry.getIndex();
	if (!index) return geometry;

	const seen = new Set<string>();
	const kept: number[] = [];

	for (let i = 0; i < index.count; i += 3) {
		const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].sort(
			(a, b) => a - b
		);
		const key = `${tri[0]},${tri[1]},${tri[2]}`;
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
	}

	if (kept.length === index.count) return geometry;

	const g = geometry.clone();
	g.setIndex(kept);
	return g;
}

/**
 * Snap every vertex coordinate to a grid of the given resolution (mm).
 * This eliminates micro-gaps that cause T-junctions and self-intersecting
 * facets when neighbouring triangles share an edge that differs by sub-micron
 * floating-point noise.
 *
 * Default grid = 1e-4 mm (0.1 µm) — well below any print resolution but
 * large enough to collapse FP noise.
 */
function snapVerticesToGrid(
	geometry: THREE.BufferGeometry,
	gridSize = 1e-4
): THREE.BufferGeometry {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos) return geometry;
	const inv = 1 / gridSize;
	const arr = pos.array as Float32Array;
	for (let i = 0; i < arr.length; i++) {
		arr[i] = Math.round(arr[i] * inv) / inv;
	}
	pos.needsUpdate = true;
	return geometry;
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

/** Colour each vertex by how much its height deviated from the smooth reference
 *  computed by smoothInsoleTopSurface.  White = clean surface, orange/red = scan
 *  artefact.  Requires geometry.userData.scanDeviations to be set. */
function applyDeviationColors(geometry: THREE.BufferGeometry): void {
	const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
	const deviations = geometry.userData.scanDeviations as Float32Array | undefined;
	const count = positions.count;
	const colors = new Float32Array(count * 3);

	for (let v = 0; v < count; v++) {
		// Amplify ×2.5 so subtle bumps become visible; clamp to [0, 1]
		const d = deviations ? Math.min(1, deviations[v] * 2.5) : 0;
		// Ramp: white (d=0) → orange (d≈0.5) → red (d=1)
		colors[v * 3] = 1.0;
		colors[v * 3 + 1] = Math.max(0, 1 - d * 1.5);
		colors[v * 3 + 2] = Math.max(0, 1 - d * 3.0);
	}

	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function applyForefootClampDebugColors(
	geometry: THREE.BufferGeometry,
	params: {
		side: 'left' | 'right';
		mmToWorld: number;
		targetForefootWidthMm?: number;
		targetTrimlineProfile?: TrimlineProfile | null;
		trimlineOffsetMm?: number;
		trimlineAdjustments?: TrimlineAdjustments;
	}
): boolean {
	const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!positions || positions.count === 0) return false;

	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	if (!bbox) return false;

	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	const widthAxis = axes[1];
	const lengthAxis = axes[2];
	const minLen = lengthAxis === 'x' ? bbox.min.x : lengthAxis === 'y' ? bbox.min.y : bbox.min.z;
	const maxLen = lengthAxis === 'x' ? bbox.max.x : lengthAxis === 'y' ? bbox.max.y : bbox.max.z;
	const lenSpan = Math.max(1e-6, maxLen - minLen);
	const centerW =
		widthAxis === 'x'
			? (bbox.min.x + bbox.max.x) * 0.5
			: widthAxis === 'y'
				? (bbox.min.y + bbox.max.y) * 0.5
				: (bbox.min.z + bbox.max.z) * 0.5;

	const getW = (i: number) =>
		widthAxis === 'x' ? positions.getX(i) : widthAxis === 'y' ? positions.getY(i) : positions.getZ(i);
	const getL = (i: number) =>
		lengthAxis === 'x' ? positions.getX(i) : lengthAxis === 'y' ? positions.getY(i) : positions.getZ(i);

	const slice = Math.max(lenSpan * 0.08, 1e-6);
	let minEndMinWidth = Number.POSITIVE_INFINITY;
	let minEndMaxWidth = Number.NEGATIVE_INFINITY;
	let minEndCount = 0;
	let maxEndMinWidth = Number.POSITIVE_INFINITY;
	let maxEndMaxWidth = Number.NEGATIVE_INFINITY;
	let maxEndCount = 0;
	for (let i = 0; i < positions.count; i++) {
		const lenVal = getL(i);
		const wVal = getW(i);
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
		minEndCount > 10 ? Math.max(0, minEndMaxWidth - minEndMinWidth) : Number.POSITIVE_INFINITY;
	const maxEndWidthSpan =
		maxEndCount > 10 ? Math.max(0, maxEndMaxWidth - maxEndMinWidth) : Number.POSITIVE_INFINITY;
	const heelAtMin =
		Number.isFinite(minEndWidthSpan) && Number.isFinite(maxEndWidthSpan)
			? minEndWidthSpan >= maxEndWidthSpan
			: true;

	const colors = new Float32Array(positions.count * 3);
	const neutral = new THREE.Color('#d7dadd');
	const hot = new THREE.Color('#ff2d95');
	for (let i = 0; i < positions.count; i++) {
		colors[i * 3] = neutral.r;
		colors[i * 3 + 1] = neutral.g;
		colors[i * 3 + 2] = neutral.b;
	}

	let highlighted = 0;
	const mark = (index: number) => {
		colors[index * 3] = hot.r;
		colors[index * 3 + 1] = hot.g;
		colors[index * 3 + 2] = hot.b;
		highlighted++;
	};

	if (params.targetTrimlineProfile && params.targetTrimlineProfile.halfWidthsWorld.length > 1) {
		const trimOffsetWorld = Math.max(0, (params.trimlineOffsetMm ?? 3) + (params.trimlineAdjustments?.global ?? 0)) * params.mmToWorld;
		const sampleTrimHalfWidth = (t: number) => {
			const arr = params.targetTrimlineProfile?.halfWidthsWorld ?? [];
			const tt = Math.max(0, Math.min(1, t));
			const x = tt * (arr.length - 1);
			const i0 = Math.floor(x);
			const i1 = Math.min(arr.length - 1, i0 + 1);
			const a = arr[i0] ?? 0;
			const b = arr[i1] ?? a;
			const baseHalf = a + (b - a) * (x - i0) + trimOffsetWorld;
			if (!params.trimlineAdjustments) return baseHalf;
			const { heel, midfoot, forefoot, toe } = params.trimlineAdjustments;
			const ss = (e0: number, e1: number, v: number) => {
				const c = Math.max(0, Math.min(1, (v - e0) / Math.max(1e-6, e1 - e0)));
				return c * c * (3 - 2 * c);
			};
			const heelW = 1 - ss(0.22, 0.28, tt);
			const midW = ss(0.22, 0.28, tt) * (1 - ss(0.52, 0.58, tt));
			const foreW = ss(0.52, 0.58, tt) * (1 - ss(0.79, 0.85, tt));
			const toeW = ss(0.79, 0.85, tt);
			const regionOffset = (heel * heelW + midfoot * midW + forefoot * foreW + toe * toeW) * params.mmToWorld;
			return Math.max(0, baseHalf + regionOffset);
		};

		const bins = Math.max(64, params.targetTrimlineProfile.halfWidthsWorld.length);
		const currentHalfW = new Float32Array(bins).fill(0);
		const binHits = new Uint16Array(bins);
		for (let i = 0; i < positions.count; i++) {
			const lenVal = getL(i);
			const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
			const t = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
			const idx = Math.min(bins - 1, Math.max(0, Math.round(t * (bins - 1))));
			const halfW = Math.abs(getW(i) - centerW);
			if (halfW > currentHalfW[idx]) currentHalfW[idx] = halfW;
			binHits[idx]++;
		}
		for (let i = 0; i < bins; i++) {
			if (binHits[i] > 0) continue;
			let l = i - 1;
			while (l >= 0 && binHits[l] === 0) l--;
			let r = i + 1;
			while (r < bins && binHits[r] === 0) r++;
			if (l >= 0 && r < bins) currentHalfW[i] = (currentHalfW[l] + currentHalfW[r]) * 0.5;
			else if (l >= 0) currentHalfW[i] = currentHalfW[l];
			else if (r < bins) currentHalfW[i] = currentHalfW[r];
		}
		const sampleCurrentHalfWidth = (t: number) => {
			const tt = Math.max(0, Math.min(1, t));
			const x = tt * (bins - 1);
			const i0 = Math.floor(x);
			const i1 = Math.min(bins - 1, i0 + 1);
			return currentHalfW[i0] + (currentHalfW[i1] - currentHalfW[i0]) * (x - i0);
		};
		const toeShoulderHalf = Math.max(
			1e-6,
			sampleCurrentHalfWidth(0.75),
			sampleCurrentHalfWidth(0.78),
			sampleCurrentHalfWidth(0.82),
			sampleCurrentHalfWidth(0.88),
			sampleTrimHalfWidth(0.75),
			sampleTrimHalfWidth(0.78),
			sampleTrimHalfWidth(0.82),
			sampleTrimHalfWidth(0.88)
		);
		const toeTipMaxHalf = toeShoulderHalf * 0.88;
		for (let i = 0; i < positions.count; i++) {
			const lenVal = getL(i);
			const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
			const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
			const currentAbs = Math.abs(getW(i) - centerW);
			const targetHalfW = Math.max(1e-6, sampleTrimHalfWidth(tLen));
			const maxAllowedHalf = targetHalfW + (1.5 * params.mmToWorld);
			const u = Math.max(0, Math.min(1, (tLen - 0.78) / 0.22));
			const cap = Math.sqrt(Math.max(0, 1 - u * u));
			const maxHalf = toeTipMaxHalf + (toeShoulderHalf - toeTipMaxHalf) * cap;
			const eps = Math.max(0.2 * params.mmToWorld, 0.015 * Math.max(maxHalf, maxAllowedHalf));
			const nearToeClamp = tLen >= 0.84 && currentAbs >= maxHalf - eps;
			const nearProfileClamp = tLen >= 0.78 && currentAbs >= maxAllowedHalf - eps;
			if (nearToeClamp || nearProfileClamp) mark(i);
		}
	} else if (typeof params.targetForefootWidthMm === 'number' && Number.isFinite(params.targetForefootWidthMm) && params.targetForefootWidthMm > 0) {
		const toeStart = heelAtMin ? minLen + lenSpan * 0.55 : maxLen - lenSpan * 0.75;
		const toeEnd = heelAtMin ? minLen + lenSpan * 0.9 : maxLen - lenSpan * 0.4;
		let foreMinW = Number.POSITIVE_INFINITY;
		let foreMaxW = Number.NEGATIVE_INFINITY;
		let foreCount = 0;
		for (let i = 0; i < positions.count; i++) {
			const lenVal = getL(i);
			const inForefoot =
				(heelAtMin && lenVal >= toeStart && lenVal <= toeEnd) ||
				(!heelAtMin && lenVal <= toeStart && lenVal >= toeEnd);
			if (!inForefoot) continue;
			const wVal = getW(i);
			foreMinW = Math.min(foreMinW, wVal);
			foreMaxW = Math.max(foreMaxW, wVal);
			foreCount++;
		}
		const currentForeWidth = foreCount > 12 ? Math.max(1e-6, foreMaxW - foreMinW) : Math.max(1e-6, sizes[widthAxis]);
		const toeShoulderHalf = Math.max(1e-6, currentForeWidth * 0.5);
		const toeTipMaxHalf = toeShoulderHalf * 0.88;
		for (let i = 0; i < positions.count; i++) {
			const lenVal = getL(i);
			const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
			const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
			const currentAbs = Math.abs(getW(i) - centerW);
			const u = Math.max(0, Math.min(1, (tLen - 0.78) / 0.22));
			const cap = Math.sqrt(Math.max(0, 1 - u * u));
			const maxHalf = toeTipMaxHalf + (toeShoulderHalf - toeTipMaxHalf) * cap;
			const eps = Math.max(0.2 * params.mmToWorld, 0.015 * maxHalf);
			if (tLen >= 0.84 && currentAbs >= maxHalf - eps) mark(i);
		}
	}

	if (highlighted === 0) return false;
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	return true;
}

type OverlayRegistration = {
	matrix: THREE.Matrix4;
	rmseMm: number;
	valid: boolean;
};

type TrimlineProfile = {
	lengthWorld: number;
	samplesT: number[];
	halfWidthsWorld: number[];
};

function identityRegistration(): OverlayRegistration {
	return {
		matrix: new THREE.Matrix4().identity(),
		rmseMm: 0,
		valid: false,
	};
}

function getAxesAndBounds(geometry: THREE.BufferGeometry) {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	if (!bbox) return null;
	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	return {
		bbox,
		heightAxis: axes[0],
		widthAxis: axes[1],
		lengthAxis: axes[2],
	};
}

function axisValue(v: THREE.Vector3, axis: 'x' | 'y' | 'z') {
	return axis === 'x' ? v.x : axis === 'y' ? v.y : v.z;
}

function extractFrameAnchors(geometry: THREE.BufferGeometry) {
	const meta = getAxesAndBounds(geometry);
	if (!meta) return null;
	const { bbox, widthAxis, lengthAxis } = meta;
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos || pos.count < 16) return null;

	const minLen = lengthAxis === 'x' ? bbox.min.x : lengthAxis === 'y' ? bbox.min.y : bbox.min.z;
	const maxLen = lengthAxis === 'x' ? bbox.max.x : lengthAxis === 'y' ? bbox.max.y : bbox.max.z;
	const lenSpan = Math.max(1e-6, maxLen - minLen);

	const slice = Math.max(lenSpan * 0.08, 1e-6);
	let minEndMinWidth = Number.POSITIVE_INFINITY;
	let minEndMaxWidth = Number.NEGATIVE_INFINITY;
	let minEndCount = 0;
	let maxEndMinWidth = Number.POSITIVE_INFINITY;
	let maxEndMaxWidth = Number.NEGATIVE_INFINITY;
	let maxEndCount = 0;

	for (let i = 0; i < pos.count; i++) {
		const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
		const lenVal = axisValue(p, lengthAxis);
		const wVal = axisValue(p, widthAxis);
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

	const heelThreshold = heelAtMin ? minLen + lenSpan * 0.1 : maxLen - lenSpan * 0.1;
	const foreStart = heelAtMin ? minLen + lenSpan * 0.55 : maxLen - lenSpan * 0.75;
	const foreEnd = heelAtMin ? minLen + lenSpan * 0.85 : maxLen - lenSpan * 0.45;

	const heelPts: THREE.Vector3[] = [];
	const forePts: THREE.Vector3[] = [];
	for (let i = 0; i < pos.count; i++) {
		const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
		const lenVal = axisValue(p, lengthAxis);
		if ((heelAtMin && lenVal <= heelThreshold) || (!heelAtMin && lenVal >= heelThreshold)) {
			heelPts.push(p);
		}
		if (
			(heelAtMin && lenVal >= foreStart && lenVal <= foreEnd) ||
			(!heelAtMin && lenVal <= foreStart && lenVal >= foreEnd)
		) {
			forePts.push(p);
		}
	}

	if (heelPts.length < 8 || forePts.length < 8) return null;

	const heel = heelPts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / heelPts.length);

	let minFore = forePts[0];
	let maxFore = forePts[0];
	for (let i = 1; i < forePts.length; i++) {
		const p = forePts[i];
		if (axisValue(p, widthAxis) < axisValue(minFore, widthAxis)) minFore = p;
		if (axisValue(p, widthAxis) > axisValue(maxFore, widthAxis)) maxFore = p;
	}

	return { heel, meta1: minFore.clone(), meta5: maxFore.clone() };
}

function rigidFromFrames(source: { heel: THREE.Vector3; meta1: THREE.Vector3; meta5: THREE.Vector3 }, target: { heel: THREE.Vector3; meta1: THREE.Vector3; meta5: THREE.Vector3 }) {
	const sFore = new THREE.Vector3().addVectors(source.meta1, source.meta5).multiplyScalar(0.5);
	const tFore = new THREE.Vector3().addVectors(target.meta1, target.meta5).multiplyScalar(0.5);

	const sLong = new THREE.Vector3().subVectors(sFore, source.heel).normalize();
	const tLong = new THREE.Vector3().subVectors(tFore, target.heel).normalize();

	const sLatRaw = new THREE.Vector3().subVectors(source.meta5, source.meta1).normalize();
	const tLatRaw = new THREE.Vector3().subVectors(target.meta5, target.meta1).normalize();

	const sNormal = new THREE.Vector3().crossVectors(sLong, sLatRaw).normalize();
	const tNormal = new THREE.Vector3().crossVectors(tLong, tLatRaw).normalize();

	const sLat = new THREE.Vector3().crossVectors(sNormal, sLong).normalize();
	const tLat = new THREE.Vector3().crossVectors(tNormal, tLong).normalize();

	const sBasis = new THREE.Matrix4().makeBasis(sLat, sNormal, sLong);
	const tBasis = new THREE.Matrix4().makeBasis(tLat, tNormal, tLong);
	const rot = new THREE.Matrix4().copy(tBasis).multiply(new THREE.Matrix4().copy(sBasis).invert());

	const sHeelRot = source.heel.clone().applyMatrix4(rot);
	const translation = new THREE.Vector3().subVectors(target.heel, sHeelRot);

	return new THREE.Matrix4().copy(rot).setPosition(translation);
}

function snapRegistrationToHeelEdge(
	source: THREE.BufferGeometry,
	target: THREE.BufferGeometry,
	initial: THREE.Matrix4,
	targetFrame: { heel: THREE.Vector3; meta1: THREE.Vector3; meta5: THREE.Vector3 }
) {
	const srcPos = source.getAttribute('position') as THREE.BufferAttribute | undefined;
	const tgtPos = target.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!srcPos || !tgtPos || srcPos.count < 16 || tgtPos.count < 16) return initial;

	const targetFore = new THREE.Vector3()
		.addVectors(targetFrame.meta1, targetFrame.meta5)
		.multiplyScalar(0.5);
	const tLong = new THREE.Vector3().subVectors(targetFore, targetFrame.heel).normalize();
	if (!Number.isFinite(tLong.lengthSq()) || tLong.lengthSq() < 1e-6) return initial;

	const transformed = new THREE.Vector3();
	const sourceProj: number[] = [];
	const targetProj: number[] = [];

	for (let i = 0; i < srcPos.count; i++) {
		transformed
			.set(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i))
			.applyMatrix4(initial);
		sourceProj.push(transformed.dot(tLong));
	}
	for (let i = 0; i < tgtPos.count; i++) {
		transformed.set(tgtPos.getX(i), tgtPos.getY(i), tgtPos.getZ(i));
		targetProj.push(transformed.dot(tLong));
	}

	sourceProj.sort((a, b) => a - b);
	targetProj.sort((a, b) => a - b);
	const sampleCount = Math.max(8, Math.min(64, Math.floor(Math.min(sourceProj.length, targetProj.length) * 0.02)));
	let srcHeelEdge = 0;
	let tgtHeelEdge = 0;
	for (let i = 0; i < sampleCount; i++) {
		srcHeelEdge += sourceProj[i];
		tgtHeelEdge += targetProj[i];
	}
	srcHeelEdge /= sampleCount;
	tgtHeelEdge /= sampleCount;

	const deltaWorld = tgtHeelEdge - srcHeelEdge;
	if (Math.abs(deltaWorld) <= 1e-6) return initial;
	return new THREE.Matrix4()
		.makeTranslation(tLong.x * deltaWorld, tLong.y * deltaWorld, tLong.z * deltaWorld)
		.multiply(initial);
}

/**
 * Compute the scene-space position offset needed for a driekwart insole so
 * its heel end aligns with the scan overlay's heel end.
 *
 * The scan overlay uses a different mesh rotation than the insole
 * (`rotationOffset=[PI,0,PI]` vs `[0,0,0]`). When `skipIcp=true` (driekwart),
 * the geometry-space registration doesn't compensate for this rotation
 * difference, so the insole appears shifted relative to the scan in the scene.
 *
 * We solve this by finding the heel-edge centroid of both geometries in
 * scene space (after their respective mesh rotations) and returning the delta.
 */
function computeDriekwartInsoleOffset(
	insoleGeometry: THREE.BufferGeometry | null,
	overlayGeometry: THREE.BufferGeometry | null,
	registration: OverlayRegistration
): THREE.Vector3 {
	const zero = new THREE.Vector3(0, 0, 0);
	if (!insoleGeometry || !overlayGeometry || !registration.valid) return zero;

	const insolePos = insoleGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	const overlayPos = overlayGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!insolePos || !overlayPos || insolePos.count < 32 || overlayPos.count < 32) return zero;

	// Mesh rotations in scene (same as applyOrientation)
	const insoleRotMatrix = new THREE.Matrix4().makeRotationFromEuler(
		new THREE.Euler(-Math.PI / 2, 0, 0)
	);
	const overlayRotMatrix = new THREE.Matrix4().makeRotationFromEuler(
		new THREE.Euler(-Math.PI / 2 + Math.PI, 0, Math.PI)
	);

	// Combined transform for overlay: registration × overlayRotation
	const overlayFullTransform = new THREE.Matrix4()
		.copy(registration.matrix)
		.multiply(overlayRotMatrix);

	// Find the length axis in geometry space for the insole
	const insoleMeta = getAxesAndBounds(insoleGeometry);
	if (!insoleMeta) return zero;
	const { lengthAxis, bbox } = insoleMeta;

	const minLen = axisValue(bbox.min, lengthAxis);
	const maxLen = axisValue(bbox.max, lengthAxis);
	const lenSpan = Math.max(1e-6, maxLen - minLen);

	// Identify heel end of the insole (wider end)
	const slice = Math.max(lenSpan * 0.08, 1e-6);
	let minEndWidth = 0, maxEndWidth = 0;
	let minEndCount = 0, maxEndCount = 0;
	const { widthAxis } = insoleMeta;
	for (let i = 0; i < insolePos.count; i++) {
		const p = new THREE.Vector3(insolePos.getX(i), insolePos.getY(i), insolePos.getZ(i));
		const lenVal = axisValue(p, lengthAxis);
		const wVal = axisValue(p, widthAxis);
		if (lenVal <= minLen + slice) {
			minEndWidth += Math.abs(wVal);
			minEndCount++;
		}
		if (lenVal >= maxLen - slice) {
			maxEndWidth += Math.abs(wVal);
			maxEndCount++;
		}
	}
	const heelAtMin = minEndCount > 0 && maxEndCount > 0
		? (minEndWidth / minEndCount) >= (maxEndWidth / maxEndCount)
		: true;

	// Collect heel-edge vertices of the insole in scene space
	const heelThreshold = heelAtMin ? minLen + lenSpan * 0.05 : maxLen - lenSpan * 0.05;
	const insoleHeelPts: THREE.Vector3[] = [];
	for (let i = 0; i < insolePos.count; i++) {
		const p = new THREE.Vector3(insolePos.getX(i), insolePos.getY(i), insolePos.getZ(i));
		const lenVal = axisValue(p, lengthAxis);
		const isHeel = heelAtMin ? lenVal <= heelThreshold : lenVal >= heelThreshold;
		if (isHeel) {
			insoleHeelPts.push(p.clone().applyMatrix4(insoleRotMatrix));
		}
	}

	// Collect heel-edge vertices of the overlay scan in scene space
	// First find the scan's length axis
	const overlayMeta = getAxesAndBounds(overlayGeometry);
	if (!overlayMeta) return zero;
	const oLengthAxis = overlayMeta.lengthAxis;
	const oBbox = overlayMeta.bbox;
	const oMinLen = axisValue(oBbox.min, oLengthAxis);
	const oMaxLen = axisValue(oBbox.max, oLengthAxis);
	const oLenSpan = Math.max(1e-6, oMaxLen - oMinLen);

	// Find the scan's heel end (wider end)
	const oSlice = Math.max(oLenSpan * 0.08, 1e-6);
	let oMinEndWidth = 0, oMaxEndWidth = 0;
	let oMinEndCount = 0, oMaxEndCount = 0;
	const oWidthAxis = overlayMeta.widthAxis;
	for (let i = 0; i < overlayPos.count; i++) {
		const p = new THREE.Vector3(overlayPos.getX(i), overlayPos.getY(i), overlayPos.getZ(i));
		const lenVal = axisValue(p, oLengthAxis);
		const wVal = axisValue(p, oWidthAxis);
		if (lenVal <= oMinLen + oSlice) {
			oMinEndWidth += Math.abs(wVal);
			oMinEndCount++;
		}
		if (lenVal >= oMaxLen - oSlice) {
			oMaxEndWidth += Math.abs(wVal);
			oMaxEndCount++;
		}
	}
	const oHeelAtMin = oMinEndCount > 0 && oMaxEndCount > 0
		? (oMinEndWidth / oMinEndCount) >= (oMaxEndWidth / oMaxEndCount)
		: true;

	const oHeelThreshold = oHeelAtMin ? oMinLen + oLenSpan * 0.05 : oMaxLen - oLenSpan * 0.05;
	const overlayHeelPts: THREE.Vector3[] = [];
	for (let i = 0; i < overlayPos.count; i++) {
		const p = new THREE.Vector3(overlayPos.getX(i), overlayPos.getY(i), overlayPos.getZ(i));
		const lenVal = axisValue(p, oLengthAxis);
		const isHeel = oHeelAtMin ? lenVal <= oHeelThreshold : lenVal >= oHeelThreshold;
		if (isHeel) {
			overlayHeelPts.push(p.clone().applyMatrix4(overlayFullTransform));
		}
	}

	if (insoleHeelPts.length < 4 || overlayHeelPts.length < 4) return zero;

	// Average scene-space heel positions
	const insoleHeel = insoleHeelPts
		.reduce((acc, p) => acc.add(p), new THREE.Vector3())
		.multiplyScalar(1 / insoleHeelPts.length);
	const overlayHeel = overlayHeelPts
		.reduce((acc, p) => acc.add(p), new THREE.Vector3())
		.multiplyScalar(1 / overlayHeelPts.length);

	// Only shift along the length direction in the scene (Y and Z),
	// keep X as-is to avoid sideways shifting.
	const delta = new THREE.Vector3().subVectors(overlayHeel, insoleHeel);
	delta.x = 0;
	return delta;
}

function estimateRigidTransformFromPairs(
	srcPoints: THREE.Vector3[],
	tgtPoints: THREE.Vector3[]
) {
	if (srcPoints.length !== tgtPoints.length || srcPoints.length < 3) return null;

	const cSrc = new THREE.Vector3();
	const cTgt = new THREE.Vector3();
	for (let i = 0; i < srcPoints.length; i++) {
		cSrc.add(srcPoints[i]);
		cTgt.add(tgtPoints[i]);
	}
	cSrc.multiplyScalar(1 / srcPoints.length);
	cTgt.multiplyScalar(1 / tgtPoints.length);

	let sxx = 0, sxy = 0, sxz = 0;
	let syx = 0, syy = 0, syz = 0;
	let szx = 0, szy = 0, szz = 0;

	for (let i = 0; i < srcPoints.length; i++) {
		const a = srcPoints[i].clone().sub(cSrc);
		const b = tgtPoints[i].clone().sub(cTgt);
		sxx += a.x * b.x;
		sxy += a.x * b.y;
		sxz += a.x * b.z;
		syx += a.y * b.x;
		syy += a.y * b.y;
		syz += a.y * b.z;
		szx += a.z * b.x;
		szy += a.z * b.y;
		szz += a.z * b.z;
	}

	const trace = sxx + syy + szz;
	const n = [
		[trace, syz - szy, szx - sxz, sxy - syx],
		[syz - szy, sxx - syy - szz, sxy + syx, sxz + szx],
		[szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
		[sxy - syx, sxz + szx, syz + szy, -sxx - syy + szz],
	];

	let q = [1, 0, 0, 0];
	for (let k = 0; k < 24; k++) {
		const nq = [
			n[0][0] * q[0] + n[0][1] * q[1] + n[0][2] * q[2] + n[0][3] * q[3],
			n[1][0] * q[0] + n[1][1] * q[1] + n[1][2] * q[2] + n[1][3] * q[3],
			n[2][0] * q[0] + n[2][1] * q[1] + n[2][2] * q[2] + n[2][3] * q[3],
			n[3][0] * q[0] + n[3][1] * q[1] + n[3][2] * q[2] + n[3][3] * q[3],
		];
		const len = Math.hypot(nq[0], nq[1], nq[2], nq[3]) || 1;
		q = [nq[0] / len, nq[1] / len, nq[2] / len, nq[3] / len];
	}

	const quat = new THREE.Quaternion(q[1], q[2], q[3], q[0]).normalize();
	const rot = new THREE.Matrix4().makeRotationFromQuaternion(quat);
	const cSrcRot = cSrc.clone().applyMatrix4(rot);
	const t = new THREE.Vector3().subVectors(cTgt, cSrcRot);

	return rot.setPosition(t);
}

function refineRigidICPTrimmed(
	source: THREE.BufferGeometry,
	target: THREE.BufferGeometry,
	initial: THREE.Matrix4,
	iterations = 5
) {
	const srcPos = source.getAttribute('position') as THREE.BufferAttribute | undefined;
	const tgtPos = target.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!srcPos || !tgtPos || srcPos.count < 16 || tgtPos.count < 16) {
		return { matrix: initial, rmseWorld: 0 };
	}

	const srcStep = Math.max(1, Math.floor(srcPos.count / 320));
	const tgtStep = Math.max(1, Math.floor(tgtPos.count / 900));
	const tgtSamples: THREE.Vector3[] = [];
	for (let i = 0; i < tgtPos.count; i += tgtStep) {
		tgtSamples.push(new THREE.Vector3(tgtPos.getX(i), tgtPos.getY(i), tgtPos.getZ(i)));
	}

	let current = initial.clone();
	let lastRmse = Number.POSITIVE_INFINITY;
	const temp = new THREE.Vector3();

	for (let it = 0; it < iterations; it++) {
		const pairs: Array<{ src: THREE.Vector3; tgt: THREE.Vector3; dist2: number }> = [];
		for (let i = 0; i < srcPos.count; i += srcStep) {
			const src = new THREE.Vector3(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i));
			const srcMapped = src.clone().applyMatrix4(current);
			let best = tgtSamples[0];
			let bestD2 = Number.POSITIVE_INFINITY;
			for (let j = 0; j < tgtSamples.length; j++) {
				const t = tgtSamples[j];
				const d2 = temp.copy(srcMapped).sub(t).lengthSq();
				if (d2 < bestD2) {
					bestD2 = d2;
					best = t;
				}
			}
			pairs.push({ src: srcMapped, tgt: best, dist2: bestD2 });
		}

		if (pairs.length < 20) break;
		pairs.sort((a, b) => a.dist2 - b.dist2);
		const keepCount = Math.max(12, Math.floor(pairs.length * 0.7));
		const kept = pairs.slice(0, keepCount);

		const srcPts = kept.map((p) => p.src);
		const tgtPts = kept.map((p) => p.tgt);
		const delta = estimateRigidTransformFromPairs(srcPts, tgtPts);
		if (!delta) break;

		current = delta.clone().multiply(current);

		let mse = 0;
		for (let i = 0; i < kept.length; i++) mse += kept[i].dist2;
		const rmse = Math.sqrt(mse / kept.length);
		if (Math.abs(lastRmse - rmse) < 1e-4) {
			lastRmse = rmse;
			break;
		}
		lastRmse = rmse;
	}

	if (!Number.isFinite(lastRmse)) lastRmse = 0;
	return { matrix: current, rmseWorld: lastRmse };
}

function computeOverlayRegistration(
	source: THREE.BufferGeometry | null,
	target: THREE.BufferGeometry | null,
	options?: { skipIcp?: boolean; snapHeelEdge?: boolean }
): OverlayRegistration {
	if (!source || !target) return identityRegistration();
	const srcAnchors = extractFrameAnchors(source);
	const tgtAnchors = extractFrameAnchors(target);
	if (!srcAnchors || !tgtAnchors) return identityRegistration();

	const base = rigidFromFrames(srcAnchors, tgtAnchors);
	const worldToMm = 1 / Math.max(1e-6, MM_TO_WORLD);
	if (options?.skipIcp) {
		const snapped = options?.snapHeelEdge
			? snapRegistrationToHeelEdge(source, target, base, tgtAnchors)
			: base;
		return {
			matrix: snapped,
			rmseMm: 0,
			valid: true,
		};
	}
	const refined = refineRigidICPTrimmed(source, target, base, 5);

	return {
		matrix: refined.matrix,
		rmseMm: refined.rmseWorld * worldToMm,
		valid: true,
	};
}

function buildTrimlineProfileFromGeometry(
	geometry: THREE.BufferGeometry | null,
	options?: { matrix?: THREE.Matrix4; bins?: number }
): TrimlineProfile | null {
	if (!geometry) return null;
	const bins = Math.max(16, options?.bins ?? 48);
	const working = geometry.clone();
	if (options?.matrix) {
		working.applyMatrix4(options.matrix);
	}
	const meta = getAxesAndBounds(working);
	if (!meta) return null;
	const { bbox, lengthAxis, widthAxis } = meta;
	const pos = working.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos || pos.count < 32) return null;

	const minLen = lengthAxis === 'x' ? bbox.min.x : lengthAxis === 'y' ? bbox.min.y : bbox.min.z;
	const maxLen = lengthAxis === 'x' ? bbox.max.x : lengthAxis === 'y' ? bbox.max.y : bbox.max.z;
	const lenSpan = Math.max(1e-6, maxLen - minLen);
	const centerW =
		widthAxis === 'x'
			? (bbox.min.x + bbox.max.x) * 0.5
			: widthAxis === 'y'
				? (bbox.min.y + bbox.max.y) * 0.5
				: (bbox.min.z + bbox.max.z) * 0.5;

	const maxHalfW = new Float32Array(bins).fill(0);
	const hits = new Uint16Array(bins);

	for (let i = 0; i < pos.count; i++) {
		const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
		const lenVal = axisValue(p, lengthAxis);
		const t = Math.max(0, Math.min(1, (lenVal - minLen) / lenSpan));
		const idx = Math.min(bins - 1, Math.max(0, Math.round(t * (bins - 1))));
		const wVal = axisValue(p, widthAxis);
		const halfW = Math.abs(wVal - centerW);
		if (halfW > maxHalfW[idx]) maxHalfW[idx] = halfW;
		hits[idx]++;
	}

	// Fill holes using nearest valid neighbors
	for (let i = 0; i < bins; i++) {
		if (hits[i] > 0) continue;
		let left = i - 1;
		while (left >= 0 && hits[left] === 0) left--;
		let right = i + 1;
		while (right < bins && hits[right] === 0) right++;
		if (left >= 0 && right < bins) {
			maxHalfW[i] = (maxHalfW[left] + maxHalfW[right]) * 0.5;
		} else if (left >= 0) {
			maxHalfW[i] = maxHalfW[left];
		} else if (right < bins) {
			maxHalfW[i] = maxHalfW[right];
		}
	}

	// Robust smoothing for stable trimline silhouette.
	// This removes scan noise spikes that otherwise create random dents/bulges.
	const smoothPass = (src: Float32Array) => {
		const out = new Float32Array(bins);
		for (let i = 0; i < bins; i++) {
			const a = src[Math.max(0, i - 2)];
			const b = src[Math.max(0, i - 1)];
			const c = src[i];
			const d = src[Math.min(bins - 1, i + 1)];
			const e = src[Math.min(bins - 1, i + 2)];
			out[i] = a * 0.08 + b * 0.22 + c * 0.4 + d * 0.22 + e * 0.08;
		}
		return out;
	};

	const smooth1 = smoothPass(maxHalfW);
	const smooth2 = smoothPass(smooth1);

	// Slope limiter to avoid abrupt bin-to-bin jumps along length.
	const smooth = new Float32Array(smooth2);
	const maxDelta = Math.max(0.35, (lenSpan / Math.max(1, bins - 1)) * 0.75);
	for (let i = 1; i < bins; i++) {
		smooth[i] = Math.min(smooth[i], smooth[i - 1] + maxDelta);
		smooth[i] = Math.max(smooth[i], smooth[i - 1] - maxDelta);
	}
	for (let i = bins - 2; i >= 0; i--) {
		smooth[i] = Math.min(smooth[i], smooth[i + 1] + maxDelta);
		smooth[i] = Math.max(smooth[i], smooth[i + 1] - maxDelta);
	}

	const samplesT = Array.from({ length: bins }, (_, i) => i / (bins - 1));
	const halfWidthsWorld = Array.from(smooth);
	return {
		lengthWorld: lenSpan,
		samplesT,
		halfWidthsWorld,
	};
}

function STLMesh({
	url,
	color = '#e8b99a',
	position = DEFAULT_VEC3,
	meshRole = 'insole',
	viewerOverlayMode = 'embedded',
	flipLongAxis = false,
	targetForefootWidthMm,
	targetTrimlineProfile = null,
	trimlineOffsetMm = 3,
	trimlineAdjustments,
	trimlineHandleProfile,
	interactive = true,
	rotationOffset = DEFAULT_VEC3,
	opacity,
	onGeometryReady,
	onPickPoint,
	pointPickMode = false,
	showZones = false,
	heatmap = false,
	clampDebug = false,
	deviationMap = false,
	transparentMode = false,
	sideInspectionActive = false,
	sideInspectionView = 'left',
	probeEnabled = false,
	onProbe,
	selected = false,
	onSelect,
	onZoneClick,
	showBoxGrid = false,
	corrections,
	activeCorrections,
	side = 'left',
	gridEditMode = false,
	heelEdgeThicknessMm = 1,
	savedBoxGridOffsets = null,
	onBoxGridSave,
	textPlacementEnabled = false,
	textPlacementText = '',
	bottomTextOverlay,
	onBottomTextLoadingChange,
	onBottomTextValidityChange,
	onTextPlace,
	placedElements,
	elementPlacementMode = null,
	onElementPlace,
	selectedElementTrimlineEdit = null,
	selectedElementBoxEdit = null,
	onPendingElementTrimlineProfileChange,
	onElementBoxGridSave,
	onTrimDragActiveChange,
	evaBlockMode = false,
	printPrepSplit = false,
	printPrepSelectedZone = null,
	printPrepHoveredZone = null,
	onPrintPrepZoneHover,
	printPrepWhole = false,
	onPrintWholeInsoleClick,
	onPrintElementClick,
	printSelectedElementId = null,
	printElementSelectionHighlight = false,
}: STLMeshProps) {
	const rawGeometry = useLoader(STLLoader, url);
	const general = useDesignStore((state) => state.parameters.general);
	const { invalidate } = useThree();
	const invalidateRef = useRef(invalidate);
	invalidateRef.current = invalidate;
	const lastEmittedPrintHoverRef = useRef<PrintZoneId | undefined>(undefined);
	const pendingPrintPrepHoverRef = useRef<PrintZoneId | null>(null);
	const printPrepHoverFlushRafRef = useRef<number | null>(null);
	/** Synced on pointer move so vertexColors can turn on before parent hover state commits */
	const [prepZoneColorsLive, setPrepZoneColorsLive] = useState(false);
	const insoleLatticeDragRafRef = useRef<number | null>(null);
	const pendingInsoleLatticeVecsRef = useRef<LatticeOffsetVec[] | null>(null);
	const elementLatticeDragRafRef = useRef<number | null>(null);
	const pendingElementLatticeVecsRef = useRef<LatticeOffsetVec[] | null>(null);
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
	const seededShoeSize = getSideNumber(generalUnknown?.seededShoeSize, shoeSize);
	const soleThicknessMm = getSideNumber(generalUnknown?.soleThicknessMm, 2);
	const totalInsoleHeightMm = getSideNumber(generalUnknown?.maxInsoleHeightMm, 10);
	const applyGeneral = meshRole === 'insole';
	const engravingFontRef = useRef<Awaited<ReturnType<typeof loadEngravingFont>> | null>(null);
	const [engravingFontReady, setEngravingFontReady] = useState(false);
	useEffect(() => {
		if (meshRole !== 'insole') return;
		loadEngravingFont()
			.then((font) => {
				engravingFontRef.current = font;
				setEngravingFontReady(true);
			})
			.catch(() => {
				setEngravingFontReady(false);
			});
	}, [meshRole]);
	useEffect(() => {
		return () => {
			if (printPrepHoverFlushRafRef.current != null) {
				cancelAnimationFrame(printPrepHoverFlushRafRef.current);
				printPrepHoverFlushRafRef.current = null;
			}
			if (insoleLatticeDragRafRef.current != null) {
				cancelAnimationFrame(insoleLatticeDragRafRef.current);
				insoleLatticeDragRafRef.current = null;
			}
			if (elementLatticeDragRafRef.current != null) {
				cancelAnimationFrame(elementLatticeDragRafRef.current);
				elementLatticeDragRafRef.current = null;
			}
		};
	}, []);
	const meshRef = useRef<THREE.Mesh>(null);
	const lastCorrectionsRef = useRef<string>('');
	const pendingSignatureRef = useRef<string>('');
	const geometryRef = useRef<THREE.BufferGeometry | null>(null);
	const animRafRef = useRef<number | null>(null);
	const placedElementsRafRef = useRef<number | null>(null);
	const overlayRafRef = useRef<number | null>(null);
	const hasPlacedElements = Boolean(placedElements && placedElements.length > 0);
	const placedElementsSignature = useMemo(() => getPlacedElementsSignature(placedElements), [placedElements]);
	const selectedElementBoxEditSignature = useMemo(
		() => getSelectedElementBoxEditSignature(selectedElementBoxEdit),
		[selectedElementBoxEdit]
	);
	const savedBoxGridOffsetsSignature = useMemo(
		() => getBoxGridOffsetsSignature(savedBoxGridOffsets),
		[savedBoxGridOffsets]
	);
	const bottomTextOverlaySignature = useMemo(
		() => `${getBottomTextOverlaySignature(bottomTextOverlay)}|f:${engravingFontReady ? '1' : '0'}`,
		[bottomTextOverlay, engravingFontReady]
	);
	const placedElementsRef = useRef<PlacedElement[] | undefined>(placedElements);
	placedElementsRef.current = placedElements;
	const selectedElementBoxEditRef = useRef<STLMeshProps['selectedElementBoxEdit']>(selectedElementBoxEdit);
	selectedElementBoxEditRef.current = selectedElementBoxEdit;
	const savedBoxGridOffsetsRef = useRef<BoxGridSavedOffsets | null | undefined>(savedBoxGridOffsets);
	savedBoxGridOffsetsRef.current = savedBoxGridOffsets;
	const bottomTextOverlayRef = useRef<BottomTextOverlay | undefined>(bottomTextOverlay);
	bottomTextOverlayRef.current = bottomTextOverlay;
	const onBottomTextLoadingChangeRef = useRef(onBottomTextLoadingChange);
	onBottomTextLoadingChangeRef.current = onBottomTextLoadingChange;
	const onBottomTextValidityChangeRef = useRef(onBottomTextValidityChange);
	onBottomTextValidityChangeRef.current = onBottomTextValidityChange;
	const onGeometryReadyRef = useRef(onGeometryReady);
	onGeometryReadyRef.current = onGeometryReady;
	const hasPlacedElementsRef = useRef(hasPlacedElements);
	hasPlacedElementsRef.current = hasPlacedElements;
	const placedElementsSignatureRef = useRef(placedElementsSignature);
	placedElementsSignatureRef.current = placedElementsSignature;
	const selectedElementBoxEditSignatureRef = useRef(selectedElementBoxEditSignature);
	selectedElementBoxEditSignatureRef.current = selectedElementBoxEditSignature;
	const lastRenderedOverlaySignatureRef = useRef<string>('');
	const debugBuildCountersRef = useRef({ overlay: 0, final: 0 });
	const rebuildElementOverlaysRef = useRef<() => void>(() => undefined);
	const elementStlCacheVersionRef = useRef(0);
	const lastOverlayBuildRef = useRef<{
		geometry: THREE.BufferGeometry | null;
		positionVersion: number;
		placedElementsSignature: string;
		selectedBoxEditSignature: string;
		stlCacheVersion: number;
	} | null>(null);
	const correctedGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const correctedSignatureRef = useRef<string>('');
	const generalRafRef = useRef<number | null>(null);
	const bottomOverlayRebuildRafRef = useRef<number | null>(null);
	const baseGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const latticeBaseSourceGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const boxTessellatedBaseRef = useRef<THREE.BufferGeometry | null>(null);
	const boxPreviewGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const boxPreviewBasePositionsRef = useRef<Float32Array | null>(null);
	const bottomTextBaseGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const bottomTextDetailSignatureRef = useRef<string>('');
	const lastCommittedTextVisualSigRef = useRef<string>('');
	const elementBoxBaseGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const elementBoxTessellatedBaseRef = useRef<THREE.BufferGeometry | null>(null);
	const elementBoxPreviewGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const elementBoxPreviewBasePositionsRef = useRef<Float32Array | null>(null);
	// Live ref: updated on EVERY deformation callback so it always holds the latest
	// box-grid offsets — avoids stale-state issues from debounced React state updates.
	const pendingBoxGridOffsetsRef = useRef<BoxGridSavedOffsets | null>(null);
	const prevSavedBoxGridOffsetsRef = useRef(savedBoxGridOffsets);
	if (prevSavedBoxGridOffsetsRef.current !== savedBoxGridOffsets) {
		prevSavedBoxGridOffsetsRef.current = savedBoxGridOffsets;
		// Prop changed (cancel/revert or hydration) → discard stale pending data
		pendingBoxGridOffsetsRef.current = null;
	}
	const [baselineZ, setBaselineZ] = useState<number | null>(null);
	const [latticeEditKit, setLatticeEditKit] = useState<LatticeEditKit | null>(null);
	const [elementLatticeEditKit, setElementLatticeEditKit] =
		useState<LatticeEditKit | null>(null);

	const logViewerDebug = useCallback((event: string, payload?: Record<string, unknown>) => {
		console.debug(`[STLMesh ${meshRole}:${side}] ${event}`, payload ?? {});
	}, [meshRole, side]);

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

		// Canonicalize: heel-anchored along length axis with centered width/height,
		// then apply a global mm->world scale (same for every mesh).
		cloned.computeBoundingBox();
		const initialBox = cloned.boundingBox;
		const initialPos = cloned.getAttribute('position') as THREE.BufferAttribute | undefined;
		if (initialBox && initialPos) {
			const size = initialBox.getSize(new THREE.Vector3());
			const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
			const sizes = { x: size.x, y: size.y, z: size.z };
			axes.sort((a, b) => sizes[a] - sizes[b]);
			const heightAxis = axes[0];
			const widthAxis = axes[1];
			const lengthAxis = axes[2];

			const minLen =
				lengthAxis === 'x'
					? initialBox.min.x
					: lengthAxis === 'y'
						? initialBox.min.y
						: initialBox.min.z;
			const maxLen =
				lengthAxis === 'x'
					? initialBox.max.x
					: lengthAxis === 'y'
						? initialBox.max.y
						: initialBox.max.z;
			const lenSpan = Math.max(1e-6, maxLen - minLen);
			const centerW =
				widthAxis === 'x'
					? (initialBox.min.x + initialBox.max.x) * 0.5
					: widthAxis === 'y'
						? (initialBox.min.y + initialBox.max.y) * 0.5
						: (initialBox.min.z + initialBox.max.z) * 0.5;
			const centerH =
				heightAxis === 'x'
					? (initialBox.min.x + initialBox.max.x) * 0.5
					: heightAxis === 'y'
						? (initialBox.min.y + initialBox.max.y) * 0.5
						: (initialBox.min.z + initialBox.max.z) * 0.5;

			const slice = Math.max(lenSpan * 0.08, 1e-6);
			let minEndMinWidth = Number.POSITIVE_INFINITY;
			let minEndMaxWidth = Number.NEGATIVE_INFINITY;
			let minEndCount = 0;
			let maxEndMinWidth = Number.POSITIVE_INFINITY;
			let maxEndMaxWidth = Number.NEGATIVE_INFINITY;
			let maxEndCount = 0;

			for (let i = 0; i < initialPos.count; i++) {
				const x = initialPos.getX(i);
				const y = initialPos.getY(i);
				const z = initialPos.getZ(i);
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
			const canonicalHeelAtMin = flipLongAxis ? !heelAtMin : heelAtMin;

			for (let i = 0; i < initialPos.count; i++) {
				const x = initialPos.getX(i);
				const y = initialPos.getY(i);
				const z = initialPos.getZ(i);

				const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
				const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
				const hVal = heightAxis === 'x' ? x : heightAxis === 'y' ? y : z;

				const canonLen = canonicalHeelAtMin ? lenVal - minLen : maxLen - lenVal;
				const canonW = wVal - centerW;
				const canonH = hVal - centerH;

				if (lengthAxis === 'x') initialPos.setX(i, canonLen);
				else if (lengthAxis === 'y') initialPos.setY(i, canonLen);
				else initialPos.setZ(i, canonLen);

				if (widthAxis === 'x') initialPos.setX(i, canonW);
				else if (widthAxis === 'y') initialPos.setY(i, canonW);
				else initialPos.setZ(i, canonW);

				if (heightAxis === 'x') initialPos.setX(i, canonH);
				else if (heightAxis === 'y') initialPos.setY(i, canonH);
				else initialPos.setZ(i, canonH);
			}
			initialPos.needsUpdate = true;
		}

		const nextMmToWorld = MM_TO_WORLD;
		cloned.applyMatrix4(new THREE.Matrix4().makeScale(nextMmToWorld, nextMmToWorld, nextMmToWorld));

		// Apply Algemeen params directly to the *white STL* so changes are visible.
		// IMPORTANT: apply changes as *deltas* relative to the original model,
		// so it remains the same sole and only adjusts length/thickness/side height.
		cloned.computeBoundingBox();
		const bbox = cloned.boundingBox;
		const posAttr = cloned.getAttribute('position') as THREE.BufferAttribute | undefined;
		if (bbox && posAttr && applyGeneral) {
			const size = new THREE.Vector3();
			bbox.getSize(size);
			const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
			const sizes = { x: size.x, y: size.y, z: size.z };
			axes.sort((a, b) => sizes[a] - sizes[b]);
			const lengthAxis = axes[2];
			const widthAxis = axes[1];

			let minLen = lengthAxis === 'x' ? bbox.min.x : lengthAxis === 'y' ? bbox.min.y : bbox.min.z;
			let maxLen = lengthAxis === 'x' ? bbox.max.x : lengthAxis === 'y' ? bbox.max.y : bbox.max.z;
			let lenSpan = Math.max(1e-6, maxLen - minLen);

			// 1) Length fitting:
			// - default: shoe size heel-anchored stretch/compress
			// - when trimline exists: fit to scan length + offset envelope, then apply
			//   the user shoe-size delta relative to the scan-seeded shoe size.
			const shoeSizeScale =
				typeof shoeSize === 'number' && Number.isFinite(shoeSize) && shoeSize > 0
					? euSizeToLengthMm(shoeSize) / euSizeToLengthMm(DEFAULT_SHOE_SIZE)
					: 1;
			const seededShoeSizeScale =
				typeof seededShoeSize === 'number' && Number.isFinite(seededShoeSize) && seededShoeSize > 0
					? euSizeToLengthMm(seededShoeSize) / euSizeToLengthMm(DEFAULT_SHOE_SIZE)
					: shoeSizeScale;
			const relativeShoeSizeScale =
				seededShoeSizeScale > 1e-6 ? shoeSizeScale / seededShoeSizeScale : 1;
			const trimOffsetWorld = Math.max(0, trimlineOffsetMm + (trimlineAdjustments?.global ?? 0)) * nextMmToWorld;
			const targetTrimLength = targetTrimlineProfile
				? targetTrimlineProfile.lengthWorld + trimOffsetWorld * 2
				: null;
			const lengthScale = targetTrimLength
				? Math.max(0.8, Math.min(1.35, (targetTrimLength / lenSpan) * relativeShoeSizeScale))
				: shoeSizeScale;

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

			cloned.computeBoundingBox();
			const bb = cloned.boundingBox;
			if (bb) {
				bb.getSize(size);
				minLen = lengthAxis === 'x' ? bb.min.x : lengthAxis === 'y' ? bb.min.y : bb.min.z;
				maxLen = lengthAxis === 'x' ? bb.max.x : lengthAxis === 'y' ? bb.max.y : bb.max.z;
				lenSpan = Math.max(1e-6, maxLen - minLen);
				const currentTotalWidthWorld = Math.max(
					1e-6,
					widthAxis === 'x' ? size.x : widthAxis === 'y' ? size.y : size.z
				);

				let forefootMinW = Number.POSITIVE_INFINITY;
				let forefootMaxW = Number.NEGATIVE_INFINITY;
				let forefootCount = 0;
				for (let i = 0; i < posAttr.count; i++) {
					const x = posAttr.getX(i);
					const y = posAttr.getY(i);
					const z = posAttr.getZ(i);
					const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
					const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
					const tAlong = Math.max(0, Math.min(1, heelDist / lenSpan));
					if (tAlong < 0.55 || tAlong > 0.96) continue;
					const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
					forefootMinW = Math.min(forefootMinW, wVal);
					forefootMaxW = Math.max(forefootMaxW, wVal);
					forefootCount++;
				}
				const forefootReferenceWidthWorld =
					forefootCount > 20 && forefootMaxW > forefootMinW
						? Math.max(1e-6, forefootMaxW - forefootMinW)
						: currentTotalWidthWorld;

				const requestedTotalWidthScale =
					typeof targetForefootWidthMm === 'number' &&
						Number.isFinite(targetForefootWidthMm) &&
						targetForefootWidthMm > 0
						? Math.max(
							0.75,
							Math.min(1.5, (targetForefootWidthMm * nextMmToWorld) / forefootReferenceWidthWorld)
						)
						: 1;

				// 2) Auto width fitting from scan profile +2mm trimline envelope.
				if (targetTrimlineProfile && targetTrimlineProfile.halfWidthsWorld.length > 1) {
					const halfW = Math.max(
						1e-6,
						(widthAxis === 'x'
							? size.x
							: widthAxis === 'y'
								? size.y
								: size.z) * 0.5
					);
					const medialSign = side === 'left' ? 1 : -1;
					const toeSymReliefWorld = 0.6 * nextMmToWorld;
					const halluxReliefWorld = 1.8 * nextMmToWorld;
					const medialHeelReliefWorld = 0.8 * nextMmToWorld;
					const applyToeAndMedialRelief = (widthValue: number, tLen: number) => {
						const dist = widthValue - centerW;
						const absDistNorm = Math.max(0, Math.min(1, Math.abs(dist) / halfW));
						const signedNorm = Math.max(-1, Math.min(1, (dist / halfW) * medialSign));
						const edgeWeight = smoothstep(0.22, 1.0, absDistNorm);
						const medialWeight = smoothstep(0.08, 0.95, signedNorm);
						const toeWeight = smoothstep(0.74, 0.995, tLen);
						const halluxToeWeight = smoothstep(0.84, 0.998, tLen);
						const heelWeight = 1 - smoothstep(0.2, 0.42, tLen);

						const sign = dist > 0 ? 1 : dist < 0 ? -1 : 0;
						const symmetricToeShift = sign * toeSymReliefWorld * edgeWeight * toeWeight;
						const halluxShift = medialSign * halluxReliefWorld * medialWeight * halluxToeWeight;
						const medialHeelShift = medialSign * medialHeelReliefWorld * medialWeight * heelWeight;
						return widthValue + symmetricToeShift + halluxShift + medialHeelShift;
					};

					const sampleBaseTrimHalfWidth = (t: number) => {
						const arr = targetTrimlineProfile.halfWidthsWorld;
						const tt = Math.max(0, Math.min(1, t));
						const x = tt * (arr.length - 1);
						const i0 = Math.floor(x);
						const i1 = Math.min(arr.length - 1, i0 + 1);
						const a = arr[i0];
						const b = arr[i1];
						return (a + (b - a) * (x - i0) + trimOffsetWorld) * requestedTotalWidthScale;
					};

					const hasTrimlineHandleProfile =
						!!trimlineHandleProfile &&
						trimlineHandleProfile.bins > 1 &&
						trimlineHandleProfile.rightOffsetsMm.length > 1 &&
						trimlineHandleProfile.leftOffsetsMm.length > 1;
					const sampleHandleOffsetWorld = (t: number, widthSign: number) => {
						if (!hasTrimlineHandleProfile) return 0;
						const source = widthSign >= 0
							? trimlineHandleProfile.rightOffsetsMm
							: trimlineHandleProfile.leftOffsetsMm;
						const tt = Math.max(0, Math.min(1, t));
						const x = tt * (source.length - 1);
						const i0 = Math.floor(x);
						const i1 = Math.min(source.length - 1, i0 + 1);
						const mm = source[i0] + (source[i1] - source[i0]) * (x - i0);
						return mm * nextMmToWorld;
					};
					const sampleCenterlineTrimDeltaWorld = (t: number) => {
						if (hasTrimlineHandleProfile) {
							return (sampleHandleOffsetWorld(t, 1) + sampleHandleOffsetWorld(t, -1)) * 0.5;
						}
						return sampleTrimHalfWidth(t) - sampleBaseTrimHalfWidth(t);
					};

					const sampleTrimHalfWidth = (t: number) => {
						const tt = Math.max(0, Math.min(1, t));
						const baseHalf = sampleBaseTrimHalfWidth(t);

						// Apply per-region trimline adjustments with smooth blending
						if (hasTrimlineHandleProfile) return baseHalf;
						if (!trimlineAdjustments) return baseHalf;
						const { heel, midfoot, forefoot, toe } = trimlineAdjustments;
						// Region boundaries: heel [0, 0.25], midfoot [0.25, 0.55], forefoot [0.55, 0.82], toe [0.82, 1]
						// Use smoothstep blending between regions (6% overlap zones)
						const ss = (e0: number, e1: number, v: number) => {
							const c = Math.max(0, Math.min(1, (v - e0) / Math.max(1e-6, e1 - e0)));
							return c * c * (3 - 2 * c);
						};
						const heelW = 1 - ss(0.22, 0.28, tt);
						const midW = ss(0.22, 0.28, tt) * (1 - ss(0.52, 0.58, tt));
						const foreW = ss(0.52, 0.58, tt) * (1 - ss(0.79, 0.85, tt));
						const toeW = ss(0.79, 0.85, tt);
						const regionOffset = (heel * heelW + midfoot * midW + forefoot * foreW + toe * toeW) * nextMmToWorld;
						return Math.max(0, baseHalf + regionOffset);
					};

					// Build current insole half-width profile
					const bins = Math.max(64, targetTrimlineProfile.halfWidthsWorld.length);
					const currentHalfW = new Float32Array(bins).fill(0);
					const binHits = new Uint16Array(bins);
					const centerW =
						widthAxis === 'x'
							? (bb.min.x + bb.max.x) * 0.5
							: widthAxis === 'y'
								? (bb.min.y + bb.max.y) * 0.5
								: (bb.min.z + bb.max.z) * 0.5;

					for (let i = 0; i < posAttr.count; i++) {
						const x = posAttr.getX(i);
						const y = posAttr.getY(i);
						const z = posAttr.getZ(i);
						const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
						const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
						const t = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
						const idx = Math.min(bins - 1, Math.max(0, Math.round(t * (bins - 1))));
						const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
						const halfW = Math.abs(wVal - centerW);
						if (halfW > currentHalfW[idx]) currentHalfW[idx] = halfW;
						binHits[idx]++;
					}

					// Fill empty bins and smooth profile to avoid terracing artifacts.
					for (let i = 0; i < bins; i++) {
						if (binHits[i] > 0) continue;
						let l = i - 1;
						while (l >= 0 && binHits[l] === 0) l--;
						let r = i + 1;
						while (r < bins && binHits[r] === 0) r++;
						if (l >= 0 && r < bins) currentHalfW[i] = (currentHalfW[l] + currentHalfW[r]) * 0.5;
						else if (l >= 0) currentHalfW[i] = currentHalfW[l];
						else if (r < bins) currentHalfW[i] = currentHalfW[r];
					}

					const smoothedCurrent = new Float32Array(bins);
					for (let i = 0; i < bins; i++) {
						const a = currentHalfW[Math.max(0, i - 2)];
						const b = currentHalfW[Math.max(0, i - 1)];
						const c = currentHalfW[i];
						const d = currentHalfW[Math.min(bins - 1, i + 1)];
						const e = currentHalfW[Math.min(bins - 1, i + 2)];
						smoothedCurrent[i] = a * 0.1 + b * 0.2 + c * 0.4 + d * 0.2 + e * 0.1;
					}

					const sampleCurrentHalfWidth = (t: number) => {
						const tt = Math.max(0, Math.min(1, t));
						const x = tt * (bins - 1);
						const i0 = Math.floor(x);
						const i1 = Math.min(bins - 1, i0 + 1);
						return smoothedCurrent[i0] + (smoothedCurrent[i1] - smoothedCurrent[i0]) * (x - i0);
					};

					const uniformWidthScale = requestedTotalWidthScale;
					const toeShoulderHalf = Math.max(
						1e-6,
						sampleCurrentHalfWidth(0.75),
						sampleCurrentHalfWidth(0.78),
						sampleCurrentHalfWidth(0.82),
						sampleCurrentHalfWidth(0.88),
						sampleTrimHalfWidth(0.75),
						sampleTrimHalfWidth(0.78),
						sampleTrimHalfWidth(0.82),
						sampleTrimHalfWidth(0.88)
					);
					const toeTipMinHalf = toeShoulderHalf * 0.38;
					const toeTipMaxHalf = toeShoulderHalf * 0.88;
					const applyToeCapTemplate = (widthValue: number, tLen: number) => {
						const toeFillBlend = smoothstep(0.84, 0.995, tLen);
						const toeTipClampBlend = smoothstep(0.92, 0.998, tLen);
						if (toeFillBlend <= 1e-6 && toeTipClampBlend <= 1e-6) return widthValue;
						// Elliptical cap: stays wide at shoulder, narrows smoothly toward tip
						const u = Math.max(0, Math.min(1, (tLen - 0.78) / 0.22));
						const cap = Math.sqrt(Math.max(0, 1 - u * u));
						const minHalf = toeTipMinHalf + (toeShoulderHalf - toeTipMinHalf) * cap;
						const maxHalf = toeTipMaxHalf + (toeShoulderHalf - toeTipMaxHalf) * cap;
						const dist = widthValue - centerW;
						if (Math.abs(dist) < 1e-6) return widthValue;
						const sign = dist > 0 ? 1 : -1;
						const absDist = Math.abs(dist);
						// Fill dents: gently push concavities toward the min envelope
						const edgeBand = smoothstep(0.15, 0.85, Math.min(1, absDist / Math.max(1e-6, toeShoulderHalf)));
						if (edgeBand <= 1e-6) return widthValue;
						const fillStrength = toeFillBlend * (0.08 + edgeBand * 0.12);
						const filledAbs = absDist + (Math.max(minHalf, absDist) - absDist) * fillStrength;
						// Clamp over-expansion toward max envelope
						const clampStrength = toeTipClampBlend * edgeBand;
						const correctedAbs = filledAbs + (Math.min(maxHalf, filledAbs) - filledAbs) * clampStrength;
						return centerW + sign * correctedAbs;
					};

					for (let i = 0; i < posAttr.count; i++) {
						const x = posAttr.getX(i);
						const y = posAttr.getY(i);
						const z = posAttr.getZ(i);
						const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
						const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
						const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
						const targetHalfW = Math.max(1e-6, sampleTrimHalfWidth(tLen));

						const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
						const wScaled = centerW + (wVal - centerW) * uniformWidthScale;
						const wRelief = applyToeAndMedialRelief(wScaled, tLen);
						const wTemplated = applyToeCapTemplate(wRelief, tLen);
						const maxAllowedHalf = targetHalfW + (1.5 * nextMmToWorld);
						const distTemplated = wTemplated - centerW;
						const distSign = distTemplated >= 0 ? 1 : -1;
						const wNext = Math.abs(distTemplated) > maxAllowedHalf
							? centerW + distSign * maxAllowedHalf
							: wTemplated;
						if (widthAxis === 'x') posAttr.setX(i, wNext);
						else if (widthAxis === 'y') posAttr.setY(i, wNext);
						else posAttr.setZ(i, wNext);
					}

					const hasTrimlineDelta = !!trimlineAdjustments && (
						Math.abs(trimlineAdjustments.global ?? 0) > 1e-6 ||
						Math.abs(trimlineAdjustments.heel ?? 0) > 1e-6 ||
						Math.abs(trimlineAdjustments.midfoot ?? 0) > 1e-6 ||
						Math.abs(trimlineAdjustments.forefoot ?? 0) > 1e-6 ||
						Math.abs(trimlineAdjustments.toe ?? 0) > 1e-6
					);
					if (hasTrimlineHandleProfile) {
						for (let i = 0; i < posAttr.count; i++) {
							const x = posAttr.getX(i);
							const y = posAttr.getY(i);
							const z = posAttr.getZ(i);
							const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
							const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
							const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
							const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
							const dist = wVal - centerW;
							const absDist = Math.abs(dist);
							if (absDist < 1e-6) continue;
							const sourceHalf = Math.max(1e-6, sampleCurrentHalfWidth(tLen));
							const edgeBlend = smoothstep(0.18, 0.98, Math.min(1, absDist / sourceHalf));
							const nextAbs = Math.max(
								0,
								absDist + sampleHandleOffsetWorld(tLen, dist >= 0 ? 1 : -1) * edgeBlend,
							);
							const wNext = centerW + (dist >= 0 ? 1 : -1) * nextAbs;
							if (widthAxis === 'x') posAttr.setX(i, wNext);
							else if (widthAxis === 'y') posAttr.setY(i, wNext);
							else posAttr.setZ(i, wNext);
						}
						posAttr.needsUpdate = true;
					} else if (hasTrimlineDelta) {
						for (let i = 0; i < posAttr.count; i++) {
							const x = posAttr.getX(i);
							const y = posAttr.getY(i);
							const z = posAttr.getZ(i);
							const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
							const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
							const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
							const trimDeltaHalf = sampleTrimHalfWidth(tLen) - sampleBaseTrimHalfWidth(tLen);
							if (Math.abs(trimDeltaHalf) < 1e-6) continue;
							const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
							const dist = wVal - centerW;
							const absDist = Math.abs(dist);
							if (absDist < 1e-6) continue;
							const sourceHalf = Math.max(1e-6, sampleCurrentHalfWidth(tLen));
							const edgeBlend = smoothstep(0.18, 0.98, Math.min(1, absDist / sourceHalf));
							const nextAbs = Math.max(0, absDist + trimDeltaHalf * edgeBlend);
							const wNext = centerW + (dist >= 0 ? 1 : -1) * nextAbs;
							if (widthAxis === 'x') posAttr.setX(i, wNext);
							else if (widthAxis === 'y') posAttr.setY(i, wNext);
							else posAttr.setZ(i, wNext);
						}
					}

					for (let i = 0; i < posAttr.count; i++) {
						const x = posAttr.getX(i);
						const y = posAttr.getY(i);
						const z = posAttr.getZ(i);
						const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
						const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
						const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
						const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
						const sourceHalf = Math.max(1e-6, sampleCurrentHalfWidth(tLen));
						const centerBlend = 1 - smoothstep(0.08, 0.42, Math.min(1, Math.abs(wVal - centerW) / sourceHalf));
						if (centerBlend <= 1e-6) continue;
						const heelWeight = (1 - smoothstep(0.02, 0.16, tLen)) * centerBlend;
						const toeWeight = smoothstep(0.84, 0.995, tLen) * centerBlend;
						if (heelWeight <= 1e-6 && toeWeight <= 1e-6) continue;
						const tipDelta = sampleCenterlineTrimDeltaWorld(tLen);
						if (Math.abs(tipDelta) < 1e-6) continue;
						const heelDir = heelAtMin ? -1 : 1;
						const toeDir = heelAtMin ? 1 : -1;
						const nextLen = lenVal + tipDelta * heelWeight * heelDir + tipDelta * toeWeight * toeDir;
						if (lengthAxis === 'x') posAttr.setX(i, nextLen);
						else if (lengthAxis === 'y') posAttr.setY(i, nextLen);
						else posAttr.setZ(i, nextLen);
					}
					posAttr.needsUpdate = true;
				} else if (
					typeof targetForefootWidthMm === 'number' &&
					Number.isFinite(targetForefootWidthMm) &&
					targetForefootWidthMm > 0
				) {
					const targetWidthWorld = targetForefootWidthMm * nextMmToWorld;
					const widthScale = Math.max(0.75, Math.min(1.5, targetWidthWorld / forefootReferenceWidthWorld));
					const toeShoulderHalf = Math.max(1e-6, forefootReferenceWidthWorld * 0.5);
					const toeTipMinHalf = toeShoulderHalf * 0.38;
					const toeTipMaxHalf = toeShoulderHalf * 0.88;

					if (Number.isFinite(widthScale) && Math.abs(widthScale - 1) > 1e-3) {
						const centerW = widthAxis === 'x' ? (bb.min.x + bb.max.x) * 0.5 : widthAxis === 'y' ? (bb.min.y + bb.max.y) * 0.5 : (bb.min.z + bb.max.z) * 0.5;
						const halfW = Math.max(
							1e-6,
							(widthAxis === 'x'
								? size.x
								: widthAxis === 'y'
									? size.y
									: size.z) * 0.5
						);
						const medialSign = side === 'left' ? 1 : -1;
						const toeSymReliefWorld = 0.6 * nextMmToWorld;
						const halluxReliefWorld = 1.8 * nextMmToWorld;
						const medialHeelReliefWorld = 0.8 * nextMmToWorld;
						const applyToeAndMedialRelief = (widthValue: number, tLen: number) => {
							const dist = widthValue - centerW;
							const absDistNorm = Math.max(0, Math.min(1, Math.abs(dist) / halfW));
							const signedNorm = Math.max(-1, Math.min(1, (dist / halfW) * medialSign));
							const edgeWeight = smoothstep(0.22, 1.0, absDistNorm);
							const medialWeight = smoothstep(0.08, 0.95, signedNorm);
							const toeWeight = smoothstep(0.74, 0.995, tLen);
							const halluxToeWeight = smoothstep(0.84, 0.998, tLen);
							const heelWeight = 1 - smoothstep(0.2, 0.42, tLen);

							const sign = dist > 0 ? 1 : dist < 0 ? -1 : 0;
							const symmetricToeShift = sign * toeSymReliefWorld * edgeWeight * toeWeight;
							const halluxShift = medialSign * halluxReliefWorld * medialWeight * halluxToeWeight;
							const medialHeelShift = medialSign * medialHeelReliefWorld * medialWeight * heelWeight;
							return widthValue + symmetricToeShift + halluxShift + medialHeelShift;
						};
						const applyToeCapTemplate = (widthValue: number, tLen: number) => {
							const toeFillBlend = smoothstep(0.84, 0.995, tLen);
							const toeTipClampBlend = smoothstep(0.92, 0.998, tLen);
							if (toeFillBlend <= 1e-6 && toeTipClampBlend <= 1e-6) return widthValue;
							// Elliptical cap: stays wide at shoulder, narrows smoothly toward tip
							const u = Math.max(0, Math.min(1, (tLen - 0.78) / 0.22));
							const cap = Math.sqrt(Math.max(0, 1 - u * u));
							const minHalf = toeTipMinHalf + (toeShoulderHalf - toeTipMinHalf) * cap;
							const maxHalf = toeTipMaxHalf + (toeShoulderHalf - toeTipMaxHalf) * cap;
							const dist = widthValue - centerW;
							if (Math.abs(dist) < 1e-6) return widthValue;
							const sign = dist > 0 ? 1 : -1;
							const absDist = Math.abs(dist);
							// Fill dents: gently push concavities toward the min envelope
							const edgeBand = smoothstep(0.15, 0.85, Math.min(1, absDist / Math.max(1e-6, toeShoulderHalf)));
							if (edgeBand <= 1e-6) return widthValue;
							const fillStrength = toeFillBlend * (0.08 + edgeBand * 0.12);
							const filledAbs = absDist + (Math.max(minHalf, absDist) - absDist) * fillStrength;
							// Clamp over-expansion toward max envelope
							const clampStrength = toeTipClampBlend * edgeBand;
							const correctedAbs = filledAbs + (Math.min(maxHalf, filledAbs) - filledAbs) * clampStrength;
							return centerW + sign * correctedAbs;
						};

						for (let i = 0; i < posAttr.count; i++) {
							const x = posAttr.getX(i);
							const y = posAttr.getY(i);
							const z = posAttr.getZ(i);
							const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
							const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
							const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
							const safeScale = widthScale;
							const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
							const wScaled = centerW + (wVal - centerW) * safeScale;
							const wRelief = applyToeAndMedialRelief(wScaled, tLen);
							const wNext = applyToeCapTemplate(wRelief, tLen);

							if (widthAxis === 'x') posAttr.setX(i, wNext);
							else if (widthAxis === 'y') posAttr.setY(i, wNext);
							else posAttr.setZ(i, wNext);
						}
						posAttr.needsUpdate = true;
					}
				}

				const hasTrimlineHandleProfile =
					!!trimlineHandleProfile &&
					trimlineHandleProfile.bins > 1 &&
					trimlineHandleProfile.rightOffsetsMm.length > 1 &&
					trimlineHandleProfile.leftOffsetsMm.length > 1;
				const hasTrimlineRegionAdjustments =
					!!trimlineAdjustments && (
						Math.abs(trimlineAdjustments.global ?? 0) > 1e-6 ||
						Math.abs(trimlineAdjustments.heel ?? 0) > 1e-6 ||
						Math.abs(trimlineAdjustments.midfoot ?? 0) > 1e-6 ||
						Math.abs(trimlineAdjustments.forefoot ?? 0) > 1e-6 ||
						Math.abs(trimlineAdjustments.toe ?? 0) > 1e-6
					);

				if (
					(hasTrimlineHandleProfile || hasTrimlineRegionAdjustments) &&
					(!targetTrimlineProfile || targetTrimlineProfile.halfWidthsWorld.length <= 1)
				) {
					const centerW =
						widthAxis === 'x'
							? (bb.min.x + bb.max.x) * 0.5
							: widthAxis === 'y'
								? (bb.min.y + bb.max.y) * 0.5
								: (bb.min.z + bb.max.z) * 0.5;
					const bins = 96;
					const currentHalfW = new Float32Array(bins).fill(0);
					const binHits = new Uint16Array(bins);

					for (let i = 0; i < posAttr.count; i++) {
						const x = posAttr.getX(i);
						const y = posAttr.getY(i);
						const z = posAttr.getZ(i);
						const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
						const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
						const t = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
						const idx = Math.min(bins - 1, Math.max(0, Math.round(t * (bins - 1))));
						const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
						const halfW = Math.abs(wVal - centerW);
						if (halfW > currentHalfW[idx]) currentHalfW[idx] = halfW;
						binHits[idx]++;
					}

					for (let i = 0; i < bins; i++) {
						if (binHits[i] > 0) continue;
						let l = i - 1;
						while (l >= 0 && binHits[l] === 0) l--;
						let r = i + 1;
						while (r < bins && binHits[r] === 0) r++;
						if (l >= 0 && r < bins) currentHalfW[i] = (currentHalfW[l] + currentHalfW[r]) * 0.5;
						else if (l >= 0) currentHalfW[i] = currentHalfW[l];
						else if (r < bins) currentHalfW[i] = currentHalfW[r];
					}

					const smoothedCurrent = new Float32Array(bins);
					for (let i = 0; i < bins; i++) {
						const a = currentHalfW[Math.max(0, i - 2)];
						const b = currentHalfW[Math.max(0, i - 1)];
						const c = currentHalfW[i];
						const d = currentHalfW[Math.min(bins - 1, i + 1)];
						const e = currentHalfW[Math.min(bins - 1, i + 2)];
						smoothedCurrent[i] = a * 0.1 + b * 0.2 + c * 0.4 + d * 0.2 + e * 0.1;
					}

					const sampleCurrentHalfWidth = (t: number) => {
						const tt = Math.max(0, Math.min(1, t));
						const x = tt * (bins - 1);
						const i0 = Math.floor(x);
						const i1 = Math.min(bins - 1, i0 + 1);
						return smoothedCurrent[i0] + (smoothedCurrent[i1] - smoothedCurrent[i0]) * (x - i0);
					};

					const sampleRegionOffsetWorld = (t: number) => {
						const tt = Math.max(0, Math.min(1, t));
						const ss = (e0: number, e1: number, v: number) => {
							const c = Math.max(0, Math.min(1, (v - e0) / Math.max(1e-6, e1 - e0)));
							return c * c * (3 - 2 * c);
						};
						const heelW = 1 - ss(0.22, 0.28, tt);
						const midW = ss(0.22, 0.28, tt) * (1 - ss(0.52, 0.58, tt));
						const foreW = ss(0.52, 0.58, tt) * (1 - ss(0.79, 0.85, tt));
						const toeW = ss(0.79, 0.85, tt);
						const regionMm =
							(trimlineAdjustments?.global ?? 0) +
							(trimlineAdjustments?.heel ?? 0) * heelW +
							(trimlineAdjustments?.midfoot ?? 0) * midW +
							(trimlineAdjustments?.forefoot ?? 0) * foreW +
							(trimlineAdjustments?.toe ?? 0) * toeW;
						return regionMm * nextMmToWorld;
					};
					const sampleHandleOffsetWorld = (t: number, widthSign: number) => {
						if (!hasTrimlineHandleProfile) return 0;
						const source = widthSign >= 0
							? trimlineHandleProfile.rightOffsetsMm
							: trimlineHandleProfile.leftOffsetsMm;
						const tt = Math.max(0, Math.min(1, t));
						const x = tt * (source.length - 1);
						const i0 = Math.floor(x);
						const i1 = Math.min(source.length - 1, i0 + 1);
						const mm = source[i0] + (source[i1] - source[i0]) * (x - i0);
						return mm * nextMmToWorld;
					};
					const sampleCenterlineTrimDeltaWorld = (t: number) => {
						if (hasTrimlineHandleProfile) {
							return (sampleHandleOffsetWorld(t, 1) + sampleHandleOffsetWorld(t, -1)) * 0.5;
						}
						return sampleRegionOffsetWorld(t);
					};

					if (hasTrimlineHandleProfile) {
						for (let i = 0; i < posAttr.count; i++) {
							const x = posAttr.getX(i);
							const y = posAttr.getY(i);
							const z = posAttr.getZ(i);
							const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
							const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
							const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
							const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
							const dist = wVal - centerW;
							const absDist = Math.abs(dist);
							if (absDist < 1e-6) continue;
							const sourceHalf = Math.max(1e-6, sampleCurrentHalfWidth(tLen));
							const edgeBlend = smoothstep(0.18, 0.98, Math.min(1, absDist / sourceHalf));
							const nextAbs = Math.max(
								0,
								absDist + sampleHandleOffsetWorld(tLen, dist >= 0 ? 1 : -1) * edgeBlend,
							);
							const wNext = centerW + (dist >= 0 ? 1 : -1) * nextAbs;
							if (widthAxis === 'x') posAttr.setX(i, wNext);
							else if (widthAxis === 'y') posAttr.setY(i, wNext);
							else posAttr.setZ(i, wNext);
						}
					} else if (hasTrimlineRegionAdjustments) {
						for (let i = 0; i < posAttr.count; i++) {
							const x = posAttr.getX(i);
							const y = posAttr.getY(i);
							const z = posAttr.getZ(i);
							const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
							const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
							const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
							const baseHalfW = Math.max(1e-6, sampleCurrentHalfWidth(tLen));
							const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
							const dist = wVal - centerW;
							if (Math.abs(dist) < 1e-6) continue;
							const sign = dist > 0 ? 1 : -1;
							const targetHalfW = Math.max(0.5 * nextMmToWorld, baseHalfW + sampleRegionOffsetWorld(tLen));
							const scaledAbs = Math.abs(dist) * (targetHalfW / baseHalfW);
							const wNext = centerW + sign * scaledAbs;
							if (widthAxis === 'x') posAttr.setX(i, wNext);
							else if (widthAxis === 'y') posAttr.setY(i, wNext);
							else posAttr.setZ(i, wNext);
						}
					}

					for (let i = 0; i < posAttr.count; i++) {
						const x = posAttr.getX(i);
						const y = posAttr.getY(i);
						const z = posAttr.getZ(i);
						const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
						const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
						const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
						const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
						const sourceHalf = Math.max(1e-6, sampleCurrentHalfWidth(tLen));
						const centerBlend = 1 - smoothstep(0.08, 0.42, Math.min(1, Math.abs(wVal - centerW) / sourceHalf));
						if (centerBlend <= 1e-6) continue;
						const heelWeight = (1 - smoothstep(0.02, 0.16, tLen)) * centerBlend;
						const toeWeight = smoothstep(0.84, 0.995, tLen) * centerBlend;
						if (heelWeight <= 1e-6 && toeWeight <= 1e-6) continue;
						const tipDelta = sampleCenterlineTrimDeltaWorld(tLen);
						if (Math.abs(tipDelta) < 1e-6) continue;
						const heelDir = heelAtMin ? -1 : 1;
						const toeDir = heelAtMin ? 1 : -1;
						const nextLen = lenVal + tipDelta * heelWeight * heelDir + tipDelta * toeWeight * toeDir;
						if (lengthAxis === 'x') posAttr.setX(i, nextLen);
						else if (lengthAxis === 'y') posAttr.setY(i, nextLen);
						else posAttr.setZ(i, nextLen);
					}
					posAttr.needsUpdate = true;
				}
			}

			// Sole thickness + rim height are applied later as a fast post-step so slider edits blend smoothly.
		}

		// Recompute normals for better lighting. For STL inputs we also weld
		// duplicate vertices first, otherwise smooth shading can look striped.
		const smoothedGeometry = meshRole === 'insole'
			? smoothInsoleTopSurface(smoothInsoleWalls(weldAndSmoothNormals(cloned)))
			: (() => {
				cloned.computeVertexNormals();
				return cloned;
			})();

		let baseOut: THREE.BufferGeometry = smoothedGeometry;
		const finiteCheck = smoothedGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
		let posFinite = true;
		if (finiteCheck) {
			for (let ri = 0; ri < finiteCheck.count; ri++) {
				if (
					!Number.isFinite(finiteCheck.getX(ri)) ||
					!Number.isFinite(finiteCheck.getY(ri)) ||
					!Number.isFinite(finiteCheck.getZ(ri))
				) {
					posFinite = false;
					break;
				}
			}
		}
		if (!posFinite) {
			console.warn('[STLMesh] trimline cut produced non-finite vertices; using clean clone');
			const safe = rawGeometry.clone();
			safe.computeVertexNormals();
			safe.computeBoundingBox();
			safe.computeBoundingSphere();
			baseOut = safe;
		}

		return {
			baseGeometry: baseOut,
			mmToWorld: nextMmToWorld,
		};
	}, [
		rawGeometry,
		shoeSize,
		seededShoeSize,
		applyGeneral,
		flipLongAxis,
		meshRole,
		side,
		targetForefootWidthMm,
		targetTrimlineProfile,
		trimlineOffsetMm,
		trimlineAdjustments,
		trimlineHandleProfile,
	]);
	const mmToWorldRef = useRef(mmToWorld);
	mmToWorldRef.current = mmToWorld;

	// Create a working geometry that includes corrections
	const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
	const [sideProfileGeometry, setSideProfileGeometry] = useState<THREE.BufferGeometry | null>(null);
	useEffect(() => {
		geometryRef.current = geometry;
		return () => {
			if (geometryRef.current === geometry) {
				geometryRef.current = null;
			}
			geometry?.dispose();
		};
	}, [geometry]);
	useEffect(() => {
		return () => {
			sideProfileGeometry?.dispose();
		};
	}, [sideProfileGeometry]);

	// Overlay meshes for each placed element (rendered on top of insole)
	const [elementOverlays, setElementOverlays] = useState<ElementOverlayData[]>([]);
	const elementOverlaysRef = useRef<ElementOverlayData[]>([]);
	useEffect(() => {
		elementOverlaysRef.current = elementOverlays;
	}, [elementOverlays]);
	const elementOverlayById = useMemo(() => {
		const next = new Map<string, ElementOverlayData>();
		for (const overlay of elementOverlays) {
			next.set(overlay.elementId, overlay);
		}
		return next;
	}, [elementOverlays]);
	const [printElementHoverId, setPrintElementHoverId] = useState<string | null>(null);
	useEffect(() => {
		setPrintElementHoverId(null);
	}, [placedElementsSignature]);
	useEffect(() => {
		setPrintElementHoverId(null);
	}, [printSelectedElementId]);
	const applyPrintPrepZoneColorsToGeometry = useCallback(
		(hovered: PrintZoneId | null, selected: PrintZoneId | null) => {
			if (!geometry || meshRole !== 'insole' || !printPrepSplit) return;
			if (selected == null && hovered == null) {
				geometry.deleteAttribute('color');
				return;
			}
			applyPrintSplitZoneColors(geometry, {
				selectedZone: selected,
				hoveredZone: hovered,
				baseColor: color,
			});
		},
		[geometry, meshRole, printPrepSplit, color],
	);
	const printPrepZoneTintActive =
		Boolean(printPrepSplit) &&
		meshRole === 'insole' &&
		prepZoneColorsLive &&
		(printPrepSelectedZone != null || printPrepHoveredZone != null);
	useEffect(() => {
		if (!printPrepSplit || meshRole !== 'insole') {
			setPrepZoneColorsLive(false);
		}
	}, [printPrepSplit, meshRole]);
	const clearElementOverlays = useCallback(() => {
		lastRenderedOverlaySignatureRef.current = '';
		setElementOverlays((prev) => {
			if (prev.length === 0) return prev;
			prev.forEach((data) => data.geometry.dispose());
			return [];
		});
	}, []);

	// Pre-loaded STL geometries for elements that have stlUrl in their catalog entry
	const elementStlGeometriesRef = useRef<Map<string, THREE.BufferGeometry>>(new Map());
	const preloadElementStlLoadUrls = useMemo(() => {
		const next = new Map<string, string[]>();
		for (const item of [...ELEMENTEN_ITEMS, ...DIEPELEMENTEN_ITEMS]) {
			const preferredUrl = getElementPreferredStlUrl(item);
			const loadUrls = getElementStlLoadUrls(item);
			if (!preferredUrl || loadUrls.length === 0 || next.has(preferredUrl)) continue;
			next.set(preferredUrl, loadUrls);
		}
		return next;
	}, []);
	const elementStlUrlsKey = useMemo(() => {
		const urls = new Set<string>(preloadElementStlLoadUrls.keys());
		for (const el of placedElements ?? []) {
			const item = getElementByKey(el.libraryKey);
			const stlUrl = item ? getElementPreferredStlUrl(item) : undefined;
			if (stlUrl) urls.add(stlUrl);
		}
		return Array.from(urls).sort().join('|');
	}, [placedElements, preloadElementStlLoadUrls]);

	// Load element STL files when placed elements change
	useEffect(() => {
		const desiredUrls = new Set<string>(preloadElementStlLoadUrls.keys());
		for (const el of placedElements ?? []) {
			const item = getElementByKey(el.libraryKey);
			const stlUrl = item ? getElementPreferredStlUrl(item) : undefined;
			if (stlUrl) desiredUrls.add(stlUrl);
		}
		for (const [url, geometry] of elementStlGeometriesRef.current.entries()) {
			if (!desiredUrls.has(url)) {
				geometry.dispose();
				elementStlGeometriesRef.current.delete(url);
				elementStlCacheVersionRef.current += 1;
			}
		}
		if (desiredUrls.size === 0) return;

		const loader = new STLLoader();
		const pending = new Map<string, Promise<THREE.BufferGeometry>>();
		const loadGeometry = (urls: string[], index = 0): Promise<THREE.BufferGeometry> => new Promise((resolve, reject) => {
			const url = urls[index];
			if (!url) {
				reject(new Error('No STL URL available'));
				return;
			}
			loader.load(
				url,
				resolve,
				undefined,
				(err) => {
					if (index < urls.length - 1) {
						loadGeometry(urls, index + 1).then(resolve).catch(reject);
						return;
					}
					reject(err);
				},
			);
		});

		for (const preferredUrl of desiredUrls) {
			if (elementStlGeometriesRef.current.has(preferredUrl)) continue;
			if (pending.has(preferredUrl)) continue;
			const loadUrls = preloadElementStlLoadUrls.get(preferredUrl) ?? [preferredUrl];
			pending.set(preferredUrl, loadGeometry(loadUrls));
		}

		if (pending.size === 0) return;

		let cancelled = false;
		Promise.all(
			Array.from(pending.entries()).map(async ([url, p]) => {
				try {
					const geom = await p;
					if (!cancelled) {
						elementStlGeometriesRef.current.set(url, geom);
						elementStlCacheVersionRef.current += 1;
					}
				} catch (err) {
					console.warn(`Failed to load element STL: ${url}`, err);
				}
			})
		).then(() => {
			if (!cancelled) {
				lastOverlayBuildRef.current = null;
				rebuildElementOverlaysRef.current();
			}
		});

		return () => { cancelled = true; };

	}, [elementStlUrlsKey, placedElements, preloadElementStlLoadUrls]);

	useEffect(() => {
		return () => {
			if (animRafRef.current != null) cancelAnimationFrame(animRafRef.current);
			if (placedElementsRafRef.current != null) cancelAnimationFrame(placedElementsRafRef.current);
			if (overlayRafRef.current != null) cancelAnimationFrame(overlayRafRef.current);
			if (generalRafRef.current != null) cancelAnimationFrame(generalRafRef.current);
			if (bottomOverlayRebuildRafRef.current != null) cancelAnimationFrame(bottomOverlayRebuildRafRef.current);
			elementOverlaysRef.current.forEach((overlay) => overlay.geometry.dispose());
			elementOverlaysRef.current = [];
			for (const geometry of elementStlGeometriesRef.current.values()) {
				geometry.dispose();
			}
			elementStlGeometriesRef.current.clear();
			correctedGeometryRef.current?.dispose();
			correctedGeometryRef.current = null;
			baseGeometryRef.current?.dispose();
			baseGeometryRef.current = null;
			latticeBaseSourceGeometryRef.current = null;
			boxTessellatedBaseRef.current?.dispose();
			boxTessellatedBaseRef.current = null;
			boxPreviewGeometryRef.current?.dispose();
			boxPreviewGeometryRef.current = null;
			bottomTextBaseGeometryRef.current?.dispose();
			bottomTextBaseGeometryRef.current = null;
			bottomTextDetailSignatureRef.current = '';
			elementBoxBaseGeometryRef.current?.dispose();
			elementBoxBaseGeometryRef.current = null;
			elementBoxTessellatedBaseRef.current?.dispose();
			elementBoxTessellatedBaseRef.current = null;
			elementBoxPreviewGeometryRef.current?.dispose();
			elementBoxPreviewGeometryRef.current = null;
			lastOverlayBuildRef.current = null;
			pendingBoxGridOffsetsRef.current = null;
		};
	}, []);

	const rebuildElementOverlays = useCallback(() => {
		const geom = geometryRef.current;
		const posAttr = geom?.getAttribute('position') as THREE.BufferAttribute | undefined;
		const positionVersion = posAttr?.version ?? 0;
		const stlCacheVersion = elementStlCacheVersionRef.current;
		const currentPlacedElementsSignature = placedElementsSignatureRef.current;
		const currentSelectedElementBoxEditSignature = selectedElementBoxEditSignatureRef.current;
		const overlayBuildSignature = `${positionVersion}|${currentPlacedElementsSignature}|${currentSelectedElementBoxEditSignature}|${stlCacheVersion}`;
		const currentPlacedElements = placedElementsRef.current;
		const currentSelectedBoxEdit = selectedElementBoxEditRef.current;
		const currentHasPlacedElements = hasPlacedElementsRef.current;
		const currentMmToWorld = mmToWorldRef.current || 1;
		const lastBuild = lastOverlayBuildRef.current;
		if (
			lastBuild &&
			lastBuild.geometry === geom &&
			lastBuild.positionVersion === positionVersion &&
			lastBuild.placedElementsSignature === currentPlacedElementsSignature &&
			lastBuild.selectedBoxEditSignature === currentSelectedElementBoxEditSignature &&
			lastBuild.stlCacheVersion === stlCacheVersion
		) {
			return;
		}

		if (!geom || !currentHasPlacedElements || !currentPlacedElements) {
			lastOverlayBuildRef.current = {
				geometry: geom ?? null,
				positionVersion,
				placedElementsSignature: currentPlacedElementsSignature,
				selectedBoxEditSignature: currentSelectedElementBoxEditSignature,
				stlCacheVersion,
			};
			logViewerDebug('overlay-clear', {
				positionVersion,
				signature: overlayBuildSignature,
			});
			clearElementOverlays();
			invalidateRef.current();
			return;
		}
		const startedAt = performance.now();
		const boxOffsetsByElementId = new Map<string, BoxGridSavedOffsets | null | undefined>();
		const trimlineProfileByElementId = new Map<string, TrimlineHandleProfile | null | undefined>();
		for (const element of currentPlacedElements) {
			boxOffsetsByElementId.set(element.id, element.boxGridOffsets);
			trimlineProfileByElementId.set(element.id, element.trimlineHandleProfile);
		}
		if (currentSelectedBoxEdit?.elementId) {
			boxOffsetsByElementId.set(currentSelectedBoxEdit.elementId, currentSelectedBoxEdit.savedOffsets);
		}
		const overlays = buildElementOverlayGeometries(geom, currentPlacedElements, {
			mmToWorld: currentMmToWorld,
			stlGeometries: elementStlGeometriesRef.current,
		});
		const mw = currentMmToWorld;
		for (const overlay of overlays) {
			const effectiveOffsets = boxOffsetsByElementId.get(overlay.elementId);
			overlay.geometry = applySavedBoxGridOffsetsToGeometry(overlay.geometry, effectiveOffsets, mw);
			// Trimline edit follows box-grid so the rim reshape matches the geometry the
			// user was dragging on (box lattice is applied first during editing too).
			applyElementTrimlineFootprint(overlay.geometry, trimlineProfileByElementId.get(overlay.elementId), mw);
		}
		lastOverlayBuildRef.current = {
			geometry: geom,
			positionVersion,
			placedElementsSignature: currentPlacedElementsSignature,
			selectedBoxEditSignature: currentSelectedElementBoxEditSignature,
			stlCacheVersion,
		};
		const nextRenderedOverlaySignature = `${overlayBuildSignature}|${overlays.length}`;
		if (lastRenderedOverlaySignatureRef.current === nextRenderedOverlaySignature) {
			overlays.forEach((overlay) => overlay.geometry.dispose());
			logViewerDebug('overlay-deduped', {
				ms: Number((performance.now() - startedAt).toFixed(1)),
				overlays: overlays.length,
				signature: overlayBuildSignature,
			});
			recordOverlayRebuild(Number((performance.now() - startedAt).toFixed(1)));
			invalidateRef.current();
			return;
		}
		lastRenderedOverlaySignatureRef.current = nextRenderedOverlaySignature;
		const sequence = ++debugBuildCountersRef.current.overlay;
		logViewerDebug('overlay-rebuild', {
			seq: sequence,
			ms: Number((performance.now() - startedAt).toFixed(1)),
			overlays: overlays.length,
			elements: currentPlacedElements.length,
			positionVersion,
			signature: overlayBuildSignature,
		});
		recordOverlayRebuild(Number((performance.now() - startedAt).toFixed(1)));
		setElementOverlays(prev => { prev.forEach(d => d.geometry.dispose()); return overlays; });
		invalidateRef.current();
	}, [clearElementOverlays, logViewerDebug]);

	rebuildElementOverlaysRef.current = rebuildElementOverlays;

	const scheduleElementOverlayRebuild = useCallback(() => {
		if (overlayRafRef.current != null) return;
		overlayRafRef.current = requestAnimationFrame(() => {
			overlayRafRef.current = null;
			rebuildElementOverlaysRef.current();
		});
	}, []);

	// EVA block: contour-following solid block (side walls + bottom cap, no top)
	// Uses a ref + state approach so it rebuilds whenever geometry positions
	// change (trimline, hielrand dikte, corrections, etc.), not just when
	// the geometry object reference changes.
	const [evaBlock, setEvaBlock] = useState<{ geometry: THREE.BufferGeometry } | null>(null);
	const evaBlockRef = useRef<THREE.BufferGeometry | null>(null);

	const rebuildEvaBlock = useCallback(() => {
		const geom = geometryRef.current;
		if (!evaBlockMode || !geom) {
			if (evaBlockRef.current) {
				evaBlockRef.current.dispose();
				evaBlockRef.current = null;
			}
			setEvaBlock(null);
			return;
		}

		geom.computeBoundingBox();
		const bb = geom.boundingBox!;
		const sz = bb.getSize(new THREE.Vector3());

		// Detect axes: height = smallest, then width, then length
		const dimArr: Array<{ i: number; v: number }> = [
			{ i: 0, v: sz.x },
			{ i: 1, v: sz.y },
			{ i: 2, v: sz.z },
		];
		dimArr.sort((a, b) => a.v - b.v);
		const hI = dimArr[0].i; // height axis index (0=x, 1=y, 2=z)
		const uI = dimArr[1].i; // width axis
		const vI = dimArr[2].i; // length axis

		const pos = geom.getAttribute('position') as THREE.BufferAttribute;
		if (!pos || pos.count < 3) return;

		const gA = (idx: number, axis: number) =>
			axis === 0 ? pos.getX(idx) : axis === 1 ? pos.getY(idx) : pos.getZ(idx);

		// Centroid in the UV plane
		let cu = 0, cv = 0;
		for (let i = 0; i < pos.count; i++) { cu += gA(i, uI); cv += gA(i, vI); }
		cu /= pos.count;
		cv /= pos.count;

		// Radial sweep: 360 angular bins → outermost vertex per bin for smooth contour
		const BINS = 360;
		const best = new Array<{ u: number; v: number; h: number; d: number } | null>(BINS).fill(null);

		for (let i = 0; i < pos.count; i++) {
			const u = gA(i, uI);
			const v = gA(i, vI);
			const h = gA(i, hI);
			const du = u - cu, dv = v - cv;
			const d = Math.sqrt(du * du + dv * dv);
			const a = Math.atan2(dv, du);
			const bin = ((Math.floor(((a + Math.PI) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS;
			const cur = best[bin];
			if (!cur || d > cur.d) best[bin] = { u, v, h, d };
		}

		// Collect valid outline points (skip empty bins)
		const raw = best.filter((p): p is NonNullable<typeof p> => p !== null);
		if (raw.length < 3) return;

		// ── Laplacian smoothing of the contour (3 passes) to remove jagged edges ──
		// Smooth u, v, and h separately so the wall follows a clean curve.
		const contourU = raw.map(p => p.u);
		const contourV = raw.map(p => p.v);
		const contourH = raw.map(p => p.h);
		const cn2 = raw.length;
		const SMOOTH_PASSES = 4;
		const SMOOTH_ALPHA = 0.45;
		for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
			const tmpU = contourU.slice();
			const tmpV = contourV.slice();
			const tmpH = contourH.slice();
			for (let i = 0; i < cn2; i++) {
				const prev = (i - 1 + cn2) % cn2;
				const next = (i + 1) % cn2;
				tmpU[i] = contourU[i] + SMOOTH_ALPHA * ((contourU[prev] + contourU[next]) * 0.5 - contourU[i]);
				tmpV[i] = contourV[i] + SMOOTH_ALPHA * ((contourV[prev] + contourV[next]) * 0.5 - contourV[i]);
				tmpH[i] = contourH[i] + SMOOTH_ALPHA * ((contourH[prev] + contourH[next]) * 0.5 - contourH[i]);
			}
			for (let i = 0; i < cn2; i++) {
				contourU[i] = tmpU[i];
				contourV[i] = tmpV[i];
				contourH[i] = tmpH[i];
			}
		}

		const contour = raw.map((_, i) => ({
			u: contourU[i], v: contourV[i], h: contourH[i], d: raw[i].d,
		}));

		// Height bounds
		const hMin = hI === 0 ? bb.min.x : hI === 1 ? bb.min.y : bb.min.z;
		const hMax = hI === 0 ? bb.max.x : hI === 1 ? bb.max.y : bb.max.z;
		const hSpan = hMax - hMin;
		const bottomH = hMin - hSpan * 0.08;

		// Helper: create xyz in correct axis order
		const v3 = (u: number, v: number, h: number): [number, number, number] => {
			const r: [number, number, number] = [0, 0, 0];
			r[uI] = u; r[vI] = v; r[hI] = h;
			return r;
		};

		const verts: number[] = [];
		const n = contour.length;

		// ── Side walls: quad per consecutive pair, from edge vertex height → bottom ──
		// Winding: outward-facing (normals point away from centroid)
		for (let i = 0; i < n; i++) {
			const a = contour[i];
			const b = contour[(i + 1) % n];
			const tA = v3(a.u, a.v, a.h);
			const tB = v3(b.u, b.v, b.h);
			const bA = v3(a.u, a.v, bottomH);
			const bB = v3(b.u, b.v, bottomH);
			// Two triangles per quad — outward winding
			verts.push(...tA, ...tB, ...bA);
			verts.push(...tB, ...bB, ...bA);
		}

		// ── Bottom cap: triangle fan from centroid (facing downward) ──
		const cB = v3(cu, cv, bottomH);
		for (let i = 0; i < n; i++) {
			const pA = v3(contour[i].u, contour[i].v, bottomH);
			const pB = v3(contour[(i + 1) % n].u, contour[(i + 1) % n].v, bottomH);
			verts.push(...cB, ...pA, ...pB);
		}

		const blockGeom = new THREE.BufferGeometry();
		blockGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

		// Merge + smooth normals so walls render as one clean surface
		const welded = BufferGeometryUtils.mergeVertices(blockGeom, 1e-4);
		welded.computeVertexNormals();
		blockGeom.dispose();

		// Smooth normals across the wall for a clean look
		const nAttr = welded.getAttribute('normal') as THREE.BufferAttribute | undefined;
		if (nAttr && welded.index) {
			const normals = nAttr.array as Float32Array;
			const vc = nAttr.count;
			const idx2 = welded.index.array;
			const fc = idx2.length / 3;
			const nbSets: Set<number>[] = Array.from({ length: vc }, () => new Set<number>());
			for (let f = 0; f < fc; f++) {
				const a2 = idx2[f * 3], b2 = idx2[f * 3 + 1], c2 = idx2[f * 3 + 2];
				nbSets[a2].add(b2); nbSets[a2].add(c2);
				nbSets[b2].add(a2); nbSets[b2].add(c2);
				nbSets[c2].add(a2); nbSets[c2].add(b2);
			}
			const ntmp = new Float32Array(normals.length);
			for (let p = 0; p < 3; p++) {
				for (let vv = 0; vv < vc; vv++) {
					const nbs = nbSets[vv];
					let sx2 = normals[vv * 3], sy2 = normals[vv * 3 + 1], sz2 = normals[vv * 3 + 2];
					for (const nb of nbs) {
						sx2 += normals[nb * 3]; sy2 += normals[nb * 3 + 1]; sz2 += normals[nb * 3 + 2];
					}
					const len = Math.sqrt(sx2 * sx2 + sy2 * sy2 + sz2 * sz2) || 1;
					ntmp[vv * 3] = sx2 / len; ntmp[vv * 3 + 1] = sy2 / len; ntmp[vv * 3 + 2] = sz2 / len;
				}
				normals.set(ntmp);
			}
			nAttr.needsUpdate = true;
		}

		if (evaBlockRef.current) evaBlockRef.current.dispose();
		evaBlockRef.current = welded;
		setEvaBlock({ geometry: welded });
	}, [evaBlockMode]);

	// Clean up EVA block on unmount
	useEffect(() => {
		return () => {
			if (evaBlockRef.current) {
				evaBlockRef.current.dispose();
				evaBlockRef.current = null;
			}
		};
	}, []);

	const rebuildEvaBlockRef = useRef(rebuildEvaBlock);
	rebuildEvaBlockRef.current = rebuildEvaBlock;

	// Rebuild EVA block when evaBlockMode toggles
	useEffect(() => {
		rebuildEvaBlock();
	}, [evaBlockMode, rebuildEvaBlock]);

	// Debounced corrections application to prevent UI blocking
	const pendingCorrectionsRef = useRef<OntwerpCorrections | undefined>(undefined);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const smoothstep01 = useCallback((edge0: number, edge1: number, x: number) => {
		const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
		return t * t * (3 - 2 * t);
	}, []);

	const applyTotalInsoleHeight = useCallback(
		(geom: THREE.BufferGeometry, targetHeightMm: number | null | undefined) => {
			applyGeometryTotalHeight(geom, targetHeightMm, mmToWorld || 1);
		},
		[mmToWorld]
	);

	const applySoleThicknessAfterCorrections = useCallback(
		(geom: THREE.BufferGeometry) => {
			const DEFAULT_SOLE_THICKNESS_MM = 2;
			const thicknessDeltaMm = (soleThicknessMm ?? DEFAULT_SOLE_THICKNESS_MM) - DEFAULT_SOLE_THICKNESS_MM;
			const thicknessDeltaWorld = thicknessDeltaMm * (mmToWorld || 1);
			if (Math.abs(thicknessDeltaWorld) < 1e-6) return;
			const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
			if (!posAttr) return;

			// Ensure we have normals to identify bottom-facing vertices.
			geom.computeVertexNormals();
			const normAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined;
			if (!normAttr) return;

			geom.computeBoundingBox();
			const bbox = geom.boundingBox;
			if (!bbox) return;

			// Zooldikte: extrude the bottom (outsole) surface downward uniformly.
			// Identify the thickness axis (smallest bbox dimension).
			const size = bbox.getSize(new THREE.Vector3());
			const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
			const sizes = { x: size.x, y: size.y, z: size.z };
			axes.sort((a, b) => sizes[a] - sizes[b]);
			const thicknessAxis = axes[0];
			const widthAxis = axes[1];
			const lengthAxis = axes[2];

			const axIdx = thicknessAxis === 'x' ? 0 : thicknessAxis === 'y' ? 1 : 2;
			const getAxis = (i: number, axis: 'x' | 'y' | 'z') =>
				axis === 'x' ? posAttr.getX(i) : axis === 'y' ? posAttr.getY(i) : posAttr.getZ(i);
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
			const getNormal = (i: number) => {
				if (axIdx === 0) return normAttr.getX(i);
				if (axIdx === 1) return normAttr.getY(i);
				return normAttr.getZ(i);
			};
			const minL = lengthAxis === 'x' ? bbox.min.x : lengthAxis === 'y' ? bbox.min.y : bbox.min.z;
			const maxL = lengthAxis === 'x' ? bbox.max.x : lengthAxis === 'y' ? bbox.max.y : bbox.max.z;
			const minW = widthAxis === 'x' ? bbox.min.x : widthAxis === 'y' ? bbox.min.y : bbox.min.z;
			const maxW = widthAxis === 'x' ? bbox.max.x : widthAxis === 'y' ? bbox.max.y : bbox.max.z;
			const minH = thicknessAxis === 'x' ? bbox.min.x : thicknessAxis === 'y' ? bbox.min.y : bbox.min.z;
			const maxH = thicknessAxis === 'x' ? bbox.max.x : thicknessAxis === 'y' ? bbox.max.y : bbox.max.z;
			const lengthSpan = Math.max(1e-6, maxL - minL);
			const widthSpan = Math.max(1e-6, maxW - minW);
			const heightSpan = Math.max(1e-6, maxH - minH);
			const centerW = (minW + maxW) * 0.5;
			const halfW = Math.max(1e-6, widthSpan * 0.5);

			// --- Step 1: compute initial per-vertex weight from normals ---
			const count = posAttr.count;
			const weights = new Float32Array(count);
			for (let i = 0; i < count; i++) {
				const nComp = getNormal(i); // negative = bottom-facing
				weights[i] = Math.max(0, -nComp);
			}

			// --- Step 2: build adjacency from index buffer and diffuse weights ---
			// This blends the hard normal-based boundary into a smooth gradient so
			// there's no visible seam between the thickened outsole and the top surface.
			const idxAttr = geom.getIndex();
			if (idxAttr) {
				// Build adjacency: for each vertex, collect its neighbours.
				const adj = new Array<Set<number>>(count);
				for (let i = 0; i < count; i++) adj[i] = new Set();
				const idx = idxAttr.array;
				for (let f = 0; f < idx.length; f += 3) {
					const a = idx[f], b = idx[f + 1], c = idx[f + 2];
					adj[a].add(b); adj[a].add(c);
					adj[b].add(a); adj[b].add(c);
					adj[c].add(a); adj[c].add(b);
				}

				// A generous number of Laplacian diffusion passes so the weight field
				// transitions very gradually, eliminating visible seams at edges.
				const DIFF_PASSES = 18;
				const DIFF_ALPHA = 0.5;
				const tmp = new Float32Array(count);
				for (let pass = 0; pass < DIFF_PASSES; pass++) {
					for (let i = 0; i < count; i++) {
						const nbrs = adj[i];
						if (nbrs.size === 0) { tmp[i] = weights[i]; continue; }
						let sum = 0;
						for (const n of nbrs) sum += weights[n];
						tmp[i] = weights[i] * (1 - DIFF_ALPHA) + (sum / nbrs.size) * DIFF_ALPHA;
					}
					weights.set(tmp);
				}
			}

			// --- Step 2b: targeted forefoot sidewall wrap ---
			// The remaining visible seam is mainly at the forefoot sidewall where the
			// added outsole thickness transitions into the original shell. Boost the
			// medium-weight lower sidewall vertices only in the forefoot so it reads
			// as one continuous piece without changing the heel/arch areas.
			const endSlice = Math.max(lengthSpan * 0.08, 1e-6);
			let minEndMinWidth = Number.POSITIVE_INFINITY;
			let minEndMaxWidth = Number.NEGATIVE_INFINITY;
			let maxEndMinWidth = Number.POSITIVE_INFINITY;
			let maxEndMaxWidth = Number.NEGATIVE_INFINITY;
			let minEndCount = 0;
			let maxEndCount = 0;
			for (let i = 0; i < count; i++) {
				const lenVal = getAxis(i, lengthAxis);
				const widthVal = getAxis(i, widthAxis);
				if (lenVal <= minL + endSlice) {
					minEndMinWidth = Math.min(minEndMinWidth, widthVal);
					minEndMaxWidth = Math.max(minEndMaxWidth, widthVal);
					minEndCount++;
				}
				if (lenVal >= maxL - endSlice) {
					maxEndMinWidth = Math.min(maxEndMinWidth, widthVal);
					maxEndMaxWidth = Math.max(maxEndMaxWidth, widthVal);
					maxEndCount++;
				}
			}
			const minEndWidthSpan =
				minEndCount > 10 ? Math.max(0, minEndMaxWidth - minEndMinWidth) : widthSpan;
			const maxEndWidthSpan =
				maxEndCount > 10 ? Math.max(0, maxEndMaxWidth - maxEndMinWidth) : widthSpan;
			const heelAtMin = minEndWidthSpan >= maxEndWidthSpan;

			for (let i = 0; i < count; i++) {
				const lenVal = getAxis(i, lengthAxis);
				const widthVal = getAxis(i, widthAxis);
				const rawU = (lenVal - minL) / lengthSpan;
				const u = Math.max(0, Math.min(1, heelAtMin ? rawU : 1 - rawU));
				const hNorm = (getH(i) - minH) / heightSpan;
				const sideNorm = Math.abs((widthVal - centerW) / halfW);
				const baseWeight = weights[i];
				const forefootWeight = smoothstep01(0.6, 0.86, u);
				const lowerSideWeight = 1 - smoothstep01(0.24, 0.72, hNorm);
				const sidewallFocus = smoothstep01(0.45, 0.82, sideNorm);
				const seamBandWeight =
					smoothstep01(0.08, 0.28, baseWeight) * (1 - smoothstep01(0.6, 0.92, baseWeight));
				const wrapBoost = forefootWeight * lowerSideWeight * sidewallFocus * seamBandWeight;
				if (wrapBoost <= 1e-4) continue;
				weights[i] = Math.max(baseWeight, Math.min(1, baseWeight + wrapBoost * 0.65));
			}

			// --- Step 3: apply displacement ---
			for (let i = 0; i < count; i++) {
				const w = weights[i];
				if (w <= 0.001) continue;
				const h = getH(i);
				setH(i, h - thicknessDeltaWorld * w);
			}
			posAttr.needsUpdate = true;

			// Recompute normals after vertex displacement so shading is smooth
			// across the transition and there's no visible lighting seam.
			geom.computeVertexNormals();
		},
		[soleThicknessMm, mmToWorld]
	);

	const applyTotalInsoleHeightAfterCorrections = useCallback((geom: THREE.BufferGeometry) => {
		applyTotalInsoleHeight(geom, totalInsoleHeightMm);
	}, [applyTotalInsoleHeight, totalInsoleHeightMm]);

	const animateGeometryTo = useCallback((target: THREE.BufferGeometry) => {
		const existing = geometryRef.current;
		const currentSavedBoxGridOffsets = savedBoxGridOffsetsRef.current;
		const currentBottomTextOverlay = bottomTextOverlayRef.current;
		const currentOnGeometryReady = onGeometryReadyRef.current;
		const finalizeGeometryUpdate = (geometryToFinalize: THREE.BufferGeometry) => {
			geometryToFinalize.computeVertexNormals();
			currentOnGeometryReady?.(geometryToFinalize, { mmToWorld: mmToWorld || 1 });
			const ppSplit = Boolean(printPrepSplit);
			const ppSel = printPrepSelectedZone;
			const ppHov = printPrepHoveredZone;
			const prepTintActive =
				ppSplit && meshRole === 'insole' && (ppSel != null || ppHov != null);
			if (prepTintActive) {
				applyPrintSplitZoneColors(geometryToFinalize, {
					selectedZone: ppSel,
					hoveredZone: ppHov,
					baseColor: color,
				});
			} else if (showZones) applyZoneColors(geometryToFinalize);
			else if (heatmap) applyHeightmapColors(geometryToFinalize);
			else if (deviationMap) applyDeviationColors(geometryToFinalize);
			else if (clampDebug && meshRole === 'insole') {
				const applied = applyForefootClampDebugColors(geometryToFinalize, {
					side,
					mmToWorld: mmToWorld || 1,
					targetForefootWidthMm,
					targetTrimlineProfile,
					trimlineOffsetMm,
					trimlineAdjustments,
				});
				if (!applied) geometryToFinalize.deleteAttribute('color');
			} else {
				geometryToFinalize.deleteAttribute('color');
			}
			if (hasPlacedElements) scheduleElementOverlayRebuild();
			rebuildEvaBlockRef.current();
			if (meshRef.current) {
				applyOrientation(meshRef.current);
				meshRef.current.updateWorldMatrix(true, false);
				const worldBox = probeWorldBoxRef.current.setFromObject(meshRef.current);
				setBaselineZ(worldBox.min.z);
			}
			invalidate();
		};
		// During grid editing, never overwrite geometry — box deformation owns it
		if (gridEditMode) {
			target.dispose();
			return;
		}
		if (!existing) {
			setGeometry(target);
			requestAnimationFrame(() => {
				finalizeGeometryUpdate(target);
			});
			invalidate();
			return;
		}
		const existingPos = existing.getAttribute('position') as THREE.BufferAttribute | undefined;
		const targetPos = target.getAttribute('position') as THREE.BufferAttribute | undefined;
		if (!existingPos || !targetPos || existingPos.count !== targetPos.count) {
			setGeometry(target);
			requestAnimationFrame(() => finalizeGeometryUpdate(target));
			invalidate();
			return;
		}
		const positionCount = existingPos.count;
		const shouldSkipTransition =
			positionCount > 60000 ||
			hasPlacedElements ||
			boxOffsetsAreNontrivial(currentSavedBoxGridOffsets) ||
			Boolean(currentBottomTextOverlay?.enabled && currentBottomTextOverlay.text.trim()) ||
			Boolean(targetTrimlineProfile) ||
			Boolean(trimlineAdjustments && (
				Math.abs(trimlineAdjustments.global ?? 0) > 1e-6 ||
				Math.abs(trimlineAdjustments.heel ?? 0) > 1e-6 ||
				Math.abs(trimlineAdjustments.midfoot ?? 0) > 1e-6 ||
				Math.abs(trimlineAdjustments.forefoot ?? 0) > 1e-6 ||
				Math.abs(trimlineAdjustments.toe ?? 0) > 1e-6
			));
		if (shouldSkipTransition) {
			copyGeometryAttributes(existing, target);
			requestAnimationFrame(() => finalizeGeometryUpdate(existing));
			target.dispose();
			invalidate();
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
			invalidate();
			if (t < 1) {
				animRafRef.current = requestAnimationFrame(step);
				return;
			}
			animRafRef.current = null;
			finalizeGeometryUpdate(existing);
		};
		animRafRef.current = requestAnimationFrame(step);
		// We no longer need the target geometry object.
		target.dispose();
	}, [gridEditMode, showZones, heatmap, clampDebug, deviationMap, hasPlacedElements, applyOrientation, mmToWorld, scheduleElementOverlayRebuild, meshRole, side, targetForefootWidthMm, targetTrimlineProfile, trimlineOffsetMm, trimlineAdjustments, invalidate, savedBoxGridOffsetsSignature, bottomTextOverlaySignature, printPrepSplit, printPrepSelectedZone, printPrepHoveredZone]);

	const rebuildFinalGeometryFromCorrected = useCallback(() => {
		if (gridEditMode) return;
		const corrected = correctedGeometryRef.current;
		if (!corrected) return;
		const currentPlacedElements = placedElementsRef.current;
		const currentBottomTextOverlay = bottomTextOverlayRef.current;
		const currentSavedBoxGridOffsets = savedBoxGridOffsetsRef.current;
		const startedAt = performance.now();
		const scheduleTextLoadingEndIfShown = (
			showLoaderThisPassRef: { current: boolean },
		) => {
			if (!showLoaderThisPassRef.current) return;
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					onBottomTextLoadingChangeRef.current?.({ side, isLoading: false });
					showLoaderThisPassRef.current = false;
				});
			});
		};
		const loaderShownRefObj = { current: false };

		const tryShowBottomTextLoader = (visualSig: string) => {
			const loadingForFontWait = Boolean(
				hasOverlayTextPlaceholder(currentBottomTextOverlay) &&
					!engravingFontReady
			);
			const loadingForTextChange =
				visualSig !== lastCommittedTextVisualSigRef.current;
			const shouldShow = loadingForFontWait || loadingForTextChange;
			if (!shouldShow) return;
			onBottomTextLoadingChangeRef.current?.({ side, isLoading: true });
			loaderShownRefObj.current = true;
		};

		function hasOverlayTextPlaceholder(overlay: typeof currentBottomTextOverlay) {
			return Boolean(overlay?.enabled && overlay.text.trim());
		}

		const workingGeometry = corrected.clone();
		if (applyGeneral) {
			applySoleThicknessAfterCorrections(workingGeometry);
			applyTotalInsoleHeightAfterCorrections(workingGeometry);
		}
		// The corrected geometry is already cached in a welded/smoothed form.
		// Re-running weldAndSmoothNormals here makes live editing much slower,
		// especially for element moves and slider changes, without adding value.
		let finalGeometry = workingGeometry;
		if (corrected.userData.scanDeviations) {
			finalGeometry.userData.scanDeviations = corrected.userData.scanDeviations;
		}
		const nextSideProfileGeometry =
			meshRole === 'insole'
				? workingGeometry.clone()
				: null;
		if (nextSideProfileGeometry) {
			applyHeelEdgeThicknessBand(nextSideProfileGeometry, heelEdgeThicknessMm, mmToWorld || 1, side);
		}
		// Apply element height displacements (raised pads)
		if (hasPlacedElements && currentPlacedElements) {
			applyElements(finalGeometry, currentPlacedElements, { mmToWorld: mmToWorld || 1 });
		}
		applyHeelEdgeThicknessBand(finalGeometry, heelEdgeThicknessMm, mmToWorld || 1, side);
		// Trimline rim cut runs LAST, in the same final space the gizmo edits, so the
		// relative per-arc-length offsets reshape only the wall rim toward the drawn silhouette.
		if (
			applyGeneral &&
			trimlineHandleProfile &&
			trimlineHandleProfile.bins > 1 &&
			trimlineHeightOffsetsNeedApply(trimlineHandleProfile)
		) {
			applyTrimlineRimSilhouette(finalGeometry, trimlineHandleProfile, mmToWorld || 1);
		}
		setSideProfileGeometry(nextSideProfileGeometry);
		const hasEmbeddedBottomText =
			meshRole === 'insole' &&
			hasOverlayTextPlaceholder(currentBottomTextOverlay);

		if (meshRole === 'insole' && !hasEmbeddedBottomText) {
			lastCommittedTextVisualSigRef.current = '';
			onBottomTextLoadingChangeRef.current?.({ side, isLoading: false });
		}

		if (meshRole === 'insole' && currentBottomTextOverlay?.enabled && currentBottomTextOverlay.text.trim()) {
			const overlayVisualSig = getBottomTextOverlaySignature(currentBottomTextOverlay);
			tryShowBottomTextLoader(overlayVisualSig);
			let engravingCommitOk = false;

			const textDetailSignature = [
				correctedSignatureRef.current,
				placedElementsSignature,
				formatSignatureNumber(heelEdgeThicknessMm),
				formatSignatureNumber(mmToWorld || 1),
			].join('|');
			if (
				bottomTextDetailSignatureRef.current !== textDetailSignature ||
				!bottomTextBaseGeometryRef.current
			) {
				bottomTextBaseGeometryRef.current?.dispose();
				bottomTextBaseGeometryRef.current = finalGeometry.clone();
				bottomTextDetailSignatureRef.current = textDetailSignature;
			}
			finalGeometry.dispose();
			const font = engravingFontRef.current;
			const baseSource = bottomTextBaseGeometryRef.current;
			const baseClone = baseSource.clone();
			let nextGeometry: THREE.BufferGeometry;
			if (font && engravingFontReady) {
				const engraved = engraveTextIntoInsole(baseClone, {
					text: currentBottomTextOverlay.text,
					sizeMm: currentBottomTextOverlay.sizeMm,
					depthMm: currentBottomTextOverlay.depthMm,
					mmToWorld: mmToWorld || 1,
					orientation: currentBottomTextOverlay.orientation,
					font,
					debugSide: side,
				});
				baseClone.dispose();
				if (engraved) {
					nextGeometry = engraved;
					const v = validateEngravedGeometry(nextGeometry);
					if (!v.ok) {
						console.warn(`[bottomTextEngrave:${side}] validateEngravedGeometry failed`, {
							reason: v.reason,
							vertices: nextGeometry.getAttribute('position')?.count ?? 0,
							textPreview: currentBottomTextOverlay.text.trim().slice(0, 48),
						});
					}
					onBottomTextValidityChangeRef.current?.({
						side,
						ok: v.ok,
						reason: v.reason,
					});
					engravingCommitOk = v.ok;
				} else {
					console.warn(`[bottomTextEngrave:${side}] engraveTextIntoInsole returned null (see earlier [bottomTextEngrave:*] warnings)`, {
						textPreview: currentBottomTextOverlay.text.trim().slice(0, 48),
						sizeMm: currentBottomTextOverlay.sizeMm,
						depthMm: currentBottomTextOverlay.depthMm,
					});
					nextGeometry = baseSource.clone();
					onBottomTextValidityChangeRef.current?.({
						side,
						ok: false,
						reason: 'csg_failed',
					});
				}
			} else {
				console.warn(`[bottomTextEngrave:${side}] font not ready yet (engravingFontReady=false or font missing)`);
				baseClone.dispose();
				nextGeometry = baseSource.clone();
				onBottomTextValidityChangeRef.current?.({
					side,
					ok: false,
					reason: 'font_loading',
				});
			}
			finalGeometry = nextGeometry;
			finalGeometry.computeVertexNormals();

			scheduleTextLoadingEndIfShown(loaderShownRefObj);
			if (engravingFontReady && engravingCommitOk) {
				lastCommittedTextVisualSigRef.current = overlayVisualSig;
			}
		} else if (meshRole === 'insole') {
			onBottomTextValidityChangeRef.current?.({ side, ok: true });
		}
		// Re-apply saved box grid deformation (persists across page reloads)
		const effectiveBoxOffsets = pendingBoxGridOffsetsRef.current ?? currentSavedBoxGridOffsets;
		finalGeometry = applySavedBoxGridOffsetsToGeometry(finalGeometry, effectiveBoxOffsets, mmToWorld || 1);
		finalGeometry.computeVertexNormals();
		finalGeometry.computeBoundingBox();
		finalGeometry.computeBoundingSphere();
		const sequence = ++debugBuildCountersRef.current.final;
		const finalPos = finalGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
		logViewerDebug('final-geometry-rebuild', {
			seq: sequence,
			ms: Number((performance.now() - startedAt).toFixed(1)),
			vertices: finalPos?.count ?? 0,
			elements: currentPlacedElements?.length ?? 0,
			hasBottomText: Boolean(currentBottomTextOverlay?.enabled && currentBottomTextOverlay.text.trim()),
			signature: placedElementsSignature,
		});
		const rebuildMs = Number((performance.now() - startedAt).toFixed(1));
		recordFinalGeometryRebuild({
			ms: rebuildMs,
			vertices: finalPos?.count ?? 0,
		});
		animateGeometryTo(finalGeometry);
	}, [applyGeneral, applyTotalInsoleHeightAfterCorrections, applySoleThicknessAfterCorrections, animateGeometryTo, hasPlacedElements, placedElementsSignature, mmToWorld, meshRole, bottomTextOverlaySignature, gridEditMode, savedBoxGridOffsetsSignature, heelEdgeThicknessMm, logViewerDebug, engravingFontReady, side, soleThicknessMm, totalInsoleHeightMm, trimlineHandleProfile]);

	const rebuildFinalGeometryFromCorrectedRef = useRef(rebuildFinalGeometryFromCorrected);
	rebuildFinalGeometryFromCorrectedRef.current = rebuildFinalGeometryFromCorrected;

	const applyPendingCorrectionsGeometry = useCallback(() => {
		const bg = baseGeometry;
		if (!bg) return;

		const pendingCorrections = pendingCorrectionsRef.current;
		lastCorrectionsRef.current = pendingSignatureRef.current;

		const workingGeometry = bg.clone();

		if (applyGeneral && pendingCorrections) {
			try {
				applyAllCorrections(workingGeometry, pendingCorrections, side, {
					mmToWorld,
					activeCorrections,
					trimlineHandleProfile,
				});
			} catch (err) {
				console.error('Error applying corrections:', err);
			}
		}

		const weldedWorking = smoothInsoleWalls(weldAndSmoothNormals(workingGeometry));

		if (correctedGeometryRef.current) {
			try {
				correctedGeometryRef.current.dispose();
			} catch {
				// ignore
			}
		}
		correctedGeometryRef.current = weldedWorking;
		correctedSignatureRef.current = pendingSignatureRef.current;
		rebuildFinalGeometryFromCorrectedRef.current();
	}, [
		applyGeneral,
		side,
		mmToWorld,
		activeCorrections,
		trimlineHandleProfile,
		baseGeometry,
	]);

	// Initialize corrected geometry (base + corrections) when they change (debounced)
	useEffect(() => {
		if (!baseGeometry) return;

		const correctionsKey = corrections ? JSON.stringify(corrections) : '';
		const activeCorrectionsKey = activeCorrections ? activeCorrections.join('|') : '';
		const trimlineHandleProfileKey = trimlineHandleProfile ? JSON.stringify(trimlineHandleProfile) : '';
		const signature = `${baseGeometry.uuid}|${mmToWorld || 1}|${side}|${applyGeneral ? '1' : '0'}|${correctionsKey}|${activeCorrectionsKey}|${trimlineHandleProfileKey}`;
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
			debounceTimerRef.current = null;
			applyPendingCorrectionsGeometry();
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
		applyGeneral,
		trimlineHandleProfile,
		applyPendingCorrectionsGeometry,
	]);

	useEffect(() => {
		const flush = () => {
			if (!debounceTimerRef.current) return;
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
			applyPendingCorrectionsGeometry();
		};
		window.addEventListener('pointerup', flush, true);
		return () => window.removeEventListener('pointerup', flush, true);
	}, [applyPendingCorrectionsGeometry]);

	useEffect(() => {
		if (!correctedGeometryRef.current) return;
		if (placedElementsRafRef.current != null) {
			cancelAnimationFrame(placedElementsRafRef.current);
		}
		placedElementsRafRef.current = requestAnimationFrame(() => {
			placedElementsRafRef.current = null;
			rebuildFinalGeometryFromCorrectedRef.current();
		});
		return () => {
			if (placedElementsRafRef.current != null) {
				cancelAnimationFrame(placedElementsRafRef.current);
				placedElementsRafRef.current = null;
			}
		};
	}, [placedElementsSignature]);

	useEffect(() => {
		void bottomTextOverlaySignature;
		if (!correctedGeometryRef.current) return;
		if (bottomOverlayRebuildRafRef.current != null) {
			cancelAnimationFrame(bottomOverlayRebuildRafRef.current);
		}
		bottomOverlayRebuildRafRef.current = requestAnimationFrame(() => {
			bottomOverlayRebuildRafRef.current = null;
			rebuildFinalGeometryFromCorrectedRef.current();
		});
		return () => {
			if (bottomOverlayRebuildRafRef.current != null) {
				cancelAnimationFrame(bottomOverlayRebuildRafRef.current);
				bottomOverlayRebuildRafRef.current = null;
			}
		};
	}, [bottomTextOverlaySignature]);

	useEffect(() => {
		return () => {
			onBottomTextLoadingChangeRef.current?.({ side, isLoading: false });
		};
	}, [side]);

	useEffect(() => {
		return () => {
			if (overlayRafRef.current != null) {
				cancelAnimationFrame(overlayRafRef.current);
				overlayRafRef.current = null;
			}
		};
	}, []);

	// Apply general sliders (thickness/rim) immediately without waiting for the debounce.
	useEffect(() => {
		if (!applyGeneral) return;
		if (!correctedGeometryRef.current) return;
		if (generalRafRef.current != null) {
			cancelAnimationFrame(generalRafRef.current);
		}
		generalRafRef.current = requestAnimationFrame(() => {
			generalRafRef.current = null;
			rebuildFinalGeometryFromCorrectedRef.current();
		});
		return () => {
			if (generalRafRef.current != null) {
				cancelAnimationFrame(generalRafRef.current);
				generalRafRef.current = null;
			}
		};
	}, [applyGeneral, soleThicknessMm, totalInsoleHeightMm]);

	// Apply zone colors before paint so vertexColors never renders an empty buffer
	useLayoutEffect(() => {
		if (!geometry) return;
		const isPrepInsole = meshRole === 'insole' && printPrepSplit;
		if (meshRole === 'insole' && !printPrepSplit) {
			removePrintPrepAttributes(geometry);
		}
		if (isPrepInsole) {
			const hasTint =
				printPrepSelectedZone != null || printPrepHoveredZone != null;
			applyPrintPrepZoneColorsToGeometry(
				printPrepHoveredZone,
				printPrepSelectedZone,
			);
			setPrepZoneColorsLive(hasTint);
			invalidate();
			return;
		}
		if (showZones) {
			clearElementOverlays();
			applyZoneColors(geometry);
			invalidate();
			return;
		}
		if (heatmap) {
			clearElementOverlays();
			applyHeightmapColors(geometry);
			invalidate();
			return;
		}
		if (deviationMap) {
			clearElementOverlays();
			applyDeviationColors(geometry);
			invalidate();
			return;
		}
		if (clampDebug && meshRole === 'insole') {
			const applied = applyForefootClampDebugColors(geometry, {
				side,
				mmToWorld: mmToWorld || 1,
				targetForefootWidthMm,
				targetTrimlineProfile,
				trimlineOffsetMm,
				trimlineAdjustments,
			});
			if (applied) {
				clearElementOverlays();
				invalidate();
				return;
			}
		}
		geometry.deleteAttribute('color');
		// Element overlays are rebuilt via rebuildElementOverlays (called from animateGeometryTo
		// and here when placedElements/geometry reference changes)
		if (hasPlacedElements) {
			scheduleElementOverlayRebuild();
		} else {
			clearElementOverlays();
			invalidate();
		}
	}, [geometry, showZones, printPrepSplit, printPrepSelectedZone, printPrepHoveredZone, applyPrintPrepZoneColorsToGeometry, heatmap, clampDebug, deviationMap, meshRole, side, targetForefootWidthMm, targetTrimlineProfile, trimlineOffsetMm, trimlineAdjustments, hasPlacedElements, mmToWorld, scheduleElementOverlayRebuild, clearElementOverlays, invalidate]);

	const probeRafRef = useRef<number | null>(null);
	const pendingProbeInputRef = useRef<{
		x: number;
		y: number;
		z: number;
		side: 'left' | 'right';
		baseline: number;
		mmToWorld: number;
	} | null>(null);
	const probePointRef = useRef(new THREE.Vector3());
	const lastProbePayloadRef = useRef<{
		x: number;
		y: number;
		z: number;
		heightMm: number;
		side: 'left' | 'right';
	} | null>(null);
	const probeWorldBoxRef = useRef(new THREE.Box3());
	const probeRaycasterRef = useRef(new THREE.Raycaster());
	const probeRayOriginRef = useRef(new THREE.Vector3());
	const probeRayDirectionRef = useRef(new THREE.Vector3(0, 0, -1));

	useEffect(() => {
		if (!meshRef.current || !geometry) return;
		// Ensure consistent STL orientation (avoid per-frame mutation)
		applyOrientation(meshRef.current);
		meshRef.current.updateWorldMatrix(true, false);
		const worldBox = probeWorldBoxRef.current.setFromObject(meshRef.current);
		setBaselineZ(worldBox.min.z);
	}, [geometry, applyOrientation]);

	useEffect(() => {
		return () => {
			if (probeRafRef.current != null) {
				cancelAnimationFrame(probeRafRef.current);
				probeRafRef.current = null;
			}
		};
	}, []);

	// Clone the base geometry when entering grid edit mode; build tessellated lattice deformation kit
	useEffect(() => {
		if (!geometry || !showBoxGrid || !gridEditMode) {
			baseGeometryRef.current?.dispose();
			baseGeometryRef.current = null;
			latticeBaseSourceGeometryRef.current = null;
			setLatticeEditKit(null);
			if (boxTessellatedBaseRef.current) {
				boxTessellatedBaseRef.current.dispose();
				boxTessellatedBaseRef.current = null;
			}
			if (boxPreviewGeometryRef.current) {
				boxPreviewGeometryRef.current.dispose();
				boxPreviewGeometryRef.current = null;
			}
			boxPreviewBasePositionsRef.current = null;
			return;
		}
		if (
			baseGeometryRef.current &&
			latticeBaseSourceGeometryRef.current !== geometry
		) {
			baseGeometryRef.current.dispose();
			baseGeometryRef.current = null;
		}
		if (!baseGeometryRef.current) {
			baseGeometryRef.current = geometry.clone();
			latticeBaseSourceGeometryRef.current = geometry;
		}
		const mw = mmToWorld || 1;
		const snap = baseGeometryRef.current;
		if (!snap) return;

		boxTessellatedBaseRef.current?.dispose();
		boxTessellatedBaseRef.current = null;
		boxPreviewGeometryRef.current?.dispose();
		boxPreviewGeometryRef.current = null;

		const tess = createTessellatedBoxBaseGeometry(snap, mw);
		boxTessellatedBaseRef.current = tess;
		const tessPosAttr = tess.getAttribute('position') as THREE.BufferAttribute | undefined;
		boxPreviewBasePositionsRef.current = tessPosAttr
			? new Float32Array(tessPosAttr.array as Float32Array)
			: null;

		boxPreviewGeometryRef.current = tess.clone();

		const built = buildLattice(tess, BOX_GRID_COLS, BOX_GRID_ROWS, BOX_GRID_LAYERS, mw);
		if (!built) {
			setLatticeEditKit(null);
			return;
		}
		const inf = precomputeVertexInfluences(
			tess,
			built.frame,
			BOX_GRID_COLS,
			BOX_GRID_ROWS,
			BOX_GRID_LAYERS,
			built.nodes,
		);
		if (!inf) {
			setLatticeEditKit(null);
			return;
		}
		setLatticeEditKit({
			frame: built.frame,
			nodes: built.nodes,
			cols: BOX_GRID_COLS,
			rows: BOX_GRID_ROWS,
			layers: BOX_GRID_LAYERS,
			influences: inf,
		});
	}, [geometry, showBoxGrid, gridEditMode, mmToWorld]);

	useEffect(() => {
		setElementLatticeEditKit(null);
		elementBoxBaseGeometryRef.current?.dispose();
		elementBoxBaseGeometryRef.current = null;
		if (elementBoxTessellatedBaseRef.current) {
			elementBoxTessellatedBaseRef.current.dispose();
			elementBoxTessellatedBaseRef.current = null;
		}
		if (elementBoxPreviewGeometryRef.current) {
			elementBoxPreviewGeometryRef.current.dispose();
			elementBoxPreviewGeometryRef.current = null;
		}
		elementBoxPreviewBasePositionsRef.current = null;

		if (!selectedElementBoxEdit || selectedElementBoxEdit.side !== side) {
			return;
		}
		const editingOverlay = elementOverlays.find(
			(overlay) => overlay.elementId === selectedElementBoxEdit.elementId,
		);
		if (!editingOverlay) return;

		elementBoxBaseGeometryRef.current = editingOverlay.geometry.clone();

		const mw = mmToWorld || 1;
		const tess = createTessellatedBoxBaseGeometry(
			elementBoxBaseGeometryRef.current,
			mw,
		);
		elementBoxTessellatedBaseRef.current = tess;
		const p = tess.getAttribute('position') as THREE.BufferAttribute | undefined;
		elementBoxPreviewBasePositionsRef.current = p
			? new Float32Array(p.array as Float32Array)
			: null;
		elementBoxPreviewGeometryRef.current = tess.clone();

		const built = buildLattice(
			tess,
			BOX_GRID_COLS,
			BOX_GRID_ROWS,
			ELEMENT_BOX_GRID_LAYERS,
			mw,
			{
				belowMm: ELEMENT_BOX_HEIGHT_PAD_BELOW_MM,
				aboveMm: ELEMENT_BOX_HEIGHT_PAD_ABOVE_MM,
				handleSinkBelowSurfaceMm: ELEMENT_BOX_HANDLE_SINK_BELOW_SURFACE_MM,
			},
		);
		if (!built) return;
		const inf = precomputeVertexInfluences(
			tess,
			built.frame,
			BOX_GRID_COLS,
			BOX_GRID_ROWS,
			ELEMENT_BOX_GRID_LAYERS,
			built.nodes,
		);
		if (!inf) return;
		setElementLatticeEditKit({
			frame: built.frame,
			nodes: built.nodes,
			cols: BOX_GRID_COLS,
			rows: BOX_GRID_ROWS,
			layers: ELEMENT_BOX_GRID_LAYERS,
			influences: inf,
		});
	}, [
		elementOverlays,
		selectedElementBoxEdit,
		selectedElementBoxEditSignature,
		side,
		mmToWorld,
	]);

	// Notify parent about geometry — but NOT during grid editing, where
	// setGeometry produces deformed clones.  Propagating those to the parent
	// would reset camera position (parent camera effect depends on geometry).
	useEffect(() => {
		if (geometry && !gridEditMode) {
			onGeometryReadyRef.current?.(geometry, { mmToWorld: mmToWorld || 1 });
		}
	}, [geometry, mmToWorld, gridEditMode]);


	if (!geometry) {
		return null;
	}

	const insoleSideInspection =
		sideInspectionActive && meshRole === 'insole' && !pointPickMode && !evaBlockMode;
	const transparentUser = Boolean(transparentMode);
	const transparentGeometry = transparentUser || insoleSideInspection;
	const effectiveOpacity = insoleSideInspection
		? 0
		: transparentUser
			? (opacity ?? 0.35)
			: (opacity ?? 1);
	const scanOverlayMaterialProps =
		meshRole === 'overlayScan'
			? getScanOverlayMaterialProps(viewerOverlayMode)
			: null;

	return (
		<>
			<mesh
				ref={meshRef}
				geometry={geometry}
				position={position}
				{...(meshRole === 'overlayScan' ? { renderOrder: SCAN_OVERLAY_RENDER_ORDER } : {})}
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
					const printHoverActive =
						meshRole === 'insole' && Boolean(onPrintElementClick);
					const suppressZoneProbe =
						printHoverActive &&
						printElementHoverId != null;
					if (
						printPrepSplit &&
						meshRole === 'insole' &&
						geometry &&
						!pointPickMode &&
						!gridEditMode &&
						!elementPlacementMode &&
						!suppressZoneProbe
					) {
						const localPt = event.point.clone();
						if (meshRef.current) meshRef.current.worldToLocal(localPt);
						const hz = resolvePrintZoneFromLocalPoint(geometry, localPt);
						pendingPrintPrepHoverRef.current = hz;
						applyPrintPrepZoneColorsToGeometry(hz, printPrepSelectedZone);
						setPrepZoneColorsLive(true);
						invalidateRef.current();
						if (onPrintPrepZoneHover) {
							if (printPrepHoverFlushRafRef.current == null) {
								printPrepHoverFlushRafRef.current = requestAnimationFrame(() => {
									printPrepHoverFlushRafRef.current = null;
									const flushZ = pendingPrintPrepHoverRef.current;
									if (
										flushZ != null &&
										lastEmittedPrintHoverRef.current !== flushZ
									) {
										lastEmittedPrintHoverRef.current = flushZ;
										onPrintPrepZoneHover(flushZ, side);
									}
								});
							}
						}
					}
					if (!probeEnabled || !onProbe) return;
					if (pointPickMode || gridEditMode) return;
					const baseline = baselineZ;
					if (baseline == null) return;
					pendingProbeInputRef.current = {
						x: event.point.x,
						y: event.point.y,
						z: event.point.z,
						side,
						baseline,
						mmToWorld: mmToWorld || 1,
					};
					if (probeRafRef.current != null) return;
					probeRafRef.current = window.requestAnimationFrame(() => {
						probeRafRef.current = null;
						const next = pendingProbeInputRef.current;
						const mesh = meshRef.current;
						if (!next || !mesh) return;
						let topZ = next.z;
						const worldBox = probeWorldBoxRef.current.setFromObject(mesh);
						const rayOrigin = probeRayOriginRef.current.set(
							next.x,
							next.y,
							worldBox.max.z + Math.max(5, 10 * next.mmToWorld)
						);
						const ray = probeRaycasterRef.current;
						ray.near = 0;
						ray.far = Math.max(20, (worldBox.max.z - worldBox.min.z) + 20);
						ray.set(rayOrigin, probeRayDirectionRef.current);
						const hits = ray.intersectObject(mesh, false);
						if (hits.length > 0) {
							topZ = hits[0].point.z;
						}
						const heightMm = (topZ - next.baseline) / next.mmToWorld;
						const last = lastProbePayloadRef.current;
						if (
							last &&
							last.side === next.side &&
							last.x === next.x &&
							last.y === next.y &&
							last.z === next.z &&
							last.heightMm === heightMm
						) {
							return;
						}
						lastProbePayloadRef.current = {
							x: next.x,
							y: next.y,
							z: next.z,
							heightMm,
							side: next.side,
						};
						const point = probePointRef.current.set(next.x, next.y, next.z);
						onProbe({
							point: point.clone(),
							heightMm,
							side: next.side,
						});
					});
				} : undefined}
				onPointerLeave={
					interactive &&
					printPrepSplit &&
					meshRole === 'insole' &&
					onPrintPrepZoneHover &&
					!gridEditMode &&
					!pointPickMode &&
					!elementPlacementMode
						? () => {
								if (printPrepHoverFlushRafRef.current != null) {
									cancelAnimationFrame(printPrepHoverFlushRafRef.current);
									printPrepHoverFlushRafRef.current = null;
								}
								pendingPrintPrepHoverRef.current = null;
								lastEmittedPrintHoverRef.current = undefined;
								applyPrintPrepZoneColorsToGeometry(null, printPrepSelectedZone);
								setPrepZoneColorsLive(printPrepSelectedZone != null);
								invalidateRef.current();
								onPrintPrepZoneHover(null, side);
							}
						: undefined
				}
				onClick={interactive ? (event) => {
					event.stopPropagation();
					if (textPlacementEnabled) return;
					if (elementPlacementMode && elementPlacementMode.side === side && onElementPlace && geometry) {
						const localPt = event.point.clone();
						if (meshRef.current) meshRef.current.worldToLocal(localPt);
						const uv = getInsoleUvFromLocalPoint(geometry, localPt);
						onElementPlace({ side, u: uv.u, v: uv.v });
						return;
					}
					if (pointPickMode && onPickPoint) {
						onPickPoint(event.point.clone());
						return;
					}
					if (printPrepWhole && onPrintWholeInsoleClick) {
						onPrintWholeInsoleClick(side);
						return;
					}
					if (onZoneClick && geometry && meshRole === 'insole') {
						const localPt = event.point.clone();
						if (meshRef.current) meshRef.current.worldToLocal(localPt);
						onZoneClick(resolvePrintZoneFromLocalPoint(geometry, localPt), side);
						return;
					}
					if (onSelect) {
						onSelect(side);
					}
				} : undefined}
			>
				<meshStandardMaterial
					key={(showZones || printPrepZoneTintActive || heatmap || clampDebug || deviationMap) ? 'colored' : 'normal'}
					color={
						showZones || printPrepZoneTintActive ? '#ffffff' : pointPickMode ? '#d9b5a1' : color
					}
					vertexColors={
						showZones || printPrepZoneTintActive || heatmap || clampDebug || deviationMap
					}
					side={THREE.DoubleSide}
					shadowSide={THREE.DoubleSide}
					roughness={
						meshRole === 'overlayScan'
							? VIEWER_MATERIALS.scanOverlay.roughness
							: printPrepSplit
								? 0.6
								: VIEWER_MATERIALS.insoleBase.roughness
					}
					metalness={
						meshRole === 'overlayScan'
							? VIEWER_MATERIALS.scanOverlay.metalness
							: VIEWER_MATERIALS.insoleBase.metalness
					}
					flatShading={VIEWER_MATERIALS.insoleBase.flatShading}
					transparent={transparentGeometry}
					opacity={effectiveOpacity}
					{...(insoleSideInspection
						? ({
								depthTest: true,
								depthWrite: false,
							} as const)
						: {})}
					{...(scanOverlayMaterialProps ?? {})}
				/>

				{/* Selection highlight — hide during box/lattice edit so the mesh reads clearly */}
				{selected && !insoleSideInspection && !(showBoxGrid && gridEditMode) && (
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

				{/* EVA block — contour-following walls + bottom cap */}
				{evaBlockMode && evaBlock && (
					<mesh geometry={evaBlock.geometry}>
						<meshStandardMaterial
							color={showZones ? '#ffffff' : pointPickMode ? '#d9b5a1' : color}
							side={THREE.DoubleSide}
							roughness={0.4}
							metalness={0.0}
							flatShading={false}
						/>
					</mesh>
				)}

				{/* Interactive Box grid overlay */}
				{showBoxGrid && gridEditMode && geometry && latticeEditKit && (
					<BoxLatticeEditor
						latticeKit={latticeEditKit}
						mmToWorld={mmToWorld || 1}
						active
						savedOffsets={savedBoxGridOffsets}
						onSave={onBoxGridSave}
						onOffsetsLiveChange={(vecs: LatticeOffsetVec[]) => {
							if (!geometry || !latticeEditKit || !boxPreviewGeometryRef.current) return;
							const kitSnap = latticeEditKit;
							pendingInsoleLatticeVecsRef.current = vecs;
							if (insoleLatticeDragRafRef.current != null) return;
							insoleLatticeDragRafRef.current = requestAnimationFrame(() => {
								insoleLatticeDragRafRef.current = null;
								const snap = pendingInsoleLatticeVecsRef.current;
								if (!snap || !geometry || !boxPreviewGeometryRef.current) return;
								const mw = mmToWorld || 1;
								const working = boxPreviewGeometryRef.current;
								const basePos = boxPreviewBasePositionsRef.current;
								if (!basePos) return;
								pendingBoxGridOffsetsRef.current = latticeVecsToSavePayload(
									BOX_GRID_COLS,
									BOX_GRID_ROWS,
									BOX_GRID_LAYERS,
									snap,
								);
								restoreGeometryPositions(working, basePos);
								const positions = working.getAttribute('position') as THREE.BufferAttribute;
								const arr = positions.array as Float32Array;
								applyLatticeDeformation(
									arr,
									basePos,
									snap,
									kitSnap.influences,
									kitSnap.frame,
									mw,
								);
								positions.needsUpdate = true;
								copyGeometryPositionsFast(geometry, working);
								if (showZones) applyZoneColors(geometry);
								else if (heatmap) applyHeightmapColors(geometry);
								else if (deviationMap) applyDeviationColors(geometry);
								else geometry.deleteAttribute('color');
								invalidateRef.current();
							});
						}}
						onDragEnd={() => {
							if (!geometry) return;
							geometry.computeVertexNormals();
							geometry.computeBoundingSphere();
							const ppSpl = Boolean(printPrepSplit);
							const ppSel = printPrepSelectedZone;
							const ppHov = printPrepHoveredZone;
							const prepTint =
								meshRole === 'insole' && ppSpl && (ppSel != null || ppHov != null);
							if (prepTint) {
								applyPrintSplitZoneColors(geometry, {
									selectedZone: ppSel,
									hoveredZone: ppHov,
									baseColor: color,
								});
							}
							invalidateRef.current();
						}}
					/>
				)}

				{elementOverlays.map((overlay) => {
					const printHit = meshRole === 'insole' && Boolean(onPrintElementClick);
					const selectedHere = printSelectedElementId === overlay.elementId;
					const hoveredHere =
						printHit &&
						printElementHoverId === overlay.elementId &&
						!selectedHere;
					const highlightSelected =
						printElementSelectionHighlight && selectedHere;
					const highlightHover = hoveredHere;
					const highlightHere = highlightSelected || highlightHover;
					const pickFriendly = Boolean(printHit);
					return (
						<mesh
							key={overlay.elementId}
							geometry={overlay.geometry}
							frustumCulled={false}
							renderOrder={
								printHit ? 20 + overlay.stackOrder : 10 + overlay.stackOrder
							}
							{...(printHit ? { cursor: 'pointer' as const } : {})}
							onClick={
								printHit
									? (e) => {
											e.stopPropagation();
											onPrintElementClick!(overlay.elementId, side);
										}
									: undefined
							}
							onPointerOver={
								printHit
									? (e) => {
											e.stopPropagation();
											setPrintElementHoverId(overlay.elementId);
										}
									: undefined
							}
							onPointerOut={
								printHit
									? (e) => {
											e.stopPropagation();
											setPrintElementHoverId((prev) =>
												prev === overlay.elementId ? null : prev,
											);
										}
									: undefined
							}
						>
							{VIEWER_MATERIALS.elementOverlay.clearcoat != null ? (
								<meshPhysicalMaterial
									color={overlay.colorHex}
									emissive={highlightHere ? '#6bcda8' : '#000000'}
									emissiveIntensity={
										highlightHere ? (highlightSelected ? 0.32 : 0.14) : 0
									}
									roughness={VIEWER_MATERIALS.elementOverlay.roughness}
									metalness={VIEWER_MATERIALS.elementOverlay.metalness}
									clearcoat={VIEWER_MATERIALS.elementOverlay.clearcoat}
									clearcoatRoughness={
										VIEWER_MATERIALS.elementOverlay.clearcoatRoughness ?? 0.2
									}
									flatShading={VIEWER_MATERIALS.elementOverlay.flatShading}
									side={overlay.isInset ? THREE.FrontSide : THREE.DoubleSide}
									shadowSide={overlay.isInset ? THREE.FrontSide : THREE.DoubleSide}
									polygonOffset={!pickFriendly}
									polygonOffsetFactor={pickFriendly ? 0 : overlay.isInset ? -1 : -3}
									polygonOffsetUnits={pickFriendly ? 0 : overlay.isInset ? -1 : -3}
								/>
							) : (
								<meshStandardMaterial
									color={overlay.colorHex}
									emissive={highlightHere ? '#6bcda8' : '#000000'}
									emissiveIntensity={
										highlightHere ? (highlightSelected ? 0.32 : 0.14) : 0
									}
									roughness={VIEWER_MATERIALS.elementOverlay.roughness}
									metalness={VIEWER_MATERIALS.elementOverlay.metalness}
									flatShading={VIEWER_MATERIALS.elementOverlay.flatShading}
									side={overlay.isInset ? THREE.FrontSide : THREE.DoubleSide}
									shadowSide={overlay.isInset ? THREE.FrontSide : THREE.DoubleSide}
									polygonOffset={!pickFriendly}
									polygonOffsetFactor={pickFriendly ? 0 : overlay.isInset ? -1 : -3}
									polygonOffsetUnits={pickFriendly ? 0 : overlay.isInset ? -1 : -3}
								/>
							)}
						</mesh>
					);
				})}
				{selectedElementBoxEdit &&
					selectedElementBoxEdit.side === side &&
					elementLatticeEditKit &&
					(() => {
						const editingOverlay = elementOverlayById.get(selectedElementBoxEdit.elementId);
						if (!editingOverlay) return null;
						const kit = elementLatticeEditKit;
						return (
							<BoxLatticeEditor
								latticeKit={kit}
								mmToWorld={mmToWorld || 1}
								active
								savedOffsets={selectedElementBoxEdit.savedOffsets}
								onSave={onElementBoxGridSave}
								onOffsetsLiveChange={(vecs: LatticeOffsetVec[]) => {
									if (!elementBoxPreviewGeometryRef.current) return;
									const kitSnap = kit;
									const targetGeom = editingOverlay.geometry;
									pendingElementLatticeVecsRef.current = vecs;
									if (elementLatticeDragRafRef.current != null) return;
									elementLatticeDragRafRef.current = requestAnimationFrame(() => {
										elementLatticeDragRafRef.current = null;
										const snap = pendingElementLatticeVecsRef.current;
										if (
											!snap ||
											!elementBoxPreviewGeometryRef.current ||
											!elementBoxPreviewBasePositionsRef.current
										)
											return;
										const mw = mmToWorld || 1;
										const working = elementBoxPreviewGeometryRef.current;
										const basePos = elementBoxPreviewBasePositionsRef.current;
										restoreGeometryPositions(working, basePos);
										const positions = working.getAttribute('position') as THREE.BufferAttribute;
										const arr = positions.array as Float32Array;
										applyLatticeDeformation(arr, basePos, snap, kitSnap.influences, kitSnap.frame, mw);
										positions.needsUpdate = true;
										copyGeometryPositionsFast(targetGeom, working);
										invalidateRef.current();
									});
								}}
								onDragEnd={() => {
									editingOverlay.geometry.computeVertexNormals();
									editingOverlay.geometry.computeBoundingSphere();
									invalidateRef.current();
								}}
							/>
						);
					})()}
				{selectedElementTrimlineEdit && selectedElementTrimlineEdit.side === side && (() => {
					const editingOverlay = elementOverlayById.get(selectedElementTrimlineEdit.elementId);
					if (!editingOverlay) return null;
					return (
						<InteractiveTrimline
							insoleGeometry={editingOverlay.geometry}
							onPendingProfileChange={(profile) => onPendingElementTrimlineProfileChange?.(profile)}
							profile={selectedElementTrimlineEdit.profile}
							mmToWorld={mmToWorld || MM_TO_WORLD}
							active
							mode="element"
							onDragActiveChange={onTrimDragActiveChange}
						/>
					);
				})()}
			</mesh>
			{insoleSideInspection ? (
				<SideInspectionLayers
					geometry={sideProfileGeometry ?? geometry}
					meshRef={meshRef}
					enabled
					sideView={sideInspectionView}
					style={{
						topSurfaceColor: '#f8fafc',
						topSurfaceOpacity: 0.98,
						topSurfaceDepthWorld: soleThicknessMm * (mmToWorld || MM_TO_WORLD),
						bottomColor: '#020617',
						showTopLine: false,
						showShellOutline: true,
						outlineColor: '#f8fafc',
						outlineWidth: 2.6,
						lineWidth: 2.6,
						renderOrder: 9,
					}}
				/>
			) : null}
			{insoleSideInspection
				? elementOverlays.map((overlay) => (
						<SideInspectionLayers
							key={`side-profile-${overlay.elementId}`}
							geometry={overlay.geometry}
							meshRef={meshRef}
							enabled
							sideView={sideInspectionView}
							style={{
								topColor: overlay.colorHex,
								bottomColor: overlay.colorHex,
								fillColor: overlay.colorHex,
								fillOpacity: overlay.isInset ? 0.85 : 0.68,
								lineWidth: 2.2,
								renderOrder: 14 + overlay.stackOrder,
							}}
						/>
					))
				: null}
		</>
	);
}

interface EnhancedSTLViewerProps {
	leftUrl?: string;
	rightUrl?: string;
	leftOverlayUrl?: string;
	rightOverlayUrl?: string;
	targetForefootWidthMm?: { left: number | null; right: number | null };
	trimlineOffsetMm?: number;
	trimlineAdjustments?: { left: TrimlineAdjustments; right: TrimlineAdjustments };
	trimlineHandleProfiles?: { left: TrimlineHandleProfile | null; right: TrimlineHandleProfile | null };
	editTrimlineHandleProfiles?: { left: TrimlineHandleProfile | null; right: TrimlineHandleProfile | null };
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
	clampDebug?: boolean;
	deviationMap?: boolean;
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
	onBottomTextLoadingChange?: (payload: {
		side: 'left' | 'right';
		isLoading: boolean;
	}) => void;
	onBottomTextValidityChange?: (payload: {
		side: 'left' | 'right';
		ok: boolean;
		reason?: string;
	}) => void;
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
	selectedElementTrimlineEdit?: {
		elementId: string;
		side: 'left' | 'right';
		profile: TrimlineHandleProfile | null;
	} | null;
	selectedElementBoxEdit?: {
		elementId: string;
		side: 'left' | 'right';
		savedOffsets: BoxGridSavedOffsets | null;
	} | null;
	onPendingElementTrimlineProfileChange?: (profile: TrimlineHandleProfile) => void;
	onElementBoxGridSave?: (offsets: BoxGridSavedOffsets) => void;
	elementPlacementMode?: { elementId: string; side: 'left' | 'right' } | null;
	onElementPlace?: (payload: { side: 'left' | 'right'; u: number; v: number }) => void;
	onZoneClick?: (zone: 'front' | 'middle' | 'back', side: 'left' | 'right') => void;
	printPrepInteractive?: boolean;
	printPrepSidebarSide?: 'left' | 'right';
	printPrepElementsSplitLeft?: boolean;
	printPrepElementsSplitRight?: boolean;
	printPrepSelectedZone?: PrintZoneId | null;
	printPrepHoveredZones?: { left: PrintZoneId | null; right: PrintZoneId | null };
	onPrintPrepZoneHover?: (zone: PrintZoneId | null, side: 'left' | 'right') => void;
	onPrintWholeInsoleClick?: (side: 'left' | 'right') => void;
	onPrintElementClick?: (elementId: string, side: 'left' | 'right') => void;
	printSelectedElementId?: string | null;
	printElementSelectionHighlight?: boolean;
	onPrintInteractionDeselect?: () => void;
	boxEnabled?: { left: boolean; right: boolean };
	gridEditMode?: boolean;
	heelEdgeThicknessMm?: { left: number; right: number };
	savedBoxGridOffsets?: {
		left: BoxGridSavedOffsets | null;
		right: BoxGridSavedOffsets | null;
	};
	onBoxGridSave?: (side: 'left' | 'right', offsets: BoxGridSavedOffsets) => void;
	leftPlacedElements?: PlacedElement[];
	rightPlacedElements?: PlacedElement[];
	/** When true, render insoles inside a solid EVA block (Frezen: EVA mode) */
	evaBlockMode?: boolean;
	/** Base insole type (man, driekwart, etc.) for shape adjustments */
	baseInsoleType?: import('@/src/features/design/types/types').BaseInsoleType;
	/** Which side is being trimline-edited interactively (null = none) */
	trimlineEditSide?: 'left' | 'right' | null;
	scanRotateEditSide?: 'left' | 'right' | null;
	scanManualAlignments?: {
		left: ScanManualAlignment | null;
		right: ScanManualAlignment | null;
	};
	editorScanManualAlignments?: {
		left: ScanManualAlignment | null;
		right: ScanManualAlignment | null;
	};
	onPendingScanAlignmentChange?: (
		side: 'left' | 'right',
		alignment: ScanManualAlignment | null,
	) => void;
	onPendingTrimlineProfileChange?: (side: 'left' | 'right', profile: TrimlineHandleProfile) => void;
	/** Called once when both insole meshes have loaded their geometry */
	onReady?: () => void;
	/** When true, pointer events on insole meshes are disabled (no click/select) */
	disableInteraction?: boolean;
}

function ScanOcclusionDepthPrepass({
	geometry,
	position,
}: {
	geometry: THREE.BufferGeometry | null;
	position: THREE.Vector3Tuple;
}) {
	if (!geometry) return null;

	return (
		<mesh
			geometry={geometry}
			position={position}
			rotation={[-Math.PI / 2, 0, 0]}
			renderOrder={INSOLE_SCAN_DEPTH_PREPASS_RENDER_ORDER}
		>
			<meshBasicMaterial
				colorWrite={false}
				depthTest={true}
				depthWrite={true}
				side={THREE.DoubleSide}
			/>
		</mesh>
	);
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
	getFinalInsoleGeometry: (side: 'left' | 'right') => THREE.BufferGeometry | null;
	getExportInsoleGeometryMm: (side: 'left' | 'right') => THREE.BufferGeometry | null;
	getExportPairGeometryMm: (spacingMm?: number) => THREE.BufferGeometry | null;
	getInsoleDimensionsMm: (
		side: 'left' | 'right'
	) => { lengthMm: number; widthMm: number; heightMm: number } | null;
	/** Get the right foot scan geometry for external computation */
	getRightGeometry: () => THREE.BufferGeometry | null;
	/** Conversion factor from real millimeters to world units for current right mesh */
	getRightMmToWorld: () => number;
	/** Smoothly orbit the camera to look at the given foot (preserves angle). */
	focusOnSide: (side: 'left' | 'right') => void;
}

function DevPerformanceOverlay() {
	const [enabled] = useState(() => {
		if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') {
			return false;
		}
		const search = new URLSearchParams(window.location.search);
		const href = window.location.href;
		return (
			search.get('perf') === '1' ||
			href.includes('&perf=1') ||
			href.includes('?perf=1')
		);
	});
	const [stats, setStats] = useState<{
		fps: number;
		avgFrameMs: number;
		maxFrameMs: number;
		slowFrames: number;
		longTasks: number;
		heapMb: number | null;
		finalRebuildMs: number | null;
		finalRebuildVertices: number | null;
		overlayRebuildMs: number | null;
	}>({
		fps: 0,
		avgFrameMs: 0,
		maxFrameMs: 0,
		slowFrames: 0,
		longTasks: 0,
		heapMb: null,
		finalRebuildMs: null,
		finalRebuildVertices: null,
		overlayRebuildMs: null,
	});

	useEffect(() => {
		if (!enabled || typeof window === 'undefined') return;

		let rafId: number | null = null;
		let lastSample = performance.now();
		let lastFlush = lastSample;
		let frameCount = 0;
		let totalFrameMs = 0;
		let maxFrameMs = 0;
		let slowFrames = 0;
		let longTasks = 0;

		const perfWithMemory = performance as Performance & {
			memory?: {
				usedJSHeapSize?: number;
			};
		};

		let observer: PerformanceObserver | null = null;
		if (typeof PerformanceObserver !== 'undefined') {
			try {
				observer = new PerformanceObserver((list) => {
					longTasks += list.getEntries().length;
				});
				observer.observe({ entryTypes: ['longtask'] });
			} catch {
				observer = null;
			}
		}

		const tick = (now: number) => {
			const delta = now - lastSample;
			lastSample = now;
			frameCount += 1;
			totalFrameMs += delta;
			if (delta > maxFrameMs) maxFrameMs = delta;
			if (delta > 32) slowFrames += 1;

			if (now - lastFlush >= 500) {
				const fps = frameCount > 0 ? (frameCount * 1000) / Math.max(1, now - lastFlush) : 0;
				const avgFrameMs = frameCount > 0 ? totalFrameMs / frameCount : 0;
				const heapMb = typeof perfWithMemory.memory?.usedJSHeapSize === 'number'
					? perfWithMemory.memory.usedJSHeapSize / (1024 * 1024)
					: null;
				const geo = getViewerPerfSnapshot();
				setStats({
					fps: Number(fps.toFixed(1)),
					avgFrameMs: Number(avgFrameMs.toFixed(1)),
					maxFrameMs: Number(maxFrameMs.toFixed(1)),
					slowFrames,
					longTasks,
					heapMb: heapMb == null ? null : Number(heapMb.toFixed(1)),
					finalRebuildMs:
						geo.lastFinalRebuildMs != null ? Number(geo.lastFinalRebuildMs.toFixed(1)) : null,
					finalRebuildVertices: geo.lastFinalRebuildVertices ?? null,
					overlayRebuildMs:
						geo.lastOverlayRebuildMs != null
							? Number(geo.lastOverlayRebuildMs.toFixed(1))
							: null,
				});
				lastFlush = now;
				frameCount = 0;
				totalFrameMs = 0;
				maxFrameMs = 0;
				slowFrames = 0;
				longTasks = 0;
			}

			rafId = window.requestAnimationFrame(tick);
		};

		rafId = window.requestAnimationFrame(tick);

		return () => {
			if (rafId != null) {
				window.cancelAnimationFrame(rafId);
			}
			observer?.disconnect();
		};
	}, [enabled]);

	if (!enabled) return null;

	return (
		<div className="pointer-events-none absolute right-3 top-3 z-50 rounded-xl border border-ui-border bg-ui-panel/90 px-3 py-2 text-[11px] text-ui-text shadow-xl backdrop-blur">
			<div className="font-semibold text-ui-accent">Perf Monitor</div>
			<div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-ui-muted">
				<span>FPS</span><span className="text-right text-ui-text">{stats.fps}</span>
				<span>Avg frame</span><span className="text-right text-ui-text">{stats.avgFrameMs} ms</span>
				<span>Max frame</span><span className="text-right text-ui-text">{stats.maxFrameMs} ms</span>
				<span>Slow frames</span><span className="text-right text-ui-text">{stats.slowFrames}</span>
				<span>Long tasks</span><span className="text-right text-ui-text">{stats.longTasks}</span>
				<span>Heap</span><span className="text-right text-ui-text">{stats.heapMb == null ? 'n/a' : `${stats.heapMb} MB`}</span>
				<span>Final geom</span>
				<span className="text-right text-ui-text">
					{stats.finalRebuildMs == null ? '—' : `${stats.finalRebuildMs} ms`}
					{stats.finalRebuildVertices != null ? ` · ${stats.finalRebuildVertices.toLocaleString()}v` : ''}
				</span>
				<span>Overlays</span>
				<span className="text-right text-ui-text">
					{stats.overlayRebuildMs == null ? '—' : `${stats.overlayRebuildMs} ms`}
				</span>
			</div>
			<div className="mt-2 text-[10px] text-ui-muted">Enable with <span className="text-ui-text">?perf=1</span></div>
		</div>
	);
}

const EnhancedSTLViewerInner = forwardRef<
	EnhancedSTLViewerRef,
	EnhancedSTLViewerProps
>(
	(
		{
			leftUrl,
			rightUrl,
			leftOverlayUrl,
			rightOverlayUrl,
			targetForefootWidthMm,
			trimlineOffsetMm = 3,
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
			clampDebug = false,
			deviationMap = false,
			showInsoles = true,
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
			textAnnotations = EMPTY_TEXT_ANNOTATIONS,
			bottomTextOverlay,
			onTextPlace,
			onSelectSide,
			onDeselectSide,
			selectedElementTrimlineEdit = null,
			selectedElementBoxEdit = null,
			onPendingElementTrimlineProfileChange,
			onElementBoxGridSave,
			elementPlacementMode = null,
			onElementPlace,
			onZoneClick,
			boxEnabled = DEFAULT_BOX_ENABLED,
			gridEditMode = false,
			heelEdgeThicknessMm = DEFAULT_HEEL_EDGE_THICKNESS,
			savedBoxGridOffsets,
			onBoxGridSave,
			corrections,
			onPickPoint,
			pickedPoints = EMPTY_PICKED_POINTS,
			onRightBBox,
			landmarkPoints,
			showGeneratedInsole = false,
			leftPlacedElements,
			rightPlacedElements,
			evaBlockMode = false,
			trimlineAdjustments,
			trimlineHandleProfiles,
			editTrimlineHandleProfiles,
			baseInsoleType = 'man',
			trimlineEditSide = null,
			scanRotateEditSide = null,
			scanManualAlignments,
			editorScanManualAlignments,
			onPendingScanAlignmentChange,
			onPendingTrimlineProfileChange,
			onReady,
			onBottomTextLoadingChange,
			disableInteraction = false,
			onBottomTextValidityChange,
			printPrepInteractive = false,
			printPrepSidebarSide = 'left',
			printPrepElementsSplitLeft = false,
			printPrepElementsSplitRight = false,
			printPrepSelectedZone = null,
			printPrepHoveredZones = { left: null, right: null },
			onPrintPrepZoneHover,
			onPrintWholeInsoleClick,
			onPrintElementClick,
			printSelectedElementId = null,
			printElementSelectionHighlight = false,
			onPrintInteractionDeselect,
		},
		ref
	) => {
		const shouldFlipBaseLongAxis = baseInsoleType === 'driekwart';
		const ppSide = printPrepInteractive ? printPrepSidebarSide : null;
		const leftPrintSplitPrep = Boolean(
			printPrepInteractive && ppSide === 'left' && printPrepElementsSplitLeft,
		);
		// Whole-insole clicks must be accepted on *either* foot so that clicking the
		// inactive insole switches the print-prep side. Visual tint stays gated by side.
		const leftPrintWholePrep = Boolean(
			printPrepInteractive && !printPrepElementsSplitLeft,
		);
		const rightPrintSplitPrep = Boolean(
			printPrepInteractive && ppSide === 'right' && printPrepElementsSplitRight,
		);
		const rightPrintWholePrep = Boolean(
			printPrepInteractive && !printPrepElementsSplitRight,
		);

		const [leftGeometry, setLeftGeometry] =
			useState<THREE.BufferGeometry | null>(null);
		const [rightGeometry, setRightGeometry] =
			useState<THREE.BufferGeometry | null>(null);
		const [leftOverlayGeometry, setLeftOverlayGeometry] =
			useState<THREE.BufferGeometry | null>(null);
		const [rightOverlayGeometry, setRightOverlayGeometry] =
			useState<THREE.BufferGeometry | null>(null);
		const [leftMmToWorld, setLeftMmToWorld] = useState<number>(1);
		const [rightMmToWorld, setRightMmToWorld] = useState<number>(1);
		const lastRightBBoxSignatureRef = useRef<string>('');
		const handleLeftGeometryReady = useCallback((geom: THREE.BufferGeometry, meta?: { mmToWorld: number }) => {
			setLeftGeometry(geom);
			setLeftMmToWorld(meta?.mmToWorld || 1);
		}, []);
		const handleRightGeometryReady = useCallback((geom: THREE.BufferGeometry, meta?: { mmToWorld: number }) => {
			setRightGeometry(geom);
			setRightMmToWorld(meta?.mmToWorld || 1);
			if (!onRightBBox) return;
			const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
			if (!posAttr) return;
			const box = new THREE.Box3().setFromBufferAttribute(posAttr);
			const signature = [
				box.min.x.toFixed(4),
				box.min.y.toFixed(4),
				box.min.z.toFixed(4),
				box.max.x.toFixed(4),
				box.max.y.toFixed(4),
				box.max.z.toFixed(4),
			].join('|');
			if (lastRightBBoxSignatureRef.current === signature) return;
			lastRightBBoxSignatureRef.current = signature;
			onRightBBox(box);
		}, [onRightBBox]);

		// Fire onReady only after the visible geometry + overlays have actually settled.
		const onReadyFiredRef = useRef(false);
		const onReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const readyKey = [
			leftUrl ?? '',
			rightUrl ?? '',
			leftOverlayUrl ?? '',
			rightOverlayUrl ?? '',
		].join('|');

		useEffect(() => {
			onReadyFiredRef.current = false;
			if (onReadyTimerRef.current) {
				clearTimeout(onReadyTimerRef.current);
				onReadyTimerRef.current = null;
			}
		}, [readyKey]);

		useEffect(() => {
			if (onReadyFiredRef.current) return;
			const hasLeft = !leftUrl || leftGeometry !== null;
			const hasRight = !rightUrl || rightGeometry !== null;
			const hasLeftOverlay = !leftOverlayUrl || leftOverlayGeometry !== null;
			const hasRightOverlay = !rightOverlayUrl || rightOverlayGeometry !== null;
			if (hasLeft && hasRight && hasLeftOverlay && hasRightOverlay) {
				if (onReadyTimerRef.current != null) return;
				onReadyTimerRef.current = setTimeout(() => {
					onReadyTimerRef.current = null;
					requestAnimationFrame(() => {
						if (onReadyFiredRef.current) return;
						onReadyFiredRef.current = true;
						onReady?.();
					});
				}, 260);
				return;
			}
			if (onReadyTimerRef.current) {
				clearTimeout(onReadyTimerRef.current);
				onReadyTimerRef.current = null;
			}
		}, [leftGeometry, rightGeometry, leftOverlayGeometry, rightOverlayGeometry, leftUrl, rightUrl, leftOverlayUrl, rightOverlayUrl, onReady]);

		useEffect(() => {
			return () => {
				if (onReadyTimerRef.current) {
					clearTimeout(onReadyTimerRef.current);
					onReadyTimerRef.current = null;
				}
			};
		}, []);

		const [localLandmarks, setLocalLandmarks] = useState<LandmarkPoints | null>(
			null
		);
		const setMatchTransform = useDesignStore((state) => state.setMatchTransform);
		const general = useDesignStore((state) => state.parameters.general);
		const shoeSize = general?.shoeSize;
		const soleThicknessMm = general?.soleThicknessMm;
		const maxInsoleHeightMm = general?.maxInsoleHeightMm;
		const rightMaxInsoleHeightMm =
			typeof maxInsoleHeightMm === 'number'
				? maxInsoleHeightMm
				: (maxInsoleHeightMm as { left?: number; right?: number } | undefined)?.right ?? 10;
		const rightSoleThicknessMm =
			typeof soleThicknessMm === 'number'
				? soleThicknessMm
				: (soleThicknessMm as { left?: number; right?: number } | undefined)?.right ?? 2;
		const generatedArchShiftWorld = (corrections?.apexMiddenvoet?.right ?? 0) * (rightMmToWorld || 1);
		const euSizeToLengthMm = (eu: number) => (eu * 10) / 1.5;
		const generatedInsole = useMemo(() => {
			const shouldShow = showGeneratedInsole;
			if (!shouldShow) return null;
			if (!rightGeometry) return null;
			const mmToWorld = rightMmToWorld || 1;
			const thicknessWorld =
				Number.isFinite(rightSoleThicknessMm)
					? Math.max(0.1, rightSoleThicknessMm) * mmToWorld
					: 2 * mmToWorld;
			const rightShoeSizeVal =
				typeof shoeSize === 'number'
					? shoeSize
					: (shoeSize as { left?: number; right?: number } | undefined)?.right ?? 40;
			const lengthScale =
				Number.isFinite(rightShoeSizeVal) && rightShoeSizeVal > 0
					? euSizeToLengthMm(rightShoeSizeVal) / euSizeToLengthMm(40)
					: 1;
			const totalHeightMm =
				Number.isFinite(rightMaxInsoleHeightMm) && rightMaxInsoleHeightMm > 0
					? rightMaxInsoleHeightMm
					: 10;
			if (process.env.NODE_ENV === 'development') {
				console.log('[GeneratedInsole] totalHeightMm=', totalHeightMm,
					'thicknessMm=', rightSoleThicknessMm,
					'shoeSize=', rightShoeSizeVal,
					'archShift=', (corrections?.apexMiddenvoet?.right ?? 0), 'mm');
			}
			const targetArchHeightWorld = Math.max(1.5 * mmToWorld, totalHeightMm * mmToWorld);
			const rimHeightWorld = Math.max(
				1.5 * mmToWorld,
				Math.min(targetArchHeightWorld * 0.6, targetArchHeightWorld - thicknessWorld * 0.35)
			);

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

				applyGeometryTotalHeight(geom, totalHeightMm, mmToWorld);
				applyHeelEdgeThicknessBand(geom, heelEdgeThicknessMm?.right, mmToWorld, 'right');
				geom.computeVertexNormals();
				return geom;
			}

			const built = buildBasicInsole(rightGeometry, localLandmarks, {
				padScale: 1.02,
				thickness: thicknessWorld,
				lengthScale,
				rimHeight: rimHeightWorld,
				rimBandThickness: Math.max(
					0.75 * mmToWorld,
					Math.min(((heelEdgeThicknessMm?.right ?? 1) * mmToWorld), thicknessWorld * 6)
				),
				archCenterShift: generatedArchShiftWorld,
				targetArchHeight: targetArchHeightWorld,
				archBoost: 0.75,
				heelCupDepth: 7 * mmToWorld,
				toeTaper: 0.14,
				heelTaper: 0.08,
				resU: 140,
				resV: 70,
			});
			if (!built) return built;
			applyHeelEdgeThicknessBand(built, heelEdgeThicknessMm?.right, mmToWorld, 'right');
			return built;
		}, [
			rightGeometry,
			localLandmarks,
			showGeneratedInsole,
			rightMmToWorld,
			shoeSize,
			rightSoleThicknessMm,
			rightMaxInsoleHeightMm,
			heelEdgeThicknessMm,
			generatedArchShiftWorld,
			corrections,
		]);
		const leftMeshRef = useRef<THREE.Group>(null);
		const rightMeshRef = useRef<THREE.Group>(null);
		const leftOverlayRootRef = useRef<THREE.Group>(null);
		const rightOverlayRootRef = useRef<THREE.Group>(null);
		const cameraRef = useRef<THREE.PerspectiveCamera>(null);
		const controlsRef = useRef<OrbitControlsImpl | null>(null);
		const [interactionDragActive, setInteractionDragActive] = useState(false);
		const handleInteractionDragActive = useCallback((active: boolean) => {
			setInteractionDragActive(active);
			const c = controlsRef.current;
			if (c) {
				c.enabled = !active;
			}
		}, []);
		const cameraInitRef = useRef(false);
		const prevPresetRef = useRef<string | undefined>(undefined);
		const focusAnimRafRef = useRef<number | null>(null);

		const focusOnSide = useCallback((targetSide: 'left' | 'right') => {
			const cam = cameraRef.current;
			const c = controlsRef.current;
			if (!cam || !c) return;
			const meshGroup =
				targetSide === 'left' ? leftMeshRef.current : rightMeshRef.current;
			if (!meshGroup) return;
			const box = new THREE.Box3().setFromObject(meshGroup);
			if (box.isEmpty()) return;
			const newCenter = box.getCenter(new THREE.Vector3());
			const startTarget = c.target.clone();
			const startPos = cam.position.clone();
			const delta = newCenter.clone().sub(startTarget);
			if (delta.lengthSq() < 1e-3) return;
			if (focusAnimRafRef.current != null) {
				cancelAnimationFrame(focusAnimRafRef.current);
				focusAnimRafRef.current = null;
			}
			const startTime =
				typeof performance !== 'undefined' ? performance.now() : Date.now();
			const duration = 360;
			const ease = (t: number) =>
				t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
			const step = () => {
				const now =
					typeof performance !== 'undefined' ? performance.now() : Date.now();
				const linear = Math.min(1, (now - startTime) / duration);
				const eased = ease(linear);
				const dx = delta.x * eased;
				const dy = delta.y * eased;
				const dz = delta.z * eased;
				c.target.set(startTarget.x + dx, startTarget.y + dy, startTarget.z + dz);
				cam.position.set(startPos.x + dx, startPos.y + dy, startPos.z + dz);
				c.update();
				if (linear < 1) {
					focusAnimRafRef.current = requestAnimationFrame(step);
				} else {
					focusAnimRafRef.current = null;
				}
			};
			focusAnimRafRef.current = requestAnimationFrame(step);
		}, []);

		useEffect(() => {
			return () => {
				if (focusAnimRafRef.current != null) {
					cancelAnimationFrame(focusAnimRafRef.current);
					focusAnimRafRef.current = null;
				}
			};
		}, []);

		const effectiveShowGeneratedInsole = showGeneratedInsole;
		const effectiveHideScans = hideScans;
		const effectiveShowModel = typeof showModel === 'boolean' ? showModel : true;
		const effectiveViewPreset = analysisEnabled ? 'back' : viewPreset;
		const sideInspectionActive =
			!analysisEnabled &&
			!pointPickMode &&
			(effectiveViewPreset === 'left' || effectiveViewPreset === 'right');
		const useQuarterRegistration = baseInsoleType === 'driekwart';
		const leftOverlayRegistration = useMemo(
			() =>
				computeOverlayRegistration(leftOverlayGeometry, leftGeometry, {
					skipIcp: useQuarterRegistration,
					snapHeelEdge: useQuarterRegistration,
				}),
			[leftOverlayGeometry, leftGeometry, useQuarterRegistration]
		);
		const rightOverlayRegistration = useMemo(
			() =>
				computeOverlayRegistration(rightOverlayGeometry, rightGeometry, {
					skipIcp: useQuarterRegistration,
					snapHeelEdge: useQuarterRegistration,
				}),
			[rightOverlayGeometry, rightGeometry, useQuarterRegistration]
		);
		const leftTrimlineProfile = useMemo(
			() =>
				buildTrimlineProfileFromGeometry(
					leftOverlayGeometry,
					leftOverlayRegistration.valid
						? { matrix: leftOverlayRegistration.matrix }
						: undefined
				),
			[leftOverlayGeometry, leftOverlayRegistration]
		);
		const rightTrimlineProfile = useMemo(
			() =>
				buildTrimlineProfileFromGeometry(
					rightOverlayGeometry,
					rightOverlayRegistration.valid
						? { matrix: rightOverlayRegistration.matrix }
						: undefined
				),
			[rightOverlayGeometry, rightOverlayRegistration]
		);

		// In driekwart mode, compute position offset to align insole heel with
		// the scan overlay heel. The insole and scan use different mesh rotations,
		// so the geometry-space registration doesn't fully align them in the scene.
		const driekwartLeftOffset = useMemo(
			() =>
				useQuarterRegistration
					? computeDriekwartInsoleOffset(leftGeometry, leftOverlayGeometry, leftOverlayRegistration)
					: new THREE.Vector3(0, 0, 0),
			[useQuarterRegistration, leftGeometry, leftOverlayGeometry, leftOverlayRegistration]
		);
		const driekwartRightOffset = useMemo(
			() =>
				useQuarterRegistration
					? computeDriekwartInsoleOffset(rightGeometry, rightOverlayGeometry, rightOverlayRegistration)
					: new THREE.Vector3(0, 0, 0),
			[useQuarterRegistration, rightGeometry, rightOverlayGeometry, rightOverlayRegistration]
		);

		const [leftInsoleAxisWorld, setLeftInsoleAxisWorld] =
			useState<[number, number, number]>([0, 1, 0]);
		const [rightInsoleAxisWorld, setRightInsoleAxisWorld] =
			useState<[number, number, number]>([0, 1, 0]);

		const leftComposeScanAlignment = useMemo(() => {
			if (scanRotateEditSide === 'left') return editorScanManualAlignments?.left ?? null;
			return scanManualAlignments?.left ?? null;
		}, [
			scanRotateEditSide,
			editorScanManualAlignments?.left,
			scanManualAlignments?.left,
		]);

		const rightComposeScanAlignment = useMemo(() => {
			if (scanRotateEditSide === 'right') return editorScanManualAlignments?.right ?? null;
			return scanManualAlignments?.right ?? null;
		}, [
			scanRotateEditSide,
			editorScanManualAlignments?.right,
			scanManualAlignments?.right,
		]);

		const leftGeomAlignSig = `${leftGeometry?.uuid ?? ''}|${leftGeometry?.getAttribute('position')?.count ?? 0}`;
		const leftOverlayAlignSig =
			`${leftOverlayGeometry?.uuid ?? ''}|${leftOverlayGeometry?.getAttribute('position')?.count ?? 0}`;
		const leftRegMatEl = leftOverlayRegistration.matrix.elements;
		const leftRegSig = `${leftRegMatEl[12]}-${leftRegMatEl[13]}-${leftRegMatEl[14]}`;

		const leftScanOverlayAnchorTuple = useMemo((): THREE.Vector3Tuple => {
			const lateral = SCAN_OVERLAY_LATERAL_WORLD.left;
			const v = computeOverlayTopSurfaceAlignOffset(
				leftGeometry,
				leftOverlayGeometry,
				leftOverlayRegistration,
				new THREE.Vector3(...leftInsoleAxisWorld),
				{
					mmToWorld: MM_TO_WORLD,
					embedScanHeightFraction: DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
					sinkBiasMm: DEFAULT_SINK_BIAS_MM,
					maxDeltaWorld: MM_TO_WORLD * 70,
				},
			);
			return [lateral, v.y, v.z];
		}, [
			leftGeometry,
			leftGeomAlignSig,
			leftOverlayGeometry,
			leftOverlayAlignSig,
			leftOverlayRegistration,
			leftRegSig,
			leftInsoleAxisWorld,
		]);

		const rightGeomAlignSig = `${rightGeometry?.uuid ?? ''}|${rightGeometry?.getAttribute('position')?.count ?? 0}`;
		const rightOverlayAlignSig =
			`${rightOverlayGeometry?.uuid ?? ''}|${rightOverlayGeometry?.getAttribute('position')?.count ?? 0}`;
		const rightRegMatEl = rightOverlayRegistration.matrix.elements;
		const rightRegSig = `${rightRegMatEl[12]}-${rightRegMatEl[13]}-${rightRegMatEl[14]}`;

		const rightScanOverlayAnchorTuple = useMemo((): THREE.Vector3Tuple => {
			const lateral = SCAN_OVERLAY_LATERAL_WORLD.right;
			const v = computeOverlayTopSurfaceAlignOffset(
				rightGeometry,
				rightOverlayGeometry,
				rightOverlayRegistration,
				new THREE.Vector3(...rightInsoleAxisWorld),
				{
					mmToWorld: MM_TO_WORLD,
					embedScanHeightFraction: DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
					sinkBiasMm: DEFAULT_SINK_BIAS_MM,
					maxDeltaWorld: MM_TO_WORLD * 70,
				},
			);
			return [lateral, v.y, v.z];
		}, [
			rightGeometry,
			rightGeomAlignSig,
			rightOverlayGeometry,
			rightOverlayAlignSig,
			rightOverlayRegistration,
			rightRegSig,
			rightInsoleAxisWorld,
		]);
		const leftScanMatrix = useMemo(() => {
			const upAxis = new THREE.Vector3(...leftInsoleAxisWorld).normalize();
			if (upAxis.lengthSq() < 1e-12) upAxis.set(0, 1, 0);
			return composeOverlayManualYawMatrix(
				leftScanOverlayAnchorTuple,
				leftOverlayRegistration.matrix,
				leftComposeScanAlignment,
				upAxis,
			);
		}, [
			leftComposeScanAlignment,
			leftInsoleAxisWorld,
			leftOverlayRegistration.matrix,
			leftScanOverlayAnchorTuple,
		]);

		const rightScanMatrix = useMemo(() => {
			const upAxis = new THREE.Vector3(...rightInsoleAxisWorld).normalize();
			if (upAxis.lengthSq() < 1e-12) upAxis.set(0, 1, 0);
			return composeOverlayManualYawMatrix(
				rightScanOverlayAnchorTuple,
				rightOverlayRegistration.matrix,
				rightComposeScanAlignment,
				upAxis,
			);
		}, [
			rightComposeScanAlignment,
			rightInsoleAxisWorld,
			rightOverlayRegistration.matrix,
			rightScanOverlayAnchorTuple,
		]);

		const showRegistrationDebug =
			process.env.NODE_ENV === 'development' &&
			(leftOverlayRegistration.valid || rightOverlayRegistration.valid);

		/* eslint-disable react-hooks/set-state-in-effect -- syncing overlay STL geometry when URLs clear */
		useEffect(() => {
			if (!leftOverlayUrl) setLeftOverlayGeometry(null);
			if (!rightOverlayUrl) setRightOverlayGeometry(null);
		}, [leftOverlayUrl, rightOverlayUrl]);
		/* eslint-enable react-hooks/set-state-in-effect */

		const handleLogCamera = () => {
			const cam = cameraRef.current;
			const ctrl = controlsRef.current;
			if (!cam) return;
			void ctrl;
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
				leftMeshRef.current.position.set(-30, 0, 0);
			}
			if (rightMeshRef.current) {
				rightMeshRef.current.position.set(30, 0, 0);
			}
		};

		const getSideGeometry = (side: 'left' | 'right') =>
			side === 'left' ? leftGeometry : rightGeometry;
		const getSideMmToWorld = (side: 'left' | 'right') =>
			side === 'left' ? leftMmToWorld : rightMmToWorld;

		const getDimensionsMm = (
			geometry: THREE.BufferGeometry,
			mmToWorld: number
		) => {
			const g = geometry.clone();
			g.computeBoundingBox();
			const box = g.boundingBox;
			if (!box) {
				g.dispose();
				return null;
			}
			const worldToMm = 1 / Math.max(1e-6, mmToWorld || 1);
			const size = box.getSize(new THREE.Vector3()).multiplyScalar(worldToMm);
			const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
			g.dispose();
			return {
				lengthMm: dims[2] ?? 0,
				widthMm: dims[1] ?? 0,
				heightMm: dims[0] ?? 0,
			};
		};

		const estimateSignedVolume = (geometry: THREE.BufferGeometry) => {
			const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
			const index = geometry.getIndex();
			if (!pos || !index) return 0;
			let volume = 0;
			for (let i = 0; i < index.count; i += 3) {
				const ia = index.getX(i);
				const ib = index.getX(i + 1);
				const ic = index.getX(i + 2);
				const ax = pos.getX(ia);
				const ay = pos.getY(ia);
				const az = pos.getZ(ia);
				const bx = pos.getX(ib);
				const by = pos.getY(ib);
				const bz = pos.getZ(ib);
				const cx = pos.getX(ic);
				const cy = pos.getY(ic);
				const cz = pos.getZ(ic);
				volume +=
					(ax * by * cz + bx * cy * az + cx * ay * bz - ax * cy * bz - bx * ay * cz - cx * by * az) /
					6;
			}
			return volume;
		};

		const repairForSlicing = (geometry: THREE.BufferGeometry) => {
			// ÔöÇÔöÇ 0. Snap vertices to 0.1 ┬Ám grid ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
			// Eliminates sub-micron floating-point noise that creates T-junctions
			// and near-duplicate edges which PrusaSlicer flags as intersections.
			snapVerticesToGrid(geometry, 1e-4);

			// ÔöÇÔöÇ 1. Merge duplicate vertices ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
			// Use 1e-4 mm tolerance (0.1 ┬Ám) ÔÇô tight enough to preserve detail
			// but loose enough to catch near-coincident verts from rounding.
			let g = BufferGeometryUtils.mergeVertices(geometry, 1e-4);
			if (!g.getIndex()) {
				const indexed = BufferGeometryUtils.mergeVertices(g, 1e-4);
				if (indexed !== g) {
					g.dispose();
					g = indexed;
				}
			}

			// ÔöÇÔöÇ 2. Remove duplicate / overlapping faces ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
			// CSG operations and merge can produce doubled faces (same 3 verts,
			// different winding).  These cause PrusaSlicer facet-intersection
			// warnings and confuse winding analysis.
			g = removeDuplicateFaces(g);

			// ÔöÇÔöÇ 3. Fill ALL boundary holes (watertight for slicing) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
			// The display pipeline keeps the outer perimeter open (fillAll=false)
			// but PrusaSlicer needs a fully closed solid to determine inside/outside
			// correctly and avoid fragmented perimeters with crossing travels.
			g = fillMeshHoles(g, Infinity, true);

			// ÔöÇÔöÇ 4. Remove degenerate triangles ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
			// Zero-area, NaN, or near-zero-area faces confuse slicer topology
			// detection, causing extra shells and crossing travel lines.
			// (returns non-indexed geometry, so we re-merge afterwards)
			g = removeDegenerateTriangles(g);

			// ÔöÇÔöÇ 5. Re-merge after degenerate removal ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
			g = BufferGeometryUtils.mergeVertices(g, 1e-4);

			// ÔöÇÔöÇ 6. Remove duplicate faces (again after re-merge) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
			g = removeDuplicateFaces(g);

			// ÔöÇÔöÇ 7. Fix winding order (consistent outward normals) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
			const index = g.getIndex();
			if (index) {
				const signedVol = estimateSignedVolume(g);
				if (signedVol < 0) {
					for (let i = 0; i < index.count; i += 3) {
						const b = index.getX(i + 1);
						const c = index.getX(i + 2);
						index.setX(i + 1, c);
						index.setX(i + 2, b);
					}
					index.needsUpdate = true;
				}
			}

			// ÔöÇÔöÇ 8. Recompute clean normals ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
			g.deleteAttribute('normal');
			g.computeVertexNormals();
			g.normalizeNormals();
			return g;
		};

		const toExportGeometryMm = (
			geometry: THREE.BufferGeometry,
			mmToWorld: number
		) => {
			const g = geometry.clone();
			const worldToMm = 1 / Math.max(1e-6, mmToWorld || 1);
			g.applyMatrix4(new THREE.Matrix4().makeScale(worldToMm, worldToMm, worldToMm));

			// ÔöÇÔöÇ Auto-orient for slicer: X = length, Y = width, Z = thickness ÔöÇÔöÇ
			// The viewer geometry has arbitrary axis mapping depending on the
			// original STL.  We detect the axes by bounding-box span (longest =
			// length, middle = width, thinnest = thickness/height) and remap so
			// the insole lies flat with Z as the short thickness axis.
			g.computeBoundingBox();
			const box = g.boundingBox;
			if (box) {
				const size = box.getSize(new THREE.Vector3());
				const axes: [number, number][] = [
					[size.x, 0], [size.y, 1], [size.z, 2],
				];
				axes.sort((a, b) => a[0] - b[0]);
				// axes[0] = thinnest (ÔåÆ Z), axes[1] = middle (ÔåÆ Y), axes[2] = longest (ÔåÆ X)
				const thinnestIdx = axes[0][1];
				const middleIdx = axes[1][1];
				const longestIdx = axes[2][1];

				// Only remap if not already in the desired layout (longest=X, middle=Y, thinnest=Z)
				if (longestIdx !== 0 || middleIdx !== 1 || thinnestIdx !== 2) {
					const pos = g.getAttribute('position') as THREE.BufferAttribute;
					if (pos) {
						const arr = pos.array as Float32Array;
						const tmp = new Float32Array(arr.length);
						for (let i = 0; i < pos.count; i++) {
							const off = i * 3;
							const vals = [arr[off], arr[off + 1], arr[off + 2]];
							// Map: longestIdx ÔåÆ X, middleIdx ÔåÆ Y, thinnestIdx ÔåÆ Z
							tmp[off] = vals[longestIdx];
							tmp[off + 1] = vals[middleIdx];
							tmp[off + 2] = vals[thinnestIdx];
						}
						arr.set(tmp);
						pos.needsUpdate = true;
					}
				}

				// Recompute bounding box after remap and drop to Z = 0
				g.computeBoundingBox();
				const newBox = g.boundingBox;
				if (newBox) {
					g.applyMatrix4(new THREE.Matrix4().makeTranslation(
						-(newBox.min.x + newBox.max.x) / 2,
						-(newBox.min.y + newBox.max.y) / 2,
						-newBox.min.z,
					));
				}
			}
			return repairForSlicing(g);
		};

		const getPairExportGeometryMm = (spacingMm = 15) => {
			if (!leftGeometry || !rightGeometry) return null;
			const left = toExportGeometryMm(leftGeometry, leftMmToWorld || 1);
			const right = toExportGeometryMm(rightGeometry, rightMmToWorld || 1);

			left.computeBoundingBox();
			right.computeBoundingBox();
			const leftBox = left.boundingBox;
			const rightBox = right.boundingBox;
			if (!leftBox || !rightBox) {
				left.dispose();
				right.dispose();
				return null;
			}

			// Place insoles side-by-side along Y (width axis).
			// After toExportGeometryMm each insole is centred at Y=0.
			const leftShift = -(leftBox.max.y + spacingMm * 0.5);
			const rightShift = -(rightBox.min.y - spacingMm * 0.5);
			left.applyMatrix4(new THREE.Matrix4().makeTranslation(0, leftShift, 0));
			right.applyMatrix4(new THREE.Matrix4().makeTranslation(0, rightShift, 0));

			const merged = BufferGeometryUtils.mergeGeometries([left, right], false);
			left.dispose();
			right.dispose();
			if (!merged) return null;
			return repairForSlicing(merged);
		};

		useImperativeHandle(ref, () => ({
			match: handleMatch,
			reset: handleReset,
			getInsoleGeometry: () => {
				if (generatedInsole) return generatedInsole;
				if (selectedSide === 'left') return leftGeometry;
				if (selectedSide === 'right') return rightGeometry;
				return rightGeometry ?? leftGeometry;
			},
			getFinalInsoleGeometry: (side: 'left' | 'right') =>
				getSideGeometry(side)?.clone() ?? null,
			getExportInsoleGeometryMm: (side: 'left' | 'right') => {
				const geom = getSideGeometry(side);
				if (!geom) return null;
				return toExportGeometryMm(geom, getSideMmToWorld(side));
			},
			getExportPairGeometryMm: (spacingMm = 15) =>
				getPairExportGeometryMm(spacingMm),
			getInsoleDimensionsMm: (side: 'left' | 'right') => {
				const geom = getSideGeometry(side);
				if (!geom) return null;
				return getDimensionsMm(geom, getSideMmToWorld(side));
			},
			getRightGeometry: () => rightGeometry,
			getRightMmToWorld: () => rightMmToWorld || 1,
			focusOnSide,
		}), [
			handleMatch,
			handleReset,
			generatedInsole,
			selectedSide,
			leftGeometry,
			rightGeometry,
			leftMmToWorld,
			rightMmToWorld,
			focusOnSide,
		]);

		/* eslint-disable react-hooks/set-state-in-effect -- landmark transform depends on mounted mesh matrices */
		useEffect(() => {
			if (!landmarkPoints || !rightMeshRef.current) {
				setLocalLandmarks((prev) => (prev === null ? prev : null));
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
			setLocalLandmarks((prev) => {
				if (
					prev &&
					prev.meta1[0] === next.meta1[0] && prev.meta1[1] === next.meta1[1] && prev.meta1[2] === next.meta1[2] &&
					prev.meta5[0] === next.meta5[0] && prev.meta5[1] === next.meta5[1] && prev.meta5[2] === next.meta5[2] &&
					prev.navicular[0] === next.navicular[0] && prev.navicular[1] === next.navicular[1] && prev.navicular[2] === next.navicular[2] &&
					prev.calcaneus[0] === next.calcaneus[0] && prev.calcaneus[1] === next.calcaneus[1] && prev.calcaneus[2] === next.calcaneus[2] &&
					prev.heel[0] === next.heel[0] && prev.heel[1] === next.heel[1] && prev.heel[2] === next.heel[2]
				) {
					return prev;
				}
				return next;
			});
		}, [landmarkPoints, rightGeometry]);
		/* eslint-enable react-hooks/set-state-in-effect */

		useEffect(() => {
			return () => {
				generatedInsole?.dispose?.();
			};
		}, [generatedInsole]);

		useEffect(() => {
			if (!cameraRef.current || !controlsRef.current) return;

			const cam = cameraRef.current;
			const c = controlsRef.current;

			if (lockTopView) {
				// Strict 90┬░ top-down view for point picking.
				c.enableRotate = false;
				c.enablePan = true;
				c.enableZoom = true;
				// Do NOT constrain polar/azimuth ÔÇö those force the camera to +Y regardless
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

					cam.position.set(center.x, center.y, center.z + dist);
					cam.up.set(0, 1, 0);
					cam.lookAt(center);
					c.target.copy(center);
				} else {
					cam.position.set(50, 0, 200);
					cam.up.set(0, 1, 0);
					cam.lookAt(50, 0, 0);
					c.target.set(50, 0, 0);
				}
			} else if (analysisEnabled) {
				// Analysis mode: fixed camera (heel eye-level), no navigation.
				c.enableRotate = false;
				c.enablePan = false;
				c.enableZoom = false;
				c.minPolarAngle = 0.01;
				c.maxPolarAngle = Math.PI - 0.01;
				c.minAzimuthAngle = -Infinity;
				c.maxAzimuthAngle = Infinity;

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
				// Frame both insoles together with comfortable margin so the user can read
				// the height profile of the pair, not just an extreme close-up.
				const pairWidth = size.x;
				const profileHeight = size.y;
				const halfFovRad = THREE.MathUtils.degToRad((cam.fov || 50) / 2);
				const aspect =
					typeof window !== 'undefined' && window.innerHeight > 0
						? window.innerWidth / window.innerHeight
						: 16 / 9;
				const distForWidth = (pairWidth * 0.5) / (Math.tan(halfFovRad) * aspect);
				const distForHeight = (profileHeight * 0.5) / Math.tan(halfFovRad);
				const fitDist = Math.max(distForWidth, distForHeight);
				// 1.55× framing margin keeps both insoles fully visible without floating
				// in a sea of empty space.
				const closeDist = Math.max(260, fitDist * 1.55);
				cam.position.set(center.x, center.y + closeDist * 0.02, center.z + closeDist);
				cam.up.set(0, 1, 0);
				cam.lookAt(center);
				c.target.copy(center);
			} else {
				// Normal mode: only configure controls, do NOT reposition the camera
				// (let the user keep their current view when toggling visibility options)
				c.enableRotate = true;
				c.enablePan = true;
				c.enableZoom = true;
				c.minPolarAngle = 0;
				c.maxPolarAngle = Math.PI;
				c.minAzimuthAngle = -Infinity;
				c.maxAzimuthAngle = Infinity;
			}
			c.update();
		}, [lockTopView, analysisEnabled]);

		useEffect(() => {
			if (lockTopView || analysisEnabled) return;
			if (!cameraRef.current || !controlsRef.current) return;
			const cam = cameraRef.current;
			const c = controlsRef.current;

			// Always apply control mode immediately
			if (controlMode === 'pan') {
				c.enableRotate = false;
				c.enablePan = true;
				c.enableZoom = true;
			} else {
				c.enableRotate = true;
				c.enablePan = true;
				c.enableZoom = true;
			}

			// Only reposition the camera on first geometry load OR when the user
			// explicitly changes the view preset. Toggling showLeft/showRight/
			// showInsoles/showModel must NOT reset the camera.
			const presetChanged = prevPresetRef.current !== effectiveViewPreset;
			prevPresetRef.current = effectiveViewPreset;
			if (cameraInitRef.current && !presetChanged) {
				c.update();
				return;
			}
			cameraInitRef.current = true;

			// Compute a world bbox from currently visible meshes
			const box = new THREE.Box3();
			let hasBox = false;
			if (leftMeshRef.current) {
				box.union(new THREE.Box3().setFromObject(leftMeshRef.current));
				hasBox = true;
			}
			if (rightMeshRef.current) {
				box.union(new THREE.Box3().setFromObject(rightMeshRef.current));
				hasBox = true;
			}
			const center = hasBox ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);
			const size = hasBox ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(200, 200, 200);
			const span = Math.max(size.x, size.y, size.z);
			const dist = Math.max(180, span * 1.9);
			// Named views use a closer camera distance for better detail
			const closeDist = dist * 0.605;

			switch (effectiveViewPreset) {
				case 'top':
					cam.position.set(center.x, center.y + closeDist, center.z + 0.001);
					cam.up.set(0, 0, 1);
					break;
				case 'bottom':
					cam.position.set(center.x, center.y - closeDist, center.z - 0.001);
					cam.up.set(0, 0, 1);
					break;
				case 'front':
					// Front of insole = toe end = -Z direction
					cam.position.set(center.x, center.y + closeDist * 0.15, center.z - closeDist);
					cam.up.set(0, 1, 0);
					break;
				case 'back':
					// Back of insole = heel end = +Z direction
					cam.position.set(center.x, center.y + closeDist * 0.15, center.z + closeDist);
					cam.up.set(0, 1, 0);
					break;
				case 'left':
					cam.position.set(center.x - closeDist, center.y + closeDist * 0.03, center.z);
					cam.up.set(0, 1, 0);
					break;
				case 'right':
					cam.position.set(center.x + closeDist, center.y + closeDist * 0.03, center.z);
					cam.up.set(0, 1, 0);
					break;
				case 'iso':
					// Oogpunt: edge-on cross-section from the front/toe end,
					// camera nearly level with the insole so you can see the
					// height profile (arch, heel cup) like a side cutaway.
					cam.position.set(center.x, center.y + closeDist * 0.04, center.z - closeDist * 0.7);
					cam.up.set(0, 1, 0);
					break;
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
			analysisEnabled,
			controlMode,
			effectiveViewPreset,
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
			cam.position.set(center.x, center.y, center.z + dist);
			cam.up.set(0, 1, 0);
			cam.lookAt(center);
			c.target.copy(center);
			c.update();
		}, [lockTopView, rightGeometry]);

		const editorInteractiveProfiles = editTrimlineHandleProfiles ?? trimlineHandleProfiles;

		return (
			<div className={`w-full h-full bg-gray-900 relative ${analysisEnabled ? 'cursor-crosshair' : ''}`}>
				<DevPerformanceOverlay />
				<Canvas
					frameloop="demand"
					performance={{ min: 0.6, debounce: 150 }}
					gl={{
						// Neutral (Khronos PBR-neutral) tone mapping keeps contrast and
						// color on the bright near-white insole instead of ACES washing it out.
						toneMapping: THREE.NeutralToneMapping,
						toneMappingExposure: 1.28,
					}}
					onPointerMissed={() => {
						if (pointPickMode) return;
						if (printPrepInteractive && onPrintInteractionDeselect) {
							onPrintInteractionDeselect();
							return;
						}
						onDeselectSide?.();
					}}
				>
					<PerspectiveCamera
						ref={cameraRef}
						makeDefault
						position={[0, -60, 180]}
						fov={50}
					/>
					<ambientLight intensity={0.08} />
					<hemisphereLight args={['#dfe1e6', '#1c2330', 0.2]} />
					{/* Key light — raking from upper front-right; produces the strong
					    diagonal gradient that defines arch ridge and heel cup walls. */}
					<directionalLight position={[55, 40, 50]} intensity={1.7} />
					{/* Single weak fill from upper-left — keeps the shadow side
					    readable without flattening the form. Kept low on purpose. */}
					<directionalLight position={[-55, 50, 25]} intensity={0.18} />
					{/* Rim — cool, from behind-below for subtle edge separation */}
					<directionalLight position={[0, -30, -50]} intensity={0.28} color="#cdd6e6" />

					<Suspense fallback={null}>
						<ScanInsoleUpAxisSampler
							treeRef={leftMeshRef}
							geometry={leftGeometry}
							active={Boolean(leftGeometry)}
							onAxisWorld={(w) => setLeftInsoleAxisWorld([w.x, w.y, w.z])}
						/>
						<ScanInsoleUpAxisSampler
							treeRef={rightMeshRef}
							geometry={rightGeometry}
							active={Boolean(rightGeometry)}
							onAxisWorld={(w) => setRightInsoleAxisWorld([w.x, w.y, w.z])}
						/>
						{!effectiveHideScans && showInsoles && showLeft && leftUrl && (
							<group ref={leftMeshRef}>
								<STLMesh
									url={leftUrl}
									meshRole={pointPickMode ? 'scan' : 'insole'}
									flipLongAxis={pointPickMode ? false : shouldFlipBaseLongAxis}
									targetForefootWidthMm={targetForefootWidthMm?.left ?? undefined}
									targetTrimlineProfile={!pointPickMode ? leftTrimlineProfile : null}
									trimlineOffsetMm={trimlineOffsetMm}
									trimlineAdjustments={trimlineAdjustments?.left}
									trimlineHandleProfile={trimlineHandleProfiles?.left ?? null}
									color={leftOverlayUrl || rightOverlayUrl ? '#e2e6ec' : '#dee2e6'}
									position={[-30 + driekwartLeftOffset.x, driekwartLeftOffset.y, driekwartLeftOffset.z]}
									interactive={!disableInteraction}
									onGeometryReady={handleLeftGeometryReady}
									onPickPoint={(pt) => onPickPoint?.([pt.x, pt.y, pt.z])}
									pointPickMode={pointPickMode}
									showZones={showZones}
									heatmap={heatmap}
									clampDebug={clampDebug}
									deviationMap={deviationMap}
									transparentMode={transparent}
									sideInspectionActive={sideInspectionActive}
									sideInspectionView={effectiveViewPreset === 'right' ? 'right' : 'left'}
									probeEnabled={analysisEnabled}
									onProbe={(payload) => {
										const next = {
											point: payload.point.toArray() as [number, number, number],
											heightMm: payload.heightMm,
											side: payload.side,
										};
										onProbe?.(next);
									}}
									selected={disableInteraction ? false : selectedSide === 'left'}
									onSelect={disableInteraction ? undefined : onSelectSide}
									onZoneClick={disableInteraction ? undefined : onZoneClick}
									showBoxGrid={showGrid && boxEnabled.left}
									gridEditMode={gridEditMode}
									heelEdgeThicknessMm={heelEdgeThicknessMm.left}
									savedBoxGridOffsets={savedBoxGridOffsets?.left ?? null}
									onBoxGridSave={onBoxGridSave ? (offsets) => onBoxGridSave('left', offsets) : undefined}
									corrections={corrections}
									activeCorrections={activeCorrections}
									textPlacementEnabled={textPlacementEnabled}
									textPlacementText={textPlacementText}
									bottomTextOverlay={bottomTextOverlay}
									onBottomTextLoadingChange={onBottomTextLoadingChange}
									onBottomTextValidityChange={onBottomTextValidityChange}
									onTextPlace={onTextPlace}
									elementPlacementMode={elementPlacementMode?.side === 'left' ? elementPlacementMode : null}
									onElementPlace={onElementPlace}
									selectedElementTrimlineEdit={selectedElementTrimlineEdit?.side === 'left' ? selectedElementTrimlineEdit : null}
									selectedElementBoxEdit={selectedElementBoxEdit?.side === 'left' ? selectedElementBoxEdit : null}
									onPendingElementTrimlineProfileChange={onPendingElementTrimlineProfileChange}
									onElementBoxGridSave={onElementBoxGridSave}
									onTrimDragActiveChange={handleInteractionDragActive}
									side="left"
									placedElements={leftPlacedElements}
									evaBlockMode={evaBlockMode}
									printPrepSplit={leftPrintSplitPrep}
									printPrepSelectedZone={printPrepSelectedZone}
									printPrepHoveredZone={printPrepHoveredZones.left}
									onPrintPrepZoneHover={
										disableInteraction ? undefined : onPrintPrepZoneHover
									}
									printPrepWhole={leftPrintWholePrep}
									onPrintWholeInsoleClick={
										disableInteraction ? undefined : onPrintWholeInsoleClick
									}
									onPrintElementClick={onPrintElementClick}
									printSelectedElementId={printSelectedElementId ?? null}
									printElementSelectionHighlight={printElementSelectionHighlight}
								/>
							</group>
						)}
						{!effectiveHideScans && showInsoles && showRight && rightUrl && (
							<group ref={rightMeshRef}>
								<STLMesh
									url={rightUrl}
									meshRole={pointPickMode ? 'scan' : 'insole'}
									flipLongAxis={pointPickMode ? false : shouldFlipBaseLongAxis}
									targetForefootWidthMm={targetForefootWidthMm?.right ?? undefined}
									targetTrimlineProfile={!pointPickMode ? rightTrimlineProfile : null}
									trimlineOffsetMm={trimlineOffsetMm}
									trimlineAdjustments={trimlineAdjustments?.right}
									trimlineHandleProfile={trimlineHandleProfiles?.right ?? null}
									color={leftOverlayUrl || rightOverlayUrl ? '#e2e6ec' : '#dee2e6'}
									position={[30 + driekwartRightOffset.x, driekwartRightOffset.y, driekwartRightOffset.z]}
									interactive={!disableInteraction}
									onGeometryReady={handleRightGeometryReady}
									onPickPoint={(pt) => onPickPoint?.([pt.x, pt.y, pt.z])}
									pointPickMode={pointPickMode}
									showZones={showZones}
									heatmap={heatmap}
									clampDebug={clampDebug}
									deviationMap={deviationMap}
									transparentMode={transparent}
									sideInspectionActive={sideInspectionActive}
									sideInspectionView={effectiveViewPreset === 'right' ? 'right' : 'left'}
									probeEnabled={analysisEnabled}
									onProbe={(payload) => {
										const next = {
											point: payload.point.toArray() as [number, number, number],
											heightMm: payload.heightMm,
											side: payload.side,
										};
										onProbe?.(next);
									}}
									selected={disableInteraction ? false : selectedSide === 'right'}
									onSelect={disableInteraction ? undefined : onSelectSide}
									onZoneClick={disableInteraction ? undefined : onZoneClick}
									showBoxGrid={showGrid && boxEnabled.right}
									gridEditMode={gridEditMode}
									heelEdgeThicknessMm={heelEdgeThicknessMm.right}
									savedBoxGridOffsets={savedBoxGridOffsets?.right ?? null}
									onBoxGridSave={onBoxGridSave ? (offsets) => onBoxGridSave('right', offsets) : undefined}
									corrections={corrections}
									activeCorrections={activeCorrections}
									textPlacementEnabled={textPlacementEnabled}
									textPlacementText={textPlacementText}
									bottomTextOverlay={bottomTextOverlay}
									onBottomTextLoadingChange={onBottomTextLoadingChange}
									onBottomTextValidityChange={onBottomTextValidityChange}
									onTextPlace={onTextPlace}
									elementPlacementMode={elementPlacementMode?.side === 'right' ? elementPlacementMode : null}
									onElementPlace={onElementPlace}
									selectedElementTrimlineEdit={selectedElementTrimlineEdit?.side === 'right' ? selectedElementTrimlineEdit : null}
									selectedElementBoxEdit={selectedElementBoxEdit?.side === 'right' ? selectedElementBoxEdit : null}
									onPendingElementTrimlineProfileChange={onPendingElementTrimlineProfileChange}
									onElementBoxGridSave={onElementBoxGridSave}
									onTrimDragActiveChange={handleInteractionDragActive}
									side="right"
									placedElements={rightPlacedElements}
									evaBlockMode={evaBlockMode}
									printPrepSplit={rightPrintSplitPrep}
									printPrepSelectedZone={printPrepSelectedZone}
									printPrepHoveredZone={printPrepHoveredZones.right}
									onPrintPrepZoneHover={
										disableInteraction ? undefined : onPrintPrepZoneHover
									}
									printPrepWhole={rightPrintWholePrep}
									onPrintWholeInsoleClick={
										disableInteraction ? undefined : onPrintWholeInsoleClick
									}
									onPrintElementClick={onPrintElementClick}
									printSelectedElementId={printSelectedElementId ?? null}
									printElementSelectionHighlight={printElementSelectionHighlight}
								/>
							</group>
						)}

						{!hideScans && effectiveShowModel && showInsoles && showLeft && leftOverlayUrl && (
							<ScanOcclusionDepthPrepass
								geometry={leftGeometry}
								position={[-30 + driekwartLeftOffset.x, driekwartLeftOffset.y, driekwartLeftOffset.z]}
							/>
						)}
						{!hideScans && effectiveShowModel && showInsoles && showRight && rightOverlayUrl && (
							<ScanOcclusionDepthPrepass
								geometry={rightGeometry}
								position={[30 + driekwartRightOffset.x, driekwartRightOffset.y, driekwartRightOffset.z]}
							/>
						)}

						{/* Scan overlays (non-interactive) depth-test against the insole support */}
						{!sideInspectionActive && !hideScans && effectiveShowModel && showLeft && leftOverlayUrl && (
							<group ref={leftOverlayRootRef} position={leftScanOverlayAnchorTuple}>
								<group matrixAutoUpdate={false} matrix={leftScanMatrix}>
									<STLMesh
										url={leftOverlayUrl}
										meshRole="overlayScan"
										viewerOverlayMode="embedded"
										flipLongAxis={true}
										color="#d9b5a1"
										position={[0, 0, 0]}
										interactive={false}
										rotationOffset={[Math.PI, 0, Math.PI]}
										transparentMode={true}
										opacity={0.78}
										showZones={false}
										heatmap={false}
										pointPickMode={false}
										sideInspectionActive={sideInspectionActive}
										onGeometryReady={(geom) => setLeftOverlayGeometry(geom)}
										side="left"
									/>
								</group>
							</group>
						)}
						{!sideInspectionActive && !hideScans && effectiveShowModel && showRight && rightOverlayUrl && (
							<group ref={rightOverlayRootRef} position={rightScanOverlayAnchorTuple}>
								<group matrixAutoUpdate={false} matrix={rightScanMatrix}>
									<STLMesh
										url={rightOverlayUrl}
										meshRole="overlayScan"
										viewerOverlayMode="embedded"
										flipLongAxis={true}
										color="#d9b5a1"
										position={[0, 0, 0]}
										interactive={false}
										rotationOffset={[Math.PI, 0, Math.PI]}
										transparentMode={true}
										opacity={0.78}
										showZones={false}
										heatmap={false}
										pointPickMode={false}
										sideInspectionActive={sideInspectionActive}
										onGeometryReady={(geom) => setRightOverlayGeometry(geom)}
										side="right"
									/>
								</group>
							</group>
						)}

						{/* Base template preview when requested */}
						{showBasePreview && (
							<group>
								<BaseInsolePreview position={[-80, 0, 0]} />
								<BaseInsolePreview position={[80, 0, 0]} />
							</group>
						)}
						{/* Generated insole preview (legacy) */}
						{effectiveShowGeneratedInsole && generatedInsole && (
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

						{/* Interactive trimline handles for left insole */}
						{trimlineEditSide === 'left' && leftGeometry && (
							<group
								position={[-30 + driekwartLeftOffset.x, driekwartLeftOffset.y, driekwartLeftOffset.z]}
								rotation={[-Math.PI / 2, 0, 0]}
							>
								<InteractiveTrimline
									insoleGeometry={leftGeometry}
									onPendingProfileChange={(profile) => onPendingTrimlineProfileChange?.('left', profile)}
									profile={editorInteractiveProfiles?.left ?? null}
									mmToWorld={leftMmToWorld || MM_TO_WORLD}
									active={true}
									mode="insole"
									onDragActiveChange={handleInteractionDragActive}
								/>
							</group>
						)}
						{/* Interactive trimline handles for right insole */}
						{trimlineEditSide === 'right' && rightGeometry && (
							<group
								position={[30 + driekwartRightOffset.x, driekwartRightOffset.y, driekwartRightOffset.z]}
								rotation={[-Math.PI / 2, 0, 0]}
							>
								<InteractiveTrimline
									insoleGeometry={rightGeometry}
									onPendingProfileChange={(profile) => onPendingTrimlineProfileChange?.('right', profile)}
									profile={editorInteractiveProfiles?.right ?? null}
									mmToWorld={rightMmToWorld || MM_TO_WORLD}
									active={true}
									mode="insole"
									onDragActiveChange={handleInteractionDragActive}
								/>
							</group>
						)}
						{scanRotateEditSide === 'left' && leftGeometry && leftOverlayUrl && (
							<InteractiveScanRotate
								insoleGeometry={leftGeometry}
								scanGeometry={leftOverlayGeometry}
								insolePickRootRef={leftMeshRef}
								overlayPickRootRef={leftOverlayRootRef}
								upAxisWorld={new THREE.Vector3(...leftInsoleAxisWorld)}
								alignment={editorScanManualAlignments?.left ?? null}
								onPendingAlignmentChange={(a) =>
									onPendingScanAlignmentChange?.('left', a)
								}
								active={true}
								onDragActiveChange={handleInteractionDragActive}
								mmToWorld={leftMmToWorld || MM_TO_WORLD}
							/>
						)}
						{scanRotateEditSide === 'right' && rightGeometry && rightOverlayUrl && (
							<InteractiveScanRotate
								insoleGeometry={rightGeometry}
								scanGeometry={rightOverlayGeometry}
								insolePickRootRef={rightMeshRef}
								overlayPickRootRef={rightOverlayRootRef}
								upAxisWorld={new THREE.Vector3(...rightInsoleAxisWorld)}
								alignment={editorScanManualAlignments?.right ?? null}
								onPendingAlignmentChange={(a) =>
									onPendingScanAlignmentChange?.('right', a)
								}
								active={true}
								onDragActiveChange={handleInteractionDragActive}
								mmToWorld={rightMmToWorld || MM_TO_WORLD}
							/>
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


					{/* Analysis marker removed: native cursor is used */}

					{pointPickMode &&
						pickedPoints?.map((pt, idx) => {
							// Professional X marker (cross shape) like orthopedic competitor software
							const markerSize = 4;
							const markerThickness = 0.8;
							return (
								<group
									key={`${pt.join('-')}-${idx}`}
									position={[pt[0], pt[1] + 0.25, pt[2]]}
								>
									{/* Horizontal bar of X */}
									<mesh rotation={[0, Math.PI / 4, 0]}>
										<boxGeometry args={[markerSize, markerThickness, markerThickness]} />
										<meshStandardMaterial
											color="#111827"
											emissive="#000000"
											emissiveIntensity={0.2}
										/>
									</mesh>
									{/* Vertical bar of X */}
									<mesh rotation={[0, -Math.PI / 4, 0]}>
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
						enablePan={!analysisEnabled && !interactionDragActive}
						enableZoom={!analysisEnabled && !interactionDragActive}
						enableRotate={
							!lockTopView &&
							!analysisEnabled &&
							!gridEditMode &&
							!interactionDragActive
						}
						minDistance={2}
						maxDistance={800}
						minPolarAngle={0}
						maxPolarAngle={Math.PI}
						minAzimuthAngle={lockTopView ? 0 : undefined}
						maxAzimuthAngle={lockTopView ? 0 : undefined}
					/>

					{/* Ambient occlusion for surface definition. Skipped during grid/box
					    editing so the deformation widgets stay responsive. */}
					<ViewerPostFX enabled={!gridEditMode} />
				</Canvas>
				{showRegistrationDebug && (
					<div className="pointer-events-none absolute bottom-3 left-3 z-40 rounded-lg border border-ui-border bg-ui-panel/90 px-3 py-2 text-[11px] text-ui-text shadow">
						<div className="font-semibold text-ui-accent">Overlay registratie</div>
						<div>
							Links: {leftOverlayRegistration.valid ? `${leftOverlayRegistration.rmseMm.toFixed(2)} mm RMSE` : 'n.v.t.'}
						</div>
						<div>
							Rechts: {rightOverlayRegistration.valid ? `${rightOverlayRegistration.rmseMm.toFixed(2)} mm RMSE` : 'n.v.t.'}
						</div>
						<div className="mt-1 text-ui-muted">
							Trimline fit: {leftTrimlineProfile || rightTrimlineProfile ? `actief (+${trimlineOffsetMm}mm)` : 'uit'}
						</div>
						{leftTrimlineProfile && (
							<div className="text-ui-muted">
								L target lengte: {(leftTrimlineProfile.lengthWorld / Math.max(1e-6, MM_TO_WORLD) + trimlineOffsetMm * 2).toFixed(1)} mm
							</div>
						)}
						{rightTrimlineProfile && (
							<div className="text-ui-muted">
								R target lengte: {(rightTrimlineProfile.lengthWorld / Math.max(1e-6, MM_TO_WORLD) + trimlineOffsetMm * 2).toFixed(1)} mm
							</div>
						)}
					</div>
				)}
			</div>
		);
	}
);

EnhancedSTLViewerInner.displayName = 'EnhancedSTLViewerInner';

export const EnhancedSTLViewer = memo(EnhancedSTLViewerInner);
EnhancedSTLViewer.displayName = 'EnhancedSTLViewer';

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
import { Canvas, useLoader } from '@react-three/fiber';
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
import { applyAllCorrections } from '@/src/features/design/utils/insoleCorrections';
import type { OntwerpCorrections } from '@/src/shared/components/design/OntwerpPanel';
import type { CorrectionKey } from '@/src/shared/components/design/correctionsCatalog';
import type { PlacedElement } from '@/src/features/design/elements/types';
import { applyElements, applyElementColors, buildElementOverlayGeometries, getElementByKey, type ElementOverlayData } from '@/src/features/design/elements';
import type {
	TrimlineAdjustments,
	TrimlineHandleProfile,
} from '@/src/shared/components/design/TrimlineEditOverlay';
import { InteractiveTrimline } from './InteractiveTrimline';
import { InteractiveBoxGrid, applyBoxGridDeformation, type BoxGridPoint } from './InteractiveBoxGrid';

interface STLMeshProps {
	url: string;
	color?: string;
	position?: [number, number, number];
	meshRole?: 'scan' | 'overlayScan' | 'insole';
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
	textPlacementEnabled?: boolean;
	textPlacementText?: string;
	onTextPlace?: (payload: {
		side: 'left' | 'right';
		point: [number, number, number];
		normal: [number, number, number];
	}) => void;
	placedElements?: PlacedElement[];
	/** When true, render a solid rectangular block around the insole (EVA milling mode) */
	evaBlockMode?: boolean;
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

// Global viewer scale so ALL STLs keep real relative dimensions.
// Source STLs are expected in millimeters.
const MM_TO_WORLD = 0.4;

// Smooth interpolation for zone boundaries
function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
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

function computeOverlayRegistration(source: THREE.BufferGeometry | null, target: THREE.BufferGeometry | null): OverlayRegistration {
	if (!source || !target) return identityRegistration();
	const srcAnchors = extractFrameAnchors(source);
	const tgtAnchors = extractFrameAnchors(target);
	if (!srcAnchors || !tgtAnchors) return identityRegistration();

	const base = rigidFromFrames(srcAnchors, tgtAnchors);
	const refined = refineRigidICPTrimmed(source, target, base, 5);
	const worldToMm = 1 / Math.max(1e-6, MM_TO_WORLD);

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
	position = [0, 0, 0],
	meshRole = 'insole',
	flipLongAxis = false,
	targetForefootWidthMm,
	targetTrimlineProfile = null,
	trimlineOffsetMm = 3,
	trimlineAdjustments,
	trimlineHandleProfile,
	interactive = true,
	rotationOffset = [0, 0, 0],
	opacity,
	onGeometryReady,
	onPickPoint,
	pointPickMode = false,
	showZones = false,
	heatmap = false,
	clampDebug = false,
	deviationMap = false,
	transparentMode = false,
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
	textPlacementEnabled = false,
	textPlacementText = '',
	onTextPlace,
	placedElements,
	evaBlockMode = false,
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
	const totalInsoleHeightMm = getSideNumber(generalUnknown?.maxInsoleHeightMm, 10);
	const applyGeneral = meshRole === 'insole';
	const meshRef = useRef<THREE.Mesh>(null);
	const lastCorrectionsRef = useRef<string>('');
	const pendingSignatureRef = useRef<string>('');
	const geometryRef = useRef<THREE.BufferGeometry | null>(null);
	const animRafRef = useRef<number | null>(null);
	const correctedGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const correctedSignatureRef = useRef<string>('');
	const generalRafRef = useRef<number | null>(null);
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

			// Determine heel end via width-span heuristic (heel is usually wider than toe).
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
			const size = bbox.getSize(new THREE.Vector3());
			const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
			const sizes = { x: size.x, y: size.y, z: size.z };
			axes.sort((a, b) => sizes[a] - sizes[b]);
			const lengthAxis = axes[2];
			const widthAxis = axes[1];

			const minLen = lengthAxis === 'x' ? bbox.min.x : lengthAxis === 'y' ? bbox.min.y : bbox.min.z;
			const maxLen = lengthAxis === 'x' ? bbox.max.x : lengthAxis === 'y' ? bbox.max.y : bbox.max.z;
			const lenSpan = Math.max(1e-6, maxLen - minLen);

			// 1) Length fitting:
			// - default: shoe size heel-anchored stretch/compress
			// - preferred when trimline exists: fit to scan length + offset envelope
			const shoeSizeScale =
				typeof shoeSize === 'number' && Number.isFinite(shoeSize) && shoeSize > 0
					? euSizeToLengthMm(shoeSize) / euSizeToLengthMm(DEFAULT_SHOE_SIZE)
					: 1;
			const trimOffsetWorld = Math.max(0, trimlineOffsetMm + (trimlineAdjustments?.global ?? 0)) * nextMmToWorld;
			const targetTrimLength = targetTrimlineProfile
				? targetTrimlineProfile.lengthWorld + trimOffsetWorld * 2
				: null;
			const lengthScale = targetTrimLength
				? Math.max(0.8, Math.min(1.35, targetTrimLength / lenSpan))
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
					return a + (b - a) * (x - i0) + trimOffsetWorld;
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
						? (bbox.min.x + bbox.max.x) * 0.5
						: widthAxis === 'y'
							? (bbox.min.y + bbox.max.y) * 0.5
							: (bbox.min.z + bbox.max.z) * 0.5;

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

				const sourceForeHalf = Math.max(
					1e-6,
					sampleCurrentHalfWidth(0.72),
					sampleCurrentHalfWidth(0.82),
					sampleCurrentHalfWidth(0.92)
				);
				const targetForeHalf = Math.max(
					1e-6,
					sampleTrimHalfWidth(0.72),
					sampleTrimHalfWidth(0.82),
					sampleTrimHalfWidth(0.92)
				);
				const globalScale = Math.max(0.9, Math.min(1.22, targetForeHalf / sourceForeHalf));

				const sourceHeelHalf = Math.max(
					1e-6,
					sampleCurrentHalfWidth(0.02),
					sampleCurrentHalfWidth(0.08),
					sampleCurrentHalfWidth(0.14)
				);
				const targetHeelHalf = Math.max(
					1e-6,
					sampleTrimHalfWidth(0.02),
					sampleTrimHalfWidth(0.08),
					sampleTrimHalfWidth(0.14)
				);
				const heelScale = Math.max(0.9, Math.min(1.24, targetHeelHalf / sourceHeelHalf));

				const sourceToePadHalf = Math.max(
					1e-6,
					sampleCurrentHalfWidth(0.9),
					sampleCurrentHalfWidth(0.95),
					sampleCurrentHalfWidth(0.99)
				);
				const targetToePadHalf = Math.max(
					1e-6,
					sampleTrimHalfWidth(0.9),
					sampleTrimHalfWidth(0.95),
					sampleTrimHalfWidth(0.99)
				);
				const toeScale = Math.max(0.9, Math.min(1.26, targetToePadHalf / sourceToePadHalf));
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
					const sourceHalfW = Math.max(1e-6, sampleCurrentHalfWidth(tLen));
					const targetHalfW = Math.max(1e-6, sampleTrimHalfWidth(tLen));
					const rawLocalScale = Math.max(0.88, Math.min(1.24, targetHalfW / sourceHalfW));
					const smoothstep = (edge0: number, edge1: number, v: number) => {
						const t = Math.max(0, Math.min(1, (v - edge0) / Math.max(1e-6, edge1 - edge0)));
						return t * t * (3 - 2 * t);
					};
					const heelBlend = 1 - smoothstep(0.1, 0.28, tLen);
					const toeBlend = smoothstep(0.78, 0.98, tLen);
					const scaleDelta =
						(globalScale - 1) * 0.45 +
						(rawLocalScale - 1) * 0.35 +
						(heelScale - 1) * heelBlend * 0.2 +
						(toeScale - 1) * toeBlend * 0.3;
					const localScale = 1 + scaleDelta;
					const blend = smoothstep(0.04, 0.99, tLen);
					const noShrinkToe = smoothstep(0.72, 0.98, tLen);
					const noShrinkHeel = 1 - smoothstep(0.04, 0.22, tLen);
					const noShrinkBlend = Math.max(noShrinkToe, noShrinkHeel);
					const minScale = 1 - (1 - noShrinkBlend) * 0.03;
					const finalScale = Math.max(minScale, Math.min(1.3, 1 + (localScale - 1) * blend));

					const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
					const wScaled = centerW + (wVal - centerW) * finalScale;
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
						const nextAbs = Math.max(0, absDist + sampleHandleOffsetWorld(tLen, dist >= 0 ? 1 : -1) * edgeBlend);
						const wNext = centerW + (dist >= 0 ? 1 : -1) * nextAbs;
						if (widthAxis === 'x') posAttr.setX(i, wNext);
						else if (widthAxis === 'y') posAttr.setY(i, wNext);
						else posAttr.setZ(i, wNext);
					}
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
				const toeStart = heelAtMin ? minLen + lenSpan * 0.55 : maxLen - lenSpan * 0.75;
				const toeEnd = heelAtMin ? minLen + lenSpan * 0.9 : maxLen - lenSpan * 0.4;

				let foreMinW = Number.POSITIVE_INFINITY;
				let foreMaxW = Number.NEGATIVE_INFINITY;
				let foreCount = 0;
				for (let i = 0; i < posAttr.count; i++) {
					const x = posAttr.getX(i);
					const y = posAttr.getY(i);
					const z = posAttr.getZ(i);
					const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
					const inForefoot =
						(heelAtMin && lenVal >= toeStart && lenVal <= toeEnd) ||
						(!heelAtMin && lenVal <= toeStart && lenVal >= toeEnd);
					if (!inForefoot) continue;
					const wVal = widthAxis === 'x' ? x : widthAxis === 'y' ? y : z;
					foreMinW = Math.min(foreMinW, wVal);
					foreMaxW = Math.max(foreMaxW, wVal);
					foreCount++;
				}

				const currentForeWidth =
					foreCount > 12 ? Math.max(1e-6, foreMaxW - foreMinW) : Math.max(1e-6, size[widthAxis]);
				const widthScale = Math.max(0.82, Math.min(1.28, targetWidthWorld / currentForeWidth));
				const toeShoulderHalf = Math.max(1e-6, currentForeWidth * 0.5);
				const toeTipMinHalf = toeShoulderHalf * 0.38;
				const toeTipMaxHalf = toeShoulderHalf * 0.88;

				if (Number.isFinite(widthScale) && Math.abs(widthScale - 1) > 1e-3) {
					const centerW = widthAxis === 'x' ? (bbox.min.x + bbox.max.x) * 0.5 : widthAxis === 'y' ? (bbox.min.y + bbox.max.y) * 0.5 : (bbox.min.z + bbox.max.z) * 0.5;
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
					const smoothstep = (edge0: number, edge1: number, v: number) => {
						const t = Math.max(0, Math.min(1, (v - edge0) / Math.max(1e-6, edge1 - edge0)));
						return t * t * (3 - 2 * t);
					};

					for (let i = 0; i < posAttr.count; i++) {
						const x = posAttr.getX(i);
						const y = posAttr.getY(i);
						const z = posAttr.getZ(i);
						const lenVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
						const heelDist = heelAtMin ? lenVal - minLen : maxLen - lenVal;
						const tLen = Math.max(0, Math.min(1, heelDist / Math.max(1e-6, lenSpan)));
						const blend = smoothstep(0.08, 0.98, tLen);
						const localScale = 1 + (widthScale - 1) * blend;
						const noShrinkToe = smoothstep(0.72, 0.98, tLen);
						const noShrinkHeel = 1 - smoothstep(0.04, 0.22, tLen);
						const noShrinkBlend = Math.max(noShrinkToe, noShrinkHeel);
						const minScale = 1 - (1 - noShrinkBlend) * 0.03;
						const safeScale = Math.max(minScale, localScale);
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
						? (bbox.min.x + bbox.max.x) * 0.5
						: widthAxis === 'y'
							? (bbox.min.y + bbox.max.y) * 0.5
							: (bbox.min.z + bbox.max.z) * 0.5;
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
					const targetHalfW = hasTrimlineHandleProfile
						? Math.max(0.5 * nextMmToWorld, baseHalfW + sampleHandleOffsetWorld(tLen, sign))
						: Math.max(0.5 * nextMmToWorld, baseHalfW + sampleRegionOffsetWorld(tLen));
					const scaledAbs = Math.abs(dist) * (targetHalfW / baseHalfW);
					const wNext = centerW + sign * scaledAbs;
					if (widthAxis === 'x') posAttr.setX(i, wNext);
					else if (widthAxis === 'y') posAttr.setY(i, wNext);
					else posAttr.setZ(i, wNext);
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

			// Sole thickness + rim height are applied later as a fast post-step so slider edits blend smoothly.
		}

		// Recompute normals for better lighting. For STL inputs we also weld
		// duplicate vertices first, otherwise smooth shading can look striped.
		const smoothedGeometry = meshRole === 'insole'
			? smoothInsoleTopSurface(weldAndSmoothNormals(cloned))
			: (() => {
				cloned.computeVertexNormals();
				return cloned;
			})();

		return {
			baseGeometry: smoothedGeometry,
			mmToWorld: nextMmToWorld,
		};
	}, [
		rawGeometry,
		shoeSize,
		applyGeneral,
		flipLongAxis,
		targetForefootWidthMm,
		targetTrimlineProfile,
		trimlineOffsetMm,
		trimlineAdjustments,
		trimlineHandleProfile,
	]);

	// Create a working geometry that includes corrections
	const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
	useEffect(() => {
		geometryRef.current = geometry;
	}, [geometry]);

	// Overlay meshes for each placed element (rendered on top of insole)
	const [elementOverlays, setElementOverlays] = useState<ElementOverlayData[]>([]);

	// Pre-loaded STL geometries for elements that have stlUrl in their catalog entry
	const elementStlGeometriesRef = useRef<Map<string, THREE.BufferGeometry>>(new Map());

	// Load element STL files when placed elements change
	useEffect(() => {
		if (!placedElements || placedElements.length === 0) return;

		const loader = new STLLoader();
		const pending = new Map<string, Promise<THREE.BufferGeometry>>();

		for (const el of placedElements) {
			const item = getElementByKey(el.libraryKey);
			if (!item?.stlUrl) continue;
			if (elementStlGeometriesRef.current.has(item.stlUrl)) continue;
			if (pending.has(item.stlUrl)) continue;

			pending.set(item.stlUrl, new Promise<THREE.BufferGeometry>((resolve, reject) => {
				loader.load(item.stlUrl!, resolve, undefined, reject);
			}));
		}

		if (pending.size === 0) return;

		let cancelled = false;
		Promise.all(
			Array.from(pending.entries()).map(async ([url, p]) => {
				try {
					const geom = await p;
					if (!cancelled) {
						elementStlGeometriesRef.current.set(url, geom);
					}
				} catch (err) {
					console.warn(`Failed to load element STL: ${url}`, err);
				}
			})
		).then(() => {
			if (!cancelled) rebuildElementOverlays();
		});

		return () => { cancelled = true; };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [placedElements]);

	const rebuildElementOverlays = useCallback(() => {
		const geom = geometryRef.current;
		if (!geom || !placedElements || placedElements.length === 0) {
			setElementOverlays(prev => { prev.forEach(d => d.geometry.dispose()); return []; });
			return;
		}
		const overlays = buildElementOverlayGeometries(geom, placedElements, {
			mmToWorld: mmToWorld || 1,
			stlGeometries: elementStlGeometriesRef.current,
		});
		setElementOverlays(prev => { prev.forEach(d => d.geometry.dispose()); return overlays; });
	}, [placedElements, mmToWorld]);

	// EVA block: contour-following solid block (side walls + bottom cap, no top)
	const evaBlock = useMemo(() => {
		if (!evaBlockMode || !geometry) return null;

		geometry.computeBoundingBox();
		const bb = geometry.boundingBox!;
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

		const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
		if (!pos || pos.count < 3) return null;

		const g = (idx: number, axis: number) =>
			axis === 0 ? pos.getX(idx) : axis === 1 ? pos.getY(idx) : pos.getZ(idx);

		// Centroid in the UV plane
		let cu = 0, cv = 0;
		for (let i = 0; i < pos.count; i++) { cu += g(i, uI); cv += g(i, vI); }
		cu /= pos.count;
		cv /= pos.count;

		// Radial sweep: 180 angular bins → outermost vertex per bin
		const BINS = 180;
		const best = new Array<{ u: number; v: number; h: number; d: number } | null>(BINS).fill(null);

		for (let i = 0; i < pos.count; i++) {
			const u = g(i, uI);
			const v = g(i, vI);
			const h = g(i, hI);
			const du = u - cu, dv = v - cv;
			const d = Math.sqrt(du * du + dv * dv);
			const a = Math.atan2(dv, du);
			const bin = ((Math.floor(((a + Math.PI) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS;
			const cur = best[bin];
			if (!cur || d > cur.d) best[bin] = { u, v, h, d };
		}

		// Collect valid outline points (skip empty bins)
		const contour = best.filter((p): p is NonNullable<typeof p> => p !== null);
		if (contour.length < 3) return null;

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
		for (let i = 0; i < n; i++) {
			const a = contour[i];
			const b = contour[(i + 1) % n];
			const tA = v3(a.u, a.v, a.h);
			const tB = v3(b.u, b.v, b.h);
			const bA = v3(a.u, a.v, bottomH);
			const bB = v3(b.u, b.v, bottomH);
			verts.push(...tA, ...bA, ...tB);
			verts.push(...tB, ...bA, ...bB);
		}

		// ── Bottom cap: triangle fan from centroid ──
		const cB = v3(cu, cv, bottomH);
		for (let i = 0; i < n; i++) {
			const pA = v3(contour[i].u, contour[i].v, bottomH);
			const pB = v3(contour[(i + 1) % n].u, contour[(i + 1) % n].v, bottomH);
			verts.push(...cB, ...pB, ...pA);
		}

		const blockGeom = new THREE.BufferGeometry();
		blockGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		blockGeom.computeVertexNormals();

		return { geometry: blockGeom };
	}, [evaBlockMode, geometry]);

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
		},
		[soleThicknessMm, mmToWorld, smoothstep01]
	);

	const applyTotalInsoleHeightAfterCorrections = useCallback((geom: THREE.BufferGeometry) => {
		applyTotalInsoleHeight(geom, totalInsoleHeightMm);
	}, [applyTotalInsoleHeight, totalInsoleHeightMm]);

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
			onGeometryReady?.(existing, { mmToWorld: mmToWorld || 1 });
			// Keep colors in sync when showing heatmap/zones.
			if (showZones) applyZoneColors(existing);
			else if (heatmap) applyHeightmapColors(existing);
			else if (deviationMap) applyDeviationColors(existing);
			else if (clampDebug && meshRole === 'insole') {
				const applied = applyForefootClampDebugColors(existing, {
					side,
					mmToWorld: mmToWorld || 1,
					targetForefootWidthMm,
					targetTrimlineProfile,
					trimlineOffsetMm,
					trimlineAdjustments,
				});
				if (!applied) existing.deleteAttribute('color');
			}
			else existing.deleteAttribute('color');
			// Rebuild element overlays now that geometry has settled
			if (placedElements && placedElements.length > 0) rebuildElementOverlays();
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
	}, [gridEditMode, showZones, heatmap, clampDebug, deviationMap, placedElements, applyOrientation, onGeometryReady, mmToWorld, rebuildElementOverlays, meshRole, side, targetForefootWidthMm, targetTrimlineProfile, trimlineOffsetMm, trimlineAdjustments]);

	const rebuildFinalGeometryFromCorrected = useCallback(() => {
		const corrected = correctedGeometryRef.current;
		if (!corrected) return;
		const workingGeometry = corrected.clone();
		if (applyGeneral) {
			applySoleThicknessAfterCorrections(workingGeometry);
			applyTotalInsoleHeightAfterCorrections(workingGeometry);
		}
		// Re-weld to keep mesh as one continuous, watertight piece
		const finalGeometry = weldAndSmoothNormals(workingGeometry);
		// Carry scan-deviation data so the diagnostic overlay still works
		if (workingGeometry.userData.scanDeviations) {
			finalGeometry.userData.scanDeviations = workingGeometry.userData.scanDeviations;
		}
		// Apply element height displacements (raised pads)
		if (placedElements && placedElements.length > 0) {
			applyElements(finalGeometry, placedElements, { mmToWorld: mmToWorld || 1 });
		}
		animateGeometryTo(finalGeometry);
	}, [applyGeneral, applyTotalInsoleHeightAfterCorrections, applySoleThicknessAfterCorrections, animateGeometryTo, placedElements, mmToWorld]);

	// Initialize corrected geometry (base + corrections) when they change (debounced)
	useEffect(() => {
		if (!baseGeometry) return;

		const correctionsKey = corrections ? JSON.stringify(corrections) : '';
		const elementsKey = placedElements ? JSON.stringify(placedElements) : '';
		const signature = `${baseGeometry.uuid}|${mmToWorld || 1}|${side}|${correctionsKey}|${elementsKey}`;
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
			if (applyGeneral && pendingCorrections) {
				try {
					applyAllCorrections(workingGeometry, pendingCorrections, side, {
						mmToWorld,
						activeCorrections,
					});
				} catch (err) {
					console.error('Error applying corrections:', err);
				}
			}

			// Re-weld after corrections to keep one solid mesh
			const weldedWorking = weldAndSmoothNormals(workingGeometry);

			// Cache corrected geometry and rebuild final (thickness/rim) immediately.
			if (correctedGeometryRef.current) {
				try {
					correctedGeometryRef.current.dispose();
				} catch {
					// ignore
				}
			}
			correctedGeometryRef.current = weldedWorking;
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
		placedElements,
		side,
		mmToWorld,
		applyGeneral,
		rebuildFinalGeometryFromCorrected,
	]);

	// Apply general sliders (thickness/rim) immediately without waiting for the debounce.
	useEffect(() => {
		if (!applyGeneral) return;
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
	}, [applyGeneral, soleThicknessMm, totalInsoleHeightMm, rebuildFinalGeometryFromCorrected]);

	// Apply zone colors / rebuild element overlays whenever visual mode changes
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
		if (deviationMap) {
			applyDeviationColors(geometry);
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
			if (applied) return;
		}
		geometry.deleteAttribute('color');
		// Element overlays are rebuilt via rebuildElementOverlays (called from animateGeometryTo
		// and here when placedElements/geometry reference changes)
		if (placedElements && placedElements.length > 0) {
			rebuildElementOverlays();
		} else {
			setElementOverlays(prev => { prev.forEach(d => d.geometry.dispose()); return []; });
		}
	}, [geometry, showZones, heatmap, clampDebug, deviationMap, meshRole, side, targetForefootWidthMm, targetTrimlineProfile, trimlineOffsetMm, trimlineAdjustments, placedElements, mmToWorld, rebuildElementOverlays]);

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

	// Clone the base geometry when entering grid edit mode (for non-destructive editing)
	useEffect(() => {
		if (!geometry || !showBoxGrid || !gridEditMode) {
			baseGeometryRef.current = null;
			return;
		}
		// Only snapshot once per grid session — don't overwrite with deformed clones
		if (!baseGeometryRef.current) {
			baseGeometryRef.current = geometry.clone();
		}
	}, [geometry, showBoxGrid, gridEditMode]);

	// Notify parent about geometry — but NOT during grid editing, where
	// setGeometry produces deformed clones.  Propagating those to the parent
	// would reset camera position (parent camera effect depends on geometry).
	useEffect(() => {
		if (geometry && onGeometryReady && !gridEditMode) {
			onGeometryReady(geometry, { mmToWorld: mmToWorld || 1 });
		}
	}, [geometry, onGeometryReady, mmToWorld, gridEditMode]);


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
				// Measure height as top surface at hovered XY (not the touched face),
				// so probing from underside still reports the top contour height.
				let topZ = event.point.z;
				if (meshRef.current) {
					const worldBox = new THREE.Box3().setFromObject(meshRef.current);
					const rayOrigin = new THREE.Vector3(
						event.point.x,
						event.point.y,
						worldBox.max.z + Math.max(5, 10 * (mmToWorld || 1))
					);
					const rayDir = new THREE.Vector3(0, 0, -1);
					const ray = new THREE.Raycaster(
						rayOrigin,
						rayDir,
						0,
						Math.max(20, (worldBox.max.z - worldBox.min.z) + 20)
					);
					const hits = ray.intersectObject(meshRef.current, false);
					if (hits.length > 0) {
						topZ = hits[0].point.z;
					}
				}
				const worldHeight = topZ - baseline;
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
				if (onZoneClick && geometry) {
					const localPt = event.point.clone();
					if (meshRef.current) {
						meshRef.current.worldToLocal(localPt);
					}
					geometry.computeBoundingBox();
					const bbox = geometry.boundingBox!;
					const minY = bbox.min.y;
					const maxY = bbox.max.y;
					const rangeY = maxY - minY || 1;
					const relY = (localPt.y - minY) / rangeY;
					const zone: 'front' | 'middle' | 'back' = relY > 0.55 ? 'front' : relY > 0.25 ? 'middle' : 'back';
					onZoneClick(zone, side);
					return;
				}
				if (onSelect) {
					onSelect(side);
				}
			} : undefined}
		>
			<meshStandardMaterial
				key={(showZones || heatmap || clampDebug || deviationMap) ? 'colored' : 'normal'}
				color={showZones ? '#ffffff' : pointPickMode ? '#d9b5a1' : color}
				vertexColors={showZones || heatmap || clampDebug || deviationMap}
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

			{/* EVA block — contour-following walls + bottom cap */}
			{evaBlockMode && evaBlock && (
				<mesh geometry={evaBlock.geometry}>
					<meshStandardMaterial
						color={color}
						side={THREE.DoubleSide}
						roughness={0.3}
						metalness={0.0}
					/>
				</mesh>
			)}

			{/* Interactive Box grid overlay */}
			{showBoxGrid && gridEditMode && geometry && (
				<InteractiveBoxGrid
					insoleGeometry={geometry}
					mmToWorld={mmToWorld || 1}
					active={true}
					onDeformationChange={(points) => {
						if (!baseGeometryRef.current || !geometry) return;

						const working = baseGeometryRef.current.clone();
						const influenceRadiusMm = 4.5;
						applyBoxGridDeformation(
							working,
							points,
							influenceRadiusMm * (mmToWorld || 1),
						);

						const srcPos = working.getAttribute('position') as THREE.BufferAttribute | undefined;
						const dstPos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
						if (!srcPos || !dstPos || srcPos.count !== dstPos.count) {
							working.dispose();
							return;
						}

						const srcArr = srcPos.array as Float32Array;
						const dstArr = dstPos.array as Float32Array;
						dstArr.set(srcArr);
						dstPos.needsUpdate = true;
						geometry.computeVertexNormals();

						if (showZones) applyZoneColors(geometry);
						else if (heatmap) applyHeightmapColors(geometry);
						else if (deviationMap) applyDeviationColors(geometry);
						else geometry.deleteAttribute('color');

						working.dispose();
					}}
				/>
			)}

			{/* Element overlay meshes — solid coloured pads sitting on the insole surface */}
			{elementOverlays.map(overlay => (
				<mesh key={overlay.elementId} geometry={overlay.geometry}>
					<meshStandardMaterial
						color={overlay.colorHex}
						roughness={0.45}
						metalness={0.0}
						side={THREE.DoubleSide}
						polygonOffset
						polygonOffsetFactor={-3}
						polygonOffsetUnits={-3}
					/>
				</mesh>
			))}
		</mesh>
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
	onZoneClick?: (zone: 'front' | 'middle' | 'back', side: 'left' | 'right') => void;
	boxEnabled?: { left: boolean; right: boolean };
	gridEditMode?: boolean;
	leftPlacedElements?: PlacedElement[];
	rightPlacedElements?: PlacedElement[];
	/** When true, render insoles inside a solid EVA block (Frezen: EVA mode) */
	evaBlockMode?: boolean;
	/** Base insole type (man, driekwart, etc.) for shape adjustments */
	baseInsoleType?: import('@/src/features/design/types/types').BaseInsoleType;
	/** Which side is being trimline-edited interactively (null = none) */
	trimlineEditSide?: 'left' | 'right' | null;
	/** Callback when user drags a trimline handle (pending only — not yet committed) */
	onPendingTrimlineChange?: (side: 'left' | 'right', adj: TrimlineAdjustments) => void;
	onPendingTrimlineProfileChange?: (side: 'left' | 'right', profile: TrimlineHandleProfile) => void;
	/** Called once when both insole meshes have loaded their geometry */
	onReady?: () => void;
	/** When true, pointer events on insole meshes are disabled (no click/select) */
	disableInteraction?: boolean;
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
			textAnnotations = [],
			bottomTextOverlay,
			onTextPlace,
			onSelectSide,
			onDeselectSide,
			onZoneClick,
			boxEnabled = { left: false, right: false },
			gridEditMode = false,
			corrections,
			onPickPoint,
			pickedPoints = [],
			onRightBBox,
			landmarkPoints,
			showGeneratedInsole = false,
			leftPlacedElements,
			rightPlacedElements,
			evaBlockMode = false,
			trimlineAdjustments,
			trimlineHandleProfiles,
			trimlineEditSide = null,
			onPendingTrimlineChange,
			onPendingTrimlineProfileChange,
			onReady,
			disableInteraction = false,
		},
		ref
	) => {
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

		// Fire onReady once when at least one geometry has loaded
		const onReadyFiredRef = useRef(false);
		useEffect(() => {
			if (onReadyFiredRef.current) return;
			const hasLeft = !leftUrl || leftGeometry !== null;
			const hasRight = !rightUrl || rightGeometry !== null;
			if (hasLeft && hasRight) {
				onReadyFiredRef.current = true;
				onReady?.();
			}
		}, [leftGeometry, rightGeometry, leftUrl, rightUrl, onReady]);

		const [localLandmarks, setLocalLandmarks] = useState<LandmarkPoints | null>(
			null
		);
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
			const totalHeightMm =
				typeof maxInsoleHeightMm === 'number' &&
					Number.isFinite(maxInsoleHeightMm) &&
					maxInsoleHeightMm > 0
					? maxInsoleHeightMm
					: 10;

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
				geom.computeVertexNormals();
				return geom;
			}

			const built = buildBasicInsole(rightGeometry, localLandmarks, {
				padScale: 1.02,
				thickness: thicknessWorld,
				lengthScale,
				rimHeight: totalHeightMm * mmToWorld,
				archBoost: 0.75,
				heelCupDepth: 7 * mmToWorld,
				toeTaper: 0.14,
				heelTaper: 0.08,
				resU: 140,
				resV: 70,
			});
			if (!built) return built;
			applyGeometryTotalHeight(built, totalHeightMm, mmToWorld);
			return built;
		}, [rightGeometry, localLandmarks, showGeneratedInsole, rightMmToWorld, shoeSize, soleThicknessMm, maxInsoleHeightMm]);
		const leftMeshRef = useRef<THREE.Group>(null);
		const rightMeshRef = useRef<THREE.Group>(null);
		const cameraRef = useRef<THREE.PerspectiveCamera>(null);
		const controlsRef = useRef<OrbitControlsImpl | null>(null);
		const cameraInitRef = useRef(false);
		const prevPresetRef = useRef<string | undefined>(undefined);
		const [probeState, setProbeState] = useState<{
			point: [number, number, number];
			heightMm: number;
			side: 'left' | 'right';
		} | null>(null);

		const effectiveShowGeneratedInsole = showGeneratedInsole;
		const effectiveHideScans = hideScans;
		const effectiveShowModel = typeof showModel === 'boolean' ? showModel : true;
		const effectiveViewPreset = analysisEnabled ? 'back' : viewPreset;
		const leftOverlayRegistration = useMemo(
			() => computeOverlayRegistration(leftOverlayGeometry, leftGeometry),
			[leftOverlayGeometry, leftGeometry]
		);
		const rightOverlayRegistration = useMemo(
			() => computeOverlayRegistration(rightOverlayGeometry, rightGeometry),
			[rightOverlayGeometry, rightGeometry]
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
		const showRegistrationDebug =
			process.env.NODE_ENV === 'development' &&
			(leftOverlayRegistration.valid || rightOverlayRegistration.valid);

		useEffect(() => {
			if (process.env.NODE_ENV !== 'development') return;
			if (leftOverlayRegistration.valid) {
				console.log('OverlayRegistrationLeft', {
					rmseMm: Number(leftOverlayRegistration.rmseMm.toFixed(2)),
					trimlineLenMm: leftTrimlineProfile
						? Number((leftTrimlineProfile.lengthWorld / Math.max(1e-6, MM_TO_WORLD)).toFixed(1))
						: null,
				});
			}
			if (rightOverlayRegistration.valid) {
				console.log('OverlayRegistrationRight', {
					rmseMm: Number(rightOverlayRegistration.rmseMm.toFixed(2)),
					trimlineLenMm: rightTrimlineProfile
						? Number((rightTrimlineProfile.lengthWorld / Math.max(1e-6, MM_TO_WORLD)).toFixed(1))
						: null,
				});
			}
		}, [leftOverlayRegistration, rightOverlayRegistration, leftTrimlineProfile, rightTrimlineProfile]);

		useEffect(() => {
			if (!leftOverlayUrl) setLeftOverlayGeometry(null);
			if (!rightOverlayUrl) setRightOverlayGeometry(null);
		}, [leftOverlayUrl, rightOverlayUrl]);

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
			// ── 0. Snap vertices to 0.1 µm grid ────────────────────────────
			// Eliminates sub-micron floating-point noise that creates T-junctions
			// and near-duplicate edges which PrusaSlicer flags as intersections.
			snapVerticesToGrid(geometry, 1e-4);

			// ── 1. Merge duplicate vertices ─────────────────────────────────
			// Use 1e-4 mm tolerance (0.1 µm) – tight enough to preserve detail
			// but loose enough to catch near-coincident verts from rounding.
			let g = BufferGeometryUtils.mergeVertices(geometry, 1e-4);
			if (!g.getIndex()) {
				const indexed = BufferGeometryUtils.mergeVertices(g, 1e-4);
				if (indexed !== g) {
					g.dispose();
					g = indexed;
				}
			}

			// ── 2. Remove duplicate / overlapping faces ─────────────────────
			// CSG operations and merge can produce doubled faces (same 3 verts,
			// different winding).  These cause PrusaSlicer facet-intersection
			// warnings and confuse winding analysis.
			g = removeDuplicateFaces(g);

			// ── 3. Fill ALL boundary holes (watertight for slicing) ──────────
			// The display pipeline keeps the outer perimeter open (fillAll=false)
			// but PrusaSlicer needs a fully closed solid to determine inside/outside
			// correctly and avoid fragmented perimeters with crossing travels.
			g = fillMeshHoles(g, Infinity, true);

			// ── 4. Remove degenerate triangles ──────────────────────────────
			// Zero-area, NaN, or near-zero-area faces confuse slicer topology
			// detection, causing extra shells and crossing travel lines.
			// (returns non-indexed geometry, so we re-merge afterwards)
			g = removeDegenerateTriangles(g);

			// ── 5. Re-merge after degenerate removal ────────────────────────
			g = BufferGeometryUtils.mergeVertices(g, 1e-4);

			// ── 6. Remove duplicate faces (again after re-merge) ────────────
			g = removeDuplicateFaces(g);

			// ── 7. Fix winding order (consistent outward normals) ────────────
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

			// ── 8. Recompute clean normals ──────────────────────────────────
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

			// ── Auto-orient for slicer: X = length, Y = width, Z = thickness ──
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
				// axes[0] = thinnest (→ Z), axes[1] = middle (→ Y), axes[2] = longest (→ X)
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
							// Map: longestIdx → X, middleIdx → Y, thinnestIdx → Z
							tmp[off]     = vals[longestIdx];
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
		}), [
			handleMatch,
			handleReset,
			generatedInsole,
			selectedSide,
			leftGeometry,
			rightGeometry,
			leftMmToWorld,
			rightMmToWorld,
		]);

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
				const span = Math.max(size.x, size.y, size.z);
				const dist = Math.max(180, span * 1.9);

				// Behind-the-heel eye-level camera: along +Z (behind heel),
				// nearly zero Y lift so we look straight into the heel edge-on, and closer.
				const closeDist = dist * 0.40;
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
				c.minPolarAngle = 0.01;
				c.maxPolarAngle = Math.PI - 0.01;
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

		return (
			<div className={`w-full h-full bg-gray-900 relative ${analysisEnabled ? 'cursor-crosshair' : ''}`}>
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
						{!effectiveHideScans && showInsoles && showLeft && leftUrl && (
							<group ref={leftMeshRef}>
								<STLMesh
									url={leftUrl}
									meshRole={pointPickMode ? 'scan' : 'insole'}
									flipLongAxis={pointPickMode}
									targetForefootWidthMm={targetForefootWidthMm?.left ?? undefined}
									targetTrimlineProfile={!pointPickMode ? leftTrimlineProfile : null}
									trimlineOffsetMm={trimlineOffsetMm}
									trimlineAdjustments={trimlineAdjustments?.left}
									trimlineHandleProfile={trimlineHandleProfiles?.left ?? null}
									color={leftOverlayUrl || rightOverlayUrl ? '#cfe9ff' : '#d7dadd'}
									position={[-30, 0, 0]}
									interactive={!disableInteraction}
									onGeometryReady={(geom, meta) => {
										setLeftGeometry(geom);
										setLeftMmToWorld(meta?.mmToWorld || 1);
									}}
									onPickPoint={(pt) => onPickPoint?.([pt.x, pt.y, pt.z])}
									pointPickMode={pointPickMode}
									showZones={showZones}
									heatmap={heatmap}
									clampDebug={clampDebug}
									deviationMap={deviationMap}
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
									selected={disableInteraction ? false : selectedSide === 'left'}
									onSelect={disableInteraction ? undefined : onSelectSide}
									onZoneClick={disableInteraction ? undefined : onZoneClick}
									showBoxGrid={showGrid && boxEnabled.left}
									gridEditMode={gridEditMode}
									corrections={corrections}
									activeCorrections={activeCorrections}
									textPlacementEnabled={textPlacementEnabled}
									textPlacementText={textPlacementText}
									onTextPlace={onTextPlace}
									side="left"
									placedElements={leftPlacedElements}
									evaBlockMode={evaBlockMode}
								/>
							</group>
						)}
						{!effectiveHideScans && showInsoles && showRight && rightUrl && (
							<group ref={rightMeshRef}>
								<STLMesh
									url={rightUrl}
									meshRole={pointPickMode ? 'scan' : 'insole'}
									flipLongAxis={pointPickMode}
									targetForefootWidthMm={targetForefootWidthMm?.right ?? undefined}
									targetTrimlineProfile={!pointPickMode ? rightTrimlineProfile : null}
									trimlineOffsetMm={trimlineOffsetMm}
									trimlineAdjustments={trimlineAdjustments?.right}
									trimlineHandleProfile={trimlineHandleProfiles?.right ?? null}
									color={leftOverlayUrl || rightOverlayUrl ? '#cfe9ff' : '#d7dadd'}
									position={[30, 0, 0]}
									interactive={!disableInteraction}
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
									clampDebug={clampDebug}
									deviationMap={deviationMap}
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
									selected={disableInteraction ? false : selectedSide === 'right'}
									onSelect={disableInteraction ? undefined : onSelectSide}
									onZoneClick={disableInteraction ? undefined : onZoneClick}
									showBoxGrid={showGrid && boxEnabled.right}
									gridEditMode={gridEditMode}
									corrections={corrections}
									activeCorrections={activeCorrections}
									textPlacementEnabled={textPlacementEnabled}
									textPlacementText={textPlacementText}
									onTextPlace={onTextPlace}
									side="right"
									placedElements={rightPlacedElements}
									evaBlockMode={evaBlockMode}
								/>
							</group>
						)}

						{/* Scan overlays (non-interactive) shown on top of base insoles */}
						{!hideScans && effectiveShowModel && showLeft && leftOverlayUrl && (
							<group position={[-30, 0, 0.25]}>
								<group matrixAutoUpdate={false} matrix={leftOverlayRegistration.matrix}>
									<STLMesh
										url={leftOverlayUrl}
										meshRole="overlayScan"
										flipLongAxis={true}
										color="#d9b5a1"
										position={[0, 0, 0]}
										interactive={false}
										rotationOffset={[Math.PI, 0, Math.PI]}
										transparentMode={true}
										opacity={0.72}
										showZones={false}
										heatmap={false}
										pointPickMode={false}
										onGeometryReady={(geom) => setLeftOverlayGeometry(geom)}
										side="left"
									/>
								</group>
							</group>
						)}
						{!hideScans && effectiveShowModel && showRight && rightOverlayUrl && (
							<group position={[30, 0, 0.25]}>
								<group matrixAutoUpdate={false} matrix={rightOverlayRegistration.matrix}>
									<STLMesh
										url={rightOverlayUrl}
										meshRole="overlayScan"
										flipLongAxis={true}
										color="#d9b5a1"
										position={[0, 0, 0]}
										interactive={false}
										rotationOffset={[Math.PI, 0, Math.PI]}
										transparentMode={true}
										opacity={0.72}
										showZones={false}
										heatmap={false}
										pointPickMode={false}
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
							<group position={[-30, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
								<InteractiveTrimline
									insoleGeometry={leftGeometry}
									adjustments={trimlineAdjustments?.left ?? { global: 0, heel: 0, midfoot: 0, forefoot: 0, toe: 0 }}
									onPendingChange={(adj: TrimlineAdjustments) => onPendingTrimlineChange?.('left', adj)}
									onPendingProfileChange={(profile) => onPendingTrimlineProfileChange?.('left', profile)}
									profile={trimlineHandleProfiles?.left ?? null}
									side="left"
									mmToWorld={leftMmToWorld || MM_TO_WORLD}
									active={true}
								/>
							</group>
						)}
						{/* Interactive trimline handles for right insole */}
						{trimlineEditSide === 'right' && rightGeometry && (
							<group position={[30, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
								<InteractiveTrimline
									insoleGeometry={rightGeometry}
									adjustments={trimlineAdjustments?.right ?? { global: 0, heel: 0, midfoot: 0, forefoot: 0, toe: 0 }}
									onPendingChange={(adj: TrimlineAdjustments) => onPendingTrimlineChange?.('right', adj)}
									onPendingProfileChange={(profile) => onPendingTrimlineProfileChange?.('right', profile)}
									profile={trimlineHandleProfiles?.right ?? null}
									side="right"
									mmToWorld={rightMmToWorld || MM_TO_WORLD}
									active={true}
								/>
							</group>
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
						enablePan={!analysisEnabled}
						enableZoom={!analysisEnabled}
						enableRotate={!lockTopView && !analysisEnabled && !trimlineEditSide}
						minDistance={50}
						maxDistance={500}
						minPolarAngle={lockTopView ? 0 : 0.01}
						maxPolarAngle={lockTopView ? Math.PI : Math.PI - 0.01}
						minAzimuthAngle={lockTopView ? 0 : undefined}
						maxAzimuthAngle={lockTopView ? 0 : undefined}
					/>
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

EnhancedSTLViewer.displayName = 'EnhancedSTLViewer';

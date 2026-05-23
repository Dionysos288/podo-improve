'use client';

import dynamic from 'next/dynamic';
import { useRef, useState, useCallback, useMemo, useEffect, useTransition } from 'react';
import * as THREE from 'three';
import { Card, CardContent } from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { Select, InlineSelect } from '@/src/shared/components/ui/select';
import { CircleCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import { ViewOverlay } from '@/src/shared/components/design/ViewOverlay';
import { StepRail } from '@/src/shared/components/design/StepRail';
import { GeneratedInsoleOverlay } from '@/src/shared/components/design/GeneratedInsoleOverlay';
import {
	DEFAULT_TRIMLINE_ADJUSTMENTS,
	type TrimlineAdjustments,
	type TrimlineHandleProfile,
} from '@/src/shared/components/design/TrimlineEditOverlay';
import { TrimlineEditCard } from '@/src/shared/components/design/TrimlineEditCard';
import { ScanRotateEditCard } from '@/src/shared/components/design/ScanRotateEditCard';
import { TextEditCard } from '@/src/shared/components/design/TextEditCard';
import {
	DirectProducePanel,
	type PrinterSettings,
} from '@/src/shared/components/design/DirectProducePanel';
import {
	OntwerpPanel,
	createDefaultOntwerpCorrections,
	type OntwerpCorrections,
} from '@/src/shared/components/design/OntwerpPanel';
import { BaseModal } from '@/src/shared/components/ui/modal';
import {
	DEFAULT_ACTIVE_CORRECTIONS,
	type CorrectionKey,
} from '@/src/shared/components/design/correctionsCatalog';
import { cn } from '@/src/shared/lib/cn';
import {
	buildInsolePlan,
	computeFootGeometryFrom3Points,
	completeLandmarksToLegacy,
	type LandmarkPoints,
} from '@/src/features/design/utils/landmarkFitting';
import {
	estimateEuShoeSizeFromFootLengthMm,
} from '@/src/features/design/utils/shoeSizing';
import {
	BASE_INSOLE_SELECT_OPTIONS,
	DEFAULT_BASE_INSOLE_TYPE,
	getBaseInsoleAssetUrls,
	getBaseInsoleWidthMmForEuSize,
	isBaseInsoleType,
} from '@/src/features/design/utils/baseInsole';
import { extractPlantarSurface } from '@/src/features/design/utils/plantarExtraction';
import { detectLandmarksClassical, validateDetectedLandmarks } from '@/src/features/design/utils/landmarkDetection';
import type {
	BaseInsoleType,
	ThreePointLandmarks,
	CompleteLandmarkSet,
	AutoLandmarkResult,
	FootGeometry,
	PlantarData,
	ScanManualAlignment,
} from '@/src/features/design/types/types';
import { LANDMARK_CONFIDENCE_THRESHOLD } from '@/src/features/design/types/types';
import { STLLoader } from 'three-stdlib';
import {
	exportGeometryToSTLBinary,
	geometryToBinarySTLArrayBuffer,
} from '@/src/features/design/utils/stlExport';
import type {
	EnhancedSTLViewerRef,
	BottomTextOverlay,
} from '@/src/features/design/components/EnhancedSTLViewer';
import type { BoxGridSavedOffsets, LatticeOffsetVec } from '@/src/features/design/types/boxGrid';
import type { HardnessKey, PrinterSettings as OrgPrinterSettings } from '@/src/features/printers/types/printers';
import { usePrintInteraction } from '@/src/features/design/print/usePrintInteraction';
import { PrintPreparationPanel } from '@/src/shared/components/design/PrintPreparationPanel';
import {
	PrintContextPanel,
	type PrintSidebarContextMode,
} from '@/src/shared/components/design/PrintContextPanel';
import {
	useElementsStore,
	ElementsModal,
	ElementInspector,
	ElementActionsPanel,
	PlacedElementsList,
	getElementByKey,
	mirrorBoxGridOffsetsAcrossWidth,
	mirrorPlacedElementToSide,
	mirrorTrimlineHandleProfileAcrossWidth,
} from '@/src/features/design/elements';
import {
	type MillingMode,
	type EvaPreparationSettings,
	type FixtureLayout,
	type CncToolSettings,
	type CncProductionState,
	DEFAULT_EVA_SETTINGS,
	DEFAULT_CNC_TOOL_SETTINGS,
	createDefaultFixtureLayout,
	createDefaultCncState,
	generateNcFile,
	downloadNcFile,
	extractStlContour,
	extractContourFromExportGeometryAsync,
	DEFAULT_CNC_POST_SETTINGS,
} from '@/src/features/milling';
import { EvaPreparationPanel } from '@/src/shared/components/design/EvaPreparationPanel';
import { CncProducePanel } from '@/src/shared/components/design/CncProducePanelSimple';
import { CncFixtureView } from '@/src/shared/components/design/CncFixtureView';
import { MillingModeSelector } from '@/src/shared/components/design/MillingModeSelector';
import { useDesignAutosave, type ClientSettingsGetter } from '@/src/features/design/hooks/useDesignAutosave';
import { UploadScansModal } from '@/src/features/projects/components/UploadScansModal';
import { useRouter } from 'next/navigation';
import { Check, Loader2, AlertCircle, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { flushSync } from 'react-dom';

type SavedBottomTextState = { text: string; sizeMm: number; depthMm: number };

type ElementEditMode = 'move' | 'scale' | 'trimline' | 'box' | null;
const ELEMENT_MOVE_STEP_UV = 0.01;
const ELEMENT_SCALE_STEP = 0.06;
const ELEMENT_SCALE_MIN = 0.2;
const ELEMENT_SCALE_MAX = 4;

function normalizeElementTrimlineAdjustments(
	source?: TrimlineAdjustments | null,
): TrimlineAdjustments {
	return {
		...DEFAULT_TRIMLINE_ADJUSTMENTS,
		global: source?.global ?? 0,
	};
}

function scanManualAlignmentsEquals(
	a: ScanManualAlignment | null,
	b: ScanManualAlignment | null,
): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	const ep = 1e-9;
	const ey = 1e-9;
	return (
		Math.abs(a.yawRad - b.yawRad) < ey &&
		Math.abs(a.pivot[0] - b.pivot[0]) < ep &&
		Math.abs(a.pivot[1] - b.pivot[1]) < ep &&
		Math.abs(a.pivot[2] - b.pivot[2]) < ep
	);
}

function cloneBoxGridOffsets(
	source?: BoxGridSavedOffsets | null,
): BoxGridSavedOffsets | null {
	if (!source) return null;
	if (source.version === 3) {
		const src = source.offsets as (number | LatticeOffsetVec)[];
		return {
			cols: source.cols,
			rows: source.rows,
			layers: source.layers,
			version: 3,
			offsets: src.map((o) =>
				typeof o === 'number'
					? o
					: { du: o.du, dv: o.dv, dh: o.dh },
			) as LatticeOffsetVec[],
		};
	}
	if (source.version === 2) {
		const src = source.offsets as (number | LatticeOffsetVec)[];
		return {
			cols: source.cols,
			rows: source.rows,
			version: 2,
			offsets: src.map((o) =>
				typeof o === 'number'
					? o
					: { du: o.du, dv: o.dv, dh: o.dh },
			) as LatticeOffsetVec[],
		};
	}
	return {
		cols: source.cols,
		rows: source.rows,
		offsets: [...(source.offsets as number[])],
	};
}

function mirrorSideValues<T>(
	value: T,
	from: 'left' | 'right',
	to: 'left' | 'right',
): T {
	if (Array.isArray(value)) {
		return value.map((entry) => mirrorSideValues(entry, from, to)) as T;
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	const record = value as Record<string, unknown>;
	if ('left' in record && 'right' in record) {
		const next = { ...record };
		next[to] = structuredClone(record[from]);
		return next as T;
	}
	const next: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(record)) {
		next[key] = mirrorSideValues(entry, from, to);
	}
	return next as T;
}

// Dynamic imports for heavy 3D components - reduces initial bundle by ~200-500KB
const EnhancedSTLViewer = dynamic(
	() =>
		import('@/src/features/design/components/EnhancedSTLViewer').then(
			(mod) => mod.EnhancedSTLViewer
		),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-full items-center justify-center bg-gray-900">
				<div className="text-center">
					<div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-ui-accent border-t-transparent mx-auto" />
					<p className="text-ui-muted">3D Viewer laden...</p>
				</div>
			</div>
		),
	}
);

const STLSelector = dynamic(
	() =>
		import('@/src/features/design/components/STLSelector').then(
			(mod) => mod.STLSelector
		),
	{ ssr: false }
);

const BaseSTLSelector = dynamic(
	() =>
		import('@/src/features/design/components/BaseSTLSelector').then(
			(mod) => mod.BaseSTLSelector
		),
	{ ssr: false }
);

const DynamicInsoleWorkspace = dynamic(
	() =>
		import('@/src/features/design/components/DynamicInsoleWorkspace').then(
			(mod) => mod.DynamicInsoleWorkspace
		),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-full items-center justify-center bg-gray-900">
				<div className="text-center">
					<div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-ui-accent border-t-transparent mx-auto" />
					<p className="text-ui-muted">Loading editor...</p>
				</div>
			</div>
		),
	}
);

const MiniSTLPreview = dynamic(
	() =>
		import('@/src/features/design/components/MiniSTLPreview').then(
			(mod) => mod.MiniSTLPreview
		),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-full items-center justify-center text-ui-muted">
				Laden...
			</div>
		),
	}
);

export interface ProjectDetail {
	id: string;
	name: string;
	patient: {
		firstName: string;
		lastName: string;
	};
	scans: Array<{
		id: string;
		name: string;
		pairId: string;
		footSide: string;
		stlUrl: string;
	}>;
}

type WorkflowStep = 'base' | 'stl-select' | 'point-pick' | 'dynamic-edit';

type PickPointId =
	| 'heel'
	| 'heelLateral'
	| 'meta1'
	| 'meta2'
	| 'meta5';

type PickSelections = Partial<Record<PickPointId, [number, number, number]>>;

const POINT_SEQUENCE: Array<{ id: PickPointId; label: string; description: string; short: string }> = [
	{ id: 'meta1', label: 'Klik op 1e metatarsale kop', description: 'Mediale voorvoet (M1)', short: 'M1' },
	{ id: 'meta2', label: 'Klik op 2e metatarsale kop', description: 'Midden voorvoet (M2)', short: 'M2' },
	{ id: 'meta5', label: 'Klik op 5e metatarsale kop', description: 'Laterale voorvoet (M5)', short: 'M5' },
	{ id: 'heelLateral', label: 'Klik op laterale stabiliteitspunt (L)', description: 'Laterale hielrand / stabiliteitspunt', short: 'L' },
	{ id: 'heel', label: 'Klik op het midden van de hiel (H)', description: 'Rear anchor / hielcentrum', short: 'H' },
];

const distance3 = (a: [number, number, number], b: [number, number, number]) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const roundStep = (value: number, step: number) =>
	Math.round(value / step) * step;
const normalizeScanArchHeightMm = (archMm: number) =>
	roundStep(clamp(archMm, 3, 30), 0.5);
const deriveTargetInsoleHeightMm = (archMm: number, cupMm: number) =>
	roundStep(clamp(Math.max(archMm, cupMm + 4), 6, 30), 0.5);

/**
 * Compensation factor for the steunzolen hoogte.
 *
 * The generated insole builder uses Gaussian shaping, rim blending, and
 * thickness offsets that internally reduce the mesh peak to ~60-70% of the
 * requested arch height.  We compensate by boosting the seeded value:
 *   1.45× ≈ inverse of the ~69% internal dampening
 *   + 15% overshoot so the insole slightly exceeds the scan arch (the foot
 *     compresses onto the insole under body weight).
 *
 * Net factor: 1.45 × 1.15 ≈ 1.67
 */
const ARCH_HEIGHT_COMPENSATION = 1.45 * 1.15; // ≈ 1.67
const compensateArchHeight = (rawMm: number) =>
	roundStep(clamp(rawMm * ARCH_HEIGHT_COMPENSATION, 3, 30), 0.5);

/**
 * Robust arch height derivation from plantar heightmap.
 *
 * Uses an overall-percentile baseline instead of zone-specific baselines,
 * which fails when the heightmap is sparse (common with surface-scan meshes
 * that have gaps under the arch).
 *
 * Approach:
 * 1. Collect ALL valid heightmap cells
 * 2. Ground-contact baseline = 10th percentile of all W values
 *    (the majority of the plantar surface is heel/forefoot contact area)
 * 3. Arch peak = 95th percentile of W values in the midfoot zone
 * 4. Relief = arch peak − baseline
 */
const deriveArchPeakHeightMmFromPlantarData = (
	plantarData: PlantarData | null | undefined,
	worldToMm = 1
) => {
	if (!plantarData) return null;
	const [cols, rows] = plantarData.gridSize;
	const [minU, maxU] = plantarData.bounds;
	if (cols <= 0 || rows <= 0) return null;
	const lengthSpan = Math.max(1e-6, maxU - minU);

	const allW: number[] = [];
	const archW: number[] = [];

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const idx = row * cols + col;
			const w = plantarData.heightmap[idx];
			if (!Number.isFinite(w)) continue;
			allW.push(w);
			const u = minU + (col + 0.5) * plantarData.cellSize;
			const tLen = (u - minU) / lengthSpan;
			if (tLen >= 0.15 && tLen <= 0.75) archW.push(w);
		}
	}

	if (allW.length < 10 || archW.length < 3) return null;

	allW.sort((a, b) => a - b);
	archW.sort((a, b) => a - b);

	const baseline = allW[Math.floor(allW.length * 0.10)]!;
	const archPeak = archW[Math.floor(archW.length * 0.95)]!;
	const relief = archPeak - baseline;

	if (relief <= 0) return null;
	return normalizeScanArchHeightMm(relief * worldToMm);
};

/**
 * Robust arch profile derivation: returns both arch height AND apex position.
 *
 * Same overall-percentile baseline approach as deriveArchPeakHeightMmFromPlantarData,
 * but also tracks the fore/aft position (tLen) of the peak for apex correction.
 */
const deriveArchPeakProfileFromPlantarData = (
	plantarData: PlantarData | null | undefined,
	worldToMm = 1,
	label = ''
) => {
	if (!plantarData) return null;
	const [cols, rows] = plantarData.gridSize;
	const [minU, maxU, minV] = plantarData.bounds;
	if (cols <= 0 || rows <= 0) return null;
	const lengthSpan = Math.max(1e-6, maxU - minU);

	// Collect all valid cells with positions
	const allW: number[] = [];
	const archCells: Array<{ w: number; tLen: number; v: number }> = [];

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const idx = row * cols + col;
			const w = plantarData.heightmap[idx];
			if (!Number.isFinite(w)) continue;
			allW.push(w);
			const u = minU + (col + 0.5) * plantarData.cellSize;
			const v = minV + (row + 0.5) * plantarData.cellSize;
			const tLen = (u - minU) / lengthSpan;
			// Wide midfoot zone — no lateral filter
			if (tLen >= 0.15 && tLen <= 0.75) {
				archCells.push({ w, tLen, v });
			}
		}
	}

	if (allW.length < 10 || archCells.length < 3) return null;

	// Ground-contact baseline: 10th percentile of ALL valid W values
	allW.sort((a, b) => a - b);
	const baseline = allW[Math.floor(allW.length * 0.10)]!;

	// Find peak relief in arch zone
	let peakRelief = -Infinity;
	let peakT = 0.42;
	let peakV = 0;

	for (const cell of archCells) {
		const relief = cell.w - baseline;
		if (relief > peakRelief) {
			peakRelief = relief;
			peakT = cell.tLen;
			peakV = cell.v;
		}
	}

	// Debug logging
	if (process.env.NODE_ENV === 'development' && label) {
		const archReliefs = archCells.map(c => c.w - baseline).sort((a, b) => a - b);
		console.log(`[ArchProfile ${label}] grid=${cols}x${rows}, valid=${allW.length}/${cols * rows}, lengthSpan=${(lengthSpan * worldToMm).toFixed(1)}mm`,
			`\n  W range: ${(allW[0]! * worldToMm).toFixed(1)} .. ${(allW[allW.length - 1]! * worldToMm).toFixed(1)}mm`,
			`\n  baseline(p10)=${(baseline * worldToMm).toFixed(1)}mm`,
			`\n  archZoneCells=${archCells.length}, relief range: ${(archReliefs[0]! * worldToMm).toFixed(1)} .. ${(archReliefs[archReliefs.length - 1]! * worldToMm).toFixed(1)}mm`,
			`\n  peakRelief=${(peakRelief * worldToMm).toFixed(1)}mm at tLen=${peakT.toFixed(3)}, v=${peakV.toFixed(2)}`,
			`\n  groundNormal=${plantarData.groundNormal.map(n => n.toFixed(3)).join(',')}`
		);
	}

	if (!Number.isFinite(peakRelief) || peakRelief <= 0) return null;
	return {
		archHeightMm: normalizeScanArchHeightMm(peakRelief * worldToMm),
		apexShiftMm: roundStep(clamp((peakT - 0.42) * lengthSpan * worldToMm, -20, 20), 0.5),
		peakT,
	};
};

const estimateEuShoeSizeFromGeometry = (
	geometry: THREE.BufferGeometry,
	worldToMm: number
) => {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	if (!bbox) return 40;
	const size = bbox.getSize(new THREE.Vector3());
	const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
	const lengthWorld = dims[2] ?? 0;
	const footLengthMm = lengthWorld * worldToMm;
	return estimateEuShoeSizeFromFootLengthMm(footLengthMm) ?? 40;
};

const deriveSeedFromPickedPoints = (
	points: PickSelections,
	fallbackArchMm: number,
	worldToMm = 1
) => {
	const heel = points.heel;
	const heelLateral = points.heelLateral;
	const meta1 = points.meta1;
	const meta2 = points.meta2;
	const meta5 = points.meta5;

	if (!heel || !heelLateral || !meta1 || !meta2 || !meta5) {
		return {
			archMm: clamp(fallbackArchMm, 3, 18),
			cupMm: clamp(fallbackArchMm * 0.55, 2, 12),
			shoeSizeEu: 40,
			pronationMm: 0,
			supinationMm: 0,
		};
	}

	const forefootCenter: [number, number, number] = [
		(meta1[0] + meta2[0] + meta5[0]) / 3,
		(meta1[1] + meta2[1] + meta5[1]) / 3,
		(meta1[2] + meta2[2] + meta5[2]) / 3,
	];

	const footLengthMm = distance3(heel, forefootCenter) * 1.2 * worldToMm;
	const forefootWidthMm = distance3(meta1, meta5) * worldToMm;
	const lateralSpanMm = distance3(heel, heelLateral) * worldToMm;

	// Forefoot load triangle: M2 offset to M1-M5 line (biomechanical intent)
	const aToB: [number, number, number] = [meta5[0] - meta1[0], meta5[1] - meta1[1], meta5[2] - meta1[2]];
	const aToP: [number, number, number] = [meta2[0] - meta1[0], meta2[1] - meta1[1], meta2[2] - meta1[2]];
	const abLen2 = Math.max(1e-6, aToB[0] ** 2 + aToB[1] ** 2 + aToB[2] ** 2);
	const t = (aToP[0] * aToB[0] + aToP[1] * aToB[1] + aToP[2] * aToB[2]) / abLen2;
	const proj: [number, number, number] = [
		meta1[0] + aToB[0] * t,
		meta1[1] + aToB[1] * t,
		meta1[2] + aToB[2] * t,
	];
	const m2OffsetMm = distance3(meta2, proj) * worldToMm;

	// Heel alignment proxy in top view (x/z): lateral heel vector vs forefoot axis
	const heelLine: [number, number] = [heelLateral[0] - heel[0], heelLateral[2] - heel[2]];
	const foreLine: [number, number] = [meta5[0] - meta1[0], meta5[2] - meta1[2]];
	const heelAngle = Math.atan2(heelLine[1], heelLine[0]);
	const foreAngle = Math.atan2(foreLine[1], foreLine[0]);
	let deltaDeg = ((heelAngle - foreAngle) * 180) / Math.PI;
	while (deltaDeg > 90) deltaDeg -= 180;
	while (deltaDeg < -90) deltaDeg += 180;

	const archByForefoot = clamp(4 + m2OffsetMm * 0.45, 3, 18);
	const archByWidth = clamp(5 + ((forefootWidthMm - 80) * 0.10), 3, 18);
	// Step 2 refine: combine point biomechanics + STL geometry estimate
	const archMm = clamp((fallbackArchMm * 0.65) + (archByForefoot * 0.2) + (archByWidth * 0.15), 3, 18);
	const cupMm = clamp(2 + ((lateralSpanMm - 24) * 0.1), 2, 12);
	// EU size estimate from foot length + functional toe allowance (~15mm)
	const shoeSizeEu = estimateEuShoeSizeFromFootLengthMm(footLengthMm) ?? 40;

	const pronationMm = deltaDeg > 0 ? clamp(deltaDeg * 0.25, 0, 6) : 0;
	const supinationMm = deltaDeg < 0 ? clamp(Math.abs(deltaDeg) * 0.25, 0, 6) : 0;

	return {
		archMm: roundStep(Number.isFinite(archMm) ? archMm : clamp(fallbackArchMm, 3, 18), 0.5),
		cupMm: roundStep(cupMm, 0.5),
		shoeSizeEu: roundStep(shoeSizeEu, 0.5),
		pronationMm: roundStep(pronationMm, 0.5),
		supinationMm: roundStep(supinationMm, 0.5),
	};
};

/**
 * Derive biomechanical seed parameters from auto-detected FootGeometry.
 * This replaces deriveSeedFromPickedPoints when using automatic detection,
 * since we don't have the manual meta2/heelLateral points.
 */
const deriveSeedFromFootGeometry = (
	fg: FootGeometry,
	worldToMm: number,
	baseInsoleType: BaseInsoleType
) => {
	const forefootWidthMm = fg.forefootWidth * worldToMm;
	const footLengthMm = fg.footLength * worldToMm;
	const rawArchMm = fg.archHeight * worldToMm;

	// Arch support height: ~25-30% of the geometric arch height.
	// Typical navicular height above ground plane = 25-50mm for adults,
	// and typical medial arch support in an insole = 8-15mm.
	const archFromGeometry = clamp(rawArchMm * 0.28, 3, 18);
	// Cross-check with forefoot width heuristic
	const archByWidth = clamp(5 + ((forefootWidthMm - 80) * 0.10), 3, 18);
	const archByLength = clamp(6 + ((footLengthMm - 240) * 0.03), 4, 12);
	const weightedArch = (archFromGeometry * 0.62) + (archByWidth * 0.23) + (archByLength * 0.15);
	const finalArch = clamp(Math.max(weightedArch, archByLength * 0.9), 4, 18);

	// Cup height: proportional to arch, typically 40-60% of arch support
	const cupMm = clamp(finalArch * 0.55, 2, 12);

	// Rim / max insole height: the edge rim that wraps around the foot.
	// Base this on the arch-driven support target so the generated steunzool
	// does not end up lower than the scan-derived arch profile.
	const rimHeightMm = deriveTargetInsoleHeightMm(finalArch, cupMm);

	// Sole thickness: thicker for larger feet
	const soleThicknessMm = footLengthMm > 270 ? 3 : 2.5;

	// EU shoe size from foot length
	const shoeSizeEu = estimateEuShoeSizeFromFootLengthMm(footLengthMm) ?? 40;
	const standardWidthMm = getBaseInsoleWidthMmForEuSize(shoeSizeEu, baseInsoleType);

	if (process.env.NODE_ENV === 'development') {
		console.log(
			`[Seed] archHeight=${rawArchMm.toFixed(1)}mm → archSupport=${finalArch.toFixed(1)}mm, ` +
			`cup=${cupMm.toFixed(1)}mm, rim=${rimHeightMm.toFixed(1)}mm, ` +
			`shoeSize=${shoeSizeEu.toFixed(1)}, footLen=${footLengthMm.toFixed(0)}mm, ` +
			`scanWidth=${forefootWidthMm.toFixed(0)}mm, targetWidth=${standardWidthMm.toFixed(1)}mm`
		);
	}

	return {
		archMm: roundStep(Number.isFinite(finalArch) ? finalArch : 8, 0.5),
		cupMm: roundStep(cupMm, 0.5),
		rimHeightMm: normalizeScanArchHeightMm(rawArchMm),
		soleThicknessMm: roundStep(soleThicknessMm, 0.5),
		shoeSizeEu: roundStep(shoeSizeEu, 0.5),
		pronationMm: 0,
		supinationMm: 0,
		forefootWidthMm: Number(standardWidthMm.toFixed(1)),
		hielbreedteMm: 0,
		zoolbreedteMm: 0,
	};
};

/**
 * Load an STL file from a URL and return raw THREE.BufferGeometry.
 */
async function loadStlGeometry(url: string): Promise<THREE.BufferGeometry> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to load STL: ${url}`);
	const buffer = await response.arrayBuffer();
	const loader = new STLLoader();
	return loader.parse(buffer);
}

export interface InitialDesign {
	id: string;
	projectId: string;
	version: number;
	parameters: Record<string, unknown>;
	elements: unknown[];
	landmarks: Record<string, unknown> | null;
	scanMetadata: Record<string, unknown> | null;
	matchTransform: Record<string, unknown> | null;
	clientSettings?: Record<string, unknown> | null;
	stlUrl: string | null;
	gcodeUrl: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface OrgPrinter {
	id: string;
	name: string;
	brand: string | null;
	model: string | null;
	settings: OrgPrinterSettings;
}

/* ── Export progress tracking ── */
interface ExportPhase {
	label: string;
	status: 'pending' | 'active' | 'done' | 'error';
}
interface ExportProgress {
	title: string;
	phases: ExportPhase[];
	error?: string | null;
	done?: boolean;
}

function ExportProgressOverlay({ progress, onDismiss }: { progress: ExportProgress; onDismiss: () => void }) {
	const activePhase = progress.phases.find((p) => p.status === 'active');
	const displayText = progress.error
		? progress.error
		: progress.done
			? progress.title
			: activePhase?.label ?? progress.title;

	return (
		<div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-900/60 backdrop-blur-[2px]">
			<div className="animate-fade-in-up flex flex-col items-center gap-4 rounded-2xl border border-ui-border bg-ui-panel/95 px-8 py-6 shadow-xl min-w-[280px] max-w-[360px]">
				{/* Spinner / success / error icon */}
				{progress.done ? (
					<div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20">
						<Check size={22} className="text-green-400" />
					</div>
				) : progress.error ? (
					<div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20">
						<AlertCircle size={22} className="text-red-400" />
					</div>
				) : (
					<div className="relative h-10 w-10">
						<div className="absolute inset-0 rounded-full border-2 border-ui-border" />
						<div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-ui-accent" />
					</div>
				)}

				{/* Main status text */}
				<p className="text-center text-sm font-semibold text-ui-text">{displayText}</p>

				{/* Step indicators */}
				{!progress.done && !progress.error && (
					<div className="flex items-center gap-1.5">
						{progress.phases.map((phase, i) => (
							<div
								key={i}
								className={[
									'h-1.5 rounded-full transition-all duration-300',
									phase.status === 'done' ? 'w-6 bg-ui-accent' :
										phase.status === 'active' ? 'w-6 bg-ui-accent/50 animate-pulse' :
											'w-3 bg-ui-border/40',
								].join(' ')}
							/>
						))}
					</div>
				)}

				{/* Indeterminate progress bar (while processing) */}
				{!progress.done && !progress.error && (
					<div className="h-0.5 w-24 overflow-hidden rounded-full bg-ui-border/40">
						<div className="h-full w-1/3 rounded-full bg-ui-accent/60 animate-progress-indeterminate" />
					</div>
				)}

				{/* Dismiss button when done or error */}
				{(progress.done || progress.error) && (
					<Button
						variant="outline"
						size="sm"
						className="mt-1"
						onClick={onDismiss}
					>
						{progress.done ? 'Sluiten' : 'Terug'}
					</Button>
				)}
			</div>
		</div>
	);
}

function cloneTrimlineProfile(p: TrimlineHandleProfile): TrimlineHandleProfile {
	return {
		...p,
		tValues: [...p.tValues],
		rightOffsetsMm: [...p.rightOffsetsMm],
		leftOffsetsMm: [...p.leftOffsetsMm],
		rightHeightOffsetsMm: p.rightHeightOffsetsMm ? [...p.rightHeightOffsetsMm] : undefined,
		leftHeightOffsetsMm: p.leftHeightOffsetsMm ? [...p.leftHeightOffsetsMm] : undefined,
		rightDeltasMm: p.rightDeltasMm?.map((d) => ({ x: d.x, y: d.y, z: d.z })),
		leftDeltasMm: p.leftDeltasMm?.map((d) => ({ x: d.x, y: d.y, z: d.z })),
		points3D: p.points3D?.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z })),
	};
}

interface DesignPageClientProps {
	project: ProjectDetail;
	orgSlug: string;
	initialDesign?: InitialDesign | null;
	orgPrinters?: OrgPrinter[];
}

export function DesignPageClient({ project, orgSlug, initialDesign, orgPrinters }: DesignPageClientProps) {
	const projectId = project.id;
	const router = useRouter();

	// ── Client settings ref for autosave ──
	const clientSettingsGetterRef = useRef<ClientSettingsGetter | null>(null);

	// ── Autosave hook ──
	const { saveStatus, lastSavedAt, hydrateFromDesign, debouncedSave } = useDesignAutosave(
		projectId,
		initialDesign?.id ?? null,
		clientSettingsGetterRef
	);

	// ── Scan upload state ──
	const [showUploadScansModal, setShowUploadScansModal] = useState(false);
	const [projectScans, setProjectScans] = useState(project.scans);

	// Hydrate from saved design on mount (moved below useState declarations)
	const hasHydratedRef = useRef(false);

	const viewerRef = useRef<EnhancedSTLViewerRef>(null);
	const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('base');
	const [selectedLeftScanId, setSelectedLeftScanId] = useState<string | null>(
		null
	);
	const [selectedRightScanId, setSelectedRightScanId] = useState<string | null>(
		null
	);
	const selectedTemplate = useDesignStore((state) => state.selectedTemplate);
	const setSelectedTemplate = useDesignStore((state) => state.setSelectedTemplate);
	const parameters = useDesignStore((state) => state.parameters);
	const setParameters = useDesignStore((state) => state.setParameters);
	const [activeDesignStep, setActiveDesignStep] = useState<number>(1);
	const [leftPanelTab, setLeftPanelTab] = useState<'view' | 'analysis'>('view');
	const [viewerViewPreset, setViewerViewPreset] = useState<
		'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'
	>('iso');
	const [viewerControlMode, setViewerControlMode] = useState<'rotate' | 'pan'>(
		'rotate'
	);
	const [namedViewActive, setNamedViewActive] = useState<
		'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso' | null
	>(null);
	const [analysisProbe, setAnalysisProbe] = useState<{
		heightMm: number;
		side: 'left' | 'right';
		point: [number, number, number];
	} | null>(null);
	const analysisProbeRafRef = useRef<number | null>(null);
	const pendingAnalysisProbeRef = useRef<{
		heightMm: number;
		side: 'left' | 'right';
		point: [number, number, number];
	} | null>(null);
	const [pointStepIndex, setPointStepIndex] = useState(0);
	const [pointPickFoot, setPointPickFoot] = useState<'right' | 'left'>('right');
	const [rightPointSelections, setRightPointSelections] = useState<PickSelections>({});
	const [leftPointSelections, setLeftPointSelections] = useState<PickSelections>({});
	const [scansActive, setScansActive] = useState(false);
	const [showOverlays, setShowOverlays] = useState(false);
	const [soleWidthOverrideRatio, setSoleWidthOverrideRatio] = useState<{
		left: number | null;
		right: number | null;
	}>({ left: null, right: null });
	const [currentInsoleWidthMm, setCurrentInsoleWidthMm] = useState<{
		left: number | null;
		right: number | null;
	}>({ left: null, right: null });
	const [planWorldToMm, setPlanWorldToMm] = useState(1);
	const rightFittingRef = useRef<{
		archHeight: number;
		scanArchHeightMm: number;
		archApexShiftMm: number;
		cupHeight: number;
		shoeSize: number;
		pronation: number;
		supination: number;
		forefootWidthMm: number;
	} | null>(null);
	const [isFitting, setIsFitting] = useState(false);
	const [isViewerReady, setIsViewerReady] = useState(false);
	const [autoDetectStatus, setAutoDetectStatus] = useState<
		'idle' | 'detecting' | 'success' | 'failed'
	>('idle');
	const [autoDetectMessage, setAutoDetectMessage] = useState('');

	// Auto-dismiss the success banner after 6 seconds
	useEffect(() => {
		if (autoDetectStatus === 'success') {
			const t = setTimeout(() => {
				setAutoDetectStatus('idle');
				setAutoDetectMessage('');
			}, 6000);
			return () => clearTimeout(t);
		}
	}, [autoDetectStatus]);

	const [designPlan, setDesignPlan] = useState<{
		plan: ReturnType<typeof buildInsolePlan> | null;
		points: LandmarkPoints | null;
	}>({ plan: null, points: null });
	const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(
		null
	);
	const crosshairRafRef = useRef<number | null>(null);
	const pendingCrosshairRef = useRef<{ x: number; y: number } | null>(null);
	const [viewSettings, setViewSettings] = useState({
		showLeft: true,
		showRight: true,
		transparent: false,
		heatmap: false,
		clampDebug: false,
		showInsoles: true,
		showModel: true,
	});

	const defaultGeneral = useMemo(
		() => ({
			sizeLabel: 'EU' as const,
			baseInsoleType: DEFAULT_BASE_INSOLE_TYPE,
			shoeSize: { left: 40, right: 40 },
			seededShoeSize: { left: 40, right: 40 },
			soleThicknessMm: { left: 2, right: 2 },
			maxInsoleHeightMm: { left: 0, right: 0 },
		}),
		[]
	);
	const general = parameters.general ?? defaultGeneral;
	const generalNormalized = useMemo(() => {
		const normalizeLR = (
			v: unknown,
			fallback: { left: number; right: number }
		) => {
			if (typeof v === 'number') return { left: v, right: v };
			if (v && typeof v === 'object') {
				const maybe = v as { left?: unknown; right?: unknown };
				return {
					left:
						typeof maybe.left === 'number' && Number.isFinite(maybe.left)
							? maybe.left
							: fallback.left,
					right:
						typeof maybe.right === 'number' && Number.isFinite(maybe.right)
							? maybe.right
							: fallback.right,
				};
			}
			return fallback;
		};
		return {
			sizeLabel: general.sizeLabel,
			baseInsoleType: isBaseInsoleType(general.baseInsoleType)
				? general.baseInsoleType
				: defaultGeneral.baseInsoleType,
			shoeSize: normalizeLR(general.shoeSize, defaultGeneral.shoeSize),
			seededShoeSize: normalizeLR(general.seededShoeSize, defaultGeneral.seededShoeSize),
			soleThicknessMm: normalizeLR(
				general.soleThicknessMm,
				defaultGeneral.soleThicknessMm
			),
			maxInsoleHeightMm: normalizeLR(
				general.maxInsoleHeightMm,
				defaultGeneral.maxInsoleHeightMm
			),
		};
	}, [general, defaultGeneral]);

	const selectedBaseInsoleAssets = useMemo(
		() => getBaseInsoleAssetUrls(generalNormalized.baseInsoleType),
		[generalNormalized.baseInsoleType]
	);

	const effectiveTargetForefootWidthMm = useMemo(
		() => ({
			left: Number(
				getBaseInsoleWidthMmForEuSize(
					generalNormalized.shoeSize.left,
					generalNormalized.baseInsoleType
				).toFixed(1)
			),
			right: Number(
				getBaseInsoleWidthMmForEuSize(
					generalNormalized.shoeSize.right,
					generalNormalized.baseInsoleType
				).toFixed(1)
			),
		}),
		[
			generalNormalized.baseInsoleType,
			generalNormalized.shoeSize.left,
			generalNormalized.shoeSize.right,
		]
	);

	const normalizeSoleWidthMm = useCallback((widthMm: number, fallbackWidthMm: number) => {
		if (!Number.isFinite(widthMm)) return Number(fallbackWidthMm.toFixed(1));
		return Number(Math.max(40, Math.min(160, widthMm)).toFixed(1));
	}, []);

	const getSoleWidthRatio = useCallback((targetWidthMm: number, baseWidthMm: number) => {
		const safeBaseWidthMm = Math.max(1e-6, baseWidthMm);
		return Number(Math.max(0.75, Math.min(1.5, targetWidthMm / safeBaseWidthMm)).toFixed(4));
	}, []);

	const resolvedTargetForefootWidthMm = useMemo(
		() => ({
			left: Number((effectiveTargetForefootWidthMm.left * (soleWidthOverrideRatio.left ?? 1)).toFixed(1)),
			right: Number((effectiveTargetForefootWidthMm.right * (soleWidthOverrideRatio.right ?? 1)).toFixed(1)),
		}),
		[
			effectiveTargetForefootWidthMm.left,
			effectiveTargetForefootWidthMm.right,
			soleWidthOverrideRatio.left,
			soleWidthOverrideRatio.right,
		]
	);

	const handleSoleWidthChange = useCallback(
		(side: 'left' | 'right', nextWidthMm: number) => {
			const baseWidthMm = side === 'left'
				? effectiveTargetForefootWidthMm.left
				: effectiveTargetForefootWidthMm.right;
			const fallbackWidthMm = side === 'left'
				? resolvedTargetForefootWidthMm.left
				: resolvedTargetForefootWidthMm.right;
			const normalized = normalizeSoleWidthMm(nextWidthMm, fallbackWidthMm);
			setCorrections((prev) => {
				if (prev.zoolbreedte.left === 0 && prev.zoolbreedte.right === 0) {
					return prev;
				}
				return {
					...prev,
					zoolbreedte: { left: 0, right: 0 },
				};
			});
			const nextRatio = getSoleWidthRatio(normalized, baseWidthMm);
			setSoleWidthOverrideRatio((prev) => {
				if (prev[side] === nextRatio) return prev;
				return {
					...prev,
					[side]: nextRatio,
				};
			});
		},
		[
			effectiveTargetForefootWidthMm.left,
			effectiveTargetForefootWidthMm.right,
			getSoleWidthRatio,
			normalizeSoleWidthMm,
			resolvedTargetForefootWidthMm.left,
			resolvedTargetForefootWidthMm.right,
		]
	);

	const handleAnalysisProbe = useCallback((payload: {
		heightMm: number;
		side: 'left' | 'right';
		point: [number, number, number];
	}) => {
		pendingAnalysisProbeRef.current = payload;
		if (analysisProbeRafRef.current != null) return;
		analysisProbeRafRef.current = requestAnimationFrame(() => {
			analysisProbeRafRef.current = null;
			const next = pendingAnalysisProbeRef.current;
			if (!next) return;
			setAnalysisProbe((prev) => {
				if (
					prev &&
					prev.side === next.side &&
					prev.heightMm === next.heightMm &&
					prev.point[0] === next.point[0] &&
					prev.point[1] === next.point[1] &&
					prev.point[2] === next.point[2]
				) {
					return prev;
				}
				return next;
			});
		});
	}, []);

	const handlePointPickMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		pendingCrosshairRef.current = {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		};
		if (crosshairRafRef.current != null) return;
		crosshairRafRef.current = requestAnimationFrame(() => {
			crosshairRafRef.current = null;
			const next = pendingCrosshairRef.current;
			setCrosshair((prev) => {
				if (!next) return null;
				if (prev && prev.x === next.x && prev.y === next.y) return prev;
				return next;
			});
		});
	}, []);

	const handlePointPickMouseLeave = useCallback(() => {
		pendingCrosshairRef.current = null;
		if (crosshairRafRef.current != null) {
			cancelAnimationFrame(crosshairRafRef.current);
			crosshairRafRef.current = null;
		}
		setCrosshair((prev) => (prev === null ? prev : null));
	}, []);

	useEffect(() => {
		return () => {
			if (analysisProbeRafRef.current != null) {
				cancelAnimationFrame(analysisProbeRafRef.current);
			}
			if (crosshairRafRef.current != null) {
				cancelAnimationFrame(crosshairRafRef.current);
			}
		};
	}, []);

	const updateGeneral = useCallback(
		(updates: Partial<typeof generalNormalized>) => {
			setParameters({
				...parameters,
				general: {
					...generalNormalized,
					...updates,
				},
			});
		},
		[generalNormalized, parameters, setParameters]
	);

	// ── Derive initial printer settings from org printers ──
	const orgDefaultPrinterSettings = useMemo<PrinterSettings>(() => {
		const first = orgPrinters?.[0];
		if (!first) {
			// Fallback hard-coded defaults when no org printers exist
			return {
				printerModel: 'raise3d-e2',
				brand: 'Raise3D',
				printer: 'E2',
				material: 'Footprint3D TPU-95A 2.3KG',
				nozzle: '0.8',
				extruder: 'Links',
				topLayers: 1,
				bottomLayers: 2,
				adhesion: 'Geen',
			};
		}
		const s = first.settings;
		return {
			printerModel: (first.model?.toLowerCase().includes('ir3') ? 'ir3-v2' : 'raise3d-e2') as PrinterSettings['printerModel'],
			brand: first.brand ?? 'Raise3D',
			printer: first.model ?? first.name ?? 'E2',
			material: 'Footprint3D TPU-95A 2.3KG',
			nozzle: String(s.nozzleDiameter ?? 0.8),
			extruder: s.extruder ?? 'Links',
			topLayers: s.overhang ?? 1,
			bottomLayers: s.underlay ?? 2,
			adhesion: s.adhesion ?? 'Geen',
		};
	}, [orgPrinters]);

	const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(orgDefaultPrinterSettings);

	/* ── Step 3 – Print preparation state (per side) ── */
	type SideHardness = {
		heelEdgeThicknessMm: number;
		elementsVloeien: boolean;
		elementsSplit: boolean;
		overall: HardnessKey;
		front: HardnessKey;
		middle: HardnessKey;
		back: HardnessKey;
	};
	const DEFAULT_SIDE_HARDNESS: SideHardness = {
		heelEdgeThicknessMm: 1,
		elementsVloeien: false,
		elementsSplit: false,
		overall: 'normal',
		front: 'normal',
		middle: 'normal',
		back: 'normal',
	};
	const DEFAULT_HARDNESS_PROFILES: Record<HardnessKey, { infillPercent: number }> = useMemo(() => ({
		extraSoft: { infillPercent: 10 },
		soft: { infillPercent: 22 },
		normal: { infillPercent: 26 },
		hard: { infillPercent: 30 },
		extraHard: { infillPercent: 36 },
	}), []);
	const [step3Left, setStep3Left] = useState<SideHardness>({ ...DEFAULT_SIDE_HARDNESS });
	const [step3Right, setStep3Right] = useState<SideHardness>({ ...DEFAULT_SIDE_HARDNESS });
	const [step3Side, setStep3Side] = useState<'left' | 'right'>('left');
	const [selectedZone, setSelectedZone] = useState<'front' | 'middle' | 'back' | null>(null);
	const printInteraction = usePrintInteraction();

	// Derive hardness profiles from org printer settings (no need for client-side fetch)
	const orgHardnessProfiles = useMemo(() => {
		const first = orgPrinters?.[0];
		return first?.settings?.hardnessProfiles ?? null;
	}, [orgPrinters]);
	const [hardnessProfiles, setHardnessProfiles] = useState<Record<HardnessKey, { infillPercent: number }> | null>(orgHardnessProfiles);
	const activeProfiles = hardnessProfiles ?? DEFAULT_HARDNESS_PROFILES;
	const HARDNESS_OPTIONS: { key: HardnessKey; label: string; color: string }[] = useMemo(() => ([
		{ key: 'extraSoft', label: 'Extra zacht', color: '#6DD5FA' },
		{ key: 'soft', label: 'Zacht', color: '#4FC3F7' },
		{ key: 'normal', label: 'Normaal', color: '#29B6F6' },
		{ key: 'hard', label: 'Hard', color: '#0288D1' },
		{ key: 'extraHard', label: 'Extra hard', color: '#01579B' },
	]), []);
	const step3Current = step3Side === 'left' ? step3Left : step3Right;
	const setStep3Current = step3Side === 'left' ? setStep3Left : setStep3Right;

	// Keep printerSettings in sync with Step 3 choices
	useEffect(() => {
		const buildSide = (s: SideHardness) => {
			const infillPercent = s.elementsSplit ? undefined : activeProfiles[s.overall]?.infillPercent;
			return {
				heelEdgeThicknessMm: s.heelEdgeThicknessMm,
				elementsSplit: s.elementsSplit,
				infillPercent,
				infillFrontPercent: s.elementsSplit ? activeProfiles[s.front]?.infillPercent : undefined,
				infillMiddlePercent: s.elementsSplit ? activeProfiles[s.middle]?.infillPercent : undefined,
				infillBackPercent: s.elementsSplit ? activeProfiles[s.back]?.infillPercent : undefined,
			};
		};
		setPrinterSettings((prev) => ({
			...prev,
			step3: {
				left: buildSide(step3Left),
				right: buildSide(step3Right),
			},
		}));
	}, [step3Left, step3Right, activeProfiles]);
	const [showScanModal, setShowScanModal] = useState(false);
	const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
	const [step4View, setStep4View] = useState<'export' | 'directProduce'>(
		'export'
	);
	const [gcodeBusy, setGcodeBusy] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [productionMethod, setProductionMethod] = useState('Printer: Solid');

	/* ── CNC / Frezen EVA state ── */
	const [cncState, setCncState] = useState<CncProductionState>(createDefaultCncState);
	const [showMillingModeSelector, setShowMillingModeSelector] = useState(false);
	const [cncPlanningActive, setCncPlanningActive] = useState(false);
	const [cncPreviewGeometry, setCncPreviewGeometry] = useState<{
		left: THREE.BufferGeometry | null;
		right: THREE.BufferGeometry | null;
	}>({ left: null, right: null });

	const isEvaMethod = productionMethod === 'Frezen: EVA';

	const captureCncPreviewGeometry = useCallback(() => {
		const left = viewerRef.current?.getExportInsoleGeometryMm('left') ?? null;
		const right = viewerRef.current?.getExportInsoleGeometryMm('right') ?? null;
		setCncPreviewGeometry({ left, right });
		return { left, right };
	}, []);

	useEffect(() => {
		return () => {
			cncPreviewGeometry.left?.dispose();
			cncPreviewGeometry.right?.dispose();
		};
	}, [cncPreviewGeometry]);

	const handleSelectMillingMode = useCallback((mode: MillingMode) => {
		captureCncPreviewGeometry();
		setCncState((prev) => ({ ...prev, millingMode: mode }));
		setShowMillingModeSelector(false);
		setCncPlanningActive(true);
	}, [captureCncPreviewGeometry]);

	const handleExportNcFile = useCallback(async () => {
		if (!cncState.millingMode) return;
		const name = project?.patient
			? `${project.patient.firstName}_${project.patient.lastName}`
			: 'patient';

		// Prefer actual designed insole geometry from the 3D viewer.
		// This includes all patient corrections, elements, and modifications.
		// Falls back to base template STL if viewer geometry is not available.
		const freshLeftGeom = viewerRef.current?.getExportInsoleGeometryMm('left') ?? null;
		const freshRightGeom = viewerRef.current?.getExportInsoleGeometryMm('right') ?? null;
		const leftGeom = freshLeftGeom ?? cncPreviewGeometry.left;
		const rightGeom = freshRightGeom ?? cncPreviewGeometry.right;

		let leftResult, rightResult;

		if (leftGeom) {
			leftResult = await extractContourFromExportGeometryAsync(leftGeom, 'left');
			freshLeftGeom?.dispose();
		} else {
			leftResult = await extractStlContour(
				selectedBaseInsoleAssets.leftUrl,
				'left',
				undefined,
				undefined,
				generalNormalized.baseInsoleType
			);
		}

		if (rightGeom) {
			rightResult = await extractContourFromExportGeometryAsync(rightGeom, 'right');
			freshRightGeom?.dispose();
		} else {
			rightResult = await extractStlContour(
				selectedBaseInsoleAssets.rightUrl,
				'right',
				undefined,
				undefined,
				generalNormalized.baseInsoleType
			);
		}

		const ncContent = generateNcFile({
			millingMode: cncState.millingMode,
			fixture: cncState.fixture,
			toolSettings: {
				...cncState.toolSettings,
				spindleSpeedRpm: 24000,
				feedRateXYMmMin: 2400,
				feedRateZMmMin: 2400,
				safeZMm: Math.max(cncState.toolSettings.safeZMm, 60),
			},
			postSettings: {
				...cncState.postSettings,
				embedOffsets: false,
			},
			compatibilityMode: true,
			patientName: name,
			projectId,
			contours: {
				left: leftResult.contour.length > 0 ? leftResult.contour : undefined,
				right: rightResult.contour.length > 0 ? rightResult.contour : undefined,
			},
			heightfields: {
				left: leftResult.heightfield,
				right: rightResult.heightfield,
			},
		});
		const filename = `${name}_${cncState.millingMode}_${new Date().getFullYear()}_top.nc`;
		downloadNcFile(ncContent, filename);
	}, [cncPreviewGeometry.left, cncPreviewGeometry.right, cncState, generalNormalized.baseInsoleType, projectId, project?.patient, selectedBaseInsoleAssets.leftUrl, selectedBaseInsoleAssets.rightUrl]);

	const [selectedBaseSTL, setSelectedBaseSTL] = useState<string | null>(null);
	const [corrections, setCorrections] = useState<OntwerpCorrections>(createDefaultOntwerpCorrections);
	const [, startCorrectionsTransition] = useTransition();
	const [elementsModalOpen, setElementsModalOpen] = useState(false);
	const [elementsModalSide, setElementsModalSide] = useState<'left' | 'right'>('left');
	const placedElements = useElementsStore((state) => state.placedElements);
	const addPlacedElement = useElementsStore((state) => state.addElement);
	const selectedElementId = useElementsStore((state) => state.selectedElementId);
	const selectPlacedElement = useElementsStore((state) => state.selectElement);
	const updatePlacedElement = useElementsStore((state) => state.updateElement);
	const selectedPlacedElement = useMemo(
		() => placedElements.find((el) => el.id === selectedElementId) ?? null,
		[placedElements, selectedElementId]
	);
	const [elementEditMode, setElementEditMode] = useState<ElementEditMode>(null);
	const [elementTrimlineEditId, setElementTrimlineEditId] = useState<string | null>(null);
	const [elementBoxEditId, setElementBoxEditId] = useState<string | null>(null);
	const [pendingElementTrimlineAdj, setPendingElementTrimlineAdj] = useState<TrimlineAdjustments>({
		...DEFAULT_TRIMLINE_ADJUSTMENTS,
	});
	const [pendingElementTrimlineHandleProfile, setPendingElementTrimlineHandleProfile] = useState<TrimlineHandleProfile | null>(null);
	const [pendingElementBoxOffsets, setPendingElementBoxOffsets] = useState<BoxGridSavedOffsets | null>(null);
	const pendingElementTrimlineAdjRef = useRef<TrimlineAdjustments>({
		...DEFAULT_TRIMLINE_ADJUSTMENTS,
	});
	const pendingElementTrimlineHandleProfileRef = useRef<TrimlineHandleProfile | null>(null);
	const pendingElementBoxOffsetsRef = useRef<BoxGridSavedOffsets | null>(null);
	const elementTrimlinePanelSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [, forceElementTrimlinePanelSync] = useState(0);
	const elementBoxSnapshotRef = useRef<BoxGridSavedOffsets | null>(null);
	const leftPlacedElements = useMemo(
		() => placedElements.filter((el) => el.side === 'left'),
		[placedElements]
	);
	const rightPlacedElements = useMemo(
		() => placedElements.filter((el) => el.side === 'right'),
		[placedElements]
	);
	const leftPlacedElementCount = leftPlacedElements.length;
	const rightPlacedElementCount = rightPlacedElements.length;

	// ── Effective elements: override floorMode when "elementen vloeien" is active ──
	// In EVA mode the global toggle lives in cncState.evaSettings.elementsFlow.
	// In Print mode each side has its own elementsVloeien flag.

	const effectiveLeftPlacedElements = useMemo(() => {
		const vloeien = isEvaMethod ? cncState.evaSettings.elementsFlow : step3Left.elementsVloeien;
		if (!vloeien) return leftPlacedElements;
		return leftPlacedElements.map((el) => el.floorMode === 'sole' ? el : { ...el, floorMode: 'sole' as const });
	}, [leftPlacedElements, isEvaMethod, cncState.evaSettings.elementsFlow, step3Left.elementsVloeien]);

	const effectiveRightPlacedElements = useMemo(() => {
		const vloeien = isEvaMethod ? cncState.evaSettings.elementsFlow : step3Right.elementsVloeien;
		if (!vloeien) return rightPlacedElements;
		return rightPlacedElements.map((el) => el.floorMode === 'sole' ? el : { ...el, floorMode: 'sole' as const });
	}, [rightPlacedElements, isEvaMethod, cncState.evaSettings.elementsFlow, step3Right.elementsVloeien]);

	const viewerHeelEdgeThicknessMm = useMemo(
		() => ({
			left: isEvaMethod ? cncState.evaSettings.heelEdgeThicknessMm : step3Left.heelEdgeThicknessMm,
			right: isEvaMethod ? cncState.evaSettings.heelEdgeThicknessMm : step3Right.heelEdgeThicknessMm,
		}),
		[isEvaMethod, cncState.evaSettings.heelEdgeThicknessMm, step3Left.heelEdgeThicknessMm, step3Right.heelEdgeThicknessMm]
	);
	const viewerSelectedElementTrimlineEdit = useMemo(() => {
		if (!elementTrimlineEditId || !selectedPlacedElement || selectedPlacedElement.id !== elementTrimlineEditId) {
			return null;
		}
		return {
			elementId: elementTrimlineEditId,
			side: selectedPlacedElement.side,
			profile: pendingElementTrimlineHandleProfile,
		};
	}, [elementTrimlineEditId, selectedPlacedElement, pendingElementTrimlineHandleProfile]);
	const viewerSelectedElementBoxEdit = useMemo(() => {
		if (
			!selectedPlacedElement ||
			elementEditMode !== 'box' ||
			elementBoxEditId !== selectedPlacedElement.id
		) {
			return null;
		}
		return {
			elementId: selectedPlacedElement.id,
			side: selectedPlacedElement.side,
			savedOffsets: pendingElementBoxOffsets,
		};
	}, [selectedPlacedElement, elementEditMode, elementBoxEditId, pendingElementBoxOffsets]);
	const viewerElementPlacementMode = useMemo(() => {
		if (!selectedPlacedElement || elementEditMode !== 'move') return null;
		return {
			elementId: selectedPlacedElement.id,
			side: selectedPlacedElement.side,
		};
	}, [selectedPlacedElement, elementEditMode]);
	const [activeCorrections, setActiveCorrections] = useState<CorrectionKey[]>(
		DEFAULT_ACTIVE_CORRECTIONS
	);
	const handleCorrectionsChange = useCallback((nextCorrections: OntwerpCorrections) => {
		startCorrectionsTransition(() => {
			setCorrections(nextCorrections);
		});
	}, [startCorrectionsTransition]);

	const handleElementEditModeChange = useCallback((mode: ElementEditMode) => {
		if (mode === 'trimline' && selectedPlacedElement) {
			const initialAdj = normalizeElementTrimlineAdjustments(selectedPlacedElement.trimlineAdjustments);
			const initialProfile = selectedPlacedElement.trimlineHandleProfile
				? cloneTrimlineProfile(selectedPlacedElement.trimlineHandleProfile)
				: null;
			setElementTrimlineEditId(selectedPlacedElement.id);
			pendingElementTrimlineAdjRef.current = initialAdj;
			pendingElementTrimlineHandleProfileRef.current = initialProfile;
			setPendingElementTrimlineAdj(initialAdj);
			setPendingElementTrimlineHandleProfile(initialProfile);
		} else if (elementTrimlineEditId && mode !== 'trimline') {
			setElementTrimlineEditId(null);
			const resetAdj = normalizeElementTrimlineAdjustments();
			pendingElementTrimlineAdjRef.current = resetAdj;
			pendingElementTrimlineHandleProfileRef.current = null;
			setPendingElementTrimlineAdj(resetAdj);
			setPendingElementTrimlineHandleProfile(null);
		}
		if (mode === 'box' && selectedPlacedElement) {
			const initialOffsets = cloneBoxGridOffsets(selectedPlacedElement.boxGridOffsets);
			setElementBoxEditId(selectedPlacedElement.id);
			pendingElementBoxOffsetsRef.current = initialOffsets;
			setPendingElementBoxOffsets(initialOffsets);
			elementBoxSnapshotRef.current = cloneBoxGridOffsets(initialOffsets);
		} else if (elementBoxEditId && mode !== 'box') {
			setElementBoxEditId(null);
			pendingElementBoxOffsetsRef.current = null;
			setPendingElementBoxOffsets(null);
			elementBoxSnapshotRef.current = null;
		}
		setElementEditMode(mode);
		if (mode === 'box' || mode === 'scale' || mode === 'trimline' || mode === 'move') {
			setViewerViewPreset('top');
		}
	}, [selectedPlacedElement, elementTrimlineEditId, elementBoxEditId]);
	const nudgeSelectedElement = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
		if (!selectedPlacedElement) return;

		const deltaU = direction === 'up'
			? -ELEMENT_MOVE_STEP_UV
			: direction === 'down'
				? ELEMENT_MOVE_STEP_UV
				: 0;
		const deltaV = direction === 'right'
			? -ELEMENT_MOVE_STEP_UV
			: direction === 'left'
				? ELEMENT_MOVE_STEP_UV
				: 0;

		flushSync(() => {
			updatePlacedElement(selectedPlacedElement.id, {
				positionU: Math.max(0, Math.min(1, selectedPlacedElement.positionU + deltaU)),
				positionV: Math.max(0, Math.min(1, selectedPlacedElement.positionV + deltaV)),
			});
		});
	}, [selectedPlacedElement, updatePlacedElement]);
	const adjustSelectedElementScale = useCallback(
		(axis: 'uniform' | 'u' | 'v', direction: 1 | -1) => {
			const id = selectedPlacedElement?.id;
			if (!id) return;
			const factor = 1 + direction * ELEMENT_SCALE_STEP;
			const clampScale = (v: number) =>
				Math.min(ELEMENT_SCALE_MAX, Math.max(ELEMENT_SCALE_MIN, v));
			flushSync(() => {
				const el = useElementsStore.getState().placedElements.find((e) => e.id === id);
				if (!el) return;
				if (axis === 'uniform') {
					updatePlacedElement(id, {
						scaleU: clampScale(el.scaleU * factor),
						scaleV: clampScale(el.scaleV * factor),
					});
				} else if (axis === 'u') {
					updatePlacedElement(id, {
						scaleU: clampScale(el.scaleU * factor),
					});
				} else {
					updatePlacedElement(id, {
						scaleV: clampScale(el.scaleV * factor),
					});
				}
			});
		},
		[selectedPlacedElement?.id, updatePlacedElement],
	);
	useEffect(() => {
		if (!selectedPlacedElement) {
			setElementEditMode(null);
			setElementTrimlineEditId(null);
			setElementBoxEditId(null);
			const resetAdj = normalizeElementTrimlineAdjustments();
			pendingElementTrimlineAdjRef.current = resetAdj;
			pendingElementTrimlineHandleProfileRef.current = null;
			pendingElementBoxOffsetsRef.current = null;
			setPendingElementTrimlineAdj(resetAdj);
			setPendingElementTrimlineHandleProfile(null);
			setPendingElementBoxOffsets(null);
			elementBoxSnapshotRef.current = null;
		}
	}, [selectedPlacedElement]);
	useEffect(() => {
		if (!selectedPlacedElement || elementEditMode !== 'move') return;

		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const tag = target?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				nudgeSelectedElement('up');
			} else if (event.key === 'ArrowDown') {
				event.preventDefault();
				nudgeSelectedElement('down');
			} else if (event.key === 'ArrowLeft') {
				event.preventDefault();
				nudgeSelectedElement('left');
			} else if (event.key === 'ArrowRight') {
				event.preventDefault();
				nudgeSelectedElement('right');
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [elementEditMode, nudgeSelectedElement, selectedPlacedElement]);
	useEffect(() => {
		if (!selectedPlacedElement || elementEditMode !== 'scale') return;

		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const tag = target?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
				return;
			}

			if (event.key === '+' || event.key === '=') {
				event.preventDefault();
				adjustSelectedElementScale('uniform', 1);
			} else if (event.key === '-' || event.key === '_') {
				event.preventDefault();
				adjustSelectedElementScale('uniform', -1);
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [adjustSelectedElementScale, elementEditMode, selectedPlacedElement]);

	useEffect(() => {
		if (workflowStep !== 'base' || !isViewerReady) return;
		let frame1 = 0;
		let frame2 = 0;
		const measure = () => {
			const leftDims = viewerRef.current?.getInsoleDimensionsMm('left') ?? null;
			const rightDims = viewerRef.current?.getInsoleDimensionsMm('right') ?? null;
			const nextLeft = leftDims?.widthMm != null ? Number(leftDims.widthMm.toFixed(1)) : null;
			const nextRight = rightDims?.widthMm != null ? Number(rightDims.widthMm.toFixed(1)) : null;
			setCurrentInsoleWidthMm((prev) => (
				prev.left === nextLeft && prev.right === nextRight
					? prev
					: {
						left: nextLeft,
						right: nextRight,
					}
			));
		};
		frame1 = requestAnimationFrame(() => {
			frame2 = requestAnimationFrame(measure);
		});
		return () => {
			cancelAnimationFrame(frame1);
			cancelAnimationFrame(frame2);
		};
	}, [
		workflowStep,
		isViewerReady,
		corrections,
		activeCorrections,
		resolvedTargetForefootWidthMm.left,
		resolvedTargetForefootWidthMm.right,
		generalNormalized.baseInsoleType,
		generalNormalized.shoeSize.left,
		generalNormalized.shoeSize.right,
		generalNormalized.soleThicknessMm.left,
		generalNormalized.soleThicknessMm.right,
		generalNormalized.maxInsoleHeightMm.left,
		generalNormalized.maxInsoleHeightMm.right,
	]);
	const [textEditorOpen, setTextEditorOpen] = useState(false);
	const textEditSessionRef = useRef<{
		savedBottomText: SavedBottomTextState | null;
		draftBottomText: SavedBottomTextState;
	} | null>(null);
	const [savedBottomText, setSavedBottomText] = useState<SavedBottomTextState | null>(null);
	const [draftBottomText, setDraftBottomText] = useState<SavedBottomTextState>({
		text: '',
		sizeMm: 10,
		depthMm: 0.6,
	});
	const [debouncedDraftBottomText, setDebouncedDraftBottomText] = useState<SavedBottomTextState>({
		text: '',
		sizeMm: 10,
		depthMm: 0.6,
	});
	const [bottomTextMeshOk, setBottomTextMeshOk] = useState<{ left: boolean; right: boolean }>({
		left: true,
		right: true,
	});
	const [bottomTextIssue, setBottomTextIssue] = useState<{
		left?: string;
		right?: string;
	}>({});
	const [bottomTextLoadingBySide, setBottomTextLoadingBySide] = useState<{
		left: boolean;
		right: boolean;
	}>({ left: false, right: false });

	const [selectedInsoleSide, setSelectedInsoleSide] = useState<'left' | 'right' | null>(null);
	const [boxEnabled, setBoxEnabled] = useState<{ left: boolean; right: boolean }>({
		left: false,
		right: false,
	});
	const [boxGridPoints, setBoxGridPoints] = useState<{
		left: BoxGridSavedOffsets | null;
		right: BoxGridSavedOffsets | null;
	}>({ left: null, right: null });
	const pendingBoxGridDraftRef = useRef<{
		left: BoxGridSavedOffsets | null;
		right: BoxGridSavedOffsets | null;
	}>({ left: null, right: null });
	// Snapshot of boxGridPoints at the moment grid edit starts (for cancel/revert)
	const boxGridSnapshotRef = useRef<BoxGridSavedOffsets | null>(null);
	const isSelectedGridModeOn = selectedInsoleSide
		? boxEnabled[selectedInsoleSide]
		: false;
	const isElementBoxGridModeOn = !!(
		selectedPlacedElement &&
		elementEditMode === 'box' &&
		elementBoxEditId === selectedPlacedElement.id
	);
	const [trimlineEditSide, setTrimlineEditSide] = useState<'left' | 'right' | null>(null);
	const [trimlineAdjustments, setTrimlineAdjustments] = useState<{
		left: TrimlineAdjustments;
		right: TrimlineAdjustments;
	}>({
		left: { ...DEFAULT_TRIMLINE_ADJUSTMENTS },
		right: { ...DEFAULT_TRIMLINE_ADJUSTMENTS },
	});
	// Pending adjustments (visual only — drives handle display, committed on Save)
	const [pendingTrimlineAdj, setPendingTrimlineAdj] = useState<{
		left: TrimlineAdjustments;
		right: TrimlineAdjustments;
	}>({
		left: { ...DEFAULT_TRIMLINE_ADJUSTMENTS },
		right: { ...DEFAULT_TRIMLINE_ADJUSTMENTS },
	});
	const [trimlineHandleProfiles, setTrimlineHandleProfiles] = useState<{
		left: TrimlineHandleProfile | null;
		right: TrimlineHandleProfile | null;
	}>({ left: null, right: null });
	const [pendingTrimlineHandleProfiles, setPendingTrimlineHandleProfiles] = useState<{
		left: TrimlineHandleProfile | null;
		right: TrimlineHandleProfile | null;
	}>({ left: null, right: null });
	const pendingTrimlineAdjRef = useRef<{
		left: TrimlineAdjustments;
		right: TrimlineAdjustments;
	}>({
		left: { ...DEFAULT_TRIMLINE_ADJUSTMENTS },
		right: { ...DEFAULT_TRIMLINE_ADJUSTMENTS },
	});
	const pendingTrimlineHandleProfilesRef = useRef<{
		left: TrimlineHandleProfile | null;
		right: TrimlineHandleProfile | null;
	}>({ left: null, right: null });
	const [scanManualAlignments, setScanManualAlignments] = useState<{
		left: ScanManualAlignment | null;
		right: ScanManualAlignment | null;
	}>({ left: null, right: null });
	const [pendingScanManualAlignments, setPendingScanManualAlignments] = useState<{
		left: ScanManualAlignment | null;
		right: ScanManualAlignment | null;
	}>({ left: null, right: null });
	const pendingScanManualAlignmentsRef = useRef(pendingScanManualAlignments);
	const [scanRotateEditSide, setScanRotateEditSide] = useState<'left' | 'right' | null>(
		null,
	);
	const trimlinePanelSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [, forceTrimlinePanelSync] = useState(0);

	const scheduleElementTrimlinePanelSync = useCallback(() => {
		if (elementTrimlinePanelSyncRef.current) return;
		elementTrimlinePanelSyncRef.current = setTimeout(() => {
			elementTrimlinePanelSyncRef.current = null;
			forceElementTrimlinePanelSync((value) => value + 1);
		}, 90);
	}, []);

	const scheduleTrimlinePanelSync = useCallback(() => {
		if (trimlinePanelSyncRef.current) return;
		trimlinePanelSyncRef.current = setTimeout(() => {
			trimlinePanelSyncRef.current = null;
			forceTrimlinePanelSync((value) => value + 1);
		}, 90);
	}, []);
	const primeBottomTextLoading = useCallback(() => {
		setBottomTextLoadingBySide({
			left: Boolean(selectedBaseInsoleAssets.leftUrl),
			right: Boolean(selectedBaseInsoleAssets.rightUrl),
		});
	}, [selectedBaseInsoleAssets.leftUrl, selectedBaseInsoleAssets.rightUrl]);
	const resetBottomTextLoading = useCallback(() => {
		setBottomTextLoadingBySide({ left: false, right: false });
	}, []);
	const handleBottomTextLoadingChange = useCallback((payload: {
		side: 'left' | 'right';
		isLoading: boolean;
	}) => {
		setBottomTextLoadingBySide((prev) => (
			prev[payload.side] === payload.isLoading
				? prev
				: { ...prev, [payload.side]: payload.isLoading }
		));
	}, []);
	const handleBottomTextValidityChange = useCallback(
		(payload: { side: 'left' | 'right'; ok: boolean; reason?: string }) => {
			setBottomTextMeshOk((prev) =>
				prev[payload.side] === payload.ok ? prev : { ...prev, [payload.side]: payload.ok },
			);
			setBottomTextIssue((prev) => ({
				...prev,
				[payload.side]: payload.ok ? undefined : payload.reason,
			}));
		},
		[],
	);
	const handleTekstEditOpen = useCallback(() => {
		const baseline: SavedBottomTextState =
			savedBottomText ?? {
				text: 'PODO',
				sizeMm: 10,
				depthMm: 0.6,
			};
		textEditSessionRef.current = {
			savedBottomText: savedBottomText ? { ...savedBottomText } : null,
			draftBottomText: { ...baseline },
		};
		setDraftBottomText({ ...baseline });
		setDebouncedDraftBottomText({ ...baseline });
		setTextEditorOpen(true);
		setLeftPanelTab('view');
		setViewerViewPreset('bottom');
	}, [savedBottomText]);
	const handleCancelTextEdit = useCallback(() => {
		const snap = textEditSessionRef.current;
		if (snap) {
			setSavedBottomText(snap.savedBottomText);
			setDraftBottomText(snap.draftBottomText);
			setDebouncedDraftBottomText(snap.draftBottomText);
		}
		setTextEditorOpen(false);
	}, []);
	const handleSaveTextEdit = useCallback(() => {
		const trimmed = draftBottomText.text.trim();
		const next: SavedBottomTextState = {
			text: trimmed,
			sizeMm: draftBottomText.sizeMm,
			depthMm: draftBottomText.depthMm,
		};
		setSavedBottomText(next);
		setDraftBottomText(next);
		setDebouncedDraftBottomText(next);
		setTextEditorOpen(false);
	}, [draftBottomText]);
	const toggleCorrection = useCallback((key: CorrectionKey) => {
		setActiveCorrections((prev) => {
			const has = prev.includes(key);
			const next = has ? prev.filter((k) => k !== key) : [...prev, key];
			if (!has && key === 'tekst') {
				const initialBottomText: SavedBottomTextState =
					savedBottomText ?? {
						text: 'PODO',
						sizeMm: 10,
						depthMm: 0.6,
					};
				textEditSessionRef.current = {
					savedBottomText: savedBottomText ? { ...savedBottomText } : null,
					draftBottomText: { ...initialBottomText },
				};
				primeBottomTextLoading();
				setLeftPanelTab('view');
				setViewerViewPreset('bottom');
				setDraftBottomText(initialBottomText);
				setDebouncedDraftBottomText(initialBottomText);
				setTextEditorOpen(true);
			}
			return next;
		});
	}, [primeBottomTextLoading, savedBottomText]);

	useEffect(() => {
		pendingTrimlineAdjRef.current = pendingTrimlineAdj;
	}, [pendingTrimlineAdj]);

	useEffect(() => {
		pendingTrimlineHandleProfilesRef.current = pendingTrimlineHandleProfiles;
	}, [pendingTrimlineHandleProfiles]);

	useEffect(() => {
		pendingScanManualAlignmentsRef.current = pendingScanManualAlignments;
	}, [pendingScanManualAlignments]);

	const editorTrimlineHandleProfiles = useMemo(() => {
		if (!trimlineEditSide) return trimlineHandleProfiles;
		return {
			...trimlineHandleProfiles,
			[trimlineEditSide]: pendingTrimlineHandleProfiles[trimlineEditSide],
		};
	}, [trimlineEditSide, trimlineHandleProfiles, pendingTrimlineHandleProfiles]);

	useEffect(() => {
		return () => {
			if (trimlinePanelSyncRef.current) clearTimeout(trimlinePanelSyncRef.current);
			if (elementTrimlinePanelSyncRef.current) clearTimeout(elementTrimlinePanelSyncRef.current);
		};
	}, []);

	const bottomTextOverlay: BottomTextOverlay | undefined = useMemo(() => {
		if (!activeCorrections.includes('tekst')) return undefined;
		if (textEditorOpen) {
			if (!debouncedDraftBottomText.text.trim()) return undefined;
			return {
				enabled: true,
				text: debouncedDraftBottomText.text,
				sizeMm: debouncedDraftBottomText.sizeMm,
				depthMm: debouncedDraftBottomText.depthMm,
				orientation: 'vertical',
			};
		}
		if (!savedBottomText || !savedBottomText.text.trim()) return undefined;
		return {
			enabled: true,
			text: savedBottomText.text,
			sizeMm: savedBottomText.sizeMm,
			depthMm: savedBottomText.depthMm,
			orientation: 'vertical',
		};
	}, [activeCorrections, textEditorOpen, debouncedDraftBottomText, savedBottomText]);

	useEffect(() => {
		if (!(textEditorOpen && activeCorrections.includes('tekst'))) return;
		setBottomTextMeshOk({
			left: !selectedBaseInsoleAssets.leftUrl,
			right: !selectedBaseInsoleAssets.rightUrl,
		});
		setBottomTextIssue({});
	}, [
		textEditorOpen,
		activeCorrections,
		selectedBaseInsoleAssets.leftUrl,
		selectedBaseInsoleAssets.rightUrl,
	]);

	const textEditSaveDisabled =
		(Boolean(selectedBaseInsoleAssets.leftUrl) && !bottomTextMeshOk.left) ||
		(Boolean(selectedBaseInsoleAssets.rightUrl) && !bottomTextMeshOk.right);

	const textEditWarning = useMemo(() => {
		const parts: string[] = [];
		const label = { left: 'Links', right: 'Rechts' } as const;
		(['left', 'right'] as const).forEach((side) => {
			const r = bottomTextIssue[side];
			if (!r) return;
			if (r === 'font_loading') parts.push(`${label[side]}: lettertype laden…`);
			else if (r === 'csg_failed') parts.push(`${label[side]}: gravering mislukt`);
			else parts.push(`${label[side]}: geometrie niet gevalideerd`);
		});
		return parts.length ? parts.join(' ') : null;
	}, [bottomTextIssue]);

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedDraftBottomText(draftBottomText);
		}, 250);
		return () => clearTimeout(timer);
	}, [draftBottomText]);

	useEffect(() => {
		if (activeCorrections.includes('tekst')) return;
		resetBottomTextLoading();
	}, [activeCorrections, resetBottomTextLoading]);

	const isBottomTextLoading = activeCorrections.includes('tekst') && (
		bottomTextLoadingBySide.left || bottomTextLoadingBySide.right
	);

	const mirrorCorrectionsToOtherSide = useCallback(
		(from: 'left' | 'right') => {
			if (!corrections) return;
			const to: 'left' | 'right' = from === 'left' ? 'right' : 'left';
			setCorrections((prev) => mirrorSideValues(prev, from, to));
			setParameters({
				...parameters,
				general: mirrorSideValues(generalNormalized, from, to),
			});
			setSoleWidthOverrideRatio((prev) => mirrorSideValues(prev, from, to));
			setTrimlineAdjustments((prev) => mirrorSideValues(prev, from, to));
			setPendingTrimlineAdj((prev) => mirrorSideValues(prev, from, to));
			pendingTrimlineAdjRef.current = mirrorSideValues(pendingTrimlineAdjRef.current, from, to);
			setTrimlineHandleProfiles((prev) => ({
				...prev,
				[to]: mirrorTrimlineHandleProfileAcrossWidth(prev[from]),
			}));
			setPendingTrimlineHandleProfiles((prev) => ({
				...prev,
				[to]: mirrorTrimlineHandleProfileAcrossWidth(prev[from]),
			}));
			pendingTrimlineHandleProfilesRef.current = {
				...pendingTrimlineHandleProfilesRef.current,
				[to]: mirrorTrimlineHandleProfileAcrossWidth(pendingTrimlineHandleProfilesRef.current[from]),
			};
			setBoxGridPoints((prev) => ({
				...prev,
				[to]: mirrorBoxGridOffsetsAcrossWidth(prev[from]),
			}));
			pendingBoxGridDraftRef.current = {
				...pendingBoxGridDraftRef.current,
				[to]: mirrorBoxGridOffsetsAcrossWidth(pendingBoxGridDraftRef.current[from] ?? boxGridPoints[from]),
			};
			setBoxEnabled((prev) => ({ ...prev, [to]: prev[from] }));
			if (from === 'left') {
				setStep3Right(structuredClone(step3Left));
			} else {
				setStep3Left(structuredClone(step3Right));
			}
			useElementsStore.setState((state) => {
				const mirrored = state.placedElements
					.filter((element) => element.side === from)
					.map((element, index) => ({
						...mirrorPlacedElementToSide(element, to),
						id: `${element.id}_mirror_${to}_${Date.now()}_${index}`,
					}));
				return {
					placedElements: [
						...state.placedElements.filter((element) => element.side !== to),
						...mirrored,
					],
					selectedElementId: null,
				};
			});
		},
		[boxGridPoints, generalNormalized, parameters, setParameters, step3Left, step3Right]
	);

	const exitGridMode = useCallback(() => {
		if (!selectedInsoleSide) return;
		setBoxEnabled((prev) => ({ ...prev, [selectedInsoleSide]: false }));
	}, [selectedInsoleSide]);

	/** "Opslaan" — commit the current box-grid draft and exit */
	const handleBoxGridSaveAndExit = useCallback(() => {
		if (selectedInsoleSide) {
			setBoxGridPoints((prev) => ({
				...prev,
				[selectedInsoleSide]: cloneBoxGridOffsets(pendingBoxGridDraftRef.current[selectedInsoleSide]),
			}));
		}
		exitGridMode();
	}, [exitGridMode, selectedInsoleSide]);

	/** "Annuleren" — revert boxGridPoints to the snapshot taken when grid edit started, then exit */
	const handleBoxGridCancelAndExit = useCallback(() => {
		if (selectedInsoleSide) {
			pendingBoxGridDraftRef.current = {
				...pendingBoxGridDraftRef.current,
				[selectedInsoleSide]: cloneBoxGridOffsets(boxGridSnapshotRef.current),
			};
			setBoxGridPoints((prev) => ({
				...prev,
				[selectedInsoleSide]: boxGridSnapshotRef.current,
			}));
		}
		exitGridMode();
	}, [selectedInsoleSide, exitGridMode]);

	/** Called during box-grid edit — stores the latest draft without forcing a React re-render */
	const handleBoxGridSave = useCallback((side: 'left' | 'right', offsets: BoxGridSavedOffsets) => {
		pendingBoxGridDraftRef.current = {
			...pendingBoxGridDraftRef.current,
			[side]: cloneBoxGridOffsets(offsets),
		};
	}, []);

	const handleElementBoxGridSave = useCallback((offsets: BoxGridSavedOffsets) => {
		pendingElementBoxOffsetsRef.current = cloneBoxGridOffsets(offsets);
	}, []);

	const handleElementBoxSaveAndExit = useCallback(() => {
		if (selectedPlacedElement && elementBoxEditId === selectedPlacedElement.id) {
			updatePlacedElement(selectedPlacedElement.id, {
				boxGridOffsets: cloneBoxGridOffsets(pendingElementBoxOffsetsRef.current),
			});
		}
		setElementBoxEditId(null);
		pendingElementBoxOffsetsRef.current = null;
		setPendingElementBoxOffsets(null);
		elementBoxSnapshotRef.current = null;
		setElementEditMode(null);
	}, [selectedPlacedElement, elementBoxEditId, updatePlacedElement]);

	const handleElementBoxCancelAndExit = useCallback(() => {
		const restored = cloneBoxGridOffsets(elementBoxSnapshotRef.current);
		pendingElementBoxOffsetsRef.current = restored;
		setPendingElementBoxOffsets(restored);
		setElementBoxEditId(null);
		elementBoxSnapshotRef.current = null;
		setElementEditMode(null);
	}, []);

	const handleToggleBoxMode = useCallback((side: 'left' | 'right') => {
		setSelectedInsoleSide(side);
		// Snapshot current offsets so "Annuleren" can revert
		setBoxGridPoints((prev) => {
			boxGridSnapshotRef.current = prev[side];
			pendingBoxGridDraftRef.current = {
				...pendingBoxGridDraftRef.current,
				[side]: cloneBoxGridOffsets(prev[side]),
			};
			return prev;
		});
		setBoxEnabled((prev) => {
			const nextActive = !prev[side];
			return {
				left: side === 'left' ? nextActive : false,
				right: side === 'right' ? nextActive : false,
			};
		});
	}, []);

	// ── Client settings getter — supplies all local useState values to autosave ──
	useEffect(() => {
		clientSettingsGetterRef.current = () => ({
			productionMethod,
			selectedPairId,
			selectedLeftScanId,
			selectedRightScanId,
			selectedBaseSTL,
			corrections,
			activeCorrections,
			savedBottomText,
			step3Left,
			step3Right,
			printerSettings,
			boxEnabled,
			boxGridPoints,
			trimlineAdjustments,
			trimlineHandleProfiles,
			scanManualAlignments,
			activeDesignStep,
			elementsModalSide,
			workflowStep,
			scansActive,
			showOverlays,
			hardnessProfiles,
		});
	}, [
		productionMethod,
		selectedPairId,
		selectedLeftScanId,
		selectedRightScanId,
		selectedBaseSTL,
		corrections,
		activeCorrections,
		savedBottomText,
		step3Left,
		step3Right,
		printerSettings,
		boxEnabled,
		boxGridPoints,
		trimlineAdjustments,
		trimlineHandleProfiles,
		scanManualAlignments,
		activeDesignStep,
		elementsModalSide,
		workflowStep,
		scansActive,
		showOverlays,
		hardnessProfiles,
	]);

	// ── Hydrate local state from saved design on mount ──
	useEffect(() => {
		if (initialDesign && !hasHydratedRef.current) {
			hasHydratedRef.current = true;
			const cs = hydrateFromDesign(initialDesign);
			if (cs && typeof cs === 'object') {
				// Restore all persisted local state
				if (cs.productionMethod !== undefined) setProductionMethod(cs.productionMethod as string);
				if (cs.selectedPairId !== undefined) setSelectedPairId(cs.selectedPairId as string | null);
				if (cs.selectedLeftScanId !== undefined) setSelectedLeftScanId(cs.selectedLeftScanId as string | null);
				if (cs.selectedRightScanId !== undefined) setSelectedRightScanId(cs.selectedRightScanId as string | null);
				if (cs.selectedBaseSTL !== undefined) setSelectedBaseSTL(cs.selectedBaseSTL as string | null);
				if (cs.corrections !== undefined) setCorrections(cs.corrections as OntwerpCorrections);
				if (cs.activeCorrections !== undefined) setActiveCorrections(cs.activeCorrections as CorrectionKey[]);
				if (cs.savedBottomText !== undefined) {
					const sb = cs.savedBottomText as Partial<SavedBottomTextState> | null;
					if (sb && typeof sb === 'object') {
						setSavedBottomText({
							text: typeof sb.text === 'string' ? sb.text : '',
							sizeMm: typeof sb.sizeMm === 'number' && Number.isFinite(sb.sizeMm) ? sb.sizeMm : 10,
							depthMm:
								typeof sb.depthMm === 'number' && Number.isFinite(sb.depthMm) ? sb.depthMm : 0.6,
						});
					} else {
						setSavedBottomText(null);
					}
				}
				if (cs.step3Left !== undefined) setStep3Left(cs.step3Left as typeof step3Left);
				if (cs.step3Right !== undefined) setStep3Right(cs.step3Right as typeof step3Right);
				if (cs.printerSettings !== undefined) setPrinterSettings(cs.printerSettings as PrinterSettings);
				if (cs.boxEnabled !== undefined) setBoxEnabled(cs.boxEnabled as typeof boxEnabled);
				if (cs.boxGridPoints !== undefined) setBoxGridPoints(cs.boxGridPoints as typeof boxGridPoints);
				if (cs.trimlineAdjustments !== undefined) setTrimlineAdjustments(cs.trimlineAdjustments as typeof trimlineAdjustments);
				if (cs.trimlineHandleProfiles !== undefined) setTrimlineHandleProfiles(cs.trimlineHandleProfiles as typeof trimlineHandleProfiles);
				if (cs.scanManualAlignments !== undefined) {
					setScanManualAlignments(cs.scanManualAlignments as typeof scanManualAlignments);
					setPendingScanManualAlignments(cs.scanManualAlignments as typeof pendingScanManualAlignments);
				}
				if (cs.activeDesignStep !== undefined) setActiveDesignStep(cs.activeDesignStep as number);
				if (cs.elementsModalSide !== undefined) setElementsModalSide(cs.elementsModalSide as 'left' | 'right');
				if (cs.workflowStep !== undefined) setWorkflowStep(cs.workflowStep as WorkflowStep);
				if (cs.scansActive !== undefined) setScansActive(cs.scansActive as boolean);
				if (cs.showOverlays !== undefined) setShowOverlays(cs.showOverlays as boolean);
				if (cs.hardnessProfiles !== undefined) setHardnessProfiles(cs.hardnessProfiles as Record<HardnessKey, { infillPercent: number }> | null);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialDesign]);

	// ── Trigger debounced autosave when local state changes ──
	const hydrationDoneRef = useRef(false);
	useEffect(() => {
		// Skip the first render cycle after hydration to avoid saving hydrated state back
		if (!hasHydratedRef.current) return;
		if (!hydrationDoneRef.current) {
			hydrationDoneRef.current = true;
			return;
		}
		debouncedSave();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		productionMethod, selectedPairId, selectedLeftScanId, selectedRightScanId,
		selectedBaseSTL, corrections, activeCorrections, savedBottomText,
		step3Left, step3Right, printerSettings,
		boxEnabled, boxGridPoints, trimlineAdjustments, trimlineHandleProfiles, scanManualAlignments, activeDesignStep, elementsModalSide,
		workflowStep, scansActive, showOverlays, hardnessProfiles,
	]);

	// Normalize scans: footSide from DB is uppercase ('LEFT'/'RIGHT'), normalize to lowercase
	const scans = useMemo(
		() =>
			(projectScans ?? []).map((s) => ({
				...s,
				footSide: s.footSide.toLowerCase(),
			})),
		[projectScans]
	);
	const scanById = useMemo(() => {
		const map = new Map<string, (typeof scans)[number]>();
		for (const scan of scans) {
			map.set(scan.id, scan);
		}
		return map;
	}, [scans]);

	// Group scans into pairs by pairId
	const scanPairs = useMemo(() => {
		const map = new Map<string, { pairId: string; name: string; left?: typeof scans[number]; right?: typeof scans[number] }>();
		for (const scan of scans) {
			const existing = map.get(scan.pairId);
			if (existing) {
				if (scan.footSide === 'left') existing.left = scan;
				else existing.right = scan;
			} else {
				map.set(scan.pairId, {
					pairId: scan.pairId,
					name: scan.name || 'Naamloos',
					left: scan.footSide === 'left' ? scan : undefined,
					right: scan.footSide === 'right' ? scan : undefined,
				});
			}
		}
		return Array.from(map.values());
	}, [scans]);

	// Auto-select first complete pair if none selected
	const activePair = useMemo(() => {
		if (selectedPairId) {
			return scanPairs.find(p => p.pairId === selectedPairId) ?? null;
		}
		// Default to first pair with both sides
		return scanPairs.find(p => p.left && p.right) ?? scanPairs[0] ?? null;
	}, [scanPairs, selectedPairId]);

	const selectedLeftScan = selectedLeftScanId
		? scanById.get(selectedLeftScanId) ?? null
		: null;
	const selectedRightScan = selectedRightScanId
		? scanById.get(selectedRightScanId) ?? null
		: null;
	const leftScan =
		selectedLeftScan ??
		activePair?.left ??
		null;
	const rightScan =
		selectedRightScan ??
		activePair?.right ??
		null;

	// Scan STL URLs — no demo fallback, only real backend scans
	const leftStlUrl = leftScan?.stlUrl ?? '';
	const rightStlUrl = rightScan?.stlUrl ?? '';

	// ── Ensure scan overlays are shown when scans are active and URLs are available ──
	// This covers the case where showOverlays was not yet persisted in older saves,
	// and ensures overlays always appear when we have active scans.
	useEffect(() => {
		if (scansActive && (leftStlUrl || rightStlUrl) && !showOverlays) {
			setShowOverlays(true);
		}
	}, [scansActive, leftStlUrl, rightStlUrl, showOverlays]);

	const currentPointStep = POINT_SEQUENCE[pointStepIndex];

	const setThreePointLandmarks = useDesignStore((state) => state.setThreePointLandmarks);
	const setDerivedLandmarks = useDesignStore((state) => state.setDerivedLandmarks);
	const setCompleteLandmarks = useDesignStore((state) => state.setCompleteLandmarks);
	const setFootGeometry = useDesignStore((state) => state.setFootGeometry);
	const setPlantarData = useDesignStore((state) => state.setPlantarData);
	const setIsGeneratingInsole = useDesignStore((state) => state.setIsGeneratingInsole);
	const clearLandmarkPipeline = useDesignStore((state) => state.clearLandmarkPipeline);

	const startPointPicking = useCallback(() => {
		setRightPointSelections({});
		setLeftPointSelections({});
		setPointStepIndex(0);
		setPointPickFoot('right');
		setPlanWorldToMm(1);
		setSoleWidthOverrideRatio({ left: null, right: null });
		rightFittingRef.current = null;
		setShowOverlays(false);
		clearLandmarkPipeline();
		setWorkflowStep('point-pick');
	}, [clearLandmarkPipeline]);

	/**
	 * Automatically detect landmarks on both feet, compute geometry, seed parameters,
	 * and skip the manual point-pick step entirely.
	 * Falls back to manual point-picking if auto-detection confidence is too low.
	 */
	const autoDetectAndApply = useCallback(async (
		rightUrl: string,
		leftUrl: string
	) => {
		setAutoDetectStatus('detecting');
		setAutoDetectMessage('Landmarks automatisch detecteren...');
		clearLandmarkPipeline();

		try {
			// Load both foot scan STL files
			setAutoDetectMessage('Scans laden...');
			const [rightGeom, leftGeom] = await Promise.all([
				loadStlGeometry(rightUrl),
				loadStlGeometry(leftUrl),
			]);

			// Auto-detect landmarks on right foot
			setAutoDetectMessage('Rechtervoet analyseren...');
			const rightResult = detectLandmarksClassical(rightGeom, rightUrl);
			const rightValidation = validateDetectedLandmarks(rightResult);
			rightResult.warnings.push(...rightValidation);

			// Auto-detect landmarks on left foot
			setAutoDetectMessage('Linkervoet analyseren...');
			const leftResult = detectLandmarksClassical(leftGeom, leftUrl);
			const leftValidation = validateDetectedLandmarks(leftResult);
			leftResult.warnings.push(...leftValidation);

			if (process.env.NODE_ENV === 'development') {
				console.log(
					'[Auto-detect] Right confidence:', rightResult.overallConfidence.toFixed(2),
					'Left confidence:', leftResult.overallConfidence.toFixed(2),
					'\n  Right per-landmark:', Object.entries(rightResult.confidence).map(([k, v]) => `${k}: ${((v as number) * 100).toFixed(0)}%`).join(', '),
					'\n  Left per-landmark:', Object.entries(leftResult.confidence).map(([k, v]) => `${k}: ${((v as number) * 100).toFixed(0)}%`).join(', '),
					'\n  Right warnings:', rightResult.warnings,
					'\n  Left warnings:', leftResult.warnings,
				);
			}

			// Check if both have sufficient confidence
			const threshold = LANDMARK_CONFIDENCE_THRESHOLD;
			if (
				rightResult.overallConfidence < threshold ||
				leftResult.overallConfidence < threshold
			) {
				if (process.env.NODE_ENV === 'development') {
					console.log(`[Auto-detect] Low confidence R: ${(rightResult.overallConfidence * 100).toFixed(0)}%, L: ${(leftResult.overallConfidence * 100).toFixed(0)}%, falling back to manual`);
				}
				setAutoDetectStatus('failed');
				setAutoDetectMessage(
					`Auto-detectie: R ${(rightResult.overallConfidence * 100).toFixed(0)}% · L ${(leftResult.overallConfidence * 100).toFixed(0)}% (drempel: ${(threshold * 100).toFixed(0)}%). Handmatig kiezen.`
				);
				// Fall back to manual point-pick
				startPointPicking();
				return;
			}

			// Both feet have good confidence — compute everything
			setAutoDetectMessage('Voetgeometrie berekenen...');
			setIsFitting(true);
			setIsGeneratingInsole(true);

			// ── Right foot computation ──
			const { footGeometry: rightFg, derived: rightDerived, complete: rightComplete } =
				computeFootGeometryFrom3Points(rightResult.landmarks, rightGeom, rightUrl);

			setThreePointLandmarks(rightResult.landmarks);
			setFootGeometry(rightFg);
			setDerivedLandmarks(rightDerived);
			setCompleteLandmarks(rightComplete);

			const rightLegacy = completeLandmarksToLegacy(rightComplete);
			const plan = buildInsolePlan(rightLegacy);
			setDesignPlan({ plan, points: rightLegacy });
			setPlanWorldToMm(1); // STL loaded at raw mm scale

			const rightPlantar = extractPlantarSurface(rightGeom, rightFg, 1.0);
			setPlantarData(rightPlantar);

			const rightSeeds = deriveSeedFromFootGeometry(
				rightFg,
				1,
				generalNormalized.baseInsoleType
			);
			const rightArchProfile = deriveArchPeakProfileFromPlantarData(rightPlantar, 1, 'Right/auto');
			const rightPlantarArchHeightMm =
				rightArchProfile?.archHeightMm ?? rightSeeds.rimHeightMm;
			const rightApexShiftMm = rightArchProfile?.apexShiftMm ?? 0;
			const rightMeshShoeSize = estimateEuShoeSizeFromGeometry(rightGeom, 1);

			// ── Left foot computation ──
			const { footGeometry: leftFg } =
				computeFootGeometryFrom3Points(leftResult.landmarks, leftGeom, leftUrl);
			const leftPlantar = extractPlantarSurface(leftGeom, leftFg, 1.0);

			const leftSeeds = deriveSeedFromFootGeometry(
				leftFg,
				1,
				generalNormalized.baseInsoleType
			);
			const leftArchProfile = deriveArchPeakProfileFromPlantarData(leftPlantar, 1, 'Left/auto');
			const leftPlantarArchHeightMm =
				leftArchProfile?.archHeightMm ?? leftSeeds.rimHeightMm;
			const leftApexShiftMm = leftArchProfile?.apexShiftMm ?? 0;
			const leftMeshShoeSize = estimateEuShoeSizeFromGeometry(leftGeom, 1);

			const rightCompensated = compensateArchHeight(rightPlantarArchHeightMm);
			const leftCompensated = compensateArchHeight(leftPlantarArchHeightMm);

			if (process.env.NODE_ENV === 'development') {
				console.log('[Arch height seeding]',
					`\n  Right: raw=${rightPlantarArchHeightMm}mm → compensated=${rightCompensated}mm, apexShift=${rightApexShiftMm}mm, groundNormal=[${rightFg.groundNormal.map(n => n.toFixed(3)).join(',')}]`,
					`\n  Left:  raw=${leftPlantarArchHeightMm}mm → compensated=${leftCompensated}mm, apexShift=${leftApexShiftMm}mm, groundNormal=[${leftFg.groundNormal.map(n => n.toFixed(3)).join(',')}]`,
				);
			}

			// ── Seed parameters from both feet ──
			setParameters({
				...parameters,
				general: {
					...generalNormalized,
					shoeSize: {
						left: leftMeshShoeSize,
						right: rightMeshShoeSize,
					},
					seededShoeSize: {
						left: leftMeshShoeSize,
						right: rightMeshShoeSize,
					},
					maxInsoleHeightMm: {
						left: leftCompensated,
						right: rightCompensated,
					},
				},
			});

			setCorrections({
				...createDefaultOntwerpCorrections(),
				apexMiddenvoet: {
					left: leftApexShiftMm,
					right: rightApexShiftMm,
				},
			});

			setSoleWidthOverrideRatio({
				left: getSoleWidthRatio(Number(leftSeeds.forefootWidthMm.toFixed(1)), effectiveTargetForefootWidthMm.left),
				right: getSoleWidthRatio(Number(rightSeeds.forefootWidthMm.toFixed(1)), effectiveTargetForefootWidthMm.right),
			});

			// ── Transition to design step ──
			setScansActive(true);
			setShowOverlays(true);
			setWorkflowStep('base');
			setActiveDesignStep(1);
			setAutoDetectStatus('success');
			setAutoDetectMessage(
				`Landmarks automatisch gedetecteerd (R: ${(rightResult.overallConfidence * 100).toFixed(0)}%, L: ${(leftResult.overallConfidence * 100).toFixed(0)}%)`
			);

			setTimeout(() => {
				setIsFitting(false);
				setIsGeneratingInsole(false);
			}, 800);

		} catch (err) {
			console.error('[Auto-detect] Failed:', err);
			setAutoDetectStatus('failed');
			setAutoDetectMessage(
				`Automatische detectie mislukt: ${err instanceof Error ? err.message : 'onbekende fout'}. Kies handmatig.`
			);
			// Fall back to manual
			startPointPicking();
		}
	}, [
		clearLandmarkPipeline, startPointPicking, setThreePointLandmarks, setFootGeometry,
		setDerivedLandmarks, setCompleteLandmarks, setPlantarData, setIsGeneratingInsole,
		setParameters, parameters, generalNormalized,
	]);

	const handleCancelPointPick = useCallback(() => {
		setRightPointSelections({});
		setLeftPointSelections({});
		setPointStepIndex(0);
		setPointPickFoot('right');
		setPlanWorldToMm(1);
		setSoleWidthOverrideRatio({ left: null, right: null });
		rightFittingRef.current = null;
		setWorkflowStep('base');
	}, []);

	/** Undo the last picked landmark point */
	const handleUndoLastPoint = useCallback(() => {
		if (pointStepIndex <= 0) {
			// At start of left foot — go back to right foot's last step
			if (pointPickFoot === 'left') {
				setPointPickFoot('right');
				const lastStep = POINT_SEQUENCE[POINT_SEQUENCE.length - 1];
				setRightPointSelections((prev) => {
					const next = { ...prev };
					delete next[lastStep.id];
					return next;
				});
				setPointStepIndex(POINT_SEQUENCE.length - 1);
				rightFittingRef.current = null;
			}
			return;
		}
		const prevStep = POINT_SEQUENCE[pointStepIndex - 1];
		if (!prevStep) return;
		const setSelections = pointPickFoot === 'right' ? setRightPointSelections : setLeftPointSelections;
		setSelections((prev) => {
			const next = { ...prev };
			delete next[prevStep.id];
			return next;
		});
		setPointStepIndex((prev) => prev - 1);
	}, [pointStepIndex, pointPickFoot]);

	/** Reset all picked points and restart */
	const handleResetPoints = useCallback(() => {
		setRightPointSelections({});
		setLeftPointSelections({});
		setPointStepIndex(0);
		setPointPickFoot('right');
		setPlanWorldToMm(1);
		setSoleWidthOverrideRatio({ left: null, right: null });
		rightFittingRef.current = null;
	}, []);

	const handlePointPicked = useCallback(
		(point: [number, number, number]) => {
			if (workflowStep !== 'point-pick') return;
			const step = POINT_SEQUENCE[pointStepIndex];
			if (!step) return;

			const isRightFoot = pointPickFoot === 'right';
			const currentSelections = isRightFoot ? rightPointSelections : leftPointSelections;
			const setCurrentSelections = isRightFoot ? setRightPointSelections : setLeftPointSelections;

			const updatedSelections = {
				...currentSelections,
				[step.id]: point,
			};
			setCurrentSelections(updatedSelections);

			const isLastPointForFoot = pointStepIndex >= POINT_SEQUENCE.length - 1;

			if (isLastPointForFoot && isRightFoot) {
				// ── Right foot done — compute fitting, then switch to left foot ──
				const geom = viewerRef.current?.getRightGeometry?.();
				const mmToWorld = viewerRef.current?.getRightMmToWorld?.() ?? 1;
				const worldToMm = 1 / Math.max(1e-6, mmToWorld);
				if (geom) {
					try {
						const meta5 = updatedSelections.meta5;
						const meta1 = updatedSelections.meta1;
						const heel = updatedSelections.heel;
						if (!meta1 || !meta5 || !heel) {
							return;
						}
						const threePoints: ThreePointLandmarks = {
							meta5,
							meta1,
							heel,
						};
						setThreePointLandmarks(threePoints);

						const { footGeometry: fg, derived, complete } =
							computeFootGeometryFrom3Points(threePoints, geom);
						setFootGeometry(fg);
						setDerivedLandmarks(derived);
						setCompleteLandmarks(complete);

						const legacyPoints = completeLandmarksToLegacy(complete);
						const plan = buildInsolePlan(legacyPoints);
						setDesignPlan({ plan, points: legacyPoints });
						setPlanWorldToMm(worldToMm);

						const plantar = extractPlantarSurface(geom, fg, 1.0 * mmToWorld);
						setPlantarData(plantar);
						const archProfile = deriveArchPeakProfileFromPlantarData(plantar, worldToMm, 'Right/pick');
						const scanArchHeightMm =
							archProfile?.archHeightMm ??
							normalizeScanArchHeightMm(fg.archHeight * worldToMm);

						const seeds = deriveSeedFromPickedPoints(
							updatedSelections,
							scanArchHeightMm,
							worldToMm
						);
						const meshShoeSizeEu = estimateEuShoeSizeFromGeometry(geom, worldToMm);
						rightFittingRef.current = {
							archHeight: compensateArchHeight(scanArchHeightMm),
							scanArchHeightMm: compensateArchHeight(scanArchHeightMm),
							archApexShiftMm: archProfile?.apexShiftMm ?? 0,
							cupHeight: roundStep(clamp(seeds.cupMm, 2, 12), 0.5),
							shoeSize: meshShoeSizeEu,
							pronation: roundStep(clamp(seeds.pronationMm, 0, 6), 0.5),
							supination: roundStep(clamp(seeds.supinationMm, 0, 6), 0.5),
							forefootWidthMm: Number(
								getBaseInsoleWidthMmForEuSize(
									meshShoeSizeEu,
									generalNormalized.baseInsoleType
								).toFixed(1)
							),
						};
					} catch (err) {
						console.error('Right foot fitting failed:', err);
					}
				}

				// Switch to left foot
				setPointStepIndex(0);
				setPointPickFoot('left');
			} else if (isLastPointForFoot && !isRightFoot) {
				// ── Left foot done — fit left foot, apply corrections from both ──
				setIsFitting(true);
				setIsGeneratingInsole(true);

				let leftArchMm = generalNormalized.maxInsoleHeightMm.left;
				let leftCupMm = 0;
				let leftShoeSize = generalNormalized.shoeSize.left;
				let leftPronation = 0;
				let leftSupination = 0;
				let leftForefootWidthMm = effectiveTargetForefootWidthMm.left;
				let leftApexShiftMm = 0;

				const leftGeom = viewerRef.current?.getRightGeometry?.();
				const leftMmToWorld = viewerRef.current?.getRightMmToWorld?.() ?? 1;
				const leftWorldToMm = 1 / Math.max(1e-6, leftMmToWorld);
				if (leftGeom) {
					try {
						const meta5 = updatedSelections.meta5;
						const meta1 = updatedSelections.meta1;
						const heel = updatedSelections.heel;
						if (!meta1 || !meta5 || !heel) {
							return;
						}
						const leftThreePoints: ThreePointLandmarks = {
							meta5,
							meta1,
							heel,
						};
						const { footGeometry: fg } =
							computeFootGeometryFrom3Points(leftThreePoints, leftGeom);
						const leftPlantar = extractPlantarSurface(leftGeom, fg, 1.0 * leftMmToWorld);
						const leftArchProfile = deriveArchPeakProfileFromPlantarData(leftPlantar, leftWorldToMm, 'Left/pick');
						const seeds = deriveSeedFromPickedPoints(
							updatedSelections,
							leftArchProfile?.archHeightMm ??
							normalizeScanArchHeightMm(fg.archHeight * leftWorldToMm),
							leftWorldToMm
						);
						const leftScanArchMm =
							leftArchProfile?.archHeightMm ??
							normalizeScanArchHeightMm(fg.archHeight * leftWorldToMm);
						leftApexShiftMm = leftArchProfile?.apexShiftMm ?? 0;
						const meshShoeSizeEu = estimateEuShoeSizeFromGeometry(leftGeom, leftWorldToMm);
						leftArchMm = compensateArchHeight(leftScanArchMm);
						leftCupMm = roundStep(clamp(seeds.cupMm, 2, 12), 0.5);
						leftShoeSize = meshShoeSizeEu;
						leftPronation = roundStep(clamp(seeds.pronationMm, 0, 6), 0.5);
						leftSupination = roundStep(clamp(seeds.supinationMm, 0, 6), 0.5);
						leftForefootWidthMm = Number(
							getBaseInsoleWidthMmForEuSize(
								meshShoeSizeEu,
								generalNormalized.baseInsoleType
							).toFixed(1)
						);
					} catch (err) {
						console.error('Left foot fitting failed:', err);
					}
				}

				// Gather right foot fitting from earlier
				const rightFitting = rightFittingRef.current;
				const rightArchMm = rightFitting?.scanArchHeightMm ?? rightFitting?.archHeight ?? generalNormalized.maxInsoleHeightMm.right;
				const rightApexShiftMm = rightFitting?.archApexShiftMm ?? 0;
				const rightCupMm = rightFitting?.cupHeight ?? 0;
				const rightShoeSize = rightFitting?.shoeSize ?? generalNormalized.shoeSize.right;
				const rightPronation = rightFitting?.pronation ?? 0;
				const rightSupination = rightFitting?.supination ?? 0;
				const rightForefootWidthMm =
					rightFitting?.forefootWidthMm ?? effectiveTargetForefootWidthMm.right;

				// Seed parameters from both feet
				setParameters({
					...parameters,
					general: {
						...generalNormalized,
						shoeSize: {
							left: leftShoeSize,
							right: rightShoeSize,
						},
						seededShoeSize: {
							left: leftShoeSize,
							right: rightShoeSize,
						},
						maxInsoleHeightMm: {
							left: leftArchMm,
							right: rightArchMm,
						},
					},
				});

				setCorrections({
					...createDefaultOntwerpCorrections(),
					apexMiddenvoet: {
						left: leftApexShiftMm,
						right: rightApexShiftMm,
					},
				});

				setSoleWidthOverrideRatio({
					left: getSoleWidthRatio(leftForefootWidthMm, effectiveTargetForefootWidthMm.left),
					right: getSoleWidthRatio(rightForefootWidthMm, effectiveTargetForefootWidthMm.right),
				});

				setScansActive(true);
				setShowOverlays(true);
				setWorkflowStep('base');
				setActiveDesignStep(1);
				setTimeout(() => {
					setIsFitting(false);
					setIsGeneratingInsole(false);
				}, 1200);
			} else {
				setPointStepIndex((prev) => prev + 1);
			}
		},
		[workflowStep, pointStepIndex, pointPickFoot, rightPointSelections, leftPointSelections, setThreePointLandmarks, setFootGeometry, setDerivedLandmarks, setCompleteLandmarks, setPlantarData, setIsGeneratingInsole, setParameters, parameters, generalNormalized, effectiveTargetForefootWidthMm]
	);

	const patientName = project?.patient
		? `${project.patient.firstName}_${project.patient.lastName}`
		: 'insole';

	const validateExportDimensions = useCallback(
		(side: 'left' | 'right', dims: { lengthMm: number; widthMm: number; heightMm: number } | null) => {
			if (!dims) return { ok: false, reason: `Geen afmetingen voor ${side} beschikbaar.` };
			if (!Number.isFinite(dims.lengthMm) || dims.lengthMm < 150 || dims.lengthMm > 350) {
				return {
					ok: false,
					reason: `Onrealistische ${side} lengte (${dims.lengthMm.toFixed(1)} mm). Controleer schaal/export.`,
				};
			}
			return { ok: true as const };
		},
		[]
	);

	const handleExportSTLLeft = useCallback(async () => {
		const steps = [
			'Geometrie ophalen',
			'STL bestand genereren',
			'Bestand downloaden',
		];
		const mkPhases = (activeIdx: number): ExportPhase[] =>
			steps.map((label, i) => ({ label, status: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending' }));

		setExportProgress({ title: 'Exporteer STL (links)', phases: mkPhases(0) });
		await new Promise((r) => setTimeout(r, 150));

		const geometry = viewerRef.current?.getExportInsoleGeometryMm('left');
		const dims = viewerRef.current?.getInsoleDimensionsMm('left') ?? null;
		const check = validateExportDimensions('left', dims);
		if (!geometry || !check.ok) {
			setExportProgress({ title: 'Exporteer STL (links)', phases: mkPhases(0).map((p, i) => i === 0 ? { ...p, status: 'error' } : p), error: check.ok ? 'Geen linker steunzool beschikbaar om te exporteren.' : check.reason });
			return;
		}

		setExportProgress({ title: 'Exporteer STL (links)', phases: mkPhases(1) });
		await new Promise((r) => setTimeout(r, 150));

		exportGeometryToSTLBinary(geometry, `${patientName}_left_${projectId}.stl`);
		geometry.dispose();

		setExportProgress({ title: 'Exporteer STL (links)', phases: mkPhases(2) });
		await new Promise((r) => setTimeout(r, 200));

		setExportProgress({ title: 'STL (links) gedownload', phases: steps.map((label) => ({ label, status: 'done' })), done: true });
	}, [patientName, projectId, validateExportDimensions]);

	const handleExportSTLRight = useCallback(async () => {
		const steps = [
			'Geometrie ophalen',
			'STL bestand genereren',
			'Bestand downloaden',
		];
		const mkPhases = (activeIdx: number): ExportPhase[] =>
			steps.map((label, i) => ({ label, status: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending' }));

		setExportProgress({ title: 'Exporteer STL (rechts)', phases: mkPhases(0) });
		await new Promise((r) => setTimeout(r, 150));

		const geometry = viewerRef.current?.getExportInsoleGeometryMm('right');
		const dims = viewerRef.current?.getInsoleDimensionsMm('right') ?? null;
		const check = validateExportDimensions('right', dims);
		if (!geometry || !check.ok) {
			setExportProgress({ title: 'Exporteer STL (rechts)', phases: mkPhases(0).map((p, i) => i === 0 ? { ...p, status: 'error' } : p), error: check.ok ? 'Geen rechter steunzool beschikbaar om te exporteren.' : check.reason });
			return;
		}

		setExportProgress({ title: 'Exporteer STL (rechts)', phases: mkPhases(1) });
		await new Promise((r) => setTimeout(r, 150));

		exportGeometryToSTLBinary(geometry, `${patientName}_right_${projectId}.stl`);
		geometry.dispose();

		setExportProgress({ title: 'Exporteer STL (rechts)', phases: mkPhases(2) });
		await new Promise((r) => setTimeout(r, 200));

		setExportProgress({ title: 'STL (rechts) gedownload', phases: steps.map((label) => ({ label, status: 'done' })), done: true });
	}, [patientName, projectId, validateExportDimensions]);

	const handleExportSTL = useCallback(async () => {
		const steps = [
			'Afmetingen controleren',
			'Paar geometrie ophalen',
			'STL bestand genereren',
			'Bestand downloaden',
		];
		const mkPhases = (activeIdx: number): ExportPhase[] =>
			steps.map((label, i) => ({ label, status: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending' }));

		setExportProgress({ title: 'Exporteer STL (paar)', phases: mkPhases(0) });
		await new Promise((r) => setTimeout(r, 150));

		const leftDims = viewerRef.current?.getInsoleDimensionsMm('left') ?? null;
		const rightDims = viewerRef.current?.getInsoleDimensionsMm('right') ?? null;
		const leftCheck = validateExportDimensions('left', leftDims);
		const rightCheck = validateExportDimensions('right', rightDims);
		if (!leftCheck.ok || !rightCheck.ok) {
			setExportProgress({ title: 'Exporteer STL (paar)', phases: mkPhases(0).map((p, i) => i === 0 ? { ...p, status: 'error' } : p), error: !leftCheck.ok ? leftCheck.reason : rightCheck.reason });
			return;
		}

		setExportProgress({ title: 'Exporteer STL (paar)', phases: mkPhases(1) });
		await new Promise((r) => setTimeout(r, 150));

		const geometry = viewerRef.current?.getExportPairGeometryMm(15);
		if (!geometry) {
			setExportProgress({ title: 'Exporteer STL (paar)', phases: mkPhases(1).map((p, i) => i === 1 ? { ...p, status: 'error' } : p), error: 'Geen steunzoolpaar beschikbaar om te exporteren.' });
			return;
		}

		setExportProgress({ title: 'Exporteer STL (paar)', phases: mkPhases(2) });
		await new Promise((r) => setTimeout(r, 200));

		exportGeometryToSTLBinary(geometry, `${patientName}_pair_${projectId}.stl`);
		geometry.dispose();

		setExportProgress({ title: 'Exporteer STL (paar)', phases: mkPhases(3) });
		await new Promise((r) => setTimeout(r, 200));

		setExportProgress({ title: 'STL (paar) gedownload', phases: steps.map((label) => ({ label, status: 'done' })), done: true });
	}, [patientName, projectId, validateExportDimensions]);

	const handleExportGcode = useCallback(async () => {
		const steps = [
			'Afmetingen controleren',
			'STL voorbereiden',
			'Slicing job aanmaken',
			'G-code genereren (Print Agent)',
			'G-code downloaden',
		];
		const mkPhases = (activeIdx: number): ExportPhase[] =>
			steps.map((label, i) => ({ label, status: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending' }));
		const fail = (stepIdx: number, message: string) => {
			setExportProgress({
				title: 'G-code export',
				phases: mkPhases(stepIdx).map((p, i) => i === stepIdx ? { ...p, status: 'error' } : p),
				error: message,
			});
		};

		setExportProgress({ title: 'G-code export', phases: mkPhases(0) });

		const leftDims = viewerRef.current?.getInsoleDimensionsMm('left') ?? null;
		const rightDims = viewerRef.current?.getInsoleDimensionsMm('right') ?? null;
		const leftCheck = validateExportDimensions('left', leftDims);
		const rightCheck = validateExportDimensions('right', rightDims);
		if (!leftCheck.ok || !rightCheck.ok) {
			fail(0, (!leftCheck.ok ? leftCheck.reason : rightCheck.reason) ?? 'Ongeldige afmetingen.');
			return;
		}

		setExportProgress({ title: 'G-code export', phases: mkPhases(1) });

		const pairGeometry = viewerRef.current?.getExportPairGeometryMm(15);
		if (!pairGeometry) {
			fail(1, 'Geen steunzoolpaar beschikbaar voor G-code generatie.');
			return;
		}

		setGcodeBusy(true);
		try {
			const stlArrayBuffer = geometryToBinarySTLArrayBuffer(pairGeometry);

			setExportProgress({ title: 'G-code export', phases: mkPhases(2) });

			const createRes = await fetch('/api/slicing/jobs/create', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/octet-stream',
					'x-filename': `${patientName}_pair_${projectId}.stl`,
					'x-printer-settings': JSON.stringify(printerSettings),
				},
				body: stlArrayBuffer,
			});

			if (!createRes.ok) {
				const raw = await createRes.text().catch(() => '');
				let message = 'Slicing job kon niet aangemaakt worden.';
				if (raw) {
					try {
						const parsed = JSON.parse(raw) as { error?: string };
						if (parsed?.error) message = parsed.error;
					} catch {
						if (createRes.status === 413) {
							message = 'STL-bestand is te groot voor upload. Probeer een eenvoudiger model.';
						} else {
							message = raw.slice(0, 220);
						}
					}
				}
				throw new Error(message);
			}

			const created = (await createRes.json()) as { jobId: string };
			if (!created?.jobId) {
				throw new Error('Geen jobId ontvangen van de server.');
			}

			setExportProgress({ title: 'G-code export', phases: mkPhases(3) });

			const startedAt = Date.now();
			const timeoutMs = 8 * 60 * 1000;
			while (Date.now() - startedAt < timeoutMs) {
				await new Promise((resolve) => setTimeout(resolve, 3000));
				const statusRes = await fetch(`/api/slicing/jobs/${created.jobId}`);
				if (!statusRes.ok) continue;
				const status = (await statusRes.json()) as {
					status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
					gcodeBase64?: string | null;
					filename?: string | null;
					errorMessage?: string | null;
				};

				if (status.status === 'RUNNING') {
					setExportProgress((prev) => prev && !prev.done ? { ...prev, phases: mkPhases(3).map((p, i) => i === 3 ? { ...p, label: 'G-code genereren (Print Agent bezig...)' } : p) } : prev);
				}

				if (status.status === 'FAILED') {
					throw new Error(status.errorMessage || 'Slicer job is mislukt.');
				}
				if (status.status === 'DONE') {
					setExportProgress({ title: 'G-code export', phases: mkPhases(4) });

					if (!status.gcodeBase64) {
						throw new Error('G-code ontbreekt in afgeronde job.');
					}
					const binary = atob(status.gcodeBase64);
					const bytes = new Uint8Array(binary.length);
					for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
					const blob = new Blob([bytes], { type: 'text/plain' });
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = status.filename || `${patientName}_pair_${projectId}.gcode`;
					a.style.display = 'none';
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
					setTimeout(() => URL.revokeObjectURL(url), 100);

					setExportProgress({ title: 'G-code gereed en gedownload!', phases: steps.map((label) => ({ label, status: 'done' })), done: true });
					return;
				}
			}

			throw new Error('Timeout: slicing duurde te lang. Controleer de Print Agent.');
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'G-code export mislukt.';
			setExportProgress((prev) => {
				if (!prev || prev.done) return prev;
				const activeIdx = prev.phases.findIndex((p) => p.status === 'active');
				return {
					...prev,
					phases: prev.phases.map((p, i) => i === activeIdx ? { ...p, status: 'error' } : p),
					error: msg,
				};
			});
		} finally {
			pairGeometry.dispose();
			setGcodeBusy(false);
		}
	}, [patientName, printerSettings, projectId, validateExportDimensions]);

	const handleToggleViewSetting = useCallback(
		(key: keyof typeof viewSettings) => {
			setViewSettings((prev) => ({ ...prev, [key]: !prev[key] }));
		},
		[]
	);

	const handleOverlayView = useCallback((preset: string) => {
			if (preset === 'rotate') {
				setViewerControlMode('rotate');
				setNamedViewActive(null);
				return;
			}
			if (preset === 'pan') {
				setViewerControlMode('pan');
				setNamedViewActive(null);
				return;
			}
			if (
				preset === 'front' ||
				preset === 'back' ||
				preset === 'left' ||
				preset === 'right' ||
				preset === 'top' ||
				preset === 'bottom' ||
				preset === 'iso'
			) {
				setViewerViewPreset(preset);
				setViewerControlMode('pan');
				setNamedViewActive(preset);
			}
	}, []);

	const renderStepContent = () => {
		switch (activeDesignStep) {
			case 1:
				return (
					<Card>
						<CardContent>
							{scansActive && (
								<>
									<Select
										label="Type basiszool"
										value={generalNormalized.baseInsoleType}
										onChange={(val) => {
											if (!isBaseInsoleType(val)) return;
											updateGeneral({ baseInsoleType: val });
										}}
										options={BASE_INSOLE_SELECT_OPTIONS}
									/>

									<Select
										label="Productiemethode"
										value={productionMethod}
										onChange={(val) => setProductionMethod(val)}
										options={[
											{ value: 'Printer: Solid', label: 'Printer: Solid' },
											{ value: 'Frezen: EVA', label: 'Frezen: EVA' },
										]}
									/>
								</>
							)}

							<div className="space-y-2">
								<p className="text-xs uppercase tracking-wide text-ui-text/70">
									Scans
								</p>
								<button
									type="button"
									onClick={() => {
										setShowScanModal(true);
									}}
									className="flex w-full items-center justify-between rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-left text-ui-text transition hover:bg-[rgba(255,255,255,0.08)]"
								>
									<span>
										{selectedLeftScan || scansActive ? 'Links ✓' : 'Links —'} /{' '}
										{selectedRightScan || scansActive ? 'Rechts ✓' : 'Rechts —'}
									</span>
									<span className="text-xs uppercase text-ui-muted">
										{scansActive ? 'Bewerken' : 'Beheer scans'}
									</span>
								</button>
								{scansActive && (
									<button
										type="button"
										onClick={() => startPointPicking()}
										className="mt-1 w-full rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-center text-xs text-ui-muted transition hover:bg-[rgba(255,255,255,0.08)] hover:text-ui-text"
									>
										Herpick punten
									</button>
								)}
								{!scansActive && (
									<p className="text-xs text-ui-muted">
										Importeer scans om het volledige ontwerp te starten.
									</p>
								)}
							</div>

							{scansActive && (
								<div className="space-y-2">
									<p className="text-xs uppercase tracking-wide text-ui-text/70">
										Elementen
									</p>
									{/* Side toggle for elements */}
									<div className="flex items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.03)] p-1">
										{(['left', 'right'] as const).map((s) => (
											<button
												key={s}
												type="button"
												onClick={() => setElementsModalSide(s)}
												className={cn(
													'flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition',
													elementsModalSide === s
														? 'bg-ui-accent text-slate-900'
														: 'text-ui-text hover:bg-[rgba(255,255,255,0.06)]'
												)}
											>
												{s === 'left' ? 'Links' : 'Rechts'}
												{' '}
												<span className="text-[10px] opacity-70">
													({s === 'left' ? leftPlacedElementCount : rightPlacedElementCount})
												</span>
											</button>
										))}
									</div>
									<PlacedElementsList side={elementsModalSide} />
									<Button
										variant="outline"
										size="sm"
										className="w-full"
										onClick={() => setElementsModalOpen(true)}
									>
										+ Element toevoegen
									</Button>
								</div>
							)}
						</CardContent>
					</Card>
				);

			case 2:
				return (
					<Card>
						<CardContent className="space-y-6">
							<>
								<div className="pb-4">
									<h4 className="text-sm font-semibold text-ui-accent">
										Algemeen
									</h4>
									<div className="mt-3 space-y-2 text-sm">
										<div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
											<div className="flex items-center justify-between">
												<span>Schoenmaat</span>
												<span className="text-[11px] text-ui-muted">Links / Rechts</span>
											</div>
											<div className="mt-2 grid grid-cols-2 gap-2">
												<input
													type="number"
													inputMode="decimal"
													className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-right text-sm text-ui-text"
													value={generalNormalized.shoeSize.left}
													onChange={(e) =>
														updateGeneral({
															shoeSize: {
																...generalNormalized.shoeSize,
																left: Number(e.target.value),
															},
														})
													}
													min={10}
													max={60}
													step={0.5}
												/>
												<input
													type="number"
													inputMode="decimal"
													className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-right text-sm text-ui-text"
													value={generalNormalized.shoeSize.right}
													onChange={(e) =>
														updateGeneral({
															shoeSize: {
																...generalNormalized.shoeSize,
																right: Number(e.target.value),
															},
														})
													}
													min={10}
													max={60}
													step={0.5}
												/>
											</div>
										</div>
										<div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
											<div className="flex items-center justify-between">
												<span>Zooldikte</span>
												<span className="text-[11px] text-ui-muted">Links / Rechts (mm)</span>
											</div>
											<div className="mt-2 grid grid-cols-2 gap-2">
												<input
													type="number"
													inputMode="decimal"
													className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-right text-sm text-ui-text"
													value={generalNormalized.soleThicknessMm.left}
													onChange={(e) =>
														updateGeneral({
															soleThicknessMm: {
																...generalNormalized.soleThicknessMm,
																left: Number(e.target.value),
															},
														})
													}
													min={0.5}
													max={10}
													step={0.5}
												/>
												<input
													type="number"
													inputMode="decimal"
													className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-right text-sm text-ui-text"
													value={generalNormalized.soleThicknessMm.right}
													onChange={(e) =>
														updateGeneral({
															soleThicknessMm: {
																...generalNormalized.soleThicknessMm,
																right: Number(e.target.value),
															},
														})
													}
													min={0.5}
													max={10}
													step={0.5}
												/>
											</div>
										</div>
										<div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
											<div className="flex items-center justify-between">
												<span>Steunzolen hoogte</span>
												<span className="text-[11px] text-ui-muted">Links / Rechts (mm)</span>
											</div>
											<div className="mt-2 grid grid-cols-2 gap-2">
												<input
													type="number"
													inputMode="decimal"
													className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-right text-sm text-ui-text"
													value={generalNormalized.maxInsoleHeightMm.left}
													onChange={(e) =>
														updateGeneral({
															maxInsoleHeightMm: {
																...generalNormalized.maxInsoleHeightMm,
																left: Number(e.target.value),
															},
														})
													}
													min={1}
													max={40}
													step={0.5}
												/>
												<input
													type="number"
													inputMode="decimal"
													className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-right text-sm text-ui-text"
													value={generalNormalized.maxInsoleHeightMm.right}
													onChange={(e) =>
														updateGeneral({
															maxInsoleHeightMm: {
																...generalNormalized.maxInsoleHeightMm,
																right: Number(e.target.value),
															},
														})
													}
													min={1}
													max={40}
													step={0.5}
												/>
											</div>
										</div>
									</div>
								</div>

								<OntwerpPanel
									corrections={corrections}
									onCorrectionsChange={handleCorrectionsChange}
									activeCorrections={activeCorrections}
									soleWidthValueMm={resolvedTargetForefootWidthMm}
									onSoleWidthChange={handleSoleWidthChange}
									tekstEnabled={activeCorrections.includes('tekst')}
									onTekstToggle={(enabled) => {
										if (enabled) {
											toggleCorrection('tekst');
										} else {
											resetBottomTextLoading();
											setActiveCorrections((prev) => prev.filter((k) => k !== 'tekst'));
											setTextEditorOpen(false);
										}
									}}
									onTekstEdit={handleTekstEditOpen}
								/>
							</>
						</CardContent>
					</Card>
				);

			case 3: {
				/* ── EVA panel when Frezen: EVA is selected ── */
				if (isEvaMethod) {
					return (
						<Card>
							<CardContent className="space-y-5">
								<EvaPreparationPanel
									settings={cncState.evaSettings}
									onSettingsChange={(evaSettings) =>
										setCncState((prev) => ({ ...prev, evaSettings }))
									}
								/>
							</CardContent>
						</Card>
					);
				}

				/* ── Print panel ── */
				const s = step3Current;

				const getZoneHardness = (zone: 'front' | 'middle' | 'back') => {
					if (!s.elementsSplit) return s.overall;
					return s[zone];
				};

				const setZoneHardness = (zone: 'front' | 'middle' | 'back', h: HardnessKey) => {
					if (!s.elementsSplit) {
						setStep3Current((prev) => ({ ...prev, overall: h }));
						return;
					}
					setStep3Current((prev) => ({ ...prev, [zone]: h }));
				};

				const sideLabel = step3Side === 'left' ? 'Links' : 'Rechts';
				const activeZone =
					s.elementsSplit && selectedZone ? selectedZone : null;
				const step3FocusedElement =
					selectedPlacedElement?.side === step3Side ? selectedPlacedElement : null;

				let contextMode: PrintSidebarContextMode;
				if (step3FocusedElement) contextMode = 'element';
				else if (s.elementsSplit && selectedZone) contextMode = 'zone';
				else if (s.elementsSplit) contextMode = 'hint_split';
				else contextMode = 'whole';

				const activeHardness: HardnessKey = step3FocusedElement
					? (step3FocusedElement.printHardness ?? 'normal')
					: activeZone
						? getZoneHardness(activeZone)
						: s.overall;

				const elemCatalogItem = step3FocusedElement
					? getElementByKey(step3FocusedElement.libraryKey)
					: null;
				const elementSubtitle = step3FocusedElement
					? elemCatalogItem?.label ?? step3FocusedElement.libraryKey
					: undefined;

				return (
					<Card>
						<CardContent className="space-y-5">
							<PrintPreparationPanel
								step3Side={step3Side}
								onStep3Side={(side) => {
									setStep3Side(side);
									setSelectedZone(null);
									printInteraction.resetHover();
									if (selectedPlacedElement?.side !== side) {
										selectPlacedElement(null);
									}
								}}
								elementsVloeien={s.elementsVloeien}
								onToggleVloeien={() =>
									setStep3Current((prev) => ({
										...prev,
										elementsVloeien: !prev.elementsVloeien,
									}))
								}
								heelEdgeThicknessMm={s.heelEdgeThicknessMm}
								onHeelEdgeChange={(v) =>
									setStep3Current((prev) => ({ ...prev, heelEdgeThicknessMm: v }))
								}
								elementsSplit={s.elementsSplit}
								onToggleSplit={() => {
									setStep3Current((prev) => ({
										...prev,
										elementsSplit: !prev.elementsSplit,
									}));
									setSelectedZone(null);
									printInteraction.onWholeInsoleToggleSplitOff();
								}}
								sideLabel={sideLabel}
							/>

							<PrintContextPanel
								mode={contextMode}
								activeZone={activeZone}
								activeHardness={activeHardness}
								hardnessOptions={HARDNESS_OPTIONS}
								activeProfiles={activeProfiles}
								elementSubtitle={
									step3FocusedElement
										? `Element: ${elementSubtitle ?? '?'} (${sideLabel.toLowerCase()})`
										: undefined
								}
								onPickHardness={(key) => {
									if (step3FocusedElement) {
										updatePlacedElement(step3FocusedElement.id, {
											printHardness: key,
										});
									} else if (s.elementsSplit && activeZone) {
										setZoneHardness(activeZone, key);
									} else {
										setStep3Current((prev) => ({ ...prev, overall: key }));
									}
								}}
							/>
						</CardContent>
					</Card>
				);
			}

			case 4:
				// ── Frezen: EVA – full CNC flow ──
				if (isEvaMethod) {
					// CNC planning view (after milling mode is selected)
					if (cncPlanningActive && cncState.millingMode) {
						return (
							<CncProducePanel
								millingMode={cncState.millingMode}
								fixture={cncState.fixture}
								onFixtureChange={(fixture) =>
									setCncState((prev) => ({ ...prev, fixture }))
								}
								patientName={
									project?.patient
										? `${project.patient.firstName} ${project.patient.lastName}`
										: 'patient'
								}
								onExportNc={handleExportNcFile}
								onBack={() => setCncPlanningActive(false)}
							/>
						);
					}

					// Default EVA export view with STL export + direct produce
					return (
						<Card>
							<CardContent className="space-y-4">
								{/* Exporteren section */}
								<div className="space-y-2">
									<h4 className="text-sm font-semibold text-ui-accent flex items-center gap-2">
										<CircleCheck size={14} strokeWidth={2.5} />
										Exporteren
									</h4>
									<p className="text-xs text-ui-muted">
										Exporteer het ontwerp als STL voor gebruik in externe CAM
										software of voor archivering.
									</p>
									<Button
										className="w-full"
										variant="outline"
										onClick={handleExportSTLLeft}
									>
										Exporteer STL (links)
									</Button>
									<Button
										className="w-full"
										variant="outline"
										onClick={handleExportSTLRight}
									>
										Exporteer STL (rechts)
									</Button>
									<Button
										className="w-full"
										variant="outline"
										onClick={handleExportSTL}
									>
										Exporteer STL (paar)
									</Button>
								</div>

								{/* Frezen section */}
								<div className="space-y-2">
									<h4 className="text-sm font-semibold text-ui-accent flex items-center gap-2">
										<CircleCheck size={14} strokeWidth={2.5} />
										Frezen
									</h4>
									<div className="space-y-1 text-sm">
										<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
											<span className="text-ui-muted">Productie</span>
											<span className="text-ui-text">Toevoegen</span>
										</div>
										<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
											<span className="text-ui-muted">Tafel vervangen</span>
											<span className="text-ui-text">Open</span>
										</div>
									</div>
									<Button
										className="w-full bg-ui-accent text-slate-900 hover:opacity-90"
										onClick={() => setShowMillingModeSelector(true)}
									>
										Exporteren
									</Button>
								</div>
							</CardContent>
						</Card>
					);
				}

				// For Printer: Solid, show new UI with Exporteren + Produceren sections
				if (step4View === 'directProduce') {
					return (
						<DirectProducePanel
							onBack={() => setStep4View('export')}
							printerSettings={printerSettings}
							onPrinterSettingsChange={setPrinterSettings}
							onExportSTLLeft={handleExportSTLLeft}
							onExportSTLRight={handleExportSTLRight}
							onExportSTLPair={handleExportSTL}
							onExportGcode={handleExportGcode}
							gcodeBusy={gcodeBusy}
						/>
					);
				}

				return (
					<Card>
						<CardContent className="space-y-4">
							{/* Exporteren section */}
							<div className="space-y-2">
								<h4 className="text-sm font-semibold text-ui-accent flex items-center gap-2">
									<CircleCheck size={14} strokeWidth={2.5} />
									Exporteren
								</h4>
								<p className="text-xs text-ui-muted">
									Exporteer het ontwerp als een universeel 3D bestand wat kan
									worden gebruikt voor productie. Of een ontwerp bestand dat op
									iedere andere computer kan worden ingeladen.
								</p>
								<Button
									className="w-full"
									variant="outline"
									onClick={handleExportSTLLeft}
								>
									Exporteer STL (links)
								</Button>
								<Button
									className="w-full"
									variant="outline"
									onClick={handleExportSTLRight}
								>
									Exporteer STL (rechts)
								</Button>
								<Button
									className="w-full"
									variant="outline"
									onClick={handleExportSTL}
								>
									Exporteer STL (paar)
								</Button>
							</div>

							{/* Produceren section */}
							<div className="space-y-2">
								<h4 className="text-sm font-semibold text-ui-accent flex items-center gap-2">
									<CircleCheck size={14} strokeWidth={2.5} />
									Produceren
								</h4>
								<p className="text-xs text-ui-muted">
									Na het plaatsen in productie is deze productie terug te vinden
									in de manager onder de tab productie. Ook wordt het project op
									&apos;in productie&apos; geplaatst.
								</p>
								<Button
									className="w-full bg-ui-accent text-slate-900 hover:opacity-90"
									onClick={() => setStep4View('directProduce')}
								>
									Direct produceren
								</Button>
								<Button className="w-full" variant="outline" disabled>
									Plaats in productie
								</Button>
							</div>
						</CardContent>
					</Card>
				);
		}
	};

	return (
		<>
			<div className="flex h-dvh flex-col bg-background text-foreground">
				<div className="border-b border-ui-border bg-ui-panel/90 px-4 py-2 backdrop-blur">
					<div className="flex items-center justify-between">
						<div>
							{project?.patient && (
								<p className="text-[14px] text-ui-muted">
									{project.patient.firstName} {project.patient.lastName}
								</p>
							)}
						</div>
						<Link href={`/${orgSlug}/projects/${projectId}`}>
							<Button variant="outline" size="sm">
								Terug naar project
							</Button>
						</Link>
					</div>
				</div>

				<div className="relative flex-1 bg-background">
					{workflowStep === 'stl-select' && project && (
						<STLSelector
							scans={project.scans}
							onLeftSelect={(id) => setSelectedLeftScanId(id)}
							onRightSelect={(id) => setSelectedRightScanId(id)}
							onContinue={() => {
								const rUrl = rightStlUrl;
								const lUrl = leftStlUrl;
								if (rUrl && lUrl) autoDetectAndApply(rUrl, lUrl);
							}}
						/>
					)}

					{workflowStep === 'point-pick' && (
						<div
							className="relative h-full w-full"
							onMouseMove={handlePointPickMouseMove}
							onMouseLeave={handlePointPickMouseLeave}
						>
							<EnhancedSTLViewer
								ref={viewerRef}
								leftUrl={undefined}
								rightUrl={pointPickFoot === 'right' ? rightStlUrl : leftStlUrl}
								showGrid={false}
								showBasePreview={false}
								lockTopView={true}
								hideScans={false}
								pointPickMode
								onPickPoint={handlePointPicked}
								pickedPoints={Object.values(pointPickFoot === 'right' ? rightPointSelections : leftPointSelections)}
							/>
							{crosshair && (
								<>
									<div
										className="pointer-events-none absolute left-0 right-0 border-t border-[#00ffd0]/50"
										style={{ top: crosshair.y }}
									/>
									<div
										className="pointer-events-none absolute top-0 bottom-0 border-l border-[#00ffd0]/50"
										style={{ left: crosshair.x }}
									/>
									<div
										className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-sm font-black text-[#00ffd0]"
										style={{ left: crosshair.x, top: crosshair.y }}
									>
										x
									</div>
								</>
							)}
							{autoDetectStatus === 'failed' && autoDetectMessage && (
								<div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-950/80 px-4 py-2 text-xs font-semibold text-amber-300 shadow-lg">
									<span>⚠</span>
									<span>{autoDetectMessage}</span>
									<button
										type="button"
										className="ml-1 text-amber-400 hover:text-amber-200"
										onClick={() => { setAutoDetectStatus('idle'); setAutoDetectMessage(''); }}
									>
										✕
									</button>
								</div>
							)}
							<div className="absolute right-4 top-4 z-20 w-[420px] rounded-2xl border border-ui-border bg-ui-panel text-ui-text shadow-lg">
								<div className="flex items-center justify-between border-b border-ui-border px-4 py-3">
									<div className="flex items-center gap-2">
										<span className="text-xs uppercase tracking-wide text-ui-muted">
											Actie
										</span>
										<span className="rounded-full bg-ui-accent/20 px-2 py-0.5 text-[11px] font-semibold text-ui-accent">
											{pointPickFoot === 'right' ? 'Rechtervoet' : 'Linkervoet'}
										</span>
									</div>
									<div className="flex items-center gap-2">
										{(pointStepIndex > 0 || pointPickFoot === 'left') && (
											<Button
												size="sm"
												variant="outline"
												onClick={handleUndoLastPoint}
											>
												↩ Vorige
											</Button>
										)}
										<Button
											size="sm"
											className="bg-emerald-400 text-slate-900 hover:opacity-90"
											onClick={handleCancelPointPick}
										>
											Annuleer
										</Button>
									</div>
								</div>
								<div className="px-4 py-4 space-y-3">
									<p className="text-sm font-semibold">
										{currentPointStep?.label ?? 'Selecteer punt'}
									</p>
									{currentPointStep?.description && (
										<p className="text-xs text-ui-muted">
											{currentPointStep.description}
										</p>
									)}
									<div className="space-y-1">
										{(['right', 'left'] as const).map((foot) => {
											const isCurrent = pointPickFoot === foot;
											const selections = foot === 'right' ? rightPointSelections : leftPointSelections;
											const isPast = foot === 'right' && pointPickFoot === 'left';
											return (
												<div key={foot} className="flex items-center gap-2">
													<span className={cn('w-6 text-[10px] font-semibold', isCurrent ? 'text-ui-accent' : 'text-ui-muted')}>
														{foot === 'right' ? 'R' : 'L'}
													</span>
													{POINT_SEQUENCE.map((step, idx) => {
														const done = isPast ? !!selections[step.id] : isCurrent && idx < pointStepIndex;
														const current = isCurrent && idx === pointStepIndex;
														return (
															<div key={step.id} className="flex items-center gap-1">
																<span className={cn(
																	'h-2 w-2 rounded-full transition-colors',
																	done ? 'bg-ui-accent' : current ? 'bg-white ring-2 ring-ui-accent/50' : 'bg-ui-muted/30'
																)} />
																<span className={cn(
																	'text-[10px]',
																	done || current ? 'text-ui-text' : 'text-ui-muted/30'
																)}>
																	{step.short}
																</span>
															</div>
														);
													})}
												</div>
											);
										})}
									</div>
									{(Object.keys(rightPointSelections).length > 0 || Object.keys(leftPointSelections).length > 0) && (
										<button
											type="button"
											className="text-[11px] text-ui-muted underline hover:text-ui-text"
											onClick={handleResetPoints}
										>
											Reset alle punten
										</button>
									)}
								</div>
							</div>
						</div>
					)}

					{workflowStep === 'dynamic-edit' && !selectedBaseSTL && (
						<div className="flex h-full items-center justify-center">
							<BaseSTLSelector
								onSelect={(url) => {
									setSelectedBaseSTL(url);
								}}
							/>
						</div>
					)}

					{workflowStep === 'dynamic-edit' && selectedBaseSTL && (
						<div className="relative h-full w-full">
							<DynamicInsoleWorkspace stlUrl={selectedBaseSTL} />
							<div className="absolute left-4 top-4 z-20">
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										setSelectedBaseSTL(null);
										setWorkflowStep('base');
									}}
								>
									← Back
								</Button>
							</div>
						</div>
					)}

					{workflowStep === 'base' && (
						<div className="relative h-full w-full">
							{/* When CNC planning is active, show fixture layout */}
							{isEvaMethod && cncPlanningActive ? (
								<CncFixtureView
									fixture={cncState.fixture}
									className="h-full w-full"
									leftStlUrl={selectedBaseInsoleAssets.leftUrl}
									rightStlUrl={selectedBaseInsoleAssets.rightUrl}
									leftGeometry={cncPreviewGeometry.left}
									rightGeometry={cncPreviewGeometry.right}
									baseInsoleType={generalNormalized.baseInsoleType}
								/>
							) : (
								<>
									<EnhancedSTLViewer
										ref={viewerRef}
										leftUrl={selectedBaseInsoleAssets.leftUrl}
										rightUrl={selectedBaseInsoleAssets.rightUrl}
										leftOverlayUrl={showOverlays ? leftStlUrl : undefined}
										rightOverlayUrl={showOverlays ? rightStlUrl : undefined}
										baseInsoleType={generalNormalized.baseInsoleType}
										targetForefootWidthMm={resolvedTargetForefootWidthMm}
										showGrid={true}
										showBasePreview={false}
										lockTopView={false}
										hideScans={false}
										landmarkPoints={designPlan.points ?? undefined}
										showGeneratedInsole={false}
										showZones={false}
										showLeft={viewSettings.showLeft}
										showRight={viewSettings.showRight}
										transparent={viewSettings.transparent}
										heatmap={viewSettings.heatmap}
										clampDebug={viewSettings.clampDebug}
										showInsoles={viewSettings.showInsoles}
										showModel={viewSettings.showModel}
										viewPreset={viewerViewPreset}
										controlMode={viewerControlMode}
										analysisEnabled={leftPanelTab === 'analysis'}
										onProbe={handleAnalysisProbe}
										corrections={corrections}
										activeCorrections={activeCorrections}
										bottomTextOverlay={bottomTextOverlay}
										textPlacementEnabled={false}
										selectedSide={activeDesignStep === 3 ? null : selectedInsoleSide}
										onSelectSide={activeDesignStep === 3 ? undefined : (side) => setSelectedInsoleSide(side)}
										onDeselectSide={activeDesignStep === 3 ? undefined : () => setSelectedInsoleSide(null)}
										onZoneClick={
											activeDesignStep === 3 && !isEvaMethod && step3Current.elementsSplit
												? (zone, side) => {
														setSelectedZone(zone);
														setStep3Side(side);
														selectPlacedElement(null);
													}
												: undefined
										}
										printPrepInteractive={activeDesignStep === 3 && !isEvaMethod}
										printPrepSidebarSide={step3Side}
										printPrepElementsSplitLeft={step3Left.elementsSplit}
										printPrepElementsSplitRight={step3Right.elementsSplit}
										printPrepSelectedZone={
											step3Current.elementsSplit ? selectedZone : null
										}
										printPrepHoveredZones={printInteraction.hoveredBySide}
										onPrintPrepZoneHover={printInteraction.onPrepZoneHover}
										onPrintWholeInsoleClick={
											activeDesignStep === 3 && !isEvaMethod && !step3Current.elementsSplit
												? (side) => {
														printInteraction.onPrepWholeInsoleClick(side);
														setStep3Side(side);
														setSelectedZone(null);
														selectPlacedElement(null);
													}
												: undefined
										}
										onPrintElementClick={
											activeDesignStep === 3 && !isEvaMethod
												? (elementId, side) => {
														selectPlacedElement(elementId);
														setStep3Side(side);
														setSelectedZone(null);
														printInteraction.resetHover();
													}
												: undefined
										}
										printSelectedElementId={
											activeDesignStep === 3 ? selectedElementId : null
										}
										onPrintInteractionDeselect={
											activeDesignStep === 3 && !isEvaMethod
												? () => {
														printInteraction.deselectInteraction();
														setSelectedZone(null);
														selectPlacedElement(null);
													}
												: undefined
										}
										boxEnabled={boxEnabled}
										gridEditMode={isSelectedGridModeOn || isElementBoxGridModeOn}
										heelEdgeThicknessMm={viewerHeelEdgeThicknessMm}
										savedBoxGridOffsets={boxGridPoints}
										onBoxGridSave={handleBoxGridSave}
										leftPlacedElements={effectiveLeftPlacedElements}
										rightPlacedElements={effectiveRightPlacedElements}
										evaBlockMode={isEvaMethod}
										trimlineAdjustments={trimlineAdjustments}
										trimlineHandleProfiles={trimlineHandleProfiles}
										editTrimlineHandleProfiles={editorTrimlineHandleProfiles}
										trimlineEditSide={trimlineEditSide}
										scanRotateEditSide={scanRotateEditSide}
										scanManualAlignments={scanManualAlignments}
										editorScanManualAlignments={pendingScanManualAlignments}
										onPendingScanAlignmentChange={(side, alignment) => {
											const nextAlignment = alignment;
											pendingScanManualAlignmentsRef.current = {
												...pendingScanManualAlignmentsRef.current,
												[side]: nextAlignment,
											};
											setPendingScanManualAlignments((prev) => ({
												...prev,
												[side]: nextAlignment,
											}));
										}}
										onPendingTrimlineProfileChange={(side, profile) => {
											const next = cloneTrimlineProfile(profile);
											pendingTrimlineHandleProfilesRef.current = {
												...pendingTrimlineHandleProfilesRef.current,
												[side]: next,
											};
											setPendingTrimlineHandleProfiles((prev) => ({ ...prev, [side]: next }));
											scheduleTrimlinePanelSync();
										}}
										selectedElementTrimlineEdit={viewerSelectedElementTrimlineEdit}
										onPendingElementTrimlineProfileChange={(profile) => {
											const next = cloneTrimlineProfile(profile);
											pendingElementTrimlineHandleProfileRef.current = next;
											setPendingElementTrimlineHandleProfile(next);
											scheduleElementTrimlinePanelSync();
										}}
										selectedElementBoxEdit={viewerSelectedElementBoxEdit}
										onElementBoxGridSave={handleElementBoxGridSave}
										onReady={() => setIsViewerReady(true)}
										onBottomTextLoadingChange={handleBottomTextLoadingChange}
										onBottomTextValidityChange={handleBottomTextValidityChange}
										disableInteraction={
											!scansActive || (!!selectedPlacedElement && activeDesignStep !== 3)
										}
										elementPlacementMode={viewerElementPlacementMode}
										onElementPlace={selectedPlacedElement ? ({ side, u, v }) => {
											if (selectedPlacedElement.side !== side) return;
											updatePlacedElement(selectedPlacedElement.id, { positionU: u, positionV: v });
											setElementEditMode(null);
										} : undefined}
									/>
									{/* ── Viewer loading overlay ── */}
									{!isViewerReady && (
										<div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-gray-900/80 backdrop-blur-sm">
											{/* Animated insole silhouette */}
											<div className="relative mb-6">
												<svg width="80" height="160" viewBox="0 0 80 160" className="animate-insole-shimmer drop-shadow-[0_0_24px_rgba(99,247,214,0.25)]">
													<path
														d="M40 8 C22 8 14 28 12 48 C10 68 12 88 16 108 C20 128 28 148 40 152 C52 148 60 128 64 108 C68 88 70 68 68 48 C66 28 58 8 40 8Z"
														fill="none"
														stroke="var(--ui-accent)"
														strokeWidth="1.5"
														opacity="0.6"
													/>
													<path
														d="M40 16 C26 16 20 32 18 48 C16 64 18 84 22 104 C26 124 32 140 40 144 C48 140 54 124 58 104 C62 84 64 64 62 48 C60 32 54 16 40 16Z"
														fill="var(--ui-accent)"
														opacity="0.08"
													/>
												</svg>
												{/* Orbiting dot */}
												<div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
													<div className="animate-orbit-dot">
														<div className="h-2 w-2 rounded-full bg-ui-accent shadow-[0_0_8px_rgba(99,247,214,0.6)]" />
													</div>
												</div>
											</div>
											<p className="animate-fade-in-up text-sm font-medium text-ui-muted">
												3D model laden…
											</p>
											{/* Progress bar */}
											<div className="mt-3 h-0.5 w-32 overflow-hidden rounded-full bg-ui-border/40">
												<div className="h-full w-1/3 rounded-full bg-ui-accent/60 animate-progress-indeterminate" />
											</div>
										</div>
									)}
									{/* ── Fitting / processing overlay ── */}
									{isFitting && (
										<div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-900/50 backdrop-blur-[2px]">
											<div className="animate-fade-in-up flex flex-col items-center gap-3 rounded-2xl border border-ui-border bg-ui-panel/95 px-6 py-5 shadow-xl">
												<div className="relative h-8 w-8">
													<div className="absolute inset-0 rounded-full border-2 border-ui-border" />
													<div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-ui-accent" />
												</div>
												<p className="text-xs font-semibold text-ui-text">Berekenen… steunzool wordt aangepast</p>
												<div className="h-0.5 w-24 overflow-hidden rounded-full bg-ui-border/40">
													<div className="h-full w-1/3 rounded-full bg-ui-accent/60 animate-progress-indeterminate" />
												</div>
											</div>
										</div>
									)}
									{isBottomTextLoading && !isFitting && autoDetectStatus !== 'detecting' && (
										<div className="absolute inset-0 z-35 flex items-center justify-center bg-gray-900/55 backdrop-blur-[2px]">
											<div className="animate-fade-in-up flex flex-col items-center gap-3 rounded-2xl border border-ui-border bg-ui-panel/95 px-6 py-5 shadow-xl">
												<div className="relative h-8 w-8">
													<div className="absolute inset-0 rounded-full border-2 border-ui-border" />
													<div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-ui-accent" />
												</div>
												<p className="text-xs font-semibold text-ui-text">Tekst laden op de steunzool…</p>
												<p className="text-center text-[11px] text-ui-muted">De onderkant wordt bijgewerkt met de nieuwe tekst op beide steunzolen.</p>
												<div className="h-0.5 w-24 overflow-hidden rounded-full bg-ui-border/40">
													<div className="h-full w-1/3 rounded-full bg-ui-accent/60 animate-progress-indeterminate" />
												</div>
											</div>
										</div>
									)}
									{autoDetectStatus === 'detecting' && !isFitting && (
										<div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-900/40 backdrop-blur-[1px]">
											<div className="animate-fade-in-up flex flex-col items-center gap-3 rounded-2xl border border-ui-border bg-ui-panel/95 px-6 py-5 shadow-xl">
												<div className="relative h-8 w-8">
													<div className="absolute inset-0 rounded-full border-2 border-ui-border" />
													<div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-ui-accent" />
												</div>
												<p className="text-xs font-semibold text-ui-text">
													{autoDetectMessage || 'Landmarks automatisch detecteren...'}
												</p>
												<div className="h-0.5 w-24 overflow-hidden rounded-full bg-ui-border/40">
													<div className="h-full w-1/3 rounded-full bg-ui-accent/60 animate-progress-indeterminate" />
												</div>
											</div>
										</div>
									)}
									{autoDetectStatus === 'success' && !isFitting && (
										<div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-emerald-500/30 bg-emerald-950/80 px-4 py-2 text-xs font-semibold text-emerald-300 shadow-lg">
											✓ {autoDetectMessage}
										</div>
									)}
									{/* ── Export progress overlay ── */}
									{exportProgress && (
										<ExportProgressOverlay progress={exportProgress} onDismiss={() => setExportProgress(null)} />
									)}
									{autoDetectStatus === 'failed' && !isFitting && (
										<div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-950/80 px-4 py-2 text-xs font-semibold text-amber-300 shadow-lg">
											<span>⚠</span>
											<span>{autoDetectMessage}</span>
											<button
												type="button"
												className="ml-1 text-amber-400 hover:text-amber-200"
												onClick={() => { setAutoDetectStatus('idle'); setAutoDetectMessage(''); }}
											>
												✕
											</button>
										</div>
									)}
									<ViewOverlay
										tab={leftPanelTab}
										onTabChange={(nextTab) => {
											setLeftPanelTab(nextTab);
											if (nextTab === 'analysis') {
												setViewerViewPreset('back');
											}
										}}
										viewSettings={viewSettings}
										onToggle={handleToggleViewSetting}
										onView={handleOverlayView}
										activeView={namedViewActive}
										activeControlMode={viewerControlMode}
										analysisHeightMm={analysisProbe?.heightMm ?? null}
										analysisSide={analysisProbe?.side ?? null}
										className="absolute left-6 top-6 z-20"
									/>
									{/* Element action panel – bottom-right corner of canvas */}
									{selectedPlacedElement && !selectedInsoleSide && (
										<ElementActionsPanel
											element={selectedPlacedElement}
											editMode={elementEditMode}
											onEditModeChange={handleElementEditModeChange}
											className="absolute bottom-6 right-6 z-20 w-[280px]"
										/>
									)}
									{selectedPlacedElement && !selectedInsoleSide && elementEditMode === 'move' && (
										<div className="absolute bottom-6 right-[310px] z-20 ui-overlay-card w-[320px] rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur">
											<div className="flex items-center justify-between">
												<div>
													<div className="text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">Verplaatsen</div>
													<div className="mt-0.5 text-xs text-(--ui-muted)">Gebruik de pijlen of pijltjestoetsen om het element te verplaatsen</div>
												</div>
												<button type="button" onClick={() => setElementEditMode(null)} className="rounded-lg border border-(--ui-border) px-3 py-1.5 text-xs text-(--ui-text)">Annuleren</button>
											</div>
											<div className="mt-4 flex justify-center">
												<div className="grid grid-cols-3 gap-2">
													<div />
													<button type="button" onPointerDown={(e) => { e.preventDefault(); nudgeSelectedElement('up'); }} className="flex h-12 w-12 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]" aria-label="Voor">
														<ArrowUp className="h-4 w-4" />
													</button>
													<div />
													<button type="button" onPointerDown={(e) => { e.preventDefault(); nudgeSelectedElement('left'); }} className="flex h-12 w-12 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]" aria-label="Links">
														<ArrowLeft className="h-4 w-4" />
													</button>
													<div className="flex h-12 w-12 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.02)] text-[10px] font-semibold uppercase tracking-wide text-(--ui-muted)">Move</div>
													<button type="button" onPointerDown={(e) => { e.preventDefault(); nudgeSelectedElement('right'); }} className="flex h-12 w-12 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]" aria-label="Rechts">
														<ArrowRight className="h-4 w-4" />
													</button>
													<div />
													<button type="button" onPointerDown={(e) => { e.preventDefault(); nudgeSelectedElement('down'); }} className="flex h-12 w-12 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]" aria-label="Achter">
														<ArrowDown className="h-4 w-4" />
													</button>
													<div />
												</div>
											</div>
											<div className="mt-3 grid grid-cols-2 gap-2 text-xs text-(--ui-muted)">
												<div className="rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.02)] px-3 py-2 text-center">Links / Rechts</div>
												<div className="rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.02)] px-3 py-2 text-center">Voor / Achter</div>
											</div>
										</div>
									)}
									{selectedPlacedElement && !selectedInsoleSide && elementEditMode === 'scale' && (
										<div className="absolute bottom-6 right-[310px] z-20 ui-overlay-card w-[320px] rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur">
											<div className="flex items-center justify-between gap-2">
												<div>
													<div className="text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">Schalen</div>
													<div className="mt-0.5 text-xs text-(--ui-muted)">
														Gebruik de knoppen of de + en − toetsen (gelijke vergroting)
													</div>
												</div>
												<button
													type="button"
													onClick={() => setElementEditMode(null)}
													className="shrink-0 rounded-lg border border-(--ui-border) px-3 py-1.5 text-xs text-(--ui-text)"
												>
													Annuleren
												</button>
											</div>
											<div className="mt-4 space-y-3">
												<div className="flex items-center justify-between gap-3">
													<span className="text-xs font-medium text-(--ui-text)">Alles</span>
													<div className="flex gap-2">
														<button
															type="button"
															onPointerDown={(e) => {
																e.preventDefault();
																adjustSelectedElementScale('uniform', -1);
															}}
															className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-lg font-semibold text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]"
															aria-label="Kleiner"
														>
															−
														</button>
														<button
															type="button"
															onPointerDown={(e) => {
																e.preventDefault();
																adjustSelectedElementScale('uniform', 1);
															}}
															className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-lg font-semibold text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]"
															aria-label="Groter"
														>
															+
														</button>
													</div>
												</div>
												<div className="flex items-center justify-between gap-3">
													<span className="text-xs font-medium text-(--ui-text)">Dwars</span>
													<div className="flex gap-2">
														<button
															type="button"
															onPointerDown={(e) => {
																e.preventDefault();
																adjustSelectedElementScale('u', -1);
															}}
															className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-lg font-semibold text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]"
															aria-label="Smaller dwars"
														>
															−
														</button>
														<button
															type="button"
															onPointerDown={(e) => {
																e.preventDefault();
																adjustSelectedElementScale('u', 1);
															}}
															className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-lg font-semibold text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]"
															aria-label="Breder dwars"
														>
															+
														</button>
													</div>
												</div>
												<div className="flex items-center justify-between gap-3">
													<span className="text-xs font-medium text-(--ui-text)">Langs voet</span>
													<div className="flex gap-2">
														<button
															type="button"
															onPointerDown={(e) => {
																e.preventDefault();
																adjustSelectedElementScale('v', -1);
															}}
															className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-lg font-semibold text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]"
															aria-label="Korter langs"
														>
															−
														</button>
														<button
															type="button"
															onPointerDown={(e) => {
																e.preventDefault();
																adjustSelectedElementScale('v', 1);
															}}
															className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-lg font-semibold text-(--ui-text) transition hover:bg-[rgba(255,255,255,0.08)] active:scale-[0.98]"
															aria-label="Langer langs"
														>
															+
														</button>
													</div>
												</div>
											</div>
											<div className="mt-3 rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.02)] px-3 py-2 text-center text-xs tabular-nums text-(--ui-muted)">
												dwars {selectedPlacedElement.scaleU.toFixed(2)} × langs {selectedPlacedElement.scaleV.toFixed(2)}
											</div>
										</div>
									)}
									{selectedPlacedElement && !selectedInsoleSide && elementTrimlineEditId === selectedPlacedElement.id && elementEditMode === 'trimline' && (
										<TrimlineEditCard
											className="absolute left-6 bottom-6 z-20"
											title="Trimline aanpassen"
											subtitle={`${selectedPlacedElement.side === 'left' ? 'Links' : 'Rechts'} — sleep de rand om aan te passen`}
											saveDisabled={
												JSON.stringify(normalizeElementTrimlineAdjustments(pendingElementTrimlineAdj)) ===
												JSON.stringify(
													normalizeElementTrimlineAdjustments(selectedPlacedElement.trimlineAdjustments),
												) &&
												JSON.stringify(pendingElementTrimlineHandleProfile) ===
												JSON.stringify(selectedPlacedElement.trimlineHandleProfile)
											}
											onCancel={() => {
												const restoredAdj = normalizeElementTrimlineAdjustments(
													selectedPlacedElement.trimlineAdjustments,
												);
												const restoredProfile = selectedPlacedElement.trimlineHandleProfile
													? cloneTrimlineProfile(selectedPlacedElement.trimlineHandleProfile)
													: null;
												pendingElementTrimlineAdjRef.current = restoredAdj;
												pendingElementTrimlineHandleProfileRef.current = restoredProfile;
												setPendingElementTrimlineAdj(restoredAdj);
												setPendingElementTrimlineHandleProfile(restoredProfile);
												setElementTrimlineEditId(null);
												setElementEditMode(null);
											}}
											onSave={() => {
												const p = pendingElementTrimlineHandleProfileRef.current;
												updatePlacedElement(selectedPlacedElement.id, {
													trimlineAdjustments: normalizeElementTrimlineAdjustments(
														pendingElementTrimlineAdjRef.current,
													),
													trimlineHandleProfile: p ? cloneTrimlineProfile(p) : null,
												});
												setElementTrimlineEditId(null);
												setElementEditMode(null);
											}}
										/>
									)}
									{selectedInsoleSide &&
										!isSelectedGridModeOn &&
										!trimlineEditSide &&
										!scanRotateEditSide && (
											<GeneratedInsoleOverlay
												selectedSide={selectedInsoleSide}
												boxEnabled={boxEnabled}
												onToggleBox={handleToggleBoxMode}
												onMirrorToOther={mirrorCorrectionsToOtherSide}
												onTrimlineEdit={(side) => {
													setScanRotateEditSide(null);
													setTrimlineEditSide(side);
													pendingTrimlineAdjRef.current = { ...trimlineAdjustments };
													pendingTrimlineHandleProfilesRef.current = { ...trimlineHandleProfiles };
													setPendingTrimlineAdj({ ...trimlineAdjustments });
													setPendingTrimlineHandleProfiles({ ...trimlineHandleProfiles });
													setViewerViewPreset('top');
												}}
												onScanRotateEdit={(side) => {
													setTrimlineEditSide(null);
													pendingScanManualAlignmentsRef.current = { ...scanManualAlignments };
													setPendingScanManualAlignments({ ...scanManualAlignments });
													setScanRotateEditSide(side);
													setViewerViewPreset('top');
												}}
												className="absolute left-6 bottom-6 z-20"
											/>
										)}

									{trimlineEditSide && (
										<TrimlineEditCard
											className="absolute left-6 bottom-6 z-20"
											title="Trimline aanpassen"
											subtitle={`${trimlineEditSide === 'left' ? 'Links' : 'Rechts'} — sleep de rand om aan te passen`}
											saveDisabled={
												JSON.stringify(pendingTrimlineAdj[trimlineEditSide]) ===
												JSON.stringify(trimlineAdjustments[trimlineEditSide]) &&
												JSON.stringify(pendingTrimlineHandleProfiles[trimlineEditSide]) ===
												JSON.stringify(trimlineHandleProfiles[trimlineEditSide])
											}
											onCancel={() => {
												const side = trimlineEditSide;
												pendingTrimlineAdjRef.current = {
													...pendingTrimlineAdjRef.current,
													[side]: { ...trimlineAdjustments[side] },
												};
												pendingTrimlineHandleProfilesRef.current = {
													...pendingTrimlineHandleProfilesRef.current,
													[side]: trimlineHandleProfiles[side],
												};
												setPendingTrimlineAdj({ ...pendingTrimlineAdjRef.current });
												setPendingTrimlineHandleProfiles({ ...pendingTrimlineHandleProfilesRef.current });
												setTrimlineEditSide(null);
											}}
											onSave={() => {
												const ref = pendingTrimlineHandleProfilesRef.current;
												setTrimlineAdjustments({ ...pendingTrimlineAdjRef.current });
												setTrimlineHandleProfiles({
													left: ref.left ? cloneTrimlineProfile(ref.left) : null,
													right: ref.right ? cloneTrimlineProfile(ref.right) : null,
												});
												setTrimlineEditSide(null);
											}}
										/>
									)}
									{scanRotateEditSide && (
										<ScanRotateEditCard
											className="absolute left-6 bottom-6 z-20"
											title="3D scan draaien"
											subtitle={`${scanRotateEditSide === 'left' ? 'Links' : 'Rechts'} — klik een ankerpunt, sleep om te draaien`}
											saveDisabled={scanManualAlignmentsEquals(
												pendingScanManualAlignments[scanRotateEditSide],
												scanManualAlignments[scanRotateEditSide],
											)}
											onCancel={() => {
												setPendingScanManualAlignments({
													left: scanManualAlignments.left,
													right: scanManualAlignments.right,
												});
												pendingScanManualAlignmentsRef.current = {
													left: scanManualAlignments.left,
													right: scanManualAlignments.right,
												};
												setScanRotateEditSide(null);
											}}
											onResetToAuto={() => {
												const side = scanRotateEditSide;
												const next = {
													...pendingScanManualAlignmentsRef.current,
													[side]: null,
												};
												pendingScanManualAlignmentsRef.current = next;
												setPendingScanManualAlignments(next);
											}}
											onSave={() => {
												const snap = pendingScanManualAlignmentsRef.current;
												setScanManualAlignments({
													left: snap.left,
													right: snap.right,
												});
												setScanRotateEditSide(null);
											}}
										/>
									)}
									{textEditorOpen && activeCorrections.includes('tekst') ? (
										<TextEditCard
											className="absolute right-6 bottom-6 z-45"
											draft={draftBottomText}
											onDraftChange={setDraftBottomText}
											saveDisabled={textEditSaveDisabled}
											warning={textEditWarning}
											onCancel={handleCancelTextEdit}
											onSave={handleSaveTextEdit}
										/>
									) : null}
									{selectedPlacedElement && !selectedInsoleSide && isElementBoxGridModeOn && (
										<div className="absolute bottom-6 left-6 z-20 w-[min(92vw,360px)] rounded-2xl border border-ui-border bg-ui-panel/92 px-4 py-3 text-ui-text shadow-xl backdrop-blur">
											<div className="flex flex-col gap-3">
												<div className="min-w-0">
													<div className="flex items-center gap-2">
														<span className="text-[11px] font-semibold uppercase tracking-wide text-ui-muted">Box bewerken</span>
														<span className="rounded-full bg-ui-accent/15 px-2 py-0.5 text-[11px] font-semibold text-ui-accent">
															{selectedPlacedElement.side === 'left' ? 'Links' : 'Rechts'}
														</span>
													</div>
													<p className="mt-1 text-xs leading-relaxed text-ui-muted">
														Sleep de punten direct op het element om lokaal volume aan te passen. Alleen punten op het element zijn zichtbaar.
													</p>
												</div>
												<div className="flex items-center justify-end gap-2">
													<Button variant="outline" size="sm" onClick={handleElementBoxCancelAndExit}>
														Annuleren
													</Button>
													<Button size="sm" className="bg-ui-accent text-slate-900 hover:opacity-90" onClick={handleElementBoxSaveAndExit}>
														Opslaan
													</Button>
												</div>
											</div>
										</div>
									)}

									{selectedInsoleSide && isSelectedGridModeOn && (
										<div className="absolute bottom-6 left-6 z-20 w-[min(92vw,360px)] rounded-2xl border border-ui-border bg-ui-panel/92 px-4 py-3 text-ui-text shadow-xl backdrop-blur">
											<div className="flex flex-col gap-3">
												<div className="min-w-0">
													<div className="flex items-center gap-2">
														<span className="text-[11px] font-semibold uppercase tracking-wide text-ui-muted">Box bewerken</span>
														<span className="rounded-full bg-ui-accent/15 px-2 py-0.5 text-[11px] font-semibold text-ui-accent">
															{selectedInsoleSide === 'left' ? 'Links' : 'Rechts'}
														</span>
													</div>
													<p className="mt-1 text-xs leading-relaxed text-ui-muted">
														Sleep de punten direct op de zool om lokaal volume aan te passen. Alleen punten op de zool zijn zichtbaar.
													</p>
												</div>
												<div className="flex items-center justify-end gap-2">
													<Button variant="outline" size="sm" onClick={handleBoxGridCancelAndExit}>
														Annuleren
													</Button>
													<Button size="sm" className="bg-ui-accent text-slate-900 hover:opacity-90" onClick={handleBoxGridSaveAndExit}>
														Opslaan
													</Button>
												</div>
											</div>
										</div>
									)}
								</>
							)}
							{leftPanelTab !== 'analysis' &&
								!selectedInsoleSide &&
								selectedPlacedElement &&
								activeDesignStep !== 3 && (
								<div className="absolute right-4 top-4 z-20 w-[320px]">
									<ElementInspector
										element={selectedPlacedElement}
										standalone
										editMode={elementEditMode}
										onClose={() => selectPlacedElement(null)}
									/>
								</div>
							)}
							{leftPanelTab !== 'analysis' &&
								!selectedInsoleSide &&
								selectedPlacedElement &&
								activeDesignStep === 3 && (
								<div className="absolute right-[458px] top-4 z-20 w-[320px] max-w-[calc(100vw-500px)]">
									<ElementInspector
										element={selectedPlacedElement}
										standalone
										editMode={elementEditMode}
										onClose={() => selectPlacedElement(null)}
									/>
								</div>
							)}
							{leftPanelTab !== 'analysis' &&
								!selectedInsoleSide &&
								(!selectedPlacedElement || activeDesignStep === 3) &&
								!(textEditorOpen && activeCorrections.includes('tekst')) && (
									<div className="absolute right-4 top-4 z-20 flex h-[85vh] w-[420px] flex-col rounded-2xl border border-ui-border bg-ui-panel text-ui-text overflow-hidden">
										<StepRail
											activeStep={activeDesignStep}
											onStepChange={(step) => {
												if (!scansActive && step !== 1) return;
												setActiveDesignStep(step);
											}}
											stepLabels={
												productionMethod === 'Frezen: EVA'
													? { 3: 'EVA' }
													: undefined
											}
											visibleSteps={scansActive ? undefined : [1]}
										/>

										<div className="flex-1 overflow-y-auto px-4 pb-4 pr-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[rgba(255,255,255,0.18)]">
											{renderStepContent()}
										</div>
										<div className="border-t border-ui-border px-4 py-3 flex items-center justify-between">
											{/* Autosave status */}
											<div className="flex items-center gap-1.5 text-[11px]">
												{saveStatus === 'saving' && (
													<>
														<Loader2 className="h-3 w-3 animate-spin text-ui-muted" />
														<span className="text-ui-muted">Opslaan...</span>
													</>
												)}
												{saveStatus === 'error' && (
													<>
														<AlertCircle className="h-3 w-3 text-red-400" />
														<span className="text-red-400">Opslaan mislukt</span>
													</>
												)}
												{(saveStatus === 'saved' || saveStatus === 'idle') && lastSavedAt && (
													<>
														<Check className="h-3 w-3 text-green-400" />
														<span className="text-ui-muted">
															Opgeslagen {lastSavedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
														</span>
													</>
												)}
											</div>
										</div>
									</div>
								)}

							{/* Grid mode now uses: bottom-left tools + top-right confirm panel */}
						</div>
					)}
				</div>
			</div>
			<BaseModal
				title="Selecteer scans"
				open={showScanModal}
				onClose={() => setShowScanModal(false)}
				footer={
					<>
						<Button
							variant="outline"
							disabled={autoDetectStatus === 'detecting' || !leftScan || !rightScan}
							onClick={() => {
								if (leftScan?.id) setSelectedLeftScanId(leftScan.id);
								if (rightScan?.id) setSelectedRightScanId(rightScan.id);
								setShowScanModal(false);
								const rUrl = rightStlUrl;
								const lUrl = leftStlUrl;
								if (rUrl && lUrl) autoDetectAndApply(rUrl, lUrl);
							}}
						>
							{autoDetectStatus === 'detecting' ? 'Detecteren...' : 'Gebruik paar'}
						</Button>
						<Button
							variant="ghost"
							disabled={!leftScan || !rightScan}
							onClick={() => {
								if (leftScan?.id) setSelectedLeftScanId(leftScan.id);
								if (rightScan?.id) setSelectedRightScanId(rightScan.id);
								setShowScanModal(false);
								startPointPicking();
							}}
						>
							Handmatig kiezen
						</Button>
						<Button onClick={() => setShowScanModal(false)} variant="ghost">
							Annuleer
						</Button>
					</>
				}
			>
				<div className="grid grid-cols-[260px_1fr]">
					<div className="border-r border-ui-border bg-[rgba(255,255,255,0.02)]">
						{/* Upload button */}
						<div className="px-3 py-3 border-b border-ui-border">
							<Button
								onClick={() => {
									setShowScanModal(false);
									setShowUploadScansModal(true);
								}}
								className="w-full rounded-lg bg-ui-accent px-3 py-2 text-sm font-medium text-slate-900"
							>
								<Plus className="mr-1.5 h-4 w-4" />
								Upload nieuwe scans
							</Button>
						</div>
						{scanPairs.length === 0 ? (
							<div className="px-4 py-8 text-center text-sm text-ui-muted">
								Nog geen scans geüpload
							</div>
						) : (
							<>
								<div className="px-4 py-2 text-[11px] uppercase text-ui-muted">
									Beschikbare scans
								</div>
								<div className="space-y-2 px-3 pb-3">
									{scanPairs.map((pair) => (
										<button
											key={pair.pairId}
											type="button"
											onClick={() => {
												setSelectedPairId(pair.pairId);
												if (pair.left) setSelectedLeftScanId(pair.left.id);
												if (pair.right) setSelectedRightScanId(pair.right.id);
											}}
											className={cn(
												'flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition',
												(selectedPairId === pair.pairId || (!selectedPairId && activePair?.pairId === pair.pairId))
													? 'border-ui-accent bg-[rgba(99,247,214,0.16)] text-foreground'
													: 'border-ui-border bg-[rgba(255,255,255,0.02)] text-ui-text hover:bg-[rgba(255,255,255,0.04)]'
											)}
										>
											<div className="flex flex-col">
												<span className="text-sm font-semibold">{pair.name}</span>
												<span className="text-[11px] uppercase text-ui-muted">
													{pair.left ? 'Links' : ''}{pair.left && pair.right ? ' & ' : ''}{pair.right ? 'Rechts' : ''}
												</span>
											</div>
											<div className="flex gap-1">
												{pair.left && (
													<span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">L</span>
												)}
												{pair.right && (
													<span className="rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-purple-400">R</span>
												)}
											</div>
										</button>
									))}
								</div>
							</>
						)}
					</div>
					<div className="h-[60vh] bg-[rgba(255,255,255,0.02)]">
						{leftScan || rightScan ? (
							<div className="grid h-full grid-cols-2 divide-x divide-ui-border">
								<div className="relative h-full bg-[rgba(255,255,255,0.01)]">
									{leftScan?.stlUrl ? (
										<MiniSTLPreview url={leftScan.stlUrl} />
									) : (
										<div className="flex h-full items-center justify-center text-sm text-ui-muted">Geen linker scan</div>
									)}
									<div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-ui-muted">
										Links
									</div>
								</div>
								<div className="relative h-full bg-[rgba(255,255,255,0.01)]">
									{rightScan?.stlUrl ? (
										<MiniSTLPreview url={rightScan.stlUrl} />
									) : (
										<div className="flex h-full items-center justify-center text-sm text-ui-muted">Geen rechter scan</div>
									)}
									<div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-ui-muted">
										Rechts
									</div>
								</div>
							</div>
						) : (
							<div className="flex h-full items-center justify-center text-sm text-ui-muted">
								Upload scans om een preview te zien
							</div>
						)}
					</div>
				</div>
			</BaseModal>

			{/* Elements modal */}
			<ElementsModal
				open={elementsModalOpen}
				onClose={() => setElementsModalOpen(false)}
				side={elementsModalSide}
				onAdd={(libraryKey) => {
					addPlacedElement(libraryKey, elementsModalSide);
				}}
			/>

			{/* Milling mode selector modal (Frezen: EVA) */}
			{showMillingModeSelector && (
				<MillingModeSelector
					selectedMode={cncState.millingMode}
					onSelect={handleSelectMillingMode}
					onClose={() => setShowMillingModeSelector(false)}
				/>
			)}

			{/* Upload scans modal */}
			<UploadScansModal
				open={showUploadScansModal}
				onClose={() => setShowUploadScansModal(false)}
				projectId={projectId}
				onUploadComplete={(newScans) => {
					setProjectScans((prev) => [...prev, ...newScans.map((s) => ({
						id: s.id,
						name: s.name,
						pairId: s.pairId,
						footSide: s.footSide.toUpperCase(),
						stlUrl: s.stlUrl,
					}))]);
					// Select the newly uploaded pair
					if (newScans.length > 0) {
						setSelectedPairId(newScans[0].pairId);
						const newLeft = newScans.find(s => s.footSide.toLowerCase() === 'left');
						const newRight = newScans.find(s => s.footSide.toLowerCase() === 'right');
						if (newLeft) setSelectedLeftScanId(newLeft.id);
						if (newRight) setSelectedRightScanId(newRight.id);
					}
					setShowUploadScansModal(false);
					// Re-open scan selection modal to show the new scans
					setShowScanModal(true);
				}}
			/>
		</>
	);
}

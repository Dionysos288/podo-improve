'use client';

import dynamic from 'next/dynamic';
import { useRef, useState, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import Link from 'next/link';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import { ViewOverlay } from '@/src/shared/components/design/ViewOverlay';
import { StepRail } from '@/src/shared/components/design/StepRail';
import { GeneratedInsoleOverlay } from '@/src/shared/components/design/GeneratedInsoleOverlay';
import {
	BoxEditToolsOverlay,
	type BoxEditTool,
} from '@/src/shared/components/design/BoxEditToolsOverlay';
import { BoxEditConfirmOverlay } from '@/src/shared/components/design/BoxEditConfirmOverlay';
import {
	DirectProducePanel,
	type PrinterSettings,
} from '@/src/shared/components/design/DirectProducePanel';
import {
	OntwerpPanel,
	type OntwerpCorrections,
} from '@/src/shared/components/design/OntwerpPanel';
import { BaseModal } from '@/src/shared/components/ui/modal';
import { AddCorrectionModal } from '@/src/shared/components/design/AddCorrectionModal';
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
import { extractPlantarSurface } from '@/src/features/design/utils/plantarExtraction';
import type {
	ThreePointLandmarks,
	CompleteLandmarkSet,
} from '@/src/features/design/types/types';
import { exportGeometryToSTLBinary } from '@/src/features/design/utils/stlExport';
import type {
	EnhancedSTLViewerRef,
	BottomTextOverlay,
} from '@/src/features/design/components/EnhancedSTLViewer';

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
		footSide: string;
		stlUrl: string;
	}>;
}

type WorkflowStep = 'base' | 'stl-select' | 'point-pick' | 'dynamic-edit';

// Default foot-scan STL files (used when no patient scans are available)
const DEFAULT_LEFT_STL = '/STL/Ekrem_Zeneli_055037_000528_L.stl';
const DEFAULT_RIGHT_STL = '/STL/Ekrem_Zeneli_055037_000528_R.stl';

// Existing editable base insoles (used in Basis/Ontwerp workflow)
const DEFAULT_BASE_LEFT_STL = '/base/(Amina) Ruymen - voor Dion_L.stl';
const DEFAULT_BASE_RIGHT_STL = '/base/(Amina) Ruymen - voor Dion_R.stl';

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
			archMm: clamp(fallbackArchMm, 2, 16),
			cupMm: clamp(fallbackArchMm * 0.55, 1, 12),
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

	const archByForefoot = clamp(4 + m2OffsetMm * 0.45, 2, 16);
	const archByWidth = clamp(5 + ((forefootWidthMm - 80) * 0.08), 2, 16);
	// Step 2 refine: combine point biomechanics + STL geometry estimate
	const archMm = clamp((fallbackArchMm * 0.65) + (archByForefoot * 0.2) + (archByWidth * 0.15), 2, 16);
	const cupMm = clamp(2 + ((lateralSpanMm - 24) * 0.1), 1, 10);
	// EU size estimate from foot length + functional toe allowance (~15mm)
	const rawShoeSizeEu = ((footLengthMm + 15) * 1.5) / 10;
	const plausibleLength = footLengthMm >= 180 && footLengthMm <= 340;
	const shoeSizeEu = plausibleLength ? clamp(rawShoeSizeEu, 32, 52) : 40;

	const pronationMm = deltaDeg > 0 ? clamp(deltaDeg * 0.25, 0, 6) : 0;
	const supinationMm = deltaDeg < 0 ? clamp(Math.abs(deltaDeg) * 0.25, 0, 6) : 0;

	return {
		archMm: Number.isFinite(archMm) ? archMm : clamp(fallbackArchMm, 2, 16),
		cupMm,
		shoeSizeEu,
		pronationMm,
		supinationMm,
	};
};

interface DesignPageClientProps {
	project: ProjectDetail;
	orgSlug: string;
}

export function DesignPageClient({ project, orgSlug }: DesignPageClientProps) {
	const projectId = project.id;
	const viewerRef = useRef<EnhancedSTLViewerRef>(null);
	const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('base');
	const [selectedLeftScanId, setSelectedLeftScanId] = useState<string | null>(
		null
	);
	const [selectedRightScanId, setSelectedRightScanId] = useState<string | null>(
		null
	);
	const { selectedTemplate, setSelectedTemplate, parameters, setParameters } =
		useDesignStore();
	const [activeDesignStep, setActiveDesignStep] = useState<number>(1);
	const [leftPanelTab, setLeftPanelTab] = useState<'view' | 'analysis'>('view');
	const [viewerViewPreset, setViewerViewPreset] = useState<
		'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'
	>('iso');
	const [viewerControlMode, setViewerControlMode] = useState<'rotate' | 'pan'>(
		'rotate'
	);
	const [analysisProbe, setAnalysisProbe] = useState<{
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
	const [planWorldToMm, setPlanWorldToMm] = useState(1);
	const rightFittingRef = useRef<{
		archHeight: number;
		cupHeight: number;
		shoeSize: number;
		pronation: number;
		supination: number;
	} | null>(null);
	const [isFitting, setIsFitting] = useState(false);
	const [designPlan, setDesignPlan] = useState<{
		plan: ReturnType<typeof buildInsolePlan> | null;
		points: LandmarkPoints | null;
	}>({ plan: null, points: null });
	const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(
		null
	);
	const [viewSettings, setViewSettings] = useState({
		showLeft: true,
		showRight: true,
		transparent: false,
		heatmap: false,
		showInsoles: true,
		showModel: true,
	});

	const defaultGeneral = useMemo(
		() => ({
			sizeLabel: 'EU' as const,
			shoeSize: { left: 40, right: 40 },
			soleThicknessMm: { left: 2, right: 2 },
			maxInsoleHeightMm: { left: 10, right: 10 },
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
			shoeSize: normalizeLR(general.shoeSize, defaultGeneral.shoeSize),
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
	const [printerSettings, setPrinterSettings] = useState<PrinterSettings>({
		brand: 'Raise3D',
		printer: 'E2',
		material: 'Footprint3D TPU-95A 2.3KG',
		nozzle: '0.8',
		extruder: 'Links',
		topLayers: 1,
		bottomLayers: 2,
		adhesion: 'Geen',
	});
	const [showScanModal, setShowScanModal] = useState(false);
	const [step4View, setStep4View] = useState<'export' | 'directProduce'>(
		'export'
	);
	const [productionMethod, setProductionMethod] = useState('Printer: Solid');
	const [selectedBaseSTL, setSelectedBaseSTL] = useState<string | null>(null);
	const [corrections, setCorrections] = useState<OntwerpCorrections | undefined>(undefined);
	const [showZones, setShowZones] = useState(false);
	const [addCorrectionOpen, setAddCorrectionOpen] = useState(false);
	const addCorrectionAnchorRef = useRef<HTMLDivElement | null>(null);
	const [activeCorrections, setActiveCorrections] = useState<CorrectionKey[]>(
		DEFAULT_ACTIVE_CORRECTIONS
	);
	const [textEditorOpen, setTextEditorOpen] = useState(false);
	const [savedBottomText, setSavedBottomText] = useState<
		{ text: string; sizeMm: number } | null
	>(null);
	const [draftBottomText, setDraftBottomText] = useState<
		{ text: string; sizeMm: number }
	>({ text: '', sizeMm: 10 });

	const [selectedInsoleSide, setSelectedInsoleSide] = useState<'left' | 'right' | null>(null);
	const [boxEnabled, setBoxEnabled] = useState<{ left: boolean; right: boolean }>({
		left: false,
		right: false,
	});
	const isSelectedGridModeOn = selectedInsoleSide
		? boxEnabled[selectedInsoleSide]
		: false;
	const [boxEditTool, setBoxEditTool] = useState<BoxEditTool>('rotate');
	const toggleCorrection = useCallback((key: CorrectionKey) => {
		setActiveCorrections((prev) => {
			const has = prev.includes(key);
			const next = has ? prev.filter((k) => k !== key) : [...prev, key];
			if (!has && key === 'tekst') {
				setLeftPanelTab('view');
				setViewerViewPreset('bottom');
				setAddCorrectionOpen(false);
				setDraftBottomText(
					savedBottomText ?? {
						text: 'PODO',
						sizeMm: 10,
					}
				);
				setTextEditorOpen(true);
			}
			return next;
		});
	}, [savedBottomText]);

	const bottomTextOverlay: BottomTextOverlay | undefined = useMemo(() => {
		if (!activeCorrections.includes('tekst')) return undefined;
		if (textEditorOpen) {
			return {
				enabled: true,
				text: draftBottomText.text,
				sizeMm: draftBottomText.sizeMm,
				orientation: 'vertical',
			};
		}
		if (!savedBottomText) return undefined;
		return {
			enabled: true,
			text: savedBottomText.text,
			sizeMm: savedBottomText.sizeMm,
			orientation: 'vertical',
		};
	}, [activeCorrections, textEditorOpen, draftBottomText, savedBottomText]);

	const mirrorCorrectionsToOtherSide = useCallback(
		(from: 'left' | 'right') => {
			if (!corrections) return;
			const to: 'left' | 'right' = from === 'left' ? 'right' : 'left';
			setCorrections({
				...corrections,
				kuipHoogte: { ...corrections.kuipHoogte, [to]: corrections.kuipHoogte[from] },
				hielHeffing: {
					...corrections.hielHeffing,
					length: {
						...corrections.hielHeffing.length,
						[to]: corrections.hielHeffing.length[from],
					},
					value: {
						...corrections.hielHeffing.value,
						[to]: corrections.hielHeffing.value[from],
					},
				},
				medialeBoogCorrectie: {
					...corrections.medialeBoogCorrectie,
					[to]: corrections.medialeBoogCorrectie[from],
				},
				pronatie: {
					...corrections.pronatie,
					regio: {
						...corrections.pronatie.regio,
						[to]: corrections.pronatie.regio[from],
					},
					correctie: {
						...corrections.pronatie.correctie,
						[to]: corrections.pronatie.correctie[from],
					},
				},
				supinatie: {
					...corrections.supinatie,
					regio: {
						...corrections.supinatie.regio,
						[to]: corrections.supinatie.regio[from],
					},
					correctie: {
						...corrections.supinatie.correctie,
						[to]: corrections.supinatie.correctie[from],
					},
				},
			});

			setBoxEnabled((prev) => ({ ...prev, [to]: prev[from] }));
		},
		[corrections]
	);

	const exitGridMode = useCallback(() => {
		if (!selectedInsoleSide) return;
		setBoxEnabled((prev) => ({ ...prev, [selectedInsoleSide]: false }));
	}, [selectedInsoleSide]);
	
	// Normalize scans: footSide from DB is uppercase ('LEFT'/'RIGHT'), normalize to lowercase
	const scans = useMemo(
		() =>
			(project.scans ?? []).map((s) => ({
				...s,
				footSide: s.footSide.toLowerCase(),
			})),
		[project.scans]
	);
	const orderedScans = useMemo(
		() => scans.slice().sort((a, b) => a.footSide.localeCompare(b.footSide)),
		[scans]
	);
	const selectedLeftScan = selectedLeftScanId
		? scans.find((s) => s.id === selectedLeftScanId)
		: null;
	const selectedRightScan = selectedRightScanId
		? scans.find((s) => s.id === selectedRightScanId)
		: null;
	const leftScan =
		selectedLeftScan ??
		orderedScans.find((s) => s.footSide === 'left') ??
		null;
	const rightScan =
		selectedRightScan ??
		orderedScans.find((s) => s.footSide === 'right') ??
		null;

	// Use patient scans when available, fall back to default STL files
	const leftStlUrl = leftScan?.stlUrl ?? DEFAULT_LEFT_STL;
	const rightStlUrl = rightScan?.stlUrl ?? DEFAULT_RIGHT_STL;

	const mockDateLabel = '12 dec 2024';
	const currentPointStep = POINT_SEQUENCE[pointStepIndex];

	const {
		setThreePointLandmarks,
		setDerivedLandmarks,
		setCompleteLandmarks,
		setFootGeometry,
		setPlantarData,
		setIsGeneratingInsole,
		clearLandmarkPipeline,
	} = useDesignStore();

	const startPointPicking = useCallback(() => {
		setRightPointSelections({});
		setLeftPointSelections({});
		setPointStepIndex(0);
		setPointPickFoot('right');
		setPlanWorldToMm(1);
		rightFittingRef.current = null;
		setShowOverlays(false);
		viewerRef.current?.setPrecisionInsole?.(null);
		clearLandmarkPipeline();
		setWorkflowStep('point-pick');
	}, [clearLandmarkPipeline]);

	const handleCancelPointPick = useCallback(() => {
		setRightPointSelections({});
		setLeftPointSelections({});
		setPointStepIndex(0);
		setPointPickFoot('right');
		setPlanWorldToMm(1);
		rightFittingRef.current = null;
		viewerRef.current?.setPrecisionInsole?.(null);
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

						const plantar = extractPlantarSurface(geom, fg, 1.0);
						setPlantarData(plantar);

						const seeds = deriveSeedFromPickedPoints(
							updatedSelections,
							clamp(fg.archHeight * worldToMm * 0.12, 2, 14),
							worldToMm
						);
						rightFittingRef.current = {
							archHeight: seeds.archMm,
							cupHeight: seeds.cupMm,
							shoeSize: seeds.shoeSizeEu,
							pronation: seeds.pronationMm,
							supination: seeds.supinationMm,
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
						const seeds = deriveSeedFromPickedPoints(
							updatedSelections,
							clamp(fg.archHeight * leftWorldToMm * 0.12, 2, 14),
							leftWorldToMm
						);
						leftArchMm = seeds.archMm;
						leftCupMm = seeds.cupMm;
						leftShoeSize = seeds.shoeSizeEu;
						leftPronation = seeds.pronationMm;
						leftSupination = seeds.supinationMm;
					} catch (err) {
						console.error('Left foot fitting failed:', err);
					}
				}

				// Gather right foot fitting from earlier
				const rightFitting = rightFittingRef.current;
				const rightArchMm = rightFitting?.archHeight ?? generalNormalized.maxInsoleHeightMm.right;
				const rightCupMm = rightFitting?.cupHeight ?? 0;
				const rightShoeSize = rightFitting?.shoeSize ?? generalNormalized.shoeSize.right;
				const rightPronation = rightFitting?.pronation ?? 0;
				const rightSupination = rightFitting?.supination ?? 0;

				// Seed parameters from both feet
				setParameters({
					...parameters,
					general: {
						...generalNormalized,
						shoeSize: {
							left: leftShoeSize,
							right: rightShoeSize,
						},
						maxInsoleHeightMm: {
							left: leftArchMm,
							right: rightArchMm,
						},
					},
				});

				setCorrections((prev) => {
					const next = prev ?? {
						kuipHoogte: { left: 0, right: 0 },
						voorvoetUitvlakken: { enabled: false },
						hielHeffing: {
							length: { left: 'lang', right: 'lang' },
							value: { left: 0, right: 0 },
						},
						medialeBoogCorrectie: { left: 0, right: 0 },
						gladstrijken: 0,
						pronatie: {
							regio: { left: 'hiel', right: 'hiel' },
							correctie: { left: 0, right: 0 },
						},
						supinatie: {
							regio: { left: 'hiel', right: 'hiel' },
							correctie: { left: 0, right: 0 },
						},
					};
					return {
						...next,
						kuipHoogte: {
							left: leftCupMm,
							right: rightCupMm,
						},
						medialeBoogCorrectie: {
							left: leftArchMm,
							right: rightArchMm,
						},
						pronatie: {
							...next.pronatie,
							regio: {
								...next.pronatie.regio,
								left: 'hiel',
								right: 'hiel',
							},
							correctie: {
								...next.pronatie.correctie,
								left: leftPronation,
								right: rightPronation,
							},
						},
						supinatie: {
							...next.supinatie,
							regio: {
								...next.supinatie.regio,
								left: 'hiel',
								right: 'hiel',
							},
							correctie: {
								...next.supinatie.correctie,
								left: leftSupination,
								right: rightSupination,
							},
						},
					};
				});

				viewerRef.current?.setPrecisionInsole?.(null);
				setScansActive(true);
				setShowOverlays(true);
				setWorkflowStep('base');
				setActiveDesignStep(2);
				setTimeout(() => {
					setIsFitting(false);
					setIsGeneratingInsole(false);
				}, 1200);
			} else {
				setPointStepIndex((prev) => prev + 1);
			}
		},
		[workflowStep, pointStepIndex, pointPickFoot, rightPointSelections, leftPointSelections, setThreePointLandmarks, setFootGeometry, setDerivedLandmarks, setCompleteLandmarks, setPlantarData, setIsGeneratingInsole, setParameters, parameters, generalNormalized]
	);

	const handleExportSTL = useCallback(() => {
		const geometry = viewerRef.current?.getInsoleGeometry();
		if (!geometry) {
			alert(
				'Geen steunzool beschikbaar om te exporteren. Voltooi eerst het ontwerp.'
			);
			return;
		}

		const patientName = project?.patient
			? `${project.patient.firstName}_${project.patient.lastName}`
			: 'insole';
		const filename = `${patientName}_steunzool_${projectId}.stl`;

		exportGeometryToSTLBinary(geometry, filename);
	}, [project, projectId]);

	const handleToggleViewSetting = useCallback(
		(key: keyof typeof viewSettings) => {
			setViewSettings((prev) => ({ ...prev, [key]: !prev[key] }));
		},
		[]
	);

	const handleOverlayView = useCallback(
		(preset: string) => {
			if (preset === 'rotate') {
				setViewerControlMode('rotate');
				return;
			}
			if (preset === 'pan') {
				setViewerControlMode('pan');
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
				setViewerControlMode('rotate');
			}
		},
		[]
	);

	const renderStepContent = () => {
		switch (activeDesignStep) {
			case 1:
				return (
					<Card>
						<CardContent>
							<label className="flex flex-col gap-1">
								<span className="text-xs uppercase tracking-wide text-ui-text/70">
									Patroon
								</span>
								<select
									className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-ui-text"
									value={selectedTemplate ?? 'classic'}
									onChange={(event) => setSelectedTemplate(event.target.value)}
								>
									{[
										'classic',
										'dunes',
										'finncomfort',
										'man',
										'woman',
										'3quarter',
									].map((option) => (
										<option key={option} value={option}>
											{option}
										</option>
									))}
								</select>
							</label>

							<label className="flex flex-col gap-1">
								<span className="text-xs uppercase tracking-wide text-(--ui-text)/70">
									Productiemethode
								</span>
								<select
									className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-ui-text"
									value={productionMethod}
									onChange={(event) => setProductionMethod(event.target.value)}
								>
									<option value="Printer: Solid">Printer: Solid</option>
									<option value="Frezen: EVA">Frezen: EVA</option>
								</select>
							</label>

							<label className="flex flex-col gap-1">
								<span className="text-xs uppercase tracking-wide text-ui-text/70">
									3D Printer
								</span>
								<select
									className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-ui-text"
									value={printerSettings.printer}
									onChange={(event) =>
										setPrinterSettings((prev) => ({
											...prev,
											printer: event.target.value,
										}))
									}
								>
									<option>Vertex Apex Belt V2</option>
									<option>Formlabs Fuse</option>
									<option>Raise3D Pro 3</option>
								</select>
							</label>

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
							</div>

							<div className="space-y-2">
								<p className="text-xs uppercase tracking-wide text-ui-text/70">
									Elementen
								</p>
								<div className="flex items-center gap-2">
									<span className="ui-chip rounded-full px-3 py-1 text-xs font-semibold">
										Steunzool
									</span>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setActiveDesignStep(2)}
									>
										Toevoegen
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>
				);

			case 2:
				return (
					<Card>
						<CardContent>
							<div className="pb-4">
								<h4 className="text-sm font-semibold text-ui-accent">
									Algemeen
								</h4>
								<div className="mt-3 space-y-2 text-sm">
									<label className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
										<span>Maatlabel</span>
										<select
											className="rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-2 py-1 text-sm text-ui-text"
											value={generalNormalized.sizeLabel}
											onChange={(e) =>
												updateGeneral({ sizeLabel: e.target.value as 'EU' | 'US' | 'UK' })
											}
										>
											<option value="EU">EU</option>
											<option value="US">US</option>
											<option value="UK">UK</option>
										</select>
									</label>
									<div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
										<div className="flex items-center justify-between">
											<span>Schoenmaat</span>
											<span className="text-[11px] text-ui-muted">Links / Rechts</span>
										</div>
										<div className="mt-2 grid grid-cols-2 gap-2">
											<input
												type="number"
												inputMode="decimal"
												className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-2 py-1 text-right text-sm text-ui-text"
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
												className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-2 py-1 text-right text-sm text-ui-text"
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
												className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-2 py-1 text-right text-sm text-ui-text"
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
												className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-2 py-1 text-right text-sm text-ui-text"
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
												className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-2 py-1 text-right text-sm text-ui-text"
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
												className="w-full rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-2 py-1 text-right text-sm text-ui-text"
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

							<div
								ref={addCorrectionAnchorRef}
								className="mb-3 flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm"
							>
								<span className="text-ui-text">Correctie toevoegen</span>
								<button
									type="button"
									className="h-7 w-7 rounded-full bg-ui-accent text-slate-900"
									onClick={() => setAddCorrectionOpen(true)}
								>
									+
								</button>
							</div>

							<AddCorrectionModal
								open={addCorrectionOpen}
								onClose={() => setAddCorrectionOpen(false)}
								activeCorrections={activeCorrections}
								onToggle={toggleCorrection}
								anchorRef={addCorrectionAnchorRef}
							/>

							{textEditorOpen ? (
								<div className="rounded-xl border border-ui-border bg-[rgba(255,255,255,0.03)] p-3">
									<div className="mb-3 flex items-center justify-between">
										<span className="text-sm font-semibold text-ui-text">Tekst op onderkant</span>
										<div className="flex items-center gap-2">
											<button
												type="button"
												className="rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-2 py-1 text-xs text-ui-text hover:bg-[rgba(255,255,255,0.07)]"
												onClick={() => {
													// Cancel = discard changes; if nothing saved, also remove tool.
													setDraftBottomText(
														savedBottomText ?? { text: '', sizeMm: 10 }
													);
													setTextEditorOpen(false);
													if (!savedBottomText) {
														setActiveCorrections((prev) => prev.filter((k) => k !== 'tekst'));
													}
												}}
											>
												Annuleer
											</button>
											<button
												type="button"
												className="rounded-md bg-ui-accent px-3 py-1 text-xs font-semibold text-slate-900 hover:opacity-90"
												onClick={() => {
													setSavedBottomText({
														text: draftBottomText.text,
														sizeMm: draftBottomText.sizeMm,
													});
													setTextEditorOpen(false);
												}}
											>
												Opslaan
											</button>
										</div>
									</div>

									<label className="flex flex-col gap-1">
										<span className="text-xs uppercase tracking-wide text-(--ui-text)/70">Tekst</span>
										<input
											type="text"
											className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-ui-text"
											value={draftBottomText.text}
											onChange={(e) =>
												setDraftBottomText((p) => ({ ...p, text: e.target.value }))
											}
											placeholder="Bijv. naam / ordernummer"
										/>
									</label>

										<div className="mt-3 grid grid-cols-1 gap-2">
										<label className="flex flex-col gap-1">
											<span className="text-xs uppercase tracking-wide text-(--ui-text)/70">Grootte (mm)</span>
											<input
												type="number"
												inputMode="decimal"
												className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-ui-text"
												value={draftBottomText.sizeMm}
												onChange={(e) =>
												setDraftBottomText((p) => ({
													...p,
													sizeMm: Math.max(1, Number(e.target.value) || 1),
												}))
											}
												min={1}
												max={40}
												step={0.5}
											/>
										</label>
									</div>

									<p className="mt-3 text-xs text-ui-muted">
										Live preview staat gecentreerd op de onderkant van beide steunzolen.
									</p>
								</div>
							) : (
								<>
									{activeCorrections.includes('tekst') && (
										<div className="mb-3 rounded-lg border border-ui-border bg-[rgba(255,255,255,0.03)] px-3 py-2">
											<div className="flex items-center justify-between">
												<div>
													<div className="text-sm font-semibold text-ui-text">Tekst</div>
													<div className="text-xs text-ui-muted">
														{savedBottomText?.text?.trim() ? savedBottomText.text : 'Nog geen tekst opgeslagen'}
													</div>
												</div>
												<button
													type="button"
													className="rounded-md bg-[rgba(255,255,255,0.06)] px-2 py-1 text-xs text-ui-text hover:bg-[rgba(255,255,255,0.09)]"
													onClick={() => {
														setLeftPanelTab('view');
														setViewerViewPreset('bottom');
														setDraftBottomText(
															savedBottomText ?? { text: 'PODO', sizeMm: 10 }
														);
														setTextEditorOpen(true);
													}}
												>
													Bewerken
												</button>
											</div>
										</div>
									)}

									<OntwerpPanel
										corrections={corrections}
										onCorrectionsChange={setCorrections}
										activeCorrections={activeCorrections}
										showZones={showZones}
										onShowZonesChange={setShowZones}
									/>
								</>
							)}
						</CardContent>
					</Card>
				);

			case 3:
				return (
					<Card>
						<CardContent>
							{[
								{
									key: 'brand',
									label: 'Printer merk',
									options: ['Vertex', 'Formlabs', 'Raise3D'],
								},
								{
									key: 'printer',
									label: 'Model',
									options: [
										'Vertex Apex Belt V2',
										'Formlabs Fuse',
										'Raise3D Pro 3',
									],
								},
								{
									key: 'material',
									label: 'Materiaal',
									options: ['Vertex TPU', 'TPU 95A', 'EVA Powder'],
								},
								{
									key: 'nozzle',
									label: 'Nozzle',
									options: ['0.8mm', '0.6mm', '1.0mm'],
								},
							].map(({ key, label, options }) => (
								<label key={key} className="flex flex-col gap-1">
									<span className="text-xs uppercase tracking-wide text-(--ui-text)/70">
										{label}
									</span>
									<select
										className="rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-ui-text"
										value={printerSettings[key as keyof typeof printerSettings]}
										onChange={(event) =>
											setPrinterSettings((prev) => ({
												...prev,
												[key]: event.target.value,
											}))
										}
									>
										{options.map((option) => (
											<option key={option}>{option}</option>
										))}
									</select>
								</label>
							))}
							<Button className="w-full bg-ui-accent text-slate-900 hover:opacity-90">
								Genereer toolpath preview
							</Button>
						</CardContent>
					</Card>
				);

			case 4:
				// For Frezen: EVA, keep original Step 4 content
				if (productionMethod === 'Frezen: EVA') {
					return (
						<Card>
							<CardContent className="space-y-3">
								<Button className="w-full" variant="outline">
									Export STL
								</Button>
								<Button className="w-full" variant="outline">
									Export multi-density STL
								</Button>
								<Button className="w-full bg-ui-accent text-slate-900 hover:opacity-90">
									Verzenden naar printer
								</Button>
								<p className="text-xs text-ui-muted">
									Exports bevatten shore-hardness metadata voor multi-density
									printen.
								</p>
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
							onExportSTL={handleExportSTL}
						/>
					);
				}

				return (
					<Card>
						<CardContent className="space-y-4">
							{/* Exporteren section */}
							<div className="space-y-2">
								<h4 className="text-sm font-semibold text-ui-accent flex items-center gap-2">
									<span className="text-ui-accent">✓</span>
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
									onClick={handleExportSTL}
								>
									Exporteer STL
								</Button>
							</div>

							{/* Bestellen section (collapsed) */}
							<div className="space-y-2">
								<h4 className="text-sm font-semibold text-ui-muted flex items-center gap-2">
									<span>^</span>
									Bestellen
								</h4>
							</div>

							{/* Produceren section */}
							<div className="space-y-2">
								<h4 className="text-sm font-semibold text-ui-accent flex items-center gap-2">
									<span className="text-ui-accent">✓</span>
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
								startPointPicking();
							}}
						/>
					)}

					{workflowStep === 'point-pick' && (
						<div
							className="relative h-full w-full"
							onMouseMove={(e) => {
								const rect = e.currentTarget.getBoundingClientRect();
								setCrosshair({
									x: e.clientX - rect.left,
									y: e.clientY - rect.top,
								});
							}}
							onMouseLeave={() => setCrosshair(null)}
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
							<EnhancedSTLViewer
								ref={viewerRef}
								leftUrl={DEFAULT_BASE_LEFT_STL}
								rightUrl={DEFAULT_BASE_RIGHT_STL}
								leftOverlayUrl={showOverlays ? leftStlUrl : undefined}
								rightOverlayUrl={showOverlays ? rightStlUrl : undefined}
								showGrid={true}
								showBasePreview={false}
								lockTopView={false}
								hideScans={false}
								landmarkPoints={designPlan.points ?? undefined}
								showGeneratedInsole={false}
								showZones={showZones}
								showLeft={viewSettings.showLeft}
								showRight={viewSettings.showRight}
								transparent={viewSettings.transparent}
								heatmap={viewSettings.heatmap}
								showInsoles={viewSettings.showInsoles}
								showModel={viewSettings.showModel}
								viewPreset={viewerViewPreset}
								controlMode={viewerControlMode}
								analysisEnabled={leftPanelTab === 'analysis'}
								onProbe={(payload) => setAnalysisProbe(payload)}
								corrections={corrections}
								activeCorrections={activeCorrections}
								bottomTextOverlay={bottomTextOverlay}
								textPlacementEnabled={false}
								selectedSide={selectedInsoleSide}
								onSelectSide={(side) => setSelectedInsoleSide(side)}
								onDeselectSide={() => setSelectedInsoleSide(null)}
								boxEnabled={boxEnabled}
								gridEditMode={isSelectedGridModeOn}
							/>
							{isFitting && (
								<div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-ui-border bg-ui-panel px-4 py-2 text-xs font-semibold text-ui-text shadow-lg">
									Berekenen… steunzool wordt aangepast
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
								analysisHeightMm={analysisProbe?.heightMm ?? null}
								analysisSide={analysisProbe?.side ?? null}
								className="absolute left-6 top-6 z-20"
							/>
							{selectedInsoleSide && !isSelectedGridModeOn && (
								<GeneratedInsoleOverlay
									selectedSide={selectedInsoleSide}
									boxEnabled={boxEnabled}
									onToggleBox={(side) => {
										setBoxEnabled((prev) => ({ ...prev, [side]: !prev[side] }));
										setBoxEditTool('rotate');
									}}
									onMirrorToOther={mirrorCorrectionsToOtherSide}
									className="absolute left-6 bottom-6 z-20"
								/>
							)}

							{selectedInsoleSide && isSelectedGridModeOn && (
								<>
									<BoxEditToolsOverlay
										selectedSide={selectedInsoleSide}
										activeTool={boxEditTool}
										onToolChange={setBoxEditTool}
										className="absolute left-6 bottom-6 z-20"
									/>
									<BoxEditConfirmOverlay
										onCancel={exitGridMode}
										onConfirm={exitGridMode}
										className="absolute right-6 top-6 z-20"
									/>
								</>
							)}
							{designPlan.plan && (
								<div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-ui-border bg-ui-panel/90 px-4 py-2 text-xs text-ui-text">
									Steunzool gegenereerd — lengte{' '}
									{(designPlan.plan.frame.footLength * planWorldToMm).toFixed(1)} mm, breedte{' '}
									{(designPlan.plan.frame.forefootWidth * planWorldToMm).toFixed(1)} mm, boog{' '}
									{(designPlan.plan.frame.archHeight * planWorldToMm).toFixed(1)} mm
								</div>
							)}
							{!selectedInsoleSide && (
								<div className="absolute right-4 top-4 z-20 flex h-[85vh] w-[420px] flex-col rounded-2xl border border-ui-border bg-ui-panel text-ui-text overflow-hidden">
									<StepRail
										activeStep={activeDesignStep}
										onStepChange={(step) => {
											setActiveDesignStep(step);
										}}
										stepLabels={
											productionMethod === 'Frezen: EVA'
												? { 3: 'EVA' }
												: undefined
										}
									/>

									<div className="flex-1 overflow-y-auto px-4 pb-4 pr-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[rgba(255,255,255,0.18)]">
										{renderStepContent()}
									</div>
									<div className="border-t border-ui-border px-4 py-3 flex items-center justify-end ">
										<Button
											onClick={() => setActiveDesignStep(2)}
											size="sm"
											className="bg-ui-accent text-slate-900"
										>
											Volgende
										</Button>
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
							onClick={() => {
								if (leftScan?.id) setSelectedLeftScanId(leftScan.id);
								if (rightScan?.id) setSelectedRightScanId(rightScan.id);
								startPointPicking();
								setShowScanModal(false);
							}}
						>
							{leftScan && rightScan ? 'Gebruik paar' : 'Gebruik standaard scans'}
						</Button>
						<Button onClick={() => setShowScanModal(false)} variant="ghost">
							Annuleer
						</Button>
					</>
				}
			>
				<div className="grid grid-cols-[260px_1fr]">
					<div className="border-r border-ui-border bg-[rgba(255,255,255,0.02)]">
						<div className="px-4 py-2 text-[11px] uppercase text-ui-muted">
							{mockDateLabel}
						</div>
						<div className="space-y-2 px-3 pb-3">
							<button
								type="button"
								className={cn(
									'flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition',
									leftScan && rightScan
										? 'border-ui-accent bg-[rgba(99,247,214,0.16)] text-foreground'
										: 'border-ui-border bg-[rgba(255,255,255,0.02)] text-ui-text hover:bg-[rgba(255,255,255,0.04)]'
								)}
							>
								<div className="flex flex-col">
									<span className="text-sm font-semibold">Scan-1</span>
									<span className="text-[11px] uppercase text-ui-muted">
										Links &amp; Rechts
									</span>
								</div>
								<span className="rounded-full border border-ui-border px-2 py-1 text-[11px] uppercase text-ui-muted">
									Preview
								</span>
							</button>
							{(!leftScan || !rightScan) && (
								<div className="px-1 text-xs text-ui-muted">
									Geen patiëntscans gevonden. Standaard scans worden gebruikt.
								</div>
							)}
						</div>
					</div>
					<div className="h-[60vh] bg-[rgba(255,255,255,0.02)]">
						<div className="grid h-full grid-cols-2 divide-x divide-ui-border">
							<div className="relative h-full bg-[rgba(255,255,255,0.01)]">
								<MiniSTLPreview url={leftScan?.stlUrl ?? DEFAULT_LEFT_STL} />
								<div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-ui-muted">
									Links {leftScan ? '' : '(standaard)'}
								</div>
							</div>
							<div className="relative h-full bg-[rgba(255,255,255,0.01)]">
								<MiniSTLPreview url={rightScan?.stlUrl ?? DEFAULT_RIGHT_STL} />
								<div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-ui-muted">
									Rechts {rightScan ? '' : '(standaard)'}
								</div>
							</div>
						</div>
					</div>
				</div>
			</BaseModal>
		</>
	);
}

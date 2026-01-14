'use client';

import dynamic from 'next/dynamic';
import { useRef, useState, useCallback } from 'react';
import { Card, CardContent } from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import Link from 'next/link';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import { ViewOverlay } from '@/src/shared/components/design/ViewOverlay';
import { StepRail } from '@/src/shared/components/design/StepRail';
import {
	DirectProducePanel,
	type PrinterSettings,
} from '@/src/shared/components/design/DirectProducePanel';
import { BaseModal } from '@/src/shared/components/ui/modal';
import { cn } from '@/src/shared/lib/cn';
import {
	buildInsolePlan,
	type LandmarkPoints,
} from '@/src/features/design/utils/landmarkFitting';
import { exportGeometryToSTLBinary } from '@/src/features/design/utils/stlExport';
import type { EnhancedSTLViewerRef } from '@/src/features/design/components/EnhancedSTLViewer';

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

type WorkflowStep = 'base' | 'stl-select' | 'point-pick';

const POINT_SEQUENCE = [
	{ id: 'meta1', label: 'Klik op metatarsaal punt 1' },
	{ id: 'meta5', label: 'Klik op metatarsaal punt 5' },
	{ id: 'navicular', label: 'Klik op naviculaire punt' },
	{ id: 'calcaneus', label: 'Klik op calcaneus punt' },
	{ id: 'heel', label: 'Klik op midden van de hiel' },
];

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
	const { selectedTemplate, setSelectedTemplate } = useDesignStore();
	const [activeDesignStep, setActiveDesignStep] = useState<number>(1);
	const [leftPanelTab, setLeftPanelTab] = useState<'view' | 'analysis'>('view');
	const [pointStepIndex, setPointStepIndex] = useState(0);
	const [pointSelections, setPointSelections] = useState<
		Record<string, [number, number, number]>
	>({});
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

	const scans = project.scans ?? [];
	const orderedScans = scans
		.slice()
		.sort((a, b) => a.footSide.localeCompare(b.footSide));
	const selectedLeftScan = selectedLeftScanId
		? scans.find((s) => s.id === selectedLeftScanId)
		: null;
	const selectedRightScan = selectedRightScanId
		? scans.find((s) => s.id === selectedRightScanId)
		: null;
	const leftScan =
		selectedLeftScan ??
		orderedScans.find((s) => s.footSide === 'left') ??
		orderedScans[0] ??
		null;
	const rightScan =
		selectedRightScan ??
		orderedScans.find((s) => s.footSide === 'right') ??
		orderedScans[1] ??
		null;

	const mockDateLabel = '12 dec 2024';
	const currentPointStep = POINT_SEQUENCE[pointStepIndex];

	const startPointPicking = useCallback(() => {
		setPointSelections({});
		setPointStepIndex(0);
		setWorkflowStep('point-pick');
	}, []);

	const handleCancelPointPick = useCallback(() => {
		setPointSelections({});
		setPointStepIndex(0);
		setWorkflowStep('base');
	}, []);

	const handlePointPicked = useCallback(
		(point: [number, number, number]) => {
			if (workflowStep !== 'point-pick') return;
			const step = POINT_SEQUENCE[pointStepIndex];
			if (!step) return;

			setPointSelections((prev) => ({
				...prev,
				[step.id]: point,
			}));

			const isLast = pointStepIndex >= POINT_SEQUENCE.length - 1;
			if (isLast) {
				setPointStepIndex(0);
				setIsFitting(true);
				const allPoints = {
					...pointSelections,
					[step.id]: point,
				} as LandmarkPoints;
				const plan = buildInsolePlan(allPoints);
				setDesignPlan({ plan, points: allPoints });
				setWorkflowStep('base');
				setTimeout(() => setIsFitting(false), 1200);
			} else {
				setPointStepIndex((prev) => prev + 1);
			}
		},
		[workflowStep, pointStepIndex, pointSelections]
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
										{selectedLeftScan ? 'Links ✓' : 'Links —'} /{' '}
										{selectedRightScan ? 'Rechts ✓' : 'Rechts —'}
									</span>
									<span className="text-xs uppercase text-ui-muted">
										Beheer scans
									</span>
								</button>
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
							<div className=" pb-4">
								<h4 className="text-sm font-semibold text-ui-accent">
									Algemeen
								</h4>
								<div className="mt-3 space-y-2 text-sm">
									<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
										<span>Maatlabel</span>
										<div className="flex items-center gap-2 text-ui-muted">
											<span>EU</span>
											<span aria-hidden="true">🔒</span>
										</div>
									</div>
									<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
										<span>Schoenmaat</span>
										<div className="flex items-center gap-2 text-ui-muted">
											<span>40</span>
											<span aria-hidden="true">🔒</span>
										</div>
									</div>
									<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
										<span>Zooldikte</span>
										<div className="flex items-center gap-1 text-ui-muted">
											<span>2</span>
											<span className="text-[11px]">mm</span>
											<span aria-hidden="true">🔒</span>
										</div>
									</div>
									<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
										<span>Steunzolen hoogte</span>
										<div className="flex items-center gap-1 text-ui-muted">
											<span>10</span>
											<span className="text-[11px]">mm</span>
											<span aria-hidden="true">🔒</span>
										</div>
									</div>
								</div>
							</div>

							<div className="mb-3 flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm">
								<span className="text-(--ui-text)">Correctie toevoegen</span>
								<button
									type="button"
									className="h-7 w-7 rounded-full bg-ui-accent text-slate-900"
								>
									+
								</button>
							</div>

							<div className="space-y-3 text-sm">
								{[
									'Kuip hoogte',
									'Voorvoet uitvlakken',
									'Hiel heffing',
									'Mediale boog correctie',
									'Gladstrijken',
									'Pronatie',
									'Supinatie',
								].map((label) => (
									<div
										key={label}
										className="rounded-lg border border-ui-border bg-background/0.02 px-3 py-2"
									>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2 text-ui-text">
												<span className="text-ui-accent">▸</span>
												<span className="font-semibold">{label}</span>
											</div>
											<button
												type="button"
												className="text-ui-muted transition hover:text-ui-accent"
											>
												♥
											</button>
										</div>
										<div className="mt-2 flex items-center gap-3 text-ui-muted">
											<span className="text-[11px] uppercase">Mock</span>
											<div className="flex items-center gap-1 rounded bg-[rgba(255,255,255,0.04)] px-2 py-1">
												<span className="text-xs text-(--ui-text)">0</span>
												<span className="text-[11px]">mm</span>
											</div>
										</div>
									</div>
								))}
							</div>
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
								rightUrl={selectedRightScan?.stlUrl}
								showGrid={false}
								showBasePreview={false}
								lockTopView={true}
								hideScans={false}
								pointPickMode
								onPickPoint={handlePointPicked}
								pickedPoints={Object.values(pointSelections)}
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
							<div className="absolute right-4 top-4 z-20 w-[320px] rounded-2xl border border-ui-border bg-ui-panel text-ui-text shadow-lg">
								<div className="flex items-center justify-between border-b border-ui-border px-4 py-3">
									<span className="text-xs uppercase tracking-wide text-ui-muted">
										Actie
									</span>
									<Button
										size="sm"
										className="bg-emerald-400 text-slate-900 hover:opacity-90"
										onClick={handleCancelPointPick}
									>
										Annuleer
									</Button>
								</div>
								<div className="px-4 py-4 space-y-3">
									<p className="text-sm font-semibold">
										{currentPointStep?.label ?? 'Selecteer punt'}
									</p>
									<div className="flex items-center gap-2">
										{POINT_SEQUENCE.map((step, idx) => (
											<span
												key={step.id}
												className={cn(
													'h-2 w-2 rounded-full',
													idx < pointStepIndex
														? 'bg-ui-accent'
														: idx === pointStepIndex
															? 'bg-white'
															: 'bg-ui-muted/40'
												)}
											/>
										))}
									</div>
								</div>
							</div>
						</div>
					)}

					{workflowStep === 'base' && (
						<div className="relative h-full w-full">
							<EnhancedSTLViewer
								ref={viewerRef}
								leftUrl={selectedLeftScan?.stlUrl}
								rightUrl={selectedRightScan?.stlUrl}
								showGrid={true}
								showBasePreview={!designPlan.plan}
								lockTopView={false}
								hideScans={false}
								landmarkPoints={designPlan.points ?? undefined}
								showGeneratedInsole={Boolean(designPlan.plan)}
							/>
							{isFitting && (
								<div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-ui-border bg-ui-panel px-4 py-2 text-xs font-semibold text-ui-text shadow-lg">
									Berekenen… steunzool wordt aangepast
								</div>
							)}
							<ViewOverlay
								tab={leftPanelTab}
								onTabChange={setLeftPanelTab}
								viewSettings={viewSettings}
								onToggle={handleToggleViewSetting}
								className="absolute left-6 top-6 z-20"
							/>
							{designPlan.plan && (
								<div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-ui-border bg-ui-panel/90 px-4 py-2 text-xs text-ui-text">
									Insole plan klaar (arch hoogte{' '}
									{designPlan.plan.frame.archHeight.toFixed(1)} mm, lengte{' '}
									{designPlan.plan.frame.footLength.toFixed(1)} mm)
								</div>
							)}
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
							disabled={!leftScan || !rightScan}
						>
							Gebruik paar
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
									Voeg links en rechts scans toe om het paar te selecteren.
								</div>
							)}
						</div>
					</div>
					<div className="h-[60vh] bg-[rgba(255,255,255,0.02)]">
						<div className="grid h-full grid-cols-2 divide-x divide-ui-border">
							<div className="h-full bg-[rgba(255,255,255,0.01)]">
								<MiniSTLPreview url={leftScan?.stlUrl} />
							</div>
							<div className="h-full bg-[rgba(255,255,255,0.01)]">
								<MiniSTLPreview url={rightScan?.stlUrl} />
							</div>
						</div>
					</div>
				</div>
			</BaseModal>
		</>
	);
}

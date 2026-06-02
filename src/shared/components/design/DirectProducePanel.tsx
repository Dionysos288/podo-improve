'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Card, CardContent } from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { InlineSelect } from '@/src/shared/components/ui/select';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { PrinterModel } from '@/src/features/settings/types/settings';
import type { FilamentType } from '@/src/features/printers/constants/print-options';
import type { PrintMaterialItem } from '@/src/features/printers/types/printers';
import {
	getPrinterCapability,
	resolveNozzleOptionValue,
} from '@/src/features/printers/constants/printer-capabilities';
import { CustomMaterialModal, type CustomMaterialDraft } from './CustomMaterialModal';

interface PrinterConfig {
	slicer?: {
		engine?: 'prusaslicer';
		configured?: boolean;
		agentOnline?: boolean;
		agentLastSeenAt?: string | null;
	};
	prusaSlicer?: { configured?: boolean; usingBuiltInDefaultProfile?: boolean };
}

export type MaterialOption = {
	value: string;
	label: string;
	isCustomSlot?: boolean;
	/** DB id for org materials; absent for hardcoded fallbacks. */
	materialId?: string;
	/** User-created custom material (editable/deletable), not a seeded default. */
	isUserCustom?: boolean;
	filamentType?: string;
	nozzleTempC?: number | null;
	bedTempC?: number | null;
	maxSpeedMmS?: number | null;
};

export interface PrinterSettings {
	printerModel: PrinterModel;
	brand: string;
	printer: string;
	material: string;
	nozzle: string;
	extruder?: string;
	topLayers?: number;
	bottomLayers?: number;
	adhesion?: string;
	strategy?: string;
	infill?: string;
	filamentType?: string;
	customMaterialLabel?: string;
	materialNozzleTempC?: number;
	materialBedTempC?: number;
	materialMaxSpeedMmS?: number;
	// IR3 V2 specific
	beltAngleDeg?: number;
	beltNormalOffsetMm?: number;
	ir3MaxBeltLengthMm?: number;
	// Step 3 – print preparation (per-side)
	step3?: {
		left: Step3SideSettings;
		right: Step3SideSettings;
	};
}

export interface Step3SideSettings {
	heelEdgeThicknessMm: number;
	elementsSplit: boolean;
	infillPercent?: number;
	infillFrontPercent?: number;
	infillMiddlePercent?: number;
	infillBackPercent?: number;
}

// ---------- Raise3D E2 defaults ----------
const DEFAULT_RAISE3D_SETTINGS: PrinterSettings = {
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

// ---------- IdeaFormer IR3 V2 defaults ----------
const DEFAULT_IR3_SETTINGS: PrinterSettings = {
	printerModel: 'ir3-v2',
	brand: 'IdeaFormer',
	printer: 'IR3 V2',
	material: 'TPU 95A',
	nozzle: '0.4',
	topLayers: 3,
	bottomLayers: 3,
	adhesion: 'Geen',
	beltAngleDeg: 45,
	beltNormalOffsetMm: -0.15,
	ir3MaxBeltLengthMm: 1000,
};

const PRINTER_MODEL_OPTIONS: { value: PrinterModel; label: string }[] = [
	{ value: 'raise3d-e2', label: 'Raise3D E2' },
	{ value: 'ir3-v2', label: 'IdeaFormer IR3 V2' },
];

const MATERIAL_OPTIONS_RAISE3D = [
	'Footprint3D TPU-95A 2.3KG',
	'TPU 95A',
	'TPU 85A',
	'Vertex TPU',
	'EVA Powder',
	'Custom',
];

const MATERIAL_OPTIONS_IR3 = [
	'TPU 95A',
	'TPU 85A',
	'PLA',
	'PETG',
	'ABS',
	'Custom',
];

const EXTRUDER_OPTIONS = ['Links', 'Rechts'];

const ADHESION_OPTIONS = ['Geen', 'Brim', 'Raft', 'Skirt'];

interface DirectProducePanelProps {
	onBack: () => void;
	printerSettings: PrinterSettings;
	onPrinterSettingsChange: (settings: PrinterSettings) => void;
	materialOptions?: MaterialOption[];
	/** Printer to attach newly created custom materials to. */
	printerId?: string | null;
	/** Called after a custom material is created/edited so the parent can refresh options. */
	onMaterialUpserted?: (material: PrintMaterialItem) => void;
	onExportSTLLeft: () => void;
	onExportSTLRight: () => void;
	onExportSTLPair: () => void;
	onExportGcode?: () => void;
	gcodeBusy?: boolean;
}

export function DirectProducePanel({
	onBack,
	printerSettings,
	onPrinterSettingsChange,
	materialOptions: materialOptionsProp,
	printerId,
	onMaterialUpserted,
	onExportSTLLeft,
	onExportSTLRight,
	onExportSTLPair,
	onExportGcode,
	gcodeBusy = false,
}: DirectProducePanelProps) {
	const [printerConfig, setPrinterConfig] = useState<PrinterConfig | null>(
		null
	);
	const pathname = usePathname();
	const orgSlug = pathname?.split('/').filter(Boolean)[0] ?? '';
	const settingsHref = orgSlug
		? `/${orgSlug}/settings/basis`
		: '/settings/basis';
	const [customModalOpen, setCustomModalOpen] = useState(false);
	const [customModalInitial, setCustomModalInitial] =
		useState<CustomMaterialDraft | null>(null);

	// Fetch printer config on mount
	useEffect(() => {
		fetch('/api/printer/config')
			.then((res) => res.json())
			.then((data) => setPrinterConfig(data))
			.catch((err) => {
				console.error('Failed to fetch printer config:', err);
				setPrinterConfig({
					slicer: { engine: 'prusaslicer', configured: false, agentOnline: false },
					prusaSlicer: { configured: false, usingBuiltInDefaultProfile: true },
				});
			});
	}, []);

	const currentModel: PrinterModel = printerSettings.printerModel || 'raise3d-e2';
	const defaults = currentModel === 'ir3-v2' ? DEFAULT_IR3_SETTINGS : DEFAULT_RAISE3D_SETTINGS;
	const isIR3 = currentModel === 'ir3-v2';

	// Merge with appropriate defaults
	const settings: PrinterSettings = {
		...defaults,
		...printerSettings,
	};

	const fallbackMaterialNames = isIR3 ? MATERIAL_OPTIONS_IR3 : MATERIAL_OPTIONS_RAISE3D;
	const materialOptions: MaterialOption[] =
		materialOptionsProp && materialOptionsProp.length > 0
			? materialOptionsProp
			: fallbackMaterialNames.map((name) => ({ value: name, label: name }));

	const capability = useMemo(
		() => getPrinterCapability(currentModel),
		[currentModel]
	);
	const nozzleSelectOptions = useMemo(
		() =>
			capability.nozzleOptions.map((value) => ({
				value,
				label: `${value} mm`,
			})),
		[capability]
	);
	const nozzleSelectValue = resolveNozzleOptionValue(settings.nozzle, capability);

	const selectedMaterialMeta = materialOptions.find(
		(opt) => opt.value === settings.material || opt.label === settings.material
	);
	const canEditSelectedMaterial =
		selectedMaterialMeta?.isUserCustom === true && Boolean(printerId);

	const handleChange = (key: keyof PrinterSettings, value: string | number) => {
		onPrinterSettingsChange({
			...settings,
			[key]: value,
		});
	};

	const applyMaterial = (meta: MaterialOption | undefined, value: string) => {
		onPrinterSettingsChange({
			...settings,
			material: value,
			filamentType: meta?.filamentType ?? settings.filamentType,
			materialNozzleTempC: meta?.nozzleTempC ?? undefined,
			materialBedTempC: meta?.bedTempC ?? undefined,
			materialMaxSpeedMmS: meta?.maxSpeedMmS ?? undefined,
			customMaterialLabel: undefined,
		});
	};

	const handleMaterialChange = (val: string) => {
		const meta = materialOptions.find((opt) => opt.value === val);
		// "Custom" slot opens the modal to create a persistent custom material
		// instead of selecting a placeholder value.
		if (meta?.isCustomSlot && printerId) {
			setCustomModalInitial(null);
			setCustomModalOpen(true);
			return;
		}
		applyMaterial(meta, val);
	};

	const openEditCustomMaterial = () => {
		if (!selectedMaterialMeta?.materialId) return;
		setCustomModalInitial({
			materialId: selectedMaterialMeta.materialId,
			name: selectedMaterialMeta.value,
			filamentType: (selectedMaterialMeta.filamentType as FilamentType) ?? 'FLEX',
			nozzleTempC: selectedMaterialMeta.nozzleTempC ?? null,
			bedTempC: selectedMaterialMeta.bedTempC ?? null,
			maxSpeedMmS: selectedMaterialMeta.maxSpeedMmS ?? null,
		});
		setCustomModalOpen(true);
	};

	const handleCustomMaterialSaved = (material: PrintMaterialItem) => {
		onMaterialUpserted?.(material);
		applyMaterial(
			{
				value: material.name,
				label: material.name,
				materialId: material.id,
				isUserCustom: !material.isCustomSlot,
				filamentType: material.filamentType,
				nozzleTempC: material.nozzleTempC,
				bedTempC: material.bedTempC,
				maxSpeedMmS: material.maxSpeedMmS,
			},
			material.name
		);
	};

	const handlePrinterModelChange = (model: PrinterModel) => {
		const cap = getPrinterCapability(model);
		const newDefaults = model === 'ir3-v2' ? DEFAULT_IR3_SETTINGS : DEFAULT_RAISE3D_SETTINGS;
		onPrinterSettingsChange({ ...newDefaults, nozzle: cap.defaultNozzle });
	};

	// Configuration status from API
	const slicerConfigured =
		typeof printerConfig?.slicer?.configured === 'boolean'
			? !!printerConfig.slicer.configured
			: false;
	const agentOnline =
		typeof printerConfig?.slicer?.agentOnline === 'boolean'
			? !!printerConfig.slicer.agentOnline
			: false;

	return (
		<Card>
			<CardContent className="space-y-4">
				{/* Header with back button */}
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onBack}
						className="flex items-center gap-1 text-sm text-ui-muted hover:text-ui-text transition"
					>
						<ArrowLeft size={16} />
						<span>Terug</span>
					</button>
				</div>

				{/* Basis section header */}
				<h4 className="text-sm font-semibold text-ui-accent">Basis</h4>

				{/* Printer model selector */}
				<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm">
					<span className="text-ui-muted">Printer model</span>
					<InlineSelect
						value={currentModel}
						onChange={(val) => handlePrinterModelChange(val as PrinterModel)}
						options={PRINTER_MODEL_OPTIONS}
					/>
				</div>

				{/* Printer settings */}
				<div className="space-y-2 text-sm">
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Merk</span>
						<span className="text-ui-text">{settings.brand}</span>
					</div>
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">3D Printer</span>
						<span className="text-ui-text">{settings.printer}</span>
					</div>

					{/* Material - editable */}
					<div className="flex items-center justify-between gap-2 rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Materiaal</span>
						<div className="flex items-center gap-1">
							{canEditSelectedMaterial ? (
								<button
									type="button"
									onClick={openEditCustomMaterial}
									title="Materiaal bewerken"
									className="rounded-md p-1 text-ui-muted transition hover:bg-[rgba(255,255,255,0.06)] hover:text-ui-text"
								>
									<Pencil size={14} />
								</button>
							) : null}
							<InlineSelect
								value={settings.material}
								onChange={handleMaterialChange}
								options={materialOptions.map((opt) => ({
									value: opt.value,
									label: opt.label,
								}))}
							/>
						</div>
					</div>

					{/* Nozzle - editable (options from printer capabilities, same as settings page) */}
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Nozzle afmeting</span>
						<InlineSelect
							value={nozzleSelectValue}
							onChange={(val) => handleChange('nozzle', val)}
							options={nozzleSelectOptions}
						/>
					</div>

					{/* Extruder - only for IDEX printers */}
					{capability.extruder === 'idex' && (
						<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
							<span className="text-ui-muted">Extruder</span>
							<InlineSelect
								value={settings.extruder ?? 'Links'}
								onChange={(val) => handleChange('extruder', val)}
								options={EXTRUDER_OPTIONS.map((opt) => ({ value: opt, label: opt }))}
							/>
						</div>
					)}

					{/* Top layers - editable */}
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Bovenlagen</span>
						<input
							type="number"
							min={0}
							max={10}
							value={settings.topLayers}
							onChange={(e) =>
								handleChange('topLayers', parseInt(e.target.value, 10) || 0)
							}
							className="w-12 bg-transparent text-ui-text text-right outline-none"
						/>
					</div>

					{/* Bottom layers - editable */}
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Onderlagen</span>
						<input
							type="number"
							min={0}
							max={10}
							value={settings.bottomLayers}
							onChange={(e) =>
								handleChange('bottomLayers', parseInt(e.target.value, 10) || 0)
							}
							className="w-12 bg-transparent text-ui-text text-right outline-none"
						/>
					</div>

					{/* Adhesion - editable */}
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Adhesion</span>
						<InlineSelect
							value={settings.adhesion ?? 'Geen'}
							onChange={(val) => handleChange('adhesion', val)}
							options={ADHESION_OPTIONS.map((opt) => ({ value: opt, label: opt }))}
						/>
					</div>

					{/* IR3 V2 specific settings */}
					{isIR3 && (
						<>
							<div className="pt-2 pb-1">
								<h4 className="text-xs font-semibold text-ui-accent uppercase tracking-wide">
									Belt printer (IR3 V2)
								</h4>
							</div>
							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Nozzle kantelhoek</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										min={30}
										max={60}
										step={0.5}
										value={settings.beltAngleDeg ?? 45}
										onChange={(e) =>
											handleChange('beltAngleDeg', parseFloat(e.target.value) || 45)
										}
										className="w-14 bg-transparent text-ui-text text-right outline-none"
									/>
									<span className="text-ui-muted">°</span>
								</div>
							</div>
							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Belt normaal offset</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										min={-2}
										max={2}
										step={0.05}
										value={settings.beltNormalOffsetMm ?? -0.15}
										onChange={(e) =>
											handleChange('beltNormalOffsetMm', parseFloat(e.target.value) || 0)
										}
										className="w-16 bg-transparent text-ui-text text-right outline-none"
									/>
									<span className="text-ui-muted">mm</span>
								</div>
							</div>
							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Max. bandlengte</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										min={100}
										max={5000}
										step={50}
										value={settings.ir3MaxBeltLengthMm ?? 1000}
										onChange={(e) =>
											handleChange('ir3MaxBeltLengthMm', parseInt(e.target.value, 10) || 1000)
										}
										className="w-16 bg-transparent text-ui-text text-right outline-none"
									/>
									<span className="text-ui-muted">mm</span>
								</div>
							</div>
							<p className="text-xs text-ui-muted px-1">
								De IR3 V2 is een bandprinter met Klipper firmware.
								Toolpaths worden automatisch getransformeerd naar belt-coördinaten.
							</p>
						</>
					)}
				</div>

				{/* Export buttons */}
				<div className="space-y-2 pt-2">
					<Button
						className="w-full"
						variant="outline"
						onClick={onExportSTLLeft}
					>
						Exporteer STL (links)
					</Button>
					<Button
						className="w-full"
						variant="outline"
						onClick={onExportSTLRight}
					>
						Exporteer STL (rechts)
					</Button>
					<Button
						className="w-full"
						variant="outline"
						onClick={onExportSTLPair}
					>
						Exporteer STL (paar)
					</Button>
					<Button
						className="w-full"
						variant="outline"
						disabled={!slicerConfigured || !agentOnline || gcodeBusy}
						onClick={onExportGcode}
						title={
							!slicerConfigured
								? 'PrusaSlicer pad is niet geconfigureerd'
								: !agentOnline
									? 'Print Agent is offline (geen recente heartbeat)'
									: undefined
						}
					>
						{gcodeBusy ? 'G-code genereren...' : 'Exporteer gcode bestand'}
					</Button>
				</div>

				{(!agentOnline || !slicerConfigured) && (
					<Link
						href={settingsHref}
						className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200 transition hover:bg-amber-400/15"
					>
						<span className="h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" />
						<span>
							Print Agent niet gedetecteerd — klik hier om te installeren
						</span>
					</Link>
				)}
			</CardContent>

			<CustomMaterialModal
				open={customModalOpen}
				onClose={() => setCustomModalOpen(false)}
				printerId={printerId ?? null}
				initial={customModalInitial}
				onSaved={handleCustomMaterialSaved}
			/>
		</Card>
	);
}

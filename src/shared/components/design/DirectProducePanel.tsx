'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { InlineSelect } from '@/src/shared/components/ui/select';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import type { PrinterModel } from '@/src/features/settings/types/settings';

interface PrinterConfig {
	slicer?: {
		engine?: 'prusaslicer';
		configured?: boolean;
		agentOnline?: boolean;
		agentLastSeenAt?: string | null;
	};
	prusaSlicer?: { configured?: boolean; usingBuiltInDefaultProfile?: boolean };
	raiseCloud: { configured: boolean };
}

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

const NOZZLE_OPTIONS_RAISE3D = ['0.4', '0.6', '0.8', '1.0'];
const NOZZLE_OPTIONS_IR3 = ['0.4', '0.6', '0.8'];

const EXTRUDER_OPTIONS = ['Links', 'Rechts'];

const ADHESION_OPTIONS = ['Geen', 'Brim', 'Raft', 'Skirt'];

interface DirectProducePanelProps {
	onBack: () => void;
	printerSettings: PrinterSettings;
	onPrinterSettingsChange: (settings: PrinterSettings) => void;
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
	onExportSTLLeft,
	onExportSTLRight,
	onExportSTLPair,
	onExportGcode,
	gcodeBusy = false,
}: DirectProducePanelProps) {
	const [printerConfig, setPrinterConfig] = useState<PrinterConfig | null>(
		null
	);

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
					raiseCloud: { configured: false },
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

	const materialOptions = isIR3 ? MATERIAL_OPTIONS_IR3 : MATERIAL_OPTIONS_RAISE3D;
	const nozzleOptions = isIR3 ? NOZZLE_OPTIONS_IR3 : NOZZLE_OPTIONS_RAISE3D;

	const handleChange = (key: keyof PrinterSettings, value: string | number) => {
		onPrinterSettingsChange({
			...settings,
			[key]: value,
		});
	};

	const handlePrinterModelChange = (model: PrinterModel) => {
		// Reset to defaults for the chosen printer
		const newDefaults = model === 'ir3-v2' ? DEFAULT_IR3_SETTINGS : DEFAULT_RAISE3D_SETTINGS;
		onPrinterSettingsChange({ ...newDefaults });
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
	const raiseCloudConfigured = printerConfig?.raiseCloud.configured ?? false;

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
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Materiaal</span>
						<InlineSelect
							value={settings.material}
							onChange={(val) => handleChange('material', val)}
							options={materialOptions.map((opt) => ({ value: opt, label: opt }))}
						/>
					</div>

					{/* Nozzle - editable */}
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Nozzle afmeting</span>
						<InlineSelect
							value={settings.nozzle}
							onChange={(val) => handleChange('nozzle', val)}
							options={nozzleOptions.map((opt) => ({ value: opt, label: opt }))}
						/>
					</div>

					{/* Extruder - only for Raise3D E2 (dual extruder) */}
					{!isIR3 && (
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

				{/* Send to printer section */}
				<div className="space-y-2 pt-2 border-t border-ui-border">
					<h4 className="text-sm font-semibold text-ui-text pt-2">
						Stuur naar printer
					</h4>
					<div className="flex items-center justify-between text-sm">
						<span className="text-ui-muted">Printer</span>
						<span className="text-ui-text flex items-center gap-1">
							Onder (192.168.0.128)
						<ChevronDown size={14} strokeWidth={2} className="text-ui-accent" />
						</span>
					</div>
					<Button
						className="w-full bg-ui-accent text-slate-900 hover:opacity-90"
						disabled={!raiseCloudConfigured}
						title={
							!raiseCloudConfigured
								? 'RaiseCloud API is niet geconfigureerd'
								: undefined
						}
					>
						Stuur naar printer
					</Button>
					{!raiseCloudConfigured && (
						<p className="text-xs text-ui-muted">
							Configureer RaiseCloud API credentials om naar de printer te
							versturen.
						</p>
					)}
					{!slicerConfigured && (
						<p className="text-xs text-ui-muted">
							Configureer PrusaSlicer om gcode te genereren.
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

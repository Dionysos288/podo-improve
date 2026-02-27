'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { ArrowLeft } from 'lucide-react';

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
	brand: string;
	printer: string;
	material: string;
	nozzle: string;
	extruder?: string;
	topLayers?: number;
	bottomLayers?: number;
	adhesion?: string;
}

// Raise3D E2 defaults
const DEFAULT_RAISE3D_SETTINGS: PrinterSettings = {
	brand: 'Raise3D',
	printer: 'E2',
	material: 'Footprint3D TPU-95A 2.3KG',
	nozzle: '0.8',
	extruder: 'Links',
	topLayers: 1,
	bottomLayers: 2,
	adhesion: 'Geen',
};

const MATERIAL_OPTIONS = [
	'Footprint3D TPU-95A 2.3KG',
	'TPU 95A',
	'TPU 85A',
	'Vertex TPU',
	'EVA Powder',
	'Custom',
];

const NOZZLE_OPTIONS = ['0.4', '0.6', '0.8', '1.0'];

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

	// Merge with Raise3D defaults
	const settings: PrinterSettings = {
		...DEFAULT_RAISE3D_SETTINGS,
		...printerSettings,
	};

	const handleChange = (key: keyof PrinterSettings, value: string | number) => {
		onPrinterSettingsChange({
			...settings,
			[key]: value,
		});
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

				{/* Printer info row */}
				<div className="flex items-center justify-between text-sm">
					<span className="text-ui-text">3D Printer</span>
					<div className="flex items-center gap-2">
						<span className="text-ui-muted">Change printer</span>
						<span className="text-ui-accent">✓</span>
					</div>
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
						<select
							className="bg-transparent text-ui-text text-right cursor-pointer outline-none"
							value={settings.material}
							onChange={(e) => handleChange('material', e.target.value)}
						>
							{MATERIAL_OPTIONS.map((opt) => (
								<option key={opt} value={opt} className="bg-ui-panel">
									{opt}
								</option>
							))}
						</select>
					</div>

					{/* Nozzle - editable */}
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Nozzle afmeting</span>
						<select
							className="bg-transparent text-ui-text text-right cursor-pointer outline-none"
							value={settings.nozzle}
							onChange={(e) => handleChange('nozzle', e.target.value)}
						>
							{NOZZLE_OPTIONS.map((opt) => (
								<option key={opt} value={opt} className="bg-ui-panel">
									{opt}
								</option>
							))}
						</select>
					</div>

					{/* Extruder - editable */}
					<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
						<span className="text-ui-muted">Extruder</span>
						<select
							className="bg-transparent text-ui-text text-right cursor-pointer outline-none"
							value={settings.extruder}
							onChange={(e) => handleChange('extruder', e.target.value)}
						>
							{EXTRUDER_OPTIONS.map((opt) => (
								<option key={opt} value={opt} className="bg-ui-panel">
									{opt}
								</option>
							))}
						</select>
					</div>

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
						<select
							className="bg-transparent text-ui-text text-right cursor-pointer outline-none"
							value={settings.adhesion}
							onChange={(e) => handleChange('adhesion', e.target.value)}
						>
							{ADHESION_OPTIONS.map((opt) => (
								<option key={opt} value={opt} className="bg-ui-panel">
									{opt}
								</option>
							))}
						</select>
					</div>
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
							<span className="text-ui-accent">▼</span>
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

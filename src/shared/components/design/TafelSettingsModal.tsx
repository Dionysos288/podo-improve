'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { BaseModal } from '@/src/shared/components/ui/modal';
import { Button } from '@/src/shared/components/ui/button';
import { Select } from '@/src/shared/components/ui/select';
import {
	DEFAULT_CNC_TOOL_SETTINGS,
	type CncToolSettings,
	type TableSettings,
} from '@/src/features/milling/types';
import { presetToTableSettings } from '@/src/features/milling/org-cnc-settings-shared';
import { useOrgCncSettings } from '@/src/features/milling/hooks/useOrgCncSettings';
import { SettingsField } from '@/src/shared/components/design/SettingsField';
import { TablePresetSection } from '@/src/shared/components/design/TablePresetSection';

interface TafelSettingsModalProps {
	open: boolean;
	onClose: () => void;
	tableSettings: TableSettings;
	toolSettings: CncToolSettings;
	onSave: (next: { tableSettings: TableSettings; toolSettings: CncToolSettings }) => void;
}

const TOOL_TYPE_OPTIONS = [
	{ value: 'ball-nose', label: 'Ball-nose (bolfrees)' },
	{ value: 'flat-end', label: 'Flat-end (vlakfrees)' },
	{ value: 'bull-nose', label: 'Bull-nose' },
];

export function TafelSettingsModal({
	open,
	onClose,
	toolSettings,
	onSave,
}: TafelSettingsModalProps) {
	const {
		isLoading,
		isSaving,
		presets,
		selectedId,
		selectedPreset,
		toolSettings: orgToolSettings,
		select,
		addPreset,
		updatePreset,
		deletePreset,
		saveToolAndSelection,
	} = useOrgCncSettings();
	const [tool, setTool] = useState<CncToolSettings>(toolSettings);

	useEffect(() => {
		if (!open) return;
		setTool(orgToolSettings);
	}, [open, orgToolSettings]);

	const resetToolDefaults = () => {
		setTool({ ...DEFAULT_CNC_TOOL_SETTINGS });
	};

	const handleSave = async () => {
		await saveToolAndSelection(tool, selectedId);
		onSave({
			tableSettings: presetToTableSettings(selectedPreset),
			toolSettings: tool,
		});
		onClose();
	};

	return (
		<BaseModal
			open={open}
			onClose={onClose}
			title="Tafel vervangen — instellingen"
			footer={
				<>
					<Button variant="outline" onClick={resetToolDefaults} disabled={isSaving}>
						Standaardwaarden
					</Button>
					<Button variant="outline" onClick={onClose} disabled={isSaving}>
						Annuleren
					</Button>
					<Button
						className="bg-ui-accent text-slate-900"
						onClick={() => void handleSave()}
						disabled={isLoading || isSaving}
					>
						{isSaving ? (
							<span className="inline-flex items-center gap-2">
								<Loader2 className="h-4 w-4 animate-spin" />
								Opslaan…
							</span>
						) : (
							'Opslaan'
						)}
					</Button>
				</>
			}
		>
			{isLoading ? (
				<div className="flex items-center justify-center gap-2 p-12 text-sm text-ui-muted">
					<Loader2 className="h-4 w-4 animate-spin" />
					Instellingen laden…
				</div>
			) : (
				<div className="grid gap-6 overflow-y-auto p-6 md:grid-cols-2">
					<TablePresetSection
						presets={presets}
						selectedId={selectedId}
						onSelect={(id) => void select(id)}
						onAdd={(preset) => void addPreset(preset)}
						onUpdate={(id, patch) => void updatePreset(id, patch)}
						onDelete={(id) => void deletePreset(id)}
					/>

					<div className="space-y-4">
						<h3 className="text-sm font-semibold text-foreground">Frees / machine</h3>
						<p className="text-xs text-ui-muted">
							Deze instellingen worden opgeslagen voor uw organisatie.
						</p>
						<div className="grid grid-cols-2 gap-4">
							<Select
								label="Frees type"
								value={tool.toolType}
								onChange={(val) =>
									setTool((p) => ({ ...p, toolType: val as CncToolSettings['toolType'] }))
								}
								options={TOOL_TYPE_OPTIONS}
							/>
							<SettingsField
								label="Frees diameter"
								suffix="mm"
								step="0.1"
								value={tool.toolDiameterMm}
								onChange={(v) => setTool((p) => ({ ...p, toolDiameterMm: v }))}
							/>
							<SettingsField
								label="Spiltoerental"
								suffix="rpm"
								step="500"
								value={tool.spindleSpeedRpm}
								onChange={(v) => setTool((p) => ({ ...p, spindleSpeedRpm: v }))}
							/>
							<SettingsField
								label="Voeding XY"
								suffix="mm/min"
								step="50"
								value={tool.feedRateXYMmMin}
								onChange={(v) => setTool((p) => ({ ...p, feedRateXYMmMin: v }))}
							/>
							<SettingsField
								label="Voeding Z"
								suffix="mm/min"
								step="50"
								value={tool.feedRateZMmMin}
								onChange={(v) => setTool((p) => ({ ...p, feedRateZMmMin: v }))}
							/>
							<SettingsField
								label="Stepover"
								suffix="%"
								value={tool.stepoverPercent}
								onChange={(v) => setTool((p) => ({ ...p, stepoverPercent: v }))}
							/>
							<SettingsField
								label="Veilige Z"
								suffix="mm"
								value={tool.safeZMm}
								onChange={(v) => setTool((p) => ({ ...p, safeZMm: v }))}
							/>
							<SettingsField
								label="Snijdiepte (DOC)"
								suffix="mm"
								step="0.5"
								value={tool.depthOfCutMm}
								onChange={(v) => setTool((p) => ({ ...p, depthOfCutMm: v }))}
							/>
						</div>
					</div>
				</div>
			)}
		</BaseModal>
	);
}

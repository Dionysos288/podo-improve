'use client';

import { useEffect, useState } from 'react';
import { BaseModal } from '@/src/shared/components/ui/modal';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Select } from '@/src/shared/components/ui/select';
import {
	FILAMENT_TYPE_OPTIONS,
	getFilamentDefaults,
	type FilamentType,
} from '@/src/features/printers/constants/print-options';
import { upsertCustomMaterial } from '@/src/features/printers/server/material-actions';
import type { PrintMaterialItem } from '@/src/features/printers/types/printers';

export type CustomMaterialDraft = {
	materialId?: string | null;
	name: string;
	filamentType: FilamentType;
	nozzleTempC: number | null;
	bedTempC: number | null;
	maxSpeedMmS: number | null;
};

interface CustomMaterialModalProps {
	open: boolean;
	onClose: () => void;
	printerId: string | null;
	/** When set the modal edits an existing custom material, otherwise it creates one. */
	initial?: CustomMaterialDraft | null;
	onSaved: (material: PrintMaterialItem) => void;
}

const emptyDraft: CustomMaterialDraft = {
	name: '',
	filamentType: 'FLEX',
	nozzleTempC: getFilamentDefaults('FLEX').nozzleTempC,
	bedTempC: getFilamentDefaults('FLEX').bedTempC,
	maxSpeedMmS: getFilamentDefaults('FLEX').maxSpeedMmS,
};

function toNullableNumber(raw: string): number | null {
	if (raw.trim() === '') return null;
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

export function CustomMaterialModal({
	open,
	onClose,
	printerId,
	initial,
	onSaved,
}: CustomMaterialModalProps) {
	const isEdit = Boolean(initial?.materialId);
	const [draft, setDraft] = useState<CustomMaterialDraft>(emptyDraft);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setDraft(initial ? { ...initial } : { ...emptyDraft });
			setError(null);
		}
	}, [open, initial]);

	const handleFilamentChange = (val: string) => {
		const filamentType = val as FilamentType;
		const presets = getFilamentDefaults(filamentType);
		setDraft((prev) => ({
			...prev,
			filamentType,
			nozzleTempC: prev.nozzleTempC ?? presets.nozzleTempC,
			bedTempC: prev.bedTempC ?? presets.bedTempC,
			maxSpeedMmS: prev.maxSpeedMmS ?? presets.maxSpeedMmS,
		}));
	};

	const handleSave = async () => {
		if (!printerId) {
			setError('Geen printer geselecteerd');
			return;
		}
		if (!draft.name.trim()) {
			setError('Materiaalnaam is verplicht');
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const material = await upsertCustomMaterial({
				printerId,
				materialId: draft.materialId ?? undefined,
				name: draft.name.trim(),
				filamentType: draft.filamentType,
				nozzleTempC: draft.nozzleTempC,
				bedTempC: draft.bedTempC,
				maxSpeedMmS: draft.maxSpeedMmS,
			});
			onSaved(material);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Opslaan mislukt');
		} finally {
			setSaving(false);
		}
	};

	return (
		<BaseModal
			open={open}
			onClose={onClose}
			title={isEdit ? 'Custom materiaal bewerken' : 'Custom materiaal toevoegen'}
			className="!w-[440px]"
			footer={
				<>
					<Button variant="ghost" onClick={onClose} disabled={saving}>
						Annuleren
					</Button>
					<Button onClick={handleSave} disabled={saving}>
						{saving ? 'Opslaan…' : 'Opslaan'}
					</Button>
				</>
			}
		>
			<div className="space-y-4 p-5">
				<div className="space-y-1">
					<label className="block text-xs uppercase tracking-wide text-ui-text/70">
						Naam
					</label>
					<Input
						variant="dark"
						value={draft.name}
						onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
						placeholder="bv. Eigen TPU mix"
						autoFocus
					/>
				</div>

				<Select
					label="Filament type"
					value={draft.filamentType}
					onChange={handleFilamentChange}
					options={FILAMENT_TYPE_OPTIONS}
				/>

				<div className="grid grid-cols-3 gap-3">
					<div className="space-y-1">
						<label className="block text-xs uppercase tracking-wide text-ui-text/70">
							Nozzle °C
						</label>
						<Input
							variant="dark"
							type="number"
							value={draft.nozzleTempC ?? ''}
							onChange={(e) =>
								setDraft((p) => ({ ...p, nozzleTempC: toNullableNumber(e.target.value) }))
							}
						/>
					</div>
					<div className="space-y-1">
						<label className="block text-xs uppercase tracking-wide text-ui-text/70">
							Bed °C
						</label>
						<Input
							variant="dark"
							type="number"
							value={draft.bedTempC ?? ''}
							onChange={(e) =>
								setDraft((p) => ({ ...p, bedTempC: toNullableNumber(e.target.value) }))
							}
						/>
					</div>
					<div className="space-y-1">
						<label className="block text-xs uppercase tracking-wide text-ui-text/70">
							Snelheid mm/s
						</label>
						<Input
							variant="dark"
							type="number"
							value={draft.maxSpeedMmS ?? ''}
							onChange={(e) =>
								setDraft((p) => ({ ...p, maxSpeedMmS: toNullableNumber(e.target.value) }))
							}
						/>
					</div>
				</div>

				{error ? <p className="text-sm text-red-400">{error}</p> : null}
			</div>
		</BaseModal>
	);
}

'use client';

import { useState } from 'react';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { cn } from '@/src/shared/lib/cn';
import { DEFAULT_TABLE_SETTINGS, type TablePreset } from '@/src/features/milling/types';
import { SettingsField } from '@/src/shared/components/design/SettingsField';

type PresetDraft = { name: string } & Omit<TablePreset, 'id' | 'name'>;

interface TablePresetSectionProps {
	presets: TablePreset[];
	selectedId: string;
	onSelect: (id: string) => void;
	onAdd: (preset: Omit<TablePreset, 'id'>) => void;
	onUpdate: (id: string, patch: Partial<Omit<TablePreset, 'id'>>) => void;
	onDelete: (id: string) => void;
}

function draftFromPreset(preset: TablePreset): PresetDraft {
	const { id: _id, ...rest } = preset;
	return rest;
}

function emptyDraft(seed: TablePreset | undefined): PresetDraft {
	const base = seed ?? { ...DEFAULT_TABLE_SETTINGS, id: '', name: '' };
	const { id: _id, name: _name, ...dims } = base;
	return { name: '', ...dims };
}

const DIMENSION_FIELDS: { key: keyof Omit<TablePreset, 'id' | 'name'>; label: string }[] = [
	{ key: 'blockWidthMm', label: 'Blok breedte' },
	{ key: 'blockLengthMm', label: 'Blok lengte' },
	{ key: 'blockDepthMm', label: 'Blok dikte' },
	{ key: 'blockGapMm', label: 'Tussenruimte' },
	{ key: 'bedWidthMm', label: 'Bed breedte (X)' },
	{ key: 'bedLengthMm', label: 'Bed lengte (Y)' },
];

export function TablePresetSection({
	presets,
	selectedId,
	onSelect,
	onAdd,
	onUpdate,
	onDelete,
}: TablePresetSectionProps) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [isAdding, setIsAdding] = useState(false);
	const [draft, setDraft] = useState<PresetDraft | null>(null);

	const startAdd = () => {
		const seed = presets.find((p) => p.id === selectedId) ?? presets[0];
		setDraft(emptyDraft(seed));
		setIsAdding(true);
		setEditingId(null);
	};

	const startEdit = (preset: TablePreset) => {
		setDraft(draftFromPreset(preset));
		setEditingId(preset.id);
		setIsAdding(false);
	};

	const cancelEdit = () => {
		setDraft(null);
		setEditingId(null);
		setIsAdding(false);
	};

	const saveDraft = () => {
		if (!draft) return;
		const name = draft.name.trim() || 'Naamloze tafel';
		if (isAdding) {
			onAdd({ ...draft, name });
		} else if (editingId) {
			onUpdate(editingId, { ...draft, name });
		}
		cancelEdit();
	};

	const setDim = (key: keyof Omit<TablePreset, 'id' | 'name'>, value: number) => {
		setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
	};

	const isEditing = isAdding || editingId !== null;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-foreground">Tafel / blok</h3>
				{!isEditing && (
					<Button variant="outline" size="sm" onClick={startAdd}>
						Tafel toevoegen
					</Button>
				)}
			</div>

			{!isEditing && (
				<ul className="space-y-2">
					{presets.map((preset) => {
						const active = preset.id === selectedId;
						return (
							<li
								key={preset.id}
								className={cn(
									'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors',
									active
										? 'border-ui-accent bg-[rgba(255,255,255,0.04)]'
										: 'border-ui-border hover:bg-[rgba(255,255,255,0.03)]',
								)}
							>
								<button
									type="button"
									className="flex flex-1 items-start gap-3 text-left"
									onClick={() => onSelect(preset.id)}
								>
									<span
										className={cn(
											'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
											active ? 'border-ui-accent' : 'border-ui-border',
										)}
									>
										{active && (
											<span className="h-2 w-2 rounded-full bg-ui-accent" />
										)}
									</span>
									<span className="space-y-0.5">
										<span className="block text-sm font-medium text-foreground">
											{preset.name}
										</span>
										<span className="block text-xs text-ui-muted">
											Bed {preset.bedWidthMm} × {preset.bedLengthMm} mm · Blok{' '}
											{preset.blockWidthMm} × {preset.blockLengthMm} ×{' '}
											{preset.blockDepthMm} mm · Gap {preset.blockGapMm} mm
										</span>
									</span>
								</button>
								<div className="flex shrink-0 items-center gap-1">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => startEdit(preset)}
									>
										Bewerken
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="text-red-400 hover:text-red-300 disabled:opacity-40"
										disabled={presets.length <= 1}
										title={
											presets.length <= 1
												? 'De laatste tafel kan niet verwijderd worden'
												: undefined
										}
										onClick={() => onDelete(preset.id)}
									>
										Verwijderen
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
			)}

			{isEditing && draft && (
				<div className="space-y-4 rounded-lg border border-ui-border p-4">
					<div className="space-y-1.5">
						<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
							Naam
						</label>
						<Input
							variant="dark"
							type="text"
							value={draft.name}
							placeholder="Bijv. Mekanika Pro M"
							onChange={(e) =>
								setDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))
							}
						/>
					</div>
					<div className="grid grid-cols-2 gap-4">
						{DIMENSION_FIELDS.map(({ key, label }) => (
							<SettingsField
								key={key}
								label={label}
								suffix="mm"
								value={draft[key]}
								onChange={(v) => setDim(key, v)}
							/>
						))}
					</div>
					<div className="flex justify-end gap-2">
						<Button variant="outline" size="sm" onClick={cancelEdit}>
							Annuleren
						</Button>
						<Button
							size="sm"
							className="bg-ui-accent text-slate-900"
							onClick={saveDraft}
						>
							{isAdding ? 'Toevoegen' : 'Opslaan'}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

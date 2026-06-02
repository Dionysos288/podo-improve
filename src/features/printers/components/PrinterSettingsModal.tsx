'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { BaseModal } from '@/src/shared/components/ui/modal';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Select } from '@/src/shared/components/ui/select';
import {
	FILL_PATTERN_OPTIONS,
	normalizeFillPattern,
	normalizePrintStrategy,
	PRINT_STRATEGY_OPTIONS,
} from '@/src/features/printers/constants/print-options';
import { getPrinterCapability } from '@/src/features/printers/constants/printer-capabilities';
import { setPrinterMaterials } from '@/src/features/printers/server/material-actions';
import { updatePrinterSettings } from '@/src/features/printers/server/actions';
import type {
	PrinterWithMaterials,
	PrinterSettings,
	HardnessKey,
	HardnessProfile,
	PrintMaterialItem,
} from '@/src/features/printers/types/printers';

const EXTRUDER_OPTIONS = [
	{ value: 'Links', label: 'Links' },
	{ value: 'Rechts', label: 'Rechts' },
];

const ADHESION_OPTIONS = [
	{ value: 'Geen', label: 'Geen' },
	{ value: 'Brim', label: 'Brim' },
	{ value: 'Raft', label: 'Raft' },
	{ value: 'Skirt', label: 'Skirt' },
];

function clampNumber(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
}

export function PrinterSettingsModal({
	open,
	onClose,
	printer,
	orgMaterials,
	onSaved,
}: {
	open: boolean;
	onClose: () => void;
	printer: PrinterWithMaterials | null;
	orgMaterials: PrintMaterialItem[];
	onSaved?: () => void;
}) {
	const [isPending, startTransition] = useTransition();
	const [local, setLocal] = useState<PrinterSettings>({});
	const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
	const [defaultMaterialId, setDefaultMaterialId] = useState<string>('');

	const initial = useMemo(() => printer?.settings ?? {}, [printer]);
	const capability = useMemo(
		() => getPrinterCapability(printer?.model ?? printer?.name),
		[printer]
	);
	const nozzleOptions = useMemo(
		() => capability.nozzleOptions.map((value) => ({ value, label: `${value} mm` })),
		[capability]
	);

	useEffect(() => {
		if (!open || !printer) return;
		setLocal({
			...initial,
			strategy: normalizePrintStrategy(initial.strategy),
			infill: normalizeFillPattern(initial.infill),
		});
		const assigned = printer.materials.map((m) => m.materialId);
		const defaultMat =
			printer.materials.find((m) => m.isDefault)?.materialId ?? assigned[0] ?? '';
		setSelectedMaterialIds(assigned);
		setDefaultMaterialId(defaultMat);
	}, [open, initial, printer]);

	const toggleMaterial = (materialId: string) => {
		setSelectedMaterialIds((prev) => {
			if (prev.includes(materialId)) {
				const next = prev.filter((id) => id !== materialId);
				if (defaultMaterialId === materialId) {
					setDefaultMaterialId(next[0] ?? '');
				}
				return next;
			}
			const next = [...prev, materialId];
			if (!defaultMaterialId) setDefaultMaterialId(materialId);
			return next;
		});
	};

	const save = () => {
		if (!printer) return;
		startTransition(async () => {
			await updatePrinterSettings({ printerId: printer.id, patch: local });
			await setPrinterMaterials({
				printerId: printer.id,
				materialIds: selectedMaterialIds,
				defaultMaterialId,
			});
			onSaved?.();
			onClose();
		});
	};

	const hardness: Record<HardnessKey, HardnessProfile | undefined> =
		(local.hardnessProfiles ?? {}) as Record<HardnessKey, HardnessProfile | undefined>;

	return (
		<BaseModal
			open={open}
			onClose={onClose}
			title={printer ? `${printer.name} – Instellingen` : 'Instellingen'}
			footer={
				<>
					<Button variant="outline" onClick={onClose} disabled={isPending}>
						Sluiten
					</Button>
					<Button
						onClick={save}
						disabled={isPending || selectedMaterialIds.length === 0}
						className="bg-ui-accent text-slate-900"
					>
						Opslaan
					</Button>
				</>
			}
		>
			<div className="grid gap-6 p-6 md:grid-cols-2">
				<div className="space-y-4">
					<h3 className="text-sm font-semibold text-foreground">Basis instellingen</h3>

					<div className="grid grid-cols-2 gap-4">
						<Select
							label="Nozzle afmeting"
							value={String(local.nozzleDiameter ?? capability.defaultNozzle)}
							onChange={(val) =>
								setLocal((p) => ({
									...p,
									nozzleDiameter: Number(val),
								}))
							}
							options={nozzleOptions}
						/>

						<Select
							label="Strategie"
							value={local.strategy ?? '0.20mm'}
							onChange={(val) =>
								setLocal((p) => ({
									...p,
									strategy: normalizePrintStrategy(val),
								}))
							}
							options={PRINT_STRATEGY_OPTIONS}
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						{capability.extruder === 'idex' ? (
							<Select
								label="Extruder"
								value={local.extruder ?? 'Links'}
								onChange={(val) =>
									setLocal((p) => ({
										...p,
										extruder: val as 'Links' | 'Rechts',
									}))
								}
								options={EXTRUDER_OPTIONS}
							/>
						) : (
							<div className="space-y-1.5">
								<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
									Extruder
								</label>
								<div className="rounded-md border border-ui-border bg-ui-card px-3 py-2 text-sm text-ui-muted">
									Enkel (single)
								</div>
							</div>
						)}

						<div className="space-y-1.5">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Retraction
							</label>
							<Input
								variant="dark"
								type="number"
								step="0.1"
								value={local.retraction ?? 0}
								onChange={(e) =>
									setLocal((p) => ({
										...p,
										retraction: clampNumber(Number(e.target.value), 0, 20),
									}))
								}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-1.5">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Overhang
							</label>
							<Input
								variant="dark"
								type="number"
								value={local.overhang ?? 1}
								onChange={(e) =>
									setLocal((p) => ({
										...p,
										overhang: clampNumber(Number(e.target.value), 0, 10),
									}))
								}
							/>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Onderlaag
							</label>
							<Input
								variant="dark"
								type="number"
								value={local.underlay ?? 2}
								onChange={(e) =>
									setLocal((p) => ({
										...p,
										underlay: clampNumber(Number(e.target.value), 0, 10),
									}))
								}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<Select
							label="Adhesion"
							value={local.adhesion ?? 'Geen'}
							onChange={(val) =>
								setLocal((p) => ({
									...p,
									adhesion: val as PrinterSettings['adhesion'],
								}))
							}
							options={ADHESION_OPTIONS}
						/>
						<Select
							label="Infill"
							value={local.infill ?? 'gyroid'}
							onChange={(val) =>
								setLocal((p) => ({
									...p,
									infill: normalizeFillPattern(val),
								}))
							}
							options={FILL_PATTERN_OPTIONS}
						/>
					</div>

					<div className="space-y-3 pt-2">
						<h3 className="text-sm font-semibold text-foreground">
							Materialen voor deze printer
						</h3>
						<div className="space-y-2">
							{orgMaterials.map((m) => {
								const checked = selectedMaterialIds.includes(m.id);
								return (
									<label
										key={m.id}
										className="flex cursor-pointer items-center gap-3 rounded-xl border border-ui-border bg-ui-card px-4 py-3"
									>
										<input
											type="checkbox"
											checked={checked}
											onChange={() => toggleMaterial(m.id)}
											className="h-4 w-4 accent-[var(--ui-accent)]"
										/>
										<span className="flex-1 text-sm text-foreground">{m.name}</span>
										<input
											type="radio"
											name="defaultMaterial"
											checked={defaultMaterialId === m.id}
											disabled={!checked}
											onChange={() => setDefaultMaterialId(m.id)}
											className="h-4 w-4 accent-[var(--ui-accent)]"
											title="Standaard"
										/>
										<span className="text-xs text-ui-muted">Standaard</span>
									</label>
								);
							})}
						</div>
					</div>
				</div>

				<div className="space-y-4">
					<h3 className="text-sm font-semibold text-foreground">Hardheid</h3>
					<div className="space-y-2">
						{[
							{ key: 'extraSoft', label: 'Extra zacht' },
							{ key: 'soft', label: 'Zacht' },
							{ key: 'normal', label: 'Normaal' },
							{ key: 'hard', label: 'Hard' },
							{ key: 'extraHard', label: 'Extra hard' },
						].map((row) => (
							<div
								key={row.key}
								className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-card px-4 py-3"
							>
								<span className="text-sm font-medium text-foreground">
									{row.label}
								</span>
								<div className="flex items-center gap-2">
									<span className="text-xs text-ui-muted">infill</span>
									<Input
										variant="dark"
										type="number"
										className="w-20"
										value={hardness[row.key as keyof typeof hardness]?.infillPercent ?? 0}
										onChange={(e) => {
											const v = clampNumber(Number(e.target.value), 0, 100);
											setLocal((p) => ({
												...p,
												hardnessProfiles: {
													...(p.hardnessProfiles ?? {}),
													[row.key]: { infillPercent: v },
												} as PrinterSettings['hardnessProfiles'],
											}));
										}}
									/>
									<span className="text-xs text-ui-muted">%</span>
								</div>
							</div>
						))}
					</div>
					<p className="text-xs text-ui-muted">
						Deze presets gebruiken we voor slicing via de lokale Print Agent.
					</p>
				</div>
			</div>
		</BaseModal>
	);
}

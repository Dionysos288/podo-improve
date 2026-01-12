'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { BaseModal } from '@/src/shared/components/ui/modal';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { updatePrinterSettings } from '@/src/features/printers/server/actions';
import type { PrinterListItem, PrinterSettings } from '@/src/features/printers/types/printers';

function clampNumber(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
}

export function PrinterSettingsModal({
	open,
	onClose,
	printer,
}: {
	open: boolean;
	onClose: () => void;
	printer: PrinterListItem | null;
}) {
	const [isPending, startTransition] = useTransition();
	const [local, setLocal] = useState<PrinterSettings>({});

	const initial = useMemo(() => printer?.settings ?? {}, [printer]);

	useEffect(() => {
		if (open) setLocal(initial);
	}, [open, initial]);

	const save = () => {
		if (!printer) return;
		startTransition(async () => {
			await updatePrinterSettings({ printerId: printer.id, patch: local });
			onClose();
		});
	};

	const hardness = local.hardnessProfiles ?? {};

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
					<Button onClick={save} disabled={isPending} className="bg-ui-accent text-slate-900">
						Opslaan
					</Button>
				</>
			}
		>
			<div className="grid gap-6 p-6 md:grid-cols-2">
				<div className="space-y-4">
					<h3 className="text-sm font-semibold text-foreground">Basis instellingen</h3>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-1.5">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Nozzle afmeting
							</label>
							<Input
								type="number"
								step="0.1"
								value={local.nozzleDiameter ?? 0.8}
								onChange={(e) =>
									setLocal((p) => ({
										...p,
										nozzleDiameter: clampNumber(Number(e.target.value), 0.2, 2),
									}))
								}
							/>
						</div>

						<div className="space-y-1.5">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Strategie
							</label>
							<Input
								value={local.strategy ?? 'Default'}
								onChange={(e) => setLocal((p) => ({ ...p, strategy: e.target.value }))}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-1.5">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Extruder
							</label>
							<select
								value={local.extruder ?? 'Links'}
								onChange={(e) =>
									setLocal((p) => ({
										...p,
										extruder: e.target.value as 'Links' | 'Rechts',
									}))
								}
								className="w-full rounded-xl border border-ui-border bg-ui-card px-3 py-2 text-sm text-foreground"
							>
								<option value="Links">Links</option>
								<option value="Rechts">Rechts</option>
							</select>
						</div>

						<div className="space-y-1.5">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Retraction
							</label>
							<Input
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
						<div className="space-y-1.5">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Adhesion
							</label>
							<select
								value={local.adhesion ?? 'Geen'}
								onChange={(e) =>
									setLocal((p) => ({
										...p,
										adhesion: e.target.value as PrinterSettings['adhesion'],
									}))
								}
								className="w-full rounded-xl border border-ui-border bg-ui-card px-3 py-2 text-sm text-foreground"
							>
								<option value="Geen">Geen</option>
								<option value="Brim">Brim</option>
								<option value="Raft">Raft</option>
								<option value="Skirt">Skirt</option>
							</select>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
								Infill
							</label>
							<Input
								value={local.infill ?? 'Standard'}
								onChange={(e) => setLocal((p) => ({ ...p, infill: e.target.value }))}
							/>
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
						Deze presets gebruiken we later voor slicing via de lokale Print Agent.
					</p>
				</div>
			</div>
		</BaseModal>
	);
}


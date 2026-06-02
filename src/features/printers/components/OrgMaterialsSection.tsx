'use client';

import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Select } from '@/src/shared/components/ui/select';
import {
	FILAMENT_TYPE_OPTIONS,
	type FilamentType,
} from '@/src/features/printers/constants/print-options';
import { SEEDED_MATERIAL_NAMES } from '@/src/features/printers/constants/default-materials';
import { useOrgMaterials } from '@/src/features/printers/hooks/useOrgMaterials';
import { MaterialParamInput } from './MaterialParamInput';
import type { PrintMaterialItem } from '@/src/features/printers/types/printers';

export function OrgMaterialsSection({
	materials: initialMaterials,
}: {
	materials: PrintMaterialItem[];
}) {
	const {
		materials,
		name,
		setName,
		filamentType,
		setFilamentType,
		error,
		isPending,
		add,
		remove,
		saveParams,
	} = useOrgMaterials(initialMaterials);

	return (
		<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
			<h2 className="text-xl font-semibold text-foreground">Materialen</h2>
			<p className="mt-1 text-sm text-ui-muted">
				Beheer de filamentcatalogus voor uw organisatie. Temperaturen en snelheid worden bij
				slicing gebruikt; wijs materialen per printer toe via Instellingen.
			</p>

			<div className="mt-4 overflow-hidden rounded-2xl border border-ui-border">
				<div className="grid grid-cols-12 bg-ui-card px-4 py-3 text-xs font-medium uppercase tracking-wide text-ui-muted">
					<div className="col-span-4">Naam</div>
					<div className="col-span-2">Type</div>
					<div className="col-span-2">Nozzle</div>
					<div className="col-span-2">Bed</div>
					<div className="col-span-1">Snelheid</div>
					<div className="col-span-1 text-right">Acties</div>
				</div>
				<div className="divide-y divide-ui-border">
					{materials.map((m) => (
						<div
							key={m.id}
							className="grid grid-cols-12 items-center px-4 py-3 text-sm bg-ui-panel"
						>
							<div className="col-span-4 font-medium text-foreground">
								{m.name}
								{m.isCustomSlot ? (
									<span className="ml-2 text-xs text-ui-muted">(vrije invoer)</span>
								) : null}
							</div>
							<div className="col-span-2 text-ui-muted">{m.filamentType}</div>
							{m.isCustomSlot ? (
								<>
									<div className="col-span-2 text-ui-muted">—</div>
									<div className="col-span-2 text-ui-muted">—</div>
									<div className="col-span-1 text-ui-muted">—</div>
								</>
							) : (
								<>
									<div className="col-span-2">
										<MaterialParamInput
											value={m.nozzleTempC}
											unit="°C"
											disabled={isPending}
											onCommit={(next) => saveParams(m.id, { nozzleTempC: next })}
										/>
									</div>
									<div className="col-span-2">
										<MaterialParamInput
											value={m.bedTempC}
											unit="°C"
											disabled={isPending}
											onCommit={(next) => saveParams(m.id, { bedTempC: next })}
										/>
									</div>
									<div className="col-span-1">
										<MaterialParamInput
											value={m.maxSpeedMmS}
											unit=""
											disabled={isPending}
											onCommit={(next) => saveParams(m.id, { maxSpeedMmS: next })}
										/>
									</div>
								</>
							)}
							<div className="col-span-1 flex justify-end">
								{!m.isCustomSlot && !SEEDED_MATERIAL_NAMES.includes(m.name) ? (
									<Button
										variant="outline"
										size="sm"
										disabled={isPending}
										onClick={() => remove(m.id)}
										className="rounded-xl"
									>
										Verwijderen
									</Button>
								) : (
									<span className="text-xs text-ui-muted">—</span>
								)}
							</div>
						</div>
					))}
				</div>
			</div>

			<div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end">
				<div className="space-y-1.5">
					<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
						Nieuw materiaal
					</label>
					<Input
						variant="dark"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Materiaalnaam"
					/>
				</div>
				<Select
					label="Filamenttype"
					value={filamentType}
					onChange={(val) => setFilamentType(val as FilamentType)}
					options={FILAMENT_TYPE_OPTIONS}
				/>
				<Button
					onClick={add}
					disabled={isPending || !name.trim()}
					className="bg-ui-accent text-slate-900 md:mb-0"
				>
					Toevoegen
				</Button>
			</div>
			<p className="mt-2 text-xs text-ui-muted">
				Nieuwe materialen krijgen standaardtemperaturen op basis van het filamenttype; pas ze daarna
				aan in de tabel.
			</p>

			{error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
		</div>
	);
}

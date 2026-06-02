'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/shared/components/ui/button';
import { PrinterSettingsModal } from './PrinterSettingsModal';
import { OrgMaterialsSection } from './OrgMaterialsSection';
import type { PrintMaterialItem, PrinterWithMaterials } from '@/src/features/printers/types/printers';

export function PrintersClient({
	printers: initialPrinters,
	materials,
}: {
	printers: PrinterWithMaterials[];
	materials: PrintMaterialItem[];
}) {
	const router = useRouter();
	const [selectedId, setSelectedId] = useState<string | null>(
		initialPrinters[0]?.id ?? null
	);
	const [open, setOpen] = useState(false);
	const [isPending] = useTransition();

	const selected = useMemo(
		() => initialPrinters.find((p) => p.id === selectedId) ?? initialPrinters[0] ?? null,
		[initialPrinters, selectedId]
	);

	const refresh = () => router.refresh();

	return (
		<div className="space-y-6">
			<OrgMaterialsSection materials={materials} />

			<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-xl font-semibold text-foreground">3D Printer</h2>
						<p className="mt-1 text-sm text-ui-muted">
							Beheer printers en instellingen.
						</p>
					</div>
				</div>

				<div className="mt-6 overflow-hidden rounded-2xl border border-ui-border">
					<div className="grid grid-cols-12 bg-ui-card px-4 py-3 text-xs font-medium uppercase tracking-wide text-ui-muted">
						<div className="col-span-5">3D Printer</div>
						<div className="col-span-3">Merk</div>
						<div className="col-span-2">Model</div>
						<div className="col-span-2 text-right">Acties</div>
					</div>
					<div className="divide-y divide-ui-border">
						{initialPrinters.map((p) => (
							<div
								key={p.id}
								className={`grid grid-cols-12 items-center px-4 py-3 text-sm ${
									p.id === selectedId ? 'bg-ui-overlay/20' : 'bg-ui-panel'
								}`}
							>
								<div className="col-span-5">
									<button
										type="button"
										onClick={() => setSelectedId(p.id)}
										className="text-left font-semibold text-foreground hover:opacity-80"
									>
										{p.name}
									</button>
								</div>
								<div className="col-span-3 text-ui-muted">{p.brand ?? '—'}</div>
								<div className="col-span-2 text-ui-muted">{p.model ?? '—'}</div>
								<div className="col-span-2 flex justify-end">
									<Button
										variant="outline"
										onClick={() => {
											setSelectedId(p.id);
											setOpen(true);
										}}
										disabled={isPending}
										className="rounded-xl"
									>
										Instellingen
									</Button>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>

			<PrinterSettingsModal
				open={open}
				onClose={() => setOpen(false)}
				printer={selected}
				orgMaterials={materials}
				onSaved={refresh}
			/>
		</div>
	);
}

'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/src/shared/components/ui/button';
import { PrinterSettingsModal } from './PrinterSettingsModal';
import type { PrinterListItem } from '@/src/features/printers/types/printers';

export function PrintersClient({ printers }: { printers: PrinterListItem[] }) {
	const [selectedId, setSelectedId] = useState<string | null>(
		printers[0]?.id ?? null
	);
	const [open, setOpen] = useState(false);
	const [isPending] = useTransition();

	const selected = useMemo(
		() => printers.find((p) => p.id === selectedId) ?? printers[0] ?? null,
		[printers, selectedId]
	);

	return (
		<div className="space-y-6">
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
						{printers.map((p) => (
							<div
								key={p.id}
								className={`grid grid-cols-12 items-center px-4 py-3 text-sm ${
									p.id === selectedId ? 'bg-ui-overlay/20' : 'bg-ui-panel'
								}`}
							>
								<div className="col-span-5">
									<button
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
										onClick={() => setOpen(true)}
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
			/>
		</div>
	);
}


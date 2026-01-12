'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/shared/components/ui/button';
import { createBackup, deleteBackup } from '@/src/features/backups/server/actions';
import type { BackupListItem } from '@/src/features/backups/server/actions';

function formatDate(dt: Date) {
	return new Date(dt).toLocaleString('nl-NL', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function BackupsClient({ backups }: { backups: BackupListItem[] }) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [isCreating, setIsCreating] = useState(false);

	const handleCreate = () => {
		setIsCreating(true);
		startTransition(async () => {
			try {
				await createBackup();
				router.refresh();
			} finally {
				setIsCreating(false);
			}
		});
	};

	const handleDelete = (id: string) => {
		if (!confirm('Backup verwijderen?')) return;
		startTransition(async () => {
			await deleteBackup(id);
			router.refresh();
		});
	};

	return (
		<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-xl font-semibold text-foreground">Backup</h2>
					<p className="mt-1 text-sm text-ui-muted">
						Maak een backup van je organisatiegegevens.
					</p>
				</div>
				<Button
					onClick={handleCreate}
					disabled={isPending || isCreating}
					className="rounded-xl bg-ui-accent px-4 py-2 font-semibold text-slate-900 disabled:opacity-50"
				>
					{isCreating ? 'Bezig…' : 'Maak backup'}
				</Button>
			</div>

			<div className="mt-6 overflow-hidden rounded-2xl border border-ui-border">
				<div className="grid grid-cols-12 bg-ui-card px-4 py-3 text-xs font-medium uppercase tracking-wide text-ui-muted">
					<div className="col-span-6">Bestand</div>
					<div className="col-span-3">Type</div>
					<div className="col-span-3 text-right">Acties</div>
				</div>

				{backups.length === 0 ? (
					<div className="bg-ui-panel px-4 py-10 text-center text-sm text-ui-muted">
						Nog geen backups.
					</div>
				) : (
					<div className="divide-y divide-ui-border">
						{backups.map((b) => (
							<div
								key={b.id}
								className="grid grid-cols-12 items-center px-4 py-3 text-sm"
							>
								<div className="col-span-6">
									<p className="font-medium text-foreground">
										{formatDate(b.createdAt)}
									</p>
									<p className="text-xs text-ui-muted">ID: {b.id}</p>
								</div>
								<div className="col-span-3 text-ui-muted">{b.type ?? '—'}</div>
								<div className="col-span-3 flex justify-end gap-2">
									{b.url ? (
										<a
											href={b.url}
											className="rounded-xl border border-ui-border bg-ui-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-ui-overlay"
										>
											Download
										</a>
									) : (
										<span className="rounded-xl border border-ui-border bg-ui-card px-3 py-2 text-xs text-ui-muted">
											Geen bestand
										</span>
									)}
									<button
										onClick={() => handleDelete(b.id)}
										className="rounded-xl border border-ui-border bg-ui-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
									>
										Verwijderen
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}


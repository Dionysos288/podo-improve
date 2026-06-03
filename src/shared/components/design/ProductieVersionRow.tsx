'use client';

import { cn } from '@/src/shared/lib/cn';
import type {
	ProductionLibraryProject,
	ProductionLibraryVersion,
} from '@/src/features/milling/server/production-actions';
import type { PartId, ProductionItem } from '@/src/features/milling/types';

export interface AddVersionArgs {
	projectId: string;
	projectName: string;
	patientName: string;
	designId: string;
	version: number;
}

interface ProductieVersionRowProps {
	version: ProductionLibraryVersion;
	project: ProductionLibraryProject;
	selected?: ProductionItem;
	onAdd: (args: AddVersionArgs) => void;
	onRemove: (designId: string) => void;
	onToggleSide: (designId: string, side: PartId) => void;
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ''
		: d.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const SIDE_LABELS: { id: PartId; label: string }[] = [
	{ id: 'left', label: 'L' },
	{ id: 'right', label: 'R' },
];

export function ProductieVersionRow({
	version,
	project,
	selected,
	onAdd,
	onRemove,
	onToggleSide,
}: ProductieVersionRowProps) {
	const isSelected = Boolean(selected);

	return (
		<div
			className={cn(
				'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
				isSelected
					? 'border-ui-accent/60 bg-[rgba(45,212,191,0.06)]'
					: 'border-ui-border bg-[rgba(255,255,255,0.02)]'
			)}
		>
			<div className="min-w-0">
				<p className="truncate text-sm text-foreground">
					Versie {version.version}
					<span className="ml-2 text-xs text-ui-muted">
						{formatDate(version.updatedAt)}
					</span>
				</p>
			</div>

			<div className="flex items-center gap-2">
				{isSelected && (
					<div className="flex overflow-hidden rounded-md border border-ui-border">
						{SIDE_LABELS.map(({ id, label }) => {
							const active = selected!.sides.includes(id);
							return (
								<button
									key={id}
									type="button"
									onClick={() => onToggleSide(version.designId, id)}
									className={cn(
										'px-2.5 py-1 text-xs font-medium transition',
										active
											? 'bg-ui-accent text-slate-900'
											: 'bg-transparent text-ui-muted hover:bg-[rgba(255,255,255,0.06)]'
									)}
								>
									{label}
								</button>
							);
						})}
					</div>
				)}

				{isSelected ? (
					<button
						type="button"
						onClick={() => onRemove(version.designId)}
						className="rounded-md px-3 py-1 text-xs font-medium text-red-400 transition hover:bg-[rgba(255,255,255,0.06)]"
					>
						Verwijderen
					</button>
				) : (
					<button
						type="button"
						onClick={() =>
							onAdd({
								projectId: project.projectId,
								projectName: project.projectName,
								patientName: project.patientName,
								designId: version.designId,
								version: version.version,
							})
						}
						className="rounded-md bg-ui-accent px-3 py-1 text-xs font-medium text-slate-900 transition hover:opacity-90"
					>
						Toevoegen
					</button>
				)}
			</div>
		</div>
	);
}

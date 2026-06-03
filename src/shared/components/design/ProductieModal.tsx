'use client';

import { useEffect, useMemo, useState } from 'react';
import { BaseModal } from '@/src/shared/components/ui/modal';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Loader2 } from 'lucide-react';
import {
	getProductionLibrary,
	type ProductionLibraryProject,
} from '@/src/features/milling/server/production-actions';
import type { PartId, ProductionItem } from '@/src/features/milling/types';
import {
	ProductieVersionRow,
	type AddVersionArgs,
} from './ProductieVersionRow';

interface ProductieModalProps {
	open: boolean;
	onClose: () => void;
	currentProjectId: string;
	currentDesignId: string | null;
	items: ProductionItem[];
	onChange: (items: ProductionItem[]) => void;
}

function makeId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return `pi_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function ProductieModal({
	open,
	onClose,
	currentProjectId,
	currentDesignId,
	items,
	onChange,
}: ProductieModalProps) {
	const [library, setLibrary] = useState<ProductionLibraryProject[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState('');

	// The modal is mounted only while open (see parent), so this fetch runs once
	// per open. State is only set inside async callbacks to avoid cascading
	// renders from synchronous setState in an effect body.
	useEffect(() => {
		let cancelled = false;
		getProductionLibrary()
			.then((data) => {
				if (!cancelled) setLibrary(data);
			})
			.catch((err) => {
				if (!cancelled) setError(err?.message ?? 'Laden mislukt');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const selectedByDesign = useMemo(() => {
		const map = new Map<string, ProductionItem>();
		for (const item of items) map.set(item.designId, item);
		return map;
	}, [items]);

	const { currentProject, otherProjects } = useMemo(() => {
		const lib = library ?? [];
		const current = lib.find((p) => p.projectId === currentProjectId) ?? null;
		const q = query.trim().toLowerCase();
		const others = lib
			.filter((p) => p.projectId !== currentProjectId)
			.filter(
				(p) =>
					q === '' ||
					p.projectName.toLowerCase().includes(q) ||
					p.patientName.toLowerCase().includes(q)
			);
		return { currentProject: current, otherProjects: others };
	}, [library, currentProjectId, query]);

	const addVersion = (args: AddVersionArgs) => {
		const item: ProductionItem = {
			id: makeId(),
			projectId: args.projectId,
			projectName: args.projectName,
			patientName: args.patientName,
			designId: args.designId,
			version: args.version,
			sides: ['left', 'right'],
		};
		onChange([...items.filter((i) => i.designId !== args.designId), item]);
	};

	const removeVersion = (designId: string) => {
		onChange(items.filter((i) => i.designId !== designId));
	};

	const toggleSide = (designId: string, side: PartId) => {
		onChange(
			items.map((i) => {
				if (i.designId !== designId) return i;
				const has = i.sides.includes(side);
				const sides = has
					? i.sides.filter((s) => s !== side)
					: [...i.sides, side];
				return { ...i, sides: sides.length > 0 ? sides : i.sides };
			})
		);
	};

	const currentVersions = (currentProject?.versions ?? []).filter(
		(v) => v.designId !== currentDesignId
	);

	return (
		<BaseModal
			open={open}
			onClose={onClose}
			title="Productie — insolen toevoegen"
			footer={
				<>
					<span className="mr-auto self-center text-xs text-ui-muted">
						{items.length} toegevoegd
					</span>
					<Button className="bg-ui-accent text-slate-900" onClick={onClose}>
						Klaar
					</Button>
				</>
			}
		>
			<div className="flex max-h-[68vh] flex-col">
				<div className="border-b border-ui-border p-4">
					<Input
						variant="dark"
						placeholder="Zoek project of patiënt…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>

				<div className="flex-1 space-y-6 overflow-y-auto p-4">
					{loading && (
						<div className="flex items-center gap-2 text-sm text-ui-muted">
							<Loader2 className="h-4 w-4 animate-spin" /> Laden…
						</div>
					)}
					{error && <p className="text-sm text-red-400">{error}</p>}

					{!loading && !error && (
						<>
							<section className="space-y-2">
								<h3 className="text-xs font-semibold uppercase tracking-wide text-ui-muted">
									Andere versies van dit project
								</h3>
								{currentVersions.length === 0 ? (
									<p className="text-sm text-ui-muted">
										Geen andere versies beschikbaar.
									</p>
								) : (
									currentVersions.map((v) => (
										<ProductieVersionRow
											key={v.designId}
											version={v}
											project={currentProject!}
											selected={selectedByDesign.get(v.designId)}
											onAdd={addVersion}
											onRemove={removeVersion}
											onToggleSide={toggleSide}
										/>
									))
								)}
							</section>

							<section className="space-y-2">
								<h3 className="text-xs font-semibold uppercase tracking-wide text-ui-muted">
									Andere projecten
								</h3>
								{otherProjects.length === 0 ? (
									<p className="text-sm text-ui-muted">Geen projecten gevonden.</p>
								) : (
									otherProjects.map((project) => (
										<div key={project.projectId} className="space-y-1">
											<p className="text-sm font-medium text-foreground">
												{project.projectName}
												<span className="ml-2 text-xs text-ui-muted">
													{project.patientName}
												</span>
											</p>
											{project.versions.map((v) => (
												<ProductieVersionRow
													key={v.designId}
													version={v}
													project={project}
													selected={selectedByDesign.get(v.designId)}
													onAdd={addVersion}
													onRemove={removeVersion}
													onToggleSide={toggleSide}
												/>
											))}
										</div>
									))
								)}
							</section>
						</>
					)}
				</div>
			</div>
		</BaseModal>
	);
}

'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/shared/components/ui/button';
import { Upload, FileBox, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { UploadScansModal } from './UploadScansModal';
import { deleteScanPair } from '@/src/features/projects/server/actions';
import { UiScrollArea } from '@/src/shared/components/ui/scroll-area';

interface ScanData {
	id: string;
	name: string;
	pairId: string;
	footSide: string;
	stlUrl: string;
	createdAt: Date | string;
}

interface ScanPair {
	pairId: string;
	name: string;
	left?: ScanData;
	right?: ScanData;
	createdAt: Date | string;
}

interface ProjectScansCardProps {
	projectId: string;
	orgSlug: string;
	scans: ScanData[];
}

export function ProjectScansCard({ projectId, orgSlug, scans }: ProjectScansCardProps) {
	const router = useRouter();
	const [showUploadModal, setShowUploadModal] = useState(false);
	const [deletingPairId, setDeletingPairId] = useState<string | null>(null);
	const [expandedPairId, setExpandedPairId] = useState<string | null>(null);

	// Group scans by pairId
	const scanPairs = useMemo(() => {
		const map = new Map<string, ScanPair>();
		for (const scan of scans) {
			const existing = map.get(scan.pairId);
			if (existing) {
				if (scan.footSide === 'LEFT') existing.left = scan;
				else existing.right = scan;
			} else {
				map.set(scan.pairId, {
					pairId: scan.pairId,
					name: scan.name || 'Naamloos',
					left: scan.footSide === 'LEFT' ? scan : undefined,
					right: scan.footSide === 'RIGHT' ? scan : undefined,
					createdAt: scan.createdAt,
				});
			}
		}
		return Array.from(map.values()).sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);
	}, [scans]);

	const handleUploadComplete = () => {
		router.refresh();
	};

	const handleDeletePair = async (pairId: string) => {
		if (!confirm('Weet je zeker dat je dit scanpaar wilt verwijderen?')) return;
		setDeletingPairId(pairId);
		try {
			await deleteScanPair(pairId);
			router.refresh();
		} catch (err) {
			console.error('Failed to delete scan pair:', err);
		} finally {
			setDeletingPairId(null);
		}
	};

	return (
		<>
			<div className="flex min-h-0 flex-col rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel pl-6 pt-6 pb-6 pr-1.5 lg:h-full">
				<div className="mb-6 flex shrink-0 items-center justify-between gap-3 pr-[18px]">
					<h2 className="flex items-center gap-3 text-xl font-semibold text-foreground">
						<div className="rounded-xl bg-ui-accent/10 p-2">
							<FileBox className="h-5 w-5 text-ui-accent" />
						</div>
						Scans ({scanPairs.length})
					</h2>
					<Button
						onClick={() => setShowUploadModal(true)}
						className="flex shrink-0 items-center gap-2 rounded-xl bg-ui-accent px-4 py-2 text-sm font-medium text-slate-900 transition-colors"
					>
						<Upload className="h-4 w-4" /> Upload scans
					</Button>
				</div>
				<UiScrollArea>
				{scanPairs.length === 0 ? (
					<div className="flex flex-col items-center justify-center rounded-xl bg-ui-overlay/30 py-12">
						<div className="mb-4 rounded-full bg-ui-overlay p-4">
							<FileBox className="h-8 w-8 text-ui-muted" />
						</div>
						<p className="mb-4 text-center text-ui-muted">
							Nog geen scans. Upload scans om te beginnen.
						</p>
						<Button
							onClick={() => setShowUploadModal(true)}
							className="rounded-xl bg-ui-accent px-5 py-2.5 text-sm font-medium text-slate-900 transition-colors"
						>
							<Upload className="mr-2 h-4 w-4" />
							Upload scans
						</Button>
					</div>
				) : (
					<div className="space-y-3">
						{scanPairs.map((pair) => (
							<div
								key={pair.pairId}
								className="rounded-xl border border-ui-border bg-ui-overlay/20 overflow-hidden"
							>
								{/* Pair header */}
								<div className="flex items-center justify-between p-4">
									<button
										type="button"
										onClick={() => setExpandedPairId(expandedPairId === pair.pairId ? null : pair.pairId)}
										className="flex items-center gap-3 text-left"
									>
										{expandedPairId === pair.pairId
											? <ChevronDown className="h-4 w-4 text-ui-muted" />
											: <ChevronRight className="h-4 w-4 text-ui-muted" />
										}
										<div>
											<p className="font-medium text-foreground">{pair.name}</p>
											<p className="mt-0.5 text-xs text-ui-muted">
												{pair.left ? 'L' : ''}{pair.left && pair.right ? ' + ' : ''}{pair.right ? 'R' : ''}
												{' \u2022 '}
												{new Date(pair.createdAt).toLocaleDateString('nl-NL')}
											</p>
										</div>
									</button>
									<div className="flex items-center gap-2">
										{pair.left && (
											<span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-400">L</span>
										)}
										{pair.right && (
											<span className="rounded-md bg-purple-500/10 px-2 py-0.5 text-[11px] font-semibold text-purple-400">R</span>
										)}
										<button
											type="button"
											onClick={() => handleDeletePair(pair.pairId)}
											disabled={deletingPairId === pair.pairId}
											className="rounded-lg p-2 text-ui-muted transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
											title="Scanpaar verwijderen"
										>
											<Trash2 className={`h-4 w-4 ${deletingPairId === pair.pairId ? 'animate-spin' : ''}`} />
										</button>
									</div>
								</div>
								{/* Expanded detail */}
								{expandedPairId === pair.pairId && (
									<div className="border-t border-ui-border px-4 py-3 space-y-2">
										{pair.left && (
											<div className="flex items-center gap-3">
												<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-xs font-semibold text-blue-400">L</span>
												<div className="text-sm">
													<p className="text-foreground">Linkervoet</p>
													<p className="text-xs text-ui-muted truncate max-w-[200px]">{pair.left.stlUrl.split('/').pop()}</p>
												</div>
											</div>
										)}
										{pair.right && (
											<div className="flex items-center gap-3">
												<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-xs font-semibold text-purple-400">R</span>
												<div className="text-sm">
													<p className="text-foreground">Rechtervoet</p>
													<p className="text-xs text-ui-muted truncate max-w-[200px]">{pair.right.stlUrl.split('/').pop()}</p>
												</div>
											</div>
										)}
									</div>
								)}
							</div>
						))}
					</div>
				)}
				</UiScrollArea>
			</div>

			<UploadScansModal
				open={showUploadModal}
				onClose={() => setShowUploadModal(false)}
				projectId={projectId}
				onUploadComplete={handleUploadComplete}
			/>
		</>
	);
}

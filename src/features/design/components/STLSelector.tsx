'use client';

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { useState, useMemo } from 'react';

interface Scan {
	id: string;
	name: string;
	pairId: string;
	footSide: string;
	stlUrl: string;
}

interface ScanPairDisplay {
	pairId: string;
	name: string;
	left?: Scan;
	right?: Scan;
}

interface STLSelectorProps {
	scans: Scan[];
	onLeftSelect: (scanId: string) => void;
	onRightSelect: (scanId: string) => void;
	onContinue: () => void;
}

export function STLSelector({
	scans,
	onLeftSelect,
	onRightSelect,
	onContinue,
}: STLSelectorProps) {
	const [selectedPairId, setSelectedPairId] = useState<string | null>(null);

	// Group scans into pairs by pairId
	const scanPairs = useMemo(() => {
		const map = new Map<string, ScanPairDisplay>();
		for (const scan of scans) {
			const existing = map.get(scan.pairId);
			const side = scan.footSide.toUpperCase();
			if (existing) {
				if (side === 'LEFT') existing.left = scan;
				else existing.right = scan;
			} else {
				map.set(scan.pairId, {
					pairId: scan.pairId,
					name: scan.name || 'Naamloos',
					left: side === 'LEFT' ? scan : undefined,
					right: side === 'RIGHT' ? scan : undefined,
				});
			}
		}
		return Array.from(map.values());
	}, [scans]);

	const selectedPair = scanPairs.find(p => p.pairId === selectedPairId);
	const canContinue = selectedPair?.left && selectedPair?.right;

	const handleSelectPair = (pair: ScanPairDisplay) => {
		setSelectedPairId(pair.pairId);
		if (pair.left) onLeftSelect(pair.left.id);
		if (pair.right) onRightSelect(pair.right.id);
	};

	return (
		<div className="w-full max-w-2xl mx-auto p-8">
			<Card className="border-ui-border bg-ui-card">
				<CardHeader>
					<CardTitle className="text-2xl text-foreground">Selecteer scans</CardTitle>
					<p className="text-ui-muted mt-2">
						Kies een scanpaar om mee te werken
					</p>
				</CardHeader>
				<CardContent>
					{scanPairs.length === 0 ? (
						<div className="py-12 text-center text-ui-muted">
							Nog geen scans beschikbaar. Upload eerst scans op de projectpagina.
						</div>
					) : (
						<div className="space-y-3 mb-6">
							{scanPairs.map((pair) => (
								<button
									key={pair.pairId}
									onClick={() => handleSelectPair(pair)}
									className={`
										w-full p-4 rounded-xl border-2 text-left transition-all
										${
											selectedPairId === pair.pairId
												? 'border-ui-accent bg-[rgba(99,247,214,0.08)] shadow-md'
												: 'border-ui-border bg-[rgba(255,255,255,0.02)] hover:border-ui-accent/50'
										}
									`}
								>
									<div className="flex items-center justify-between">
										<div>
											<div className="font-semibold text-foreground">{pair.name}</div>
											<div className="text-sm text-ui-muted mt-1">
												{pair.left ? 'Links ✓' : 'Links —'} / {pair.right ? 'Rechts ✓' : 'Rechts —'}
											</div>
										</div>
										<div className="flex gap-1.5">
											{pair.left && (
												<span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-400">L</span>
											)}
											{pair.right && (
												<span className="rounded-md bg-purple-500/10 px-2 py-0.5 text-xs font-semibold text-purple-400">R</span>
											)}
										</div>
									</div>
								</button>
							))}
						</div>
					)}

					{/* Continue Button */}
					<div className="flex justify-end">
						<Button
							size="lg"
							onClick={onContinue}
							disabled={!canContinue}
							className="min-w-32 rounded-xl bg-ui-accent text-slate-900 font-semibold disabled:opacity-50"
						>
							Doorgaan →
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

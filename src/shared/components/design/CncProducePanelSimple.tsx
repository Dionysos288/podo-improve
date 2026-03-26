'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/src/shared/lib/cn';
import {
	SLOT_COUNT,
	SLOT_COORDINATE_SYSTEMS,
	type FixtureLayout,
	type SlotAssignment,
	type PartId,
	type MillingMode,
	MILLING_MODE_OPTIONS,
} from '@/src/features/milling/types';

// ──────────────────────────────────────────────
// CNC Produce Panel (simplified)
// Pair L+R in one slot, show slot grid + Export
// ──────────────────────────────────────────────

interface CncProducePanelProps {
	millingMode: MillingMode;
	fixture: FixtureLayout;
	onFixtureChange: (fixture: FixtureLayout) => void;
	patientName: string;
	onExportNc: () => void | Promise<void>;
	onBack: () => void;
}

export function CncProducePanel({
	millingMode,
	fixture,
	onFixtureChange,
	patientName,
	onExportNc,
	onBack,
}: CncProducePanelProps) {
	const [isExporting, setIsExporting] = useState(false);
	const waitForPaint = useCallback(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		[]
	);
	const modeLabel =
		MILLING_MODE_OPTIONS.find((o) => o.value === millingMode)?.label ??
		millingMode;

	// ── Slot helpers ──

	const getSlotParts = useCallback(
		(slotIndex: number): SlotAssignment[] =>
			fixture.assignments.filter((a) => a.slotIndex === slotIndex),
		[fixture.assignments]
	);

	/** Toggle a pair (L+R) into / out of a slot */
	const toggleSlotPair = useCallback(
		(slotIndex: number) => {
			const existing = fixture.assignments.filter(
				(a) => a.slotIndex === slotIndex
			);
			if (existing.length > 0) {
				// Clear slot
				onFixtureChange({
					...fixture,
					assignments: fixture.assignments.filter(
						(a) => a.slotIndex !== slotIndex
					),
				});
			} else {
				// Assign pair (L+R) to this slot
				const newAssignments: SlotAssignment[] = [
					...fixture.assignments.filter((a) => a.slotIndex !== slotIndex),
					{
						slotIndex,
						partId: 'left' as PartId,
						label: `${patientName} - Links`,
					},
					{
						slotIndex,
						partId: 'right' as PartId,
						label: `${patientName} - Rechts`,
					},
				];
				onFixtureChange({ ...fixture, assignments: newAssignments });
			}
		},
		[fixture, onFixtureChange, patientName]
	);

	const filledSlots = new Set(fixture.assignments.map((a) => a.slotIndex));
	const filledCount = filledSlots.size;

	const handleExport = useCallback(async () => {
		if (filledCount === 0 || isExporting) return;
		setIsExporting(true);
		try {
			await waitForPaint();
			await onExportNc();
		} finally {
			setIsExporting(false);
		}
	}, [filledCount, isExporting, onExportNc, waitForPaint]);

	return (
		<Card>
			<CardContent className="space-y-4">
				{/* Header */}
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onBack}
						disabled={isExporting}
						className="flex items-center gap-1 text-sm text-ui-muted hover:text-ui-text transition"
					>
						<ArrowLeft size={16} />
						<span>Terug</span>
					</button>
				</div>

				{/* Mode info */}
				<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm">
					<span className="text-ui-muted">Freesmodus</span>
					<span className="text-ui-text">{modeLabel}</span>
				</div>

				{/* ── Slot grid ── */}
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium uppercase tracking-wide text-ui-text/70">
							Fixture — {filledCount}/{SLOT_COUNT} slots
						</span>
					</div>

					<p className="text-[11px] text-ui-muted">
						Klik op een slot om een paar (L+R) toe te wijzen.
					</p>

					{/* Slot grid: 4 × 2 */}
					<div className="grid grid-cols-4 gap-2">
						{Array.from({ length: SLOT_COUNT }, (_, i) => {
							const parts = getSlotParts(i);
							const isEmpty = parts.length === 0;
							const coordSys = SLOT_COORDINATE_SYSTEMS[i];

							return (
								<button
									key={i}
									type="button"
									disabled={isExporting}
									onClick={() => toggleSlotPair(i)}
									className={cn(
										'relative flex flex-col items-center justify-center rounded-xl border-2 py-3 transition-all min-h-[80px]',
										isExporting && 'cursor-wait opacity-60',
										isEmpty
											? 'border-dashed border-ui-border bg-[rgba(255,255,255,0.02)] hover:border-ui-accent/40 hover:bg-ui-accent/5 cursor-pointer'
											: 'border-solid border-ui-accent/60 bg-ui-accent/10 hover:border-red-400 hover:bg-red-400/10 cursor-pointer'
									)}
									title={
										isEmpty
											? `Slot ${i + 1} (${coordSys}) — klik om paar te plaatsen`
											: `Slot ${i + 1} — klik om te verwijderen`
									}
								>
									{/* Slot number */}
									<span className="text-[10px] text-ui-muted font-mono absolute top-1 left-1.5">
										{i + 1}
									</span>

									{isEmpty ? (
										<span className="text-[10px] text-ui-muted">
											{coordSys}
										</span>
									) : (
										<>
											{/* Pair icon: two mini insoles side by side */}
											<svg
												viewBox="0 0 48 40"
												className="w-8 h-7 mb-0.5"
												xmlns="http://www.w3.org/2000/svg"
											>
												{/* Left insole */}
												<path
													d="M8,4 C4,4 2,8 2,14 C2,20 3,26 4,30 C5,34 7,38 12,38 C17,38 19,34 20,30 C21,26 22,20 22,14 C22,8 20,4 16,4 C14,4 10,4 8,4Z"
													fill="rgba(99,247,214,0.35)"
													stroke="rgba(99,247,214,0.7)"
													strokeWidth="1"
												/>
												{/* Right insole */}
												<path
													d="M40,4 C44,4 46,8 46,14 C46,20 45,26 44,30 C43,34 41,38 36,38 C31,38 29,34 28,30 C27,26 26,20 26,14 C26,8 28,4 32,4 C34,4 38,4 40,4Z"
													fill="rgba(99,247,214,0.35)"
													stroke="rgba(99,247,214,0.7)"
													strokeWidth="1"
												/>
											</svg>
											<span className="text-[9px] text-ui-accent font-medium">
												L + R
											</span>
										</>
									)}
								</button>
							);
						})}
					</div>
				</div>

				{/* ── Export button ── */}
				<Button
					className="w-full bg-ui-accent text-slate-900 hover:opacity-90"
					onClick={handleExport}
					disabled={filledCount === 0 || isExporting}
					title={
						filledCount === 0
							? 'Wijs minstens één slot toe om te exporteren'
							: undefined
					}
				>
					{isExporting ? (
						<span className="inline-flex items-center gap-2">
							<Loader2 className="h-4 w-4 animate-spin" />
							NC bestand genereren...
						</span>
					) : (
						'Exporteren'
					)}
				</Button>

				{isExporting && (
					<p className="text-xs text-ui-muted text-center">
						Even wachten — de freesbanen worden opgebouwd.
					</p>
				)}

				{filledCount === 0 && (
					<p className="text-xs text-ui-muted text-center">
						Wijs steunzolen toe aan slots om een .nc bestand te genereren.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

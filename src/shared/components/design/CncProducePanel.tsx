'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/src/shared/lib/cn';
import {
	SLOT_COUNT,
	SLOT_COORDINATE_SYSTEMS,
	type FixtureLayout,
	type SlotAssignment,
	type PartId,
	type MillingMode,
	type CncToolSettings,
	DEFAULT_CNC_TOOL_SETTINGS,
	MILLING_MODE_OPTIONS,
	isDoubleSided,
} from '@/src/features/milling/types';

// ──────────────────────────────────────────────
// CNC Produce Panel
// 8-slot fixture planning + .nc file export
// ──────────────────────────────────────────────

type ViewTab = 'weergave' | 'frezen';

interface CncProducePanelProps {
	millingMode: MillingMode;
	fixture: FixtureLayout;
	onFixtureChange: (fixture: FixtureLayout) => void;
	toolSettings: CncToolSettings;
	onToolSettingsChange: (settings: CncToolSettings) => void;
	patientName: string;
	onExportNc: () => void;
	onBack: () => void;
	/** Available parts that can be assigned to slots */
	availableParts: { id: PartId; label: string }[];
}

export function CncProducePanel({
	millingMode,
	fixture,
	onFixtureChange,
	toolSettings,
	onToolSettingsChange,
	patientName,
	onExportNc,
	onBack,
	availableParts,
}: CncProducePanelProps) {
	const [activeTab, setActiveTab] = useState<ViewTab>('weergave');
	const [dragPartId, setDragPartId] = useState<PartId | null>(null);

	const modeLabel =
		MILLING_MODE_OPTIONS.find((o) => o.value === millingMode)?.label ??
		millingMode;

	// ── Slot assignment helpers ──

	const getSlotAssignment = useCallback(
		(slotIndex: number): SlotAssignment | undefined =>
			fixture.assignments.find((a) => a.slotIndex === slotIndex),
		[fixture.assignments]
	);

	const assignSlot = useCallback(
		(slotIndex: number, partId: PartId) => {
			const newAssignments = fixture.assignments.filter(
				(a) => a.slotIndex !== slotIndex
			);
			newAssignments.push({
				slotIndex,
				partId,
				label: `${patientName} - ${partId === 'left' ? 'Links' : 'Rechts'}`,
			});
			onFixtureChange({ ...fixture, assignments: newAssignments });
		},
		[fixture, onFixtureChange, patientName]
	);

	const clearSlot = useCallback(
		(slotIndex: number) => {
			onFixtureChange({
				...fixture,
				assignments: fixture.assignments.filter(
					(a) => a.slotIndex !== slotIndex
				),
			});
		},
		[fixture, onFixtureChange]
	);

	const handleSlotClick = useCallback(
		(slotIndex: number) => {
			if (dragPartId) {
				assignSlot(slotIndex, dragPartId);
				setDragPartId(null);
				return;
			}
			const existing = getSlotAssignment(slotIndex);
			if (existing) {
				clearSlot(slotIndex);
			}
		},
		[dragPartId, assignSlot, clearSlot, getSlotAssignment]
	);

	const assignedCount = fixture.assignments.length;

	// ── Tool settings helpers ──

	const updateTool = (updates: Partial<CncToolSettings>) => {
		onToolSettingsChange({ ...toolSettings, ...updates });
	};

	return (
		<Card>
			<CardContent className="space-y-4">
				{/* Header */}
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onBack}
						className="flex items-center gap-1 text-sm text-ui-muted hover:text-ui-text transition"
					>
						<ArrowLeft size={16} />
						<span>Terug</span>
					</button>
				</div>

				{/* Tab bar */}
				<div className="flex rounded-lg border border-ui-border overflow-hidden">
					{(
						[
							{ key: 'weergave' as ViewTab, label: '🔧 Weergave' },
							{ key: 'frezen' as ViewTab, label: '⚙ Frezen' },
						] as const
					).map((tab) => (
						<button
							key={tab.key}
							type="button"
							onClick={() => setActiveTab(tab.key)}
							className={cn(
								'flex-1 py-2 text-xs font-semibold transition-colors',
								activeTab === tab.key
									? 'bg-ui-accent text-slate-900'
									: 'bg-transparent text-ui-text hover:bg-white/5'
							)}
						>
							{tab.label}
						</button>
					))}
				</div>

				{activeTab === 'weergave' && (
					<>
						{/* ── View preset buttons ── */}
						<div className="grid grid-cols-3 gap-1.5">
							{['Draaien', 'Voor', 'Pannen'].map((label) => (
								<button
									key={label}
									type="button"
									className="rounded-lg bg-[rgba(255,255,255,0.04)] px-2 py-2 text-xs text-ui-text hover:bg-[rgba(255,255,255,0.08)] transition"
								>
									{label}
								</button>
							))}
							{['Links', 'Rechts', ''].map((label, i) =>
								label ? (
									<button
										key={label}
										type="button"
										className="rounded-lg bg-[rgba(255,255,255,0.04)] px-2 py-2 text-xs text-ui-text hover:bg-[rgba(255,255,255,0.08)] transition"
									>
										{label}
									</button>
								) : (
									<div key={`empty-${i}`} />
								)
							)}
							{['Achter', ''].map((label, i) =>
								label ? (
									<button
										key={label}
										type="button"
										className="rounded-lg bg-[rgba(255,255,255,0.04)] px-2 py-2 text-xs text-ui-text hover:bg-[rgba(255,255,255,0.08)] transition"
									>
										{label}
									</button>
								) : (
									<div key={`empty2-${i}`} />
								)
							)}
						</div>

						{/* ── 8 Slot fixture grid ── */}
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<span className="text-xs font-medium uppercase tracking-wide text-ui-text/70">
									Fixture — {assignedCount}/{SLOT_COUNT} slots
								</span>
								<span className="text-[10px] text-ui-muted">
									{modeLabel}
								</span>
							</div>

							{/* Part palette: drag source */}
							<div className="flex gap-2">
								{availableParts.map((part) => (
									<button
										key={part.id}
										type="button"
										onClick={() =>
											setDragPartId(
												dragPartId === part.id ? null : part.id
											)
										}
										className={cn(
											'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition',
											dragPartId === part.id
												? 'border-ui-accent bg-ui-accent/15 text-ui-accent'
												: 'border-ui-border bg-[rgba(255,255,255,0.03)] text-ui-text hover:border-ui-accent/40'
										)}
									>
										{part.label}
									</button>
								))}
							</div>

							{dragPartId && (
								<p className="text-[11px] text-ui-accent animate-pulse">
									Klik op een slot om{' '}
									{dragPartId === 'left' ? 'links' : 'rechts'} te plaatsen
								</p>
							)}

							{/* Slot grid: 4 × 2 */}
							<div className="grid grid-cols-4 gap-2">
								{Array.from({ length: SLOT_COUNT }, (_, i) => {
									const assignment = getSlotAssignment(i);
									const coordSys = SLOT_COORDINATE_SYSTEMS[i];
									const isEmpty = !assignment;

									return (
										<button
											key={i}
											type="button"
											onClick={() => handleSlotClick(i)}
											className={cn(
												'relative flex flex-col items-center justify-center rounded-xl border-2 py-4 transition-all min-h-[80px]',
												isEmpty
													? dragPartId
														? 'border-dashed border-ui-accent/40 bg-ui-accent/5 hover:bg-ui-accent/10 cursor-pointer'
														: 'border-dashed border-ui-border bg-[rgba(255,255,255,0.02)]'
													: 'border-solid border-ui-accent/60 bg-ui-accent/10 hover:border-red-400 hover:bg-red-400/10 cursor-pointer'
											)}
											title={
												isEmpty
													? `Slot ${i + 1} (${coordSys}) — leeg`
													: `${assignment.label} — klik om te verwijderen`
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
													{/* Mini insole icon */}
													<svg
														viewBox="0 0 24 40"
														className="w-5 h-8 mb-0.5"
														xmlns="http://www.w3.org/2000/svg"
													>
														<path
															d={
																assignment.partId === 'left'
																	? 'M8,4 C4,4 2,8 2,14 C2,20 3,26 4,30 C5,34 7,38 12,38 C17,38 19,34 20,30 C21,26 22,20 22,14 C22,8 20,4 16,4 C14,4 10,4 8,4Z'
																	: 'M16,4 C20,4 22,8 22,14 C22,20 21,26 20,30 C19,34 17,38 12,38 C7,38 5,34 4,30 C3,26 2,20 2,14 C2,8 4,4 8,4 C10,4 14,4 16,4Z'
															}
															fill="rgba(99,247,214,0.4)"
															stroke="rgba(99,247,214,0.8)"
															strokeWidth="1"
														/>
													</svg>
													<span className="text-[9px] text-ui-accent font-medium truncate max-w-full px-1">
														{assignment.partId === 'left'
															? 'L'
															: 'R'}
													</span>
												</>
											)}
										</button>
									);
								})}
							</div>
						</div>
					</>
				)}

				{activeTab === 'frezen' && (
					<>
						{/* ── Basis info ── */}
						<h4 className="text-sm font-semibold text-ui-accent">Basis</h4>

						<div className="space-y-2 text-sm">
							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Freesmodus</span>
								<span className="text-ui-text">{modeLabel}</span>
							</div>
							{isDoubleSided(millingMode) && (
								<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
									<span className="text-ui-muted">Blok dikte</span>
									<span className="text-ui-text">
										{MILLING_MODE_OPTIONS.find(
											(o) => o.value === millingMode
										)?.stockThicknessMm ?? '–'}{' '}
										mm
									</span>
								</div>
							)}
						</div>

						{/* ── Productie info ── */}
						<h4 className="text-sm font-semibold text-ui-accent pt-2">
							Productie
						</h4>

						<div className="space-y-2 text-sm">
							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Slots bezet</span>
								<span className="text-ui-text">
									{assignedCount} / {SLOT_COUNT}
								</span>
							</div>
						</div>

						{/* ── Tool settings ── */}
						<h4 className="text-sm font-semibold text-ui-accent pt-2">
							Gereedschap
						</h4>

						<div className="space-y-2 text-sm">
							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Frees type</span>
								<select
									className="bg-transparent text-ui-text text-right cursor-pointer outline-none"
									value={toolSettings.toolType}
									onChange={(e) =>
										updateTool({
											toolType: e.target.value as CncToolSettings['toolType'],
										})
									}
								>
									<option value="ball-nose" className="bg-ui-panel">
										Bolfrees
									</option>
									<option value="flat-end" className="bg-ui-panel">
										Vlakfrees
									</option>
									<option value="bull-nose" className="bg-ui-panel">
										Radiusfrees
									</option>
								</select>
							</div>

							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Diameter</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										min={1}
										max={25}
										step={0.5}
										value={toolSettings.toolDiameterMm}
										onChange={(e) =>
											updateTool({
												toolDiameterMm:
													parseFloat(e.target.value) || 6,
											})
										}
										className="w-14 bg-transparent text-ui-text text-right outline-none"
									/>
									<span className="text-ui-muted">mm</span>
								</div>
							</div>

							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Spil snelheid</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										min={1000}
										max={30000}
										step={500}
										value={toolSettings.spindleSpeedRpm}
										onChange={(e) =>
											updateTool({
												spindleSpeedRpm:
													parseInt(e.target.value, 10) || 18000,
											})
										}
										className="w-16 bg-transparent text-ui-text text-right outline-none"
									/>
									<span className="text-ui-muted">rpm</span>
								</div>
							</div>

							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Voeding XY</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										min={100}
										max={10000}
										step={100}
										value={toolSettings.feedRateXYMmMin}
										onChange={(e) =>
											updateTool({
												feedRateXYMmMin:
													parseInt(e.target.value, 10) || 2000,
											})
										}
										className="w-16 bg-transparent text-ui-text text-right outline-none"
									/>
									<span className="text-ui-muted">mm/min</span>
								</div>
							</div>

							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Voeding Z</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										min={50}
										max={5000}
										step={50}
										value={toolSettings.feedRateZMmMin}
										onChange={(e) =>
											updateTool({
												feedRateZMmMin:
													parseInt(e.target.value, 10) || 600,
											})
										}
										className="w-16 bg-transparent text-ui-text text-right outline-none"
									/>
									<span className="text-ui-muted">mm/min</span>
								</div>
							</div>

							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Stepover</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										min={5}
										max={90}
										step={5}
										value={toolSettings.stepoverPercent}
										onChange={(e) =>
											updateTool({
												stepoverPercent:
													parseInt(e.target.value, 10) || 40,
											})
										}
										className="w-14 bg-transparent text-ui-text text-right outline-none"
									/>
									<span className="text-ui-muted">%</span>
								</div>
							</div>

							<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
								<span className="text-ui-muted">Safe Z</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										min={1}
										max={50}
										step={1}
										value={toolSettings.safeZMm}
										onChange={(e) =>
											updateTool({
												safeZMm:
													parseFloat(e.target.value) || 5,
											})
										}
										className="w-14 bg-transparent text-ui-text text-right outline-none"
									/>
									<span className="text-ui-muted">mm</span>
								</div>
							</div>
						</div>
					</>
				)}

				{/* ── Tafel vervangen action ── */}
				<div className="space-y-2 text-sm">
					<div className="flex items-center justify-between">
						<span className="text-ui-muted">Tafel vervangen</span>
						<span className="text-ui-muted">Open</span>
					</div>
				</div>

				{/* ── Export button ── */}
				<Button
					className="w-full bg-ui-accent text-slate-900 hover:opacity-90"
					onClick={onExportNc}
					disabled={assignedCount === 0}
					title={
						assignedCount === 0
							? 'Wijs minstens één slot toe om te exporteren'
							: undefined
					}
				>
					Exporteren
				</Button>

				{assignedCount === 0 && (
					<p className="text-xs text-ui-muted text-center">
						Wijs steunzolen toe aan slots om een .nc bestand te genereren.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

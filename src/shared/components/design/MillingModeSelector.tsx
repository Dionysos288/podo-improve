'use client';

import { cn } from '@/src/shared/lib/cn';
import {
	MILLING_MODE_OPTIONS,
	type MillingMode,
} from '@/src/features/milling/types';

// ──────────────────────────────────────────────
// Milling Mode Selector
// Shown as a modal / interstitial when user clicks
// "Direct produceren" with Frezen: EVA active.
// ──────────────────────────────────────────────

interface MillingModeSelectorProps {
	selectedMode: MillingMode | null;
	onSelect: (mode: MillingMode) => void;
	onClose: () => void;
}

export function MillingModeSelector({
	selectedMode,
	onSelect,
	onClose,
}: MillingModeSelectorProps) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
			<div className="w-full max-w-md rounded-2xl border border-ui-border bg-ui-panel p-6 shadow-2xl">
				{/* Header */}
				<div className="mb-5 flex items-center justify-between">
					<h3 className="text-base font-semibold text-ui-text">
						Selecteer freeswijze
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="h-7 w-7 rounded-full text-ui-muted hover:bg-white/10 hover:text-ui-text transition flex items-center justify-center"
					>
						✕
					</button>
				</div>

				{/* Options */}
				<div className="space-y-2">
					{MILLING_MODE_OPTIONS.map((option, index) => {
						const isSelected = selectedMode === option.value;
						return (
							<button
								key={option.value}
								type="button"
								onClick={() => onSelect(option.value)}
								className={cn(
									'flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all',
									isSelected
										? 'border-ui-accent bg-ui-accent/10'
										: 'border-ui-border bg-[rgba(255,255,255,0.03)] hover:border-ui-accent/40 hover:bg-[rgba(255,255,255,0.05)]'
								)}
							>
								{/* Radio indicator */}
								<div
									className={cn(
										'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
										isSelected
											? 'border-ui-accent'
											: 'border-ui-muted'
									)}
								>
									{isSelected && (
										<div className="h-2.5 w-2.5 rounded-full bg-ui-accent" />
									)}
								</div>

								{/* Label */}
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<span className="text-xs text-ui-muted font-mono">
											{String(index + 1).padStart(2, '0')}
										</span>
										<span
											className={cn(
												'text-sm font-medium',
												isSelected ? 'text-ui-accent' : 'text-ui-text'
											)}
										>
											{option.label}
										</span>
									</div>
								</div>

								{/* Selection badge */}
								{isSelected && (
									<span className="rounded-md bg-ui-accent px-2 py-0.5 text-xs font-semibold text-slate-900">
										Geselecteerd
									</span>
								)}
							</button>
						);
					})}
				</div>

				{/* Footer hint */}
				<p className="mt-4 text-xs text-ui-muted">
					Dubbelzijdig frezen vereist het omdraaien van het EVA blok halverwege
					het programma. De dikte bepaalt het type EVA blok dat wordt gebruikt.
				</p>
			</div>
		</div>
	);
}

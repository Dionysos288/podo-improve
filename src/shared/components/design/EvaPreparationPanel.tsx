'use client';

import { cn } from '@/src/shared/lib/cn';
import type { EvaPreparationSettings } from '@/src/features/milling/types';

// ──────────────────────────────────────────────
// EVA Preparation Panel (Step 3 for Frezen: EVA)
// ──────────────────────────────────────────────

interface EvaPreparationPanelProps {
	settings: EvaPreparationSettings;
	onSettingsChange: (settings: EvaPreparationSettings) => void;
}

export function EvaPreparationPanel({
	settings,
	onSettingsChange,
}: EvaPreparationPanelProps) {
	const update = (updates: Partial<EvaPreparationSettings>) => {
		onSettingsChange({ ...settings, ...updates });
	};

	return (
		<div className="space-y-5">
			{/* ── Instellingen section ── */}
			<div className="space-y-3">
				<h4 className="text-sm font-semibold text-ui-accent">Instellingen</h4>

				{/* Elementen vloeien toggle */}
				<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
					<div className="flex flex-col">
						<span className="text-sm text-ui-text">Elementen</span>
						<span className="text-xs text-ui-muted">vloeien</span>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={settings.elementsFlow}
						onClick={() => update({ elementsFlow: !settings.elementsFlow })}
						className={cn(
							'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
							settings.elementsFlow ? 'bg-ui-accent' : 'bg-ui-border'
						)}
					>
						<span
							className={cn(
								'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
								settings.elementsFlow ? 'translate-x-4' : 'translate-x-0'
							)}
						/>
					</button>
				</div>
			</div>

			{/* ── Optimalisatie section ── */}
			<div className="space-y-3">
				<h4 className="text-sm font-semibold text-ui-accent">Optimalisatie</h4>

				{/* Hiel dikte */}
				<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
					<span className="text-sm text-ui-text">Hiel dikte</span>
					<div className="flex items-center gap-2">
						<input
							type="number"
							min={0}
							max={20}
							step={0.5}
							value={settings.heelThicknessMm}
							onChange={(e) => {
								const v = parseFloat(e.target.value);
								if (!Number.isNaN(v)) update({ heelThicknessMm: v });
							}}
							className="w-16 rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-2 py-1.5 text-sm text-ui-text text-center focus:outline-none focus:border-ui-accent"
						/>
						<span className="text-xs text-ui-muted">mm</span>
					</div>
				</div>
			</div>

		</div>
	);
}

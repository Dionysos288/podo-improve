'use client';

import { cn } from '@/src/shared/lib/cn';

export function PrintPreparationPanel(props: {
	step3Side: 'left' | 'right';
	onStep3Side(side: 'left' | 'right'): void;
	elementsVloeien: boolean;
	onToggleVloeien(): void;
	heelEdgeThicknessMm: number;
	onHeelEdgeChange(v: number): void;
	elementsSplit: boolean;
	onToggleSplit(): void;
	sideLabel: string;
	className?: string;
}) {
	const {
		step3Side,
		onStep3Side,
		elementsVloeien,
		onToggleVloeien,
		heelEdgeThicknessMm,
		onHeelEdgeChange,
		elementsSplit,
		onToggleSplit,
		sideLabel,
		className,
	} = props;

	return (
		<div className={cn('space-y-5', className)}>
			<div className="flex rounded-lg border border-ui-border overflow-hidden">
				{(['left', 'right'] as const).map((side) => (
					<button
						key={side}
						type="button"
						onClick={() => onStep3Side(side)}
						className={cn(
							'flex-1 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors min-h-11 touch-manipulation',
							step3Side === side
								? 'bg-ui-accent text-slate-900'
								: 'bg-transparent text-ui-text hover:bg-white/5',
						)}
					>
						{side === 'left' ? 'Links' : 'Rechts'}
					</button>
				))}
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
					<div className="flex flex-col">
						<span className="text-sm text-ui-text">Elementen</span>
						<span className="text-xs text-ui-muted">vloeien</span>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={elementsVloeien}
						onClick={onToggleVloeien}
						className={cn(
							'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
							elementsVloeien ? 'bg-ui-accent' : 'bg-ui-border',
						)}
					>
						<span
							className={cn(
								'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
								elementsVloeien ? 'translate-x-4' : 'translate-x-0',
							)}
						/>
					</button>
				</div>
			</div>

			<div className="space-y-1.5">
				<span className="text-xs font-medium uppercase tracking-wide text-(--ui-text)/70">
					Hielrand dikte ({sideLabel})
				</span>
				<div className="flex items-center gap-2">
					<input
						type="number"
						min={0}
						max={10}
						step={0.1}
						value={heelEdgeThicknessMm}
						onChange={(e) => {
							const v = parseFloat(e.target.value);
							if (!Number.isNaN(v)) onHeelEdgeChange(v);
						}}
						className="w-20 min-h-11 rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm text-ui-text text-center focus:outline-none focus:border-ui-accent"
					/>
					<span className="text-xs text-ui-muted">mm</span>
				</div>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<span className="text-xs font-medium uppercase tracking-wide text-(--ui-text)/70">
						Elementen splitsen
					</span>
					<button
						type="button"
						role="switch"
						aria-checked={elementsSplit}
						onClick={onToggleSplit}
						className={cn(
							'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
							elementsSplit ? 'bg-ui-accent' : 'bg-ui-border',
						)}
					>
						<span
							className={cn(
								'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
								elementsSplit ? 'translate-x-4' : 'translate-x-0',
							)}
						/>
					</button>
				</div>
			</div>
		</div>
	);
}

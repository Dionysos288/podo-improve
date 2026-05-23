'use client';

import { cn } from '@/src/shared/lib/cn';
import type { HardnessKey } from '@/src/features/printers/types/printers';

export type HardnessPickerOption = { key: HardnessKey; label: string; color: string };

export function PrintHardnessPicker(props: {
	options: HardnessPickerOption[];
	activeKey: HardnessKey;
	activeProfiles: Record<HardnessKey, { infillPercent: number }>;
	onPick: (key: HardnessKey) => void;
	className?: string;
}) {
	const { options, activeKey, activeProfiles, onPick, className } = props;

	return (
		<div className={cn('grid grid-cols-1 gap-1', className)}>
			{options.map(({ key, label: optLabel, color }) => {
				const active = activeKey === key;
				const infill = activeProfiles[key]?.infillPercent ?? '–';
				return (
					<button
						key={key}
						type="button"
						onClick={() => onPick(key)}
						className={cn(
							'flex min-h-11 touch-manipulation items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
							active
								? 'border-ui-accent bg-ui-accent/10 text-ui-accent'
								: 'border-ui-border bg-[rgba(255,255,255,0.04)] text-ui-text hover:border-ui-accent/50',
						)}
					>
						<span
							className="inline-block h-3 w-3 shrink-0 rounded-full"
							style={{ background: color }}
						/>
						<span className="flex-1 text-left">{optLabel}</span>
						<span className="text-xs text-(--ui-text)/50">{infill}%</span>
					</button>
				);
			})}
		</div>
	);
}

'use client';

import { cn } from '@/src/shared/lib/cn';
import { useCallback } from 'react';

/** Per-region trimline offsets in mm (added on top of the base 3mm offset). */
export interface TrimlineAdjustments {
	/** Global extra offset applied everywhere (default 0) */
	global: number;
	/** Heel region t ∈ [0, 0.25] */
	heel: number;
	/** Midfoot region t ∈ [0.25, 0.55] */
	midfoot: number;
	/** Forefoot region t ∈ [0.55, 0.82] */
	forefoot: number;
	/** Toe region t ∈ [0.82, 1.0] */
	toe: number;
}

export interface TrimlineHandleProfile {
	bins: number;
	tValues: number[];
	rightOffsetsMm: number[];
	leftOffsetsMm: number[];
}

export const DEFAULT_TRIMLINE_ADJUSTMENTS: TrimlineAdjustments = {
	global: 0,
	heel: 0,
	midfoot: 0,
	forefoot: 0,
	toe: 0,
};

interface TrimlineEditOverlayProps {
	selectedSide: 'left' | 'right';
	adjustments: TrimlineAdjustments;
	onChange: (adjustments: TrimlineAdjustments) => void;
	onClose: () => void;
	className?: string;
}

const REGIONS: Array<{
	key: keyof Omit<TrimlineAdjustments, 'global'>;
	label: string;
	description: string;
}> = [
	{ key: 'toe', label: 'Teen', description: 'Voorste deel' },
	{ key: 'forefoot', label: 'Voorvoet', description: 'Ballengebied' },
	{ key: 'midfoot', label: 'Middenvoet', description: 'Booggebied' },
	{ key: 'heel', label: 'Hiel', description: 'Achterste deel' },
];

function SliderRow({
	label,
	description,
	value,
	onChange,
	min = -5,
	max = 8,
	step = 0.5,
}: {
	label: string;
	description: string;
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
	step?: number;
}) {
	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between">
				<div>
					<span className="text-sm font-medium">{label}</span>
					<span className="ml-2 text-[10px] text-(--ui-muted)">{description}</span>
				</div>
				<div className="flex items-center gap-1">
					<span
						className={cn(
							'min-w-[48px] text-right text-sm font-mono',
							value > 0
								? 'text-emerald-400'
								: value < 0
									? 'text-rose-400'
									: 'text-(--ui-muted)'
						)}
					>
						{value > 0 ? '+' : ''}
						{value.toFixed(1)}
					</span>
					<span className="text-[10px] text-(--ui-muted)">mm</span>
				</div>
			</div>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(parseFloat(e.target.value))}
				className="w-full h-1.5 rounded-full appearance-none bg-[rgba(255,255,255,0.12)] cursor-pointer
					[&::-webkit-slider-thumb]:appearance-none
					[&::-webkit-slider-thumb]:w-3.5
					[&::-webkit-slider-thumb]:h-3.5
					[&::-webkit-slider-thumb]:rounded-full
					[&::-webkit-slider-thumb]:bg-(--ui-accent)
					[&::-webkit-slider-thumb]:shadow-md
					[&::-webkit-slider-thumb]:cursor-grab
					[&::-webkit-slider-thumb]:active:cursor-grabbing
					[&::-moz-range-thumb]:w-3.5
					[&::-moz-range-thumb]:h-3.5
					[&::-moz-range-thumb]:rounded-full
					[&::-moz-range-thumb]:bg-(--ui-accent)
					[&::-moz-range-thumb]:border-none
					[&::-moz-range-thumb]:cursor-grab
					[&::-moz-range-thumb]:active:cursor-grabbing"
			/>
		</div>
	);
}

export function TrimlineEditOverlay({
	selectedSide,
	adjustments,
	onChange,
	onClose,
	className,
}: TrimlineEditOverlayProps) {
	const update = useCallback(
		(key: keyof TrimlineAdjustments, value: number) => {
			onChange({ ...adjustments, [key]: value });
		},
		[adjustments, onChange]
	);

	const resetAll = useCallback(() => {
		onChange({ ...DEFAULT_TRIMLINE_ADJUSTMENTS });
	}, [onChange]);

	const hasAnyAdjustment = Object.values(adjustments).some((v) => v !== 0);

	return (
		<div
			className={cn(
				'ui-overlay-card w-[320px] rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur',
				className
			)}
		>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<div className="text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">
						Trimline aanpassen
					</div>
					<div className="mt-0.5 text-xs text-(--ui-muted)">
						{selectedSide === 'left' ? 'Links' : 'Rechts'} — verschuif de rand per zone
					</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg border border-(--ui-border) px-2.5 py-1 text-xs text-(--ui-muted) transition hover:bg-[rgba(255,255,255,0.08)] hover:text-(--ui-text)"
				>
					Sluiten
				</button>
			</div>

			{/* Global offset */}
			<div className="mt-4 rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.03)] p-3">
				<SliderRow
					label="Algeheel"
					description="Overal"
					value={adjustments.global}
					onChange={(v) => update('global', v)}
					min={-5}
					max={8}
					step={0.5}
				/>
			</div>

			{/* Regional offsets */}
			<div className="mt-3 space-y-3 rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.03)] p-3">
				<div className="text-[10px] font-semibold uppercase tracking-wide text-(--ui-muted)">
					Per zone
				</div>
				{REGIONS.map(({ key, label, description }) => (
					<SliderRow
						key={key}
						label={label}
						description={description}
						value={adjustments[key]}
						onChange={(v) => update(key, v)}
						min={-5}
						max={8}
						step={0.5}
					/>
				))}
			</div>

			{/* Reset button */}
			{hasAnyAdjustment && (
				<button
					type="button"
					onClick={resetAll}
					className="mt-3 flex w-full items-center justify-center rounded-lg border border-(--ui-border) bg-[rgba(255,255,255,0.04)] px-3 py-2 text-xs text-(--ui-muted) transition hover:bg-[rgba(255,255,255,0.08)] hover:text-(--ui-text)"
				>
					Reset alles naar standaard
				</button>
			)}
		</div>
	);
}

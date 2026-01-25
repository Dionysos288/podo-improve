'use client';

import { Slider as BaseSlider } from '@base-ui/react/slider';
import { cn } from '@/src/shared/lib/cn';

/**
 * General purpose Slider component built on Base UI
 * Can be used throughout the application for range selections
 */

export interface SliderProps {
	/** Current value */
	value: number;
	/** Callback when value changes */
	onChange: (value: number) => void;
	/** Minimum value */
	min?: number;
	/** Maximum value */
	max?: number;
	/** Step increment */
	step?: number;
	/** Optional label */
	label?: string;
	/** Show current value */
	showValue?: boolean;
	/** Unit suffix for value display */
	unit?: string;
	/** Additional class names for the container */
	className?: string;
	/** Whether the slider is disabled */
	disabled?: boolean;
	/** Size variant */
	size?: 'sm' | 'md' | 'lg';
}

const sizeConfig = {
	sm: {
		track: 'h-1',
		thumb: 'h-3 w-3',
	},
	md: {
		track: 'h-1.5',
		thumb: 'h-4 w-4',
	},
	lg: {
		track: 'h-2',
		thumb: 'h-5 w-5',
	},
};

export function Slider({
	value,
	onChange,
	min = 0,
	max = 100,
	step = 1,
	label,
	showValue = true,
	unit,
	className,
	disabled = false,
	size = 'md',
}: SliderProps) {
	const config = sizeConfig[size];

	return (
		<div className={cn('space-y-1', className)}>
			{(label || showValue) && (
				<div className="flex items-center justify-between">
					{label && (
						<span className="text-sm text-ui-text">{label}</span>
					)}
					{showValue && (
						<span className="text-sm font-medium text-ui-text">
							{value}
							{unit && <span className="text-ui-muted ml-0.5">{unit}</span>}
						</span>
					)}
				</div>
			)}
			<BaseSlider.Root
				value={value}
				onValueChange={(val) => onChange(val as number)}
				min={min}
				max={max}
				step={step}
				disabled={disabled}
				className={cn(
					'relative w-full',
					disabled && 'opacity-50 cursor-not-allowed'
				)}
			>
				<BaseSlider.Control className="flex h-5 w-full items-center">
					<BaseSlider.Track
						className={cn(
							'relative w-full grow rounded-full bg-ui-border',
							config.track
						)}
					>
						<BaseSlider.Indicator className="absolute h-full rounded-full bg-ui-accent" />
						<BaseSlider.Thumb
							className={cn(
								'block cursor-pointer rounded-full border-2 border-ui-accent',
								'bg-ui-panel shadow-md transition-all',
								'hover:bg-ui-accent hover:border-ui-accent-hover',
								'focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent focus-visible:ring-offset-2',
								'disabled:cursor-not-allowed',
								config.thumb
							)}
						/>
					</BaseSlider.Track>
				</BaseSlider.Control>
			</BaseSlider.Root>
			{/* Min/Max labels */}
			<div className="flex justify-between text-xs text-ui-muted">
				<span>{min}{unit}</span>
				<span>{max}{unit}</span>
			</div>
		</div>
	);
}

// Range Slider for selecting a range
export interface RangeSliderProps {
	/** Current range values [min, max] */
	value: [number, number];
	/** Callback when values change */
	onChange: (value: [number, number]) => void;
	/** Minimum value */
	min?: number;
	/** Maximum value */
	max?: number;
	/** Step increment */
	step?: number;
	/** Optional label */
	label?: string;
	/** Unit suffix for value display */
	unit?: string;
	/** Additional class names for the container */
	className?: string;
	/** Whether the slider is disabled */
	disabled?: boolean;
}

export function RangeSlider({
	value,
	onChange,
	min = 0,
	max = 100,
	step = 1,
	label,
	unit,
	className,
	disabled = false,
}: RangeSliderProps) {
	return (
		<div className={cn('space-y-1', className)}>
			{label && (
				<div className="flex items-center justify-between">
					<span className="text-sm text-ui-text">{label}</span>
					<span className="text-sm font-medium text-ui-text">
						{value[0]} - {value[1]}
						{unit && <span className="text-ui-muted ml-0.5">{unit}</span>}
					</span>
				</div>
			)}
			<BaseSlider.Root
				value={value}
				onValueChange={(val) => onChange(val as [number, number])}
				min={min}
				max={max}
				step={step}
				disabled={disabled}
				className={cn(
					'relative w-full',
					disabled && 'opacity-50 cursor-not-allowed'
				)}
			>
				<BaseSlider.Control className="flex h-5 w-full items-center">
					<BaseSlider.Track className="relative h-1.5 w-full grow rounded-full bg-ui-border">
						<BaseSlider.Indicator className="absolute h-full rounded-full bg-ui-accent" />
						<BaseSlider.Thumb className="block h-4 w-4 cursor-pointer rounded-full border-2 border-ui-accent bg-ui-panel shadow-md transition-all hover:bg-ui-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent" />
						<BaseSlider.Thumb className="block h-4 w-4 cursor-pointer rounded-full border-2 border-ui-accent bg-ui-panel shadow-md transition-all hover:bg-ui-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent" />
					</BaseSlider.Track>
				</BaseSlider.Control>
			</BaseSlider.Root>
		</div>
	);
}

// Export the underlying Base UI Slider for custom implementations
export { BaseSlider as SliderPrimitive };

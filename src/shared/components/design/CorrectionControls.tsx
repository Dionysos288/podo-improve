'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { Switch } from '@base-ui/react/switch';
import { Slider } from '@base-ui/react/slider';
import { NumberField } from '@base-ui/react/number-field';
import { Select } from '@base-ui/react/select';
import { ChevronRight, Heart, ChevronDown, Check, Minus, Plus } from 'lucide-react';
import { cn } from '@/src/shared/lib/cn';

// Types for correction options
export interface CorrectionValue {
	leftValue: number;
	rightValue: number;
	enabled?: boolean;
}

export interface SelectOption {
	value: string;
	label: string;
}

export interface CorrectionConfig {
	id: string;
	label: string;
	type: 'number' | 'slider' | 'switch' | 'select' | 'dual-number' | 'dual-select';
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	options?: SelectOption[];
	defaultValue?: number | string | boolean;
	defaultLeftValue?: number | string;
	defaultRightValue?: number | string;
}

export function useBufferedNumber(
	value: number,
	onChange: (value: number) => void,
	commitDelayMs = 0,
	options?: { flushOnPointerUp?: boolean },
) {
	const flushOnPointerUp =
		options?.flushOnPointerUp ?? (commitDelayMs > 0);
	const [draftValue, setDraftValue] = useState(value);
	const frameRef = useRef<number | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingValueRef = useRef(value);
	const onChangeRef = useRef(onChange);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		setDraftValue(value);
		pendingValueRef.current = value;
	}, [value]);

	useEffect(() => {
		return () => {
			if (frameRef.current != null) {
				cancelAnimationFrame(frameRef.current);
			}
			if (timeoutRef.current != null) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const flush = useCallback(() => {
		let didCommit = false;
		if (timeoutRef.current != null) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
			onChangeRef.current(pendingValueRef.current);
			didCommit = true;
		}
		if (frameRef.current != null) {
			cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
			if (!didCommit) {
				onChangeRef.current(pendingValueRef.current);
			}
		}
	}, []);

	useEffect(() => {
		if (!flushOnPointerUp) return;
		const onUp = () => {
			flush();
		};
		window.addEventListener('pointerup', onUp, true);
		return () => window.removeEventListener('pointerup', onUp, true);
	}, [flushOnPointerUp, flush]);

	const updateValue = useCallback((nextValue: number) => {
		pendingValueRef.current = nextValue;
		setDraftValue(nextValue);
		if (timeoutRef.current != null) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
		if (commitDelayMs > 0) {
			timeoutRef.current = setTimeout(() => {
				timeoutRef.current = null;
				onChangeRef.current(pendingValueRef.current);
			}, commitDelayMs);
			return;
		}
		if (frameRef.current != null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			onChangeRef.current(pendingValueRef.current);
		});
	}, [commitDelayMs]);

	return { draftValue, updateValue, flush };
}

// Styled wrapper for collapsible sections
interface CollapsibleSectionProps {
	title: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
	onFavorite?: () => void;
	isFavorite?: boolean;
}

export function CollapsibleSection({
	title,
	defaultOpen = false,
	children,
	onFavorite,
	isFavorite = false,
}: CollapsibleSectionProps) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<Collapsible.Root open={open} onOpenChange={setOpen}>
			<div className="rounded-lg border border-ui-border bg-background/5">
				<Collapsible.Trigger className="flex w-full items-center justify-between px-3 py-2 text-left">
					<div className="flex items-center gap-2 text-ui-text">
						<ChevronRight
							size={14}
							strokeWidth={2.5}
							className={cn(
								'text-ui-accent transition-transform shrink-0',
								open && 'rotate-90'
							)}
						/>
						<span className="font-semibold text-sm">{title}</span>
					</div>
					{onFavorite && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onFavorite();
							}}
							className={cn(
								'text-ui-muted transition hover:text-ui-accent',
								isFavorite && 'text-red-400'
							)}
						>
							<Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
						</button>
					)}
				</Collapsible.Trigger>
				<Collapsible.Panel className="px-3 pb-3">
					<div className="space-y-3 pt-2">{children}</div>
				</Collapsible.Panel>
			</div>
		</Collapsible.Root>
	);
}

// Styled Number Field with mm unit
interface StyledNumberFieldProps {
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	label?: string;
	className?: string;
	commitDelayMs?: number;
	/** When true (default: same as commitDelayMs &gt; 0), commits pending value on global pointerup */
	flushOnPointerUp?: boolean;
}

export function StyledNumberField({
	value,
	onChange,
	min = -10,
	max = 10,
	step = 0.5,
	unit = 'mm',
	label,
	className,
	commitDelayMs = 0,
	flushOnPointerUp,
}: StyledNumberFieldProps) {
	const flushPU = flushOnPointerUp ?? commitDelayMs > 0;
	const { draftValue, updateValue } = useBufferedNumber(value, onChange, commitDelayMs, {
		flushOnPointerUp: flushPU,
	});

	return (
		<NumberField.Root
			value={draftValue}
			onValueChange={(val) => updateValue(val ?? 0)}
			min={min}
			max={max}
			step={step}
			className={cn('flex items-center gap-2', className)}
		>
			{label && (
				<NumberField.ScrubArea className="cursor-ew-resize select-none text-sm text-ui-muted">
					{label}
				</NumberField.ScrubArea>
			)}
			<NumberField.Group className="flex items-center rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)]">
				<NumberField.Decrement className="flex items-center justify-center px-2.5 py-1.5 text-ui-muted hover:text-ui-text transition">
					<Minus size={12} strokeWidth={2.5} />
				</NumberField.Decrement>
				<NumberField.Input className="w-14 bg-transparent text-center text-sm text-ui-text outline-none px-1" />
				<NumberField.Increment className="flex items-center justify-center px-2.5 py-1.5 text-ui-muted hover:text-ui-text transition">
					<Plus size={12} strokeWidth={2.5} />
				</NumberField.Increment>
			</NumberField.Group>
			{unit && <span className="text-xs text-ui-muted">{unit}</span>}
		</NumberField.Root>
	);
}

// Styled Slider
interface StyledSliderProps {
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	label?: string;
	className?: string;
}

export function StyledSlider({
	value,
	onChange,
	min = 0,
	max = 100,
	step = 1,
	label,
	className,
}: StyledSliderProps) {
	const { draftValue, updateValue } = useBufferedNumber(value, onChange);

	return (
		<div className={cn('space-y-1', className)}>
			{label && (
				<div className="flex justify-between text-xs text-ui-muted">
					<span>{label}</span>
					<span>{draftValue}</span>
				</div>
			)}
			<Slider.Root
				value={draftValue}
				onValueChange={(val) => updateValue(val)}
				min={min}
				max={max}
				step={step}
				className="relative flex h-5 w-full touch-none select-none items-center"
			>
				<Slider.Control className="flex h-5 w-full items-center">
					<Slider.Track className="relative h-1.5 w-full grow rounded-full bg-[rgba(255,255,255,0.1)]">
						<Slider.Indicator className="absolute h-full rounded-full bg-ui-accent" />
						<Slider.Thumb className="block h-4 w-4 cursor-pointer rounded-full border-2 border-ui-accent bg-ui-panel shadow-md transition-colors hover:bg-ui-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent" />
					</Slider.Track>
				</Slider.Control>
			</Slider.Root>
		</div>
	);
}

// Styled Switch
interface StyledSwitchProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label?: string;
	className?: string;
}

export function StyledSwitch({
	checked,
	onChange,
	label,
	className,
}: StyledSwitchProps) {
	return (
		<div className={cn('flex items-center gap-3', className)}>
			{label && <span className="text-sm text-ui-text">{label}</span>}
			<Switch.Root
				checked={checked}
				onCheckedChange={onChange}
				className={cn(
					'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors',
					checked ? 'bg-ui-accent' : 'bg-[rgba(255,255,255,0.2)]'
				)}
			>
				<Switch.Thumb
					className={cn(
						'block h-5 w-5 rounded-full bg-white shadow-md transition-transform',
						checked ? 'translate-x-5' : 'translate-x-0'
					)}
				/>
			</Switch.Root>
		</div>
	);
}

// Styled Select
interface StyledSelectProps {
	value: string;
	onChange: (value: string) => void;
	options: SelectOption[];
	label?: string;
	placeholder?: string;
	className?: string;
}

export function StyledSelect({
	value,
	onChange,
	options,
	label,
	placeholder = 'Selecteer...',
	className,
}: StyledSelectProps) {
	return (
		<div className={cn('space-y-1', className)}>
			{label && <span className="text-xs text-ui-muted">{label}</span>}
			<Select.Root 
				value={value} 
				onValueChange={(val) => {
					if (val !== null) onChange(val);
				}}
			>
				<Select.Trigger className="flex w-full items-center justify-between rounded-md border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm text-ui-text hover:bg-[rgba(255,255,255,0.08)] transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50">
					<Select.Value placeholder={placeholder} />
					<Select.Icon className="ml-2 text-ui-muted/70 shrink-0">
						<ChevronDown size={14} strokeWidth={2} />
					</Select.Icon>
				</Select.Trigger>
				<Select.Portal>
					<Select.Positioner className="z-[100]" sideOffset={4} alignItemWithTrigger={false}>
						<Select.Popup className="max-h-60 overflow-auto rounded-lg border border-ui-border bg-ui-panel py-1 shadow-xl shadow-black/30 animate-in fade-in-0 zoom-in-95 duration-100">
							{options.map((opt) => (
								<Select.Item
									key={opt.value}
									value={opt.value}
									className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ui-text outline-none transition-colors hover:bg-[rgba(255,255,255,0.06)] data-[highlighted]:bg-[rgba(255,255,255,0.06)]"
								>
									<Select.ItemIndicator className="w-4 shrink-0 text-ui-accent">
										<Check size={14} strokeWidth={2.5} />
									</Select.ItemIndicator>
									<Select.ItemText>{opt.label}</Select.ItemText>
								</Select.Item>
							))}
						</Select.Popup>
					</Select.Positioner>
				</Select.Portal>
			</Select.Root>
		</div>
	);
}

// Dual input component for left/right foot values
interface DualNumberInputProps {
	leftValue: number;
	rightValue: number;
	onLeftChange: (value: number) => void;
	onRightChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	label?: string;
	className?: string;
	commitDelayMs?: number;
}

export function DualNumberInput({
	leftValue,
	rightValue,
	onLeftChange,
	onRightChange,
	min = -10,
	max = 10,
	step = 0.5,
	unit = 'mm',
	label,
	className,
	commitDelayMs = 0,
}: DualNumberInputProps) {
	return (
		<div className={cn('space-y-2', className)}>
			{label && <span className="text-sm text-ui-muted">{label}</span>}
			<div className="flex items-center gap-4">
				<div className="flex-1">
					<span className="text-xs text-ui-muted mb-1 block">Links</span>
					<StyledNumberField
						value={leftValue}
						onChange={onLeftChange}
						min={min}
						max={max}
						step={step}
						unit={unit}
						commitDelayMs={commitDelayMs}
					/>
				</div>
				<div className="flex-1">
					<span className="text-xs text-ui-muted mb-1 block">Rechts</span>
					<StyledNumberField
						value={rightValue}
						onChange={onRightChange}
						min={min}
						max={max}
						step={step}
						unit={unit}
						commitDelayMs={commitDelayMs}
					/>
				</div>
			</div>
		</div>
	);
}

// Dual select component for left/right foot values
interface DualSelectInputProps {
	leftValue: string;
	rightValue: string;
	onLeftChange: (value: string) => void;
	onRightChange: (value: string) => void;
	options: SelectOption[];
	label?: string;
	className?: string;
}

export function DualSelectInput({
	leftValue,
	rightValue,
	onLeftChange,
	onRightChange,
	options,
	label,
	className,
}: DualSelectInputProps) {
	return (
		<div className={cn('space-y-2', className)}>
			{label && <span className="text-sm text-ui-muted">{label}</span>}
			<div className="flex items-center gap-4">
				<div className="flex-1">
					<span className="text-xs text-ui-muted mb-1 block">Links</span>
					<StyledSelect value={leftValue} onChange={onLeftChange} options={options} />
				</div>
				<div className="flex-1">
					<span className="text-xs text-ui-muted mb-1 block">Rechts</span>
					<StyledSelect value={rightValue} onChange={onRightChange} options={options} />
				</div>
			</div>
		</div>
	);
}

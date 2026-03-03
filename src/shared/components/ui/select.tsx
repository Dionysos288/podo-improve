'use client';

import { Select as BaseSelect } from '@base-ui/react/select';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/src/shared/lib/cn';

/**
 * General purpose Select component built on Base UI
 * Can be used throughout the application for dropdown selections
 */

export interface SelectOption {
	value: string;
	label: string;
	disabled?: boolean;
}

export interface SelectProps {
	/** Current selected value */
	value: string;
	/** Callback when value changes */
	onChange: (value: string) => void;
	/** Array of options to display */
	options: SelectOption[];
	/** Placeholder text when no value selected */
	placeholder?: string;
	/** Optional label above the select */
	label?: string;
	/** Additional class names for the container */
	className?: string;
	/** Whether the select is disabled */
	disabled?: boolean;
	/** Size variant */
	size?: 'sm' | 'md' | 'lg';
	/** Visual variant */
	variant?: 'default' | 'ghost' | 'outline';
}

const sizeClasses = {
	sm: 'px-2 py-1 text-xs',
	md: 'px-3 py-2 text-sm',
	lg: 'px-4 py-2.5 text-base',
};

const variantClasses = {
	default:
		'bg-[rgba(255,255,255,0.04)] border-ui-border hover:bg-[rgba(255,255,255,0.08)]',
	ghost: 'bg-transparent border-transparent hover:bg-[rgba(255,255,255,0.06)]',
	outline:
		'bg-transparent border-ui-border hover:bg-[rgba(255,255,255,0.04)]',
};

export function Select({
	value,
	onChange,
	options,
	placeholder = 'Selecteer...',
	label,
	className,
	disabled = false,
	size = 'md',
	variant = 'default',
}: SelectProps) {
	return (
		<div className={cn('space-y-1', className)}>
			{label && (
				<span className="block text-xs uppercase tracking-wide text-ui-text/70">
					{label}
				</span>
			)}
			<BaseSelect.Root
				value={value}
				onValueChange={(val) => {
					if (val !== null) onChange(val);
				}}
				disabled={disabled}
			>
				<BaseSelect.Trigger
					className={cn(
						'flex w-full items-center justify-between rounded-lg border transition-colors cursor-pointer',
						'text-ui-text',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50',
						'disabled:cursor-not-allowed disabled:opacity-50',
						sizeClasses[size],
						variantClasses[variant],
					)}
				>
					<BaseSelect.Value placeholder={placeholder} />
					<BaseSelect.Icon className="ml-2 text-ui-muted/70 shrink-0">
						<ChevronDown size={14} strokeWidth={2} />
					</BaseSelect.Icon>
				</BaseSelect.Trigger>
				<BaseSelect.Portal>
					<BaseSelect.Positioner className="z-[100]" sideOffset={4} alignItemWithTrigger={false}>
						<BaseSelect.Popup
							className={cn(
								'max-h-60 min-w-[var(--anchor-width)] overflow-auto rounded-lg',
								'border border-ui-border bg-ui-panel py-1 shadow-xl shadow-black/30',
								'animate-in fade-in-0 zoom-in-95 duration-100',
							)}
						>
							{options.map((opt) => (
								<BaseSelect.Item
									key={opt.value}
									value={opt.value}
									disabled={opt.disabled}
									className={cn(
										'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
										'text-ui-text outline-none transition-colors',
										'hover:bg-[rgba(255,255,255,0.06)] data-[highlighted]:bg-[rgba(255,255,255,0.06)]',
										'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
									)}
								>
									<BaseSelect.ItemIndicator className="w-4 shrink-0 text-ui-accent">
										<Check size={14} strokeWidth={2.5} />
									</BaseSelect.ItemIndicator>
									<BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
								</BaseSelect.Item>
							))}
						</BaseSelect.Popup>
					</BaseSelect.Positioner>
				</BaseSelect.Portal>
			</BaseSelect.Root>
		</div>
	);
}

// ──────────────────────────────────────────────
// InlineSelect — compact select for use inside data rows
// Shows the current value right-aligned with a subtle trigger
// ──────────────────────────────────────────────

export interface InlineSelectProps {
	value: string;
	onChange: (value: string) => void;
	options: SelectOption[];
	className?: string;
	disabled?: boolean;
}

export function InlineSelect({
	value,
	onChange,
	options,
	className,
	disabled = false,
}: InlineSelectProps) {
	return (
		<BaseSelect.Root
			value={value}
			onValueChange={(val) => {
				if (val !== null) onChange(val);
			}}
			disabled={disabled}
		>
			<BaseSelect.Trigger
				className={cn(
					'inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm',
					'bg-transparent text-ui-text cursor-pointer transition-colors',
					'hover:bg-[rgba(255,255,255,0.06)]',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50',
					'disabled:cursor-not-allowed disabled:opacity-50',
					className,
				)}
			>
				<BaseSelect.Value />
				<BaseSelect.Icon className="text-ui-muted/70 shrink-0">
					<ChevronDown size={12} strokeWidth={2} />
				</BaseSelect.Icon>
			</BaseSelect.Trigger>
			<BaseSelect.Portal>
				<BaseSelect.Positioner className="z-[100]" sideOffset={4} alignItemWithTrigger={false}>
					<BaseSelect.Popup
						className={cn(
							'max-h-60 min-w-[120px] overflow-auto rounded-lg',
							'border border-ui-border bg-ui-panel py-1 shadow-xl shadow-black/30',
							'animate-in fade-in-0 zoom-in-95 duration-100',
						)}
					>
						{options.map((opt) => (
							<BaseSelect.Item
								key={opt.value}
								value={opt.value}
								disabled={opt.disabled}
								className={cn(
									'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
									'text-ui-text outline-none transition-colors',
									'hover:bg-[rgba(255,255,255,0.06)] data-[highlighted]:bg-[rgba(255,255,255,0.06)]',
									'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
								)}
							>
								<BaseSelect.ItemIndicator className="w-4 shrink-0 text-ui-accent">
									<Check size={14} strokeWidth={2.5} />
								</BaseSelect.ItemIndicator>
								<BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
							</BaseSelect.Item>
						))}
					</BaseSelect.Popup>
				</BaseSelect.Positioner>
			</BaseSelect.Portal>
		</BaseSelect.Root>
	);
}

// Export the underlying Base UI Select for custom implementations
export { BaseSelect as SelectPrimitive };

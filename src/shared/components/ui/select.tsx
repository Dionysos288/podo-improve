'use client';

import { Select as BaseSelect } from '@base-ui/react/select';
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
	md: 'px-3 py-1.5 text-sm',
	lg: 'px-4 py-2 text-base',
};

const variantClasses = {
	default: 'bg-ui-input border-ui-border hover:bg-ui-input-hover',
	ghost: 'bg-transparent border-transparent hover:bg-ui-input',
	outline: 'bg-transparent border-ui-border hover:border-ui-border-hover',
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
				<label className="block text-sm font-medium text-ui-text">
					{label}
				</label>
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
						'flex w-full items-center justify-between rounded-md border transition cursor-pointer',
						'text-ui-text focus:outline-none focus:ring-2 focus:ring-ui-accent focus:ring-offset-1',
						'disabled:cursor-not-allowed disabled:opacity-50',
						sizeClasses[size],
						variantClasses[variant]
					)}
				>
					<BaseSelect.Value placeholder={placeholder} />
					<BaseSelect.Icon className="ml-2 text-ui-muted text-xs">
						<ChevronDownIcon />
					</BaseSelect.Icon>
				</BaseSelect.Trigger>
				<BaseSelect.Portal>
					<BaseSelect.Positioner className="z-[100]">
						<BaseSelect.Popup
							className={cn(
								'max-h-60 min-w-[var(--trigger-width)] overflow-auto rounded-lg',
								'border border-ui-border bg-ui-panel py-1 shadow-xl',
								'animate-in fade-in-0 zoom-in-95'
							)}
						>
							{options.map((opt) => (
								<BaseSelect.Item
									key={opt.value}
									value={opt.value}
									disabled={opt.disabled}
									className={cn(
										'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
										'text-ui-text outline-none',
										'hover:bg-ui-input data-[highlighted]:bg-ui-input',
										'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'
									)}
								>
									<BaseSelect.ItemIndicator className="w-4 text-ui-accent">
										<CheckIcon />
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

// Simple icons
function ChevronDownIcon() {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 12 12"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M2.5 4.5L6 8L9.5 4.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 12 12"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M10 3L4.5 8.5L2 6"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

// Export the underlying Base UI Select for custom implementations
export { BaseSelect as SelectPrimitive };

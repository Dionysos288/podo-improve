import * as React from 'react';
import { cn } from '@/src/shared/utils/cn';

export const darkInputClassName =
	'rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-foreground placeholder:text-ui-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/40 disabled:cursor-not-allowed disabled:opacity-50';

const defaultInputClassName =
	'flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export interface InputProps
	extends React.InputHTMLAttributes<HTMLInputElement> {
	variant?: 'default' | 'dark';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({ className, type, variant = 'default', ...props }, ref) => {
		return (
			<input
				type={type}
				className={cn(
					'flex h-10 w-full',
					variant === 'dark' ? darkInputClassName : defaultInputClassName,
					className,
				)}
				ref={ref}
				{...props}
			/>
		);
	},
);
Input.displayName = 'Input';

export { Input };

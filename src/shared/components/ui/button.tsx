import * as React from 'react';
import { tv } from '@/src/shared/lib/tv';

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'default' | 'outline' | 'ghost' | 'destructive';
	size?: 'sm' | 'md' | 'lg';
}

const buttonStyles = tv({
	base: 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
	variants: {
		variant: {
			default:
				'bg-[color:var(--ui-accent)] text-slate-900 hover:opacity-90 focus-visible:ring-[color:var(--ui-accent)] focus-visible:ring-offset-[color:var(--ui-panel)]',
			outline:
				'border border-[color:var(--ui-border)] bg-transparent text-[color:var(--ui-text)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:ring-[color:var(--ui-border)] focus-visible:ring-offset-[color:var(--ui-panel)]',
			ghost:
				'text-[color:var(--ui-text)] hover:bg-[rgba(255,255,255,0.06)] focus-visible:ring-[color:var(--ui-border)] focus-visible:ring-offset-[color:var(--ui-panel)]',
			destructive:
				'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 focus-visible:ring-offset-[color:var(--ui-panel)]',
		},
		size: {
			sm: 'h-8 px-3 text-sm',
			md: 'h-10 px-4 py-2',
			lg: 'h-12 px-6 text-lg',
		},
	},
	defaultVariants: {
		variant: 'default',
		size: 'md',
	},
});

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant = 'default', size = 'md', ...props }, ref) => {
		const classes = buttonStyles({ variant, size, className });
		return <button className={classes} ref={ref} {...props} />;
	}
);
Button.displayName = 'Button';

export { Button };

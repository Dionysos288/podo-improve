import * as React from 'react';
import { tv } from '@/src/shared/lib/tv';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
	variant?: 'default' | 'success' | 'warning' | 'destructive';
}

const badgeStyles = tv({
	base: 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
	variants: {
		variant: {
			default:
				'bg-[rgba(255,255,255,0.08)] text-[color:var(--ui-text)] border border-[color:var(--ui-border)]',
			success: 'bg-emerald-100 text-emerald-800',
			warning: 'bg-amber-100 text-amber-800',
			destructive: 'bg-red-100 text-red-800',
		},
	},
	defaultVariants: {
		variant: 'default',
	},
});

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
	({ className, variant = 'default', ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={badgeStyles({ variant, className })}
				{...props}
			/>
		);
	}
);
Badge.displayName = 'Badge';

export { Badge };

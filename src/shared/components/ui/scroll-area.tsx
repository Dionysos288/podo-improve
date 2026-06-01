'use client';

import { ScrollArea } from '@base-ui/react/scroll-area';
import { cn } from '@/src/shared/lib/cn';

type UiScrollAreaProps = {
	children: React.ReactNode;
	className?: string;
	contentClassName?: string;
};

export function UiScrollArea({
	children,
	className,
	contentClassName,
}: UiScrollAreaProps) {
	return (
		<ScrollArea.Root
			className={cn('relative min-h-0 flex-1 [--scrollbar-gutter:0.375rem]', className)}
		>
			<ScrollArea.Viewport className="size-full max-h-full outline-none">
				<ScrollArea.Content
					className={cn('pr-[calc(var(--scrollbar-gutter)+0.5rem)]', contentClassName)}
				>
					{children}
				</ScrollArea.Content>
			</ScrollArea.Viewport>
			<ScrollArea.Scrollbar
				orientation="vertical"
				className={(state) =>
					cn(
						'absolute inset-y-0 end-0 flex w-2 touch-none select-none justify-center py-1',
						'transition-opacity duration-200 ease-out',
						state.hovering || state.scrolling ? 'opacity-100' : 'opacity-0'
					)
				}
			>
				<ScrollArea.Thumb className="w-full min-h-8 flex-1 rounded-full bg-ui-muted/35 transition-colors duration-150 hover:bg-ui-muted/55" />
			</ScrollArea.Scrollbar>
		</ScrollArea.Root>
	);
}

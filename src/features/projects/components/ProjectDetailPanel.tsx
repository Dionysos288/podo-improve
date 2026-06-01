import { cn } from '@/src/shared/lib/cn';
import { UiScrollArea } from '@/src/shared/components/ui/scroll-area';

type ProjectDetailPanelProps = {
	header: React.ReactNode;
	children: React.ReactNode;
	className?: string;
};

export function ProjectDetailPanel({
	header,
	children,
	className,
}: ProjectDetailPanelProps) {
	return (
		<div
			className={cn(
				'flex min-h-0 flex-col rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel pl-6 pt-6 pb-6 pr-1.5 lg:h-full',
				className
			)}
		>
			<div className="mb-6 shrink-0">{header}</div>
			<UiScrollArea>{children}</UiScrollArea>
		</div>
	);
}

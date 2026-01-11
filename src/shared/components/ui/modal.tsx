import { ReactNode } from 'react';
import { cn } from '@/src/shared/lib/cn';

type ModalProps = {
	title?: string;
	open: boolean;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	className?: string;
};

export function BaseModal({
	title,
	open,
	onClose,
	children,
	footer,
	className,
}: ModalProps) {
	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur">
			<div
				className={cn(
					'ui-card w-[960px] max-w-[90vw] rounded-3xl border border-(--ui-border) bg-(--ui-panel) p-6 shadow-2xl',
					className
				)}
			>
				<div className="mb-4 flex items-center justify-between">
					{title ? (
						<h2 className="text-lg font-semibold text-foreground">{title}</h2>
					) : (
						<div />
					)}
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-3 py-1 text-sm text-(--ui-muted) transition hover:bg-[rgba(255,255,255,0.06)]"
					>
						Sluiten
					</button>
				</div>
				<div className="max-h-[70vh] overflow-hidden rounded-2xl border border-(--ui-border) bg-[rgba(255,255,255,0.02)]">
					{children}
				</div>
				{footer && <div className="mt-4 flex justify-end gap-3">{footer}</div>}
			</div>
		</div>
	);
}


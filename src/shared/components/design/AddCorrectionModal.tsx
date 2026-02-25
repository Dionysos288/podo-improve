'use client';

import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { cn } from '@/src/shared/lib/cn';
import {
	CORRECTION_OPTIONS,
	type CorrectionCategory,
	type CorrectionKey,
} from './correctionsCatalog';

type Props = {
	open: boolean;
	onClose: () => void;
	activeCorrections: CorrectionKey[];
	onToggle: (key: CorrectionKey) => void;
	anchorRef?: RefObject<HTMLElement | null>;
};

const CATEGORIES: CorrectionCategory[] = [
	'Voorvoet',
	'Middenvoet',
	'Hiel',
	'Overige',
];

export function AddCorrectionModal({
	open,
	onClose,
	activeCorrections,
	onToggle,
	anchorRef,
}: Props) {
	const [category, setCategory] = useState<CorrectionCategory>('Voorvoet');
	const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
	const activeSet = useMemo(() => new Set(activeCorrections), [activeCorrections]);

	const options = useMemo(
		() => CORRECTION_OPTIONS.filter((o) => o.category === category),
		[category]
	);

	useLayoutEffect(() => {
		if (!open) {
			setPos(null);
			return;
		}
		// anchorRef is optional, but without it we cannot place the popover.
		// Consumers should always pass it.
		const anchor = anchorRef?.current ?? null;
		if (!anchor) {
			setPos(null);
			return;
		}
		const update = () => {
			const rect = anchor.getBoundingClientRect();
			const margin = 12;
			const desiredWidth = Math.max(320, Math.min(420, rect.width));
			const vw = window.innerWidth;
			let left = rect.left;
			left = Math.max(margin, Math.min(left, vw - desiredWidth - margin));
			const top = rect.bottom + 10;
			setPos({ top, left, width: desiredWidth });
		};
		update();
		window.addEventListener('resize', update);
		window.addEventListener('scroll', update, true);
		return () => {
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, true);
		};
	}, [open, anchorRef]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onClose]);

	if (!open || !pos) return null;

	return (
		<>
			{/* Backdrop: click anywhere outside closes (incl. the viewer) */}
			<div className="fixed inset-0 z-40" onMouseDown={onClose} />

			<div
				className={cn(
					'fixed z-50 rounded-2xl border border-ui-border bg-ui-panel/95 shadow-2xl backdrop-blur',
					'overflow-hidden'
				)}
				style={{ top: pos.top, left: pos.left, width: pos.width }}
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-ui-border px-4 py-3">
					<span className="text-sm font-semibold text-ui-text">Correctie toevoegen</span>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-2 py-1 text-xs text-ui-muted transition hover:bg-[rgba(255,255,255,0.06)]"
					>
						Sluiten
					</button>
				</div>

				<div className="p-4">
					<div className="mb-4 flex items-center gap-2 rounded-2xl border border-ui-border bg-[rgba(255,255,255,0.03)] p-2">
						{CATEGORIES.map((c) => (
							<button
								key={c}
								type="button"
								onClick={() => setCategory(c)}
								className={cn(
									'rounded-xl px-3 py-2 text-xs font-semibold transition',
									c === category
										? 'bg-ui-accent text-slate-900'
										: 'text-ui-text hover:bg-[rgba(255,255,255,0.06)]'
								)}
							>
								{c}
							</button>
						))}
					</div>

					<div className="grid grid-cols-1 gap-2">
						{options.map((opt) => {
							const isActive = activeSet.has(opt.key);
							return (
								<button
									key={opt.key}
									type="button"
									onClick={() => onToggle(opt.key)}
									className={cn(
										'flex items-center justify-between rounded-2xl border border-ui-border bg-[rgba(255,255,255,0.03)] px-4 py-3 text-left transition',
										'hover:bg-[rgba(255,255,255,0.06)]',
										isActive && 'opacity-50'
									)}
								>
									<div className="flex flex-col">
										<span className="text-sm font-semibold text-ui-text">
											{opt.label}
										</span>
										<span className="text-xs text-ui-muted">
											{isActive
												? 'Klik om te verwijderen'
												: 'Klik om toe te voegen'}
										</span>
									</div>
									<div
										className={cn(
											'flex h-8 w-8 items-center justify-center rounded-full border border-ui-border text-ui-text',
											isActive
												? 'bg-[rgba(255,255,255,0.06)]'
												: 'bg-ui-accent text-slate-900'
										)}
									>
										{isActive ? '−' : '+'}
									</div>
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</>
	);
}

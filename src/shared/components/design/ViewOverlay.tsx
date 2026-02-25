import { cn } from '@/src/shared/lib/cn';
import {
	RotateCcw,
	ArrowUp,
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	Eye,
	Move,
	Hand,
} from 'lucide-react';

export type OverlayTab = 'view' | 'analysis';

export type ViewSettings = {
	showLeft: boolean;
	showRight: boolean;
	transparent: boolean;
	heatmap: boolean;
	showInsoles: boolean;
	showModel: boolean;
};

interface ViewOverlayProps {
	tab: OverlayTab;
	onTabChange: (tab: OverlayTab) => void;
	viewSettings: ViewSettings;
	onToggle: (key: keyof ViewSettings) => void;
	onView?: (preset: string) => void;
	analysisHeightMm?: number | null;
	analysisSide?: 'left' | 'right' | null;
	className?: string;
}

const toggleItems: Array<{ key: keyof ViewSettings; label: string }> = [
	{ key: 'showLeft', label: 'Links' },
	{ key: 'showRight', label: 'Rechts' },
	{ key: 'transparent', label: 'Transparant' },
	{ key: 'heatmap', label: 'Hoogtemap' },
	{ key: 'showInsoles', label: 'Steunzool' },
	{ key: 'showModel', label: '3D model' },
];

export function ViewOverlay({
	tab,
	onTabChange,
	viewSettings,
	onToggle,
	onView,
	analysisHeightMm,
	analysisSide,
	className,
}: ViewOverlayProps) {
	return (
		<div
			className={cn(
				'ui-overlay-card w-72 rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur',
				className
			)}
		>
			<div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">
				<button
					type="button"
					onClick={() => onTabChange('view')}
					className={cn(
						'rounded-lg px-2 py-1 transition',
						tab === 'view'
							? 'bg-(--ui-accent) text-slate-900'
							: 'bg-[rgba(255,255,255,0.06)] text-(--ui-text)'
					)}
				>
					Weergave
				</button>
				<button
					type="button"
					onClick={() => onTabChange('analysis')}
					className={cn(
						'rounded-lg px-2 py-1 transition',
						tab === 'analysis'
							? 'bg-(--ui-accent) text-slate-900'
							: 'bg-[rgba(255,255,255,0.06)] text-(--ui-text)'
					)}
				>
					Analyse
				</button>
			</div>

			{tab === 'view' ? (
				<>
					<div className="mt-3 grid grid-cols-3 gap-2 text-xs font-semibold">
						<button
							type="button"
							onClick={() => onView?.('rotate')}
					className="flex items-center justify-center gap-1 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-2 text-(--ui-text) shadow-[0_6px_18px_rgba(0,0,0,0.2)] transition hover:bg-[rgba(255,255,255,0.12)]"
						>
							<RotateCcw size={16} />
							<span>Draaien</span>
						</button>
						<button
							type="button"
							onClick={() => onView?.('front')}
							className="flex items-center justify-center gap-1 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-2 text-(--ui-text) shadow-[0_6px_18px_rgba(0,0,0,0.2)] transition hover:bg-[rgba(255,255,255,0.12)]"
						>
							<Hand size={16} />
							<span>Voor</span>
						</button>
						<button
							type="button"
							onClick={() => onView?.('pan')}
							className="flex items-center justify-center gap-1 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-2 text-(--ui-text) shadow-[0_6px_18px_rgba(0,0,0,0.2)] transition hover:bg-[rgba(255,255,255,0.12)]"
						>
							<Move size={16} />
							<span>Pannen</span>
						</button>

						<button
							type="button"
							onClick={() => onView?.('left')}
							className="flex items-center justify-center gap-1 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-2 text-(--ui-text) shadow-[0_6px_18px_rgba(0,0,0,0.2)] transition hover:bg-[rgba(255,255,255,0.12)]"
						>
							<ArrowLeft size={16} />
							<span>Links</span>
						</button>
						<button
							type="button"
							onClick={() => onView?.('top')}
							className="flex items-center justify-center gap-1 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-2 text-(--ui-text) shadow-[0_6px_18px_rgba(0,0,0,0.2)] transition hover:bg-[rgba(255,255,255,0.12)]"
						>
							<ArrowUp size={16} />
							<span>Boven</span>
						</button>
						<button
							type="button"
							onClick={() => onView?.('right')}
							className="flex items-center justify-center gap-1 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-2 text-(--ui-text) shadow-[0_6px_18px_rgba(0,0,0,0.2)] transition hover:bg-[rgba(255,255,255,0.12)]"
						>
							<ArrowRight size={16} />
							<span>Rechts</span>
						</button>

						<button
							type="button"
							onClick={() => onView?.('back')}
							className="flex items-center justify-center gap-1 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-2 text-(--ui-text) shadow-[0_6px_18px_rgba(0,0,0,0.2)] transition hover:bg-[rgba(255,255,255,0.12)]"
						>
							<ArrowDown size={16} />
							<span>Achter</span>
						</button>
						<button
							type="button"
							onClick={() => onView?.('bottom')}
							className="flex items-center justify-center gap-1 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-2 text-(--ui-text) shadow-[0_6px_18px_rgba(0,0,0,0.2)] transition hover:bg-[rgba(255,255,255,0.12)]"
						>
							<ArrowDown size={16} />
							<span>Onder</span>
						</button>
						<button
							type="button"
							onClick={() => onView?.('iso')}
							className="flex items-center justify-center gap-1 rounded-lg bg-[rgba(255,255,255,0.06)] px-3 py-2 text-(--ui-text) shadow-[0_6px_18px_rgba(0,0,0,0.2)] transition hover:bg-[rgba(255,255,255,0.12)]"
						>
							<Eye size={16} />
							<span>Oogpunt</span>
						</button>
					</div>

					<div className="mt-3 space-y-2 text-xs text-(--ui-text)">
						<div className="grid grid-cols-2 gap-2">
							{toggleItems.slice(0, 2).map(({ key, label }) => {
								const enabled = viewSettings[key];
								return (
									<button
										key={key}
										type="button"
										onClick={() => onToggle(key)}
										className={cn(
											'flex w-full items-center justify-between rounded-lg border px-3 py-2 transition',
											enabled
												? 'border-(--ui-accent) bg-[rgba(86,242,214,0.14)] text-(--ui-text)'
												: 'border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-muted) hover:text-(--ui-text)'
										)}
									>
										<span>{label}</span>
										<span
											className={cn(
												'flex h-5 w-10 items-center rounded-full px-1 text-[10px] font-bold uppercase tracking-wide transition',
												enabled
													? 'justify-end bg-(--ui-accent) text-slate-900'
													: 'justify-start bg-[rgba(255,255,255,0.12)] text-(--ui-muted)'
											)}
										>
											<span className="h-3 w-3 rounded-full bg-white" />
										</span>
									</button>
								);
							})}
						</div>
						<div className="grid grid-cols-2 gap-2">
							{toggleItems.slice(2, 4).map(({ key, label }) => {
								const enabled = viewSettings[key];
								return (
									<button
										key={key}
										type="button"
										onClick={() => onToggle(key)}
										className={cn(
											'flex w-full items-center justify-between rounded-lg border px-3 py-2 transition',
											enabled
												? 'border-(--ui-accent) bg-[rgba(86,242,214,0.14)] text-(--ui-text)'
												: 'border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-muted) hover:text-(--ui-text)'
										)}
									>
										<span>{label}</span>
										<span
											className={cn(
												'flex h-5 w-10 items-center rounded-full px-1 text-[10px] font-bold uppercase tracking-wide transition',
												enabled
													? 'justify-end bg-(--ui-accent) text-slate-900'
													: 'justify-start bg-[rgba(255,255,255,0.12)] text-(--ui-muted)'
											)}
										>
											<span className="h-3 w-3 rounded-full bg-white" />
										</span>
									</button>
								);
							})}
						</div>
						<div className="grid grid-cols-2 gap-2">
							{toggleItems.slice(4, 6).map(({ key, label }) => {
								const enabled = viewSettings[key];
								return (
									<button
										key={key}
										type="button"
										onClick={() => onToggle(key)}
										className={cn(
											'flex w-full items-center justify-between rounded-lg border px-3 py-2 transition',
											enabled
												? 'border-(--ui-accent) bg-[rgba(86,242,214,0.14)] text-(--ui-text)'
												: 'border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-muted) hover:text-(--ui-text)'
										)}
									>
										<span>{label}</span>
										<span
											className={cn(
												'flex h-5 w-10 items-center rounded-full px-1 text-[10px] font-bold uppercase tracking-wide transition',
												enabled
													? 'justify-end bg-(--ui-accent) text-slate-900'
													: 'justify-start bg-[rgba(255,255,255,0.12)] text-(--ui-muted)'
											)}
										>
											<span className="h-3 w-3 rounded-full bg-white" />
										</span>
									</button>
								);
							})}
						</div>
					</div>
				</>
			) : (
				<div className="mt-3 space-y-3 text-xs text-(--ui-muted)">
					<div className="flex items-center justify-between">
						<p className="uppercase tracking-wide text-(--ui-text)/70">
							Analyse
						</p>
						{analysisSide && (
							<span className="rounded-full border border-(--ui-border) bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--ui-text)">
								{analysisSide === 'left' ? 'Links' : 'Rechts'}
							</span>
						)}
					</div>

					<div className="flex items-start justify-between gap-3 rounded-xl border border-(--ui-border) bg-[rgba(255,255,255,0.04)] px-3 py-2">
						<div className="space-y-1">
							<div className="text-(--ui-text)">Hoogte</div>
							<div className="text-sm font-semibold text-(--ui-text)">
								{typeof analysisHeightMm === 'number'
									? `${analysisHeightMm.toFixed(1)} mm`
									: '—'}
							</div>
							<div className="text-[11px] text-(--ui-muted)">
								Beweeg je muis over het model.
							</div>
						</div>
						<div className="mt-1 h-10 w-2 rounded-full bg-[rgba(255,255,255,0.12)]">
							<div
								className="w-full rounded-full bg-(--ui-accent)"
								style={{
									height:
										typeof analysisHeightMm === 'number'
											? `${Math.max(6, Math.min(40, analysisHeightMm * 3))}px`
											: '8px',
								}}
							/>
						</div>
					</div>

					<p>
						Tip: gebruik <span className="text-(--ui-text)">Achter</span> voor een
						 stabiele meetweergave.
					</p>
				</div>
			)}
		</div>
	);
}


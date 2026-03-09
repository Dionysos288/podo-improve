'use client';

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
	Footprints,
	Box,
	Layers,
	Thermometer,
	Activity,
	ChevronDown,
} from 'lucide-react';
import { useState } from 'react';

export type OverlayTab = 'view' | 'analysis';

export type ViewSettings = {
	showLeft: boolean;
	showRight: boolean;
	transparent: boolean;
	heatmap: boolean;
	deviationMap: boolean;
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

const toggleItems: Array<{
	key: keyof ViewSettings;
	label: string;
	icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
	{ key: 'showLeft', label: 'Links', icon: Footprints },
	{ key: 'showRight', label: 'Rechts', icon: Footprints },
	{ key: 'transparent', label: 'Transparant', icon: Layers },
	{ key: 'heatmap', label: 'Hoogtemap', icon: Thermometer },
	{ key: 'deviationMap', label: 'Scan artefacten', icon: Activity },
	{ key: 'showInsoles', label: 'Steunzool', icon: Footprints },
	{ key: 'showModel', label: '3D model', icon: Box },
];

/* Compact icon button for camera presets */
function CamBtn({
	icon: Icon,
	label,
	onClick,
}: {
	icon: React.ComponentType<{ size?: number; className?: string }>;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			className="flex flex-col items-center justify-center gap-0.5 rounded-lg bg-white/[0.05] p-2 text-[10px] leading-none text-(--ui-muted) transition hover:bg-white/[0.12] hover:text-(--ui-text) active:scale-95"
		>
			<Icon size={15} />
			<span>{label}</span>
		</button>
	);
}

/* Toggle switch row */
function ToggleRow({
	icon: Icon,
	label,
	enabled,
	onToggle,
}: {
	icon: React.ComponentType<{ size?: number; className?: string }>;
	label: string;
	enabled: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.05]"
		>
			<Icon size={14} className={enabled ? 'text-(--ui-accent)' : 'text-(--ui-muted)'} />
			<span
				className={cn(
					'flex-1 text-xs',
					enabled ? 'text-(--ui-text)' : 'text-(--ui-muted)'
				)}
			>
				{label}
			</span>
			{/* Switch track */}
			<span
				className={cn(
					'relative flex h-[18px] w-[32px] shrink-0 items-center rounded-full transition-colors',
					enabled ? 'bg-(--ui-accent)' : 'bg-white/[0.12]'
				)}
			>
				<span
					className={cn(
						'absolute h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
						enabled ? 'translate-x-[15px]' : 'translate-x-[2px]'
					)}
				/>
			</span>
		</button>
	);
}

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
	const [cameraOpen, setCameraOpen] = useState(true);

	return (
		<div
			className={cn(
				'w-56 select-none rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/95 text-(--ui-text) shadow-2xl backdrop-blur-xl',
				className
			)}
		>
			{/* ── Tab bar ── */}
			<div className="flex border-b border-(--ui-border)">
				{(['view', 'analysis'] as const).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => onTabChange(t)}
						className={cn(
							'flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition',
							tab === t
								? 'text-(--ui-accent)'
								: 'text-(--ui-muted) hover:text-(--ui-text)'
						)}
					>
						{t === 'view' ? 'Weergave' : 'Analyse'}
					</button>
				))}
				{/* Active tab indicator */}
			</div>

			{tab === 'view' ? (
				<div className="space-y-1 p-2.5">
					{/* ── Camera section ── */}
					<button
						type="button"
						onClick={() => setCameraOpen(!cameraOpen)}
						className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-(--ui-muted) transition hover:text-(--ui-text)"
					>
						Camera
						<ChevronDown
							size={12}
							className={cn(
								'transition-transform',
								cameraOpen ? 'rotate-0' : '-rotate-90'
							)}
						/>
					</button>

					{cameraOpen && (
						<div className="grid grid-cols-3 gap-1 pb-1">
							<CamBtn icon={RotateCcw} label="Draai" onClick={() => onView?.('rotate')} />
							<CamBtn icon={Hand} label="Voor" onClick={() => onView?.('front')} />
							<CamBtn icon={Move} label="Pan" onClick={() => onView?.('pan')} />
							<CamBtn icon={ArrowLeft} label="Links" onClick={() => onView?.('left')} />
							<CamBtn icon={ArrowUp} label="Boven" onClick={() => onView?.('top')} />
							<CamBtn icon={ArrowRight} label="Rechts" onClick={() => onView?.('right')} />
							<CamBtn icon={ArrowDown} label="Achter" onClick={() => onView?.('back')} />
							<CamBtn icon={ArrowDown} label="Onder" onClick={() => onView?.('bottom')} />
							<CamBtn icon={Eye} label="Oogpunt" onClick={() => onView?.('iso')} />
						</div>
					)}

					{/* ── Divider ── */}
					<div className="mx-1 border-t border-white/[0.06]" />

					{/* ── Toggles ── */}
					<div className="space-y-0.5 pt-0.5">
						{toggleItems.map(({ key, label, icon }) => (
							<ToggleRow
								key={key}
								icon={icon}
								label={label}
								enabled={viewSettings[key]}
								onToggle={() => onToggle(key)}
							/>
						))}
					</div>
				</div>
			) : (
				<div className="space-y-3 p-3 text-xs text-(--ui-muted)">
					<div className="flex items-center justify-between">
						<p className="text-[10px] font-semibold uppercase tracking-wider text-(--ui-muted)">
							Analyse
						</p>
						{analysisSide && (
							<span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-(--ui-text)">
								{analysisSide === 'left' ? 'Links' : 'Rechts'}
							</span>
						)}
					</div>

					<div className="rounded-xl border border-(--ui-border) bg-white/[0.03] px-3 py-2.5">
						<div className="flex items-start justify-between gap-3">
							<div className="space-y-1">
								<div className="text-[10px] uppercase tracking-wider text-(--ui-muted)">
									Hoogte
								</div>
								<div className="text-lg font-semibold tabular-nums text-(--ui-text)">
									{typeof analysisHeightMm === 'number'
										? `${analysisHeightMm.toFixed(1)} mm`
										: '—'}
								</div>
							</div>
							<div className="mt-1 h-10 w-1.5 rounded-full bg-white/[0.08]">
								<div
									className="w-full rounded-full bg-(--ui-accent)"
									style={{
										height:
											typeof analysisHeightMm === 'number'
												? `${Math.max(4, Math.min(40, analysisHeightMm * 3))}px`
												: '6px',
									}}
								/>
							</div>
						</div>
						<p className="mt-2 text-[11px] leading-snug text-(--ui-muted)">
							Beweeg je muis over het model.
						</p>
					</div>

					<p className="text-[11px] leading-snug">
						Tip: gebruik <span className="text-(--ui-text)">Achter</span> voor een
						stabiele meetweergave.
					</p>
				</div>
			)}
		</div>
	);
}


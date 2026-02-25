'use client';

import { cn } from '@/src/shared/lib/cn';

export type BoxEditTool = 'rotate' | 'scale-1d' | 'scale-2d' | 'lasso';
export type InsoleSide = 'left' | 'right';

interface BoxEditToolsOverlayProps {
	selectedSide: InsoleSide;
	activeTool: BoxEditTool;
	onToolChange: (tool: BoxEditTool) => void;
	className?: string;
}

const TOOL_LABELS: Array<{ tool: BoxEditTool; label: string }> = [
	{ tool: 'rotate', label: 'Roteren' },
	{ tool: 'scale-1d', label: 'Schalen 1 richting' },
	{ tool: 'scale-2d', label: 'Schalen 2 richtingen' },
	{ tool: 'lasso', label: 'Lasso' },
];

export function BoxEditToolsOverlay({
	selectedSide,
	activeTool,
	onToolChange,
	className,
}: BoxEditToolsOverlayProps) {
	return (
		<div
			className={cn(
				'ui-overlay-card w-[320px] rounded-2xl border border-(--ui-border) bg-(--ui-overlay)/92 p-4 text-(--ui-text) shadow-xl backdrop-blur',
				className
			)}
		>
			<div className="flex items-start justify-between">
				<div>
					<div className="text-[11px] font-semibold uppercase tracking-wide text-(--ui-muted)">
						Actie
					</div>
					<div className="mt-1 text-sm font-semibold">Box bewerken</div>
					<div className="text-xs text-(--ui-muted)">
						Geselecteerd: {selectedSide === 'left' ? 'Links' : 'Rechts'}
					</div>
				</div>
			</div>

			<div className="mt-3 space-y-2">
				{TOOL_LABELS.map(({ tool, label }) => {
					const isActive = tool === activeTool;
					return (
						<button
							key={tool}
							type="button"
							onClick={() => onToolChange(tool)}
							className={cn(
								'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition',
								isActive
									? 'border-(--ui-accent) bg-[rgba(86,242,214,0.14)] text-(--ui-text)'
									: 'border-(--ui-border) bg-[rgba(255,255,255,0.04)] text-(--ui-muted) hover:text-(--ui-text)'
							)}
						>
							<span>{label}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

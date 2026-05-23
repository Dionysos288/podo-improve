'use client';

import { cn } from '@/src/shared/lib/cn';
import type { HardnessKey } from '@/src/features/printers/types/printers';
import { PRINT_ZONES } from '@/src/features/design/print/printZones';
import { PrintHardnessPicker, type HardnessPickerOption } from '@/src/shared/components/design/PrintHardnessPicker';

type ZoneKind = 'front' | 'middle' | 'back';

function zoneLabel(zone: ZoneKind) {
	const z = PRINT_ZONES.find((p) => p.id === zone);
	return z?.labelLong ?? zone;
}

export type PrintSidebarContextMode = 'hint_split' | 'hint_whole' | 'zone' | 'whole' | 'element';

export function PrintContextPanel(props: {
	mode: PrintSidebarContextMode;
	activeZone: ZoneKind | null;
	activeHardness: HardnessKey;
	hardnessOptions: HardnessPickerOption[];
	activeProfiles: Record<HardnessKey, { infillPercent: number }>;
	onPickHardness: (h: HardnessKey) => void;
	elementSubtitle?: string;
	className?: string;
}) {
	const {
		mode,
		activeZone,
		activeHardness,
		hardnessOptions,
		activeProfiles,
		onPickHardness,
		elementSubtitle,
		className,
	} = props;

	const headline =
		mode === 'hint_split'
			? 'Zones'
			: mode === 'hint_whole'
				? 'Hardheid'
				: mode === 'whole'
					? 'Hardheid — gehele zool'
					: mode === 'element'
						? 'Print — element'
						: activeZone
							? `Hardheid — ${zoneLabel(activeZone)}`
							: 'Hardheid';

	const showPicker = mode !== 'hint_split' && mode !== 'hint_whole';

	const panelKey = `${mode}_${activeZone ?? 'x'}`;

	return (
		<div className={cn('border-t border-ui-border pt-4', className)}>
			<div
				key={panelKey}
				className="opacity-95 motion-reduce:transition-none motion-reduce:translate-x-0 motion-reduce:opacity-95 animate-in fade-in-0 slide-in-from-right-2 duration-200"
			>
				<span className="text-xs font-medium uppercase tracking-wide text-(--ui-text)/70">{headline}</span>

				{mode === 'hint_split' ? (
					<p className="mt-2 text-xs text-ui-muted leading-relaxed">
						Beweeg over en klik op de linker/rechter zool voor Voor • Midden • Achter.
					</p>
				) : null}
				{mode === 'hint_whole' ? (
					<p className="mt-2 text-xs text-ui-muted leading-relaxed">
						Klik op de zool in de 3D viewer om de gehele hardheid in te stellen.
					</p>
				) : null}
				{elementSubtitle ? <p className="mt-2 text-[11px] text-ui-muted">{elementSubtitle}</p> : null}
				{showPicker ? (
					<div className="mt-3">
						<PrintHardnessPicker
							options={hardnessOptions}
							activeKey={activeHardness}
							activeProfiles={activeProfiles}
							onPick={onPickHardness}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}

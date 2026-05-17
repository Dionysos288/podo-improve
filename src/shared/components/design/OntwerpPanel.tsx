'use client';

import { useState, useCallback } from 'react';
import {
	CollapsibleSection,
	StyledNumberField,
	StyledSwitch,
	DualNumberInput,
	DualSelectInput,
} from './CorrectionControls';
import type { CorrectionKey } from './correctionsCatalog';

// Region options for Pronatie/Supinatie
const REGION_OPTIONS = [
	{ value: 'gehele-zool', label: 'Gehele zool' },
	{ value: 'voorvoet', label: 'Voorvoet' },
	{ value: 'hiel', label: 'Hiel' },
];

// Length options for Hiel heffing
const LENGTH_OPTIONS = [
	{ value: 'lang', label: 'Lang' },
	{ value: 'kort', label: 'Kort' },
	{ value: 'midden', label: 'Midden' },
];

export interface OntwerpCorrections {
	kuipHoogte: { left: number; right: number };
	voorvoetUitvlakken: { enabled: boolean };
	hielHeffing: {
		length: { left: string; right: string };
		value: { left: number; right: number };
	};
	medialeBoogCorrectie: { left: number; right: number };
	gladstrijken: number;
	pronatie: {
		regio: { left: string; right: string };
		correctie: { left: number; right: number };
	};
	supinatie: {
		regio: { left: string; right: string };
		correctie: { left: number; right: number };
	};
	mediaalVlak: {
		hoogte: { left: string; right: string };
		waarde: { left: number; right: number };
	};
	lateraalVlak: {
		hoogte: { left: string; right: string };
		waarde: { left: number; right: number };
	};
	apexMiddenvoet: { left: number; right: number };
	apexHiel: { left: number; right: number };
	hielbeenCorrectie: {
		zijde: { left: string; right: string };
		waarde: { left: number; right: number };
	};
	hielbreedteCorrectie: { left: number; right: number };
	zoolbreedte: { left: number; right: number };
}

export const DEFAULT_ONTWERP_CORRECTIONS: OntwerpCorrections = {
	kuipHoogte: { left: 0, right: 0 },
	voorvoetUitvlakken: { enabled: false },
	hielHeffing: {
		length: { left: 'lang', right: 'lang' },
		value: { left: 0, right: 0 },
	},
	medialeBoogCorrectie: { left: 0, right: 0 },
	gladstrijken: 0,
	pronatie: {
		regio: { left: 'voorvoet', right: 'voorvoet' },
		correctie: { left: 0, right: 0 },
	},
	supinatie: {
		regio: { left: 'voorvoet', right: 'voorvoet' },
		correctie: { left: 0, right: 0 },
	},
	mediaalVlak: {
		hoogte: { left: 'midden', right: 'midden' },
		waarde: { left: 0, right: 0 },
	},
	lateraalVlak: {
		hoogte: { left: 'midden', right: 'midden' },
		waarde: { left: 0, right: 0 },
	},
	apexMiddenvoet: { left: 0, right: 0 },
	apexHiel: { left: 0, right: 0 },
	hielbeenCorrectie: {
		zijde: { left: 'mediaal', right: 'mediaal' },
		waarde: { left: 0, right: 0 },
	},
	hielbreedteCorrectie: { left: 0, right: 0 },
	zoolbreedte: { left: 0, right: 0 },
};

export function createDefaultOntwerpCorrections(): OntwerpCorrections {
	return structuredClone(DEFAULT_ONTWERP_CORRECTIONS);
}

interface OntwerpPanelProps {
	corrections?: OntwerpCorrections;
	onCorrectionsChange?: (corrections: OntwerpCorrections) => void;
	onApplyToGeometry?: (corrections: OntwerpCorrections, side: 'left' | 'right' | 'both') => void;
	activeCorrections?: CorrectionKey[];
	soleWidthValueMm?: { left: number; right: number };
	onSoleWidthChange?: (side: 'left' | 'right', value: number) => void;
	/** Whether the "tekst toevoegen" tool is active */
	tekstEnabled?: boolean;
	/** Called when the user toggles the tekst switch */
	onTekstToggle?: (enabled: boolean) => void;
	/** Opens the text engrave overlay when tekst is already enabled */
	onTekstEdit?: () => void;
}

export function OntwerpPanel({
	corrections: externalCorrections,
	onCorrectionsChange,
	onApplyToGeometry,
	activeCorrections,
	soleWidthValueMm,
	onSoleWidthChange,
	tekstEnabled = false,
	onTekstToggle,
	onTekstEdit,
}: OntwerpPanelProps) {
	const [internalCorrections, setInternalCorrections] = useState<OntwerpCorrections>(createDefaultOntwerpCorrections());
	const corrections = externalCorrections ?? internalCorrections;
	const isActive = useCallback(
		(key: CorrectionKey) => {
			if (!activeCorrections) return true;
			return activeCorrections.includes(key);
		},
		[activeCorrections]
	);

	const updateCorrections = useCallback(
		(updates: Partial<OntwerpCorrections>) => {
			const newCorrections = { ...corrections, ...updates };
			if (onCorrectionsChange) {
				onCorrectionsChange(newCorrections);
			} else {
				setInternalCorrections(newCorrections);
			}
			// Notify geometry handler
			onApplyToGeometry?.(newCorrections, 'both');
		},
		[corrections, onCorrectionsChange, onApplyToGeometry]
	);

	return (
		<div className="space-y-3">
			{/* ── Tekst toevoegen ── */}
			<div className="rounded-lg bg-[rgba(255,255,255,0.04)] px-3 py-2">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm text-ui-text">Tekst toevoegen</span>
					<div className="flex items-center gap-2">
						{tekstEnabled && onTekstEdit ? (
							<button
								type="button"
								onClick={() => onTekstEdit()}
								className="rounded-md px-2 py-1 text-[11px] font-medium text-ui-accent underline-offset-2 hover:underline"
							>
								Bewerken
							</button>
						) : null}
						<StyledSwitch
							checked={tekstEnabled}
							onChange={(checked) => onTekstToggle?.(checked)}
						/>
					</div>
				</div>
			</div>

			{/* ── 1. Kuip hoogte ── */}
			<CollapsibleSection title="Kuip hoogte" defaultOpen={false}>
					<DualNumberInput
						label="Kuip hoogte"
						leftValue={corrections.kuipHoogte.left}
						rightValue={corrections.kuipHoogte.right}
						onLeftChange={(val) =>
							updateCorrections({
								kuipHoogte: { ...corrections.kuipHoogte, left: val },
							})
						}
						onRightChange={(val) =>
							updateCorrections({
								kuipHoogte: { ...corrections.kuipHoogte, right: val },
							})
						}
						min={0}
						max={20}
						step={0.5}
						unit="mm"
					/>
			</CollapsibleSection>

			{/* ── 2. Voorvoet uitvlakken ── */}
			<CollapsibleSection title="Voorvoet uitvlakken" defaultOpen={false}>
					<div className="flex items-center justify-between">
						<span className="text-sm text-ui-text">Voorvoet uitvlakken</span>
						<StyledSwitch
							checked={corrections.voorvoetUitvlakken.enabled}
							onChange={(checked) =>
								updateCorrections({
									voorvoetUitvlakken: { enabled: checked },
								})
							}
						/>
					</div>
			</CollapsibleSection>

			{/* ── 3. Hiel heffing ── */}
			<CollapsibleSection title="Hiel heffing" defaultOpen={false}>
				<DualSelectInput
					label="Lengte"
					options={LENGTH_OPTIONS}
					leftValue={corrections.hielHeffing.length.left}
					rightValue={corrections.hielHeffing.length.right}
					onLeftChange={(val) =>
						updateCorrections({
							hielHeffing: {
								...corrections.hielHeffing,
								length: { ...corrections.hielHeffing.length, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							hielHeffing: {
								...corrections.hielHeffing,
								length: { ...corrections.hielHeffing.length, right: val },
							},
						})
					}
				/>
				<DualNumberInput
					label="Hiel heffing"
					leftValue={corrections.hielHeffing.value.left}
					rightValue={corrections.hielHeffing.value.right}
					onLeftChange={(val) =>
						updateCorrections({
							hielHeffing: {
								...corrections.hielHeffing,
								value: { ...corrections.hielHeffing.value, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							hielHeffing: {
								...corrections.hielHeffing,
								value: { ...corrections.hielHeffing.value, right: val },
							},
						})
					}
					min={0}
					max={20}
					step={0.5}
					unit="mm"
				/>
			</CollapsibleSection>

			{/* ── 4. Mediale boog correctie ── */}
			<CollapsibleSection title="Mediale boog correctie" defaultOpen={false}>
				<DualNumberInput
					label="Mediale boog correctie"
					leftValue={corrections.medialeBoogCorrectie.left}
					rightValue={corrections.medialeBoogCorrectie.right}
					onLeftChange={(val) =>
						updateCorrections({
							medialeBoogCorrectie: { ...corrections.medialeBoogCorrectie, left: val },
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							medialeBoogCorrectie: { ...corrections.medialeBoogCorrectie, right: val },
						})
					}
					min={0}
					max={15}
					step={0.5}
					unit="mm"
				/>
			</CollapsibleSection>

			{/* ── 5. Gladstrijken ── */}
			<CollapsibleSection title="Gladstrijken" defaultOpen={false}>
					<StyledNumberField
						label="Gladstrijken"
						value={corrections.gladstrijken}
						onChange={(val) => updateCorrections({ gladstrijken: val })}
						min={0}
						max={10}
						step={1}
					/>
			</CollapsibleSection>

			{/* ── 6. Pronatie ── */}
			<CollapsibleSection title="Pronatie" defaultOpen={false}>
				<DualSelectInput
					label="Regio"
					options={REGION_OPTIONS}
					leftValue={corrections.pronatie.regio.left}
					rightValue={corrections.pronatie.regio.right}
					onLeftChange={(val) =>
						updateCorrections({
							pronatie: {
								...corrections.pronatie,
								regio: { ...corrections.pronatie.regio, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							pronatie: {
								...corrections.pronatie,
								regio: { ...corrections.pronatie.regio, right: val },
							},
						})
					}
				/>
				<DualNumberInput
					label="Correctie"
					leftValue={corrections.pronatie.correctie.left}
					rightValue={corrections.pronatie.correctie.right}
					onLeftChange={(val) =>
						updateCorrections({
							pronatie: {
								...corrections.pronatie,
								correctie: { ...corrections.pronatie.correctie, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							pronatie: {
								...corrections.pronatie,
								correctie: { ...corrections.pronatie.correctie, right: val },
							},
						})
					}
					min={0}
					max={10}
					step={0.5}
					unit="°"
				/>
			</CollapsibleSection>

			{/* ── 7. Supinatie ── */}
			<CollapsibleSection title="Supinatie" defaultOpen={false}>
				<DualSelectInput
					label="Regio"
					options={REGION_OPTIONS}
					leftValue={corrections.supinatie.regio.left}
					rightValue={corrections.supinatie.regio.right}
					onLeftChange={(val) =>
						updateCorrections({
							supinatie: {
								...corrections.supinatie,
								regio: { ...corrections.supinatie.regio, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							supinatie: {
								...corrections.supinatie,
								regio: { ...corrections.supinatie.regio, right: val },
							},
						})
					}
				/>
				<DualNumberInput
					label="Correctie"
					leftValue={corrections.supinatie.correctie.left}
					rightValue={corrections.supinatie.correctie.right}
					onLeftChange={(val) =>
						updateCorrections({
							supinatie: {
								...corrections.supinatie,
								correctie: { ...corrections.supinatie.correctie, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							supinatie: {
								...corrections.supinatie,
								correctie: { ...corrections.supinatie.correctie, right: val },
							},
						})
					}
					min={0}
					max={10}
					step={0.5}
					unit="°"
				/>
			</CollapsibleSection>

			{/* ── 8. Zoolbreedte ── */}
			<CollapsibleSection title="Zoolbreedte" defaultOpen={false}>
				<div className="space-y-2">
					<span className="text-sm text-ui-muted">Totale breedte</span>
					<div className="flex items-center gap-4">
						<div className="flex-1">
							<span className="mb-1 block text-xs text-ui-muted">Links</span>
							<StyledNumberField
								value={soleWidthValueMm?.left ?? 0}
								onChange={(val) => {
									if (onSoleWidthChange) {
										onSoleWidthChange('left', val);
										return;
									}
									updateCorrections({
										zoolbreedte: { ...corrections.zoolbreedte, left: val },
									});
								}}
								min={40}
								max={160}
								step={0.5}
								commitDelayMs={120}
								unit="mm"
							/>
						</div>
						<div className="flex-1">
							<span className="mb-1 block text-xs text-ui-muted">Rechts</span>
							<StyledNumberField
								value={soleWidthValueMm?.right ?? 0}
								onChange={(val) => {
									if (onSoleWidthChange) {
										onSoleWidthChange('right', val);
										return;
									}
									updateCorrections({
										zoolbreedte: { ...corrections.zoolbreedte, right: val },
									});
								}}
								min={40}
								max={160}
								step={0.5}
								commitDelayMs={120}
								unit="mm"
							/>
						</div>
					</div>
				</div>
			</CollapsibleSection>
		</div>
	);
}

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

// Height options for Mediaal/Lateraal vlak
const FLANGE_HEIGHT_OPTIONS = [
	{ value: 'laag', label: 'Laag' },
	{ value: 'midden', label: 'Midden' },
	{ value: 'hoog', label: 'Hoog' },
];

// Side options for Hielbeencorrectie
const HEEL_CLIP_SIDE_OPTIONS = [
	{ value: 'mediaal', label: 'Mediaal' },
	{ value: 'lateraal', label: 'Lateraal' },
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

const DEFAULT_CORRECTIONS: OntwerpCorrections = {
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

interface OntwerpPanelProps {
	corrections?: OntwerpCorrections;
	onCorrectionsChange?: (corrections: OntwerpCorrections) => void;
	onApplyToGeometry?: (corrections: OntwerpCorrections, side: 'left' | 'right' | 'both') => void;
	showZones?: boolean;
	onShowZonesChange?: (show: boolean) => void;
	activeCorrections?: CorrectionKey[];
}

export function OntwerpPanel({
	corrections: externalCorrections,
	onCorrectionsChange,
	onApplyToGeometry,
	showZones = false,
	onShowZonesChange,
	activeCorrections,
}: OntwerpPanelProps) {
	const [internalCorrections, setInternalCorrections] = useState<OntwerpCorrections>(DEFAULT_CORRECTIONS);
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
			{/* Zone visualization toggle */}
			<div className="rounded-lg bg-[rgba(255,255,255,0.04)] px-3 py-2">
				<div className="flex items-center justify-between">
					<span className="text-sm text-ui-text">Zones weergeven</span>
					<StyledSwitch
						checked={showZones}
						onChange={(checked) => onShowZonesChange?.(checked)}
					/>
				</div>
				{showZones && (
					<div className="mt-2 grid grid-cols-2 gap-1 text-xs">
						<div className="flex items-center gap-1.5">
							<span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} />
							<span className="text-ui-muted">Hiel</span>
						</div>
						<div className="flex items-center gap-1.5">
							<span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#22c55e' }} />
							<span className="text-ui-muted">Middenvoet</span>
						</div>
						<div className="flex items-center gap-1.5">
							<span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#3b82f6' }} />
							<span className="text-ui-muted">Voorvoet</span>
						</div>
						<div className="flex items-center gap-1.5">
							<span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#f59e0b' }} />
							<span className="text-ui-muted">Boog</span>
						</div>
					</div>
				)}
			</div>

			{/* Kuip hoogte - Dual number input */}
			{isActive('kuipHoogte') && (
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
			)}

			{/* Voorvoet uitvlakken - Single switch */}
			{isActive('voorvoetUitvlakken') && (
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
			)}

			{/* Hiel heffing - Dual select for length + Dual number for value */}
			{isActive('hielHeffing') && (
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
			)}

			{/* Mediale boog correctie - Dual number input */}
			{isActive('medialeBoogCorrectie') && (
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
			)}

			{/* Gladstrijken - Single number input for both feet */}
			{isActive('gladstrijken') && (
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
			)}

			{/* Pronatie - Dual select for regio + Dual number for correctie */}
			{isActive('pronatie') && (
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
			)}

			{/* Supinatie - Dual select for regio + Dual number for correctie */}
			{isActive('supinatie') && (
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
			)}

			{/* Mediaal vlak - Dual select for height + Dual number for amount */}
			{isActive('mediaalVlak') && (
				<CollapsibleSection title="Mediaal vlak" defaultOpen={false}>
				<DualSelectInput
					label="Hoogte"
					options={FLANGE_HEIGHT_OPTIONS}
					leftValue={corrections.mediaalVlak.hoogte.left}
					rightValue={corrections.mediaalVlak.hoogte.right}
					onLeftChange={(val) =>
						updateCorrections({
							mediaalVlak: {
								...corrections.mediaalVlak,
								hoogte: { ...corrections.mediaalVlak.hoogte, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							mediaalVlak: {
								...corrections.mediaalVlak,
								hoogte: { ...corrections.mediaalVlak.hoogte, right: val },
							},
						})
					}
				/>
				<DualNumberInput
					label="Waarde"
					leftValue={corrections.mediaalVlak.waarde.left}
					rightValue={corrections.mediaalVlak.waarde.right}
					onLeftChange={(val) =>
						updateCorrections({
							mediaalVlak: {
								...corrections.mediaalVlak,
								waarde: { ...corrections.mediaalVlak.waarde, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							mediaalVlak: {
								...corrections.mediaalVlak,
								waarde: { ...corrections.mediaalVlak.waarde, right: val },
							},
						})
					}
					min={0}
					max={15}
					step={0.5}
					unit="mm"
				/>
				</CollapsibleSection>
			)}

			{/* Lateraal vlak - Dual select for height + Dual number for amount */}
			{isActive('lateraalVlak') && (
				<CollapsibleSection title="Lateraal vlak" defaultOpen={false}>
				<DualSelectInput
					label="Hoogte"
					options={FLANGE_HEIGHT_OPTIONS}
					leftValue={corrections.lateraalVlak.hoogte.left}
					rightValue={corrections.lateraalVlak.hoogte.right}
					onLeftChange={(val) =>
						updateCorrections({
							lateraalVlak: {
								...corrections.lateraalVlak,
								hoogte: { ...corrections.lateraalVlak.hoogte, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							lateraalVlak: {
								...corrections.lateraalVlak,
								hoogte: { ...corrections.lateraalVlak.hoogte, right: val },
							},
						})
					}
				/>
				<DualNumberInput
					label="Waarde"
					leftValue={corrections.lateraalVlak.waarde.left}
					rightValue={corrections.lateraalVlak.waarde.right}
					onLeftChange={(val) =>
						updateCorrections({
							lateraalVlak: {
								...corrections.lateraalVlak,
								waarde: { ...corrections.lateraalVlak.waarde, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							lateraalVlak: {
								...corrections.lateraalVlak,
								waarde: { ...corrections.lateraalVlak.waarde, right: val },
							},
						})
					}
					min={0}
					max={15}
					step={0.5}
					unit="mm"
				/>
				</CollapsibleSection>
			)}

			{/* Verplaats apex middenvoet - Dual number input */}
			{isActive('apexMiddenvoet') && (
				<CollapsibleSection title="Verplaats apex middenvoet" defaultOpen={false}>
				<DualNumberInput
					label="Verschuiving"
					leftValue={corrections.apexMiddenvoet.left}
					rightValue={corrections.apexMiddenvoet.right}
					onLeftChange={(val) =>
						updateCorrections({
							apexMiddenvoet: { ...corrections.apexMiddenvoet, left: val },
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							apexMiddenvoet: { ...corrections.apexMiddenvoet, right: val },
						})
					}
					min={-15}
					max={15}
					step={0.5}
					unit="mm"
				/>
				</CollapsibleSection>
			)}

			{/* Verplaats apex hiel - Dual number input */}
			{isActive('apexHiel') && (
				<CollapsibleSection title="Verplaats apex hiel" defaultOpen={false}>
				<DualNumberInput
					label="Verschuiving"
					leftValue={corrections.apexHiel.left}
					rightValue={corrections.apexHiel.right}
					onLeftChange={(val) =>
						updateCorrections({
							apexHiel: { ...corrections.apexHiel, left: val },
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							apexHiel: { ...corrections.apexHiel, right: val },
						})
					}
					min={-10}
					max={10}
					step={0.5}
					unit="mm"
				/>
				</CollapsibleSection>
			)}

			{/* Hielbeencorrectie - Dual select for side + Dual number for amount */}
			{isActive('hielbeenCorrectie') && (
				<CollapsibleSection title="Hielbeencorrectie" defaultOpen={false}>
				<DualSelectInput
					label="Zijde"
					options={HEEL_CLIP_SIDE_OPTIONS}
					leftValue={corrections.hielbeenCorrectie.zijde.left}
					rightValue={corrections.hielbeenCorrectie.zijde.right}
					onLeftChange={(val) =>
						updateCorrections({
							hielbeenCorrectie: {
								...corrections.hielbeenCorrectie,
								zijde: { ...corrections.hielbeenCorrectie.zijde, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							hielbeenCorrectie: {
								...corrections.hielbeenCorrectie,
								zijde: { ...corrections.hielbeenCorrectie.zijde, right: val },
							},
						})
					}
				/>
				<DualNumberInput
					label="Correctie"
					leftValue={corrections.hielbeenCorrectie.waarde.left}
					rightValue={corrections.hielbeenCorrectie.waarde.right}
					onLeftChange={(val) =>
						updateCorrections({
							hielbeenCorrectie: {
								...corrections.hielbeenCorrectie,
								waarde: { ...corrections.hielbeenCorrectie.waarde, left: val },
							},
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							hielbeenCorrectie: {
								...corrections.hielbeenCorrectie,
								waarde: { ...corrections.hielbeenCorrectie.waarde, right: val },
							},
						})
					}
					min={0}
					max={10}
					step={0.5}
					unit="mm"
				/>
				</CollapsibleSection>
			)}

			{/* Hielbreedte correctie - Dual number input */}
			{isActive('hielbreedteCorrectie') && (
				<CollapsibleSection title="Hielbreedte correctie" defaultOpen={false}>
				<DualNumberInput
					label="Verbreding"
					leftValue={corrections.hielbreedteCorrectie.left}
					rightValue={corrections.hielbreedteCorrectie.right}
					onLeftChange={(val) =>
						updateCorrections({
							hielbreedteCorrectie: { ...corrections.hielbreedteCorrectie, left: val },
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							hielbreedteCorrectie: { ...corrections.hielbreedteCorrectie, right: val },
						})
					}
					min={0}
					max={10}
					step={0.5}
					unit="mm"
				/>
				</CollapsibleSection>
			)}

			{/* Zoolbreedte - Dual number input */}
			{isActive('zoolbreedte') && (
				<CollapsibleSection title="Zoolbreedte" defaultOpen={false}>
				<DualNumberInput
					label="Verbreding"
					leftValue={corrections.zoolbreedte.left}
					rightValue={corrections.zoolbreedte.right}
					onLeftChange={(val) =>
						updateCorrections({
							zoolbreedte: { ...corrections.zoolbreedte, left: val },
						})
					}
					onRightChange={(val) =>
						updateCorrections({
							zoolbreedte: { ...corrections.zoolbreedte, right: val },
						})
					}
					min={0}
					max={10}
					step={0.5}
					unit="mm"
				/>
				</CollapsibleSection>
			)}
		</div>
	);
}

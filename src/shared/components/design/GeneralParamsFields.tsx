'use client';

import { DualNumberInput } from '@/src/shared/components/design/CorrectionControls';

export type GeneralParamsSnapshot = {
	shoeSize: { left: number; right: number };
	soleThicknessMm: { left: number; right: number };
	maxInsoleHeightMm: { left: number; right: number };
};

export function GeneralParamsFields(props: {
	values: GeneralParamsSnapshot;
	onCommit: (updates: Partial<GeneralParamsSnapshot>) => void;
}) {
	const { values, onCommit } = props;
	const commitDelayMs = 120;

	return (
		<div className="space-y-2 text-sm">
			<div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
				<div className="flex items-center justify-between">
					<span>Schoenmaat</span>
					<span className="text-[11px] text-ui-muted">Links / Rechts</span>
				</div>
				<div className="mt-2">
					<DualNumberInput
						commitDelayMs={commitDelayMs}
						leftValue={values.shoeSize.left}
						rightValue={values.shoeSize.right}
						min={10}
						max={60}
						step={0.5}
						unit=""
						onLeftChange={(val) => onCommit({ shoeSize: { ...values.shoeSize, left: val } })}
						onRightChange={(val) => onCommit({ shoeSize: { ...values.shoeSize, right: val } })}
					/>
				</div>
			</div>
			<div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
				<div className="flex items-center justify-between">
					<span>Zooldikte</span>
					<span className="text-[11px] text-ui-muted">Links / Rechts (mm)</span>
				</div>
				<div className="mt-2">
					<DualNumberInput
						commitDelayMs={commitDelayMs}
						leftValue={values.soleThicknessMm.left}
						rightValue={values.soleThicknessMm.right}
						min={2}
						max={10}
						step={0.5}
						unit="mm"
						onLeftChange={(val) =>
							onCommit({ soleThicknessMm: { ...values.soleThicknessMm, left: val } })
						}
						onRightChange={(val) =>
							onCommit({ soleThicknessMm: { ...values.soleThicknessMm, right: val } })
						}
					/>
				</div>
			</div>
			<div className="rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
				<div className="flex items-center justify-between">
					<span>Steunzolen hoogte</span>
					<span className="text-[11px] text-ui-muted">Links / Rechts (mm)</span>
				</div>
				<div className="mt-2">
					<DualNumberInput
						commitDelayMs={commitDelayMs}
						leftValue={values.maxInsoleHeightMm.left}
						rightValue={values.maxInsoleHeightMm.right}
						min={1}
						max={40}
						step={0.5}
						unit="mm"
						onLeftChange={(val) =>
							onCommit({ maxInsoleHeightMm: { ...values.maxInsoleHeightMm, left: val } })
						}
						onRightChange={(val) =>
							onCommit({ maxInsoleHeightMm: { ...values.maxInsoleHeightMm, right: val } })
						}
					/>
				</div>
			</div>
		</div>
	);
}

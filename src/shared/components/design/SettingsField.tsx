'use client';

import { Input } from '@/src/shared/components/ui/input';

export function numToInput(value: number): string {
	return Number.isFinite(value) ? String(value) : '';
}

export function SettingsField({
	label,
	suffix,
	value,
	step,
	onChange,
}: {
	label: string;
	suffix?: string;
	value: number;
	step?: string;
	onChange: (v: number) => void;
}) {
	return (
		<div className="space-y-1.5">
			<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
				{label}
			</label>
			<div className="flex items-center gap-2">
				<Input
					variant="dark"
					type="number"
					step={step ?? '1'}
					value={numToInput(value)}
					onChange={(e) => onChange(Number(e.target.value))}
				/>
				{suffix && <span className="text-xs text-ui-muted">{suffix}</span>}
			</div>
		</div>
	);
}

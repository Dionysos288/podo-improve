'use client';

import { useEffect, useState } from 'react';

export function MaterialParamInput({
	value,
	unit,
	disabled,
	onCommit,
}: {
	value: number | null;
	unit: string;
	disabled?: boolean;
	onCommit: (next: number | null) => void;
}) {
	const [draft, setDraft] = useState(value == null ? '' : String(value));

	useEffect(() => {
		setDraft(value == null ? '' : String(value));
	}, [value]);

	const commit = () => {
		const trimmed = draft.trim();
		const next = trimmed === '' ? null : Number(trimmed);
		if (next != null && Number.isNaN(next)) {
			setDraft(value == null ? '' : String(value));
			return;
		}
		if (next !== value) onCommit(next);
	};

	return (
		<div className="flex items-center gap-1">
			<input
				type="number"
				value={draft}
				disabled={disabled}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
				}}
				className="w-16 rounded-md border border-ui-border bg-ui-card px-2 py-1 text-right text-sm text-foreground outline-none disabled:opacity-50"
				placeholder="—"
			/>
			<span className="text-xs text-ui-muted">{unit}</span>
		</div>
	);
}

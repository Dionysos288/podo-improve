import type { StlExportKind } from '@/src/shared/core/platform/stlQuota';

export async function consumeStlExportCredit(input: {
	exportKind: StlExportKind;
	projectId: string;
	designId?: string | null;
}): Promise<void> {
	const res = await fetch('/api/usage/stl-export', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			exportKind: input.exportKind,
			projectId: input.projectId,
			...(input.designId ? { designId: input.designId } : {}),
		}),
	});

	if (!res.ok) {
		const data = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(data.error || 'Export niet toegestaan.');
	}
}

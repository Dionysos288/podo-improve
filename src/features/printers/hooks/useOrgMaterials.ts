'use client';

import { useState, useTransition } from 'react';
import {
	getFilamentDefaults,
	type FilamentType,
} from '@/src/features/printers/constants/print-options';
import {
	createMaterial,
	deleteMaterial,
	updateMaterial,
} from '@/src/features/printers/server/material-actions';
import type { PrintMaterialItem } from '@/src/features/printers/types/printers';

export type MaterialParamPatch = {
	nozzleTempC?: number | null;
	bedTempC?: number | null;
	maxSpeedMmS?: number | null;
};

export function useOrgMaterials(initial: PrintMaterialItem[]) {
	const [materials, setMaterials] = useState(initial);
	const [name, setName] = useState('');
	const [filamentType, setFilamentType] = useState<FilamentType>('FLEX');
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const add = () => {
		setError(null);
		const defaults = getFilamentDefaults(filamentType);
		startTransition(async () => {
			try {
				const created = await createMaterial({
					name,
					filamentType,
					nozzleTempC: defaults.nozzleTempC,
					bedTempC: defaults.bedTempC,
					maxSpeedMmS: defaults.maxSpeedMmS,
				});
				setMaterials((prev) => [...prev, created]);
				setName('');
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Materiaal toevoegen mislukt');
			}
		});
	};

	const remove = (id: string) => {
		setError(null);
		startTransition(async () => {
			try {
				await deleteMaterial(id);
				setMaterials((prev) => prev.filter((m) => m.id !== id));
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Materiaal verwijderen mislukt');
			}
		});
	};

	const saveParams = (id: string, patch: MaterialParamPatch) => {
		const current = materials.find((m) => m.id === id);
		if (!current) return;
		setError(null);
		startTransition(async () => {
			try {
				const updated = await updateMaterial({
					materialId: id,
					nozzleTempC: patch.nozzleTempC ?? current.nozzleTempC,
					bedTempC: patch.bedTempC ?? current.bedTempC,
					maxSpeedMmS: patch.maxSpeedMmS ?? current.maxSpeedMmS,
				});
				setMaterials((prev) => prev.map((m) => (m.id === id ? updated : m)));
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Materiaal bijwerken mislukt');
			}
		});
	};

	return {
		materials,
		name,
		setName,
		filamentType,
		setFilamentType,
		error,
		isPending,
		add,
		remove,
		saveParams,
	};
}

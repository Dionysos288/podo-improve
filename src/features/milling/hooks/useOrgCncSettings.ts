'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	defaultOrgCncPayload,
	type OrgCncSettingsPayload,
} from '@/src/features/milling/org-cnc-settings-shared';
import {
	ensureOrgCncSettings,
	getOrgCncSettings,
	saveOrgCncSettings,
} from '@/src/features/milling/server/cnc-settings-actions';
import {
	DEFAULT_TABLE_PRESETS,
	type CncToolSettings,
	type TablePreset,
} from '@/src/features/milling/types';

const QUERY_KEY = ['org', 'cnc-settings'] as const;
const LEGACY_STORAGE_KEY = 'podo.cnc.tablePresets';

interface LegacyStoredState {
	presets: TablePreset[];
	selectedId: string;
}

function readLegacyLocalStorage(): LegacyStoredState | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<LegacyStoredState>;
		if (!Array.isArray(parsed.presets) || parsed.presets.length === 0) return null;
		const presets = parsed.presets as TablePreset[];
		const selectedId = presets.some((p) => p.id === parsed.selectedId)
			? (parsed.selectedId as string)
			: presets[0].id;
		return { presets, selectedId };
	} catch {
		return null;
	}
}

function clearLegacyLocalStorage(): void {
	try {
		window.localStorage.removeItem(LEGACY_STORAGE_KEY);
	} catch {
		// ignore
	}
}

async function loadOrgCncSettings(): Promise<OrgCncSettingsPayload> {
	let data = await getOrgCncSettings();
	if (data) return data;

	const legacy = readLegacyLocalStorage();
	if (legacy) {
		data = {
			tablePresets: legacy.presets,
			selectedTablePresetId: legacy.selectedId,
			toolSettings: defaultOrgCncPayload().toolSettings,
		};
		const saved = await saveOrgCncSettings(data);
		clearLegacyLocalStorage();
		return saved;
	}

	return ensureOrgCncSettings();
}

function generateId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return `tbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useOrgCncSettings() {
	const qc = useQueryClient();

	const query = useQuery({
		queryKey: QUERY_KEY,
		queryFn: loadOrgCncSettings,
		staleTime: 30_000,
	});

	const saveMutation = useMutation({
		mutationFn: saveOrgCncSettings,
		onSuccess: (data) => {
			qc.setQueryData(QUERY_KEY, data);
		},
	});

	const persist = useCallback(
		async (next: OrgCncSettingsPayload) => {
			return saveMutation.mutateAsync(next);
		},
		[saveMutation],
	);

	const data = query.data;
	const presets = data?.tablePresets ?? DEFAULT_TABLE_PRESETS;
	const selectedId = data?.selectedTablePresetId ?? presets[0]?.id ?? '';
	const selectedPreset = presets.find((p) => p.id === selectedId) ?? presets[0];
	const toolSettings = data?.toolSettings ?? defaultOrgCncPayload().toolSettings;

	const select = useCallback(
		async (id: string) => {
			if (!data || !presets.some((p) => p.id === id)) return;
			await persist({ ...data, selectedTablePresetId: id });
		},
		[data, persist, presets],
	);

	const addPreset = useCallback(
		async (preset: Omit<TablePreset, 'id'>) => {
			if (!data) return '';
			const id = generateId();
			const next: OrgCncSettingsPayload = {
				...data,
				tablePresets: [...data.tablePresets, { ...preset, id }],
				selectedTablePresetId: id,
			};
			await persist(next);
			return id;
		},
		[data, persist],
	);

	const updatePreset = useCallback(
		async (id: string, patch: Partial<Omit<TablePreset, 'id'>>) => {
			if (!data) return;
			await persist({
				...data,
				tablePresets: data.tablePresets.map((p) =>
					p.id === id ? { ...p, ...patch, id } : p,
				),
			});
		},
		[data, persist],
	);

	const deletePreset = useCallback(
		async (id: string) => {
			if (!data || data.tablePresets.length <= 1) return;
			const next = data.tablePresets.filter((p) => p.id !== id);
			await persist({
				...data,
				tablePresets: next,
				selectedTablePresetId:
					data.selectedTablePresetId === id ? next[0].id : data.selectedTablePresetId,
			});
		},
		[data, persist],
	);

	const saveToolAndSelection = useCallback(
		async (tool: CncToolSettings, tablePresetId?: string) => {
			if (!data) return;
			const selectedTablePresetId =
				tablePresetId && data.tablePresets.some((p) => p.id === tablePresetId)
					? tablePresetId
					: data.selectedTablePresetId;
			await persist({
				...data,
				selectedTablePresetId,
				toolSettings: tool,
			});
		},
		[data, persist],
	);

	return {
		isLoading: query.isLoading,
		isSaving: saveMutation.isPending,
		error: query.error ?? saveMutation.error,
		presets,
		selectedId,
		selectedPreset,
		toolSettings,
		select,
		addPreset,
		updatePreset,
		deletePreset,
		saveToolAndSelection,
		refetch: query.refetch,
	};
}

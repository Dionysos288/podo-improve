import {
	DEFAULT_CNC_TOOL_SETTINGS,
	DEFAULT_TABLE_PRESETS,
	type CncToolSettings,
	type TablePreset,
	type TableSettings,
} from '@/src/features/milling/types';

/** Strip id/name to produce the TableSettings the milling generator consumes. */
export function presetToTableSettings(preset: TablePreset): TableSettings {
	const { id: _id, name: _name, ...settings } = preset;
	return settings;
}

export interface OrgCncSettingsPayload {
	tablePresets: TablePreset[];
	selectedTablePresetId: string;
	toolSettings: CncToolSettings;
}

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') return {};
	return value as Record<string, unknown>;
}

function num(value: unknown, fallback: number): number {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function normalizePreset(raw: unknown, index: number): TablePreset | null {
	const o = asObject(raw);
	const id = typeof o.id === 'string' && o.id ? o.id : `preset-${index}`;
	const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `Tafel ${index + 1}`;
	const fallback = DEFAULT_TABLE_PRESETS[0];
	return {
		id,
		name,
		blockWidthMm: num(o.blockWidthMm, fallback.blockWidthMm),
		blockLengthMm: num(o.blockLengthMm, fallback.blockLengthMm),
		blockDepthMm: num(o.blockDepthMm, fallback.blockDepthMm),
		blockGapMm: num(o.blockGapMm, fallback.blockGapMm),
		bedWidthMm: num(o.bedWidthMm, fallback.bedWidthMm),
		bedLengthMm: num(o.bedLengthMm, fallback.bedLengthMm),
	};
}

function toolFromLegacyCnc(cnc: Record<string, unknown>): CncToolSettings {
	return {
		...DEFAULT_CNC_TOOL_SETTINGS,
		toolDiameterMm: num(cnc.toolDiameterMm, DEFAULT_CNC_TOOL_SETTINGS.toolDiameterMm),
		toolType:
			cnc.toolType === 'flat-end' || cnc.toolType === 'bull-nose' || cnc.toolType === 'ball-nose'
				? cnc.toolType
				: DEFAULT_CNC_TOOL_SETTINGS.toolType,
		spindleSpeedRpm: num(cnc.spindleSpeedRpm, DEFAULT_CNC_TOOL_SETTINGS.spindleSpeedRpm),
		feedRateXYMmMin: num(cnc.feedRateXYMmMin, DEFAULT_CNC_TOOL_SETTINGS.feedRateXYMmMin),
		feedRateZMmMin: num(cnc.feedRateZMmMin, DEFAULT_CNC_TOOL_SETTINGS.feedRateZMmMin),
		stepoverPercent: num(cnc.stepoverPercent, DEFAULT_CNC_TOOL_SETTINGS.stepoverPercent),
		safeZMm: num(cnc.safeZMm, DEFAULT_CNC_TOOL_SETTINGS.safeZMm),
		depthOfCutMm: DEFAULT_CNC_TOOL_SETTINGS.depthOfCutMm,
	};
}

function normalizeToolSettings(raw: unknown, legacyCnc: Record<string, unknown>): CncToolSettings {
	const o = asObject(raw);
	if (Object.keys(o).length === 0) return toolFromLegacyCnc(legacyCnc);
	return {
		...DEFAULT_CNC_TOOL_SETTINGS,
		toolDiameterMm: num(o.toolDiameterMm, DEFAULT_CNC_TOOL_SETTINGS.toolDiameterMm),
		toolType:
			o.toolType === 'flat-end' || o.toolType === 'bull-nose' || o.toolType === 'ball-nose'
				? o.toolType
				: DEFAULT_CNC_TOOL_SETTINGS.toolType,
		spindleSpeedRpm: num(o.spindleSpeedRpm, DEFAULT_CNC_TOOL_SETTINGS.spindleSpeedRpm),
		feedRateXYMmMin: num(o.feedRateXYMmMin, DEFAULT_CNC_TOOL_SETTINGS.feedRateXYMmMin),
		feedRateZMmMin: num(o.feedRateZMmMin, DEFAULT_CNC_TOOL_SETTINGS.feedRateZMmMin),
		stepoverPercent: num(o.stepoverPercent, DEFAULT_CNC_TOOL_SETTINGS.stepoverPercent),
		safeZMm: num(o.safeZMm, DEFAULT_CNC_TOOL_SETTINGS.safeZMm),
		depthOfCutMm: num(o.depthOfCutMm, DEFAULT_CNC_TOOL_SETTINGS.depthOfCutMm),
	};
}

export function normalizeOrgCncPayload(cncRaw: unknown): OrgCncSettingsPayload | null {
	const cnc = asObject(cncRaw);
	const rawPresets = Array.isArray(cnc.tablePresets) ? cnc.tablePresets : [];
	const presets = rawPresets
		.map((p, i) => normalizePreset(p, i))
		.filter((p): p is TablePreset => p !== null);

	if (presets.length === 0) return null;

	const selectedTablePresetId =
		typeof cnc.selectedTablePresetId === 'string' &&
		presets.some((p) => p.id === cnc.selectedTablePresetId)
			? cnc.selectedTablePresetId
			: presets[0].id;

	return {
		tablePresets: presets,
		selectedTablePresetId,
		toolSettings: normalizeToolSettings(cnc.toolSettings, cnc),
	};
}

export function defaultOrgCncPayload(): OrgCncSettingsPayload {
	return {
		tablePresets: DEFAULT_TABLE_PRESETS.map((p) => ({ ...p })),
		selectedTablePresetId: DEFAULT_TABLE_PRESETS[0].id,
		toolSettings: { ...DEFAULT_CNC_TOOL_SETTINGS },
	};
}

export function sanitizeOrgCncPayload(payload: OrgCncSettingsPayload): OrgCncSettingsPayload {
	if (payload.tablePresets.length === 0) {
		throw new Error('Minstens één tafel is verplicht.');
	}
	const tablePresets = payload.tablePresets.map((p, i) => normalizePreset(p, i)!);
	const selectedExists = tablePresets.some((p) => p.id === payload.selectedTablePresetId);
	return {
		tablePresets,
		selectedTablePresetId: selectedExists
			? payload.selectedTablePresetId
			: tablePresets[0].id,
		toolSettings: normalizeToolSettings(payload.toolSettings, {}),
	};
}

'use server';

import { getOrgSettings, updateOrgSettings } from '@/src/features/settings/server/actions';
import type { OrgSettings } from '@/src/features/settings/types/settings';
import {
	defaultOrgCncPayload,
	normalizeOrgCncPayload,
	sanitizeOrgCncPayload,
	type OrgCncSettingsPayload,
} from '@/src/features/milling/org-cnc-settings-shared';

export type { OrgCncSettingsPayload };

export async function getOrgCncSettings(): Promise<OrgCncSettingsPayload | null> {
	const settings = await getOrgSettings();
	return normalizeOrgCncPayload(settings.cnc);
}

export async function saveOrgCncSettings(
	payload: OrgCncSettingsPayload,
): Promise<OrgCncSettingsPayload> {
	const normalized = sanitizeOrgCncPayload(payload);

	const existing = await getOrgSettings();
	const existingCnc =
		existing.cnc && typeof existing.cnc === 'object'
			? (existing.cnc as Record<string, unknown>)
			: {};

	const cncPatch: NonNullable<OrgSettings['cnc']> = {
		...existingCnc,
		tablePresets: normalized.tablePresets,
		selectedTablePresetId: normalized.selectedTablePresetId,
		toolSettings: normalized.toolSettings,
		toolDiameterMm: normalized.toolSettings.toolDiameterMm,
		toolType: normalized.toolSettings.toolType,
		spindleSpeedRpm: normalized.toolSettings.spindleSpeedRpm,
		feedRateXYMmMin: normalized.toolSettings.feedRateXYMmMin,
		feedRateZMmMin: normalized.toolSettings.feedRateZMmMin,
		stepoverPercent: normalized.toolSettings.stepoverPercent,
		safeZMm: normalized.toolSettings.safeZMm,
	};

	await updateOrgSettings({
		...existing,
		cnc: cncPatch,
	});

	return normalized;
}

export async function ensureOrgCncSettings(): Promise<OrgCncSettingsPayload> {
	const existing = await getOrgCncSettings();
	if (existing) return existing;
	return saveOrgCncSettings(defaultOrgCncPayload());
}

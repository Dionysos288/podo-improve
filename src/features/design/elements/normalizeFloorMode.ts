import type { ElementFloorMode } from './types';

/** Legacy persisted values from older saves and external imports */
export type LegacyElementFloorMode = 'vloeien' | 'niet-vloeien';

export type PersistedFloorMode = ElementFloorMode | LegacyElementFloorMode;

/**
 * Map persisted floor-mode strings to the canonical runtime union.
 * Unknown values default to `sole` so additive overlays stay visible.
 */
export function normalizeElementFloorMode(value: unknown): ElementFloorMode {
	if (value === 'sole' || value === 'scan' || value === 'free') {
		return value;
	}
	if (value === 'vloeien') return 'sole';
	if (value === 'niet-vloeien') return 'free';
	return 'sole';
}

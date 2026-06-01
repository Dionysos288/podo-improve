import { describe, expect, it } from 'vitest';
import {
	getScanOverlayMaterialProps,
	INSOLE_SCAN_DEPTH_PREPASS_RENDER_ORDER,
	SCAN_OVERLAY_RENDER_ORDER,
} from './scanOverlayRender';

describe('scan overlay render settings', () => {
	it('defaults to embedded depth-tested scan rendering', () => {
		expect(getScanOverlayMaterialProps()).toEqual({
			depthTest: true,
			depthWrite: false,
			polygonOffset: false,
			polygonOffsetFactor: 0,
			polygonOffsetUnits: 0,
		});
	});

	it('keeps the legacy overlaid scan mode available', () => {
		expect(getScanOverlayMaterialProps('overlaid')).toEqual({
			depthTest: true,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -0.5,
			polygonOffsetUnits: -0.5,
		});
	});

	it('renders scans after the insole while still respecting depth', () => {
		expect(INSOLE_SCAN_DEPTH_PREPASS_RENDER_ORDER).toBeLessThan(SCAN_OVERLAY_RENDER_ORDER);
		expect(SCAN_OVERLAY_RENDER_ORDER).toBe(2);
	});
});

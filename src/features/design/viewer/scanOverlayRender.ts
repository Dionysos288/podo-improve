export type ScanOverlayViewerMode = 'embedded' | 'overlaid';

export const INSOLE_SCAN_DEPTH_PREPASS_RENDER_ORDER = 1;
export const SCAN_OVERLAY_RENDER_ORDER = 2;

export type ScanOverlayMaterialProps = {
	depthTest: boolean;
	depthWrite: boolean;
	polygonOffset: boolean;
	polygonOffsetFactor: number;
	polygonOffsetUnits: number;
};

export function getScanOverlayMaterialProps(
	mode: ScanOverlayViewerMode = 'embedded',
): ScanOverlayMaterialProps {
	if (mode === 'overlaid') {
		return {
			depthTest: true,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -0.5,
			polygonOffsetUnits: -0.5,
		};
	}

	return {
		depthTest: true,
		depthWrite: false,
		polygonOffset: false,
		polygonOffsetFactor: 0,
		polygonOffsetUnits: 0,
	};
}

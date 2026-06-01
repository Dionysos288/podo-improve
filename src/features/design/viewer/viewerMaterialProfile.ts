export type ViewerMaterialPreset = {
	roughness: number;
	metalness: number;
	flatShading: boolean;
	clearcoat?: number;
	clearcoatRoughness?: number;
};

/**
 * Shared PBR presets for the design viewer — molded matte look, no flat shading.
 * The insole is intentionally matte (high roughness, zero metalness): a glossy
 * sheen smears the form, while a matte surface reads as pure shape under the
 * grazing key light + ambient occlusion, exposing every contour.
 */
export const VIEWER_MATERIALS = {
	insoleBase: {
		roughness: 0.55,
		metalness: 0,
		flatShading: false,
	},
	elementOverlay: {
		roughness: 0.3,
		metalness: 0.04,
		flatShading: false,
		clearcoat: 0.32,
		clearcoatRoughness: 0.2,
	},
	scanOverlay: {
		roughness: 0.55,
		metalness: 0,
		flatShading: false,
	},
} as const satisfies Record<string, ViewerMaterialPreset>;

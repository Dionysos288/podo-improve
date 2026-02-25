import { create } from 'zustand';
import type {
	DesignElement,
	DesignParameters,
	MatchTransform,
	InsoleAttributes,
	LandmarkSet,
	GridEdit,
	ZoneAdjustment,
	ThreePointLandmarks,
	DerivedLandmarks,
	CompleteLandmarkSet,
	FootGeometry,
	PlantarData,
	PrecisionInsoleConfig,
	ScanValidationResult,
} from '@/src/features/design/types/types';

interface DesignState {
	elements: DesignElement[];
	parameters: DesignParameters;
	matchTransform: MatchTransform | null;
	selectedTemplate: string | null;
	selectedBaseSTL: string | null;
	insoleAttributes: InsoleAttributes | null;
	landmarks: LandmarkSet | null;
	gridEdits: GridEdit[];
	zoneAdjustments: ZoneAdjustment[];

	// 3-Point Landmark System
	threePointLandmarks: ThreePointLandmarks | null;
	derivedLandmarks: DerivedLandmarks | null;
	completeLandmarks: CompleteLandmarkSet | null;
	footGeometry: FootGeometry | null;
	plantarData: PlantarData | null;
	insoleConfig: PrecisionInsoleConfig | null;
	scanValidation: ScanValidationResult | null;
	/** Track whether precision insole generation is in progress */
	isGeneratingInsole: boolean;

	// Actions
	addElement: (element: DesignElement) => void;
	updateElement: (id: string, updates: Partial<DesignElement>) => void;
	removeElement: (id: string) => void;
	setParameters: (parameters: DesignParameters) => void;
	setMatchTransform: (transform: MatchTransform) => void;
	setSelectedTemplate: (template: string | null) => void;
	setSelectedBaseSTL: (url: string | null) => void;
	setInsoleAttributes: (attributes: InsoleAttributes | null) => void;
	setLandmarks: (landmarks: LandmarkSet | null) => void;
	addGridEdit: (edit: GridEdit) => void;
	clearGridEdits: () => void;
	addZoneAdjustment: (adjustment: ZoneAdjustment) => void;
	clearZoneAdjustments: () => void;

	// 3-Point Landmark Actions
	setThreePointLandmarks: (landmarks: ThreePointLandmarks | null) => void;
	setDerivedLandmarks: (derived: DerivedLandmarks | null) => void;
	setCompleteLandmarks: (complete: CompleteLandmarkSet | null) => void;
	setFootGeometry: (geometry: FootGeometry | null) => void;
	setPlantarData: (data: PlantarData | null) => void;
	setInsoleConfig: (config: PrecisionInsoleConfig | null) => void;
	setScanValidation: (validation: ScanValidationResult | null) => void;
	setIsGeneratingInsole: (generating: boolean) => void;
	/** Clear all 3-point landmark data (on scan re-import or reset) */
	clearLandmarkPipeline: () => void;

	reset: () => void;
}

const initialState = {
	elements: [],
	parameters: {},
	matchTransform: null,
	selectedTemplate: null,
	selectedBaseSTL: null,
	insoleAttributes: null,
	landmarks: null,
	gridEdits: [],
	zoneAdjustments: [],
	// 3-Point Landmark System
	threePointLandmarks: null,
	derivedLandmarks: null,
	completeLandmarks: null,
	footGeometry: null,
	plantarData: null,
	insoleConfig: null,
	scanValidation: null,
	isGeneratingInsole: false,
};

export const useDesignStore = create<DesignState>((set) => ({
	...initialState,

	addElement: (element) =>
		set((state) => ({ elements: [...state.elements, element] })),

	updateElement: (id, updates) =>
		set((state) => ({
			elements: state.elements.map((el) =>
				el.id === id ? { ...el, ...updates } : el
			),
		})),

	removeElement: (id) =>
		set((state) => ({
			elements: state.elements.filter((el) => el.id !== id),
		})),

	setParameters: (parameters) => set({ parameters }),

	setMatchTransform: (transform) => set({ matchTransform: transform }),

	setSelectedTemplate: (template) => set({ selectedTemplate: template }),

	setSelectedBaseSTL: (url) => set({ selectedBaseSTL: url }),

	setInsoleAttributes: (attributes) => set({ insoleAttributes: attributes }),

	setLandmarks: (landmarks) => set({ landmarks }),

	addGridEdit: (edit) =>
		set((state) => ({ gridEdits: [...state.gridEdits, edit] })),

	clearGridEdits: () => set({ gridEdits: [] }),

	addZoneAdjustment: (adjustment) =>
		set((state) => ({
			zoneAdjustments: [...state.zoneAdjustments, adjustment],
		})),

	clearZoneAdjustments: () => set({ zoneAdjustments: [] }),

	// 3-Point Landmark Actions
	setThreePointLandmarks: (landmarks) => set({ threePointLandmarks: landmarks }),
	setDerivedLandmarks: (derived) => set({ derivedLandmarks: derived }),
	setCompleteLandmarks: (complete) => set({ completeLandmarks: complete }),
	setFootGeometry: (geometry) => set({ footGeometry: geometry }),
	setPlantarData: (data) => set({ plantarData: data }),
	setInsoleConfig: (config) => set({ insoleConfig: config }),
	setScanValidation: (validation) => set({ scanValidation: validation }),
	setIsGeneratingInsole: (generating) => set({ isGeneratingInsole: generating }),

	clearLandmarkPipeline: () =>
		set({
			threePointLandmarks: null,
			derivedLandmarks: null,
			completeLandmarks: null,
			footGeometry: null,
			plantarData: null,
			scanValidation: null,
			isGeneratingInsole: false,
		}),

	reset: () => set(initialState),
}));

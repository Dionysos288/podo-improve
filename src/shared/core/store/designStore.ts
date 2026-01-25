import { create } from 'zustand';
import type {
	DesignElement,
	DesignParameters,
	MatchTransform,
	InsoleAttributes,
	LandmarkSet,
	GridEdit,
	ZoneAdjustment,
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

	reset: () => set(initialState),
}));

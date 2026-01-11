import { create } from 'zustand';
import type {
	DesignElement,
	DesignParameters,
	MatchTransform,
} from '@/src/features/design/types/types';

interface DesignState {
	elements: DesignElement[];
	parameters: DesignParameters;
	matchTransform: MatchTransform | null;
	selectedTemplate: string | null;

	// Actions
	addElement: (element: DesignElement) => void;
	updateElement: (id: string, updates: Partial<DesignElement>) => void;
	removeElement: (id: string) => void;
	setParameters: (parameters: DesignParameters) => void;
	setMatchTransform: (transform: MatchTransform) => void;
	setSelectedTemplate: (template: string | null) => void;
	reset: () => void;
}

const initialState = {
	elements: [],
	parameters: {},
	matchTransform: null,
	selectedTemplate: null,
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

	reset: () => set(initialState),
}));

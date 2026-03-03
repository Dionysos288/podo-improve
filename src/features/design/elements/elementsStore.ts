/**
 * ──────────────────────────────────────────────
 *  Zustand store for placed orthotic elements
 * ──────────────────────────────────────────────
 */
import { create } from 'zustand';
import type { PlacedElement, ElementProfile, ElementFloorMode } from './types';
import { getElementByKey, ANCHOR_POSITIONS } from './catalog';

interface ElementsState {
	/** All placed elements (both sides) */
	placedElements: PlacedElement[];
	/** Currently selected element id */
	selectedElementId: string | null;

	// ── Actions ──
	/** Place a new element on the insole from a library key */
	addElement: (libraryKey: string, side: 'left' | 'right') => PlacedElement;
	/** Update a placed element */
	updateElement: (id: string, updates: Partial<PlacedElement>) => void;
	/** Remove a placed element */
	removeElement: (id: string) => void;
	/** Duplicate an element (mirrors side if requested) */
	duplicateElement: (id: string, mirrorSide?: boolean) => void;
	/** Select element by id (or null to deselect) */
	selectElement: (id: string | null) => void;
	/** Get elements for a specific side */
	getElementsForSide: (side: 'left' | 'right') => PlacedElement[];
	/** Clear all elements */
	clearAll: () => void;
}

let nextId = 1;
function genId() {
	return `el_${Date.now()}_${nextId++}`;
}

export const useElementsStore = create<ElementsState>((set, get) => ({
	placedElements: [],
	selectedElementId: null,

	addElement: (libraryKey, side) => {
		const item = getElementByKey(libraryKey);
		if (!item) throw new Error(`Unknown element key: ${libraryKey}`);

		const anchor = ANCHOR_POSITIONS[item.anchor] ?? { u: 0.5, v: 0.5 };

		// Mirror V position for left foot (medial/lateral swap)
		const v = side === 'left' ? anchor.v : 1 - anchor.v;

		const newElement: PlacedElement = {
			id: genId(),
			libraryKey,
			side,
			profile: item.defaultProfile,
			heightMm: item.defaultHeightMm,
			blendMm: item.defaultBlendMm,
			trimOffsetMm: 0,
			floorMode: 'sole',
			split: false,
			positionU: anchor.u,
			positionV: v,
			rotationRad: 0,
			scaleU: item.defaultScale?.[0] ?? 1,
			scaleV: item.defaultScale?.[1] ?? 1,
		};

		set((state) => ({
			placedElements: [...state.placedElements, newElement],
			selectedElementId: newElement.id,
		}));

		return newElement;
	},

	updateElement: (id, updates) =>
		set((state) => ({
			placedElements: state.placedElements.map((el) =>
				el.id === id ? { ...el, ...updates } : el
			),
		})),

	removeElement: (id) =>
		set((state) => ({
			placedElements: state.placedElements.filter((el) => el.id !== id),
			selectedElementId:
				state.selectedElementId === id ? null : state.selectedElementId,
		})),

	duplicateElement: (id, mirrorSide = false) => {
		const source = get().placedElements.find((el) => el.id === id);
		if (!source) return;

		const dup: PlacedElement = {
			...source,
			id: genId(),
			side: mirrorSide
				? source.side === 'left'
					? 'right'
					: 'left'
				: source.side,
			// Mirror V position when copying to other side
			positionV: mirrorSide ? 1 - source.positionV : source.positionV,
		};

		set((state) => ({
			placedElements: [...state.placedElements, dup],
			selectedElementId: dup.id,
		}));
	},

	selectElement: (id) => set({ selectedElementId: id }),

	getElementsForSide: (side) =>
		get().placedElements.filter((el) => el.side === side),

	clearAll: () => set({ placedElements: [], selectedElementId: null }),
}));

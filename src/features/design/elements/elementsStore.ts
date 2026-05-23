/**
 * ──────────────────────────────────────────────
 *  Zustand store for placed orthotic elements
 * ──────────────────────────────────────────────
 */
import { create } from 'zustand';
import type { HardnessKey } from '@/src/features/printers/types/printers';
import type { PlacedElement, ElementProfile, ElementFloorMode } from './types';
import { getElementByKey, ANCHOR_POSITIONS } from './catalog';
import {
	getDefaultPlacementForSide,
	mirrorPlacedElementToSide,
} from './placement';

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

		const anchor = item.defaultPosition ??
			ANCHOR_POSITIONS[item.anchor] ?? { u: 0.5, v: 0.5 };
		const defaults = getDefaultPlacementForSide(
			{
				defaultPosition: anchor,
				defaultRotationRad: item.defaultRotationRad,
			},
			side,
		);

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
			printHardness: 'normal' satisfies HardnessKey,
			positionU: defaults.positionU,
			positionV: defaults.positionV,
			rotationRad: defaults.rotationRad,
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
		set((state) => {
			let didChange = false;
			const placedElements = state.placedElements.map((el) => {
				if (el.id !== id) return el;
				for (const [key, value] of Object.entries(updates) as Array<
					[keyof PlacedElement, PlacedElement[keyof PlacedElement]]
				>) {
					if (el[key] !== value) {
						didChange = true;
						break;
					}
				}
				return didChange ? { ...el, ...updates } : el;
			});
			return didChange ? { placedElements } : state;
		}),

	removeElement: (id) =>
		set((state) => ({
			placedElements: state.placedElements.filter((el) => el.id !== id),
			selectedElementId:
				state.selectedElementId === id ? null : state.selectedElementId,
		})),

	duplicateElement: (id, mirrorSide = false) => {
		const source = get().placedElements.find((el) => el.id === id);
		if (!source) return;
		const targetSide = mirrorSide
			? source.side === 'left'
				? 'right'
				: 'left'
			: source.side;

		const dup: PlacedElement = {
			...(mirrorSide
				? mirrorPlacedElementToSide(source, targetSide)
				: structuredClone(source)),
			id: genId(),
		};

		set((state) => ({
			placedElements: [...state.placedElements, dup],
			selectedElementId: dup.id,
		}));
	},

	selectElement: (id) =>
		set((state) =>
			state.selectedElementId === id ? state : { selectedElementId: id },
		),

	getElementsForSide: (side) =>
		get().placedElements.filter((el) => el.side === side),

	clearAll: () => set({ placedElements: [], selectedElementId: null }),
}));

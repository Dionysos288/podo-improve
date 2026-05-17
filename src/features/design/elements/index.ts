export type {
	ElementTab,
	ElementProfile,
	ElementFloorMode,
	ElementShape,
	ElementAnchor,
	ElementColorGroup,
	ElementLibraryItem,
	PlacedElement,
} from './types';

export {
	default as ELEMENTS_CATALOG,
	ELEMENTEN_ITEMS,
	DIEPELEMENTEN_ITEMS,
	getElementByKey,
	getElementPreferredStlUrl,
	getElementStlLoadUrls,
	ELEMENT_COLORS,
	ANCHOR_POSITIONS,
} from './catalog';

export { useElementsStore } from './elementsStore';
export {
	getDefaultPlacementForSide,
	mirrorBoxGridOffsetsAcrossWidth,
	mirrorTrimlineHandleProfileAcrossWidth,
	mirrorPlacedElementToSide,
} from './placement';
export {
	applyElements,
	applyElementColors,
	buildElementOverlayGeometries,
} from './applyElements';
export type { ElementOverlayData } from './applyElements';
export { ElementsModal } from './ElementsModal';
export { ElementInspector } from './ElementInspector';
export { ElementActionsPanel } from './ElementActionsPanel';
export { PlacedElementsList } from './PlacedElementsList';

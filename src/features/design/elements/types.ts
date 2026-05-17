/* ──────────────────────────────────────────────
 *  Orthotic Element Types
 * ────────────────────────────────────────────── */

import type { BoxGridSavedOffsets } from '@/src/features/design/types/boxGrid';
import type { TrimlineAdjustments, TrimlineHandleProfile } from '@/src/shared/components/design/TrimlineEditOverlay';

/** Tab in the elements modal */
export type ElementTab = 'elementen' | 'diepelementen';

/** Visual / structural profile of an element */
export type ElementProfile = 'vlak' | 'bol' | 'hol' | 'vloeiend';

/** Primitive shape family used to generate outlines */
export type ElementShape =
	| 'circle'
	| 'oval'
	| 'ovalLarge'
	| 'teardrop'
	| 'crescent'
	| 'horseshoe'
	| 'wedge'
	| 'trapezoid'
	| 'forefootBand'
	| 'kidney'
	| 'custom';

/** Anatomical anchor zone for default placement */
export type ElementAnchor =
	| 'forefoot'
	| 'metatarsals'
	| 'met1'
	| 'met2-5'
	| 'met1-5'
	| 'midfoot'
	| 'arch'
	| 'heel'
	| 'heelMedial'
	| 'heelLateral'
	| 'fullLength'
	| 'center';

/** Color group for the thumbnail silhouette */
export type ElementColorGroup =
	| 'red'
	| 'blue'
	| 'green'
	| 'orange'
	| 'pink'
	| 'teal'
	| 'skin'
	| 'magenta';

/** A single item in the element library */
export interface ElementLibraryItem {
	/** Unique key for lookup */
	key: string;
	/** Display name (Dutch, matches competitor) */
	label: string;
	/** Tab: additive pad or engraved pocket */
	tab: ElementTab;
	/** Shape primitive for outline generation */
	shape: ElementShape;
	/** Default profile */
	defaultProfile: ElementProfile;
	/** Available profiles the user can switch to */
	profiles: ElementProfile[];
	/** Default height in mm (positive = additive, negative = engrave) */
	defaultHeightMm: number;
	/** Min/max allowed height in mm */
	heightRange: [number, number];
	/** Default blend/taper width in mm */
	defaultBlendMm: number;
	/** Anatomical default anchor for placement */
	anchor: ElementAnchor;
	/** Color group for the thumbnail */
	color: ElementColorGroup;
	/** SVG viewBox-relative outline polygon (normalised 0-1) */
	outline: [number, number][];
	/** Optional: default scale factors */
	defaultScale?: [number, number];
	/** Optional: preferred default placement in normalized insole UV space */
	defaultPosition?: { u: number; v: number };
	/** Optional: default rotation in radians for the right foot; mirrored for left */
	defaultRotationRad?: number;
	/** Optional: URL to a pre-built STL mesh for this element (relative to public/) */
	stlUrl?: string;
	/** Optional: alternate STL URL preferred for interactive editor rendering */
	stlInteractiveUrl?: string;
	/** Intrinsic size of the STL in mm [width, depth] for correct scaling */
	stlSizeMm?: [number, number];
	/** If true, the STL has Y↔Z axes swapped and they will be corrected on load */
	stlSwapYZ?: boolean;
}

/** How the element sits relative to the insole surface */
export type ElementFloorMode = 'sole' | 'scan' | 'free';

/** An orthotic element placed on an insole */
export interface PlacedElement {
	id: string;
	/** Library key */
	libraryKey: string;
	/** Which foot side */
	side: 'left' | 'right';
	/** Active profile */
	profile: ElementProfile;
	/** Height in mm (positive additive, negative engrave) */
	heightMm: number;
	/** Blend/taper edge width in mm */
	blendMm: number;
	/** Trimline offset in mm (inflate/deflate outline) */
	trimOffsetMm: number;
	/** How the element floors (sole surface, scan surface, or free) */
	floorMode: ElementFloorMode;
	/** Whether the element should be split at midline */
	split: boolean;
	/** 2D transform in the insole plane (normalised 0-1 coords, heel=0, toe=1) */
	positionU: number;
	positionV: number;
	rotationRad: number;
	scaleU: number;
	scaleV: number;
	/** Optional per-region trimline edits for interactive element trimline mode */
	trimlineAdjustments?: TrimlineAdjustments;
	/** Optional freeform trimline handle profile for interactive element trimline mode */
	trimlineHandleProfile?: TrimlineHandleProfile | null;
	/** Optional saved box-grid deformation for interactive element box mode */
	boxGridOffsets?: BoxGridSavedOffsets | null;
}

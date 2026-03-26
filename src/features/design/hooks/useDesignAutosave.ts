'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import { useElementsStore } from '@/src/features/design/elements';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface DesignSnapshot {
	parameters: Record<string, unknown>;
	elements: unknown[];
	landmarks: Record<string, unknown>;
	scanMetadata: Record<string, unknown>;
	matchTransform: Record<string, unknown> | null;
	clientSettings: Record<string, unknown>;
}

const AUTOSAVE_DEBOUNCE_MS = 2000;

type PersistedDesignRefs = {
	parameters: unknown;
	selectedTemplate: unknown;
	selectedBaseSTL: unknown;
	gridEdits: unknown;
	zoneAdjustments: unknown;
	threePointLandmarks: unknown;
	derivedLandmarks: unknown;
	completeLandmarks: unknown;
	landmarks: unknown;
	footGeometry: unknown;
	plantarData: unknown;
	insoleConfig: unknown;
	scanValidation: unknown;
	insoleAttributes: unknown;
	matchTransform: unknown;
};

function getPersistedDesignRefs(): PersistedDesignRefs {
	const state = useDesignStore.getState();
	return {
		parameters: state.parameters,
		selectedTemplate: state.selectedTemplate,
		selectedBaseSTL: state.selectedBaseSTL,
		gridEdits: state.gridEdits,
		zoneAdjustments: state.zoneAdjustments,
		threePointLandmarks: state.threePointLandmarks,
		derivedLandmarks: state.derivedLandmarks,
		completeLandmarks: state.completeLandmarks,
		landmarks: state.landmarks,
		footGeometry: state.footGeometry,
		plantarData: state.plantarData,
		insoleConfig: state.insoleConfig,
		scanValidation: state.scanValidation,
		insoleAttributes: state.insoleAttributes,
		matchTransform: state.matchTransform,
	};
}

function persistedDesignRefsChanged(
	previous: PersistedDesignRefs,
	next: PersistedDesignRefs,
) {
	return (
		previous.parameters !== next.parameters ||
		previous.selectedTemplate !== next.selectedTemplate ||
		previous.selectedBaseSTL !== next.selectedBaseSTL ||
		previous.gridEdits !== next.gridEdits ||
		previous.zoneAdjustments !== next.zoneAdjustments ||
		previous.threePointLandmarks !== next.threePointLandmarks ||
		previous.derivedLandmarks !== next.derivedLandmarks ||
		previous.completeLandmarks !== next.completeLandmarks ||
		previous.landmarks !== next.landmarks ||
		previous.footGeometry !== next.footGeometry ||
		previous.plantarData !== next.plantarData ||
		previous.insoleConfig !== next.insoleConfig ||
		previous.scanValidation !== next.scanValidation ||
		previous.insoleAttributes !== next.insoleAttributes ||
		previous.matchTransform !== next.matchTransform
	);
}

function migrateLoadedElement(raw: Record<string, unknown>) {
	if (raw.libraryKey !== 'sd-2-5') return raw;
	if (raw.side !== 'left' && raw.side !== 'right') return raw;

	const approx = (value: unknown, expected: number, epsilon = 0.03) =>
		typeof value === 'number' && Math.abs(value - expected) <= epsilon;

	const side = raw.side;

	// V1 legacy defaults (first iteration)
	const looksLikeV1 =
		approx(raw.positionU, 0.73) &&
		(approx(raw.positionV, 0.38) || approx(raw.positionV, 0.62)) &&
		(approx(raw.rotationRad, -0.42, 0.06) || approx(raw.rotationRad, 0.42, 0.06));

	if (looksLikeV1) {
		return {
			...raw,
			positionU: 0.82,
			positionV: side === 'right' ? 0.34 : 0.66,
			rotationRad: side === 'right' ? -0.2 : 0.2,
			scaleU: 1.0,
			scaleV: 1.0,
			heightMm: 2,
			blendMm: 5,
		};
	}

	// V2 legacy defaults (second iteration with too-small 0.74/0.8 scales)
	const looksLikeV2 =
		approx(raw.scaleU, 0.74, 0.03) &&
		approx(raw.scaleV, 0.8, 0.03);

	if (looksLikeV2) {
		return {
			...raw,
			positionV: side === 'right' ? 0.50 : 0.50,
			scaleU: 1.0,
			scaleV: 1.0,
		};
	}

	// V3 legacy defaults (third iteration with v=0.34/0.66 off-center position)
	const looksLikeV3 =
		(approx(raw.positionV, 0.34, 0.04) || approx(raw.positionV, 0.66, 0.04)) &&
		approx(raw.positionU, 0.82, 0.04);

	if (looksLikeV3) {
		return {
			...raw,
			positionV: side === 'right' ? 0.50 : 0.50,
		};
	}

	return raw;
}

/**
 * A getter function that DesignPageClient provides to supply all local
 * useState values (corrections, printer settings, hardness, etc.) for saving.
 */
export type ClientSettingsGetter = () => Record<string, unknown>;

/**
 * Hook that manages autosaving the design & elements store state to the backend.
 *
 * - Creates a design record on first meaningful change if none exists.
 * - Debounces saves to avoid excessive API calls (2s debounce).
 * - Returns current designId and save status for UI indicators.
 */
export function useDesignAutosave(
	projectId: string,
	initialDesignId?: string | null,
	clientSettingsGetterRef?: React.RefObject<ClientSettingsGetter | null>
) {
	const [designId, setDesignId] = useState<string | null>(initialDesignId ?? null);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSavedSnapshotRef = useRef<string>('');
	const isSavingRef = useRef(false);
	const designIdRef = useRef(designId);
	const isCreatingRef = useRef(false);
	const persistedDesignRefsRef = useRef<PersistedDesignRefs>(getPersistedDesignRefs());
	const placedElementsRef = useRef(useElementsStore.getState().placedElements);

	// Keep ref in sync
	useEffect(() => {
		designIdRef.current = designId;
	}, [designId]);

	/**
	 * Build a snapshot of the current design state from both stores + client settings.
	 */
	const buildSnapshot = useCallback((): DesignSnapshot => {
		const designState = useDesignStore.getState();
		const elementsState = useElementsStore.getState();
		const clientSettings = clientSettingsGetterRef?.current?.() ?? {};

		return {
			parameters: {
				...designState.parameters,
				selectedTemplate: designState.selectedTemplate,
				selectedBaseSTL: designState.selectedBaseSTL,
				gridEdits: designState.gridEdits,
				zoneAdjustments: designState.zoneAdjustments,
			},
			elements: elementsState.placedElements.map((el) => ({
				...el,
			})),
			landmarks: {
				threePointLandmarks: designState.threePointLandmarks,
				derivedLandmarks: designState.derivedLandmarks,
				completeLandmarks: designState.completeLandmarks,
				landmarks: designState.landmarks,
			},
			scanMetadata: {
				footGeometry: designState.footGeometry,
				plantarData: designState.plantarData,
				insoleConfig: designState.insoleConfig,
				scanValidation: designState.scanValidation,
				insoleAttributes: designState.insoleAttributes,
			},
			matchTransform: designState.matchTransform,
			clientSettings,
		};
	}, [clientSettingsGetterRef]);

	/**
	 * Create a new design record on the backend.
	 */
	const createDesignRecord = useCallback(
		async (snapshot: DesignSnapshot): Promise<string | null> => {
			if (isCreatingRef.current) return null;
			isCreatingRef.current = true;
			try {
				const response = await fetch(`/api/projects/${projectId}/designs`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(snapshot),
				});
				if (!response.ok) {
					throw new Error('Failed to create design');
				}
				const design = await response.json();
				return design.id;
			} catch (err) {
				console.error('[Autosave] Failed to create design:', err);
				return null;
			} finally {
				isCreatingRef.current = false;
			}
		},
		[projectId]
	);

	/**
	 * Save the current snapshot to the backend.
	 */
	const saveSnapshot = useCallback(
		async (snapshot: DesignSnapshot) => {
			const snapshotStr = JSON.stringify(snapshot);

			// Skip if nothing changed
			if (snapshotStr === lastSavedSnapshotRef.current) return;

			// Skip if already saving
			if (isSavingRef.current) return;

			isSavingRef.current = true;
			setSaveStatus('saving');

			try {
				let currentDesignId = designIdRef.current;

				// Create design if none exists
				if (!currentDesignId) {
					currentDesignId = await createDesignRecord(snapshot);
					if (!currentDesignId) {
						setSaveStatus('error');
						return;
					}
					setDesignId(currentDesignId);
					designIdRef.current = currentDesignId;
					lastSavedSnapshotRef.current = snapshotStr;
					setSaveStatus('saved');
					setLastSavedAt(new Date());
					return;
				}

				// Update existing design
				const response = await fetch(`/api/projects/${projectId}/designs`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						designId: currentDesignId,
						...snapshot,
					}),
				});

				if (!response.ok) {
					throw new Error('Failed to save design');
				}

				lastSavedSnapshotRef.current = snapshotStr;
				setSaveStatus('saved');
				setLastSavedAt(new Date());
			} catch (err) {
				console.error('[Autosave] Save failed:', err);
				setSaveStatus('error');
			} finally {
				isSavingRef.current = false;
			}
		},
		[projectId, createDesignRecord]
	);

	/**
	 * Trigger a debounced save.
	 */
	const debouncedSave = useCallback(() => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(() => {
			const snapshot = buildSnapshot();
			saveSnapshot(snapshot);
		}, AUTOSAVE_DEBOUNCE_MS);
	}, [buildSnapshot, saveSnapshot]);

	/**
	 * Subscribe to both stores and trigger debounced save on changes.
	 */
	useEffect(() => {
		const unsubDesign = useDesignStore.subscribe(() => {
			const nextRefs = getPersistedDesignRefs();
			if (!persistedDesignRefsChanged(persistedDesignRefsRef.current, nextRefs)) {
				return;
			}
			persistedDesignRefsRef.current = nextRefs;
			debouncedSave();
		});

		const unsubElements = useElementsStore.subscribe(() => {
			const nextPlacedElements = useElementsStore.getState().placedElements;
			if (placedElementsRef.current === nextPlacedElements) {
				return;
			}
			placedElementsRef.current = nextPlacedElements;
			debouncedSave();
		});

		return () => {
			unsubDesign();
			unsubElements();
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, [debouncedSave]);

	/**
	 * No longer auto-reset 'saved' → 'idle'. The UI shows lastSavedAt time instead.
	 * Only reset on next save start.
	 */

	/**
	 * Hydrate stores from a loaded design record. Returns clientSettings for the caller to apply.
	 */
	const hydrateFromDesign = useCallback(
		(design: {
			id: string;
			parameters: Record<string, unknown>;
			elements: unknown[];
			landmarks: Record<string, unknown> | null;
			scanMetadata: Record<string, unknown> | null;
			matchTransform: Record<string, unknown> | null;
			clientSettings?: Record<string, unknown> | null;
		}): Record<string, unknown> | null => {
			setDesignId(design.id);
			designIdRef.current = design.id;

			const designStore = useDesignStore.getState();
			const elementsStore = useElementsStore.getState();

			// Hydrate design store parameters
			const params = design.parameters as Record<string, unknown>;
			if (params) {
				const {
					selectedTemplate,
					selectedBaseSTL,
					gridEdits,
					zoneAdjustments,
					...restParams
				} = params;

				designStore.setParameters(restParams);
				if (selectedTemplate !== undefined) {
					designStore.setSelectedTemplate(selectedTemplate as string | null);
				}
				if (selectedBaseSTL !== undefined) {
					designStore.setSelectedBaseSTL(selectedBaseSTL as string | null);
				}
				if (Array.isArray(gridEdits)) {
					// Clear and re-add grid edits
					designStore.clearGridEdits();
					for (const edit of gridEdits) {
						designStore.addGridEdit(edit);
					}
				}
				if (Array.isArray(zoneAdjustments)) {
					designStore.clearZoneAdjustments();
					for (const adj of zoneAdjustments) {
						designStore.addZoneAdjustment(adj);
					}
				}
			}

			// Hydrate landmarks
			const landmarks = design.landmarks as Record<string, unknown> | null;
			if (landmarks) {
				if (landmarks.threePointLandmarks !== undefined) {
					designStore.setThreePointLandmarks(landmarks.threePointLandmarks as never);
				}
				if (landmarks.derivedLandmarks !== undefined) {
					designStore.setDerivedLandmarks(landmarks.derivedLandmarks as never);
				}
				if (landmarks.completeLandmarks !== undefined) {
					designStore.setCompleteLandmarks(landmarks.completeLandmarks as never);
				}
				if (landmarks.landmarks !== undefined) {
					designStore.setLandmarks(landmarks.landmarks as never);
				}
			}

			// Hydrate scan metadata
			const scanMeta = design.scanMetadata as Record<string, unknown> | null;
			if (scanMeta) {
				if (scanMeta.footGeometry !== undefined) {
					designStore.setFootGeometry(scanMeta.footGeometry as never);
				}
				if (scanMeta.plantarData !== undefined) {
					designStore.setPlantarData(scanMeta.plantarData as never);
				}
				if (scanMeta.insoleConfig !== undefined) {
					designStore.setInsoleConfig(scanMeta.insoleConfig as never);
				}
				if (scanMeta.scanValidation !== undefined) {
					designStore.setScanValidation(scanMeta.scanValidation as never);
				}
				if (scanMeta.insoleAttributes !== undefined) {
					designStore.setInsoleAttributes(scanMeta.insoleAttributes as never);
				}
			}

			// Hydrate match transform
			if (design.matchTransform) {
				designStore.setMatchTransform(design.matchTransform as never);
			}

			// Hydrate placed elements
			const elements = design.elements as Array<Record<string, unknown>>;
			if (Array.isArray(elements) && elements.length > 0) {
				elementsStore.clearAll();
				for (const el of elements) {
					const migratedElement = migrateLoadedElement(el);
					// Migrate old floorMode values ('sole'|'scan'|'free') → 'vloeien'
					if (migratedElement.floorMode && migratedElement.floorMode !== 'vloeien' && migratedElement.floorMode !== 'niet-vloeien') {
						migratedElement.floorMode = 'vloeien';
					}
					// Directly populate placedElements rather than going through addElement
					// since addElement requires a libraryKey lookup
					useElementsStore.setState((state) => ({
						placedElements: [...state.placedElements, migratedElement as never],
					}));
				}
			}

			// Store the initial snapshot to avoid immediate re-save
			const snapshot = buildSnapshot();
			lastSavedSnapshotRef.current = JSON.stringify(snapshot);

			// Return clientSettings so the caller can hydrate its local useState
			return (design.clientSettings as Record<string, unknown>) ?? null;
		},
		[buildSnapshot]
	);

	/**
	 * Force an immediate save (for explicit "save" actions).
	 */
	const forceSave = useCallback(() => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}
		const snapshot = buildSnapshot();
		saveSnapshot(snapshot);
	}, [buildSnapshot, saveSnapshot]);

	return {
		designId,
		saveStatus,
		lastSavedAt,
		hydrateFromDesign,
		forceSave,
		/** Trigger a debounced save (call when local state changes outside Zustand) */
		debouncedSave,
	};
}

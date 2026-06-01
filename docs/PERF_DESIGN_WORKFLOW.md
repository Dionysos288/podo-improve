# Design workflow performance (manual baseline)

Measure after `npm run dev` with both feet loaded, placed elements, and print zones split (`?perf=1`).

## Overlay

FPS, avg/max frame ms, slow frames, and long tasks render in-app. Recent rebuild timings show **Final** (full insole rebuild ms + vertex count) and **Ovly** (element overlay rebuild ms).

## Scenarios

| Scenario                         | Focus                              |
|----------------------------------|------------------------------------|
| Ontwerp sliders                  | Final rebuild + long tasks          |
| Bottom text typing               | Parent re-render vs overlay changes |
| Print split / hardness / hover   | Final stays quiet; Ovly unchanged on hover-only |
| Trimline drag                    | Interaction smoothness            |
| Box / lattice drag               | Lattice rAF; print tint reapplies at drag end   |
| Element move                     | Final log frequency               |
| Scan alignment                   | No extra final rebuilds           |

## Before vs after

Record FPS and **Max frame** during each scenario on a representative project:

| Scenario | Before (fill in) | After (fill in) |
|---------|-------------------|------------------|
| Orbit baseline | | |
| Corrections sliders | | |
| Print zone hover | | |
| Lattice drag | | |

Geometry CPU cost is surfaced as **Final** / **Ovly** values in the overlay (dev, `?perf=1` only).

## Loader and panels (smoothness)

Manual checks (workflow step **Ontwerp** / **Print**):

- Tekst staat aan: Schoenmaat / Ontwerp sliders aanpassen — **geen** full-screen tekst-loader; alleen bij actieve tekstbewerking in de editor verschijnt (na korte delay) tekst laden.
- Eerste keer tekst graveren: geen flicker tussen twee spinners (`useDebouncedLoading` + unified overlay).
- Project open: niet tegelijk route skeleton + dubbele spinner in de viewer-shell (dynamic viewer `loading: null`; één overlay via `ViewerStatusOverlay`).
- Algemeen schoenmaat / dikte / hoogte: lokale buffering + pointer-up flush; viewer krijgt `useDeferredValue` voor **corrections** en **hielrand** zodat de bediening tijdens zware meshes responsief blijft.

Geometry CPU-kosten blijven zichtbaar als **Final** / **Ovly** (dev, `?perf=1`).

## Notes from implementation

- **Final-geometry dedupe** was intentionally not added: identical input signatures can still require a rebuild after exiting box-grid edit mode, so skipping by signature risks stale meshes.

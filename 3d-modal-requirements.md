# 3D Modal Requirements (Insole Design)

Practical checklist for building the in-browser 3D design modal that edits insoles (length, width, local heights, box cuts, smoothing) and exports STL for printing.

## Scope

- Load left/right foot scans (STL) and an optional base/glb template.
- Realtime edits: global length/width, heel/mid/forefoot height offsets, medial arch, cup height, flattening, pronation/supination gradients, smoothing, box cuts (square regions), apex move, hide/show scans, base preview, point picking.
- Materials: assign surface overlays (top cover) and embedded volumes (holes/pockets) by region.
- Measurement: probe height anywhere on the sole.
- Export manifold STL in millimeters for print.

## Zones & attributes (definitive list)

- Heel, midfoot, forefoot (primary regions).
- Medial, lateral (for pronation/supination gradients).
- Cup/arch region.
- Apex marker/region (for apex move).
- Heel/calcaneus region (for heel bone correction).
- Trimline curve (editable outline).
- Box-cut grid cells (uIndex/vIndex per vertex) for square selections.
- Material masks/IDs (top overlays and inset/pockets).
- Custom-draw mask (freehand selection for hardness/material).
- Landmarks: meta1, meta5, navicular, calcaneus, heel.

## End-to-end checklist (send this to whoever prepares the scan)

1. Capture & export
   - Scan feet; export clean STL/OBJ/PLY in millimeters; consistent orientation (Z up preferred).
   - If using photogrammetry, ensure good overlap, no motion blur; avoid shiny surfaces.
2. Clean & retopo (offline)
   - Retopo/decimate to ~5k–20k verts; uniform triangles/quads; manifold; normals outward; close holes.
   - Center near origin; align axes; plantar side oriented consistently.
3. Zone tagging
   - Add vertex groups/attributes: heel, midfoot, forefoot, medial, lateral, cup, apex, cut grid cells.
   - Optional: material masks for top cover vs insole pockets (boolean volumes).
4. Grid for box cuts
   - Provide per-vertex grid indices (uIndex, vIndex) or a low-res grid mesh aligned to the sole for selectable square cuts.
5. Landmarks (if parametric insole generation)
   - meta1, meta5, navicular, calcaneus, heel points exported in local coordinates.
6. Validate
   - Units mm; no self-intersections; thickness ≥ printer tolerance; opens cleanly in Blender/MeshLab without repairs.
7. Deliverables
   - `left.stl`, `right.stl` (manifold, mm).
   - Optional `baseTemplate.glb` with attributes for zones/grid/material masks.
   - Landmark JSON (if used) and any mask metadata (grid resolution, region ids).

## Required inputs

- `left.stl`, `right.stl` (clean, manifold, mm units).
- Optional: `baseTemplate.glb` (for preview/overlay).
- Landmark points (meta1, meta5, navicular, calcaneus, heel) if you generate parametric insoles.
- Zone metadata (vertex groups or vertex attributes) for: heel, midfoot, forefoot, medial, lateral, cup, apex, cut grid.
- Material masks (attributes): `material_top` (0/1 or weight) for surface overlay; `material_inset` (0/1 or weight) for pockets/holes.
- Trimline curve data (outline) to allow editing.
- Optional hardness/material IDs per region or element.

## One-time model prep (offline, e.g., Blender)

- Retopo/decimate to ~5k–20k vertices; even distribution.
- Fix manifold: close holes, merge doubles, correct normals.
- Units: millimeters; align axes (Z up for three.js).
- Center near origin; rotate so plantar side faces +Y or +Z consistently.
- Create vertex groups/attributes per zone; add grid indices for box cutting.
- Validate: no self-intersections; thickness >= print tolerance.
- Export `glb` (keeps attributes) for base; export `stl` for scans if needed.

## Runtime stack (Next.js + React Three Fiber)

- Libraries: `@react-three/fiber`, `@react-three/drei` (Orbit/Transform/Grid), `three`, `STLLoader/GLTFLoader`, `STLExporter`, `three-mesh-bvh` (fast raycast/booleans), `zustand` design store, `react-query` for data.
- Core component: `EnhancedSTLViewer` (ref API: `match()`, `reset()`), supports point picking, grid, base preview, generated insole overlay.
- Utils: matching helpers (`centerMesh`, `scaleMesh`), landmark fitting (`buildBasicInsole`).

## UI/UX & accessibility

- Keyboard: full focusable controls; visible focus rings; Enter submits, Esc closes modal; arrow keys for sliders where applicable.
- Targets >= 24px; tooltips optional but avoid hover-only; aria-label on icon buttons; polite `aria-live` for toasts/errors.
- Manage focus on open/close; restore focus on close; scrollable panel with `scroll-margin-top` on headings.
- Keep submit enabled until request starts; show spinner + disable while processing; keep original label text.
- Never block paste; inputmode/type/autocomplete set; min font-size 16px on mobile.
- Offer undo/reset; confirm destructive actions; show inline errors and focus first error on submit.

## Controls to expose in the modal

- Global: show/hide scans, show grid, lock top view, base template toggle, generated insole toggle.
- Matching: auto-match, reset, manual sliders (x/y/z translation, rotation, scale) — currently UI only for manual.
- Dimensions: length mm, width mm (per axis scaling around center).
- Heights (zones): heel lift, mid/arch, forefoot/toe, medial arch correction, cup depth/height.
- Flatten/smooth: forefoot flatten toggle/slider, global smoothing (Gaussian/Laplacian).
- Pronation/Supination: gradient offsets (medial ↔ lateral) per region.
- Apex move: shift peak forward/back; toe taper/heel taper adjustments.
- Box cutting: select grid cell(s) -> subtract cube (boolean) with size/depth controls.
- Save/load presets; per-control favorite/heart support if needed.
- Export: STL (binary), keep mm units.
- Materials: choose material per region (top cover mask, inset mask); toggle show/hide; preview colors; thickness for inset/holes.
- Height probe: click/hover to read world-space height (mm) at any point; optionally show delta vs baseline plane.
- Trimline: edit outline (Bezier/vertex handles) and mirror if needed.
- Material hardness selection: per region/element (soft/medium/hard/custom); allow custom-draw mask to isolate a sub-area; allow splitting an element and assigning material/hardness per part.
- Element library: selectable pads/wedges/sinks; apply height (mm) and material; allow mirroring and positioning.
- Forefoot cutout: ability to cut/remove forefoot area; apex move; heel bone correction region.
- Logo/text underside: emboss/deboss text/logo on bottom; set depth; position and orientation.

## Geometry operations (runtime)

- Normalize once: center + scale to working units (current viewer scales to ~100 units).
- Zone-aware edits: use vertex attributes/groups to limit offsets per region.
- Height offsets: move vertices along normals; recompute normals after edits.
- Gradients: apply weight based on X (medial-lateral) or Y (heel-toe) position.
- Flatten: lerp vertex height toward plane/target; clamp to prevent inversion.
- Smoothing: Laplacian/Gaussian on selected region; preserve borders.
- Box cuts: boolean subtract using `three-mesh-bvh` booleans; keep meshes low-poly for speed; recompute normals.
- Generated insole overlay: build via `buildBasicInsole` with landmarks; render semi-transparent.
- Material application:
  - Top cover: attach a material id to surface vertices (no geometry change).
  - Inset/pocket: boolean subtract a shallow volume where `material_inset` > 0; clamp depth to thickness limits.
- Height probe: raycast to mesh; show position + height (mm) + region id; allow sampling multiple points.
- Trimline: edit control points on the outline; remesh/clip above the trimline; mirror option.
- Hardness/material: map material IDs to soft/medium/hard/custom presets; allow freehand mask to override a sub-area; support splitting a selected element and assigning different material IDs.
- Logo/text: emboss/deboss via shallow boolean of text/logo mesh; ensure manifold and depth within tolerance.

## Export pipeline (STL)

- Use `STLExporter`; export from the edited mesh (post-booleans).
- Ensure: manifold mesh, outward normals, mm units, closed volume; recompute normals pre-export.
- Offer download + optional upload to backend; include metadata (project id, params).

## Performance & reliability

- Keep active geometry light (<20k verts) for interactive booleans.
- Cache bounding boxes; avoid re-running normalization per frame.
- Do heavy ops (smoothing/booleans) in a worker when possible.
- Use `three-mesh-bvh` for fast raycasting and booleans; throttle pointer moves.
- Allow hiding scans while editing overlays to keep FPS high.

## Maya prep guide (send to your 3D friend)

Goal: deliver one clean, attribute-rich model for web editing: scans in STL, template in glb with zones, grid, materials, trimline, and landmarks.

Scene setup

- Units: millimeters. Up axis: Z. Keep scale at 1.0.
- Place the sole near origin; consistent orientation (plantar side and toe direction fixed for both feet).

Cleanup & retopo

- Target density: ~5k–20k verts; uniform triangles/quads.
- Fix manifold issues: merge doubles, fill holes, delete stray faces/lamina, recalc normals outward.
- Thickness: meet printer tolerance; no self-intersections.

Zones & attributes (store as vertex colors/sets that survive export)

- Primary regions: heel, midfoot, forefoot.
- Medial / lateral masks (for pronation/supination gradients).
- Cup/arch region.
- Apex region/marker.
- Heel/calcaneus region (heel bone correction).
- Box-cut grid: per-vertex integer-ish uIndex/vIndex (or two channels) so squares can be selected in browser.
- Material masks/IDs:
  - `material_top` mask or `material_id_top` (surface overlay).
  - `material_inset` mask or `material_id_inset` (pockets/holes).
  - If multiple materials: use IDs (0,1,2,…) per layer or one mask per material; be consistent.
- Custom-draw mask (optional freehand isolation for hardness/material overrides).
- Trimline curve data: keep an editable outline; you can store a curve or bake an outline mask.
- Landmarks: locators at meta1, meta5, navicular, calcaneus, heel (in same coord system).

Material intent (for web mapping)

- Top overlays: no geometry change, just material ID.
- Insets/pockets: drive shallow booleans; depth will be set in web app.
- Hardness: map IDs to soft/medium/hard/custom; keep IDs stable.

Export

- Scans: `left.stl`, `right.stl` (clean, mm).
- Template with attributes: export FBX or OBJ with vertex colors intact; then convert to glb (Blender or fbx2gltf) to preserve attributes. Name: `baseTemplate.glb`.
- Keep units mm; Z-up; no automatic scaling on export.

Hand-off bundle

- `left.stl`, `right.stl`.
- `baseTemplate.glb` (contains zones, grid indices, material masks/IDs, trimline, landmarks).
- A short README describing each attribute/color set (e.g., `material_id_top`, `material_id_inset`, `uIndex`, `vIndex`, `zone_heel`, etc.).
- Landmark coordinates (JSON or text).

Quick QA before sending

- Open the glb and STLs; confirm: correct size in mm, Z-up, manifold, normals outward.
- Verify vertex colors/attributes survived export (check in Blender or gltf viewer).
- Box grid indices present; landmarks visible; trimline present or outline mask present.

## Validation checklist before sending to a friend/print

- Units confirmed in mm; orientation matches viewer.
- Mesh is manifold; no holes; normals outward.
- Thickness >= printer requirement; no self-intersections after cuts.
- Bounding box matches expected foot size; compare against shoe size.
- STL opens cleanly in slicer (Prusa/Simplify/Cura) without repairs.

## Implementation steps (suggested order)

1. Prepare clean, zoned glb + stl assets (one time).
2. Wire modal with `EnhancedSTLViewer` + controls + zustand params.
3. Implement zone-aware vertex edits (heights/width/length/gradients).
4. Add smoothing + box cut (boolean) actions.
5. Hook STL export; validate manifold + units.
6. Add presets/favorites and save/load to backend.
7. Accessibility pass (keyboard/focus/aria-live) and performance tuning.
8. QA in slicer, then ship.

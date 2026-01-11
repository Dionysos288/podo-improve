# Maya Prep Guide for Insole Web Editor

This guide tells you exactly what to do in Maya with the STL scans so the web app can edit them live.

---

## Current scan status

| File                             | Triangles | Size (mm)     | Notes            |
| -------------------------------- | --------- | ------------- | ---------------- |
| (Amina) Ruymen - voor Dion_L.stl | 82,614    | 88 × 254 × 20 | Left foot, Z-up  |
| (Amina) Ruymen - voor Dion_R.stl | 82,284    | 88 × 254 × 20 | Right foot, Z-up |

**Status:** Geometry is clean (exported from existing app). No decimation or cleanup needed.

**Still needed:**

- Add zone/material/grid attributes (vertex colors).
- Place landmarks.
- Export as glb.

---

## Step 0: Scene setup

1. Open Maya.
2. Set units: **Window → Settings/Preferences → Preferences → Settings → Working Units → Linear: millimeter**.
3. Set up-axis: **Window → Settings/Preferences → Preferences → Settings → World Coordinate System → Up axis: Z**.
4. Import both STL files.

---

## Step 1: Verify geometry (already clean)

The STL is from a working app, so it should already be clean. Just verify:

1. **Check orientation**: Z-up, Y = length (heel-to-toe), X = width.
2. **Check position**: Sole should be near origin (0, 0, 0). Move if needed.
3. **Optional**: If live editing feels slow later, decimate to ~20k–40k verts (Mesh → Reduce).

---

## Step 2: Create zone vertex colors

Zones tell the web app which part of the sole you're editing.

1. Select the sole mesh.
2. **Create color set**: Mesh Display → Color Set Editor → New Set → name it `zones`.
3. **Paint zones**: Use Paint Vertex Color Tool (Mesh Display → Paint Vertex Color Tool).
4. Paint each area with a unique color. Use these exact RGB values:

| Zone      | R   | G   | B   | Description       |
| --------- | --- | --- | --- | ----------------- |
| heel      | 1.0 | 0.0 | 0.0 | Back of the sole  |
| midfoot   | 0.0 | 1.0 | 0.0 | Middle area       |
| forefoot  | 0.0 | 0.0 | 1.0 | Front/toe area    |
| medial    | 1.0 | 1.0 | 0.0 | Inside edge       |
| lateral   | 1.0 | 0.0 | 1.0 | Outside edge      |
| cup/arch  | 0.0 | 1.0 | 1.0 | Arch support area |
| apex      | 0.5 | 0.5 | 0.0 | Peak of the arch  |
| calcaneus | 0.5 | 0.0 | 0.5 | Heel bone area    |

5. Use Flood to fill selected vertices quickly.

---

## Step 3: Create box grid for square cuts

This lets the web app select squares on the sole to push up/down.

1. **Create color set**: Mesh Display → Color Set Editor → New Set → name it `gridIndex`.
2. Decide grid size, e.g. 10 columns × 25 rows.
3. **Paint columns (Red channel)**:
   - Switch to top view.
   - Select a vertical strip of vertices (one column).
   - Set paint color to (0, 0, 0) for column 0, (0.1, 0, 0) for column 1, (0.2, 0, 0) for column 2, etc.
   - Or use values 0, 1, 2, ... if your export supports it (normalize later).
4. **Paint rows (Green channel)**:
   - Select a horizontal strip (one row).
   - Set paint color's Green to the row number (0, 0.04, 0.08, ... for rows 0, 1, 2, ... out of 25).
5. Leave Blue at 0.

Result: each vertex has (R = column, G = row). The web app will read these to pick squares.

---

## Step 4: Create material masks

Materials define where overlays go (on top) and where holes/pockets are cut (inset).

1. **Create color set**: Mesh Display → Color Set Editor → New Set → name it `materials`.
2. Paint using these channels:

| Channel | Meaning           | Values                                        |
| ------- | ----------------- | --------------------------------------------- |
| Red     | material_top ID   | 0 = none, 1 = material A, 2 = material B, ... |
| Green   | material_inset ID | 0 = none, 1 = pocket A, 2 = pocket B, ...     |
| Blue    | hardness          | 0 = soft, 0.5 = medium, 1 = hard              |

3. Paint the areas where you want materials applied.
4. For multiple materials, just use different ID values (1, 2, 3, ...).

---

## Step 5: Create trimline

The trimline is the cut outline of the sole.

**Option A: Curve (recommended)**

1. In top view, draw a CV Curve or EP Curve that follows the outer edge.
2. Name it `trimline_L` or `trimline_R`.
3. Keep it with the mesh (don't delete).

**Option B: Vertex color mask**

1. Create color set named `trimline`.
2. Paint 1 (white) on vertices along the outer edge.
3. Paint 0 (black) everywhere else.

---

## Step 6: Place landmarks

Landmarks help generate parametric insoles.

1. Create → Locator for each point:
   - `meta1` (base of big toe)
   - `meta5` (base of pinky toe)
   - `navicular` (inside arch bump)
   - `calcaneus` (heel bone center)
   - `heel` (back center of heel)
2. Position each locator on the sole surface.
3. Note their positions (or export as JSON):

```json
{
  "meta1": [x, y, z],
  "meta5": [x, y, z],
  "navicular": [x, y, z],
  "calcaneus": [x, y, z],
  "heel": [x, y, z]
}
```

---

## Step 7: Validate before export

Check these:

- [ ] Units are millimeters
- [ ] Z is up
- [ ] Mesh looks correct (no holes, normals outward)
- [ ] Vertex count is reasonable (~80k is fine; decimate if editing is slow)
- [ ] All color sets exist: `zones`, `gridIndex`, `materials`, `trimline`
- [ ] Landmarks are placed
- [ ] Bounding box matches expected shoe size (~88mm × 254mm × 20mm)

---

## Step 8: Export

### STL files (for raw scans)

1. Select the left sole.
2. File → Export Selection → STL.
3. Name: `left.stl`.
4. Repeat for right: `right.stl`.

### FBX with vertex colors (for template)

1. Select both soles + trimline curves + landmarks.
2. File → Export Selection → FBX.
3. In FBX options, enable "Vertex Colors".
4. Name: `insole_template.fbx`.

### Convert FBX to glb

1. Open Blender.
2. File → Import → FBX → select `insole_template.fbx`.
3. Check that vertex colors are visible (Viewport Shading → Attribute).
4. File → Export → glTF 2.0 (.glb).
5. Enable "Vertex Colors" in export options.
6. Name: `baseTemplate.glb`.

---

## What to send me

- [ ] `left.stl` (decimated, manifold, mm)
- [ ] `right.stl` (decimated, manifold, mm)
- [ ] `baseTemplate.glb` (with all vertex colors/attributes)
- [ ] `landmarks.json` (positions of the 5 points)
- [ ] Short note: what each color set means, grid resolution (e.g. 10×25)

---

## Quick reference: Color sets summary

| Color set name | Purpose                                         | Channels used                          |
| -------------- | ----------------------------------------------- | -------------------------------------- |
| zones          | Heel/mid/fore/medial/lateral/cup/apex/calcaneus | RGB = zone ID color                    |
| gridIndex      | Box cut grid                                    | R = column, G = row                    |
| materials      | Overlays + pockets + hardness                   | R = top ID, G = inset ID, B = hardness |
| trimline       | Cut outline                                     | R = 1 on edge, 0 elsewhere             |

---

## If you get stuck

- Colors not exporting? Make sure "Vertex Colors" is ON in FBX export options.
- Normals flipped? Select all faces → Mesh Display → Reverse.
- Blender can't see colors? In Blender, switch to "Attribute" in viewport shading and pick the color attribute.
- Web app slow? Decimate to ~20k–40k verts (Mesh → Reduce).

Good luck!

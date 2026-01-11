# Blender Prep Guide for Insole Web Editor

This guide tells you exactly what to do in Blender with the STL scans so the web app can edit them live.

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

1. Open Blender (3.0+ recommended).
2. **Delete default cube**: Select it, press `X` → Delete.
3. **Set units**:
   - Properties panel (right) → Scene Properties (icon with globe) → Units
   - Unit System: **Metric**
   - Unit Scale: **1.0**
   - Length: **Millimeters**
4. **Import STL files**:
   - File → Import → STL (.stl)
   - Navigate to your STL files
   - Import `(Amina) Ruymen - voor Dion_L.stl` first
   - Import `(Amina) Ruymen - voor Dion_R.stl` second

---

## Step 1: Verify geometry (already clean)

The STL is from a working app, so it should already be clean. Just verify:

1. **Select a mesh**: Click on it in the 3D viewport.
2. **Check orientation**: Press `Numpad 7` (top view) to see if sole is flat. Should look like a foot shape from above.
3. **Check position**: With mesh selected, look at Properties panel → Item tab (orange icon). If Transform is far from origin, press `Alt + G` (clear location) to move to origin.
4. **Rename meshes**:
   - In Outliner (top-right), rename `(Amina) Ruymen - voor Dion_L` to `Left_Insole`
   - Rename `(Amina) Ruymen - voor Dion_R` to `Right_Insole`
5. **Optional**: If live editing feels slow later, decimate:
   - Select mesh → Modifier Properties (wrench icon) → Add Modifier → Decimate
   - Ratio: 0.2–0.4 (keeps 20–40% of verts)

---

## Step 2: Create zone vertex colors

Zones tell the web app which part of the sole you're editing.

### Create color attribute

1. **Select the mesh** (e.g., `Left_Insole`).
2. **Enter Vertex Paint mode**: Click dropdown at top (default says "Object Mode") → **Vertex Paint**.
3. **Create new color attribute**:
   - Properties panel → Material Properties (red sphere icon)
   - Click `+ New` button to create a material (if none exists)
   - Switch to **Data Properties** (green triangle icon) → Attributes
   - Click `+` (Add Attribute)
   - Name: `zones`
   - Domain: **Point** (vertex colors)
   - Data Type: **Color**
   - Color Space: **sRGB**
   - Click **Add**

### Paint zones

1. **Make sure you're in Vertex Paint mode** (top dropdown).
2. **Select the `zones` attribute**:
   - Properties panel → Data Properties → Attributes → Active dropdown → select `zones`
3. **Set up paint tools**:
   - Press `T` to open Toolbar (left side)
   - Brush → Radius: adjust with `F` key (start ~50px)
   - Brush → Strength: 1.0 (full strength)
4. **Paint each zone with unique colors**. Use these exact RGB values:

| Zone      | R   | G   | B   | How to paint                     |
| --------- | --- | --- | --- | -------------------------------- |
| heel      | 1.0 | 0.0 | 0.0 | Back of the sole (red)           |
| midfoot   | 0.0 | 1.0 | 0.0 | Middle area (green)              |
| forefoot  | 0.0 | 0.0 | 1.0 | Front/toe area (blue)            |
| medial    | 1.0 | 1.0 | 0.0 | Inside edge (yellow)             |
| lateral   | 1.0 | 0.0 | 1.0 | Outside edge (magenta)           |
| cup/arch  | 0.0 | 1.0 | 1.0 | Arch support area (cyan)         |
| apex      | 0.5 | 0.5 | 0.0 | Peak of the arch (darker yellow) |
| calcaneus | 0.5 | 0.0 | 0.5 | Heel bone area (dark magenta)    |

5. **How to paint**:
   - Click color picker in Toolbar (or press `S` to use color picker)
   - Set RGB values (e.g., R=1, G=0, B=0 for heel)
   - Click and drag to paint vertices
   - Use `Ctrl + Click` to fill selected area
   - Rotate view: `Middle Mouse` drag, Zoom: `Mouse Wheel`, Pan: `Shift + Middle Mouse`
6. **Repeat for Right_Insole**: Select it, go to Vertex Paint mode, paint same zones.

**Tip:** To see colors better, press `Z` → **Solid** mode, then `N` → Viewport Overlays → check "Face Orientation" to see which side is which.

---

## Step 3: Create box grid for square cuts

This lets the web app select squares on the sole to push up/down.

1. **Create new color attribute**:

   - Select mesh → Data Properties → Attributes → `+` (Add Attribute)
   - Name: `gridIndex`
   - Domain: **Point**
   - Data Type: **Float Vector** (stores 3 floats: R, G, B)
   - Click **Add**

2. **Enter Vertex Paint mode** → select `gridIndex` as active attribute.

3. **Decide grid size**, e.g. 10 columns × 25 rows.

4. **Paint columns (Red channel = uIndex)**:

   - Switch to top view: `Numpad 7`
   - Paint tool → Color: Use Red channel only
   - Column 0: Color = (0.0, 0.0, 0.0)
   - Column 1: Color = (0.1, 0.0, 0.0) or (1, 0, 0) if using normalized values
   - Column 2: Color = (0.2, 0.0, 0.0)
   - Continue for all 10 columns
   - **Easy way**: Select vertical strip of vertices → `Ctrl + Click` to fill with column value

5. **Paint rows (Green channel = vIndex)**:

   - Row 0: Keep Green at 0.0
   - Row 1: Color = (keep Red from step 4, 0.04, 0.0) for row 1 out of 25
   - Row 2: Color = (keep Red, 0.08, 0.0)
   - Continue for all 25 rows
   - **Easy way**: Select horizontal strip → `Ctrl + Click` to fill row value

6. **Leave Blue at 0** (unused).

**Result:** Each vertex has (R = column, G = row). The web app reads these to pick squares.

**Alternative (if painting is too tedious):**

- Use **Geometry Nodes** to auto-assign grid indices based on vertex position (advanced).

---

## Step 4: Create material masks

Materials define where overlays go (on top) and where holes/pockets are cut (inset).

1. **Create new color attribute**:

   - Data Properties → Attributes → `+` (Add Attribute)
   - Name: `materials`
   - Domain: **Point**
   - Data Type: **Float Vector** (stores R, G, B)
   - Click **Add**

2. **Enter Vertex Paint mode** → select `materials` as active.

3. **Paint using these channels**:

| Channel | Meaning           | Values                                           |
| ------- | ----------------- | ------------------------------------------------ |
| Red     | material_top ID   | 0.0 = none, 0.33 = material A, 0.66 = B, 1.0 = C |
| Green   | material_inset ID | 0.0 = none, 0.33 = pocket A, 0.66 = B, 1.0 = C   |
| Blue    | hardness          | 0.0 = soft, 0.5 = medium, 1.0 = hard             |

4. **How to paint**:

   - **Overlays (top)**: Paint Red channel where materials go on top.
     - No material: R = 0.0
     - Material A: R = 0.33
     - Material B: R = 0.66
     - Material C: R = 1.0
   - **Pockets (inset)**: Paint Green channel where holes go.
     - No pocket: G = 0.0
     - Pocket A: G = 0.33
     - Pocket B: G = 0.66
     - Pocket C: G = 1.0
   - **Hardness**: Paint Blue channel (0 = soft, 0.5 = medium, 1.0 = hard).

5. **For multiple materials**: Use different ID values (0.33, 0.66, 1.0, etc.) and keep a note of which is which.

---

## Step 5: Create trimline

The trimline is the cut outline of the sole.

### Option A: Curve (recommended)

1. **Enter Object Mode** (top dropdown).
2. **Add curve**: `Shift + A` → Curve → Bezier or `Shift + A` → Curve → NURBS Path.
3. **Enter Edit Mode**: `Tab`.
4. **Draw the outline**:
   - Switch to top view: `Numpad 7`
   - `Ctrl + Click` to add control points along the outer edge
   - Press `G` (grab) to move points, `E` to extrude
   - Make a closed loop (first and last point connect)
5. **Name it**: `trimline_L` or `trimline_R` in Outliner.
6. **Keep it with the mesh** (don't delete).

### Option B: Vertex color mask

1. **Create new color attribute**:

   - Data Properties → Attributes → `+` (Add Attribute)
   - Name: `trimline`
   - Domain: **Point**
   - Data Type: **Color** or **Float** (single value)
   - Click **Add**

2. **Enter Vertex Paint mode** → select `trimline` as active.

3. **Paint the outline**:
   - Color = (1.0, 1.0, 1.0) = white on vertices along the outer edge
   - Color = (0.0, 0.0, 0.0) = black everywhere else
   - Use small brush radius to paint precisely along edge

---

## Step 6: Place landmarks

Landmarks help generate parametric insoles.

1. **Enter Object Mode**.
2. **Add Empty (locator)**:
   - `Shift + A` → Empty → Plain Axes
   - Or `Shift + A` → Empty → Sphere (easier to see)
3. **Name it** in Outliner: `meta1` (for base of big toe).
4. **Position it**:
   - `G` to grab, `X/Y/Z` to constrain axis
   - Place on sole surface (use top view `Numpad 7` and side view `Numpad 1` or `Numpad 3`)
5. **Repeat for all landmarks**:
   - `meta1` (base of big toe)
   - `meta5` (base of pinky toe)
   - `navicular` (inside arch bump)
   - `calcaneus` (heel bone center)
   - `heel` (back center of heel)
6. **Export positions**:
   - Select each Empty → Properties panel → Item tab
   - Note X, Y, Z values (in mm)
   - Or create a text file `landmarks.json`:

```json
{
  "meta1": [x, y, z],
  "meta5": [x, y, z],
  "navicular": [x, y, z],
  "calcaneus": [x, y, z],
  "heel": [x, y, z]
}
```

**Tip:** To snap to surface: Select Empty → `Shift + S` → "Cursor to Selected", then select mesh → `Shift + S` → "Selection to Cursor".

---

## Step 7: Validate before export

Check these:

- [ ] Units are millimeters (Scene Properties → Units)
- [ ] Z is up (top view looks correct)
- [ ] Mesh looks correct (no holes, normals outward - check with `Z` → Solid + Face Orientation)
- [ ] Vertex count is reasonable (~80k is fine; decimate if editing is slow)
- [ ] All color attributes exist: `zones`, `gridIndex`, `materials`, `trimline` (check in Data Properties → Attributes)
- [ ] Landmarks are placed (check Outliner for all 5 Empties)
- [ ] Bounding box matches expected shoe size (~88mm × 254mm × 20mm - check in Properties → Item → Dimensions)

**Quick check:** Select mesh → `N` → Item tab → check Dimensions. Should be around 88 × 254 × 20 mm.

---

## Step 8: Export

### STL files (for raw scans)

1. **Select the left sole mesh** (`Left_Insole`).
2. **File → Export → STL (.stl)**
3. **In export options** (bottom-left):
   - Check "Selection Only"
   - Scale: 1.0 (units are already mm)
   - Forward: -Z Forward, Up: Y Up (typical for STL)
4. **Name**: `left.stl`
5. **Click "Export STL"**
6. **Repeat for right**: Select `Right_Insole` → Export as `right.stl`

### glTF/glb with vertex colors (for template)

1. **Select all objects** you want to export:

   - Hold `Shift` → Click both `Left_Insole` and `Right_Insole`
   - Click all landmark Empties (meta1, meta5, navicular, calcaneus, heel)
   - Click trimline curves (if you made them)
   - Or press `A` (select all) then `Shift + Click` to deselect anything extra

2. **File → Export → glTF 2.0 (.glb/.gltf)**

3. **In export options** (bottom-left):

   - Format: **glTF Binary (.glb)** (recommended - single file)
   - Include: Check "Selected Objects"
   - Transform: Scale = 1.0, Forward = -Z, Up = Y
   - Geometry:
     - Check "Apply Modifiers" (if you used Decimate modifier)
     - Check "UVs" (even if unused)
     - Check "Vertex Colors" (CRITICAL - this exports your color attributes)
     - Check "Tangents" (optional)
   - Materials: Export = "None" (unless you added materials, then "Export")
   - Compression: Draco (optional - smaller file but slower to load)

4. **Name**: `baseTemplate.glb`

5. **Click "Export glTF 2.0"**

**Important:** After export, verify vertex colors are in the file:

- Import the glb back into Blender (separate file)
- Select mesh → Data Properties → Attributes
- Check that `zones`, `gridIndex`, `materials`, `trimline` are all there

---

## What to send me

- [ ] `left.stl` (raw scan, mm)
- [ ] `right.stl` (raw scan, mm)
- [ ] `baseTemplate.glb` (with all vertex color attributes)
- [ ] `landmarks.json` (positions of the 5 points)
- [ ] Short note: what each color attribute means, grid resolution (e.g. 10×25)

---

## Quick reference: Color attributes summary

| Attribute name | Purpose                                         | Type           | Channels used                                |
| -------------- | ----------------------------------------------- | -------------- | -------------------------------------------- |
| zones          | Heel/mid/fore/medial/lateral/cup/apex/calcaneus | Color (sRGB)   | RGB = zone ID color                          |
| gridIndex      | Box cut grid                                    | Float Vector   | R = column, G = row                          |
| materials      | Overlays + pockets + hardness                   | Float Vector   | R = top ID, G = inset ID, B = hardness       |
| trimline       | Cut outline                                     | Color or Float | R = 1 on edge, 0 elsewhere (or single value) |

---

## If you get stuck

- **Vertex colors not showing?** Make sure you're in Vertex Paint mode (`Z` → Solid view).
- **Can't see attributes?** Check Data Properties → Attributes panel (green triangle icon).
- **Export options missing?** Make sure you have Blender 3.0+ (glTF 2.0 export is built-in).
- **Colors not exporting?** In glTF export, check "Vertex Colors" is ON.
- **Normals flipped?** Select mesh → Edit Mode (`Tab`) → Select All (`A`) → Mesh → Normals → Flip.
- **Can't find menu?** Press `F3` to search for any command (type "export gltf" or "vertex paint").
- **Web app slow?** Decimate to ~20k–40k verts (Modifier Properties → Add Modifier → Decimate, Ratio: 0.2–0.4).

---

## Keyboard shortcuts cheat sheet

- `Tab` = Toggle Edit Mode / Object Mode
- `T` = Toggle Toolbar (left side)
- `N` = Toggle Properties panel (right side)
- `Z` = Viewport shading menu (Solid, Wireframe, etc.)
- `G` = Grab/Move
- `R` = Rotate
- `S` = Scale
- `X/Y/Z` = Constrain to axis (after G/R/S)
- `Numpad 1/3/7` = Front/Side/Top view
- `Numpad 0` = Camera view
- `Middle Mouse` = Rotate view
- `Shift + Middle Mouse` = Pan view
- `Mouse Wheel` = Zoom
- `A` = Select All / Deselect All (if already selected)
- `Shift + A` = Add menu
- `Ctrl + Z` = Undo

Good luck!

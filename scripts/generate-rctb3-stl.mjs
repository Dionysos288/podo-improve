/**
 * Generate RCTB3 (Retro-Capital-Transverse Bar, size 3) STL file.
 *
 * Shape from the reference image:
 *   – A thick transverse pad sitting across the metatarsal heads
 *   – The front edge follows a gentle curve (convex toward the toes)
 *   – The back edge is slightly concave
 *   – Wider on the lateral side, slightly tapering medially
 *   – Smooth dome ("bol") profile — highest in the centre, tapers all edges
 *   – Flat bottom (sits on the insole surface)
 *
 * Coordinate system (mm, right-hand):
 *   X = medial(−) ↔ lateral(+)   (centred at 0)
 *   Y = proximal(0, heel side) → distal(+, toe side)
 *   Z = height (0 = flat bottom, + = up)
 *
 * Output: binary STL → public/materials/rctb3.stl
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'materials');
mkdirSync(outDir, { recursive: true });

/* ── pad dimensions (mm) ──────────────────────── */
const DEPTH          = 32;    // heel-toe extent of the bar
const WIDTH_BACK     = 66;    // width at back (proximal) edge
const WIDTH_FRONT    = 58;    // width at front (distal) edge
const PEAK_HEIGHT    = 5.0;   // max dome height at centre
const BLEND_MM       = 7;     // edge taper distance in mm
const CORNER_RADIUS  = 8;     // rounded corners radius in mm
const FRONT_BULGE    = 4;     // mm the front edge bulges forward at the centre
const BACK_INDENT    = 2;     // mm the back edge indents at the centre

const RES_X = 100;
const RES_Y = 60;

/* ── helpers ──────────────────────────────────── */
function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Signed distance to the pad outline (positive = inside).
 */
function signedDistToOutline(x, y) {
  const xNorm = Math.abs(x) / (WIDTH_BACK / 2);
  const frontY = DEPTH + FRONT_BULGE * Math.cos(Math.min(xNorm, 1) * Math.PI / 2);
  const backY = -BACK_INDENT * Math.cos(Math.min(xNorm, 1) * Math.PI / 2);

  const yFrac = Math.max(0, Math.min(1, (y - backY) / (frontY - backY)));
  const halfW = lerp(WIDTH_BACK, WIDTH_FRONT, yFrac) / 2;

  const dSide = halfW - Math.abs(x);
  const dBack = y - backY;
  const dFront = frontY - y;

  let d = Math.min(dSide, dBack, dFront);

  // Round corners
  const nearBack = dBack < CORNER_RADIUS;
  const nearFront = dFront < CORNER_RADIUS;
  const nearSide = dSide < CORNER_RADIUS;

  if (nearSide && (nearBack || nearFront)) {
    const cornerX = halfW - CORNER_RADIUS;
    const cornerY = nearBack ? backY + CORNER_RADIUS : frontY - CORNER_RADIUS;
    if (Math.abs(x) > cornerX) {
      const shouldApply = nearBack ? y < cornerY : y > cornerY;
      if (shouldApply) {
        const dist = Math.sqrt((Math.abs(x) - cornerX) ** 2 + (y - cornerY) ** 2);
        d = CORNER_RADIUS - dist;
      }
    }
  }
  return d;
}

/**
 * Height at point (x, y).
 */
function padHeight(x, y) {
  const sd = signedDistToOutline(x, y);
  if (sd <= 0) return 0;

  const edgeFactor = sd < BLEND_MM ? smoothstep(0, BLEND_MM, sd) : 1.0;

  const cx = 0, cy = DEPTH / 2;
  const halfW = (WIDTH_BACK + WIDTH_FRONT) / 4;
  const rx = Math.abs(x - cx) / halfW;
  const ry = Math.abs(y - cy) / (DEPTH / 2);
  const normDist = Math.sqrt(rx * rx + ry * ry);
  const domeFactor = normDist < 1 ? Math.cos(normDist * Math.PI / 2) : 0;

  return PEAK_HEIGHT * edgeFactor * Math.max(domeFactor, 0);
}

/* ── generate height-field ───────────────────── */
const nx = RES_X + 1;
const ny = RES_Y + 1;
const verts = [];

const xMin = -(WIDTH_BACK / 2 + 3);
const xMax = (WIDTH_BACK / 2 + 3);
const yMin = -(BACK_INDENT + 3);
const yMax = DEPTH + FRONT_BULGE + 3;

for (let iy = 0; iy < ny; iy++) {
  for (let ix = 0; ix < nx; ix++) {
    const x = xMin + (ix / RES_X) * (xMax - xMin);
    const y = yMin + (iy / RES_Y) * (yMax - yMin);
    verts.push([x, y, padHeight(x, y)]);
  }
}

/* ── triangulate ─────────────────────────────── */
const tris = [];
function vi(ix, iy) { return iy * nx + ix; }
function hasH(i) { return verts[i][2] > 0.0005; }

for (let iy = 0; iy < RES_Y; iy++) {
  for (let ix = 0; ix < RES_X; ix++) {
    const a = vi(ix, iy);
    const b = vi(ix + 1, iy);
    const c = vi(ix + 1, iy + 1);
    const d = vi(ix, iy + 1);

    if (hasH(a) || hasH(b) || hasH(c)) {
      // Top
      tris.push([verts[a], verts[b], verts[c]]);
      // Bottom (reversed)
      tris.push([[verts[c][0], verts[c][1], 0], [verts[b][0], verts[b][1], 0], [verts[a][0], verts[a][1], 0]]);
    }
    if (hasH(a) || hasH(c) || hasH(d)) {
      tris.push([verts[a], verts[c], verts[d]]);
      tris.push([[verts[d][0], verts[d][1], 0], [verts[c][0], verts[c][1], 0], [verts[a][0], verts[a][1], 0]]);
    }
  }
}

// Side walls at boundary transitions
for (let iy = 0; iy < RES_Y; iy++) {
  for (let ix = 0; ix < RES_X; ix++) {
    const a = vi(ix, iy), b = vi(ix + 1, iy);
    const d = vi(ix, iy + 1), c = vi(ix + 1, iy + 1);
    const aH = hasH(a), bH = hasH(b), cH = hasH(c), dH = hasH(d);

    const wall = (i0, i1, flip) => {
      const p0 = verts[i0], p1 = verts[i1];
      const p0b = [p0[0], p0[1], 0], p1b = [p1[0], p1[1], 0];
      if (flip) { tris.push([p1, p0, p0b]); tris.push([p1, p0b, p1b]); }
      else { tris.push([p0, p1, p1b]); tris.push([p0, p1b, p0b]); }
    };

    // Internal boundary edges
    if (aH !== bH) wall(a, b, !aH);
    if (dH !== cH) wall(d, c, !dH);
    if (aH !== dH) wall(a, d, aH);
    if (bH !== cH) wall(b, c, bH);

    // Grid perimeter
    if (iy === 0 && (aH || bH)) wall(a, b, true);
    if (iy === RES_Y - 1 && (dH || cH)) wall(d, c, false);
    if (ix === 0 && (aH || dH)) wall(a, d, false);
    if (ix === RES_X - 1 && (bH || cH)) wall(b, c, true);
  }
}

/* ── write binary STL ────────────────────────── */
function computeNormal(v0, v1, v2) {
  const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
  const vx = v2[0] - v0[0], vy = v2[1] - v0[1], vz = v2[2] - v0[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const len = Math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

const validTris = tris.filter(([v0, v1, v2]) => {
  const [a, b, c] = computeNormal(v0, v1, v2);
  return Math.abs(a) + Math.abs(b) + Math.abs(c) > 0.001;
});

const numTris = validTris.length;
const bufSize = 80 + 4 + numTris * 50;
const buf = Buffer.alloc(bufSize);
buf.write('RCTB3 retro-capital-transverse bar pad', 0, 'ascii');
buf.writeUInt32LE(numTris, 80);

let offset = 84;
for (const [v0, v1, v2] of validTris) {
  const [fnx, fny, fnz] = computeNormal(v0, v1, v2);
  buf.writeFloatLE(fnx, offset); offset += 4;
  buf.writeFloatLE(fny, offset); offset += 4;
  buf.writeFloatLE(fnz, offset); offset += 4;
  for (const v of [v0, v1, v2]) {
    buf.writeFloatLE(v[0], offset); offset += 4;
    buf.writeFloatLE(v[1], offset); offset += 4;
    buf.writeFloatLE(v[2], offset); offset += 4;
  }
  buf.writeUInt16LE(0, offset); offset += 2;
}

const outPath = join(outDir, 'rctb3.stl');
writeFileSync(outPath, buf);
console.log(`✅ Written ${numTris} triangles → ${outPath}`);
console.log(`   Pad: ${WIDTH_BACK}×${DEPTH}mm, peak ${PEAK_HEIGHT}mm`);
console.log(`   File size: ${(bufSize / 1024).toFixed(1)} KB`);

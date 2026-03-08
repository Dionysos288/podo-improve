const fs = require('fs');
const file = 'src/features/design/components/EnhancedSTLViewer.tsx';
const src = fs.readFileSync(file, 'utf8');

const startFn = src.indexOf('function flattenForefootTopSurface(');
const endSentinel = src.indexOf('\nfunction removeDegenerateTriangles(', startFn);
const commentStart = src.lastIndexOf('\n/**', startFn);
console.log('commentStart:', commentStart, 'endSentinel:', endSentinel);

const q = "'";
const REPLACEMENT = `
/**
 * Flatten forefoot: pull each vertex toward the global weighted-mean height
 * of all top-facing forefoot vertices in the same length-axis slice.
 * Unlike Laplacian (which averages local neighbors and converges to the ridge),
 * this collapses the full-width variance in one pass. 94% blend => 6% residual.
 */
function flattenForefootTopSurface(
geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
if (!geometry.index) return geometry;
const posAttr = geometry.getAttribute(${q}position${q}) as THREE.BufferAttribute | null;
let normalAttr = geometry.getAttribute(${q}normal${q}) as THREE.BufferAttribute | null;
if (!posAttr) return geometry;
if (!normalAttr) {
geometry.computeVertexNormals();
normalAttr = geometry.getAttribute(${q}normal${q}) as THREE.BufferAttribute | null;
if (!normalAttr) return geometry;
}
const vertCount = posAttr.count;
const box = new THREE.Box3().setFromBufferAttribute(posAttr);
const sxyz = [box.max.x-box.min.x, box.max.y-box.min.y, box.max.z-box.min.z];
const sorted = ([0, 1, 2] as (0|1|2)[]).slice().sort((a, b) => sxyz[a]-sxyz[b]);
const hAxisIdx = sorted[0];
const wAxisIdx = sorted[1];
const lAxisIdx = sorted[2];
const posArr = posAttr.array as Float32Array;
const hOf = (v: number) => posArr[v*3+hAxisIdx];
const lOf = (v: number) => posArr[v*3+lAxisIdx];
const wOf = (v: number) => posArr[v*3+wAxisIdx];
const nUpOf = (v: number): number =>
hAxisIdx===0 ? normalAttr!.getX(v) : hAxisIdx===1 ? normalAttr!.getY(v) : normalAttr!.getZ(v);
const lMin = lAxisIdx===0 ? box.min.x : lAxisIdx===1 ? box.min.y : box.min.z;
const lMax = lAxisIdx===0 ? box.max.x : lAxisIdx===1 ? box.max.y : box.max.z;
const lenSpan = Math.max(1e-6, lMax-lMin);
// Detect heel end: wider end = heel
let wSpreadLo = 0, wSpreadHi = 0;
{
let wMinLo=Infinity, wMaxLo=-Infinity, wMinHi=Infinity, wMaxHi=-Infinity;
for (let v=0; v<vertCount; v++) {
if (nUpOf(v)<0.25) continue;
const t=(lOf(v)-lMin)/lenSpan; const w=wOf(v);
if (t<0.20) { wMinLo=Math.min(wMinLo,w); wMaxLo=Math.max(wMaxLo,w); }
if (t>0.80) { wMinHi=Math.min(wMinHi,w); wMaxHi=Math.max(wMaxHi,w); }
}
wSpreadLo=isFinite(wMinLo)?wMaxLo-wMinLo:0;
wSpreadHi=isFinite(wMinHi)?wMaxHi-wMinHi:0;
}
const heelAtMin = wSpreadLo >= wSpreadHi;
// Per-vertex blend: topW (side wall=0, flat top=1) x foreW (heel=0, toe=1)
const vertWeight = new Float32Array(vertCount);
for (let v=0; v<vertCount; v++) {
const nUp=nUpOf(v); if (nUp<0.05) continue;
const topT=Math.max(0,Math.min(1,(nUp-0.05)/0.60));
const topW=topT*topT*(3-2*topT);
const tLen=heelAtMin?(lOf(v)-lMin)/lenSpan:(lMax-lOf(v))/lenSpan;
const foreT=Math.max(0,Math.min(1,(tLen-0.40)/0.28));
const foreW=foreT*foreT*(3-2*foreT);
vertWeight[v]=topW*foreW;
}
// Global per-bin reference height
const nBins=32;
const refHSum=new Float64Array(nBins);
const refHWgt=new Float64Array(nBins);
for (let v=0; v<vertCount; v++) {
const w=vertWeight[v]; if (w<0.01) continue;
const tLen=heelAtMin?(lOf(v)-lMin)/lenSpan:(lMax-lOf(v))/lenSpan;
const bin=Math.max(0,Math.min(nBins-1,Math.floor(tLen*nBins)));
refHSum[bin]+=hOf(v)*w; refHWgt[bin]+=w;
}
const EMPTY=-1e30;
const refH=new Float64Array(nBins);
for (let i=0;i<nBins;i++) refH[i]=refHWgt[i]>0?refHSum[i]/refHWgt[i]:EMPTY;
for (let i=1;i<nBins;i++) if (refH[i]===EMPTY) refH[i]=refH[i-1];
for (let i=nBins-2;i>=0;i--) if (refH[i]===EMPTY) refH[i]=refH[i+1];
for (let pass=0;pass<8;pass++) {
const tmp=refH.slice();
for (let i=1;i<nBins-1;i++) refH[i]=(tmp[i-1]+2*tmp[i]+tmp[i+1])/4;
}
// Blend toward reference
for (let v=0; v<vertCount; v++) {
const w=vertWeight[v]; if (w<0.001) continue;
const tLen=heelAtMin?(lOf(v)-lMin)/lenSpan:(lMax-lOf(v))/lenSpan;
const binF=tLen*nBins;
const bin0=Math.max(0,Math.min(nBins-1,Math.floor(binF)));
const bin1=Math.min(nBins-1,bin0+1);
const frac=binF-Math.floor(binF);
const hRef=refH[bin0]*(1-frac)+refH[bin1]*frac;
posArr[v*3+hAxisIdx]+=w*0.94*(hRef-posArr[v*3+hAxisIdx]);
}
posAttr.needsUpdate=true;
geometry.computeVertexNormals();
return geometry;
}`;

const patched = src.slice(0, commentStart) + REPLACEMENT + src.slice(endSentinel);
fs.writeFileSync(file, patched, 'utf8');
console.log('Patched. Length:', patched.length);

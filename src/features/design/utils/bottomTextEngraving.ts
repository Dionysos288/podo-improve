import type { Font } from 'opentype.js';
import * as opentype from 'opentype.js';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildExtrudedTextGeometry } from '@/src/features/design/utils/bottomTextShapes';

let fontPromise: Promise<Font> | null = null;
let evaluatorSingleton: Evaluator | null = null;

function engraveWarn(side: 'left' | 'right' | undefined, message: string, detail?: Record<string, unknown>) {
	const prefix = side ? `[bottomTextEngrave:${side}]` : '[bottomTextEngrave]';
	if (detail && Object.keys(detail).length > 0) console.warn(prefix, message, detail);
	else console.warn(prefix, message);
}

export function loadEngravingFont(): Promise<Font> {
	if (typeof window === 'undefined') {
		return Promise.reject(new Error('Font load is browser-only'));
	}
	if (!fontPromise) {
		fontPromise = fetch('/fonts/engraving.ttf')
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to load engraving font: ${res.status}`);
				return res.arrayBuffer();
			})
			.then((buf) => opentype.parse(buf));
	}
	return fontPromise;
}

function getEvaluator(): Evaluator {
	if (!evaluatorSingleton) {
		evaluatorSingleton = new Evaluator();
	}
	// Default ['position','uv','normal'] makes initFromGeometry read `uv` from the *first* brush.
	// STL / corrected insoles often have no UVs → undefined.array crash inside three-bvh-csg.
	// Re-apply on each call so HMR cannot leave a stale evaluator.
	evaluatorSingleton.attributes = ['position', 'normal'];
	return evaluatorSingleton;
}

/** CSG lib expects position + normal on both operands (see Evaluator.attributes). */
function prepareGeometryForCsg(geometry: THREE.BufferGeometry): void {
	if (!geometry.getAttribute('position')) return;
	if (!geometry.getAttribute('normal')) {
		geometry.computeVertexNormals();
	}
}

export type BottomTextPlacement = {
	thicknessAxis: 'x' | 'y' | 'z';
	baselineAxis: 'x' | 'y' | 'z';
	crossAxis: 'x' | 'y' | 'z';
	centerBaseline: number;
	centerCross: number;
	bottomThicknessValue: number;
	thickInwardSign: 1 | -1;
	baselineForwardSign: 1 | -1;
};

export function computeBottomTextPlacement(
	geometry: THREE.BufferGeometry,
	orientation: 'vertical' | 'horizontal' | undefined
): BottomTextPlacement | null {
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox;
	const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!bbox || !posAttr) return null;

	const size = bbox.getSize(new THREE.Vector3());
	const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
	const sizes = { x: size.x, y: size.y, z: size.z };
	axes.sort((a, b) => sizes[a] - sizes[b]);
	const thicknessAxis = axes[0]!;
	const widthAxis = axes[1]!;
	const lengthAxis = axes[2]!;
	const baselineAxis = orientation === 'horizontal' ? widthAxis : lengthAxis;
	const crossAxis = orientation === 'horizontal' ? lengthAxis : widthAxis;

	const getAxis = (axis: 'x' | 'y' | 'z', index: number) =>
		axis === 'x' ? posAttr.getX(index) : axis === 'y' ? posAttr.getY(index) : posAttr.getZ(index);

	const baselineMin = baselineAxis === 'x' ? bbox.min.x : baselineAxis === 'y' ? bbox.min.y : bbox.min.z;
	const baselineMax = baselineAxis === 'x' ? bbox.max.x : baselineAxis === 'y' ? bbox.max.y : bbox.max.z;
	const baselineSpan = Math.max(1e-6, baselineMax - baselineMin);
	const endSlice = baselineSpan * 0.03;
	let minEndMinCross = Number.POSITIVE_INFINITY;
	let minEndMaxCross = Number.NEGATIVE_INFINITY;
	let minEndCount = 0;
	let maxEndMinCross = Number.POSITIVE_INFINITY;
	let maxEndMaxCross = Number.NEGATIVE_INFINITY;
	let maxEndCount = 0;

	for (let i = 0; i < posAttr.count; i++) {
		const baselineValue = getAxis(baselineAxis, i);
		const crossValue = getAxis(crossAxis, i);
		if (baselineValue <= baselineMin + endSlice) {
			minEndMinCross = Math.min(minEndMinCross, crossValue);
			minEndMaxCross = Math.max(minEndMaxCross, crossValue);
			minEndCount++;
		}
		if (baselineValue >= baselineMax - endSlice) {
			maxEndMinCross = Math.min(maxEndMinCross, crossValue);
			maxEndMaxCross = Math.max(maxEndMaxCross, crossValue);
			maxEndCount++;
		}
	}

	const minEndSpan = minEndCount > 10 ? Math.max(0, minEndMaxCross - minEndMinCross) : Number.POSITIVE_INFINITY;
	const maxEndSpan = maxEndCount > 10 ? Math.max(0, maxEndMaxCross - maxEndMinCross) : Number.POSITIVE_INFINITY;
	const heelAtMin = minEndSpan <= maxEndSpan;
	const centerBaseline = heelAtMin ? baselineMin + baselineSpan * 0.54 : baselineMax - baselineSpan * 0.54;
	const centerCross =
		crossAxis === 'x'
			? (bbox.min.x + bbox.max.x) * 0.5
			: crossAxis === 'y'
				? (bbox.min.y + bbox.max.y) * 0.5
				: (bbox.min.z + bbox.max.z) * 0.5;

	const bottomThicknessValue =
		thicknessAxis === 'x' ? bbox.min.x : thicknessAxis === 'y' ? bbox.min.y : bbox.min.z;
	const thickMax =
		thicknessAxis === 'x' ? bbox.max.x : thicknessAxis === 'y' ? bbox.max.y : bbox.max.z;
	const thickInwardSign: 1 | -1 = thickMax >= bottomThicknessValue ? 1 : -1;

	const baselineForwardSign: 1 | -1 = heelAtMin ? 1 : -1;

	return {
		thicknessAxis,
		baselineAxis,
		crossAxis,
		centerBaseline,
		centerCross,
		bottomThicknessValue,
		thickInwardSign,
		baselineForwardSign,
	};
}

function placementToWorldMatrix(placement: BottomTextPlacement, mmToWorld: number): THREE.Matrix4 {
	const thickIn = new THREE.Vector3();
	thickIn[placement.thicknessAxis] = placement.thickInwardSign;

	const baseFwd = new THREE.Vector3();
	baseFwd[placement.baselineAxis] = placement.baselineForwardSign;

	const crossVec = new THREE.Vector3();
	crossVec[placement.crossAxis] = 1;

	const origin = new THREE.Vector3();
	origin[placement.baselineAxis] = placement.centerBaseline;
	origin[placement.crossAxis] = placement.centerCross;
	origin[placement.thicknessAxis] = placement.bottomThicknessValue;

	const eps = Math.max(1e-7, mmToWorld * 0.02);
	origin.addScaledVector(thickIn, -eps);

	const basis = new THREE.Matrix4().makeBasis(baseFwd, crossVec, thickIn);
	const pos = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z);
	return pos.multiply(basis);
}

export function validateEngravedGeometry(geom: THREE.BufferGeometry): { ok: boolean; reason?: string } {
	const pos = geom.getAttribute('position');
	if (!pos || pos.count < 12) return { ok: false, reason: 'too_few_vertices' };

	const arr = pos.array as ArrayLike<number>;
	for (let i = 0; i < arr.length; i++) {
		const v = arr[i];
		if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: 'nan_vertex' };
	}

	const idx = geom.index;
	if (idx) {
		const ia = idx.array as ArrayLike<number>;
		for (let i = 0; i < ia.length; i++) {
			const v = ia[i];
			if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: 'bad_index' };
		}
	}

	geom.computeBoundingBox();
	const bb = geom.boundingBox;
	if (!bb) return { ok: false, reason: 'empty_bbox' };
	const sz = new THREE.Vector3();
	bb.getSize(sz);
	if (sz.lengthSq() < 1e-16) return { ok: false, reason: 'degenerate_bbox' };

	return { ok: true };
}

export type BottomTextEngraveParams = {
	text: string;
	sizeMm: number;
	depthMm: number;
	mmToWorld: number;
	orientation?: 'vertical' | 'horizontal';
	font: Font;
	/** Passed from viewer so console diagnostics name the mesh */
	debugSide?: 'left' | 'right';
};

export function engraveTextIntoInsole(
	insoleGeometry: THREE.BufferGeometry,
	params: BottomTextEngraveParams
): THREE.BufferGeometry | null {
	const side = params.debugSide;
	const trimmed = params.text.trim();
	if (!trimmed) return null;

	const posAttr = insoleGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	const insoleVertices = posAttr?.count ?? 0;

	const placement = computeBottomTextPlacement(insoleGeometry, params.orientation);
	if (!placement) {
		engraveWarn(side, 'computeBottomTextPlacement returned null (cannot place text on mesh)', {
			insoleVertices,
			textPreview: trimmed.slice(0, 48),
		});
		return null;
	}

	const fontSizeWorld = Math.max(1e-6, params.sizeMm * params.mmToWorld);
	const depthWorld = Math.max(1e-6, params.depthMm * params.mmToWorld);

	const textGeom = buildExtrudedTextGeometry(params.font, trimmed, fontSizeWorld, depthWorld);
	if (!textGeom) {
		engraveWarn(side, 'buildExtrudedTextGeometry returned null (font/glyphs/extrude produced nothing)', {
			textPreview: trimmed.slice(0, 48),
			fontSizeWorld,
			depthWorld,
			sizeMm: params.sizeMm,
			depthMm: params.depthMm,
		});
		return null;
	}
	prepareGeometryForCsg(textGeom);

	const work = insoleGeometry.clone();
	prepareGeometryForCsg(work);

	const textBrush = new Brush(textGeom, new THREE.MeshStandardMaterial());
	const textMatrix = placementToWorldMatrix(placement, params.mmToWorld);
	textBrush.applyMatrix4(textMatrix);
	textBrush.updateMatrixWorld(true);

	const insoleBrush = new Brush(work, new THREE.MeshStandardMaterial());
	insoleBrush.updateMatrixWorld(true);

	let resultGeom: THREE.BufferGeometry | null = null;
	try {
		const evaluator = getEvaluator();
		const resultBrush = evaluator.evaluate(insoleBrush, textBrush, SUBTRACTION);
		resultGeom = mergeVertices(resultBrush.geometry.clone(), 1e-5);
		resultGeom.computeVertexNormals();
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		engraveWarn(side, 'BVH CSG subtraction threw', {
			error: errMsg,
			textPreview: trimmed.slice(0, 48),
			insoleVertices,
			fontSizeWorld,
			depthWorld,
		});
		if (err instanceof Error && err.stack) console.warn(err.stack);
		resultGeom = null;
	} finally {
		textGeom.dispose();
		insoleBrush.geometry.dispose();
		if (Array.isArray(textBrush.material)) textBrush.material.forEach((m) => m.dispose());
		else textBrush.material.dispose();
		if (Array.isArray(insoleBrush.material)) insoleBrush.material.forEach((m) => m.dispose());
		else insoleBrush.material.dispose();
	}

	return resultGeom;
}

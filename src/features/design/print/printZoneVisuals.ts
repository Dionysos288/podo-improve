import * as THREE from 'three';
import {
	getAxisValue,
	getGeometryAxes,
	getMaxForAxis,
	getMinForAxis,
} from '@/src/features/design/utils/geometryAxes';
import type { PrintZoneId } from '@/src/features/design/print/printZones';
import { T_BACK_UPPER, T_MIDDLE_UPPER } from '@/src/features/design/print/printZones';

/** Cached per-vertex normalized heel→toe (0 = heel, 1 = toe) */
export const PRINT_HEEL_TOE_ATTR = '_printHeelToeT';

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/** Soft partition into back/middle/front weights summing ~1 */
export function zoneBlendWeightsFromT(t: number): { back: number; middle: number; front: number } {
	const bw = 0.04;
	const blendToMid = smoothstep(T_BACK_UPPER - bw, T_BACK_UPPER + bw, t);
	const blendToFront = smoothstep(T_MIDDLE_UPPER - bw, T_MIDDLE_UPPER + bw, t);
	const back = Math.max(0, 1 - blendToMid);
	const front = blendToFront;
	const middle = Math.max(0, blendToMid * (1 - blendToFront));
	const sum = back + middle + front;
	if (sum < 1e-8) return { back: 1 / 3, middle: 1 / 3, front: 1 / 3 };
	return { back: back / sum, middle: middle / sum, front: front / sum };
}

/**
 * Vertex colors are written as the natural insole color outside the active zone,
 * and a darkened version inside it. This keeps the rest of the insole looking
 * the same and just darkens the hovered/selected region.
 */
/** Brightness multiplier at the center of the selected zone */
const SELECTED_DARKEN = 0.5;
/** Brightness multiplier at the center of a hovered (non-selected) zone */
const HOVER_DARKEN = 0.78;
/** Fallback base color when the caller doesn't supply one */
const DEFAULT_BASE_COLOR_HEX = '#e2e6ec';

export type PrintSplitVisualState = {
	hoveredZone: PrintZoneId | null;
	selectedZone: PrintZoneId | null;
	/** Material color the insole renders in when no zone is active (hex or THREE.Color). */
	baseColor?: string | THREE.Color;
};

/** Build or refresh per-vertex heel→toe when geometry positions change */
export function ensurePrintHeelToeAttribute(geometry: THREE.BufferGeometry): void {
	const positions = geometry.attributes.position as THREE.BufferAttribute | undefined;
	if (!positions?.count) return;

	const existing = geometry.getAttribute(PRINT_HEEL_TOE_ATTR) as
		| THREE.BufferAttribute
		| undefined;
	if (existing?.count === positions.count) {
		const cachedVersion = geometry.userData._printHeelToePosVersion as number | undefined;
		if (cachedVersion === positions.version) return;
	}

	// Match agent.mjs `resolveHardnessRegion` and `resolvePrintZoneFromLocalPoint`:
	// raw T with lengthMin = heel = back, no wider-end flip.
	const { lengthAxis, bbox, lengthSpan } = getGeometryAxes(geometry);
	const minLength = getMinForAxis(bbox, lengthAxis);
	const maxLength = getMaxForAxis(bbox, lengthAxis);
	const span = Math.max(1e-6, lengthSpan || maxLength - minLength);

	const arr = new Float32Array(positions.count);
	for (let i = 0; i < positions.count; i++) {
		const lv = getAxisValue(positions, i, lengthAxis);
		const raw = (lv - minLength) / span;
		arr[i] = Math.max(0, Math.min(1, raw));
	}
	geometry.setAttribute(PRINT_HEEL_TOE_ATTR, new THREE.Float32BufferAttribute(arr, 1));
	geometry.userData._printHeelToePosVersion = positions.version;
}

export function removePrintPrepAttributes(geometry: THREE.BufferGeometry): void {
	geometry.deleteAttribute(PRINT_HEEL_TOE_ATTR);
}

function weightOf(zone: PrintZoneId, w: { back: number; middle: number; front: number }): number {
	return zone === 'back' ? w.back : zone === 'middle' ? w.middle : w.front;
}

/**
 * Writes `color` buffer for MeshStandardMaterial vertexColors —
 * idle split mode stays visually neutral elsewhere (caller skips this when idle).
 */
export function applyPrintSplitZoneColors(
	geometry: THREE.BufferGeometry,
	state: PrintSplitVisualState,
): void {
	ensurePrintHeelToeAttribute(geometry);

	const heelToeAttr = geometry.getAttribute(PRINT_HEEL_TOE_ATTR) as THREE.BufferAttribute;
	const count = heelToeAttr.count;

	const existing = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
	let colors: Float32Array;
	if (
		existing &&
		existing.array instanceof Float32Array &&
		existing.itemSize === 3 &&
		existing.count === count
	) {
		colors = existing.array as Float32Array;
	} else {
		colors = new Float32Array(count * 3);
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	}

	const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;

	const hovered = state.hoveredZone;
	const selected = state.selectedZone;
	const base = new THREE.Color(state.baseColor ?? DEFAULT_BASE_COLOR_HEX);

	// Avoid a black flash when vertexColors turns on before the first darken pass
	for (let i = 0; i < count; i++) {
		colors[i * 3] = base.r;
		colors[i * 3 + 1] = base.g;
		colors[i * 3 + 2] = base.b;
	}

	for (let i = 0; i < count; i++) {
		const t = heelToeAttr.getX(i);
		const zw = zoneBlendWeightsFromT(t);

		let mul = 1;
		if (selected != null) {
			const sw = THREE.MathUtils.clamp(weightOf(selected, zw), 0, 1);
			mul = THREE.MathUtils.lerp(mul, SELECTED_DARKEN, sw);
			if (hovered != null && hovered !== selected) {
				const hw = THREE.MathUtils.clamp(weightOf(hovered, zw), 0, 1);
				mul = THREE.MathUtils.lerp(mul, HOVER_DARKEN, hw * 0.5);
			}
		} else if (hovered != null) {
			const hw = THREE.MathUtils.clamp(weightOf(hovered, zw), 0, 1);
			mul = THREE.MathUtils.lerp(mul, HOVER_DARKEN, hw);
		}

		colors[i * 3] = base.r * mul;
		colors[i * 3 + 1] = base.g * mul;
		colors[i * 3 + 2] = base.b * mul;
	}

	colorAttr.needsUpdate = true;
}

import * as THREE from 'three';
import { createHeelToToeMapper, getGeometryAxes } from '@/src/features/design/utils/geometryAxes';

export type PrintZoneId = 'front' | 'middle' | 'back';

/** Must match thresholds in agent/print-agent/agent.mjs resolveHardnessRegion */
export const T_MIDDLE_UPPER = 0.55;
export const T_BACK_UPPER = 0.25;

export const PRINT_ZONES = [
	{
		id: 'back' as const,
		labelShort: 'Achter',
		labelLong: 'Achtervoet',
		minT: 0,
		maxT: T_BACK_UPPER,
	},
	{
		id: 'middle' as const,
		labelShort: 'Midden',
		labelLong: 'Middenvoet',
		minT: T_BACK_UPPER,
		maxT: T_MIDDLE_UPPER,
	},
	{
		id: 'front' as const,
		labelShort: 'Voor',
		labelLong: 'Voorvoet',
		minT: T_MIDDLE_UPPER,
		maxT: 1,
	},
] as const;

export function printZoneFromT(t: number): PrintZoneId {
	const clamped = Math.max(0, Math.min(1, t));
	if (clamped > T_MIDDLE_UPPER) return 'front';
	if (clamped > T_BACK_UPPER) return 'middle';
	return 'back';
}

export function resolvePrintZoneFromLocalPoint(
	geometry: THREE.BufferGeometry,
	localPoint: THREE.Vector3,
): PrintZoneId {
	const positions = geometry.attributes.position as THREE.BufferAttribute | undefined;
	if (!positions?.count) return 'middle';

	const { lengthAxis, widthAxis, bbox, lengthSpan } = getGeometryAxes(geometry);
	const heelToToe = createHeelToToeMapper({
		positions,
		lengthAxis,
		widthAxis,
		bbox,
		lengthSpan,
	});

	let lengthVal: number;
	if (lengthAxis === 'x') lengthVal = localPoint.x;
	else if (lengthAxis === 'y') lengthVal = localPoint.y;
	else lengthVal = localPoint.z;

	const t = heelToToe.getT(lengthVal);
	return printZoneFromT(t);
}

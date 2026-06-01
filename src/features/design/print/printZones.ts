import * as THREE from 'three';
import {
	getGeometryAxes,
	getMaxForAxis,
	getMinForAxis,
} from '@/src/features/design/utils/geometryAxes';
import type { LengthAxisName } from '@/src/features/design/utils/geometryAxes';

export type PrintZoneId = 'front' | 'middle' | 'back';

export const PRINT_ZONE_HIT_CACHE_KEY = '_printZoneHitMapperCache';

export type CachedPrintZoneHitMapper = {
	version: number;
	lengthAxis: LengthAxisName;
	heelToToe: { getT: (lengthVal: number) => number };
};

/**
 * Compute heel→toe T for the print zone path. We deliberately do NOT use the
 * wider-end heuristic from `createHeelToToeMapper` here — the print agent
 * (agent/print-agent/agent.mjs `resolveHardnessRegion`) uses raw T with the
 * convention `lengthMin = heel = back`, so the viewer must agree or the
 * highlighted zone won't match the printed hardness region.
 *
 * In the viewer's local space the heel cup tapers wider than the heel base,
 * which made the wider-end heuristic flip the direction and label the heel
 * as "voorvoet". Using raw T keeps viewer + agent + user expectation aligned.
 */
function makePrintHeelToToeMapper(
	bbox: THREE.Box3,
	lengthAxis: LengthAxisName,
	lengthSpan: number,
): { getT: (lengthVal: number) => number } {
	const lengthMin = getMinForAxis(bbox, lengthAxis);
	const lengthMax = getMaxForAxis(bbox, lengthAxis);
	const span = Math.max(1e-6, lengthSpan || lengthMax - lengthMin);
	return {
		getT: (lengthVal: number) => {
			const raw = (lengthVal - lengthMin) / span;
			return Math.max(0, Math.min(1, raw));
		},
	};
}

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

	const posVersion = positions.version;
	let cache =
		geometry.userData[PRINT_ZONE_HIT_CACHE_KEY] as CachedPrintZoneHitMapper | undefined;
	if (!cache || cache.version !== posVersion) {
		const { lengthAxis, bbox, lengthSpan } = getGeometryAxes(geometry);
		const heelToToe = makePrintHeelToToeMapper(bbox, lengthAxis, lengthSpan);
		cache = { version: posVersion, lengthAxis, heelToToe };
		geometry.userData[PRINT_ZONE_HIT_CACHE_KEY] = cache;
	}

	let lengthVal: number;
	const { lengthAxis } = cache;
	if (lengthAxis === 'x') lengthVal = localPoint.x;
	else if (lengthAxis === 'y') lengthVal = localPoint.y;
	else lengthVal = localPoint.z;

	const t = cache.heelToToe.getT(lengthVal);
	return printZoneFromT(t);
}

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	PRINT_ZONE_HIT_CACHE_KEY,
	printZoneFromT,
	resolvePrintZoneFromLocalPoint,
} from '@/src/features/design/print/printZones';

describe('printZoneFromT', () => {
	it('classifies thresholds like print agent (>0.55 front, >0.25 middle)', () => {
		expect(printZoneFromT(0)).toBe('back');
		expect(printZoneFromT(0.2)).toBe('back');
		expect(printZoneFromT(0.25)).toBe('back');
		expect(printZoneFromT(0.4)).toBe('middle');
		expect(printZoneFromT(0.55)).toBe('middle');
		expect(printZoneFromT(0.56)).toBe('front');
		expect(printZoneFromT(1)).toBe('front');
	});
});

describe('resolvePrintZoneFromLocalPoint', () => {
	function makeThinBoxAlongY(mm = 260): THREE.BufferGeometry {
		const verts: number[] = [];
		verts.push(
			0, 0, 0,
			10, mm, 0,
			0, mm, 5,
			10, mm, 5,
			0, 0, 5,
			10, 0, 5,
			0, mm / 2, 20,
			10, mm / 2, 20,
		);
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		return g;
	}

	it('classifies by raw T along the longest axis: lengthMin = back (heel), lengthMax = front (toe)', () => {
		const g = makeThinBoxAlongY();
		expect(resolvePrintZoneFromLocalPoint(g, new THREE.Vector3(5, 5, 2))).toBe('back');
		expect(resolvePrintZoneFromLocalPoint(g, new THREE.Vector3(5, 260 * 0.9, 2))).toBe('front');
	});

	it('mapper cache refreshes when position BufferAttribute version increments', () => {
		const g = makeThinBoxAlongY();
		const fore = new THREE.Vector3(5, 260 * 0.9, 2);
		const zoneFirst = resolvePrintZoneFromLocalPoint(g, fore);
		const positions = g.attributes.position as THREE.BufferAttribute;
		const cache1 = g.userData[PRINT_ZONE_HIT_CACHE_KEY] as { version: number };
		expect(cache1.version).toBe(positions.version);
		positions.needsUpdate = true;
		expect(positions.version).toBeGreaterThan(cache1.version);
		resolvePrintZoneFromLocalPoint(g, fore);
		const cache2 = g.userData[PRINT_ZONE_HIT_CACHE_KEY] as { version: number };
		expect(cache2.version).toBe(positions.version);
		expect(resolvePrintZoneFromLocalPoint(g, fore)).toBe(zoneFirst);
	});
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	computeOverlayTopSurfaceAlignOffset,
	computeOverlayRestingPose,
	robustPercentile,
	DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
	DEFAULT_SINK_BIAS_MM,
	percentileSorted,
	type OverlayRestingPose,
} from '@/src/features/design/utils/scanOverlayAlignment';

const worldUp = new THREE.Vector3(0, 1, 0);
const baseOpts = { mmToWorld: 0.4, maxDeltaWorld: 100 } as const;

// Mirrors OVERLAY_MESH_ROT inside scanOverlayAlignment so tests can place scan
// vertices at known WORLD positions (geom = rot^-1 * world).
const OVERLAY_MESH_ROT = new THREE.Matrix4().makeRotationFromEuler(
	new THREE.Euler(Math.PI / 2, 0, Math.PI),
);
const OVERLAY_MESH_ROT_INV = OVERLAY_MESH_ROT.clone().invert();

/**
 * Insole grid. Height is encoded in geom Z (which becomes world Y after the
 * function's INSOLE_SCENE_ROT). `heightForY(worldZ)` lets a test raise part of
 * the footprint (support) while the rest stays neutral.
 *
 * Footprint: world X in [-20, 20], world Z in [-100, 100].
 */
const INSOLE_BOTTOM_Y = -10;

function makeInsole(heightForWorldZ: (worldZ: number) => number, nx = 14, ny = 14) {
	const positions: number[] = [];
	const normals: number[] = [];
	for (let ix = 0; ix < nx; ix++) {
		for (let iy = 0; iy < ny; iy++) {
			const gx = -20 + (40 * ix) / (nx - 1);
			const gy = -100 + (200 * iy) / (ny - 1);
			const worldZ = -gy; // world Z = -geomY
			const gz = heightForWorldZ(worldZ); // world Y = geomZ
			positions.push(gx, gy, gz);
			normals.push(0, 0, 1); // top-facing
			// matching bottom surface so the insole has real thickness below neutral
			positions.push(gx, gy, INSOLE_BOTTOM_Y);
			normals.push(0, 0, -1); // bottom-facing
		}
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	return geom;
}

/** Flat-ish scan plane placed at a known world Y, with optional per-vertex jitter. */
function makeScanPlane(worldY: number, jitter = 0, nx = 12, ny = 12) {
	const positions: number[] = [];
	const w = new THREE.Vector3();
	for (let ix = 0; ix < nx; ix++) {
		for (let iy = 0; iy < ny; iy++) {
			const wx = -18 + (36 * ix) / (nx - 1);
			const wz = -95 + (190 * iy) / (ny - 1);
			// deterministic pseudo-noise
			const n = jitter * Math.sin(ix * 12.9898 + iy * 78.233);
			w.set(wx, worldY + n, wz).applyMatrix4(OVERLAY_MESH_ROT_INV);
			positions.push(w.x, w.y, w.z);
		}
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geom;
}

const identityReg = { matrix: new THREE.Matrix4().identity(), valid: true };

describe('percentileSorted', () => {
	it('returns percentile from sorted floats', () => {
		const a = new Float32Array([1, 2, 3, 4, 5]);
		expect(percentileSorted(a, 0)).toBeCloseTo(1);
		expect(percentileSorted(a, 1)).toBeCloseTo(5);
		expect(percentileSorted(a, 0.5)).toBeCloseTo(3);
	});
});

describe('robustPercentile', () => {
	it('is order-stable and winsorizes extreme outliers', () => {
		const clean = Array.from({ length: 200 }, (_, i) => i / 199); // 0..1
		const withOutliers = clean.slice();
		withOutliers[0] = -1e6;
		withOutliers[withOutliers.length - 1] = 1e6;
		// Median essentially unchanged despite huge spikes.
		expect(robustPercentile(withOutliers, 0.5)).toBeCloseTo(robustPercentile(clean, 0.5), 2);
		// Extreme percentile is clamped into the winsor band, never the spike.
		expect(robustPercentile(withOutliers, 1)).toBeLessThan(2);
		expect(robustPercentile(withOutliers, 0)).toBeGreaterThan(-2);
	});

	it('is deterministic for identical inputs', () => {
		const v = Array.from({ length: 137 }, (_, i) => Math.sin(i));
		expect(robustPercentile(v, 0.3)).toBe(robustPercentile(v, 0.3));
	});
});

describe('computeOverlayTopSurfaceAlignOffset', () => {
	it('returns zero when geometry is missing', () => {
		const m = new THREE.Matrix4().identity();
		const out = computeOverlayTopSurfaceAlignOffset(null, null, { matrix: m }, worldUp);
		expect(out.length()).toBe(0);
	});

	it('still aligns when registration is marked invalid but matrix is usable', () => {
		const insole = makeInsole(() => 0);
		insole.computeVertexNormals();
		const scan = makeScanPlane(-4);
		const out = computeOverlayTopSurfaceAlignOffset(
			insole,
			scan,
			{ matrix: new THREE.Matrix4().identity(), valid: false },
			worldUp,
			{
				...baseOpts,
				embedScanHeightFraction: DEFAULT_EMBED_SCAN_HEIGHT_FRACTION,
				sinkBiasMm: DEFAULT_SINK_BIAS_MM,
			},
		);
		expect(Number.isFinite(out.y)).toBe(true);
	});

	it('is fully deterministic for identical inputs', () => {
		const insole = makeInsole((z) => (z > 0 ? 4 : 0));
		const scan = makeScanPlane(0, 0.4);
		const a = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, baseOpts);
		const b = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, baseOpts);
		expect(a.y).toBe(b.y);
	});

	it('two similar scans produce near-equal embed depths (same method)', () => {
		const insole = makeInsole((z) => (z > 0 ? 4 : 0));
		const scanA = makeScanPlane(0, 0.3);
		// Same scan with tiny lateral shift + different jitter phase => still comparable.
		const scanB = makeScanPlane(0.2, 0.35);
		const a = computeOverlayTopSurfaceAlignOffset(insole, scanA, identityReg, worldUp, baseOpts);
		const b = computeOverlayTopSurfaceAlignOffset(insole, scanB, identityReg, worldUp, baseOpts);
		expect(Math.abs(a.y - b.y)).toBeLessThan(baseOpts.mmToWorld * 2);
	});

	it('hides raised (support) regions while keeping neutral regions visible', () => {
		const supportHeight = 4; // world units above neutral
		// Heel half (world Z < 0) raised; forefoot half neutral.
		const insole = makeInsole((z) => (z < 0 ? supportHeight : 0));
		const scan = makeScanPlane(0);
		const out = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0,
			sinkBiasMm: 0,
		});
		const scanSurfaceY = 0 + out.y; // scan plantar sits at world Y 0 + delta
		const neutralShellY = 0;
		const raisedShellY = supportHeight;
		const eps = baseOpts.mmToWorld * 0.25;
		// Neutral region: shell at/under scan => visible skin.
		expect(neutralShellY).toBeLessThanOrEqual(scanSurfaceY + eps);
		// Raised region: shell rises above scan => occluded (hidden).
		expect(raisedShellY).toBeGreaterThan(scanSurfaceY);
	});

	it('embedding fraction sinks more than shallow embed (numerically lower delta)', () => {
		const insole = makeInsole((z) => (z > 0 ? 6 : 0));
		const scan = makeScanPlane(0);
		const deep = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0.6,
			sinkBiasMm: 0,
		});
		const shallow = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0.06,
			sinkBiasMm: 0,
		});
		expect(deep.y).toBeLessThan(shallow.y);
	});

	it('extra sink bias mm shifts further down than zero bias', () => {
		const insole = makeInsole((z) => (z > 0 ? 6 : 0));
		const scan = makeScanPlane(0);
		const withBias = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0.3,
			sinkBiasMm: 3,
		});
		const noBias = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0.3,
			sinkBiasMm: 0,
		});
		expect(withBias.y).toBeLessThan(noBias.y);
	});

	it('respects vertical clamp magnitude', () => {
		const insole = makeInsole((z) => (z > 0 ? 6 : 0));
		// Large vertical offset => raw delta far exceeds the clamp.
		const scan = makeScanPlane(-50);
		const out = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 0,
			sinkBiasMm: 0,
			maxDeltaWorld: 0.5,
		});
		expect(Math.abs(out.y)).toBeLessThanOrEqual(0.5);
	});

	it('never seats the lowest scan point below the insole bottom', () => {
		const insole = makeInsole((z) => (z > 0 ? 4 : 0));
		const scan = makeScanPlane(-40);
		// Aggressive seating that would otherwise push the scan through the bottom.
		const out = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, {
			...baseOpts,
			embedScanHeightFraction: 1,
			sinkBiasMm: 30,
			maxDeltaWorld: 1000,
		});
		// Lowest scan point stays at/above the insole bottom surface.
		expect(-40 + out.y).toBeGreaterThanOrEqual(INSOLE_BOTTOM_Y - baseOpts.mmToWorld);
	});
});

function rotationAboutPivot(
	axis: THREE.Vector3,
	angleRad: number,
	pivot: THREE.Vector3,
) {
	const rot = new THREE.Matrix4().makeRotationAxis(axis.clone().normalize(), angleRad);
	const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
	const fromPivot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
	return fromPivot.multiply(rot).multiply(toPivot);
}

/**
 * Reconstructs the rested world-Y of a flat plantar contact at `worldZ`: seat by
 * `offsetY`, then apply the pitch about the pivot — mirroring the viewer's matrix.
 */
function applyRestPose(pose: OverlayRestingPose, x: number, y: number, z: number): THREE.Vector3 {
	const v = new THREE.Vector3(x, y + pose.offsetY, z);
	v.applyMatrix4(rotationAboutPivot(pose.lateralAxisWorld, pose.pitchRad, pose.pivotWorld));
	if (Math.abs(pose.toeAntiPenPitchRad) > 1e-9) {
		v.applyMatrix4(
			rotationAboutPivot(pose.lateralAxisWorld, pose.toeAntiPenPitchRad, pose.heelPivotWorld),
		);
	}
	if (Math.abs(pose.heelSeatPitchRad) > 1e-9) {
		v.applyMatrix4(
			rotationAboutPivot(pose.lateralAxisWorld, pose.heelSeatPitchRad, pose.toePivotWorld),
		);
	}
	return v;
}

function restedScanYAt(pose: OverlayRestingPose, worldZ: number, plantarY = 0): number {
	return applyRestPose(pose, 0, plantarY, worldZ).y;
}

describe('computeOverlayRestingPose', () => {
	it('is deterministic for identical inputs', () => {
		const insole = makeInsole((z) => 0.05 * z);
		const scan = makeScanPlane(0, 0.3);
		const a = computeOverlayRestingPose(insole, scan, identityReg, worldUp, baseOpts);
		const b = computeOverlayRestingPose(insole, scan, identityReg, worldUp, baseOpts);
		expect(a.offsetY).toBe(b.offsetY);
		expect(a.pitchRad).toBe(b.pitchRad);
	});

	it('keeps pitch ~0 for a flat insole top', () => {
		const insole = makeInsole(() => 0);
		const scan = makeScanPlane(0);
		const pose = computeOverlayRestingPose(insole, scan, identityReg, worldUp, baseOpts);
		expect(Math.abs(pose.pitchRad)).toBeLessThan(0.02);
	});

	it('tilts so both heel and forefoot contacts rest on a sloped insole top', () => {
		// Insole top ramps linearly along the long (Z) axis; scan plantar is flat.
		// Dense, odd-count grids keep the ramp's band medians symmetric.
		const slope = 0.05;
		const insole = makeInsole((z) => slope * z, 14, 61);
		const scan = makeScanPlane(0, 0, 12, 61);
		const pose = computeOverlayRestingPose(insole, scan, identityReg, worldUp, {
			...baseOpts,
			heelDropMm: 0,
			toeLiftMm: 0,
		});
		// A real pitch is applied.
		expect(Math.abs(pose.pitchRad)).toBeGreaterThan(0.01);
		const restNeg = restedScanYAt(pose, -70);
		const restPos = restedScanYAt(pose, 70);
		// Tilt follows the ramp: the +Z contact rests higher than the -Z contact.
		expect(restPos).toBeGreaterThan(restNeg);
		// Both ends land ~on the insole top (slope*z), with no large gap/penetration.
		const tol = baseOpts.mmToWorld * 8;
		expect(Math.abs(restNeg - slope * -70)).toBeLessThan(tol);
		expect(Math.abs(restPos - slope * 70)).toBeLessThan(tol);
	});

	it('clamps an extreme ramp to the maximum pitch', () => {
		const insole = makeInsole((z) => 0.8 * z); // absurdly steep
		const scan = makeScanPlane(0);
		const pose = computeOverlayRestingPose(insole, scan, identityReg, worldUp, baseOpts);
		expect(Math.abs(pose.pitchRad)).toBeLessThanOrEqual(0.5 + 1e-9);
	});

	it('seats the anatomical heel deeper and lifts the toe with bias knobs', () => {
		// Heel end (z>0) is wide; forefoot/toe end (z<0) is narrow in this fixture.
		const positions: number[] = [];
		const normals: number[] = [];
		const nx = 14;
		const ny = 61;
		for (let ix = 0; ix < nx; ix++) {
			for (let iy = 0; iy < ny; iy++) {
				const worldZ = 100 - (200 * iy) / (ny - 1);
				const halfW = worldZ < 0 ? 8 : 20;
				const gx = -halfW + (2 * halfW * ix) / (nx - 1);
				const gy = -worldZ;
				positions.push(gx, gy, 0, gx, gy, INSOLE_BOTTOM_Y);
				normals.push(0, 0, 1, 0, 0, -1);
			}
		}
		const insole = new THREE.BufferGeometry();
		insole.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		insole.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
		const scan = makeScanPlane(0, 0, 12, 61);

		const noBias = computeOverlayRestingPose(insole, scan, identityReg, worldUp, {
			...baseOpts,
			heelDropMm: 0,
			toeLiftMm: 0,
		});
		const biased = computeOverlayRestingPose(insole, scan, identityReg, worldUp, {
			...baseOpts,
			heelDropMm: 3,
			toeLiftMm: 3,
		});
		// Wider +Z end is heel; bias should not raise the heel end.
		expect(restedScanYAt(biased, 70)).toBeLessThanOrEqual(restedScanYAt(noBias, 70));
	});

	it('lifts the toe when a tip dips below the band plantar level', () => {
		const insole = makeInsole(() => 0, 14, 61);
		const scan = makeScanPlane(0, 0, 12, 61);
		const pos = scan.getAttribute('position') as THREE.BufferAttribute;
		const w = new THREE.Vector3();
		for (let i = 0; i < pos.count; i++) {
			w.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(OVERLAY_MESH_ROT);
			if (w.z > 85) {
				w.y -= 2;
				w.applyMatrix4(OVERLAY_MESH_ROT_INV);
				pos.setXYZ(i, w.x, w.y, w.z);
			}
		}

		const pose = computeOverlayRestingPose(insole, scan, identityReg, worldUp, baseOpts);
		let minClearance = Infinity;
		for (let i = 0; i < pos.count; i++) {
			w.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(OVERLAY_MESH_ROT);
			if (w.z <= 85) continue;
			const rested = applyRestPose(pose, w.x, w.y, w.z).y;
			minClearance = Math.min(minClearance, rested - 0);
		}
		expect(minClearance).toBeGreaterThanOrEqual(-baseOpts.mmToWorld * 0.25);
	});

	it('seats a floating heel without moving the toe', () => {
		const insole = makeInsole((z) => 0.05 * z, 14, 61);
		const scan = makeScanPlane(0, 0, 12, 61);
		const seated = computeOverlayRestingPose(insole, scan, identityReg, worldUp, baseOpts);
		const noHeelSeat = { ...seated, heelSeatPitchRad: 0 };
		// Toe end (+Z on equal-width fixture) must stay put when heel seat runs.
		expect(restedScanYAt(seated, 70)).toBeCloseTo(restedScanYAt(noHeelSeat, 70), 0);
		if (Math.abs(seated.heelSeatPitchRad) > 0.001) {
			expect(restedScanYAt(seated, -70)).toBeLessThanOrEqual(restedScanYAt(noHeelSeat, -70));
		}
	});

	it('falls back to a pure vertical seat when pitch is disabled', () => {
		const insole = makeInsole((z) => 0.05 * z);
		const scan = makeScanPlane(0);
		const pose = computeOverlayRestingPose(insole, scan, identityReg, worldUp, {
			...baseOpts,
			disablePitch: true,
		});
		const flat = computeOverlayTopSurfaceAlignOffset(insole, scan, identityReg, worldUp, baseOpts);
		expect(pose.pitchRad).toBe(0);
		expect(pose.offsetY).toBeCloseTo(flat.y, 6);
	});
});

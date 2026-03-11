import * as THREE from 'three';
import type { InsoleSurfaceModel } from './insoleSurfaceModel';
import { VertexZone, AnatomicalRegion } from './insoleSurfaceModel';
import type { DisplacementField } from './constrainedDeformation';

export interface TrimlineProfile {
	halfWidthsWorld: number[];
	lengthWorld: number;
}

export interface TrimlineAdjustments {
	global?: number;
	heel: number;
	midfoot: number;
	forefoot: number;
	toe: number;
}

export interface WidthFitParams {
	side: 'left' | 'right';
	mmToWorld: number;
	trimlineProfile?: TrimlineProfile;
	trimOffsetWorld: number;
	trimlineAdjustments?: TrimlineAdjustments;
	targetForefootWidthWorld?: number;
}

function ss(e0: number, e1: number, v: number): number {
	const t = Math.max(0, Math.min(1, (v - e0) / Math.max(1e-6, e1 - e0)));
	return t * t * (3 - 2 * t);
}

function sampleArray(arr: number[] | Float32Array, t: number): number {
	const tt = Math.max(0, Math.min(1, t));
	const x = tt * (arr.length - 1);
	const i0 = Math.floor(x);
	const i1 = Math.min(arr.length - 1, i0 + 1);
	return arr[i0] + (arr[i1] - arr[i0]) * (x - i0);
}

function buildCurrentProfile(
	pos: THREE.BufferAttribute,
	vertCount: number,
	widthAxis: 'x' | 'y' | 'z',
	lengthAxis: 'x' | 'y' | 'z',
	centerW: number,
	heelAtMin: boolean,
	minLen: number,
	lenSpan: number,
	bins: number,
): Float32Array {
	const raw = new Float32Array(bins);
	const hits = new Uint16Array(bins);
	const maxLen = minLen + lenSpan;
	for (let i = 0; i < vertCount; i++) {
		const lenVal =
			lengthAxis === 'x'
				? pos.getX(i)
				: lengthAxis === 'y'
					? pos.getY(i)
					: pos.getZ(i);
		const hd = heelAtMin ? lenVal - minLen : maxLen - lenVal;
		const t = Math.max(0, Math.min(1, hd / Math.max(1e-6, lenSpan)));
		const idx = Math.min(bins - 1, Math.max(0, Math.round(t * (bins - 1))));
		const wVal =
			widthAxis === 'x'
				? pos.getX(i)
				: widthAxis === 'y'
					? pos.getY(i)
					: pos.getZ(i);
		const hw = Math.abs(wVal - centerW);
		if (hw > raw[idx]) raw[idx] = hw;
		hits[idx]++;
	}

	for (let i = 0; i < bins; i++) {
		if (hits[i] > 0) continue;
		let l = i - 1;
		while (l >= 0 && hits[l] === 0) l--;
		let r = i + 1;
		while (r < bins && hits[r] === 0) r++;
		if (l >= 0 && r < bins) raw[i] = (raw[l] + raw[r]) * 0.5;
		else if (l >= 0) raw[i] = raw[l];
		else if (r < bins) raw[i] = raw[r];
	}

	const smoothed = new Float32Array(bins);
	for (let i = 0; i < bins; i++) {
		const a = raw[Math.max(0, i - 2)];
		const b = raw[Math.max(0, i - 1)];
		const c = raw[i];
		const d = raw[Math.min(bins - 1, i + 1)];
		const e = raw[Math.min(bins - 1, i + 2)];
		smoothed[i] = a * 0.1 + b * 0.2 + c * 0.4 + d * 0.2 + e * 0.1;
	}
	return smoothed;
}

function makeTrimSampler(
	profile: TrimlineProfile,
	offsetWorld: number,
	mmToWorld: number,
	adjustments?: TrimlineAdjustments,
): (t: number) => number {
	return (t: number) => {
		const baseHalf = sampleArray(profile.halfWidthsWorld, t) + offsetWorld;
		if (!adjustments) return baseHalf;
		const { heel, midfoot, forefoot, toe } = adjustments;
		const heelW = 1 - ss(0.22, 0.28, t);
		const midW = ss(0.22, 0.28, t) * (1 - ss(0.52, 0.58, t));
		const foreW = ss(0.52, 0.58, t) * (1 - ss(0.79, 0.85, t));
		const toeW = ss(0.79, 0.85, t);
		const regionOff =
			(heel * heelW + midfoot * midW + forefoot * foreW + toe * toeW) *
			mmToWorld;
		return Math.max(0, baseHalf + regionOff);
	};
}

function computeTrimlineTargets(
	pos: THREE.BufferAttribute,
	vertCount: number,
	axes: { lengthAxis: 'x' | 'y' | 'z'; widthAxis: 'x' | 'y' | 'z' },
	bbox: THREE.Box3,
	heelAtMin: boolean,
	side: 'left' | 'right',
	mmToWorld: number,
	profile: TrimlineProfile,
	offsetWorld: number,
	adjustments?: TrimlineAdjustments,
): Float32Array {
	const { lengthAxis, widthAxis } = axes;
	const minLen = bbox.min[lengthAxis];
	const maxLen = bbox.max[lengthAxis];
	const lenSpan = Math.max(1e-6, maxLen - minLen);
	const centerW = (bbox.min[widthAxis] + bbox.max[widthAxis]) * 0.5;
	const halfW = Math.max(1e-6, (bbox.max[widthAxis] - bbox.min[widthAxis]) * 0.5);
	const medialSign = side === 'left' ? 1 : -1;
	const bins = Math.max(64, profile.halfWidthsWorld.length);

	const currentProfile = buildCurrentProfile(
		pos, vertCount, widthAxis, lengthAxis, centerW, heelAtMin, minLen, lenSpan, bins,
	);
	const sampleCurrent = (t: number) => sampleArray(currentProfile, t);
	const sampleTrim = makeTrimSampler(profile, offsetWorld, mmToWorld, adjustments);

	const sourceFore = Math.max(1e-6, sampleCurrent(0.72), sampleCurrent(0.82), sampleCurrent(0.92));
	const targetFore = Math.max(1e-6, sampleTrim(0.72), sampleTrim(0.82), sampleTrim(0.92));
	const globalScale = Math.max(0.9, Math.min(1.22, targetFore / sourceFore));

	const sourceHeel = Math.max(1e-6, sampleCurrent(0.02), sampleCurrent(0.08), sampleCurrent(0.14));
	const targetHeel = Math.max(1e-6, sampleTrim(0.02), sampleTrim(0.08), sampleTrim(0.14));
	const heelScale = Math.max(0.9, Math.min(1.24, targetHeel / sourceHeel));

	const sourceToePad = Math.max(1e-6, sampleCurrent(0.9), sampleCurrent(0.95), sampleCurrent(0.99));
	const targetToePad = Math.max(1e-6, sampleTrim(0.9), sampleTrim(0.95), sampleTrim(0.99));
	const toeScale = Math.max(0.9, Math.min(1.26, targetToePad / sourceToePad));
	const toeShoulderHalf = Math.max(
		1e-6, sampleCurrent(0.75), sampleCurrent(0.78), sampleCurrent(0.82), sampleCurrent(0.88),
		sampleTrim(0.75), sampleTrim(0.78), sampleTrim(0.82), sampleTrim(0.88),
	);
	const toeTipMinHalf = toeShoulderHalf * 0.38;
	const toeTipMaxHalf = toeShoulderHalf * 0.88;

	const relief = buildReliefFn(centerW, halfW, medialSign, mmToWorld);
	const toeCap = buildToeCapFn(centerW, toeShoulderHalf, toeTipMinHalf, toeTipMaxHalf);

	const targets = new Float32Array(vertCount);
	for (let i = 0; i < vertCount; i++) {
		const lenVal = lengthAxis === 'x' ? pos.getX(i) : lengthAxis === 'y' ? pos.getY(i) : pos.getZ(i);
		const hd = heelAtMin ? lenVal - minLen : maxLen - lenVal;
		const tLen = Math.max(0, Math.min(1, hd / Math.max(1e-6, lenSpan)));
		const srcHW = Math.max(1e-6, sampleCurrent(tLen));
		const tgtHW = Math.max(1e-6, sampleTrim(tLen));
		const rawLocal = Math.max(0.88, Math.min(1.24, tgtHW / srcHW));

		const heelBlend = 1 - ss(0.1, 0.28, tLen);
		const toeBlend = ss(0.78, 0.98, tLen);
		const scaleDelta =
			(globalScale - 1) * 0.45 +
			(rawLocal - 1) * 0.35 +
			(heelScale - 1) * heelBlend * 0.2 +
			(toeScale - 1) * toeBlend * 0.3;
		const localS = 1 + scaleDelta;
		const blend = ss(0.04, 0.99, tLen);
		const noShrinkToe = ss(0.72, 0.98, tLen);
		const noShrinkHeel = 1 - ss(0.04, 0.22, tLen);
		const noShrinkBlend = Math.max(noShrinkToe, noShrinkHeel);
		const minS = 1 - (1 - noShrinkBlend) * 0.03;
		const finalS = Math.max(minS, Math.min(1.3, 1 + (localS - 1) * blend));

		const wVal = widthAxis === 'x' ? pos.getX(i) : widthAxis === 'y' ? pos.getY(i) : pos.getZ(i);
		let w = centerW + (wVal - centerW) * finalS;
		w = relief(w, tLen);
		w = toeCap(w, tLen);

		const maxHalf = tgtHW + 1.5 * mmToWorld;
		const dist = w - centerW;
		const dSign = dist >= 0 ? 1 : -1;
		const absDist = Math.abs(dist);
		const over = Math.max(0, absDist - maxHalf);
		const clampWin = Math.max(0.6 * mmToWorld, maxHalf * 0.08);
		const clampB = ss(0, clampWin, over);
		const clamped = absDist + (maxHalf - absDist) * clampB;
		const toeFill = ss(0.9, 0.998, tLen) * 0.18;
		const filled = clamped + (Math.max(toeTipMinHalf * 0.95, clamped) - clamped) * toeFill;
		targets[i] = centerW + dSign * filled;
	}
	return targets;
}

function buildReliefFn(
	centerW: number, halfW: number, medialSign: number, mmToWorld: number,
): (w: number, tLen: number) => number {
	const toeSym = 0.6 * mmToWorld;
	const hallux = 1.8 * mmToWorld;
	const medHeel = 0.8 * mmToWorld;
	return (w, tLen) => {
		const d = w - centerW;
		const absN = Math.max(0, Math.min(1, Math.abs(d) / halfW));
		const signN = Math.max(-1, Math.min(1, (d / halfW) * medialSign));
		const edgeW = ss(0.22, 1.0, absN);
		const medW = ss(0.08, 0.95, signN);
		const toeW = ss(0.74, 0.995, tLen);
		const halluxW = ss(0.84, 0.998, tLen);
		const heelW = 1 - ss(0.2, 0.42, tLen);
		const sign = d > 0 ? 1 : d < 0 ? -1 : 0;
		return w + sign * toeSym * edgeW * toeW + medialSign * hallux * medW * halluxW + medialSign * medHeel * medW * heelW;
	};
}

function buildToeCapFn(
	centerW: number, shoulder: number, minHalf: number, maxHalf: number,
): (w: number, tLen: number) => number {
	return (w, tLen) => {
		const fillB = ss(0.84, 0.995, tLen);
		const clampB = ss(0.92, 0.998, tLen);
		if (fillB <= 1e-6 && clampB <= 1e-6) return w;
		const u = Math.max(0, Math.min(1, (tLen - 0.78) / 0.22));
		const cap = Math.sqrt(Math.max(0, 1 - u * u));
		const lo = minHalf + (shoulder - minHalf) * cap;
		const hi = maxHalf + (shoulder - maxHalf) * cap;
		const d = w - centerW;
		if (Math.abs(d) < 1e-6) return w;
		const sign = d > 0 ? 1 : -1;
		const abs = Math.abs(d);
		const edgeBand = ss(0.15, 0.85, Math.min(1, abs / Math.max(1e-6, shoulder)));
		if (edgeBand <= 1e-6) return w;
		const fillStr = fillB * (0.08 + edgeBand * 0.12);
		const filled = abs + (Math.max(lo, abs) - abs) * fillStr;
		const clampStr = clampB * edgeBand;
		const corrected = filled + (Math.min(hi, filled) - filled) * clampStr;
		return centerW + sign * corrected;
	};
}

export function computeWidthFitTargets(
	geometry: THREE.BufferGeometry,
	model: InsoleSurfaceModel,
	params: WidthFitParams,
): DisplacementField | null {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos) return null;
	const vertCount = pos.count;
	const { lengthAxis, widthAxis, bbox, widthSpan } = model.axes;
	const heelAtMin = model.heelMapper.heelAtMin;

	let widthTargets: Float32Array | null = null;

	if (params.trimlineProfile && params.trimlineProfile.halfWidthsWorld.length > 1) {
		widthTargets = computeTrimlineTargets(
			pos, vertCount, { lengthAxis, widthAxis }, bbox, heelAtMin,
			params.side, params.mmToWorld, params.trimlineProfile,
			params.trimOffsetWorld, params.trimlineAdjustments,
		);
	} else if (params.targetForefootWidthWorld && params.targetForefootWidthWorld > 0) {
		widthTargets = computeForefootTargets(
			pos, vertCount, model, params.side, params.mmToWorld,
			params.targetForefootWidthWorld,
		);
	}

	if (!widthTargets) return null;

	const targets = new Float32Array(vertCount * 3);
	const weights = new Float32Array(vertCount);
	const budgets = new Float32Array(vertCount);
	const wIdx = widthAxis === 'x' ? 0 : widthAxis === 'y' ? 1 : 2;

	for (let v = 0; v < vertCount; v++) {
		targets[v * 3] = pos.getX(v);
		targets[v * 3 + 1] = pos.getY(v);
		targets[v * 3 + 2] = pos.getZ(v);

		const deformable = model.deformableMask[v] === 1;
		const inProtectedTransition =
			model.topToWallTransition[v] === 1 ||
			model.heelArchTransition[v] === 1 ||
			model.zones[v] === VertexZone.Rim ||
			model.zones[v] === VertexZone.Wall ||
			model.zones[v] === VertexZone.Bottom;

		if (!deformable || inProtectedTransition) {
			targets[v * 3 + wIdx] = wIdx === 0 ? pos.getX(v) : wIdx === 1 ? pos.getY(v) : pos.getZ(v);
			weights[v] = 0;
			budgets[v] = 0;
			continue;
		}

		targets[v * 3 + wIdx] = widthTargets[v];

		const curvAtten = 1 / (1 + model.curvature[v] * 6.0);
		const transAtten = 1 - model.regionTransition[v] * 0.7;
		weights[v] = curvAtten * transAtten;

		const regionScale =
			model.regions[v] === AnatomicalRegion.ArchMidfoot ? 0
			: model.regions[v] === AnatomicalRegion.Heel ? 0
			: 1.0;

		switch (model.zones[v]) {
			case VertexZone.Bottom:
				budgets[v] = 0;
				break;
			case VertexZone.Wall:
				budgets[v] = 0;
				break;
			case VertexZone.Rim:
				budgets[v] = 0;
				break;
			default:
				budgets[v] = widthSpan * 0.12 * regionScale;
				break;
		}
	}

	return { targetPositions: targets, weights, budgets, confidence: 1.0 };
}

function computeForefootTargets(
	pos: THREE.BufferAttribute,
	vertCount: number,
	model: InsoleSurfaceModel,
	side: 'left' | 'right',
	mmToWorld: number,
	targetWidthWorld: number,
): Float32Array {
	const { lengthAxis, widthAxis, bbox } = model.axes;
	const minLen = bbox.min[lengthAxis];
	const maxLen = bbox.max[lengthAxis];
	const lenSpan = Math.max(1e-6, maxLen - minLen);
	const size = bbox.getSize(new THREE.Vector3());
	const centerW = (bbox.min[widthAxis] + bbox.max[widthAxis]) * 0.5;
	const halfW = Math.max(1e-6, (bbox.max[widthAxis] - bbox.min[widthAxis]) * 0.5);
	const heelAtMin = model.heelMapper.heelAtMin;

	const toeStart = heelAtMin ? minLen + lenSpan * 0.55 : maxLen - lenSpan * 0.75;
	const toeEnd = heelAtMin ? minLen + lenSpan * 0.9 : maxLen - lenSpan * 0.4;
	let foreMinW = Infinity, foreMaxW = -Infinity, foreCount = 0;
	for (let i = 0; i < vertCount; i++) {
		const lv = lengthAxis === 'x' ? pos.getX(i) : lengthAxis === 'y' ? pos.getY(i) : pos.getZ(i);
		const inFore = (heelAtMin && lv >= toeStart && lv <= toeEnd) || (!heelAtMin && lv <= toeStart && lv >= toeEnd);
		if (!inFore) continue;
		const wv = widthAxis === 'x' ? pos.getX(i) : widthAxis === 'y' ? pos.getY(i) : pos.getZ(i);
		foreMinW = Math.min(foreMinW, wv);
		foreMaxW = Math.max(foreMaxW, wv);
		foreCount++;
	}
	const curForeW = foreCount > 12 ? Math.max(1e-6, foreMaxW - foreMinW) : Math.max(1e-6, size[widthAxis]);
	const widthScale = Math.max(0.82, Math.min(1.28, targetWidthWorld / curForeW));

	const medialSign = side === 'left' ? 1 : -1;
	const relief = buildReliefFn(centerW, halfW, medialSign, mmToWorld);
	const toeShoulderHalf = Math.max(1e-6, curForeW * 0.5);
	const toeCap = buildToeCapFn(centerW, toeShoulderHalf, toeShoulderHalf * 0.38, toeShoulderHalf * 0.88);

	const targets = new Float32Array(vertCount);
	for (let i = 0; i < vertCount; i++) {
		const lv = lengthAxis === 'x' ? pos.getX(i) : lengthAxis === 'y' ? pos.getY(i) : pos.getZ(i);
		const hd = heelAtMin ? lv - minLen : maxLen - lv;
		const tLen = Math.max(0, Math.min(1, hd / Math.max(1e-6, lenSpan)));
		const blend = ss(0.08, 0.98, tLen);
		const localS = 1 + (widthScale - 1) * blend;
		const noShrinkToe = ss(0.72, 0.98, tLen);
		const noShrinkHeel = 1 - ss(0.04, 0.22, tLen);
		const minS = 1 - (1 - Math.max(noShrinkToe, noShrinkHeel)) * 0.03;
		const safeS = Math.max(minS, localS);

		const wv = widthAxis === 'x' ? pos.getX(i) : widthAxis === 'y' ? pos.getY(i) : pos.getZ(i);
		let w = centerW + (wv - centerW) * safeS;
		w = relief(w, tLen);
		w = toeCap(w, tLen);
		targets[i] = w;
	}
	return targets;
}

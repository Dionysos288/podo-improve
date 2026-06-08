/**
 * ──────────────────────────────────────────────
 *  Conform element to insole surface (zero-gap shrinkwrap)
 *
 *  A reusable, READ-ONLY surface sampler over the insole mesh plus a per-vertex
 *  "seat onto the surface + offset along the surface normal" operation. This is
 *  the standard shrinkwrap (Blender "Nearest Surface Point" / "Project" with an
 *  "Above Surface" offset) implemented on three-mesh-bvh.
 *
 *  Hard guarantee: the insole geometry passed in is NEVER mutated. The BVH is
 *  built on a private clone, so the live insole position/index/normal buffers
 *  are untouched — all fitting happens on the element geometry only.
 * ──────────────────────────────────────────────
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface InsoleSurfaceHit {
	point: THREE.Vector3;
	normal: THREE.Vector3;
	/** Distance from the query/footprint point to the surface hit. */
	distance: number;
}

export interface InsoleSurfaceSampler {
	/** Nearest surface point + interpolated normal to a query point (insole-local). */
	closestPoint(query: THREE.Vector3, out?: InsoleSurfaceHit): InsoleSurfaceHit | null;
	/** First hit casting from above `footprint` straight down the insole up-axis. */
	raycastDown(footprint: THREE.Vector3, out?: InsoleSurfaceHit): InsoleSurfaceHit | null;
	/** Unit vector pointing from the insole interior out through its top surface. */
	readonly upAxis: THREE.Vector3;
	dispose(): void;
}

export type ConformMode = 'auto' | 'nearest' | 'project';

export interface SeatParams {
	/** 'project' = ray down, 'nearest' = closest point, 'auto' = ray then closest. */
	mode?: ConformMode;
	/** Reject hits farther than this from the query (skip the vertex). */
	maxSnapDistance?: number;
}

export interface ConformElementOptions extends SeatParams {
	/** Element height direction, in the SAME space as the sampler (insole-local). */
	upAxis: THREE.Vector3;
	/** Element-local coordinate along upAxis where the contact base sits. */
	baseAlongUp: number;
	/** Multiplier from element-local height to world offset along the surface normal. */
	heightScale?: number;
	/** Tangential smoothing passes on the raised body (base stays on the surface). */
	smoothingSteps?: number;
}

function makeHit(): InsoleSurfaceHit {
	return { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
}

const AXIS_KEYS = ['x', 'y', 'z'] as const;
type AxisKey = (typeof AXIS_KEYS)[number];

function detectUpAxis(geom: THREE.BufferGeometry): { up: THREE.Vector3; rayLift: number } {
	geom.computeBoundingBox();
	const bb = geom.boundingBox!;
	const size = { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z };
	// The insole's thickness is its smallest dimension → that axis is up/down.
	let axis: AxisKey = 'z';
	if (size.x <= size.y && size.x <= size.z) axis = 'x';
	else if (size.y <= size.x && size.y <= size.z) axis = 'y';

	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const nrm = geom.getAttribute('normal') as THREE.BufferAttribute;
	const minA = bb.min[axis];
	const spanA = Math.max(1e-6, bb.max[axis] - minA);
	const thresh = minA + spanA * 0.8;
	let signSum = 0;
	let signCount = 0;
	for (let i = 0; i < pos.count; i++) {
		if (pos.getComponent(i, AXIS_KEYS.indexOf(axis)) >= thresh) {
			signSum += nrm.getComponent(i, AXIS_KEYS.indexOf(axis));
			signCount++;
		}
	}
	const sign = signCount > 0 && signSum / signCount < 0 ? -1 : 1;
	const up = new THREE.Vector3();
	up.setComponent(AXIS_KEYS.indexOf(axis), sign);
	return { up, rayLift: spanA * 2 + 1 };
}

// Module-scope scratch to avoid per-vertex allocation in tight loops.
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _pc = new THREE.Vector3();
const _na = new THREE.Vector3();
const _nb = new THREE.Vector3();
const _nc = new THREE.Vector3();
const _bary = new THREE.Vector3();
const _ray = new THREE.Ray();
const _cpTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };

function barycentric(
	p: THREE.Vector3,
	a: THREE.Vector3,
	b: THREE.Vector3,
	c: THREE.Vector3,
	out: THREE.Vector3,
): void {
	_v0.subVectors(b, a);
	_v1.subVectors(c, a);
	_v2.subVectors(p, a);
	const d00 = _v0.dot(_v0);
	const d01 = _v0.dot(_v1);
	const d11 = _v1.dot(_v1);
	const d20 = _v2.dot(_v0);
	const d21 = _v2.dot(_v1);
	const denom = d00 * d11 - d01 * d01;
	if (Math.abs(denom) < 1e-12) {
		out.set(1, 0, 0);
		return;
	}
	const v = (d11 * d20 - d01 * d21) / denom;
	const w = (d00 * d21 - d01 * d20) / denom;
	out.set(1 - v - w, v, w);
}

class BvhInsoleSampler implements InsoleSurfaceSampler {
	readonly upAxis: THREE.Vector3;
	private readonly rayLift: number;
	private readonly bvh: MeshBVH;
	private readonly clone: THREE.BufferGeometry;
	private readonly position: THREE.BufferAttribute;
	private readonly normal: THREE.BufferAttribute;
	private readonly index: THREE.BufferAttribute | null;

	constructor(insole: THREE.BufferGeometry) {
		// Clone so the source insole is never reordered/normal-computed/mutated.
		this.clone = insole.clone();
		if (!this.clone.getAttribute('normal')) this.clone.computeVertexNormals();
		this.position = this.clone.getAttribute('position') as THREE.BufferAttribute;
		this.normal = this.clone.getAttribute('normal') as THREE.BufferAttribute;
		this.index = this.clone.getIndex();
		this.bvh = new MeshBVH(this.clone);
		const { up, rayLift } = detectUpAxis(this.clone);
		this.upAxis = up;
		this.rayLift = rayLift;
	}

	private faceVertexIndices(faceIndex: number): [number, number, number] {
		if (this.index) {
			const o = faceIndex * 3;
			return [this.index.getX(o), this.index.getX(o + 1), this.index.getX(o + 2)];
		}
		const o = faceIndex * 3;
		return [o, o + 1, o + 2];
	}

	private interpolatedNormal(faceIndex: number, point: THREE.Vector3, out: THREE.Vector3): void {
		const [a, b, c] = this.faceVertexIndices(faceIndex);
		_pa.fromBufferAttribute(this.position, a);
		_pb.fromBufferAttribute(this.position, b);
		_pc.fromBufferAttribute(this.position, c);
		barycentric(point, _pa, _pb, _pc, _bary);
		_na.fromBufferAttribute(this.normal, a);
		_nb.fromBufferAttribute(this.normal, b);
		_nc.fromBufferAttribute(this.normal, c);
		out
			.set(0, 0, 0)
			.addScaledVector(_na, _bary.x)
			.addScaledVector(_nb, _bary.y)
			.addScaledVector(_nc, _bary.z);
		if (out.lengthSq() < 1e-12) {
			// Degenerate interpolation → fall back to the geometric face normal.
			out.subVectors(_pb, _pa).cross(_v1.subVectors(_pc, _pa));
		}
		out.normalize();
		// Keep the offset on the foot side: never point into the insole interior.
		if (out.dot(this.upAxis) < 0) out.negate();
	}

	closestPoint(query: THREE.Vector3, out: InsoleSurfaceHit = makeHit()): InsoleSurfaceHit | null {
		_cpTarget.faceIndex = -1;
		const res = this.bvh.closestPointToPoint(query, _cpTarget);
		if (!res || _cpTarget.faceIndex < 0) return null;
		out.point.copy(_cpTarget.point);
		out.distance = _cpTarget.distance;
		this.interpolatedNormal(_cpTarget.faceIndex, out.point, out.normal);
		return out;
	}

	raycastDown(footprint: THREE.Vector3, out: InsoleSurfaceHit = makeHit()): InsoleSurfaceHit | null {
		_ray.origin.copy(footprint).addScaledVector(this.upAxis, this.rayLift);
		_ray.direction.copy(this.upAxis).negate();
		const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, this.rayLift * 2 + 1);
		if (!hit || hit.faceIndex == null) return null;
		out.point.copy(hit.point);
		out.distance = hit.point.distanceTo(footprint);
		this.interpolatedNormal(hit.faceIndex, out.point, out.normal);
		return out;
	}

	dispose(): void {
		this.clone.dispose();
	}
}

type SamplerCacheEntry = {
	positionVersion: number;
	normalVersion: number;
	sampler: BvhInsoleSampler;
};

const samplerCache = new WeakMap<THREE.BufferGeometry, SamplerCacheEntry>();

/**
 * Cached, read-only surface sampler for an insole geometry. Rebuilt only when the
 * insole's position/normal buffers change; never mutates the source geometry.
 */
export function getInsoleSurfaceSampler(insole: THREE.BufferGeometry): InsoleSurfaceSampler {
	const position = insole.getAttribute('position') as THREE.BufferAttribute | undefined;
	const normal = insole.getAttribute('normal') as THREE.BufferAttribute | undefined;
	const positionVersion = position?.version ?? 0;
	const normalVersion = normal?.version ?? 0;
	const cached = samplerCache.get(insole);
	if (
		cached &&
		cached.positionVersion === positionVersion &&
		cached.normalVersion === normalVersion
	) {
		return cached.sampler;
	}
	cached?.sampler.dispose();
	const sampler = new BvhInsoleSampler(insole);
	samplerCache.set(insole, { positionVersion, normalVersion, sampler });
	return sampler;
}

const _seatHitA = makeHit();
const _seatHitB = makeHit();

/**
 * Seat a single element "column" onto the insole surface and offset it along the
 * surface normal by `heightAboveBase`. Base columns (height 0) land exactly on
 * the surface — zero gap. Returns the surface normal used, or null if no surface.
 */
export function seatColumnOnSurface(
	sampler: InsoleSurfaceSampler,
	anchor: THREE.Vector3,
	heightAboveBase: number,
	params: SeatParams,
	outPos: THREE.Vector3,
): THREE.Vector3 | null {
	const mode = params.mode ?? 'auto';
	let hit: InsoleSurfaceHit | null = null;
	if (mode !== 'nearest') hit = sampler.raycastDown(anchor, _seatHitA);
	if (!hit && mode !== 'project') hit = sampler.closestPoint(anchor, _seatHitB);
	if (!hit) return null;
	if (params.maxSnapDistance !== undefined && hit.distance > params.maxSnapDistance) {
		return null;
	}
	outPos.copy(hit.point).addScaledVector(hit.normal, heightAboveBase);
	return hit.normal;
}

const _vtx = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _out = new THREE.Vector3();

/**
 * Conform an element geometry onto the insole IN PLACE. The element must already
 * be positioned in insole-local space with its height along `upAxis` and its
 * contact base at `baseAlongUp`. Every vertex is decomposed into (footprint,
 * height-above-base), the footprint is snapped to the surface, and the vertex is
 * re-offset along the surface normal — preserving the element's own thickness.
 */
export function conformElementGeometryToInsole(
	element: THREE.BufferGeometry,
	sampler: InsoleSurfaceSampler,
	options: ConformElementOptions,
): void {
	const pos = element.getAttribute('position') as THREE.BufferAttribute;
	const up = options.upAxis.clone().normalize();
	const baseAlongUp = options.baseAlongUp;
	const heightScale = options.heightScale ?? 1;
	const heights = new Float32Array(pos.count);

	for (let i = 0; i < pos.count; i++) {
		_vtx.fromBufferAttribute(pos, i);
		const along = _vtx.dot(up);
		const h = Math.max(0, along - baseAlongUp) * heightScale;
		heights[i] = h;
		// Footprint anchor = vertex projected down to the contact base plane.
		_anchor.copy(_vtx).addScaledVector(up, baseAlongUp - along);
		const normal = seatColumnOnSurface(sampler, _anchor, h, options, _out);
		if (normal) pos.setXYZ(i, _out.x, _out.y, _out.z);
	}
	pos.needsUpdate = true;

	if (options.smoothingSteps && options.smoothingSteps > 0) {
		smoothRaisedBody(element, heights, options.smoothingSteps);
	}

	element.computeVertexNormals();
	element.computeBoundingBox();
	element.computeBoundingSphere();
}

/**
 * Light tangential smoothing of the raised body. Weighted by height ratio so
 * contact (base) vertices stay locked on the surface while walls/tops relax —
 * removes faceting inherited from the insole tessellation. Indexed meshes only.
 */
export function smoothRaisedBody(
	geometry: THREE.BufferGeometry,
	heights: Float32Array,
	steps: number,
): void {
	const index = geometry.getIndex();
	if (!index) return;
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
	const count = pos.count;
	let maxH = 1e-6;
	for (let i = 0; i < count; i++) if (heights[i] > maxH) maxH = heights[i];

	const neighbors: number[][] = Array.from({ length: count }, () => []);
	const seen = new Set<number>();
	for (let t = 0; t < index.count; t += 3) {
		const a = index.getX(t);
		const b = index.getX(t + 1);
		const c = index.getX(t + 2);
		for (const [u, v] of [
			[a, b],
			[b, c],
			[c, a],
		] as const) {
			const key1 = u * count + v;
			if (!seen.has(key1)) {
				seen.add(key1);
				neighbors[u].push(v);
			}
			const key2 = v * count + u;
			if (!seen.has(key2)) {
				seen.add(key2);
				neighbors[v].push(u);
			}
		}
	}

	const src = new Float32Array(count * 3);
	for (let step = 0; step < steps; step++) {
		for (let i = 0; i < count * 3; i++) src[i] = (pos.array as Float32Array)[i];
		for (let i = 0; i < count; i++) {
			const nb = neighbors[i];
			if (nb.length === 0) continue;
			const w = Math.min(1, heights[i] / maxH) * 0.5;
			if (w <= 0) continue;
			let ax = 0;
			let ay = 0;
			let az = 0;
			for (const n of nb) {
				ax += src[n * 3];
				ay += src[n * 3 + 1];
				az += src[n * 3 + 2];
			}
			const inv = 1 / nb.length;
			ax *= inv;
			ay *= inv;
			az *= inv;
			const i3 = i * 3;
			pos.setXYZ(
				i,
				src[i3] + (ax - src[i3]) * w,
				src[i3 + 1] + (ay - src[i3 + 1]) * w,
				src[i3 + 2] + (az - src[i3 + 2]) * w,
			);
		}
	}
	pos.needsUpdate = true;
}

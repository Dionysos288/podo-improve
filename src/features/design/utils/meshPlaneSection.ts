import * as THREE from 'three';

export type PlaneSectionResult = {
	/** Triangulated cut face in world space (unindexed positions). */
	cap: THREE.BufferGeometry | null;
	/** Closed outline loops of the cut contour, in world space. */
	loops: THREE.Vector3[][];
};

export type SectionPlane = {
	/** World-space point the cut plane passes through. */
	origin: THREE.Vector3;
	/** World-space plane normal (need not be unit length). */
	normal: THREE.Vector3;
};

const EPS = 1e-6;

function inPlaneBasis(normal: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
	const n = normal.clone().normalize();
	const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
	const u = new THREE.Vector3().crossVectors(n, ref).normalize();
	const v = new THREE.Vector3().crossVectors(n, u).normalize();
	return { u, v };
}

/** Quantized key so segment endpoints that should coincide stitch together. */
function keyFor(p: THREE.Vector3, scale: number): string {
	return `${Math.round(p.x * scale)},${Math.round(p.y * scale)},${Math.round(p.z * scale)}`;
}

type Segment = { a: THREE.Vector3; b: THREE.Vector3 };

function collectSegments(
	geometry: THREE.BufferGeometry,
	worldMatrix: THREE.Matrix4,
	origin: THREE.Vector3,
	normal: THREE.Vector3,
): Segment[] {
	const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
	if (!pos || pos.count < 3) return [];

	const index = geometry.getIndex();
	const triCount = index ? index.count / 3 : pos.count / 3;
	const n = normal.clone().normalize();

	const va = new THREE.Vector3();
	const vb = new THREE.Vector3();
	const vc = new THREE.Vector3();
	const tmp = new THREE.Vector3();

	const dist = (p: THREE.Vector3): number => tmp.copy(p).sub(origin).dot(n);

	const segments: Segment[] = [];

	const intersect = (p1: THREE.Vector3, d1: number, p2: THREE.Vector3, d2: number): THREE.Vector3 => {
		const t = d1 / (d1 - d2);
		return new THREE.Vector3().copy(p1).lerp(p2, t);
	};

	for (let t = 0; t < triCount; t++) {
		const i0 = index ? index.getX(t * 3) : t * 3;
		const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
		const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

		va.fromBufferAttribute(pos, i0).applyMatrix4(worldMatrix);
		vb.fromBufferAttribute(pos, i1).applyMatrix4(worldMatrix);
		vc.fromBufferAttribute(pos, i2).applyMatrix4(worldMatrix);

		const da = dist(va);
		const db = dist(vb);
		const dc = dist(vc);

		// All on one side (and none on the plane) — no crossing.
		if ((da > EPS && db > EPS && dc > EPS) || (da < -EPS && db < -EPS && dc < -EPS)) {
			continue;
		}

		const pts: THREE.Vector3[] = [];
		const edge = (pA: THREE.Vector3, dA: number, pB: THREE.Vector3, dB: number): void => {
			if ((dA > EPS && dB < -EPS) || (dA < -EPS && dB > EPS)) {
				pts.push(intersect(pA, dA, pB, dB));
			}
		};
		edge(va, da, vb, db);
		edge(vb, db, vc, dc);
		edge(vc, dc, va, da);

		// Vertices that lie exactly on the plane also seed the segment.
		if (Math.abs(da) <= EPS) pts.push(va.clone());
		if (Math.abs(db) <= EPS) pts.push(vb.clone());
		if (Math.abs(dc) <= EPS) pts.push(vc.clone());

		if (pts.length >= 2) {
			const a = pts[0]!;
			const b = pts[1]!;
			if (a.distanceToSquared(b) > EPS) segments.push({ a, b });
		}
	}

	return segments;
}

function stitchLoops(segments: Segment[], scale: number): THREE.Vector3[][] {
	const nodes = new Map<string, THREE.Vector3>();
	const adjacency = new Map<string, string[]>();

	const register = (p: THREE.Vector3): string => {
		const k = keyFor(p, scale);
		if (!nodes.has(k)) nodes.set(k, p);
		return k;
	};
	const link = (ka: string, kb: string): void => {
		if (ka === kb) return;
		(adjacency.get(ka) ?? adjacency.set(ka, []).get(ka)!).push(kb);
		(adjacency.get(kb) ?? adjacency.set(kb, []).get(kb)!).push(ka);
	};

	for (const seg of segments) {
		link(register(seg.a), register(seg.b));
	}

	const visitedEdges = new Set<string>();
	const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
	const loops: THREE.Vector3[][] = [];

	for (const startKey of adjacency.keys()) {
		const neighbors = adjacency.get(startKey)!;
		for (const firstNeighbor of neighbors) {
			if (visitedEdges.has(edgeKey(startKey, firstNeighbor))) continue;

			const loopKeys: string[] = [startKey];
			let prev = startKey;
			let current = firstNeighbor;
			visitedEdges.add(edgeKey(prev, current));

			let guard = 0;
			const maxSteps = adjacency.size * 3 + 8;
			while (current !== startKey && guard++ < maxSteps) {
				loopKeys.push(current);
				const opts = adjacency.get(current) ?? [];
				let next: string | null = null;
				for (const cand of opts) {
					if (cand === prev) continue;
					if (visitedEdges.has(edgeKey(current, cand))) continue;
					next = cand;
					break;
				}
				if (next == null) break;
				visitedEdges.add(edgeKey(current, next));
				prev = current;
				current = next;
			}

			if (current === startKey && loopKeys.length >= 3) {
				loops.push(loopKeys.map((k) => nodes.get(k)!.clone()));
			}
		}
	}

	return loops;
}

function triangulateLoops(loops: THREE.Vector3[][], origin: THREE.Vector3, normal: THREE.Vector3): THREE.BufferGeometry | null {
	if (loops.length === 0) return null;
	const { u, v } = inPlaneBasis(normal);
	const verts: number[] = [];

	for (const loop of loops) {
		if (loop.length < 3) continue;
		const flat: THREE.Vector2[] = loop.map((p) => {
			const rel = p.clone().sub(origin);
			return new THREE.Vector2(rel.dot(u), rel.dot(v));
		});
		let faces: number[][];
		try {
			faces = THREE.ShapeUtils.triangulateShape(flat, []);
		} catch {
			continue;
		}
		for (const face of faces) {
			for (const idx of face) {
				const p = loop[idx]!;
				verts.push(p.x, p.y, p.z);
			}
		}
	}

	if (verts.length < 9) return null;
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
	return geom;
}

/**
 * Slices a mesh by a world-space plane and returns the closed cut contour
 * loops plus a triangulated cap of the cut face. Intended to run throttled
 * (on geometry/plane change), not per frame.
 */
export function computeMeshPlaneSection(
	geometry: THREE.BufferGeometry,
	worldMatrix: THREE.Matrix4,
	plane: SectionPlane,
): PlaneSectionResult {
	const normal = plane.normal.clone();
	if (normal.lengthSq() < EPS) return { cap: null, loops: [] };
	normal.normalize();

	geometry.computeBoundingSphere();
	const radius = geometry.boundingSphere?.radius ?? 1;
	const worldScale = new THREE.Vector3();
	worldMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), worldScale);
	const span = Math.max(1e-3, radius * 2 * Math.max(worldScale.x, worldScale.y, worldScale.z));
	// Quantize endpoints to ~1/2000 of the part span so coincident points merge.
	const scale = 2000 / span;

	const segments = collectSegments(geometry, worldMatrix, plane.origin, normal);
	if (segments.length < 2) return { cap: null, loops: [] };

	const loops = stitchLoops(segments, scale);
	const cap = triangulateLoops(loops, plane.origin, normal);

	return { cap, loops };
}

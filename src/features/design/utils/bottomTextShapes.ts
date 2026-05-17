import type { PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Font, Glyph } from 'opentype.js';

function shoelaceArea(points: THREE.Vector2[]): number {
	let sum = 0;
	const n = points.length;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		sum += points[i]!.x * points[j]!.y - points[j]!.x * points[i]!.y;
	}
	return sum / 2;
}

function centroid(points: THREE.Vector2[]): THREE.Vector2 {
	let sx = 0;
	let sy = 0;
	for (const p of points) {
		sx += p.x;
		sy += p.y;
	}
	const inv = 1 / Math.max(1, points.length);
	return new THREE.Vector2(sx * inv, sy * inv);
}

function pointInPolygon(p: THREE.Vector2, poly: THREE.Vector2[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const xi = poly[i]!.x;
		const yi = poly[i]!.y;
		const xj = poly[j]!.x;
		const yj = poly[j]!.y;
		const intersect =
			(yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-14) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

function splitPathIntoContourCommands(commands: PathCommand[]): PathCommand[][] {
	const out: PathCommand[][] = [];
	let chunk: PathCommand[] = [];
	for (const cmd of commands) {
		if (cmd.type === 'M' && chunk.length > 0 && chunk[chunk.length - 1]?.type !== 'Z') {
			out.push(chunk);
			chunk = [];
		}
		chunk.push(cmd);
		if (cmd.type === 'Z') {
			out.push(chunk);
			chunk = [];
		}
	}
	if (chunk.length > 0) out.push(chunk);
	return out;
}

function applyCommandsToCurvePath(path: THREE.Shape | THREE.Path, cmds: PathCommand[]) {
	for (const cmd of cmds) {
		switch (cmd.type) {
			case 'M':
				path.moveTo(cmd.x, cmd.y);
				break;
			case 'L':
				path.lineTo(cmd.x, cmd.y);
				break;
			case 'Q':
				path.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
				break;
			case 'C':
				path.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
				break;
			case 'Z':
				path.closePath();
				break;
			default:
				break;
		}
	}
}

function commandsToShape(cmds: PathCommand[]): THREE.Shape {
	const shape = new THREE.Shape();
	applyCommandsToCurvePath(shape, cmds);
	return shape;
}

function commandsToPath(cmds: PathCommand[]): THREE.Path {
	const path = new THREE.Path();
	applyCommandsToCurvePath(path, cmds);
	return path;
}

function buildShapesFromContourGroups(groups: PathCommand[][]): THREE.Shape[] {
	if (groups.length === 0) return [];
	const shapes = groups.map((g) => commandsToShape(g));
	const infos = shapes.map((shape) => {
		const points = shape.getPoints(72);
		const area = shoelaceArea(points);
		return {
			shape,
			points,
			area,
			centroid: centroid(points),
			absArea: Math.abs(area),
		};
	});

	const order = infos.map((_, i) => i).sort((a, b) => infos[b]!.absArea - infos[a]!.absArea);

	const parentIndex = new Array<number | null>(infos.length).fill(null);
	for (const i of order) {
		const inf = infos[i]!;
		let bestParent: number | null = null;
		let bestAbs = Infinity;
		for (let j = 0; j < infos.length; j++) {
			if (i === j) continue;
			const outer = infos[j]!;
			if (outer.absArea <= inf.absArea) continue;
			if (!pointInPolygon(inf.centroid, outer.points)) continue;
			if (outer.absArea < bestAbs) {
				bestAbs = outer.absArea;
				bestParent = j;
			}
		}
		parentIndex[i] = bestParent;
	}

	const roots: number[] = [];
	for (let i = 0; i < infos.length; i++) {
		if (parentIndex[i] === null) roots.push(i);
	}

	const result: THREE.Shape[] = [];
	for (const r of roots) {
		const outerInf = infos[r]!;
		const rootShape = commandsToShape(groups[r]!);
		rootShape.holes.length = 0;
		for (let i = 0; i < infos.length; i++) {
			if (parentIndex[i] !== r) continue;
			const inner = infos[i]!;
			if (Math.sign(inner.area) === Math.sign(outerInf.area)) continue;
			rootShape.holes.push(commandsToPath(groups[i]!));
		}
		result.push(rootShape);
	}
	return result;
}

export function buildExtrudedTextGeometry(
	font: Font,
	text: string,
	fontSizeWorld: number,
	depthWorld: number
): THREE.BufferGeometry | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const pieces: THREE.BufferGeometry[] = [];

	const options = {};
	font.forEachGlyph(trimmed, 0, 0, fontSizeWorld, options, (glyph: Glyph, gx: number, gy: number, fs: number) => {
		const path = glyph.getPath(gx, gy, fs);
		const groups = splitPathIntoContourCommands(path.commands);
		if (groups.length === 0) return;
		const extrudeShapes = buildShapesFromContourGroups(groups);
		for (const sh of extrudeShapes) {
			const g = new THREE.ExtrudeGeometry(sh, {
				depth: depthWorld,
				bevelEnabled: false,
				curveSegments: 16,
				steps: 1,
			});
			pieces.push(g);
		}
	});

	if (pieces.length === 0) {
		console.warn('[bottomTextShapes] no extruded pieces for text (glyph outlines empty?)', {
			textPreview: trimmed.slice(0, 64),
		});
		return null;
	}
	const merged = mergeGeometries(pieces, false);
	if (!merged) {
		console.warn('[bottomTextShapes] mergeGeometries returned null', {
			textPreview: trimmed.slice(0, 64),
			pieceCount: pieces.length,
		});
		return null;
	}
	merged.computeBoundingBox();
	const bb = merged.boundingBox;
	if (!bb) return merged;
	const cx = (bb.min.x + bb.max.x) * 0.5;
	const cy = (bb.min.y + bb.max.y) * 0.5;
	merged.translate(-cx, -cy, 0);
	return merged;
}

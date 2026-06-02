import fs from 'fs';

export const DEFAULT_HARDNESS_PERCENT = 26;

export function normalizeHardnessPercent(value, fallback = DEFAULT_HARDNESS_PERCENT) {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	return Math.max(1, Math.min(100, Math.round(num)));
}

function normalizeStep3Side(raw) {
	const overall = normalizeHardnessPercent(raw?.infillPercent);
	const elementsSplit = raw?.elementsSplit === true;
	return {
		elementsSplit,
		overall,
		front: normalizeHardnessPercent(raw?.infillFrontPercent, overall),
		middle: normalizeHardnessPercent(raw?.infillMiddlePercent, overall),
		back: normalizeHardnessPercent(raw?.infillBackPercent, overall),
	};
}

export function buildHardnessPlan(settings) {
	const left = normalizeStep3Side(settings?.step3?.left);
	const right = normalizeStep3Side(settings?.step3?.right);
	const requestedPercents = [left.overall, right.overall];
	if (left.elementsSplit) requestedPercents.push(left.front, left.middle, left.back);
	if (right.elementsSplit) requestedPercents.push(right.front, right.middle, right.back);
	const basePercent = Math.max(...requestedPercents);
	return {
		left,
		right,
		basePercent,
		headerLines: [
			`; PODO_HARDNESS_BASE_FILL_DENSITY=${basePercent}%`,
			`; PODO_HARDNESS_LEFT=${left.elementsSplit ? `split(front=${left.front}%,middle=${left.middle}%,back=${left.back}%)` : `overall(${left.overall}%)`}`,
			`; PODO_HARDNESS_RIGHT=${right.elementsSplit ? `split(front=${right.front}%,middle=${right.middle}%,back=${right.back}%)` : `overall(${right.overall}%)`}`,
		],
	};
}

function formatGcodeNumber(value, decimals = 5) {
	if (!Number.isFinite(value)) return '0';
	return Number(value.toFixed(decimals)).toString();
}

function extractGcodeCoord(line, axis) {
	const match = line.match(new RegExp(`(?:^|\\s)${axis}(-?\\d*\\.?\\d+)`, 'i'));
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : null;
}

function analyzeInsoleLayout(stlPath, orientationMeta = null) {
	const buf = fs.readFileSync(stlPath);
	if (buf.length < 84) return null;
	const triCount = buf.readUInt32LE(80);
	const expectedLen = 84 + triCount * 50;
	if (buf.length < expectedLen || triCount < 2) return null;

	const perm = Array.isArray(orientationMeta?.perm) && orientationMeta.perm.length === 3
		? orientationMeta.perm
		: [0, 1, 2];
	const axisKeys = ['x', 'y', 'z'];
	const separationAxisIndex = Math.max(0, perm.findIndex((axis) => axis === 0));
	const lengthAxisIndex = Math.max(0, perm.findIndex((axis) => axis === 1));
	const separationAxis = axisKeys[separationAxisIndex];
	const lengthAxis = axisKeys[lengthAxisIndex];

	const triangles = [];
	for (let i = 0; i < triCount; i++) {
		const triBase = 84 + i * 50 + 12;
		const verts = [];
		let sumX = 0;
		let sumY = 0;
		for (let v = 0; v < 3; v++) {
			const off = triBase + v * 12;
			const x = buf.readFloatLE(off);
			const y = buf.readFloatLE(off + 4);
			const z = buf.readFloatLE(off + 8);
			verts.push({ x, y, z });
			sumX += x;
			sumY += y;
		}
		triangles.push({
			verts,
			centroid: { x: sumX / 3, y: sumY / 3 },
		});
	}

	let centers = [
		{ ...triangles[0].centroid },
		{ ...triangles[triangles.length - 1].centroid },
	];
	for (let i = 0; i < 6; i++) {
		const sums = [
			{ x: 0, y: 0, count: 0 },
			{ x: 0, y: 0, count: 0 },
		];
		for (const tri of triangles) {
			const d0 = (tri.centroid.x - centers[0].x) ** 2 + (tri.centroid.y - centers[0].y) ** 2;
			const d1 = (tri.centroid.x - centers[1].x) ** 2 + (tri.centroid.y - centers[1].y) ** 2;
			const idx = d0 <= d1 ? 0 : 1;
			sums[idx].x += tri.centroid.x;
			sums[idx].y += tri.centroid.y;
			sums[idx].count += 1;
		}
		for (let idx = 0; idx < 2; idx++) {
			if (sums[idx].count > 0) {
				centers[idx] = {
					x: sums[idx].x / sums[idx].count,
					y: sums[idx].y / sums[idx].count,
				};
			}
		}
	}

	const clusters = [
		{ tris: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, center: centers[0] },
		{ tris: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, center: centers[1] },
	];
	for (const tri of triangles) {
		const d0 = (tri.centroid.x - centers[0].x) ** 2 + (tri.centroid.y - centers[0].y) ** 2;
		const d1 = (tri.centroid.x - centers[1].x) ** 2 + (tri.centroid.y - centers[1].y) ** 2;
		const idx = d0 <= d1 ? 0 : 1;
		const cluster = clusters[idx];
		cluster.tris.push(tri);
		for (const vert of tri.verts) {
			if (vert.x < cluster.minX) cluster.minX = vert.x;
			if (vert.x > cluster.maxX) cluster.maxX = vert.x;
			if (vert.y < cluster.minY) cluster.minY = vert.y;
			if (vert.y > cluster.maxY) cluster.maxY = vert.y;
		}
	}

	if (!clusters[0].tris.length || !clusters[1].tris.length) return null;

	const ordered = [...clusters].sort((a, b) => a.center[separationAxis] - b.center[separationAxis]);
	const mapCluster = (cluster) => ({
		minX: cluster.minX,
		maxX: cluster.maxX,
		minY: cluster.minY,
		maxY: cluster.maxY,
		centerX: cluster.center.x,
		centerY: cluster.center.y,
		lengthMin: lengthAxis === 'x' ? cluster.minX : cluster.minY,
		lengthMax: lengthAxis === 'x' ? cluster.maxX : cluster.maxY,
	});

	return {
		separationAxis,
		lengthAxis,
		left: mapCluster(ordered[0]),
		right: mapCluster(ordered[1]),
	};
}

function resolveHardnessRegion(layout, x, y) {
	const point = { x, y };
	const within = (box, pad = 2) =>
		point.x >= box.minX - pad && point.x <= box.maxX + pad && point.y >= box.minY - pad && point.y <= box.maxY + pad;
	let side = 'left';
	if (within(layout.right) && !within(layout.left)) side = 'right';
	else if (!within(layout.left) && !within(layout.right)) {
		const leftDist = (point.x - layout.left.centerX) ** 2 + (point.y - layout.left.centerY) ** 2;
		const rightDist = (point.x - layout.right.centerX) ** 2 + (point.y - layout.right.centerY) ** 2;
		side = rightDist < leftDist ? 'right' : 'left';
	}
	const box = layout[side];
	const lengthCoord = layout.lengthAxis === 'x' ? point.x : point.y;
	const span = Math.max(1e-6, box.lengthMax - box.lengthMin);
	const t = (lengthCoord - box.lengthMin) / span;
	const zone = t > 0.55 ? 'front' : t > 0.25 ? 'middle' : 'back';
	return { side, zone };
}

export function applyHardnessPostProcess(gcodePath, stlPath, settings, orientationMeta = null) {
	if (!fs.existsSync(gcodePath)) {
		return { applied: false, scaledMoves: 0, reason: 'missing-gcode' };
	}

	const plan = buildHardnessPlan(settings);
	const original = fs.readFileSync(gcodePath, 'utf8');
	const layout = analyzeInsoleLayout(stlPath, orientationMeta);
	if (!layout) {
		fs.writeFileSync(gcodePath, `${plan.headerLines.join('\n')}\n${original}`, 'utf8');
		return { applied: false, basePercent: plan.basePercent, scaledMoves: 0, reason: 'layout-unavailable' };
	}

	const lines = original.split(/\r?\n/);
	const output = [...plan.headerLines, '; PODO_HARDNESS_METHOD=base-density-plus-infill-scaling'];
	let featureType = '';
	let absoluteExtrusion = true;
	let currentX = 0;
	let currentY = 0;
	let currentE = 0;
	let scaledMoves = 0;

	for (let line of lines) {
		if (line.startsWith(';TYPE:')) {
			featureType = line.slice(6).trim();
			output.push(line);
			continue;
		}
		if (/^M82\b/i.test(line)) {
			absoluteExtrusion = true;
			output.push(line);
			continue;
		}
		if (/^M83\b/i.test(line)) {
			absoluteExtrusion = false;
			output.push(line);
			continue;
		}
		if (/^G92\b/i.test(line)) {
			const eReset = extractGcodeCoord(line, 'E');
			if (eReset != null) currentE = eReset;
			output.push(line);
			continue;
		}

		if (/^G0?1\b/i.test(line)) {
			const nextX = extractGcodeCoord(line, 'X');
			const nextY = extractGcodeCoord(line, 'Y');
			const nextE = extractGcodeCoord(line, 'E');
			const resolvedX = nextX != null ? nextX : currentX;
			const resolvedY = nextY != null ? nextY : currentY;

			if (nextE != null) {
				const deltaE = absoluteExtrusion ? nextE - currentE : nextE;
				const isInternalInfill = /^internal infill$/i.test(featureType);
				if (deltaE > 0 && isInternalInfill) {
					const region = resolveHardnessRegion(layout, (currentX + resolvedX) / 2, (currentY + resolvedY) / 2);
					const sidePlan = plan[region.side];
					const targetPercent = sidePlan.elementsSplit ? sidePlan[region.zone] : sidePlan.overall;
					const scale = Math.max(0.05, Math.min(1, targetPercent / plan.basePercent));
					if (Math.abs(scale - 1) > 0.001) {
						const scaledDelta = deltaE * scale;
						const replacementE = absoluteExtrusion ? currentE + scaledDelta : scaledDelta;
						line = line.replace(/([\s])E-?\d*\.?\d+/i, `$1E${formatGcodeNumber(replacementE)}`);
						scaledMoves += 1;
						currentE = absoluteExtrusion ? replacementE : currentE + scaledDelta;
					} else {
						currentE = absoluteExtrusion ? nextE : currentE + deltaE;
					}
				} else {
					currentE = absoluteExtrusion ? nextE : currentE + deltaE;
				}
			}

			currentX = resolvedX;
			currentY = resolvedY;
		}

		output.push(line);
	}

	fs.writeFileSync(gcodePath, output.join('\n'), 'utf8');
	return { applied: true, basePercent: plan.basePercent, scaledMoves, reason: null };
}

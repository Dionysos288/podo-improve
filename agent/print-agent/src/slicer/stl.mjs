import fs from 'fs';

/**
 * Read a binary STL, auto-orient so the thinnest dimension becomes Z
 * (model lies flat), align longest dimension with longest bed axis,
 * center XY on bed, and drop to Z=0.
 */
export function centerSTLOnBed(inPath, outPath, bedCenter, bedSize, maxPrintHeight) {
	const buf = fs.readFileSync(inPath);
	if (buf.length < 84) throw new Error('STL file too small to be valid');

	const triCount = buf.readUInt32LE(80);
	const expectedLen = 84 + triCount * 50;
	if (buf.length < expectedLen) {
		console.log(`  STL: ${buf.length} bytes, ${triCount} triangles (expected ${expectedLen}) – treating as ASCII, skipping orient`);
		if (inPath !== outPath) fs.copyFileSync(inPath, outPath);
		return { perm: [0, 1, 2], translation: { dx: 0, dy: 0, dz: 0 } };
	}

	const mins = [Infinity, Infinity, Infinity];
	const maxs = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < triCount; i++) {
		const base = 84 + i * 50 + 12;
		for (let v = 0; v < 3; v++) {
			const off = base + v * 12;
			for (let a = 0; a < 3; a++) {
				const val = buf.readFloatLE(off + a * 4);
				if (val < mins[a]) mins[a] = val;
				if (val > maxs[a]) maxs[a] = val;
			}
		}
	}
	const spans = [0, 1, 2].map((a) => maxs[a] - mins[a]);
	console.log(`  STL bounds: X[${mins[0].toFixed(1)}, ${maxs[0].toFixed(1)}] Y[${mins[1].toFixed(1)}, ${maxs[1].toFixed(1)}] Z[${mins[2].toFixed(1)}, ${maxs[2].toFixed(1)}]`);
	console.log(`  STL spans: ${spans.map((s) => s.toFixed(1)).join(' × ')} mm`);

	const fitsAsIs = spans[2] <= maxPrintHeight &&
		spans[0] <= bedSize.x && spans[1] <= bedSize.y;

	let perm;
	if (fitsAsIs) {
		perm = [0, 1, 2];
		console.log(`  Model fits on bed as-is (no reorientation needed)`);
	} else {
		const indexed = spans.map((s, a) => ({ axis: a, span: s }));
		indexed.sort((a, b) => a.span - b.span);
		const thinnest = indexed[0];
		const remaining = [indexed[1], indexed[2]];

		let assignX, assignY;
		if (bedSize.x >= bedSize.y) {
			assignX = remaining[1];
			assignY = remaining[0];
		} else {
			assignX = remaining[0];
			assignY = remaining[1];
		}
		perm = [assignX.axis, assignY.axis, thinnest.axis];
		console.log(`  Auto-orient: axis permutation [${perm}] – thinnest span ${thinnest.span.toFixed(1)}mm → Z`);
	}

	const permSign = (
		(perm[0] === 0 && perm[1] === 1 && perm[2] === 2) ||
		(perm[0] === 1 && perm[1] === 2 && perm[2] === 0) ||
		(perm[0] === 2 && perm[1] === 0 && perm[2] === 1)
	) ? 1 : -1;

	const newMins = perm.map((a) => mins[a]);
	const newMaxs = perm.map((a) => maxs[a]);

	const dx = bedCenter.x - (newMins[0] + newMaxs[0]) / 2;
	const dy = bedCenter.y - (newMins[1] + newMaxs[1]) / 2;
	const dz = -newMins[2];

	const finalSpans = perm.map((a) => spans[a]);
	console.log(`  After orient: ${finalSpans[0].toFixed(1)}×${finalSpans[1].toFixed(1)}×${finalSpans[2].toFixed(1)} mm (XYZ)`);
	console.log(`  Translate: (${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(1)})`);

	const out = Buffer.from(buf);
	for (let i = 0; i < triCount; i++) {
		const triBase = 84 + i * 50;

		const n = [buf.readFloatLE(triBase), buf.readFloatLE(triBase + 4), buf.readFloatLE(triBase + 8)];
		out.writeFloatLE(n[perm[0]], triBase);
		out.writeFloatLE(n[perm[1]], triBase + 4);
		out.writeFloatLE(n[perm[2]], triBase + 8);

		const verts = [];
		for (let v = 0; v < 3; v++) {
			const off = triBase + 12 + v * 12;
			verts.push([buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8)]);
		}

		if (permSign === -1) {
			const tmp = verts[1];
			verts[1] = verts[2];
			verts[2] = tmp;
		}

		for (let v = 0; v < 3; v++) {
			const off = triBase + 12 + v * 12;
			out.writeFloatLE(verts[v][perm[0]] + dx, off);
			out.writeFloatLE(verts[v][perm[1]] + dy, off + 4);
			out.writeFloatLE(verts[v][perm[2]] + dz, off + 8);
		}
	}

	fs.writeFileSync(outPath, out);
	return { perm, translation: { dx, dy, dz } };
}

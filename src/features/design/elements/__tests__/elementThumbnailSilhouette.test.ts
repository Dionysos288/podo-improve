import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

import { buildStlSilhouette } from '@/src/features/design/elements/elementThumbnailSilhouette';

function loadElementStl(filename: string) {
	const buf = readFileSync(resolve(process.cwd(), `public/base/elements/${filename}`));
	const loader = new STLLoader();
	return loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function silhouetteAspectRatio(filename: string): number {
	const silhouette = buildStlSilhouette(loadElementStl(filename));
	const points = silhouette.points;
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const [x, y] of points) {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	const pw = Math.max(maxX - minX, 1e-6);
	const ph = Math.max(maxY - minY, 1e-6);
	return pw / ph;
}

describe('elementThumbnailSilhouette', () => {
	it('renders wall-hugging pads with a readable aspect ratio (not a thin sliver)', () => {
		const spsaRatio = silhouetteAspectRatio('SPSA Vlak.stl');
		const ppsiRatio = silhouetteAspectRatio('PPSI.stl');
		expect(spsaRatio).toBeGreaterThan(0.35);
		expect(ppsiRatio).toBeGreaterThan(0.35);
	});

	it('produces distinct silhouettes for different STLs', () => {
		const spsa = buildStlSilhouette(loadElementStl('SPSA Vlak.stl'));
		const rctb = buildStlSilhouette(loadElementStl('RCTB 1.stl'));
		expect(spsa.points.length).not.toBe(rctb.points.length);
	});
});

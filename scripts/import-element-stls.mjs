/**
 * Import normalized element STLs from an export folder into public/base/elements.
 * Swaps Y↔Z so footprint lies in XY and height in Z (matches applyElements convention).
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const elementsDir = path.join(projectRoot, 'public', 'base', 'elements');

const IMPORT_MAP = [
	['SD_2_5.stl', 'SD 2-5.stl'],
	['SD_1_5.stl', 'sd 1-5.stl'],
	['SD_1.stl', 'SD1.stl'],
	['RCTB_1.stl', 'RCTB 1.stl'],
	['RCTB_2.stl', 'RCTB 2.stl'],
	['RCTB_3.stl', 'RCTB 3.stl'],
	['SPSA.stl', 'SPSA Vlak.stl'],
	['SC.stl', 'sc bol.stl'],
	['PPSi.stl', 'PPSI.stl'],
	['SPSI.stl', 'SPSI.stl'],
	['HAI.stl', 'HAI Vlak 2.stl'],
	['SA_recht1_5.stl', 'sa recgt 1-5.stl'],
	['SA_recht1.stl', 'sa Recht 1.stl'],
	['Pelotte.stl', 'peloitte 2.stl'],
	['Rond.stl', 'diep-rond.stl'],
	['Ovaal.stl', 'diep - ovaal.stl'],
];

function bufferToArrayBuffer(buffer) {
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function swapYZ(geometry) {
	const position = geometry.getAttribute('position');
	for (let i = 0; i < position.count; i += 1) {
		const y = position.getY(i);
		const z = position.getZ(i);
		position.setY(i, z);
		position.setZ(i, y);
	}
	position.needsUpdate = true;
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;
}

function measureFootprintMm(geometry) {
	geometry.computeBoundingBox();
	const b = geometry.boundingBox;
	return {
		widthMm: Number((b.max.x - b.min.x).toFixed(1)),
		lengthMm: Number((b.max.y - b.min.y).toFixed(1)),
		heightMm: Number((b.max.z - b.min.z).toFixed(1)),
	};
}

async function loadStl(filePath) {
	const buffer = await fs.readFile(filePath);
	const loader = new STLLoader();
	return loader.parse(bufferToArrayBuffer(buffer));
}

function exportStlBinary(geometry) {
	const exporter = new STLExporter();
	const mesh = new THREE.Mesh(geometry);
	const output = exporter.parse(mesh, { binary: true });
	if (output instanceof DataView) {
		return Buffer.from(
			output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength),
		);
	}
	if (output instanceof ArrayBuffer) {
		return Buffer.from(output);
	}
	return Buffer.from(output);
}

async function main() {
	const sourceDir = process.argv[2];
	if (!sourceDir) {
		console.error('Usage: node scripts/import-element-stls.mjs <source-dir>');
		process.exit(1);
	}

	await fs.mkdir(elementsDir, { recursive: true });

	// Preserve legacy assets for elements not yet re-exported.
	const legacyCopies = [
		['SPSA Vlak.stl', 'PPSA.stl'],
		['RCTB 3 R.stl', 'RCTB Pronatie.stl'],
	];
	for (const [from, to] of legacyCopies) {
		const src = path.join(elementsDir, from);
		const dest = path.join(elementsDir, to);
		try {
			const existing = await fs.stat(dest);
			if (existing.size > 1000) {
				console.log(`Legacy ${to} already present (${existing.size} bytes)`);
				continue;
			}
		} catch {
			// dest missing — copy below
		}
		try {
			await fs.copyFile(src, dest);
			console.log(`Preserved legacy ${to} from ${from}`);
		} catch {
			console.warn(`Skip legacy preserve ${from} → ${to} (source missing)`);
		}
	}

	const sizes = {};
	for (const [sourceName, destName] of IMPORT_MAP) {
		const srcPath = path.join(sourceDir, sourceName);
		const destPath = path.join(elementsDir, destName);
		const geometry = await loadStl(srcPath);
		swapYZ(geometry);
		geometry.deleteAttribute('normal');
		geometry.computeVertexNormals();
		const stlBuffer = exportStlBinary(geometry);
		await fs.writeFile(destPath, stlBuffer);
		const key = destName.replace(/\.stl$/i, '');
		sizes[key] = measureFootprintMm(geometry);
		geometry.dispose();
		console.log(`Imported ${sourceName} → ${destName}`, sizes[key]);
	}

	console.log('\n--- stlSizeMm reference (width, length) ---');
	console.log(JSON.stringify(sizes, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const result = {
    inputDir: path.join(projectRoot, 'public', 'base', 'elements'),
    outputDir: path.join(projectRoot, 'public', 'base', 'elements-lowpoly'),
    ratio: 0.05,
    minTriangles: 2500,
    maxTriangles: 12000,
    include: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' && next) {
      result.inputDir = path.resolve(projectRoot, next);
      i += 1;
    } else if (arg === '--output' && next) {
      result.outputDir = path.resolve(projectRoot, next);
      i += 1;
    } else if (arg === '--ratio' && next) {
      result.ratio = Math.max(0.001, Math.min(1, Number(next)));
      i += 1;
    } else if (arg === '--min-triangles' && next) {
      result.minTriangles = Math.max(100, Math.round(Number(next)));
      i += 1;
    } else if (arg === '--max-triangles' && next) {
      result.maxTriangles = Math.max(100, Math.round(Number(next)));
      i += 1;
    } else if (arg === '--include' && next) {
      result.include = new Set(next.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
      i += 1;
    }
  }

  if (result.maxTriangles < result.minTriangles) {
    const temp = result.maxTriangles;
    result.maxTriangles = result.minTriangles;
    result.minTriangles = temp;
  }

  return result;
}

function getTriangleCount(geometry) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  return index ? index.count / 3 : position.count / 3;
}

function getVertexCount(geometry) {
  const position = geometry.getAttribute('position');
  return position ? position.count : 0;
}

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

async function loadStlGeometry(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const loader = new STLLoader();
  const geometry = loader.parse(bufferToArrayBuffer(fileBuffer));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function computeTargetTriangles(sourceTriangles, options) {
  if (sourceTriangles <= options.maxTriangles) {
    return sourceTriangles;
  }
  const byRatio = Math.max(1, Math.round(sourceTriangles * options.ratio));
  return Math.min(sourceTriangles, Math.max(options.minTriangles, Math.min(options.maxTriangles, byRatio)));
}

function simplifyByVertexClustering(sourceGeometry, cellSize) {
  const position = sourceGeometry.getAttribute('position');
  if (!position) {
    return sourceGeometry.clone();
  }

  const index = sourceGeometry.getIndex();
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const clusteredPositions = [];
  const clusterSums = new Map();
  const sourceVertexToCluster = new Int32Array(position.count);
  const sourceVertexKeys = new Array(position.count);

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const qx = Math.round(x / cellSize);
    const qy = Math.round(y / cellSize);
    const qz = Math.round(z / cellSize);
    const key = `${qx}|${qy}|${qz}`;
    sourceVertexKeys[i] = key;
    let cluster = clusterSums.get(key);
    if (!cluster) {
      cluster = { sumX: 0, sumY: 0, sumZ: 0, count: 0, index: clusterSums.size };
      clusterSums.set(key, cluster);
    }
    cluster.sumX += x;
    cluster.sumY += y;
    cluster.sumZ += z;
    cluster.count += 1;
    sourceVertexToCluster[i] = cluster.index;
  }

  clusteredPositions.length = clusterSums.size * 3;
  for (const cluster of clusterSums.values()) {
    const offset = cluster.index * 3;
    clusteredPositions[offset] = cluster.sumX / cluster.count;
    clusteredPositions[offset + 1] = cluster.sumY / cluster.count;
    clusteredPositions[offset + 2] = cluster.sumZ / cluster.count;
  }

  const nextIndices = [];
  const faceCount = triangleCount;
  for (let face = 0; face < faceCount; face += 1) {
    const ia = index ? index.getX(face * 3) : face * 3;
    const ib = index ? index.getX(face * 3 + 1) : face * 3 + 1;
    const ic = index ? index.getX(face * 3 + 2) : face * 3 + 2;
    const a = sourceVertexToCluster[ia];
    const b = sourceVertexToCluster[ib];
    const c = sourceVertexToCluster[ic];
    if (a === b || b === c || a === c) continue;
    nextIndices.push(a, b, c);
  }

  const simplified = new THREE.BufferGeometry();
  simplified.setAttribute('position', new THREE.Float32BufferAttribute(clusteredPositions, 3));
  simplified.setIndex(nextIndices);
  simplified.deleteAttribute('normal');
  simplified.computeVertexNormals();
  simplified.computeBoundingBox();
  simplified.computeBoundingSphere();
  return simplified;
}

function estimateInitialCellSize(geometry, targetTriangles) {
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) return 1;
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const sourceTriangles = Math.max(1, getTriangleCount(geometry));
  const reduction = Math.max(1, sourceTriangles / Math.max(1, targetTriangles));
  return maxDim / Math.max(8, Math.cbrt(sourceTriangles / reduction));
}

function simplifyGeometry(sourceGeometry, targetTriangles) {
  const sourceTriangles = getTriangleCount(sourceGeometry);
  if (sourceTriangles <= targetTriangles) {
    const clone = sourceGeometry.clone();
    clone.deleteAttribute('normal');
    clone.computeVertexNormals();
    clone.computeBoundingBox();
    clone.computeBoundingSphere();
    return clone;
  }

  let best = sourceGeometry.clone();
  let bestTriangles = sourceTriangles;
  let cellSize = estimateInitialCellSize(sourceGeometry, targetTriangles);

  for (let pass = 0; pass < 8; pass += 1) {
    const candidate = simplifyByVertexClustering(sourceGeometry, cellSize);
    const candidateTriangles = getTriangleCount(candidate);
    console.log(`  pass ${pass + 1}: cell=${cellSize.toFixed(5)} -> ${formatNumber(candidateTriangles)} triangles`);

    if (
      Math.abs(candidateTriangles - targetTriangles) < Math.abs(bestTriangles - targetTriangles) ||
      (bestTriangles > targetTriangles && candidateTriangles <= targetTriangles)
    ) {
      best.dispose();
      best = candidate;
      bestTriangles = candidateTriangles;
    } else {
      candidate.dispose();
    }

    if (candidateTriangles <= targetTriangles * 1.1 && candidateTriangles >= targetTriangles * 0.35) {
      break;
    }

    if (candidateTriangles > targetTriangles) {
      cellSize *= 1.6;
    } else {
      cellSize *= 0.8;
    }
  }

  best.deleteAttribute('normal');
  best.computeVertexNormals();
  best.computeBoundingBox();
  best.computeBoundingSphere();
  return best;
}

async function writeBinaryStl(geometry, outFile) {
  const exporter = new STLExporter();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshNormalMaterial());
  mesh.updateMatrixWorld(true);
  const output = exporter.parse(mesh, { binary: true });
  const buffer = Buffer.from(output);
  await fs.writeFile(outFile, buffer);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outputDir, { recursive: true });

  const entries = await fs.readdir(options.inputDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.stl'))
    .map((entry) => entry.name)
    .filter((name) => !options.include || options.include.has(name.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    console.log('No STL files found to simplify.');
    return;
  }

  const summary = [];

  for (const fileName of files) {
    const inputPath = path.join(options.inputDir, fileName);
    const outputPath = path.join(options.outputDir, fileName);
    console.log(`\nSimplifying ${fileName}...`);

    const sourceGeometry = await loadStlGeometry(inputPath);
    const sourceTriangles = getTriangleCount(sourceGeometry);
    const targetTriangles = computeTargetTriangles(sourceTriangles, options);
    console.log(`  source: ${formatNumber(sourceTriangles)} triangles, target: ${formatNumber(targetTriangles)}`);
    const simplifiedGeometry = simplifyGeometry(sourceGeometry, targetTriangles);
    const simplifiedTriangles = getTriangleCount(simplifiedGeometry);
    const reduction = sourceTriangles > 0 ? sourceTriangles / Math.max(1, simplifiedTriangles) : 1;

    await writeBinaryStl(simplifiedGeometry, outputPath);

    summary.push({
      file: fileName,
      sourceTriangles,
      targetTriangles,
      simplifiedTriangles,
      reduction,
    });

    console.log(
      `  ${formatNumber(sourceTriangles)} -> ${formatNumber(simplifiedTriangles)} triangles (${reduction.toFixed(1)}x reduction)`
    );

    sourceGeometry.dispose();
    simplifiedGeometry.dispose();
  }

  const manifestPath = path.join(options.outputDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        options: {
          inputDir: path.relative(projectRoot, options.inputDir),
          outputDir: path.relative(projectRoot, options.outputDir),
          ratio: options.ratio,
          minTriangles: options.minTriangles,
          maxTriangles: options.maxTriangles,
        },
        summary,
      },
      null,
      2
    )
  );

  console.log('\nDone.');
  console.table(
    summary.map((row) => ({
      file: row.file,
      sourceTriangles: row.sourceTriangles,
      simplifiedTriangles: row.simplifiedTriangles,
      reduction: `${row.reduction.toFixed(1)}x`,
    }))
  );
  console.log(`Manifest written to ${path.relative(projectRoot, manifestPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

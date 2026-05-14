#!/usr/bin/env node
/**
 * export-buildings.mjs
 *
 * Exports all 13 building types x 4 tiers from BuildingFactory to GLB files.
 * Output follows AssetManifest naming: buildings/{type}_t{tier}.glb
 *
 * Usage:
 *   node scripts/export-buildings.mjs
 *   node scripts/export-buildings.mjs --type mansion     # single type
 *   node scripts/export-buildings.mjs --tier 2           # single tier
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node.js polyfills required by Three.js GLTFExporter

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onloadend = null;
      this.onerror = null;
    }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        const evt = { target: this };
        if (this.onload) this.onload(evt);
        if (this.onloadend) this.onloadend(evt);
      }).catch((err) => {
        if (this.onerror) this.onerror(err);
        if (this.onloadend) this.onloadend({ target: this });
      });
    }
  };
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElementNS(_ns, tag) {
      if (tag === 'canvas') {
        return { width: 0, height: 0, getContext() { return null; } };
      }
      return {};
    },
  };
}

import * as THREE from 'three'; // eslint-disable-line
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

import { BuildingFactory } from '../src/town/buildings/BuildingFactory.js';

// Config

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'src', 'town', 'assets', 'buildings');

const BUILDING_NAMES = [
  'mansion', 'barracks', 'workshop', 'vault', 'dock',
  'forge', 'market', 'academy', 'arena',
  'sanctuary', 'observatory', 'treasury', 'citadel',
];

// Representative levels that produce each visual tier:
//   tier 1 (Foundation)  = level 3
//   tier 2 (Established) = level 8
//   tier 3 (Grand)       = level 15
//   tier 4 (Legendary)   = level 20
const TIER_LEVELS = [3, 8, 15, 20];

// CLI args

const args = process.argv.slice(2);
let filterType = null;
let filterTier = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--type' && args[i + 1]) filterType = args[++i];
  if (args[i] === '--tier' && args[i + 1]) filterTier = parseInt(args[++i], 10);
}

// Export

async function exportBuilding(exporter, factory, typeId, tierIdx) {
  const name = BUILDING_NAMES[typeId];
  const level = TIER_LEVELS[tierIdx];
  const filename = `${name}_t${tierIdx + 1}.glb`;

  const group = factory.createBuilding(typeId, level);

  // Strip the selection ring — not needed in the asset file
  const ring = group.getObjectByName('select-ring');
  if (ring) {
    ring.geometry?.dispose();
    ring.material?.dispose();
    group.remove(ring);
  }

  // Export to binary GLB
  const glb = await exporter.parseAsync(group, { binary: true });
  const buf = Buffer.from(glb);
  writeFileSync(join(OUT_DIR, filename), buf);

  // Stats
  let meshes = 0;
  let verts = 0;
  group.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      verts += o.geometry?.attributes?.position?.count || 0;
    }
  });

  const kb = (buf.byteLength / 1024).toFixed(1);
  console.log(
    `  ${filename.padEnd(26)} ${String(meshes).padStart(3)} meshes  ${String(verts).padStart(6)} verts  ${kb.padStart(7)} KB`
  );

  // Dispose geometry to free memory
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });

  return buf.byteLength;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const factory = new BuildingFactory({ baseUnit: 0.12, seed: 42 });
  const exporter = new GLTFExporter();

  console.log('Exporting building GLB files...');
  console.log(`Output: ${OUT_DIR}\n`);

  let exported = 0;
  let failed = 0;
  let totalBytes = 0;

  for (let typeId = 0; typeId < BUILDING_NAMES.length; typeId++) {
    const name = BUILDING_NAMES[typeId];
    if (filterType && name !== filterType) continue;

    console.log(`[${name}]`);

    for (let tierIdx = 0; tierIdx < 4; tierIdx++) {
      if (filterTier != null && tierIdx + 1 !== filterTier) continue;

      try {
        const bytes = await exportBuilding(exporter, factory, typeId, tierIdx);
        totalBytes += bytes;
        exported++;
      } catch (err) {
        console.error(`  FAILED: ${name}_t${tierIdx + 1}.glb — ${err.message}`);
        failed++;
      }
    }
  }

  const totalKB = (totalBytes / 1024).toFixed(1);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`\n${exported} files exported (${totalKB} KB / ${totalMB} MB total), ${failed} failed`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

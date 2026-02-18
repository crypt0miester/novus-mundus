#!/usr/bin/env node
/**
 * enhance-textures.mjs
 *
 * Enhances Tripo3D GLB textures by:
 *   1. Generating a normal map from the base color (Sobel filter)
 *   2. Generating an occlusion map (ambient detail from luminance)
 *   3. Setting PBR material properties (roughness, metallic)
 *   4. Optionally upscaling the base color texture
 *   5. Re-applying DRACO compression
 *
 * Usage:
 *   node scripts/enhance-textures.mjs                         # all GLBs
 *   node scripts/enhance-textures.mjs arena_t4.glb            # single file
 *   UPSCALE=2048 node scripts/enhance-textures.mjs            # upscale base color
 *   ROUGHNESS=0.6 METALLIC=0.1 node scripts/enhance-textures.mjs
 */

import { readFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import draco3d from 'draco3d';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILDINGS_DIR = join(__dirname, '..', 'src', 'town', 'assets', 'buildings');
const GLTF_BIN = join(__dirname, '..', 'node_modules', '.bin', 'gltf-transform');

// PBR defaults
const ROUGHNESS = parseFloat(process.env.ROUGHNESS ?? '0.65');
const METALLIC  = parseFloat(process.env.METALLIC  ?? '0.05');
const UPSCALE   = parseInt(process.env.UPSCALE ?? '0', 10); // 0 = no upscale
const NORMAL_STRENGTH = parseFloat(process.env.NORMAL_STRENGTH ?? '1.5');
const MAX_TEX = 512; // cap generated maps at this resolution

// ---------------------------------------------------------------------------
// Normal map generation — Sobel filter on grayscale
// ---------------------------------------------------------------------------

async function generateNormalMap(imageBuffer, strength = 1.5) {
  const meta = await sharp(imageBuffer).metadata();
  // Cap resolution for generated maps
  const targetW = Math.min(meta.width, MAX_TEX);
  const targetH = Math.min(meta.height, MAX_TEX);

  const gray = await sharp(imageBuffer)
    .resize(targetW, targetH, { kernel: 'lanczos3' })
    .grayscale()
    .raw()
    .toBuffer();

  const w = targetW;
  const h = targetH;
  const normalData = Buffer.alloc(w * h * 3);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;

      const tl = gray[Math.max(y-1,0) * w + Math.max(x-1,0)];
      const t  = gray[Math.max(y-1,0) * w + x];
      const tr = gray[Math.max(y-1,0) * w + Math.min(x+1,w-1)];
      const l  = gray[y * w + Math.max(x-1,0)];
      const r  = gray[y * w + Math.min(x+1,w-1)];
      const bl = gray[Math.min(y+1,h-1) * w + Math.max(x-1,0)];
      const b  = gray[Math.min(y+1,h-1) * w + x];
      const br = gray[Math.min(y+1,h-1) * w + Math.min(x+1,w-1)];

      const dX = (tr + 2*r + br) - (tl + 2*l + bl);
      const dY = (bl + 2*b + br) - (tl + 2*t + tr);

      let nx = -dX / 255 * strength;
      let ny = -dY / 255 * strength;
      let nz = 1.0;

      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      nx /= len; ny /= len; nz /= len;

      const outIdx = idx * 3;
      normalData[outIdx]     = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[outIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[outIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }

  return sharp(normalData, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Occlusion map — derived from grayscale luminance
// ---------------------------------------------------------------------------

async function generateOcclusionMap(imageBuffer) {
  const meta = await sharp(imageBuffer).metadata();
  const targetW = Math.min(meta.width, MAX_TEX);
  const targetH = Math.min(meta.height, MAX_TEX);
  const blurSigma = Math.max(3, Math.round(targetW / 100)) | 1;

  return sharp(imageBuffer)
    .resize(targetW, targetH, { kernel: 'lanczos3' })
    .grayscale()
    .blur(blurSigma)
    .normalize()
    .jpeg({ quality: 80 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Process a single GLB
// ---------------------------------------------------------------------------

let _io = null;
async function getIO() {
  if (_io) return _io;
  _io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
  return _io;
}

async function enhanceGLB(filepath) {
  const name = basename(filepath);
  const io = await getIO();

  const sizeBefore = readFileSync(filepath).byteLength;
  const doc = await io.read(filepath);
  const root = doc.getRoot();

  const materials = root.listMaterials();
  if (materials.length === 0) {
    console.log(`  SKIP ${name} — no materials`);
    return false;
  }

  let enhanced = false;
  let matCount = 0;

  for (const mat of materials) {
    mat.setRoughnessFactor(ROUGHNESS);
    mat.setMetallicFactor(METALLIC);

    const baseColorTex = mat.getBaseColorTexture();
    if (!baseColorTex) continue;

    let imageData = baseColorTex.getImage();
    if (!imageData) continue;

    matCount++;
    const size = baseColorTex.getSize();
    const w = size?.[0] ?? 512;
    const h = size?.[1] ?? 512;

    // Downscale oversized base color textures
    if (w > MAX_TEX || h > MAX_TEX) {
      const resized = await sharp(imageData)
        .resize(MAX_TEX, MAX_TEX, { kernel: 'lanczos3', fit: 'inside' })
        .jpeg({ quality: 85 })
        .toBuffer();
      baseColorTex.setImage(resized);
      baseColorTex.setMimeType('image/jpeg');
      imageData = resized;
    }

    // Upscale base color if requested
    if (UPSCALE > 0 && UPSCALE > w) {
      const upscaled = await sharp(imageData)
        .resize(UPSCALE, UPSCALE, { kernel: 'lanczos3' })
        .jpeg({ quality: 90 })
        .toBuffer();
      baseColorTex.setImage(upscaled);
      baseColorTex.setMimeType('image/jpeg');
      imageData = upscaled;
    }

    // Generate normal map (skip if already has one)
    if (!mat.getNormalTexture()) {
      const normalBuf = await generateNormalMap(imageData, NORMAL_STRENGTH);
      const normalTex = doc.createTexture(`normal_${matCount}`)
        .setImage(normalBuf)
        .setMimeType('image/jpeg');
      mat.setNormalTexture(normalTex);
      mat.setNormalScale(1.0);
    }

    // Generate occlusion map (skip if already has one)
    if (!mat.getOcclusionTexture()) {
      const aoBuf = await generateOcclusionMap(imageData);
      const aoTex = doc.createTexture(`ao_${matCount}`)
        .setImage(aoBuf)
        .setMimeType('image/jpeg');
      mat.setOcclusionTexture(aoTex);
      mat.setOcclusionStrength(0.8);
    }

    enhanced = true;
  }

  if (enhanced) {
    // Write without DRACO first (NodeIO re-encodes it)
    await io.write(filepath, doc);

    // Re-apply DRACO compression via CLI
    try {
      execFileSync(GLTF_BIN, ['draco', filepath, filepath], { stdio: 'pipe' });
    } catch { /* ignore if draco fails */ }

    const sizeAfter = readFileSync(filepath).byteLength;
    const kb = (sizeAfter / 1024).toFixed(0);
    console.log(`  ✓ ${name}  ${matCount} materials  ${kb} KB (was ${(sizeBefore/1024).toFixed(0)} KB)`);
  }

  return enhanced;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  console.log('=== GLB Texture Enhancer ===');
  console.log(`    roughness=${ROUGHNESS}  metallic=${METALLIC}  normalStrength=${NORMAL_STRENGTH}  upscale=${UPSCALE || 'off'}  maxTex=${MAX_TEX}`);
  console.log('');

  let files;
  if (args.length > 0) {
    files = args.map(a => join(BUILDINGS_DIR, a));
  } else {
    const { readdirSync } = await import('node:fs');
    files = readdirSync(BUILDINGS_DIR)
      .filter(f => f.endsWith('.glb'))
      .map(f => join(BUILDINGS_DIR, f));
  }

  let enhanced = 0;
  let skipped = 0;

  for (const file of files) {
    try {
      const result = await enhanceGLB(file);
      if (result) enhanced++;
      else skipped++;
    } catch (err) {
      console.error(`  ERROR ${basename(file)}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. ${enhanced} enhanced, ${skipped} skipped.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

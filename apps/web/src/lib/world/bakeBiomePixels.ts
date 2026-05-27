// Pure biome → RGBA pixel buffer bake. Worker-safe: no Three.js, no
// DOM, no React. The caller wraps the returned Uint8Array in a
// DataTexture on whichever thread owns the GPU.

import { biomeAt, biomeColor, type BiomeKnobs } from "novus-mundus-sdk";

export function bakeBiomePixels(
  biomeSeed: number,
  rgu: number,
  knobs: BiomeKnobs,
  texSize: number,
): Uint8Array {
  const data = new Uint8Array(texSize * texSize * 4);
  // Little-endian RGBA32 view over the same buffer: one packed u32
  // write per pixel beats four byte writes. Every shipping JS engine
  // runs little-endian, so the bytes land as [r, g, b, 255] for the
  // GPU to consume.
  const data32 = new Uint32Array(data.buffer);

  // Pre-compute the pixel→grid coord table once per axis. The integer
  // compare below lets us skip biomeAt when consecutive pixels resolve
  // to the same grid coord (the common case whenever texSize > 2*rgu).
  const stride = (2 * rgu) / texSize;
  const half = (texSize - 1) / 2;
  const grid = new Int32Array(texSize);
  for (let i = 0; i < texSize; i++) {
    grid[i] = Math.round((i - half) * stride);
  }

  // Full 256-entry biome palette. biomeAt only returns
  // 0..PROCEDURAL_BIOME_MAX for procedural cells today, but the
  // >=32 special-tile range is reserved (see biome.rs / biome.ts) and
  // biomeColor returns a neutral parchment-cream fallback for any
  // unrecognised ID. Sizing the palette to 256 means an unexpected
  // biome ID paints the fallback colour instead of a transparent
  // black hole from a Uint32Array OOB read.
  const palette = new Uint32Array(256);
  for (let b = 0; b < 256; b++) {
    const [r, g, bl] = biomeColor(b);
    palette[b] = (0xff << 24) | (bl << 16) | (g << 8) | r;
  }

  let prevOy = Number.NaN;
  let prevRowStart = -1;

  for (let py = 0; py < texSize; py++) {
    const oy = grid[py]!;
    const rowStart = py * texSize;

    // Identical-row shortcut: when this row's grid-y matches the
    // previous row's, the entire row of biome IDs is identical too —
    // a single memmove beats re-running biomeAt across the whole row.
    if (oy === prevOy && prevRowStart >= 0) {
      data32.copyWithin(rowStart, prevRowStart, prevRowStart + texSize);
      continue;
    }

    let prevOx = grid[0]!;
    let prevPacked = palette[biomeAt(biomeSeed, prevOx, oy, knobs)]!;
    data32[rowStart] = prevPacked;
    for (let px = 1; px < texSize; px++) {
      const ox = grid[px]!;
      if (ox !== prevOx) {
        prevPacked = palette[biomeAt(biomeSeed, ox, oy, knobs)]!;
        prevOx = ox;
      }
      data32[rowStart + px] = prevPacked;
    }

    prevOy = oy;
    prevRowStart = rowStart;
  }

  return data;
}

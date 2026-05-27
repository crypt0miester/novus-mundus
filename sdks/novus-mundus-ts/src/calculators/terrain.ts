/**
 * Terrain noise + grid helpers.
 *
 * After the flat-strategy cut this is the thin surviving slice of the
 * old elevation system. Anchor data, elevation/passability/moisture
 * sampling, the terrain affinity table, and elevation-to-colour
 * rendering all retired — biome is now a pure function of
 * (biome_seed, ox, oy); see `./biome.ts`.
 *
 * What lives here:
 *   - `toGrid`, `cityOffset` — coord quantization, matches Rust.
 *   - `noise()` — multi-octave integer noise (bit-identical to the
 *     Rust `logic::terrain::noise` family). Consumed by `./biome.ts`
 *     for its water / temperature / moisture channels.
 *
 * Drift between chain and SDK is caught by
 * `tests/fixtures/biome-vectors.json` (committed by the chain side,
 * asserted by `tests/unit/biome.test.ts`).
 */

export const GRID_PRECISION = 10_000;

// Coordinate helpers.

/** Convert geographic coordinate to grid units. Matches Rust `to_grid`. */
export function toGrid(coord: number): number {
  return Math.round(coord * GRID_PRECISION);
}

/** Compute (offsetX, offsetY) from city center. Matches Rust `city_offset`. */
export function cityOffset(
  gridLat: number,
  gridLong: number,
  cityLat: number,
  cityLong: number,
): [number, number] {
  return [gridLong - toGrid(cityLong), gridLat - toGrid(cityLat)];
}

// Integer noise (consumed by ./biome.ts).

function terrainHash(seed: number, x: number, y: number): number {
  let h = (seed ^ (x >>> 0) ^ rotateLeft(y >>> 0, 16)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x45D9F3B) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45D9F3B) >>> 0;
  h ^= h >>> 16;
  return h & 0xFF;
}

function rotateLeft(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

/** Smoothstep in fixed-point: t in 0..256, returns 0..256. */
function smoothstep256(t: number): number {
  return (t * t * (768 - 2 * t)) >>> 16;
}

/** Bilinear-interpolated octave with smoothstep. Returns 0..255. */
function smoothOctave(seed: number, x: number, y: number, shift: number): number {
  const s = 1 << shift;
  const gx = Math.floor(x / s);
  const gy = Math.floor(y / s);
  const fx = ((((x % s) + s) % s) * 256 / s) | 0;
  const fy = ((((y % s) + s) % s) * 256 / s) | 0;
  const v00 = terrainHash(seed, gx, gy);
  const v10 = terrainHash(seed, gx + 1, gy);
  const v01 = terrainHash(seed, gx, gy + 1);
  const v11 = terrainHash(seed, gx + 1, gy + 1);
  const tx = smoothstep256(fx);
  const ty = smoothstep256(fy);
  const itx = 256 - tx;
  const ity = 256 - ty;
  return ((v00 * itx * ity + v10 * tx * ity + v01 * itx * ty + v11 * tx * ty) / (256 * 256)) | 0;
}

/**
 * Multi-octave integer noise — three octaves blended 4:2:1.
 * Bit-identical to chain `logic::terrain::noise`. Consumed by
 * `./biome.ts` for water / temperature / moisture channels.
 */
export function noise(seed: number, x: number, y: number): number {
  const o1 = smoothOctave(seed, x, y, 10);
  const o2 = smoothOctave((seed ^ 0x9E3779B9) >>> 0, x, y, 7);
  const o3 = smoothOctave((seed ^ 0x517CC1B7) >>> 0, x, y, 4);
  return ((o1 * 4 + o2 * 2 + o3) / 7) | 0;
}

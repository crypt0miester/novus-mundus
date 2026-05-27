/**
 * Biome System — pure functions, framework-agnostic.
 *
 * Mirrors `programs/novus_mundus/src/logic/biome.rs` bit-for-bit.
 * Identical noise wraps + Whittaker lookup + affinity table; the
 * committed `tests/fixtures/biome-vectors.json` (default-knobs
 * procedural path) and `tests/fixtures/biome-vectors-knobs.json`
 * (curated knob presets), both generated chain-side, lock the contract.
 *
 * Biome is derived from three cheap integer-noise channels — water
 * mask, temperature, moisture — hashed against the city's `biomeSeed`.
 * Per-city `BiomeKnobs` *bend* those channels (climate biases, coast
 * gradient, landmass mask) without replacing them; all-zero knobs
 * reproduce the pre-knobs procedural sampler bit-for-bit. The water
 * mask fires first so passability checks match exactly what the
 * renderer paints; shore detection uses the same composite check so
 * mode-forced water (coast gradient, landmass mask) gets a real shore
 * strip instead of a hard edge. Inland cells fall through to a 4×4
 * Whittaker bucket on (temp + temp_bias, moisture + moisture_bias).
 *
 * Integer-only — no float math — so chain and TS sample the same
 * biome bit-for-bit.
 */

import { noise } from './terrain';

// Biome IDs.
// 0-31 are the procedural Whittaker / water / shore set.
// 32+ are reserved for special tiles (event arenas, faction shrines,
// quest sites) — written via override PDA.
// Consumers MUST treat biome >= 32 as a
// special-tile sentinel and look it up out-of-band.
export const BIOME_GRASS = 0;
export const BIOME_SAND = 1;
export const BIOME_SNOW = 2;
export const BIOME_DIRT = 3;
export const BIOME_WATER = 4;
export const BIOME_ROCK = 5;
export const BIOME_FOREST = 6;
export const BIOME_MARSH = 7;
export const BIOME_SHORE = 8;

export const PROCEDURAL_BIOME_MAX = BIOME_SHORE;

/** Typed alias for the biome ID byte. */
export type BiomeType = number;

// Noise channel seeds — XOR-mixed into the city seed so the three
// channels are decorrelated. Constants are arbitrary 32-bit primes;
// changing them invalidates the committed wire vector.
const WATER_SEED_OFFSET = 0xa5c3_7f19;
const TEMP_SEED_OFFSET = 0x1b7e_5c2d;
const MOIST_SEED_OFFSET = 0x6d31_9b4a;
// Landmass mask — fourth decorrelated noise stream used by the
// optional `landmassSeed` knob to carve organic island / archipelago
// shapes. Sampled at a coarse resolution so it produces a handful of
// city-scale blobs, not cell-scale speckle.
const LANDMASS_SEED_OFFSET = 0xb3f1_e2c5;
const LANDMASS_SEED_MIXER = 0x9e37_79b9;
const LANDMASS_COORD_SHIFT = 5;
const LANDMASS_LAND_THRESHOLD = 128;

/**
 * Cells with water_noise at-or-above this threshold are water.
 * Empirically tuned to ~38% water across the wire-vector seed sweep.
 * Must mirror `programs/novus_mundus/src/logic/biome.rs::WATER_THRESHOLD`
 * exactly — the wire vector locks the chain↔SDK contract.
 */
export const WATER_THRESHOLD = 156;

/**
 * Per-city biome knobs. Mirrors the Rust `BiomeKnobs` struct one-to-
 * one. All-zero (the default for any uninitialized city) reproduces
 * the pre-knobs procedural sampler bit-for-bit.
 *
 * - `waterLevelDelta` (i8) — signed shift of the global water
 *   threshold. Positive = less water (Cairo / Moscow inland).
 *   Negative = more water.
 * - `tempBias` (i8) — signed shift on temperature noise.
 * - `moistureBias` (i8) — signed shift on moisture noise.
 * - `coast` (u8) — directional gradient. 0 = none. 1..=8 = bearing
 *   the sea lies in (N/NE/E/SE/S/SW/W/NW).
 * - `landmassSeed` (u8) — landform mask seed. 0 = none. >0 carves
 *   organic island / archipelago shapes.
 */
export interface BiomeKnobs {
  waterLevelDelta: number;
  tempBias: number;
  moistureBias: number;
  coast: number;
  landmassSeed: number;
}

/** All-zero knobs — equivalent to the pre-knobs procedural sampler. */
export const BIOME_KNOBS_DEFAULT: Readonly<BiomeKnobs> = Object.freeze({
  waterLevelDelta: 0,
  tempBias: 0,
  moistureBias: 0,
  coast: 0,
  landmassSeed: 0,
});

// Whittaker lookup — 4×4 table indexed by [moistureBucket][tempBucket]
// where each bucket = byte / 64 ∈ [0, 3].
//
//                    cold ........ temp ........ hot
//             moist  | SNOW   FOREST  FOREST  MARSH
//                    | SNOW   GRASS   GRASS   MARSH
//                    | ROCK   GRASS   DIRT    SAND
//             arid   | ROCK   DIRT    SAND    SAND
//
// Row 0 = arid (bottom of diagram), row 3 = moist (top). WATER + SHORE
// are handled in earlier layers so this table only produces inland biomes.
const BIOME_TABLE: ReadonlyArray<ReadonlyArray<number>> = [
  [BIOME_ROCK, BIOME_DIRT, BIOME_SAND, BIOME_SAND],
  [BIOME_ROCK, BIOME_GRASS, BIOME_DIRT, BIOME_SAND],
  [BIOME_SNOW, BIOME_GRASS, BIOME_GRASS, BIOME_MARSH],
  [BIOME_SNOW, BIOME_FOREST, BIOME_FOREST, BIOME_MARSH],
];

/** True for every biome the player can stand on. Only water rejects. */
export function isPassableBiome(biome: BiomeType): boolean {
  return biome !== BIOME_WATER;
}

function waterNoise(seed: number, ox: number, oy: number): number {
  return noise((seed ^ WATER_SEED_OFFSET) >>> 0, ox, oy);
}

function temperatureNoise(seed: number, ox: number, oy: number): number {
  return noise((seed ^ TEMP_SEED_OFFSET) >>> 0, ox, oy);
}

function moistureNoise(seed: number, ox: number, oy: number): number {
  return noise((seed ^ MOIST_SEED_OFFSET) >>> 0, ox, oy);
}

/** Clamp helper — TS's lack of saturating arithmetic. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;

/** Clamp a Number into the i32 range. Mirrors Rust's saturating cast. */
function satI32(v: number): number {
  return v < I32_MIN ? I32_MIN : v > I32_MAX ? I32_MAX : Math.trunc(v);
}

/** i32 saturating multiply — JS Number multiplies in f64 (exact up to
 * 2^53), so we just compute and clamp. Mirrors `i32::saturating_mul`. */
function satI32Mul(a: number, b: number): number {
  return satI32(a * b);
}

/**
 * Project `(ox, oy)` onto the bearing direction and return a signed
 * bias to add to the water-noise channel. Mirrors chain
 * `coast_gradient`. 0 when `coast == 0` (no gradient).
 */
export function coastGradient(coast: number, ox: number, oy: number): number {
  if (coast === 0 || coast > 8) return 0;
  let dx = 0;
  let dy = 0;
  switch (coast) {
    case 1: dx = 0; dy = 1; break;
    case 2: dx = 1; dy = 1; break;
    case 3: dx = 1; dy = 0; break;
    case 4: dx = 1; dy = -1; break;
    case 5: dx = 0; dy = -1; break;
    case 6: dx = -1; dy = -1; break;
    case 7: dx = -1; dy = 0; break;
    case 8: dx = -1; dy = 1; break;
  }
  // Chain uses i32 saturating_mul/add throughout. For valid in-bounds
  // coords this always fits, but mirror the saturation so adversarial
  // or out-of-range inputs produce the same biome as chain rather
  // than a silently-divergent value.
  const raw = satI32(satI32Mul(ox, dx) + satI32Mul(oy, dy));
  // Normalize diagonals by 1/√2 (11585 / 16384) so all bearings have
  // the same gradient strength. Integer-only to match chain.
  const normalized =
    coast === 2 || coast === 4 || coast === 6 || coast === 8
      ? Math.trunc(satI32Mul(raw, 11585) / 16384)
      : raw;
  return clamp(Math.trunc(normalized / 64), -128, 128);
}

/**
 * Sample the low-octave landmass mask. Returns `true` if the cell
 * sits inside a landmass blob (defer to procedural sampler), `false`
 * if it falls in the sea (force water). When `landmassSeed === 0` the
 * mask is disabled and every cell reads as land. Mirrors chain
 * `landmass_is_land`.
 */
export function landmassIsLand(
  seed: number,
  landmassSeed: number,
  ox: number,
  oy: number,
): boolean {
  if (landmassSeed === 0) return true;
  // Chain: seed ^ (landmass_seed as u32).wrapping_mul(LANDMASS_SEED_MIXER)
  const mixed = (seed ^ (Math.imul(landmassSeed >>> 0, LANDMASS_SEED_MIXER) >>> 0)) >>> 0;
  // ox >> 5 and oy >> 5 — signed right shift matches Rust's i32 >>.
  const sx = ox >> LANDMASS_COORD_SHIFT;
  const sy = oy >> LANDMASS_COORD_SHIFT;
  const mask = noise((mixed ^ LANDMASS_SEED_OFFSET) >>> 0, sx, sy);
  return mask >= LANDMASS_LAND_THRESHOLD;
}

/** Composite water check used by both the self-cell and shore neighbour
 * checks. Sharing this between layers is what makes shore fire for
 * mode-forced water (landmass mask, coast gradient) rather than only
 * for the bare procedural water mask. */
function isWaterAt(
  seed: number,
  ox: number,
  oy: number,
  knobs: BiomeKnobs,
): boolean {
  if (!landmassIsLand(seed, knobs.landmassSeed, ox, oy)) return true;
  const base = waterNoise(seed, ox, oy);
  const bias = coastGradient(knobs.coast, ox, oy);
  const signal = clamp(base + bias, 0, 255);
  const threshold = clamp(WATER_THRESHOLD + knobs.waterLevelDelta, 0, 255);
  return signal >= threshold;
}

/** Saturating-add for u8 + i8 — mirrors Rust's `u8::saturating_add_signed`. */
function satAddSigned(u: number, i: number): number {
  return clamp(u + i, 0, 255);
}

/**
 * Sample the biome at `(ox, oy)` — offsets from the city centre in
 * grid units — given the city's `biomeSeed` and per-city `knobs`.
 * Pure function; identical output to the chain `biome::biome_at` by
 * construction.
 *
 * Cost: ~1 noise sample for water cells (early return), 5 for shore
 * cells (1 self + 4 neighbours), 7 for inland (5 + 2 Whittaker
 * channels). When `knobs.landmassSeed !== 0`, add one mask-noise
 * sample per is-water check.
 */
export function biomeAt(
  seed: number,
  ox: number,
  oy: number,
  knobs: BiomeKnobs = BIOME_KNOBS_DEFAULT,
): BiomeType {
  if (isWaterAt(seed, ox, oy, knobs)) return BIOME_WATER;
  // Shore — any orthogonal neighbour being water (procedural,
  // coast-forced, or landmass-forced) tips this cell into BIOME_SHORE.
  // Chain order: W, E, N, S. Unrolled because this is on a 16M-pixel
  // bake's hot path and the array+iterator allocation dominated GC.
  if (isWaterAt(seed, ox - 1, oy, knobs)) return BIOME_SHORE;
  if (isWaterAt(seed, ox + 1, oy, knobs)) return BIOME_SHORE;
  if (isWaterAt(seed, ox, oy - 1, knobs)) return BIOME_SHORE;
  if (isWaterAt(seed, ox, oy + 1, knobs)) return BIOME_SHORE;
  // Whittaker bucket with climate biases.
  const t = satAddSigned(temperatureNoise(seed, ox, oy), knobs.tempBias);
  const m = satAddSigned(moistureNoise(seed, ox, oy), knobs.moistureBias);
  return BIOME_TABLE[(m / 64) | 0]![(t / 64) | 0]!;
}

// Affinity. `miningBps`/`fishingBps` feed collect_resources at the
// player's cell. `combatBps` is signed attacker-vs-defender (positive
// means an attacker on this biome gets a damage bonus).
export interface BiomeAffinity {
  miningBps: number;
  fishingBps: number;
  combatBps: number;
}

const NO_AFFINITY: BiomeAffinity = { miningBps: 0, fishingBps: 0, combatBps: 0 };

/** Mirrors the chain `biome_affinity` const table 1-for-1. */
export function biomeAffinity(biome: BiomeType): BiomeAffinity {
  switch (biome) {
    case BIOME_GRASS:
      return NO_AFFINITY;
    case BIOME_SAND:
      return { miningBps: 0, fishingBps: 0, combatBps: 300 };
    case BIOME_SNOW:
      return { miningBps: 750, fishingBps: 0, combatBps: -200 };
    case BIOME_DIRT:
      return { miningBps: 500, fishingBps: 0, combatBps: 0 };
    case BIOME_WATER:
      return NO_AFFINITY;
    case BIOME_ROCK:
      return { miningBps: 1500, fishingBps: 0, combatBps: 200 };
    case BIOME_FOREST:
      return { miningBps: 250, fishingBps: 250, combatBps: -300 };
    case BIOME_MARSH:
      return { miningBps: 0, fishingBps: 1000, combatBps: -400 };
    case BIOME_SHORE:
      return { miningBps: 0, fishingBps: 1500, combatBps: -100 };
    default:
      return NO_AFFINITY;
  }
}

// Palette — sRGB triples for the renderer. Stays in the project's
// parchment+sepia gamut (no saturated greens, no cyan-bright water);
// matches the vocabulary the retired `elevationToColor` used.
const BIOME_COLOR_TABLE: ReadonlyArray<readonly [number, number, number]> = [
  // GRASS — muted olive-tan
  [148, 152, 105],
  // SAND — warm pale tan
  [218, 200, 160],
  // SNOW — pale cream
  [232, 224, 200],
  // DIRT — sepia brown
  [165, 130, 88],
  // WATER — desaturated slate-blue
  [120, 145, 165],
  // ROCK — dark stone-grey
  [110, 100, 90],
  // FOREST — muted dark olive
  [95, 105, 70],
  // MARSH — swampy olive-brown
  [115, 110, 75],
  // SHORE — sand-meets-water warm grey
  [195, 185, 155],
];

/** Map a biome ID to an sRGB triple. Unknown biomes (>= 32 reserved
 * tile IDs) fall back to a neutral parchment cream so they read as
 * "something special" without breaking the renderer. */
export function biomeColor(biome: BiomeType): readonly [number, number, number] {
  if (biome >= 0 && biome <= PROCEDURAL_BIOME_MAX) {
    return BIOME_COLOR_TABLE[biome]!;
  }
  return [220, 205, 175];
}

/** Full palette array, indexed by biome ID. Read-only by design. */
export const biomePalette: ReadonlyArray<readonly [number, number, number]> = BIOME_COLOR_TABLE;

/** Human-readable biome names. Used by hover labels. */
const BIOME_NAME_TABLE: ReadonlyArray<string> = [
  'grass',
  'sand',
  'snow',
  'dirt',
  'water',
  'rock',
  'forest',
  'marsh',
  'shore',
];

/** Lowercase biome name for UI hover labels. */
export function biomeName(biome: BiomeType): string {
  if (biome >= 0 && biome <= PROCEDURAL_BIOME_MAX) {
    return BIOME_NAME_TABLE[biome]!;
  }
  return 'special';
}

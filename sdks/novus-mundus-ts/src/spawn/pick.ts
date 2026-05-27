/**
 * Spawn picker — choose a passable, interesting cell inside a city.
 *
 * The on-chain init_player checks passability but doesn't help the client
 * find a *good* spawn — it just rejects bad ones. Without a smart picker, the
 * web and CLI either send the raw city center (often water for coastal cities,
 * or stacks every player on one pixel) or walk a linear offset (drifts into
 * impassable terrain). This module fixes both.
 *
 * Algorithm — uniform AABB sample, biome-aware score, top-K weighted pick:
 *   1. Sample N candidate cells uniformly inside the city's square plot.
 *   2. Drop water cells (mirrors on-chain `is_passable_biome` exactly).
 *   3. Score survivors by biome affinity + city-type bias.
 *   4. Take the top K, weighted-random one.
 *   5. Tag the chosen cell with a `flavor` and `bearing` for narration.
 *
 * Fresh-random: every call uses `Math.random()`, no seed input. Retrying gets
 * a different cell — by design.
 */

import {
  biomeAffinity,
  biomeAt,
  BIOME_FOREST,
  BIOME_MARSH,
  BIOME_ROCK,
  BIOME_SHORE,
  BIOME_SNOW,
  BIOME_WATER,
  isPassableBiome,
  type BiomeKnobs,
  type BiomeType,
} from '../calculators/biome';
import { GRID_PRECISION } from '../calculators/terrain';

// Public types.

export type SpawnFlavor =
  | 'coast'
  | 'foothill'
  | 'grove'
  | 'plain'
  | 'frontier'
  | 'crossroads';

export type SpawnBearing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface CityForSpawn {
  cityId: number;
  latitude: number;
  longitude: number;
  /** Square plot X extent in grid units (centred AABB). */
  widthGrid: number;
  /** Square plot Y extent in grid units. */
  heightGrid: number;
  /** Biome noise seed for biomeAt sampling. */
  biomeSeed: number;
  /** 0 Capital, 1 Resource, 2 Combat, 3 Trade — matches CityType enum. */
  cityType: number;
  /** Per-city biome knobs. REQUIRED — sampling with the wrong knobs
   * produces "passable" cells the chain rejects as water. Project a
   * CityAccount via `biomeKnobsFromCity`. */
  knobs: BiomeKnobs;
}

export interface SpawnContext {
  /** Optional anti-cluster signal — known nearby player positions. */
  occupiedSampled?: ReadonlyArray<{ lat: number; long: number }>;
}

export interface SpawnCandidate {
  lat: number;
  long: number;
  flavor: SpawnFlavor;
  bearing: SpawnBearing;
}

export interface SpawnResult extends SpawnCandidate {
  /** Up to 2 other strong candidates — for a future "pick your arrival" UI. */
  alternates: SpawnCandidate[];
}

// Tuning.

const CANDIDATE_COUNT = 64;
const TOP_K = 5;
/** Max retries when biome layout produces an unusually low yield of land cells. */
const MAX_RESAMPLE = 2;

// Algorithm.

export function pickSpawn(city: CityForSpawn, ctx: SpawnContext = {}): SpawnResult {
  let scored = sampleAndScore(city, ctx, CANDIDATE_COUNT);

  for (let attempt = 0; attempt < MAX_RESAMPLE && scored.length < TOP_K; attempt++) {
    const extra = sampleAndScore(city, ctx, CANDIDATE_COUNT);
    scored = scored.concat(extra);
  }

  if (scored.length === 0) {
    throw new Error(
      `No passable spawn cells found in city ${city.cityId}. The biome layout may be all-water — try a different biomeSeed.`,
    );
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(TOP_K, scored.length));

  const chosen = weightedPick(top);

  const result = toCandidate(city, chosen);
  const alternates = top
    .filter((c) => c !== chosen)
    .slice(0, 2)
    .map((c) => toCandidate(city, c));

  return { ...result, alternates };
}

// Internals.

interface Scored {
  ox: number;
  oy: number;
  score: number;
  flavor: SpawnFlavor;
  biome: BiomeType;
}

function sampleAndScore(city: CityForSpawn, ctx: SpawnContext, n: number): Scored[] {
  const out: Scored[] = [];
  const halfW = city.widthGrid / 2;
  const halfH = city.heightGrid / 2;
  // Normalise against the AABB diagonal so corners reach distNorm == 1
  // without clamping. Using min(halfW, halfH) plateaued ~30% of cells
  // (the corner triangles outside the inscribed circle) at distNorm=1
  // and collapsed cityType=2/3 linear biases into step functions.
  const radiusForNorm = Math.sqrt(halfW * halfW + halfH * halfH);
  const knobs = city.knobs;

  for (let i = 0; i < n; i++) {
    // Uniform AABB sample — pick (ox, oy) uniformly in [-halfW, halfW] ×
    // [-halfH, halfH]. Simple, matches the square plot exactly.
    const ox = Math.round((Math.random() * 2 - 1) * halfW);
    const oy = Math.round((Math.random() * 2 - 1) * halfH);

    const biome = biomeAt(city.biomeSeed, ox, oy, knobs);
    if (!isPassableBiome(biome)) continue;

    const dist = Math.sqrt(ox * ox + oy * oy);
    const distNorm = radiusForNorm > 0 ? dist / radiusForNorm : 0;
    const flavor = flavorOf(city.biomeSeed, ox, oy, biome, distNorm, knobs);
    const score = scoreCandidate(city, ctx, ox, oy, biome, distNorm);

    out.push({ ox, oy, score, flavor, biome });
  }
  return out;
}

function scoreCandidate(
  city: CityForSpawn,
  ctx: SpawnContext,
  ox: number,
  oy: number,
  biome: BiomeType,
  distNorm: number,
): number {
  let score = 0;

  // Biome affinity — coasts (fishing) and rock/snow (mining) are inherently
  // more interesting than featureless grass. Both bonuses peak at 1500 bps.
  const aff = biomeAffinity(biome);
  score += aff.miningBps * 0.2;
  score += aff.fishingBps * 0.2;

  // Edge bonus — cells with a water neighbour are shorelines; with a forest
  // / rock neighbour are biome edges. Both photograph well and give the
  // narrator something concrete to point at.
  if (isBiomeEdge(city.biomeSeed, ox, oy, city.knobs)) {
    score += 400;
  }

  // City-type positional bias.
  score += cityTypeBias(city.cityType, distNorm) * 600;

  // Anti-cluster — soft penalty when the candidate is near a known existing
  // player. Only fires if the caller supplied occupied positions.
  if (ctx.occupiedSampled?.length) {
    for (const o of ctx.occupiedSampled) {
      const oxx = Math.round((o.long - city.longitude) * GRID_PRECISION);
      const oyy = Math.round((o.lat - city.latitude) * GRID_PRECISION);
      const dx = ox - oxx;
      const dy = oy - oyy;
      const d2 = dx * dx + dy * dy;
      // Penalty within ~1 km (≈ 90 grid units → 8100 squared).
      if (d2 < 8100) {
        score -= (8100 - d2) * 0.05;
      }
    }
  }

  return score;
}

function cityTypeBias(cityType: number, distNorm: number): number {
  // distNorm ∈ [0, 1] — 0 at city center, 1 at radius edge.
  switch (cityType) {
    case 0: // Capital — mid-ring.
      return 1 - Math.abs(distNorm - 0.4) * 2;
    case 1: // Resource — let biome affinity drive; no positional bias.
      return 0;
    case 2: // Combat — bias toward the frontier.
      return distNorm * 2 - 1;
    case 3: // Trade — bias toward centre (markets, not citadels).
      return 1 - distNorm * 2;
    default:
      return 0;
  }
}

function isBiomeEdge(seed: number, ox: number, oy: number, knobs: BiomeKnobs): boolean {
  const here = biomeAt(seed, ox, oy, knobs);
  const right = biomeAt(seed, ox + 1, oy, knobs);
  const left = biomeAt(seed, ox - 1, oy, knobs);
  const up = biomeAt(seed, ox, oy + 1, knobs);
  const down = biomeAt(seed, ox, oy - 1, knobs);
  return right !== here || left !== here || up !== here || down !== here;
}

function flavorOf(
  seed: number,
  ox: number,
  oy: number,
  biome: BiomeType,
  distNorm: number,
  knobs: BiomeKnobs,
): SpawnFlavor {
  // Biome-specific dominant flavors first.
  if (biome === BIOME_SHORE) return 'coast';
  if (biome === BIOME_FOREST) return 'grove';
  if (biome === BIOME_ROCK || biome === BIOME_SNOW) return 'foothill';
  // Adjacent-water / adjacent-rock-or-snow as fallback for inland biomes.
  const neighbours = [
    biomeAt(seed, ox + 1, oy, knobs),
    biomeAt(seed, ox - 1, oy, knobs),
    biomeAt(seed, ox, oy + 1, knobs),
    biomeAt(seed, ox, oy - 1, knobs),
  ];
  if (neighbours.includes(BIOME_WATER)) return 'coast';
  if (neighbours.some((b) => b === BIOME_ROCK || b === BIOME_SNOW)) return 'foothill';
  if (biome === BIOME_MARSH) return 'coast';
  // Position-based flavors for featureless interior cells.
  if (distNorm < 0.15) return 'crossroads';
  if (distNorm > 0.75) return 'frontier';
  return 'plain';
}

function bearingFrom(ox: number, oy: number): SpawnBearing {
  if (ox === 0 && oy === 0) return 'N';
  const deg = (Math.atan2(oy, ox) * 180) / Math.PI;
  const norm = (deg + 360) % 360;
  const slice = Math.floor((norm + 22.5) / 45) % 8;
  return (['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const)[slice]!;
}

function weightedPick<T>(items: T[]): T {
  const n = items.length;
  const total = (n * (n + 1)) / 2;
  let r = Math.random() * total;
  for (let i = 0; i < n; i++) {
    r -= n - i;
    if (r <= 0) return items[i]!;
  }
  return items[n - 1]!;
}

function toCandidate(city: CityForSpawn, s: Scored): SpawnCandidate {
  return {
    lat: city.latitude + s.oy / GRID_PRECISION,
    long: city.longitude + s.ox / GRID_PRECISION,
    flavor: s.flavor,
    bearing: bearingFrom(s.ox, s.oy),
  };
}

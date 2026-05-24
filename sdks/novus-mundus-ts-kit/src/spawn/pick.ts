/**
 * Spawn picker — choose a passable, interesting cell inside a city.
 *
 * The on-chain init_player checks passability but doesn't help the client
 * find a *good* spawn — it just rejects bad ones. Without a smart picker, the
 * web and CLI either send the raw city center (often water for coastal cities,
 * or stacks every player on one pixel) or walk a linear offset (drifts into
 * impassable terrain). This module fixes both.
 *
 * Algorithm — uniform-disk sample, terrain-aware score, top-K weighted pick:
 *   1. Sample N candidate cells uniformly inside the city's radius.
 *   2. Drop impassable cells (mirrors on-chain `is_passable` exactly).
 *   3. Score survivors by terrain affinity + city-type bias.
 *   4. Take the top K, weighted-random one.
 *   5. Tag the chosen cell with a `flavor` and `bearing` for narration.
 *
 * Fresh-random: every call uses `Math.random()`, no seed input. Retrying gets
 * a different cell — by design.
 */

import {
  type CityTerrain,
  isPassable,
  sampleTerrain,
  terrainAffinity,
  radiusToGridUnits,
  GRID_PRECISION,
} from "../calculators/terrain";

// Public types

export type SpawnFlavor =
  | "coast"
  | "foothill"
  | "grove"
  | "plain"
  | "frontier"
  | "crossroads";

export type SpawnBearing = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export interface CityForSpawn {
  cityId: number;
  latitude: number;
  longitude: number;
  radiusKm: number;
  /** 0 Capital, 1 Resource, 2 Combat, 3 Trade — matches CityType enum. */
  cityType: number;
  terrain: CityTerrain;
}

export interface SpawnContext {
  /** Optional anti-cluster signal — known nearby player positions. v1 callers may omit. */
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

// Tuning

const CANDIDATE_COUNT = 64;
const TOP_K = 5;
/** Max retries when terrain produces an unusually low yield of passable cells. */
const MAX_RESAMPLE = 2;

// Algorithm

export function pickSpawn(city: CityForSpawn, ctx: SpawnContext = {}): SpawnResult {
  const radiusGrid = radiusToGridUnits(city.radiusKm, city.latitude);

  let scored = sampleAndScore(city, ctx, radiusGrid, CANDIDATE_COUNT);

  for (let attempt = 0; attempt < MAX_RESAMPLE && scored.length < TOP_K; attempt++) {
    const extra = sampleAndScore(city, ctx, radiusGrid, CANDIDATE_COUNT);
    scored = scored.concat(extra);
  }

  if (scored.length === 0) {
    throw new Error(
      `No passable spawn cells found in city ${city.cityId}. Terrain may be impassable everywhere — check water_line/peak_line.`,
    );
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(TOP_K, scored.length));

  // Weighted-random over the top K. Top entry weighted highest, falling off
  // linearly. Keeps spawns spread without sacrificing best-of-rank.
  const chosen = weightedPick(top);

  const result = toCandidate(city, chosen);
  const alternates = top
    .filter((c) => c !== chosen)
    .slice(0, 2)
    .map((c) => toCandidate(city, c));

  return { ...result, alternates };
}

// Internals

interface Scored {
  ox: number;
  oy: number;
  score: number;
  flavor: SpawnFlavor;
}

function sampleAndScore(
  city: CityForSpawn,
  ctx: SpawnContext,
  radiusGrid: number,
  n: number,
): Scored[] {
  const out: Scored[] = [];
  for (let i = 0; i < n; i++) {
    // Uniform-in-disk: r = sqrt(u) * radius; theta = u * 2π. Without sqrt
    // points would clump at the center.
    const r = Math.sqrt(Math.random()) * radiusGrid;
    const theta = Math.random() * 2 * Math.PI;
    const ox = Math.round(r * Math.cos(theta));
    const oy = Math.round(r * Math.sin(theta));

    if (!isPassable(city.terrain, ox, oy)) continue;

    const distNorm = r / radiusGrid;
    const flavor = flavorOf(city.terrain, ox, oy, distNorm);
    const score = scoreCandidate(city, ctx, ox, oy, distNorm);

    out.push({ ox, oy, score, flavor });
  }
  return out;
}

function scoreCandidate(
  city: CityForSpawn,
  ctx: SpawnContext,
  ox: number,
  oy: number,
  distNorm: number,
): number {
  let score = 0;

  // Terrain affinity — coasts and foothills are inherently more interesting
  // than featureless plains. Both bonuses peak at 1500 bps.
  const affinity = terrainAffinity(city.terrain, ox, oy);
  score += affinity.miningBps * 0.2;
  score += affinity.fishingBps * 0.2;

  // Edge bonus — cells with an impassable neighbor are shorelines and
  // mountain bases, which photograph well and give the narrator something
  // concrete to point at.
  if (isTerrainEdge(city.terrain, ox, oy)) {
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
      // Penalty within ~1km (≈ 90 grid units → 8100 squared).
      if (d2 < 8100) {
        score -= (8100 - d2) * 0.05;
      }
    }
  }

  return score;
}

function cityTypeBias(cityType: number, distNorm: number): number {
  // distNorm ∈ [0, 1] — 0 at city center, 1 at radius edge.
  // Returns roughly -1..+1; multiplied by a weight in scoreCandidate.
  switch (cityType) {
    case 0: // Capital — mid-ring (not throne room, not frontier).
      return 1 - Math.abs(distNorm - 0.4) * 2;
    case 1: // Resource — let terrain affinity drive; no positional bias.
      return 0;
    case 2: // Combat — bias toward the frontier.
      return distNorm * 2 - 1;
    case 3: // Trade — bias toward center (markets, not citadels).
      return 1 - distNorm * 2;
    default:
      return 0;
  }
}

function isTerrainEdge(terrain: CityTerrain, ox: number, oy: number): boolean {
  // Sample the four cardinal neighbors. If any is impassable, this cell is
  // on a terrain transition.
  if (!sampleTerrain(terrain, ox + 1, oy).isPassable) return true;
  if (!sampleTerrain(terrain, ox - 1, oy).isPassable) return true;
  if (!sampleTerrain(terrain, ox, oy + 1).isPassable) return true;
  if (!sampleTerrain(terrain, ox, oy - 1).isPassable) return true;
  return false;
}

function flavorOf(
  terrain: CityTerrain,
  ox: number,
  oy: number,
  distNorm: number,
): SpawnFlavor {
  // Adjacent-water / adjacent-mountain dominate — those are the strongest
  // visual signals on the map. Position-based flavors only apply on
  // featureless interior cells.
  const right = sampleTerrain(terrain, ox + 1, oy);
  const left = sampleTerrain(terrain, ox - 1, oy);
  const up = sampleTerrain(terrain, ox, oy + 1);
  const down = sampleTerrain(terrain, ox, oy - 1);

  if (right.isWater || left.isWater || up.isWater || down.isWater) return "coast";
  if (right.isMountain || left.isMountain || up.isMountain || down.isMountain) {
    return "foothill";
  }

  const here = sampleTerrain(terrain, ox, oy);
  if ((here.moisture ?? 128) > 180) return "grove";

  if (distNorm < 0.15) return "crossroads";
  if (distNorm > 0.75) return "frontier";
  return "plain";
}

function bearingFrom(ox: number, oy: number): SpawnBearing {
  // ox = east offset (longitude grid units), oy = north offset (latitude grid units).
  // atan2(north, east) → 0 = E, π/2 = N, π = W, -π/2 = S.
  if (ox === 0 && oy === 0) return "N";
  const deg = (Math.atan2(oy, ox) * 180) / Math.PI;
  const norm = (deg + 360) % 360;
  const slice = Math.floor((norm + 22.5) / 45) % 8;
  // slice 0 = E, 1 = NE, 2 = N, 3 = NW, 4 = W, 5 = SW, 6 = S, 7 = SE
  return (["E", "NE", "N", "NW", "W", "SW", "S", "SE"] as const)[slice]!;
}

function weightedPick<T>(items: T[]): T {
  // Linear weights: first item gets weight items.length, last gets 1.
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

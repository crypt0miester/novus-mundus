/**
 * Phase 8 — Castles (full per-city tier ladder)
 *
 * Castles are keyed [city_id, castle_id] on-chain, so every city gets a full
 * Outpost..Citadel ladder (castle_id == tier). This phase iterates the whole
 * CASTLES roster and resolves each one's anchor independently — see
 * cli/data/castles.ts for the placement model.
 */

import { type CLIContext } from '../context';
import {
  accountExists,
  createOrSkip,
  newStats,
  type PhaseStats,
} from '../helpers';
import {
  biomeAt,
  isPassableBiome,
  createCreateCastleInstruction,
  deriveCastlePda,
  parseCastle,
  toGrid,
  CASTLE_ATTACK_RANGE_METERS,
  type BiomeKnobs,
} from '../../../src/index';
import { CASTLES, defaultFootprintForTier } from '../../data/castles';
import { CITIES } from '../../data/cities';
import {
  section, table, bold, dim, green, red, yellow, formatNum, addr,
  check, statusBadge,
} from '../format';

interface AnchorResolution {
  latitude: number;
  longitude: number;
  /** Reachable cardinal sides (0-4) at the chosen anchor — 4 means a player
   *  can stand within attack range on every side. < 4 means the spot is
   *  water-locked on some side (no better one existed; surfaced as a warning). */
  reachableSides: number;
}

// When the hint / first-fit lands on a coastline, keep spiralling inward up to
// this many extra rings hunting a fully-surroundable footprint before falling
// back to the most-open spot found. ~80 grid cells ≈ 0.9 km — far enough to
// step off any normal shoreline, bounded so a near-all-water plot doesn't scan
// the whole grid.
const BUFFER_SEARCH_EXTRA = 80;

/**
 * Resolve a castle's anchor (grid lat / lon) so its N×N footprint lands on
 * passable land AND is ringed by enough passable land that attackers can stand
 * within `CASTLE_ATTACK_RANGE_METERS` on every side. Without the buffer the old
 * search stopped at the FIRST passable cell — almost always right on a coastline
 * — leaving the castle water-locked: `attack_castle` rejects anyone who can't
 * get within range of a footprint cell, so a sea-bound side is unattackable and
 * players literally cannot move around it.
 *
 * Order:
 *   1. the authored hint if it fits AND is fully surroundable (preserves
 *      curated placements like Tower of London east of central London);
 *   2. the CLOSEST fully-surroundable footprint spiralling out from the hint;
 *   3. if none exists nearby (a genuine islet), the most-open footprint found
 *      (max reachable sides) so init still succeeds — the caller warns on < 4.
 *
 * The spiral skips the city centre cell (spawn point) so it never stomps
 * `init_player`'s first LocationAccount claim. Buffer cells beyond the plot edge
 * are not required — the border is land-adjacent, not water-locked.
 *
 * `bufLon`/`bufLat` are the attack range expressed in grid cells per axis
 * (longitude needs more cells than latitude because longitude degrees shrink
 * with latitude).
 */
function resolveCastleAnchor(
  cityLatGrid: number,
  cityLongGrid: number,
  cityHalfWidth: number,
  cityHalfHeight: number,
  biomeSeed: number,
  knobs: BiomeKnobs,
  footprint: number,
  hintLatGrid: number,
  hintLongGrid: number,
  bufLon: number,
  bufLat: number,
): AnchorResolution | null {
  const hintOx = hintLongGrid - cityLongGrid;
  const hintOy = hintLatGrid - cityLatGrid;

  const passable = (ox: number, oy: number): boolean =>
    isPassableBiome(biomeAt(biomeSeed, ox, oy, knobs));

  const footprintFits = (ox: number, oy: number): boolean => {
    // AABB containment — anchor + (N-1) must stay inside the half-extent.
    if (ox < -cityHalfWidth || ox + footprint - 1 > cityHalfWidth) return false;
    if (oy < -cityHalfHeight || oy + footprint - 1 > cityHalfHeight) return false;
    // Skip the spawn cell at (0, 0) so the player can land there.
    for (let dx = 0; dx < footprint; dx++) {
      for (let dy = 0; dy < footprint; dy++) {
        if (ox + dx === 0 && oy + dy === 0) return false;
      }
    }
    // Every footprint cell must be passable.
    for (let dx = 0; dx < footprint; dx++) {
      for (let dy = 0; dy < footprint; dy++) {
        if (!passable(ox + dx, oy + dy)) return false;
      }
    }
    return true;
  };

  // Count cardinal sides (0-4) with a passable cell within attack range
  // straight out from each face of the footprint.
  const reachableSides = (ox: number, oy: number): number => {
    let sides = 0;
    for (let k = 1; k <= bufLon; k++) if (passable(ox + footprint - 1 + k, oy)) { sides++; break; }
    for (let k = 1; k <= bufLon; k++) if (passable(ox - k, oy)) { sides++; break; }
    for (let k = 1; k <= bufLat; k++) if (passable(ox, oy + footprint - 1 + k)) { sides++; break; }
    for (let k = 1; k <= bufLat; k++) if (passable(ox, oy - k)) { sides++; break; }
    return sides;
  };

  // Every buffer-ring cell that lies inside the plot is passable — attackers
  // can stand on any side. Cells past the plot edge are skipped, not failed.
  const fullySurroundable = (ox: number, oy: number): boolean => {
    for (let dx = -bufLon; dx < footprint + bufLon; dx++) {
      for (let dy = -bufLat; dy < footprint + bufLat; dy++) {
        const inFoot = dx >= 0 && dx < footprint && dy >= 0 && dy < footprint;
        if (inFoot) continue;
        const cox = ox + dx;
        const coy = oy + dy;
        if (cox < -cityHalfWidth || cox > cityHalfWidth) continue;
        if (coy < -cityHalfHeight || coy > cityHalfHeight) continue;
        if (!passable(cox, coy)) return false;
      }
    }
    return true;
  };

  // 1. Authored hint, only if it's already fully surroundable.
  if (footprintFits(hintOx, hintOy) && fullySurroundable(hintOx, hintOy)) {
    return { latitude: hintLatGrid, longitude: hintLongGrid, reachableSides: 4 };
  }

  // 2 + 3. Spiral out. Return the closest fully-surroundable fit; otherwise
  // keep the most-open fit seen and return it once the bounded window is spent.
  const maxRadius = Math.min(cityHalfWidth, cityHalfHeight);
  let bestOx = 0;
  let bestOy = 0;
  let bestSides = -1;
  let deadline = maxRadius;
  for (let r = 1; r <= maxRadius && r <= deadline; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const ox = hintOx + dx;
        const oy = hintOy + dy;
        if (!footprintFits(ox, oy)) continue;
        // First land reached — bound the rest of the search so a mostly-water
        // plot doesn't scan the whole grid hunting a buffer that isn't there.
        if (bestSides < 0) deadline = Math.min(maxRadius, r + BUFFER_SEARCH_EXTRA);
        const sides = reachableSides(ox, oy);
        if (sides === 4 && fullySurroundable(ox, oy)) {
          return { latitude: cityLatGrid + oy, longitude: cityLongGrid + ox, reachableSides: 4 };
        }
        if (sides > bestSides) {
          bestSides = sides;
          bestOx = ox;
          bestOy = oy;
        }
      }
    }
  }
  if (bestSides >= 0) {
    return { latitude: cityLatGrid + bestOy, longitude: cityLongGrid + bestOx, reachableSides: bestSides };
  }
  return null;
}

export async function initCastles(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  for (const castle of CASTLES) {
    // Skip castles whose city isn't enrolled yet; they get created when that
    // city is added in a later init run (castles are 5 per city).
    if (ctx.enrolledCities && !ctx.enrolledCities.has(castle.cityId)) {
      stats.skipped++;
      continue;
    }

    const [castlePda] = await deriveCastlePda(ctx.gameEngine, castle.cityId, castle.castleId);

    const city = CITIES.find(c => c.id === castle.cityId);
    if (!city) {
      throw new Error(
        `Castle #${castle.castleId} ('${castle.name}') targets cityId ${castle.cityId} ` +
        `which is not in the city catalogue. Update cli/data/castles.ts.`,
      );
    }

    const footprint = castle.footprintSize ?? defaultFootprintForTier(castle.tier);
    const cityLatGrid = toGrid(city.lat);
    const cityLongGrid = toGrid(city.lon);
    // Match `dimsFromRadius` in cli/data/cities.ts. Square plot, so half
    // is the same on both axes.
    const SQRT_PI = 1.7724539;
    const KM_PER_DEG = 111;
    const GRID_PRECISION = 10_000;
    const dim = Math.round(((city.radiusKm * SQRT_PI) / KM_PER_DEG) * GRID_PRECISION);
    const half = Math.floor(dim / 2);
    // Attack range expressed in grid cells per axis. 1 grid unit ≈ 11.1 m of
    // latitude; longitude degrees shrink by cos(lat) so the same range spans
    // more longitude cells. The +1 gives attackers a cell strictly inside range
    // rather than exactly on the boundary. This sizes the passable buffer the
    // anchor search requires so the castle is attackable from every side.
    const METERS_PER_GRID_LAT = (KM_PER_DEG * 1000) / GRID_PRECISION;
    const cosLat = Math.max(0.15, Math.cos((city.lat * Math.PI) / 180));
    const bufLat = Math.ceil(CASTLE_ATTACK_RANGE_METERS / METERS_PER_GRID_LAT) + 1;
    const bufLon = Math.ceil(CASTLE_ATTACK_RANGE_METERS / (METERS_PER_GRID_LAT * cosLat)) + 1;
    const knobs: BiomeKnobs = {
      waterLevelDelta: city.biome.waterLevelDelta,
      tempBias: city.biome.tempBias,
      moistureBias: city.biome.moistureBias,
      coast: city.biome.coast,
      landmassSeed: city.biome.landmassSeed,
    };
    const resolved = resolveCastleAnchor(
      cityLatGrid,
      cityLongGrid,
      half,
      half,
      // Cities use `seedForCity(id)` at init time; this MUST match what
      // was written to chain (see cli/lib/phases/cities.ts).
      (0xcafe0000 | castle.cityId) >>> 0,
      knobs,
      footprint,
      castle.latitude,
      castle.longitude,
      bufLon,
      bufLat,
    );
    if (!resolved) {
      throw new Error(
        `Castle #${castle.castleId} ('${castle.name}'): no passable ` +
        `${footprint}×${footprint} footprint anywhere in city ${castle.cityId}.`,
      );
    }
    // A spot with < 4 reachable sides is water-locked on some face: attackers
    // can't surround it. Surface it loudly so the castle's hint can be
    // re-anchored to a larger landmass (the world is mostly water near it).
    if (resolved.reachableSides < 4) {
      console.warn(
        yellow(
          `  ⚠ Castle #${castle.castleId} ('${castle.name}', city ${castle.cityId}): ` +
          `only ${resolved.reachableSides}/4 sides reachable within ${CASTLE_ATTACK_RANGE_METERS}m — ` +
          `water-locked, hard to attack. Consider re-anchoring its hint to more open land.`,
        ),
      );
    }

    // Each castle creates 1 CastleAccount + N² LocationAccounts via
    // CreateAccount CPIs, plus an N² biome passability scan. N=4 (citadel)
    // is ~17 CPIs + 16 noise-sampled cells which blows the default 200k CU
    // limit. 600k is comfortably above the worst case for tier 4 castles
    // and still well under the per-tx maximum of 1.4M.
    await createOrSkip(
      ctx,
      `Castle #${castle.castleId} (${castle.name})`,
      castlePda,
      () => createCreateCastleInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          cityId: castle.cityId,
          castleId: castle.castleId,
          tier: castle.tier,
          latitude: resolved.latitude,
          longitude: resolved.longitude,
          minLevel: castle.minLevel,
          minNetworthMillions: castle.minNetworthMillions,
          minTroopsThousands: castle.minTroopsThousands,
          name: castle.name,
          footprintSize: footprint,
        }
      ),
      stats,
      { computeUnits: 600_000 },
    );
  }

  return stats;
}

export async function statusCastles(ctx: CLIContext): Promise<string> {
  let count = 0;
  for (const castle of CASTLES) {
    const [pda] = await deriveCastlePda(ctx.gameEngine, castle.cityId, castle.castleId);
    if (await accountExists(ctx.connection, pda)) count++;
  }
  return `${count}`;
}

const TIER_NAMES = ['Outpost', 'Keep', 'Stronghold', 'Fortress', 'Citadel'];
const STATUS_NAMES = ['Vacant', 'Claimed', 'Contested', 'Transitioning'];

export async function detailCastles(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Castles — Kingdom ${ctx.kingdomId}`));

  const rows: string[][] = [];
  for (const c of CASTLES) {
    const [pda] = await deriveCastlePda(ctx.gameEngine, c.cityId, c.castleId);
    const info = await ctx.connection.getAccountInfo(pda);
    if (!info) {
      rows.push([
        String(c.castleId), dim('--'), dim('--'),
        String(c.cityId), dim('--'), red('MISSING'),
        dim('--'), dim('--'), dim('--'),
      ]);
      continue;
    }

    const data = parseCastle(info);
    if (!data) {
      rows.push([
        String(c.castleId), dim('--'), dim('--'),
        String(c.cityId), dim('--'), red('BAD DATA'),
        dim('--'), dim('--'), dim('--'),
      ]);
      continue;
    }

    const king = data.isVacant ? dim('vacant') : addr(data.king);
    const status = data.isVacant ? yellow('Vacant') : STATUS_NAMES[data.status] ?? String(data.status);
    rows.push([
      String(data.castleId),
      data.name || `Castle #${data.castleId}`,
      TIER_NAMES[data.tier] ?? String(data.tier),
      String(data.cityId),
      king,
      status,
      `${data.garrisonCount}/${data.maxGarrison}`,
      `${data.courtCount}/${data.maxCourt}`,
      String(data.minLevel),
    ]);
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Name', width: 20 },
      { header: 'Tier', width: 11 },
      { header: 'City', align: 'right' },
      { header: 'King' },
      { header: 'Status', width: 13 },
      { header: 'Garrison', align: 'right' },
      { header: 'Court', align: 'right' },
      { header: 'MinLvl', align: 'right' },
    ],
    rows
  ));

  lines.push('');
  return lines.join('\n');
}

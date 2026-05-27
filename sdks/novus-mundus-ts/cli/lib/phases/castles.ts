/**
 * Phase 8 — Castles (one per city)
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
}

/**
 * Resolve a castle's anchor (grid lat / lon) so its N×N footprint lands
 * on all-passable cells. Tries the data-file hint first (preserves
 * authored placements like Tower of London east of central London),
 * then spirals outward from the hint until a valid footprint is found.
 *
 * The spiral skips the city centre cell (spawn point) to avoid
 * stomping on `init_player`'s first LocationAccount claim.
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
): AnchorResolution | null {
  const hintOx = hintLongGrid - cityLongGrid;
  const hintOy = hintLatGrid - cityLatGrid;

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
        const cellOx = ox + dx;
        const cellOy = oy + dy;
        if (!isPassableBiome(biomeAt(biomeSeed, cellOx, cellOy, knobs))) {
          return false;
        }
      }
    }
    return true;
  };

  // Try the hint first.
  if (footprintFits(hintOx, hintOy)) {
    return { latitude: hintLatGrid, longitude: hintLongGrid };
  }

  // Spiral outward from the hint. `step=1` is fine for the small plot
  // sizes here (half-extent ~4000 grid units). The outer cap stops the
  // search well before we'd run off the plot.
  const maxRadius = Math.min(cityHalfWidth, cityHalfHeight);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const ox = hintOx + dx;
        const oy = hintOy + dy;
        if (footprintFits(ox, oy)) {
          return {
            latitude: cityLatGrid + oy,
            longitude: cityLongGrid + ox,
          };
        }
      }
    }
  }
  return null;
}

export async function initCastles(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  for (const castle of CASTLES) {
    const [castlePda] = deriveCastlePda(ctx.gameEngine, castle.cityId, castle.castleId);

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
    );
    if (!resolved) {
      throw new Error(
        `Castle #${castle.castleId} ('${castle.name}'): no passable ` +
        `${footprint}×${footprint} footprint anywhere in city ${castle.cityId}.`,
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
    const [pda] = deriveCastlePda(ctx.gameEngine, castle.cityId, castle.castleId);
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
    const [pda] = deriveCastlePda(ctx.gameEngine, c.cityId, c.castleId);
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

/**
 * Castle Data — a full per-city tier ladder.
 *
 * Castles are NOT one-per-city. A CastleAccount PDA is keyed by
 * [CASTLE_SEED, game_engine, city_id, castle_id] (see programs/novus_mundus/
 * src/state/castle.rs), so a city can host many castles, each its own grade.
 * We seed the whole ladder for every city (24 cities x 5 tiers = 120 castles):
 * castle_id == tier (0=Outpost .. 4=Citadel), so a city's five castles occupy
 * castle_ids 0..4 and their PDAs never collide.
 *
 * Placement. Each castle carries a hint (grid lat/lon). The CLI castle phase's
 * `resolveCastleAnchor` spirals out from the hint to the nearest fully passable,
 * attack-surroundable NxN footprint, so a hint is a starting guess, not a hard
 * coordinate. The five hints are spread around the city centre (offsets ~900
 * grid units, roughly 10 km; footprints are <= 4 cells) so footprints never
 * overlap each other or the spawn centre. The Citadel keeps the city's curated
 * landmark name + hint where one exists (see CITADELS); the four lower tiers are
 * auto-named "<City> <Tier>" and offset from centre. Water-heavy cities
 * (Shirevane / Lyssandor) may surface a "water-locked" init warning for some
 * tiers; re-tune that tier's hint if so.
 *
 * The chain's `castle_fits_in_city_grid` validator enforces that the whole
 * footprint stays inside the city plot, so a hint that lands outside surfaces as
 * `OutOfRange` (error 6411) at init. Gates (minLevel / networth / troops) are
 * derived from tier — see GATES.
 */

import { CITIES } from './cities';

export interface CastleData {
  castleId: number;
  cityId: number;
  name: string;
  tier: number;         // 0=Outpost, 1=Keep, 2=Stronghold, 3=Fortress, 4=Citadel
  minLevel: number;
  minNetworthMillions: number;
  minTroopsThousands: number;
  /** Anchor latitude in grid units (x10,000 = LocationAccount precision). */
  latitude: number;
  /** Anchor longitude in grid units (x10,000 = LocationAccount precision). */
  longitude: number;
  /**
   * Castle footprint size N for an N x N plot. Defaults via
   * `defaultFootprintForTier`. Citadels can be 3 or 4; Outposts stay at 1 or 2.
   */
  footprintSize?: number;
}

/**
 * Default footprint size keyed by tier. Tier 0 (Outposts) stay small; tier 4
 * (Citadels) get the largest plots within the cutover-allowed range (<= 4 per
 * the chain validator). The CLI phase calls this when a castle entry omits
 * `footprintSize`.
 */
export function defaultFootprintForTier(tier: number): number {
  switch (tier) {
    case 0: return 2; // Outpost
    case 1: return 2; // Keep
    case 2: return 3; // Stronghold
    case 3: return 3; // Fortress
    case 4: return 4; // Citadel
    default: return 2;
  }
}

/** Tier index to display name. castle_id == tier index. */
export const TIER_NAMES = ['Outpost', 'Keep', 'Stronghold', 'Fortress', 'Citadel'] as const;

/** Entry gates per tier (index = tier). Mirrors the historic per-tier values. */
const GATES = [
  { minLevel: 10, minNetworthMillions: 5,  minTroopsThousands: 2 },  // 0 Outpost
  { minLevel: 15, minNetworthMillions: 10, minTroopsThousands: 3 },  // 1 Keep
  { minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5 },  // 2 Stronghold
  { minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8 },  // 3 Fortress
  { minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10 }, // 4 Citadel
] as const;

/** Hint offset from city centre (grid units) for the four lower tiers. The
 *  Citadel (tier 4) uses its curated/centre hint instead. ~900 units (about
 *  10 km) keeps footprints (<= 4 cells) well clear of each other and the spawn. */
const TIER_OFFSETS = [
  { dLat:  900, dLon:  900 }, // 0 Outpost     (NE)
  { dLat:  900, dLon: -900 }, // 1 Keep        (NW)
  { dLat: -900, dLon:  900 }, // 2 Stronghold  (SE)
  { dLat: -900, dLon: -900 }, // 3 Fortress    (SW)
] as const;

/**
 * Curated Citadel (tier 4) per city: the iconic landmark keeps its name and
 * hand-placed hint. Cities absent here get a generated "<City> Citadel" anchored
 * at the city centre. Hints are grid units (x10,000 = LocationAccount precision).
 * Cities 15 (Lyssandor) and 18-23 had no real-world landmark in the catalogue, so
 * they fall through to the generated name rather than a re-anchored foreign one.
 */
const CITADELS: Record<number, { name: string; lat: number; lon: number }> = {
  0:  { name: 'Tower of London',    lat: 515085, lon: -757 },
  1:  { name: 'Bastille Fortress',  lat: 488566, lon: 23522 },
  2:  { name: 'Castel Sant Angelo', lat: 419028, lon: 124964 },
  3:  { name: 'Acropolis Citadel',  lat: 379838, lon: 237275 },
  4:  { name: 'Brandenburg Gate',   lat: 525200, lon: 134050 },
  5:  { name: 'Kremlin Fortress',   lat: 557558, lon: 376173 },
  6:  { name: 'Topkapi Palace',     lat: 410082, lon: 289784 },
  7:  { name: 'Cairo Citadel',      lat: 300444, lon: 312357 },
  8:  { name: 'Dubai Citadel',      lat: 252048, lon: 552708 },
  9:  { name: 'Baghdad Palace',     lat: 333152, lon: 443661 },
  10: { name: 'Lagos Bastion',      lat: 65244,  lon: 33792 },
  11: { name: 'Edo Castle',         lat: 356762, lon: 1396503 },
  12: { name: 'Forbidden City',     lat: 399042, lon: 1164074 },
  13: { name: 'Shanghai Citadel',   lat: 312304, lon: 1214737 },
  14: { name: 'Gyeongbok Palace',   lat: 375665, lon: 1269780 },
  16: { name: 'Mumbai Fort',        lat: 190760, lon: 728777 },
  17: { name: 'Liberty Fortress',   lat: 407128, lon: -740060 },
};

/**
 * Build the five-castle ladder for a city. castle_id == tier, so the PDAs
 * [city_id, 0..4] are distinct. The Citadel takes the curated landmark; the
 * lower tiers are named "<City> <Tier>" and offset from the city centre.
 */
function buildLadder(): CastleData[] {
  const castles: CastleData[] = [];
  for (const city of CITIES) {
    const centreLat = Math.round(city.lat * 10_000);
    const centreLon = Math.round(city.lon * 10_000);
    for (let tier = 0; tier <= 4; tier++) {
      const gate = GATES[tier];
      let name: string;
      let latitude: number;
      let longitude: number;
      if (tier === 4) {
        const landmark = CITADELS[city.id];
        name = landmark ? landmark.name : `${city.name} Citadel`;
        latitude = landmark ? landmark.lat : centreLat;
        longitude = landmark ? landmark.lon : centreLon;
      } else {
        const off = TIER_OFFSETS[tier];
        name = `${city.name} ${TIER_NAMES[tier]}`;
        latitude = centreLat + off.dLat;
        longitude = centreLon + off.dLon;
      }
      castles.push({
        castleId: tier, // castle_id == tier; PDA = [city_id, castle_id] so unique per city
        cityId: city.id,
        name,
        tier,
        minLevel: gate.minLevel,
        minNetworthMillions: gate.minNetworthMillions,
        minTroopsThousands: gate.minTroopsThousands,
        latitude,
        longitude,
        // footprintSize omitted: phase applies defaultFootprintForTier(tier)
      });
    }
  }
  return castles;
}

export const CASTLES: CastleData[] = buildLadder();

/**
 * Castle Data — one per city.
 *
 * cityIds are matched to the canonical city list in `./cities.ts` by
 * geographic coordinate (anchor lat/long → city lat/long). The chain's
 * `castle_fits_in_city_grid` validator enforces that
 * `|anchor - city_centre| <= plot_half_extent` along both axes, so any
 * mismatch surfaces as `OutOfRange` (error 6411) at init time.
 *
 * Three castles carry historic names (`La Plata Keep`, `Inca Citadel`,
 * `Nairobi Outpost`) for cities the catalogue doesn't include — those
 * are re-anchored to the nearest available city (Rio / Los Angeles /
 * Johannesburg respectively) so the chain accepts them; the lore name
 * stays for flavour.
 *
 * City 15 (Lyssandor / Singapore) has no castle in the current list —
 * intentional; add one here when the cosmetics arc fills the gap.
 */

export interface CastleData {
  castleId: number;
  cityId: number;
  name: string;
  tier: number;         // 0=Outpost, 1=Keep, 2=Stronghold, 3=Fortress, 4=Citadel
  minLevel: number;
  minNetworthMillions: number;
  minTroopsThousands: number;
  /** Anchor latitude in grid units (×10,000 = LocationAccount precision). */
  latitude: number;
  /** Anchor longitude in grid units (×10,000 = LocationAccount precision). */
  longitude: number;
  /**
   * Castle footprint size N for an N×N plot. Defaults to 2 (≈22 m × 22 m
   * keep). Citadels can be 3 or 4; Outposts stay at 1 or 2.
   */
  footprintSize?: number;
}

/**
 * Default footprint size keyed by tier. Tier 0 (Outposts) stay small;
 * tier 4 (Citadels) get the largest plots within the cutover-allowed
 * range (≤ 4 per the chain validator). The CLI phase calls this when
 * a castle entry omits `footprintSize`.
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

export const CASTLES: CastleData[] = [
  // Castles whose anchor sits on the matched city centre (or near it).
  // The cityId column is the on-chain target; the lat/long is the
  // anchor inside that city's plot.
  { castleId: 0,  cityId: 0,  name: 'Tower of London',     tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 515085, longitude: -757 },     // London → Valdenmoor
  { castleId: 1,  cityId: 1,  name: 'Bastille Fortress',   tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 488566, longitude: 23522 },   // Paris → Coranthas
  { castleId: 2,  cityId: 2,  name: 'Castel Sant Angelo',  tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 419028, longitude: 124964 },  // Rome → Solterrae
  // Acropolis lon was 232750 (= 23.275); Athens / Kael Mora sits at 23.7275.
  // The 4525-grid-unit gap exceeded the 2794 plot half-extent. Anchoring at
  // Athens' actual longitude lands inside the plot.
  { castleId: 3,  cityId: 3,  name: 'Acropolis Citadel',   tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 379838, longitude: 237275 },  // Athens → Kael Mora
  { castleId: 4,  cityId: 4,  name: 'Brandenburg Gate',    tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 525200, longitude: 134050 },  // Berlin → Thornmark
  { castleId: 5,  cityId: 5,  name: 'Kremlin Fortress',    tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 557558, longitude: 376173 },  // Moscow → Vraenholdt
  { castleId: 6,  cityId: 6,  name: 'Topkapi Palace',      tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 410082, longitude: 289784 },  // Istanbul → Kaelindra
  { castleId: 7,  cityId: 7,  name: 'Cairo Citadel',       tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 300444, longitude: 312357 },  // Cairo → Auren Khet
  { castleId: 8,  cityId: 8,  name: 'Dubai Citadel',       tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 252048, longitude: 552708 },  // Dubai → Solvaran
  { castleId: 9,  cityId: 9,  name: 'Baghdad Palace',      tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 333152, longitude: 443661 },  // Baghdad → Korthain
  { castleId: 10, cityId: 10, name: 'Lagos Outpost',       tier: 0, minLevel: 10, minNetworthMillions: 5,  minTroopsThousands: 2,  latitude: 65244,  longitude: 33792 },   // Lagos → Duskara
  { castleId: 11, cityId: 11, name: 'Edo Castle',          tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 356762, longitude: 1396503 }, // Tokyo → Shirevane
  { castleId: 12, cityId: 12, name: 'Forbidden City',      tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 399042, longitude: 1164074 }, // Beijing → Drenmire
  { castleId: 13, cityId: 13, name: 'Shanghai Keep',       tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 312304, longitude: 1214737 }, // Shanghai → Pelagora
  { castleId: 14, cityId: 14, name: 'Gyeongbok Palace',    tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 375665, longitude: 1269780 }, // Seoul → Aelthis
  // City 15 (Lyssandor / Singapore) intentionally has no castle.
  { castleId: 15, cityId: 16, name: 'Mumbai Fort',         tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 190760, longitude: 728777 },  // Mumbai → Maravhen
  { castleId: 16, cityId: 17, name: 'Liberty Fortress',    tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 407128, longitude: -740060 }, // NYC → Ashenveil
  // Castles below this line are historic-named anchors re-targeted to
  // the nearest available city — the city catalogue lacks Lima /
  // Buenos Aires / Nairobi, so the original anchors didn't fit. Lore
  // names kept for flavour; consider renaming during the next pass.
  { castleId: 17, cityId: 18, name: 'Inca Citadel',        tier: 1, minLevel: 15, minNetworthMillions: 10, minTroopsThousands: 3,  latitude: 340572, longitude: -1182387 },// Lima → Eldrath (LA) — re-anchored
  { castleId: 18, cityId: 19, name: 'Aztec Stronghold',    tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 194326, longitude: -991332 }, // Mexico City → Tonalca
  { castleId: 19, cityId: 20, name: 'Bandeirantes Fort',   tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: -235505, longitude: -466333 },// Sao Paulo → Verador
  { castleId: 20, cityId: 21, name: 'Sydney Stronghold',   tier: 1, minLevel: 15, minNetworthMillions: 10, minTroopsThousands: 3,  latitude: -338688, longitude: 1512093 },// Sydney → Mirethane
  { castleId: 21, cityId: 22, name: 'Nairobi Outpost',     tier: 0, minLevel: 10, minNetworthMillions: 5,  minTroopsThousands: 2,  latitude: -261991, longitude: 280523 }, // Nairobi → Grimhollow (Joburg) — re-anchored
  { castleId: 22, cityId: 23, name: 'La Plata Keep',       tier: 1, minLevel: 15, minNetworthMillions: 10, minTroopsThousands: 3,  latitude: -229018, longitude: -431679 },// Buenos Aires → Seralune (Rio) — re-anchored
];

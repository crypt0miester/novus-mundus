import { PublicKey } from "@solana/web3.js";
import type { CityAccount } from "novus-mundus-sdk";

export const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/**
 * Resolve a hero's origin city id to a display label. `0` is the "everywhere"
 * sentinel ("Anywhere"); a city that exists on chain shows its name; a city the
 * kingdom hasn't opened yet is "Undiscovered" (we genuinely don't know it).
 * Keyed off the live cities store so it tracks city enrollment automatically.
 */
export function cityOriginLabel(
  cityId: number,
  cities: Map<string, { account: CityAccount }>,
): string {
  if (!cityId) return "Anywhere";
  for (const { account } of cities.values()) {
    if (account.cityId === cityId) return account.name || `City #${cityId}`;
  }
  return "Undiscovered";
}

// Identity + system attributes that are NOT buffs, so the buff list skips them
// (they render in the footer / a dedicated chip instead). AbCD is the on-chain
// ability-cooldown stamp (unix ts of the last ability use); the UI surfaces it
// as a friendly "Ability Cooldown" indicator rather than a raw key:value row.
export const IGNORED_ATTRS = new Set(["Template", "Serial", "Origin", "AbCD"]);

// Cost helpers — mirror the Rust logic.

export function fragmentCost(currentLevel: number): number {
  const BASE = 10;
  if (currentLevel === 0) return BASE;
  let cost = BASE;
  for (let i = 0; i < currentLevel; i++) {
    cost = Math.floor((cost * 3) / 2);
    if (cost > Number.MAX_SAFE_INTEGER / 2) return Infinity;
  }
  return cost;
}

/**
 * Hard cap on hero level for fragment-driven level-up. Mirrors chain
 * `max_hero_level_for_sanctuary` (helpers/estate.rs) — gate for the
 * "spend fragments to level up" flow in HeroDetailPanel.
 */
export function heroLevelCap(sanctuaryLevel: number): number {
  if (sanctuaryLevel === 0) return 0;
  if (sanctuaryLevel <= 4) return 10;
  if (sanctuaryLevel <= 9) return 25;
  if (sanctuaryLevel <= 14) return 50;
  return 100;
}

/**
 * Cap on hero level for *passive meditation* XP gain. Mirrors chain
 * `meditation_level_cap` in helpers/estate.rs — once a hero reaches
 * this cap, further meditation no-ops on chain and the only way to
 * keep leveling is fragments. Distinct from `heroLevelCap` because
 * the meditation cap is φ-based (lower than the fragment cap until
 * Sanctuary 15+).
 *
 * Formula: floor(10 × φ^(sanctuary_level / 5)) with linear partial
 * interpolation between every 5 sanctuary levels. Examples:
 *   Sanctuary 1:  ≈ 11 (10 base + 0.2 × 0.618 × 10)
 *   Sanctuary 5:  ≈ 16
 *   Sanctuary 10: ≈ 26
 *   Sanctuary 15: ≈ 42
 *   Sanctuary 20: ≈ 69
 */
const SANCTUARY_PHI_NUM = 1618;
const SANCTUARY_PHI_DENOM = 1000;
export function meditationLevelCap(sanctuaryLevel: number): number {
  if (sanctuaryLevel <= 0) return 0;
  const exponent = Math.floor(sanctuaryLevel / 5);
  let scaled = 10 * SANCTUARY_PHI_DENOM;
  for (let i = 0; i < exponent; i++) {
    scaled = Math.floor((scaled * SANCTUARY_PHI_NUM) / SANCTUARY_PHI_DENOM);
  }
  const remainder = sanctuaryLevel % 5;
  if (remainder > 0) {
    const partial = Math.floor((scaled * 618 * remainder) / (5 * 1000));
    scaled = scaled + partial;
  }
  return Math.min(Math.floor(scaled / SANCTUARY_PHI_DENOM), 0x7fffffff);
}

export function tierFromMintCost(lamports: number): number {
  if (lamports >= 10_000_000_000) return 4;
  if (lamports >= 5_000_000_000) return 3;
  if (lamports >= 1_000_000_000) return 2;
  if (lamports >= 250_000_000) return 1;
  return 0;
}

export function burnReward(level: number, tier: number): number {
  const bases = [500, 5_000, 20_000, 100_000, 250_000];
  const base = bases[tier] ?? 500;
  const lvl = Math.max(level, 1);
  return base * lvl * lvl;
}

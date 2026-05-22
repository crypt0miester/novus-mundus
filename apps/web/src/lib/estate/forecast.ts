/**
 * Estate activity forecasting — faithful TypeScript ports of the on-chain
 * NOVI-consumption economy, so a building view can show what a hire or a
 * collection will actually return *before* the player signs.
 *
 * The SDK's `calculate*` helpers model a simpler economy than the program
 * ships (wrong activity type, no sqrt/pow scaling, no synchrony), so these
 * mirror the real processors instead:
 *   - hire_units.rs        — NOVI → power → units
 *   - collect_resources.rs — NOVI → power → resource yield
 *   - logic/consume.rs     — consume_novi_logic + calculate_synchrony
 *
 * Every step uses the same integer-floor basis-point math as the program
 * (`apply_bp` = ⌊v · bp / 10000⌋), so the numbers match the chain exactly —
 * with two documented exceptions on collection yield (see `forecastCollect`).
 */

import {
  ActivityType,
  getCurrentTimeOfDay,
  getActivityMultiplierBps,
  type GameEngine,
  type PlayerCore,
  type TimeOfDay,
} from "novus-mundus-sdk";
import { isFibonacci } from "@/lib/utils";

/** `apply_bp` — ⌊value · bp / 10000⌋, the program's one basis-point primitive. */
function applyBp(value: number, bp: number): number {
  return Math.floor((value * bp) / 10000);
}

/** Integer square root — floor(√n), matching the program's `isqrt`. */
function isqrt(n: number): number {
  if (n < 2) return Math.max(0, n);
  let x = Math.floor(Math.sqrt(n));
  // Correct the rare float rounding error at large n.
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** `sqrt_product` — ⌊√(a·b)⌋, falling back to ⌊√a⌋·⌊√b⌋ when a·b is unsafe. */
function sqrtProduct(a: number, b: number): number {
  const product = a * b;
  if (product <= Number.MAX_SAFE_INTEGER) return isqrt(product);
  return isqrt(a) * isqrt(b);
}

/** `pow_three_quarters` — x^0.75 ≈ ⌊√x⌋ · ⌊√⌊√x⌋⌋. */
function powThreeQuarters(x: number): number {
  if (x === 0) return 0;
  const s = isqrt(x);
  return s * isqrt(s);
}

/**
 * `calculate_synchrony` — the player's consumption-efficiency multiplier in
 * basis points (10000 = 1.0×). Subscription tier, happiness, reputation rank
 * and level each add a config-driven bonus.
 */
export function synchronyBp(
  player: PlayerCore,
  ge: GameEngine,
  nowSec: number,
): number {
  let bp = 10000;

  // Subscription tier bonus — tier 0 once the subscription has lapsed.
  const tier =
    player.subscriptionEnd.toNumber() > nowSec
      ? Math.min(player.subscriptionTier, 3)
      : 0;
  bp += ge.subscriptionTiers[tier]?.synchronyBonus ?? 0;

  const gp = ge.gameplayConfig;

  // Happiness bonus — averaged across defensive + operative, scaled and capped.
  const avgHappiness = (player.happinessDefensive + player.happinessOperative) / 2;
  bp += Math.min(
    Math.floor(avgHappiness * gp.happinessSynchronyMax),
    gp.happinessSynchronyMax,
  );

  // Reputation rank bonus — Novice / Skilled / Veteran / Elite / Legendary.
  const rep = player.reputation.toNumber();
  const repBonuses = gp.reputationSynchronyBonuses;
  bp +=
    rep >= 100_000
      ? (repBonuses[4] ?? 0)
      : rep >= 20_000
        ? (repBonuses[3] ?? 0)
        : rep >= 5_000
          ? (repBonuses[2] ?? 0)
          : rep >= 1_000
            ? (repBonuses[1] ?? 0)
            : (repBonuses[0] ?? 0);

  // Level bonus.
  bp += player.level * gp.levelSynchronyBonusPerLevel;

  return bp;
}

/**
 * `consume_novi_logic` — NOVI burned → raw power, before the time multiplier.
 * `novi × consumptionBase × secondaryMultiplier × synchrony`, ×φ on a
 * Fibonacci amount, flooring at every step.
 */
export function consumeNoviToPower(
  novi: number,
  synchrony: number,
  ge: GameEngine,
): number {
  const ec = ge.economicConfig;
  let value = applyBp(novi, ec.noviConsumptionBase.toNumber());
  value = applyBp(value, ec.secondaryMultiplierBase);
  value = applyBp(value, synchrony);
  if (isFibonacci(novi)) value = applyBp(value, ec.fibonacciBonusBase);
  return value;
}

/** Power after the `Consuming` time-of-day multiplier — the figure hire and
 *  collect both spend. */
function powerAtTime(
  novi: number,
  player: PlayerCore,
  ge: GameEngine,
  nowSec: number,
): { power: number; tod: TimeOfDay } {
  const base = consumeNoviToPower(novi, synchronyBp(player, ge, nowSec), ge);
  const tod = getCurrentTimeOfDay(nowSec, player.currentLong / 10000);
  const power = applyBp(base, getActivityMultiplierBps(ActivityType.Consuming, tod));
  return { power, tod };
}

/** 0–5 → the matching economic-config unit cost (defensive 1-3, operative 1-3). */
function baseUnitCost(ge: GameEngine, unitType: number): number {
  const ec = ge.economicConfig;
  const costs = [
    ec.defensiveUnit1Cost,
    ec.defensiveUnit2Cost,
    ec.defensiveUnit3Cost,
    ec.operativeUnit1Cost,
    ec.operativeUnit2Cost,
    ec.operativeUnit3Cost,
  ];
  return costs[unitType]?.toNumber() ?? 0;
}

export interface HireForecast {
  /** Units the hire will yield — exact (mirrors hire_units.rs). */
  units: number;
  /** Raw power the NOVI converts to, after the time multiplier. */
  power: number;
}

/**
 * Forecast `hire_units`: NOVI → power → `power ÷ adjusted unit cost`, with the
 * program's ≥50%-remainder round-up, then the `Hiring` time multiplier on the
 * unit count. Exact — `hire_units` has no terrain or research term.
 */
export function forecastHire(
  novi: number,
  unitType: number,
  player: PlayerCore,
  ge: GameEngine,
  nowSec: number,
): HireForecast {
  if (novi <= 0) return { units: 0, power: 0 };
  const { power, tod } = powerAtTime(novi, player, ge, nowSec);

  const adjusted = applyBp(
    baseUnitCost(ge, unitType),
    ge.economicConfig.costMultiplier.toNumber(),
  );
  const powerCost = Math.max(1, adjusted);

  const baseUnits = Math.floor(power / powerCost);
  const remainder = power % powerCost;
  let units = baseUnits;
  if (remainder > 0 && Math.floor((remainder * 10000) / powerCost) >= 5000) {
    units = baseUnits + 1;
  }

  units = applyBp(units, getActivityMultiplierBps(ActivityType.Hiring, tod));
  return { units, power };
}

export type CollectionKind = "cash" | "mining" | "fishing" | "farming";

export interface CollectForecast {
  /** Resource yield. For mining/fishing/farming this is a *floor* — see below. */
  output: number;
  /**
   * True when the figure excludes bonuses that only ever add to it (terrain
   * affinity, research buffs), so the real yield is `output` or higher.
   */
  isFloor: boolean;
}

/**
 * Forecast `collect_resources`: NOVI → power, then the per-type unit-weighted
 * scaling — linear for cash, ⌊√(unitFactor·power)⌋ for mining, that ^0.75 ×3
 * for fishing/farming.
 *
 * Mining/fishing/farming are reported as a floor: the chain then applies
 * terrain affinity and research buffs, both of which only ever *raise* the
 * yield and depend on the city / the player's research, so they're left out
 * rather than guessed.
 */
export function forecastCollect(
  novi: number,
  kind: CollectionKind,
  player: PlayerCore,
  ge: GameEngine,
  nowSec: number,
): CollectForecast {
  if (novi <= 0) return { output: 0, isFloor: kind !== "cash" };
  const { power } = powerAtTime(novi, player, ge, nowSec);

  const op1 = player.operativeUnit1.toNumber();
  const op2 = player.operativeUnit2.toNumber();
  const op3 = player.operativeUnit3.toNumber();

  if (kind === "cash") {
    const output = (op1 * 10 + op2 * 8 + op3 * 5) * power;
    return { output, isFloor: false };
  }

  if (kind === "mining") {
    const unitFactor = op1 * 3 + op2 * 2 + op3 * 1;
    return { output: sqrtProduct(unitFactor, power), isFloor: true };
  }

  // Fishing and farming share the ^0.75 curve and the ×3 produce weighting.
  const unitFactor = op1 * 5 + op2 * 4 + op3 * 3;
  const scaled = powThreeQuarters(sqrtProduct(unitFactor, power)) * 3;
  return { output: scaled, isFloor: true };
}

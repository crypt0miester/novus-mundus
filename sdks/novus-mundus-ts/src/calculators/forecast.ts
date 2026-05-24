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
  TimeOfDay,
} from './time';
import type { GameEngine } from '../state/game-engine';
import type { PlayerCore } from '../state/player';
import { applyBps } from './constants';

/** True when `n` is a perfect square. */
function isPerfectSquare(n: number): boolean {
  if (n < 0) return false;
  const r = isqrt(n);
  return r * r === n;
}

/**
 * True when `n` is a Fibonacci number. A non-negative integer `n` is Fibonacci
 * iff `5n² + 4` or `5n² - 4` is a perfect square. Bails to `false` once `5n²`
 * leaves the safe-integer range, where the perfect-square test could misread.
 */
export function isFibonacci(n: number): boolean {
  if (!Number.isInteger(n) || n < 0) return false;
  if (n <= 1) return true;
  const fiveNSq = 5 * n * n;
  if (!Number.isSafeInteger(fiveNSq)) return false;
  return isPerfectSquare(fiveNSq + 4) || isPerfectSquare(fiveNSq - 4);
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

// Collection yield tuning — MUST mirror the constants in
// `programs/novus_mundus/src/processor/economy/collect_resources.rs`.
const CASH_YIELD_CEILING = 5_000_000;
const CASH_YIELD_HALF = 1_000_000;
const CASH_YIELD_TAIL_DIVISOR = 200;
const GEM_YIELD_CEILING = 2_000;
const GEM_YIELD_HALF = 5_000;
const GEM_YIELD_TAIL_DIVISOR = 500_000;

/**
 * `saturating_yield` — `⌊ceiling·raw/(raw+half)⌋ + ⌊raw^0.75 / tailDivisor⌋`.
 * A soft plateau (anti-runaway) plus an unbounded sub-linear tail. Mirrors the
 * program helper of the same name. `raw` is a `bigint` so the math stays exact
 * past 2^53 (the program uses u128 there); JS-number widening would silently
 * truncate for whale collections (raw ≈ unit_factor × power can reach 1e17).
 * The tail term uses `powThreeQuarters` which is JS-number; raw past 2^53 is
 * clamped to `MAX_SAFE_INTEGER` before that delegation — the plateau dominates
 * at those magnitudes anyway.
 */
function saturatingYield(
  raw: bigint,
  ceiling: number,
  half: number,
  tailDivisor: number,
): number {
  if (raw <= 0n) return 0;
  const denom = raw + BigInt(half);
  const plateau = Number((BigInt(ceiling) * raw) / denom);
  const rawNum =
    raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : Number.MAX_SAFE_INTEGER;
  const tail = Math.floor(powThreeQuarters(rawNum) / tailDivisor);
  return plateau + tail;
}

/** [reputation floor, `reputationSynchronyBonuses` index] — highest floor first. */
const REPUTATION_RANKS: ReadonlyArray<readonly [number, number]> = [
  [100_000, 4],
  [20_000, 3],
  [5_000, 2],
  [1_000, 1],
];

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
  const rank = REPUTATION_RANKS.find(([floor]) => rep >= floor)?.[1] ?? 0;
  bp += gp.reputationSynchronyBonuses[rank] ?? 0;

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
  let value = applyBps(novi, ec.noviConsumptionBase.toNumber());
  value = applyBps(value, ec.secondaryMultiplierBase);
  value = applyBps(value, synchrony);
  if (isFibonacci(novi)) value = applyBps(value, ec.fibonacciBonusBase);
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
  const power = applyBps(base, getActivityMultiplierBps(ActivityType.Consuming, tod));
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

  const adjusted = applyBps(
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

  units = applyBps(units, getActivityMultiplierBps(ActivityType.Hiring, tod));
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
 * scaling — `saturatingYield` (plateau + tail) for cash and mining, the
 * ⌊√(unitFactor·power)⌋^0.75 ×3 curve for fishing/farming.
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
    const unitFactor = op1 * 10 + op2 * 8 + op3 * 5;
    const raw = BigInt(unitFactor) * BigInt(power);
    const output = saturatingYield(
      raw,
      CASH_YIELD_CEILING,
      CASH_YIELD_HALF,
      CASH_YIELD_TAIL_DIVISOR,
    );
    return { output, isFloor: false };
  }

  if (kind === "mining") {
    const unitFactor = op1 * 3 + op2 * 2 + op3 * 1;
    const raw = BigInt(unitFactor) * BigInt(power);
    const output = saturatingYield(
      raw,
      GEM_YIELD_CEILING,
      GEM_YIELD_HALF,
      GEM_YIELD_TAIL_DIVISOR,
    );
    return { output, isFloor: true };
  }

  // Fishing and farming share the ^0.75 curve and the ×3 produce weighting.
  const unitFactor = op1 * 5 + op2 * 4 + op3 * 3;
  const scaled = powThreeQuarters(sqrtProduct(unitFactor, power)) * 3;
  return { output: scaled, isFloor: true };
}

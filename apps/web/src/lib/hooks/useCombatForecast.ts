"use client";

import { useMemo } from "react";
import {
  forecastBattle,
  forecastEncounter,
  forecastVerdict,
  recommendForce,
  recommendForceForEncounter,
  getEffectiveTier,
  type PlayerCore,
  type ForceStats,
  type AttackBuffs,
  type BattleForecast,
  type CombatVerdict,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useEstate } from "@/lib/hooks/useEstate";
import { bnToSafeNumber } from "@/lib/utils";
import {
  attackerBuffs,
  defenderForceFromPlayer,
  battleOpts,
  coverageOf,
  recommendMargin,
  type CombatKind,
  type Coverage,
} from "@/lib/combat/forecast";

/** Legendary subscription tier index (Rookie 0 / Expert 1 / Epic 2 / Legendary 3). */
const LEGENDARY_TIER = 3;

/** Defender description — a target player, or an encounter's flat defence/health. */
export type ForecastTarget =
  | { kind: "player"; player: PlayerCore }
  | { kind: "encounter"; defenseBps: number; health: number }
  | { kind: "none" };

/**
 * Rally pool context. When present, the forecast models the WHOLE rally — every
 * already-joined participant's pooled force PLUS this player's contribution —
 * resolved with the LEADER's buffs, exactly as the chain does. Absent, the hook
 * treats the local player as the sole attacker (direct attacks; or a rally being
 * created, where the creator is the only participant).
 *
 * The pool is a flat headcount on chain (RallyAccount.totalUnits), so its tier
 * mix is unknown; it is modelled as infantry (the weakest tier), which makes the
 * attacker-casualty side of the verdict slightly conservative. The local
 * contribution's tiers are exact.
 */
export interface RallyContext {
  pooledUnits: number;
  pooledMelee: number;
  pooledRanged: number;
  pooledSiege: number;
  /** Leader buffs snapshotted on the rally account (see rallyLeaderBuffs). */
  leaderBuffs: AttackBuffs;
  /** Leader's Citadel rally-damage bonus (leader estate pvpDamageBps), if known. */
  leaderCitadelBps?: number;
}

export interface CombatForecastInput {
  /** Combat surface — selects drive-by / Citadel / time-of-day modifiers. */
  combat: CombatKind;
  /** Committed units per tier. For direct attacks pass the full owned army. */
  units: readonly [number, number, number];
  /** Committed weapons per type. For direct attacks pass the full owned arsenal. */
  weapons: readonly [number, number, number];
  /** The defender. `none` yields a coverage-only result (no verdict). */
  target: ForecastTarget;
  /** Drive-by toggle for pvp/castle (rally is always drive-by). */
  driveBy?: boolean;
  /** Rally pool + leader buffs — makes the verdict reflect the whole rally. */
  rally?: RallyContext;
}

export interface RecommendedForce {
  unit1: number;
  unit2: number;
  unit3: number;
  weaponsTotal: number;
  totalUnits: number;
  achievable: boolean;
}

export interface CombatForecastResult {
  /** True once the player account is loaded. Coverage works without a target. */
  ready: boolean;
  /** Weapon coverage of the committed force (whole rally, in rally mode). */
  coverage: Coverage;
  /** Full battle forecast, when a defender is known. */
  forecast: BattleForecast | null;
  /** Coarse verdict band, when a defender is known. */
  verdict: CombatVerdict | null;
  /**
   * Smallest fully-armed host that wins with a cushion. In rally mode this is
   * the WHOLE rally's target bar (all participants combined), not the local
   * player's share.
   */
  recommended: RecommendedForce | null;
  /** What the player currently owns, totalled. */
  owned: { units: number; weapons: number };
  /**
   * Troops/weapons the player would have to HIRE/BUY to close the gap. In rally
   * mode this is the gap that remains after the pool AND the player's full
   * muster (i.e. what allies or a refill must still supply). Zero when reachable
   * from what is already gathered plus the player's inventory.
   */
  acquire: { troops: number; weapons: number } | null;
  /** Whether the player holds an active Legendary charter (gates auto-refill). */
  isLegendary: boolean;
}

const sum3 = (t: readonly [number, number, number]): number => t[0] + t[1] + t[2];

/**
 * Live combat forecast for the troop-commitment surfaces.
 *
 * Pure-derives a verdict, a recommended winning force, and the inventory
 * shortfall from already-fetched accounts — no network. The verdict is exact
 * for the inputs but advisory in spirit (a delayed rally's garrison can change,
 * the pool's tier mix and the leader's armor are unknown, and biome is omitted),
 * so the recommendation bakes in a safety cushion.
 */
export function useCombatForecast(input: CombatForecastInput): CombatForecastResult {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const { data: estateData } = useEstate();

  const player = playerData?.account;
  const ge = geData?.account;
  const estate = estateData?.account;

  const { combat, units, weapons, target, driveBy, rally } = input;

  return useMemo(() => {
    // Pooled force already committed by other participants (rally mode only).
    const pooledUnits = rally?.pooledUnits ?? 0;
    const pooledWeapons = rally
      ? rally.pooledMelee + rally.pooledRanged + rally.pooledSiege
      : 0;

    // Combined committed force = pool + this player's contribution. Coverage and
    // the verdict are about this whole host; the warning fires on its arming.
    const combinedUnits = pooledUnits + sum3(units);
    const combinedWeapons = pooledWeapons + sum3(weapons);
    const coverage = coverageOf(combinedUnits, combinedWeapons);

    const owned = {
      units: player
        ? bnToSafeNumber(player.defensiveUnit1) +
          bnToSafeNumber(player.defensiveUnit2) +
          bnToSafeNumber(player.defensiveUnit3)
        : 0,
      weapons: player
        ? bnToSafeNumber(player.meleeWeapons) +
          bnToSafeNumber(player.rangedWeapons) +
          bnToSafeNumber(player.siegeWeapons)
        : 0,
    };

    const empty: CombatForecastResult = {
      ready: !!player,
      coverage,
      forecast: null,
      verdict: null,
      recommended: null,
      owned,
      acquire: null,
      isLegendary: false,
    };

    if (!player) return empty;

    const nowSec = Math.floor(Date.now() / 1000);
    const isLegendary = getEffectiveTier(player, nowSec) >= LEGENDARY_TIER;
    empty.isLegendary = isLegendary;

    const opts = battleOpts({
      kind: combat,
      ge,
      estate,
      driveBy: combat === "rally" ? true : driveBy,
      now: nowSec,
      longitude: player.currentLong ?? 0,
    });
    // In rally mode the Citadel bonus is the LEADER's, read from the rally's
    // leader estate (not the local player's). Override what battleOpts derived.
    if (rally) {
      opts.attackerDamageBonusBps = rally.leaderCitadelBps ?? 0;
    }

    // Buffs that drive offense: the leader's in rally mode, else the player's.
    const offenseBuffs: AttackBuffs = rally ? rally.leaderBuffs : attackerBuffs(player);

    // The recommendation scales by the player's OWNED tier mix (so it draws on
    // owned cavalry/siege), not the committed mix which can be a single tier.
    const composition = {
      u1: bnToSafeNumber(player.defensiveUnit1),
      u2: bnToSafeNumber(player.defensiveUnit2),
      u3: bnToSafeNumber(player.defensiveUnit3),
    };

    // What the player can still personally add beyond the pool, capped by what
    // they own. Used to size the hire-gap so the refill never double-counts the
    // pool or the player's own muster.
    const acquireFrom = (recTotalUnits: number, recWeaponsTotal: number) => {
      const troopsGap = Math.max(0, recTotalUnits - pooledUnits - owned.units);
      const weaponsGap = Math.max(0, recWeaponsTotal - pooledWeapons - owned.weapons);
      return { troops: troopsGap, weapons: weaponsGap };
    };

    if (target.kind === "encounter") {
      const fc = forecastEncounter(
        combinedUnits,
        combinedWeapons,
        target.defenseBps,
        target.health,
        opts.driveBy ?? false,
        offenseBuffs,
      );
      const rec = recommendForceForEncounter(
        target.defenseBps,
        target.health,
        opts.driveBy ?? false,
        offenseBuffs,
      );
      const recommended: RecommendedForce = {
        unit1: rec.totalUnits,
        unit2: 0,
        unit3: 0,
        weaponsTotal: rec.weaponsTotal,
        totalUnits: rec.totalUnits,
        achievable: rec.clears,
      };
      return {
        ...empty,
        // Synthesize a battle forecast shell so the UI verdict path is uniform.
        forecast: {
          attackerWon: fc.clears,
          attackerTroops: combinedUnits,
          defenderTroops: 0,
          attackerLosses: 0,
          defenderLosses: 0,
          attackerCasualtyRatioBps: 0,
          defenderCasualtyRatioBps: fc.clears ? 10000 : Math.floor(fc.healthFraction * 10000),
          attackerDamage: fc.damageDealt,
          defenderDamage: 0,
          marginBps: fc.clears ? 10000 : Math.floor(fc.healthFraction * 10000) - 10000,
        },
        verdict: fc.clears ? "win-decisive" : fc.healthFraction >= 0.75 ? "close" : "loss-decisive",
        recommended,
        acquire: acquireFrom(rec.totalUnits, rec.weaponsTotal),
      };
    }

    if (target.kind === "player") {
      // Attacker = pool (modelled as infantry) + this player's exact tiers.
      const atk: ForceStats = {
        ...offenseBuffs,
        armorPieces: rally ? bnToSafeNumber(player.armorPieces) : (offenseBuffs.armorPieces ?? bnToSafeNumber(player.armorPieces)),
        unit1: pooledUnits + units[0],
        unit2: units[1],
        unit3: units[2],
        melee: (rally?.pooledMelee ?? 0) + weapons[0],
        ranged: (rally?.pooledRanged ?? 0) + weapons[1],
        siege: (rally?.pooledSiege ?? 0) + weapons[2],
      };
      const def = defenderForceFromPlayer(target.player);
      const forecast = forecastBattle(atk, def, opts);
      const verdict = forecastVerdict(forecast);
      const rec = recommendForce(offenseBuffs, def, opts, composition, recommendMargin(combat));
      const recommended: RecommendedForce = {
        unit1: rec.unit1,
        unit2: rec.unit2,
        unit3: rec.unit3,
        weaponsTotal: rec.weaponsTotal,
        totalUnits: rec.totalUnits,
        achievable: rec.achievable,
      };
      return {
        ...empty,
        forecast,
        verdict,
        recommended,
        acquire: acquireFrom(rec.totalUnits, rec.weaponsTotal),
      };
    }

    // No target — coverage-only (still drives the under-armed warning).
    return empty;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    player,
    ge,
    estate,
    combat,
    driveBy,
    JSON.stringify(units),
    JSON.stringify(weapons),
    JSON.stringify(target),
    JSON.stringify(rally),
  ]);
}

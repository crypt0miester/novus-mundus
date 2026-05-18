"use client";

import { useMemo } from "react";
import { usePlayer } from "./usePlayer";
import { useNow } from "./useNow";
import { calculateDefensivePower, BuffStat, getBuffStatMeta } from "novus-mundus-sdk";

/** Calculate combat power from player defensive units (operatives don't fight on-chain) */
export function useCombatPower() {
  const { data } = usePlayer();
  const player = data?.account;

  return useMemo(() => {
    if (!player) return { total: 0, defense: 0 };

    const def = calculateDefensivePower(
      player.defensiveUnit1.toNumber(),
      player.defensiveUnit2.toNumber(),
      player.defensiveUnit3.toNumber(),
    );

    return {
      total: def,
      defense: def,
    };
  }, [player]);
}

/** Travel progress derived from player departure/arrival times */
export function useTravelProgress() {
  const { data } = usePlayer();
  const player = data?.account;

  // An active journey has a positive arrival timestamp; a settled player has
  // -1 (set by intercity_complete) or 0 — never a real time.
  const arrival = player ? player.arrivalTime.toNumber() : 0;
  const inTransit = arrival > 0;
  // Tick every second while a journey is underway so `pct` stays live.
  const now = useNow(inTransit);

  return useMemo(() => {
    if (!player || arrival <= 0) {
      return { traveling: false, pct: 0, endsAt: 0, startedAt: 0 };
    }

    const departure = player.departureTime.toNumber();

    return {
      // True for the whole journey — including arrived-but-not-completed,
      // which is exactly when the "Complete Journey" button must show.
      traveling: true,
      pct:
        departure > 0
          ? Math.min(100, ((now - departure) / (arrival - departure)) * 100)
          : 0,
      endsAt: arrival,
      startedAt: departure,
    };
  }, [player, arrival, now]);
}

/** Research buffs summary from player BPS fields */
export function useResearchBuffs() {
  const { data } = usePlayer();
  const player = data?.account;

  return useMemo(() => {
    if (!player) return [];

    const buffs: { label: string; bps: number }[] = [];
    if (player.researchAttackBps > 0)
      buffs.push({ label: "Attack", bps: player.researchAttackBps });
    if (player.researchDefenseBps > 0)
      buffs.push({ label: "Defense", bps: player.researchDefenseBps });
    if (player.researchCritChanceBps > 0)
      buffs.push({ label: "Crit Chance", bps: player.researchCritChanceBps });
    if (player.researchCritDamageBps > 0)
      buffs.push({ label: "Crit Damage", bps: player.researchCritDamageBps });
    if (player.researchLootBonusBps > 0)
      buffs.push({ label: "Loot Bonus", bps: player.researchLootBonusBps });
    if (player.researchStaminaBonusBps > 0)
      buffs.push({ label: "Stamina", bps: player.researchStaminaBonusBps });
    if (player.researchCollectionBonusBps > 0)
      buffs.push({ label: "Collection", bps: player.researchCollectionBonusBps });

    return buffs;
  }, [player]);
}

/** Hero buffs summary from player BPS fields */
export function useHeroBuffs() {
  const { data } = usePlayer();
  const player = data?.account;

  return useMemo(() => {
    if (!player) return [];

    const buffs: { label: string; bps: number }[] = [];
    const add = (stat: BuffStat, bps: number) => {
      if (bps > 0) {
        buffs.push({ label: getBuffStatMeta(stat)?.name ?? `Stat ${stat}`, bps });
      }
    };
    add(BuffStat.AttackPower, player.heroAttackBps);
    add(BuffStat.DefensePower, player.heroDefenseBps);
    add(BuffStat.CashCollectionRate, player.heroEconomyBps);
    add(BuffStat.XpGain, player.heroXpGainBps);
    add(BuffStat.CriticalHitChance, player.heroCritChanceBps);
    add(BuffStat.LootBonus, player.heroLootBonusBps);

    return buffs;
  }, [player]);
}

/** Subscription status from player tier + end time */
export function useSubscriptionStatus() {
  const { data } = usePlayer();
  const player = data?.account;

  return useMemo(() => {
    if (!player)
      return { tier: 0, active: false, expiresAt: 0, tierName: "Free" };

    const now = Math.floor(Date.now() / 1000);
    const end = player.subscriptionEnd.toNumber();
    const tierNames = ["Free", "Bronze", "Silver", "Gold", "Platinum"];

    return {
      tier: player.subscriptionTier,
      active: player.subscriptionTier > 0 && end > now,
      expiresAt: end,
      tierName: tierNames[player.subscriptionTier] || "Free",
    };
  }, [player]);
}

/** Daily rewards availability */
export function useDailyRewards() {
  const { data } = usePlayer();
  const player = data?.account;

  return useMemo(() => {
    if (!player)
      return { available: false, cooldownEnds: 0, hasDailyRewards: false };

    const now = Math.floor(Date.now() / 1000);
    const lastClaim = player.lastDailyClaim.toNumber();
    const DAY = 86400;
    const cooldownEnds = lastClaim + DAY;

    return {
      available: player.hasDailyRewards && now >= cooldownEnds,
      cooldownEnds,
      hasDailyRewards: player.hasDailyRewards,
    };
  }, [player]);
}

/** Networth from player state */
function useNetworth() {
  const { data } = usePlayer();
  const player = data?.account;

  return useMemo(() => {
    if (!player) return 0;
    return player.networth.toNumber();
  }, [player]);
}

"use client";

import { useEffect, useState } from "react";
import { calculateStaminaRegeneration, type PlayerCore } from "novus-mundus-sdk";
import { useChainTimeOffset } from "./useChainTime";

interface StaminaResult {
  /** Encounter stamina right now, with regeneration applied. */
  current: number;
  /** Maximum encounter stamina capacity. */
  max: number;
}

/**
 * Real-time encounter stamina.
 *
 * The program stores a stamina snapshot plus a `lastStaminaUpdate` stamp;
 * stamina regenerates between updates. This applies the *exact* regen math the
 * program runs — `calculateStaminaRegeneration` (5-min interval, time-of-day
 * bonus, hero buff) — and re-evaluates each second, so the value matches what
 * `attack_encounter` will see after it regenerates on-chain.
 *
 * `setCurrent` with an unchanged value is a no-op, so this only re-renders the
 * caller when stamina actually crosses a regen interval.
 */
export function useStamina(player: PlayerCore | null | undefined): StaminaResult {
  const [current, setCurrent] = useState(0);
  // The regen math applies a time-of-day bonus keyed off the cluster clock, so
  // anchor `now` to it rather than the device wall clock.
  const chainOffset = useChainTimeOffset();

  const stored = player?.encounterStamina?.toNumber();
  const lastUpdate = player?.lastStaminaUpdate?.toNumber();
  const max = player?.maxEncounterStamina?.toNumber();
  // `PlayerCore.currentLong` is an f64 in degrees (`state/player.rs:104`),
  // NOT the ×10000 grid form (that's `LocationAccount.grid_long`). Pass
  // through directly so stamina regen respects the player's actual timezone.
  const longitude = player ? (player.currentLong ?? 0) : undefined;
  const heroRegenBps = player?.heroStaminaRegenBps ?? 0;

  useEffect(() => {
    if (
      stored === undefined ||
      lastUpdate === undefined ||
      max === undefined ||
      longitude === undefined
    ) {
      return;
    }

    const update = () => {
      const now = Math.floor(Date.now() / 1000) + chainOffset;
      const [regenerated] = calculateStaminaRegeneration(
        stored,
        max,
        lastUpdate,
        now,
        longitude,
        heroRegenBps,
      );
      setCurrent(regenerated);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [stored, lastUpdate, max, longitude, heroRegenBps, chainOffset]);

  return { current, max: max ?? 0 };
}

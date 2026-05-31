"use client";

import { useEffect, useMemo, useState } from "react";
import { usePlayer } from "./usePlayer";
import { useGameEngine } from "./useGameEngine";
import { useChainTimeOffset } from "./useChainTime";
import { deciToNovi, getEffectiveTier } from "novus-mundus-sdk";

/** NOVI accrues one drop every 5 minutes. */
export const INTERVAL_SECONDS = 300;

export interface NoviGeneratorState {
  /** True once player + game engine + tier config are all loaded. */
  ready: boolean;
  /** Current locked NOVI balance. */
  displayNovi: number;
  /** Unclaimed NOVI accrued since the last on-chain update. */
  pendingNovi: number;
  /** Fill toward the cap, 0–100 (locked + pending). */
  fillPct: number;
  genRate: number;
  maxCap: number;
  noviPerHour: number;
  effectiveTier: number;
  currentLocked: number;
  isFull: boolean;
  /** Unix seconds of the last on-chain token settlement. Static between
   *  claims — derive the per-second "next drop" countdown from it. */
  lastUpdatedAt: number;
}

const EMPTY: NoviGeneratorState = {
  ready: false,
  displayNovi: 0,
  pendingNovi: 0,
  fillPct: 0,
  genRate: 0,
  maxCap: 0,
  noviPerHour: 0,
  effectiveTier: 0,
  currentLocked: 0,
  isFull: false,
  lastUpdatedAt: 0,
};

/**
 * Real-time NOVI generator state — locked balance, pending accrual, and fill
 * toward the cap. Shared by the NOVI generator card, the dashboard ring, the
 * status bar, and the mobile sidebar.
 *
 * The internal ticker recomputes every second but commits new state only when
 * a balance field actually changes — roughly once per 5-minute interval — so
 * consumers do not re-render every second. The live "next drop" countdown is
 * intentionally NOT part of this state; derive it where it is shown from
 * `lastUpdatedAt` + `INTERVAL_SECONDS` (see `NoviGenerator`).
 */
export function useNoviGenerator(): NoviGeneratorState {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;
  const ge = geData?.account;
  // Anchor `now` to the cluster clock — the effective tier keys off
  // `subscription_end > now` on-chain, so a wall-clock preview mispredicts it.
  const chainOffset = useChainTimeOffset();

  const [ticker, setTicker] = useState({
    displayNovi: 0,
    pendingNovi: 0,
    fillPct: 0,
  });

  useEffect(() => {
    if (!player || !ge) return;
    const tick = () => {
      const now = Math.floor(Date.now() / 1000) + chainOffset;
      const cfg = ge.subscriptionTiers[getEffectiveTier(player, now)];
      if (!cfg) return;
      const genRate = Number(cfg.generationMultiplier);
      const maxCap = Number(cfg.maxLockedNovi);
      const currentLocked = Number(player.lockedNovi);
      const elapsed = Math.max(0, now - Number(player.lastUpdatedTokensAt));
      const intervals = Math.floor(elapsed / INTERVAL_SECONDS);
      const pending =
        currentLocked >= maxCap ? 0 : Math.min(intervals * genRate, maxCap - currentLocked);
      const total = currentLocked + pending;
      const next = {
        displayNovi: currentLocked,
        pendingNovi: Math.max(0, pending),
        fillPct: maxCap > 0 ? Math.min((total / maxCap) * 100, 100) : 0,
      };
      setTicker((prev) =>
        prev.displayNovi === next.displayNovi &&
        prev.pendingNovi === next.pendingNovi &&
        prev.fillPct === next.fillPct
          ? prev
          : next,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [player, ge, chainOffset]);

  return useMemo(() => {
    if (!player || !ge) return EMPTY;
    const effectiveTier = getEffectiveTier(player, Math.floor(Date.now() / 1000) + chainOffset);
    const cfg = ge.subscriptionTiers[effectiveTier];
    if (!cfg) return EMPTY;
    // Internal scale: everything from the chain is in raw deci-NOVI (mint
    // decimals=1). The hook surfaces all NOVI-denominated fields in DISPLAY
    // NOVI so every consumer (status bar, dashboard ring, sidebar, generator
    // card) renders them directly without per-site conversion.
    const genRateRaw = Number(cfg.generationMultiplier);
    const maxCapRaw = Number(cfg.maxLockedNovi);
    const currentLockedRaw = Number(player.lockedNovi);
    return {
      ready: true,
      displayNovi: deciToNovi(ticker.displayNovi),
      pendingNovi: deciToNovi(ticker.pendingNovi),
      fillPct: ticker.fillPct,
      genRate: deciToNovi(genRateRaw),
      maxCap: deciToNovi(maxCapRaw),
      noviPerHour: deciToNovi(genRateRaw * 12),
      effectiveTier,
      currentLocked: deciToNovi(currentLockedRaw),
      isFull: currentLockedRaw >= maxCapRaw || ticker.fillPct >= 99.9,
      lastUpdatedAt: Number(player.lastUpdatedTokensAt),
    };
  }, [player, ge, ticker, chainOffset]);
}

"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { cn, formatNumber } from "@/lib/utils";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useSubscriptionStatus } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "./TxButton";
import type { TxPhase } from "./TxButton";
import {
  createUpdateLockedNoviInstruction,
  getEffectiveTier,
  type SubscriptionTierConfig,
} from "@/lib/sdk";

const INTERVAL_SECONDS = 300; // 5 minutes

const TIER_NAMES = ["Rookie", "Expert", "Epic", "Legendary"];
const TIER_COLORS = [
  "text-zinc-400",
  "text-amber-400",
  "text-purple-400",
  "text-orange-400",
];
const TIER_RING_COLORS = [
  "stroke-zinc-500",
  "stroke-amber-500",
  "stroke-purple-500",
  "stroke-orange-500",
];

interface NoviGeneratorProps {
  compact?: boolean;
  className?: string;
}

export function NoviGenerator({ compact, className }: NoviGeneratorProps) {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const sub = useSubscriptionStatus();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const ge = geData?.account;

  const containerRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<HTMLSpanElement>(null);
  const rateRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);

  // Real-time ticking state
  const [displayNovi, setDisplayNovi] = useState(0);
  const [pendingNovi, setPendingNovi] = useState(0);
  const [fillPct, setFillPct] = useState(0);
  const [nextIntervalIn, setNextIntervalIn] = useState(0);
  const [justClaimed, setJustClaimed] = useState(false);

  // Get tier config from game engine
  const getTierConfig = useCallback((): SubscriptionTierConfig | null => {
    if (!ge || !player) return null;
    const now = Math.floor(Date.now() / 1000);
    const tier = getEffectiveTier(player, now);
    return ge.subscriptionTiers[tier] ?? null;
  }, [ge, player]);

  // Real-time NOVI ticker — runs every second
  useEffect(() => {
    if (!player || !ge) return;

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const tierConfig = getTierConfig();
      if (!tierConfig) return;

      const lastUpdated = player.lastUpdatedTokensAt.toNumber();
      const elapsed = Math.max(0, now - lastUpdated);
      const intervals = Math.floor(elapsed / INTERVAL_SECONDS);
      const genRate = tierConfig.generationMultiplier.toNumber();
      const maxCap = tierConfig.maxLockedNovi.toNumber();
      const currentLocked = player.lockedNovi.toNumber();

      const pending = Math.min(intervals * genRate, maxCap - currentLocked);
      const total = Math.min(currentLocked + pending, maxCap);
      const pct = maxCap > 0 ? (total / maxCap) * 100 : 0;

      // Seconds until next interval fires
      const secondsIntoCurrentInterval = elapsed % INTERVAL_SECONDS;
      const secsUntilNext = INTERVAL_SECONDS - secondsIntoCurrentInterval;

      setDisplayNovi(total);
      setPendingNovi(Math.max(0, pending));
      setFillPct(pct);
      setNextIntervalIn(secsUntilNext);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [player, ge, getTierConfig]);

  // Ring progress — update via DOM for smooth transitions
  useEffect(() => {
    if (!ringRef.current) return;
    const circumference = 2 * Math.PI * 54;
    const offset = circumference * (1 - fillPct / 100);
    ringRef.current.style.strokeDashoffset = String(offset);
  }, [fillPct]);

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const ix = createUpdateLockedNoviInstruction({
      owner: publicKey,
      gameEngine: geKey,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Claimed ${formatNumber(pendingNovi, "compact")} NOVI!`,
        onPhase: reportPhase,
      })
      .then((r) => {
        setJustClaimed(true);
        setTimeout(() => setJustClaimed(false), 2000);
        return r.signature;
      });
  };

  if (!player || !ge) return null;

  const tierConfig = getTierConfig();
  if (!tierConfig) return null;

  const genRate = tierConfig.generationMultiplier.toNumber();
  const maxCap = tierConfig.maxLockedNovi.toNumber();
  const noviPerHour = genRate * 12; // 12 intervals per hour
  const effectiveTier = getEffectiveTier(
    player,
    Math.floor(Date.now() / 1000)
  );
  const isFull = fillPct >= 99.9;

  const circumference = 2 * Math.PI * 54;

  // Minutes:Seconds for next interval
  const nextMin = Math.floor(nextIntervalIn / 60);
  const nextSec = nextIntervalIn % 60;

  if (compact) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "relative flex items-center gap-3 rounded-xl border border-amber-900/40 bg-surface-raised px-4 py-3",
          className
        )}
      >
        <div className="relative h-12 w-12 flex-shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-zinc-800"
            />
            <circle
              ref={ringRef}
              cx="60"
              cy="60"
              r="54"
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              className={TIER_RING_COLORS[effectiveTier]}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - fillPct / 100)}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-bold text-amber-400">
              {Math.floor(fillPct)}%
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              ref={numberRef as any}
              className="font-mono text-lg font-bold tabular-nums text-amber-400"
            >
              {formatNumber(displayNovi, "compact")}
            </span>
            {pendingNovi > 0 && (
              <span
                ref={pendingRef}
                className="text-xs font-medium text-emerald-400"
              >
                +{formatNumber(pendingNovi, "compact")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <span>{noviPerHour}/hr</span>
            <span>·</span>
            <span>
              Next: {nextMin}:{String(nextSec).padStart(2, "0")}
            </span>
          </div>
        </div>

        {pendingNovi > 0 && (
          <TxButton onClick={handleClaim} className="text-xs px-3 py-1.5">
            Claim
          </TxButton>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-amber-900/40 bg-surface-raised p-6",
        className
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-900/40">
            <span className="text-sm">◆</span>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
            NOVI Generator
          </span>
        </div>
        <div
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            effectiveTier === 0 && "bg-zinc-800 text-zinc-400",
            effectiveTier === 1 && "bg-amber-900/40 text-amber-400",
            effectiveTier === 2 && "bg-purple-900/40 text-purple-400",
            effectiveTier === 3 && "bg-orange-900/40 text-orange-400"
          )}
        >
          {TIER_NAMES[effectiveTier]}
        </div>
      </div>

      {/* Central Display */}
      <div className="flex items-center justify-center gap-8">
        {/* Progress Ring */}
        <div className="relative h-32 w-32 flex-shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            {/* Track */}
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-zinc-800"
            />
            {/* Fill */}
            <circle
              ref={ringRef}
              cx="60"
              cy="60"
              r="54"
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              className={TIER_RING_COLORS[effectiveTier]}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - fillPct / 100)}
              style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold tabular-nums text-amber-400">
              {Math.floor(fillPct)}%
            </span>
            <span className="text-[9px] text-zinc-500">CAPACITY</span>
          </div>
        </div>

        {/* Numbers */}
        <div className="flex flex-col gap-1">
          {/* Main NOVI count */}
          <div ref={numberRef} className="relative">
            <div className="font-mono text-4xl font-bold tabular-nums text-text-primary">
              {displayNovi.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">
              / {maxCap.toLocaleString()} cap
            </div>
          </div>

          {/* Pending claim */}
          {pendingNovi > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              <span
                ref={pendingRef}
                className="font-mono text-lg font-bold tabular-nums text-emerald-400"
              >
                +{pendingNovi.toLocaleString()}
              </span>
              <span className="text-xs text-emerald-600">claimable</span>
            </div>
          )}

          {isFull && (
            <div className="flex items-center gap-1.5 text-amber-400">
              <span className="text-xs font-bold uppercase tracking-wider animate-pulse">
                Generator Full
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-zinc-500">Rate</div>
          <div className="font-mono text-sm font-bold tabular-nums text-text-primary">
            {genRate}/5m
          </div>
        </div>
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-zinc-500">Per Hour</div>
          <div className="font-mono text-sm font-bold tabular-nums text-text-primary">
            {noviPerHour.toLocaleString()}
          </div>
        </div>
        <div ref={rateRef} className="rounded-lg bg-surface/60 px-3 py-2 text-center">
          <div className="text-[10px] text-zinc-500">Next Drop</div>
          <div className="font-mono text-sm font-bold tabular-nums text-amber-400">
            {nextMin}:{String(nextSec).padStart(2, "0")}
          </div>
        </div>
      </div>

      {/* Claim Button */}
      <div className="mt-5 flex justify-center">
        {pendingNovi > 0 ? (
          <TxButton
            onClick={handleClaim}
            className={cn(
              "w-full max-w-xs py-3 text-base font-bold tracking-wide",
              justClaimed && "animate-none"
            )}
          >
            {isFull ? "CLAIM — GENERATOR FULL!" : `CLAIM ${formatNumber(pendingNovi, "compact")} NOVI`}
          </TxButton>
        ) : (
          <div className="flex w-full max-w-xs flex-col items-center gap-1 rounded-lg border border-zinc-800 bg-surface py-3 text-center">
            <span className="text-sm text-zinc-500">Generating...</span>
            <span className="text-xs text-zinc-600">
              +{genRate} NOVI in {nextMin}:{String(nextSec).padStart(2, "0")}
            </span>
          </div>
        )}
      </div>

    </div>
  );
}

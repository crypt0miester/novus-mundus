"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { animate, spring } from "animejs";
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
} from "novus-mundus-sdk";

const INTERVAL_SECONDS = 300; // 5 minutes

const TIER_NAMES = ["Rookie", "Expert", "Epic", "Legendary"];

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
  const ringContainerRef = useRef<HTMLDivElement>(null);
  const gemRef = useRef<HTMLDivElement>(null);
  // Detect upward crossings of pendingNovi so the beat only fires on growth.
  const prevPendingRef = useRef(0);

  // Real-time ticking state (combined to avoid cascading setState)
  const [ticker, setTicker] = useState({ displayNovi: 0, pendingNovi: 0, fillPct: 0, nextIntervalIn: 0 });
  const { displayNovi, pendingNovi, fillPct, nextIntervalIn } = ticker;
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

      const pending = currentLocked >= maxCap ? 0 : Math.min(intervals * genRate, maxCap - currentLocked);
      const total = currentLocked + pending;
      const pct = maxCap > 0 ? Math.min((total / maxCap) * 100, 100) : 0;
      // Show only locked balance as the main number; pending is displayed separately

      // Seconds until next interval fires
      const secondsIntoCurrentInterval = elapsed % INTERVAL_SECONDS;
      const secsUntilNext = INTERVAL_SECONDS - secondsIntoCurrentInterval;

      setTicker({ displayNovi: currentLocked, pendingNovi: Math.max(0, pending), fillPct: pct, nextIntervalIn: secsUntilNext });
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

  // Fires on upward crossings only. Respects prefers-reduced-motion.
  useEffect(() => {
    const prev = prevPendingRef.current;
    prevPendingRef.current = pendingNovi;
    if (pendingNovi <= prev) return;
    if (typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const ringContainer = ringContainerRef.current;
    if (ringContainer) {
      animate(ringContainer, {
        scale: [1, 1.08, 1],
        filter: [
          "drop-shadow(0 0 0 transparent)",
          "drop-shadow(0 0 14px var(--tier-accent-bright))",
          "drop-shadow(0 0 0 transparent)",
        ],
        duration: 720,
        ease: "outQuad",
      });
    }

    const gem = gemRef.current;
    if (gem) {
      animate(gem, {
        scale: [1, 1.45, 1],
        rotate: [0, 180, 360],
        duration: 800,
        ease: spring({ stiffness: 180, damping: 14 }),
      });
    }

    const pending = pendingRef.current;
    if (pending) {
      animate(pending, {
        opacity: [0.3, 1],
        scale: [1.35, 1],
        translateY: [-6, 0],
        duration: 420,
        ease: "outBack",
      });
    }
  }, [pendingNovi]);

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
  const currentLocked = player.lockedNovi.toNumber();
  const isFull = currentLocked >= maxCap || fillPct >= 99.9;

  const circumference = 2 * Math.PI * 54;

  // Minutes:Seconds for next interval
  const nextMin = Math.floor(nextIntervalIn / 60);
  const nextSec = nextIntervalIn % 60;

  if (compact) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "card relative flex items-center gap-3",
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
              style={{ stroke: "var(--tier-accent-bright)" }}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - fillPct / 100)}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-bold text-text-gold">
              {Math.floor(fillPct)}%
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              ref={numberRef as any}
              className="font-mono text-lg font-bold tabular-nums text-text-gold"
            >
              {formatNumber(displayNovi, "compact")}
            </span>
            {pendingNovi > 0 && (
              <span
                ref={pendingRef}
                className="text-xs font-medium text-text-gold"
                style={{ willChange: "transform, opacity" }}
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
        "card @container relative overflow-hidden",
        className
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            ref={gemRef}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-900/40"
            style={{ willChange: "transform" }}
          >
            <span className="text-sm">◆</span>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-text-gold">
            NOVI Generator
          </span>
        </div>
        <div
          className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "var(--tier-accent-bright)", backgroundColor: "color-mix(in srgb, var(--tier-accent) 20%, transparent)" }}
        >
          {TIER_NAMES[effectiveTier]}
        </div>
      </div>

      <div className="flex flex-col @sm:flex-row items-center justify-center gap-4 @sm:gap-8">
        <div
          ref={ringContainerRef}
          className="relative h-32 w-32 flex-shrink-0"
          style={{ willChange: "transform, filter" }}
        >
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
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - fillPct / 100)}
              style={{ stroke: "var(--tier-accent-bright)", transition: "stroke-dashoffset 0.8s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center px-2">
            <span className="font-mono text-2xl font-bold leading-none tabular-nums text-text-gold">
              {formatNumber(displayNovi, "compact")}
            </span>
            <span className="mt-1 font-mono text-[10px] tabular-nums text-zinc-500">
              / {formatNumber(maxCap, "compact")}
            </span>
          </div>
        </div>

        {pendingNovi > 0 && (
          <div
            ref={numberRef}
            className="flex flex-col gap-2 items-center text-center @sm:items-start @sm:text-left"
          >
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              <span
                ref={pendingRef}
                className="font-mono text-2xl font-bold leading-none tabular-nums text-text-gold"
                style={{ willChange: "transform, opacity" }}
              >
                +{formatNumber(pendingNovi, "compact")}
              </span>
              <span className="text-xs text-amber-700">claimable</span>
            </div>
          </div>
        )}
      </div>

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
          <div className="font-mono text-sm font-bold tabular-nums text-text-gold">
            {nextMin}:{String(nextSec).padStart(2, "0")}
          </div>
        </div>
      </div>

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
        ) : isFull ? (
          <div className="flex w-full max-w-xs flex-col items-center gap-1 rounded-lg border border-amber-800/50 bg-amber-950/20 py-3 text-center">
            <span className="text-sm font-bold uppercase tracking-wider text-text-gold">Generator Full</span>
            <span className="text-xs text-amber-600">
              {displayNovi.toLocaleString()} / {maxCap.toLocaleString()} cap
            </span>
          </div>
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

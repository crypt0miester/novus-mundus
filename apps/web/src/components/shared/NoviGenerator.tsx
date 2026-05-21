"use client";

import { useRef, useEffect, useState } from "react";
import { animate, spring } from "animejs";
import { cn, formatNumber } from "@/lib/utils";
import { GameIcon } from "@/components/shared/GameIcon";
import { ProgressRing } from "@/components/shared/ProgressRing";
import { useNoviGenerator, INTERVAL_SECONDS } from "@/lib/hooks/useNoviGenerator";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "./TxButton";
import type { TxPhase } from "./TxButton";
import { createUpdateLockedNoviInstruction } from "novus-mundus-sdk";

const TIER_NAMES = ["Rookie", "Expert", "Epic", "Legendary"];

interface NoviGeneratorProps {
  compact?: boolean;
  className?: string;
}

/**
 * NOVI generator panel — balance, accrual stats, and the claim action.
 * `compact` is the inline widget used in building tabs (keeps a small fill
 * ring). The full card's fill ring lives on the dashboard's vitals row; the
 * per-second ticker is shared via `useNoviGenerator`.
 */
export function NoviGenerator({ compact, className }: NoviGeneratorProps) {
  const gen = useNoviGenerator();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const pendingRef = useRef<HTMLSpanElement>(null);
  const gemRef = useRef<HTMLDivElement>(null);
  // Detect upward crossings of pendingNovi so the beat only fires on growth.
  const prevPendingRef = useRef(0);
  const [justClaimed, setJustClaimed] = useState(false);
  const [nextIntervalIn, setNextIntervalIn] = useState(INTERVAL_SECONDS);

  const {
    displayNovi, pendingNovi, fillPct, lastUpdatedAt,
    genRate, noviPerHour, effectiveTier, isFull, ready,
  } = gen;

  // Fires on upward crossings of pendingNovi only. Respects reduced-motion.
  useEffect(() => {
    const prev = prevPendingRef.current;
    prevPendingRef.current = pendingNovi;
    if (pendingNovi <= prev) return;
    if (typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
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

  // Live "next drop" countdown — kept local to this card so the shared
  // useNoviGenerator hook need not re-render every consumer each second.
  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - lastUpdatedAt);
      setNextIntervalIn(INTERVAL_SECONDS - (elapsed % INTERVAL_SECONDS));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ready, lastUpdatedAt]);

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = createUpdateLockedNoviInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
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

  if (!ready) return null;

  const nextMin = Math.floor(nextIntervalIn / 60);
  const nextSec = nextIntervalIn % 60;

  if (compact) {
    return (
      <div className={cn("card relative flex items-center gap-3", className)}>
        <ProgressRing percent={fillPct} size={48} strokeWidth={5}>
          <span className="text-[10px] font-bold text-text-gold">
            {Math.floor(fillPct)}%
          </span>
        </ProgressRing>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg font-bold tabular-nums text-text-gold">
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
          <TxButton onClick={handleClaim} className="text-xs px-3 py-1.5 w-18">
            Claim
          </TxButton>
        )}
      </div>
    );
  }

  return (
    <div className={cn("card @container relative overflow-hidden", className)}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            ref={gemRef}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-900/40"
            style={{ willChange: "transform" }}
          >
            <GameIcon id="resource-novi" size={14} />
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
        <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
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
          <div className="w-full max-w-xs rounded-lg border border-amber-800/50 bg-amber-950/20 py-3 text-center">
            <span className="text-sm font-bold uppercase tracking-wider text-text-gold">Full</span>
          </div>
        ) : (
          <div className="w-full max-w-xs rounded-lg border border-zinc-800 bg-surface py-3 text-center">
            <span className="text-sm text-zinc-500">Generating...</span>
          </div>
        )}
      </div>
    </div>
  );
}

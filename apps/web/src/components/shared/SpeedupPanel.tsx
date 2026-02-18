"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { TxButton } from "./TxButton";
import type { TxPhase } from "./TxButton";

interface SpeedupTier {
  tier: number;
  label: string;
  description: string;
  gemCost?: number;
}

interface SpeedupPanelProps {
  /** Whether the panel should be visible */
  visible: boolean;
  /** Remaining seconds until completion */
  remainingSeconds: number;
  /** Handler that receives the selected tier and reportPhase callback, returns a tx promise */
  onSpeedup: (tier: number, reportPhase: (p: TxPhase) => void) => Promise<string>;
  /** Available tiers — defaults to standard Tier 1 / Tier 2 */
  tiers?: SpeedupTier[];
  /** Gem cost per minute (used for dynamic cost calculation) */
  gemsPerMinute?: number;
  /** Player's current gem balance */
  gemBalance?: number;
  /** Optional className */
  className?: string;
}

const DEFAULT_TIERS: SpeedupTier[] = [
  {
    tier: 1,
    label: "Hasten",
    description: "50% time reduction",
  },
  {
    tier: 2,
    label: "Rush",
    description: "75% time reduction",
  },
];

/**
 * Reusable speedup panel with animated tier selection.
 *
 * Calculates gem costs dynamically from remaining time and shows
 * a two-tier selection with visual feedback.
 */
export function SpeedupPanel({
  visible,
  remainingSeconds,
  onSpeedup,
  tiers = DEFAULT_TIERS,
  gemsPerMinute = 1,
  gemBalance,
  className,
}: SpeedupPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!visible || remainingSeconds <= 0) return null;

  const remainingMinutes = Math.ceil(remainingSeconds / 60);

  /** Cost for a given tier multiplier */
  function costForTier(tier: number): number {
    return remainingMinutes * gemsPerMinute * tier;
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={cn(
          "group flex items-center gap-2 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-400 transition-all hover:border-amber-700 hover:bg-amber-950/50",
          className,
        )}
      >
        <svg className="h-3.5 w-3.5 transition-transform group-hover:rotate-12" viewBox="0 0 16 16" fill="none">
          <path d="M8.5 1L3 9h4.5l-1 6L13 7H8.5l1-6z" fill="currentColor" />
        </svg>
        Speed Up
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-900/40 bg-surface-raised p-4",
        className,
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-amber-400" viewBox="0 0 16 16" fill="none">
            <path d="M8.5 1L3 9h4.5l-1 6L13 7H8.5l1-6z" fill="currentColor" />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
            Speed Up
          </span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-zinc-500 hover:text-zinc-400"
        >
          Close
        </button>
      </div>

      {/* Time remaining context */}
      <div className="mb-3 rounded-lg bg-surface/60 px-3 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Time Remaining</span>
          <span className="font-mono tabular-nums text-amber-400">
            {remainingMinutes >= 60
              ? `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m`
              : `${remainingMinutes}m`}
          </span>
        </div>
        {gemBalance != null && (
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-zinc-500">Your Gems</span>
            <span className="font-mono tabular-nums text-emerald-400">
              {gemBalance.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* Tier buttons */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiers.length}, 1fr)` }}>
        {tiers.map((t) => {
          const cost = t.gemCost ?? costForTier(t.tier);
          const canAfford = gemBalance == null || gemBalance >= cost;

          return (
            <div key={t.tier} className="flex flex-col gap-2">
              <div
                className={cn(
                  "rounded-lg border p-3 text-center",
                  t.tier === 1
                    ? "border-amber-800/50 bg-amber-950/20"
                    : "border-purple-800/50 bg-purple-950/20",
                )}
              >
                <div
                  className={cn(
                    "text-sm font-bold",
                    t.tier === 1 ? "text-amber-400" : "text-purple-400",
                  )}
                >
                  {t.label}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">{t.description}</div>
                <div className="mt-2 font-mono text-lg font-bold text-text-primary">
                  {cost.toLocaleString()}
                </div>
                <div className="text-[10px] text-zinc-500">gems</div>
              </div>
              <TxButton
                onClick={(reportPhase: (p: TxPhase) => void) => onSpeedup(t.tier, reportPhase)}
                variant={canAfford ? "secondary" : "secondary"}
                disabled={!canAfford}
                className={cn(
                  "w-full text-xs",
                  !canAfford && "opacity-40",
                )}
              >
                {canAfford ? t.label : "Not enough gems"}
              </TxButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}

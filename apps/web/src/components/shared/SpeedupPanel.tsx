"use client";

import { cn } from "@/lib/utils";
import { TxButton } from "./TxButton";
import type { TxPhase } from "./TxButton";
import styles from "./parchment-travel.module.css";

interface SpeedupTier {
  tier: number;
  label: string;
  description: string;
  gemCost?: number;
  /** Hold-to-charge cap — most speedup instructions one tx can hold for this
   *  tier (timer-collapse ∧ gem affordability). Omitted to plain one-shot. */
  maxCount?: number;
}

interface SpeedupPanelProps {
  /** Whether the panel should be visible */
  visible: boolean;
  /** Remaining seconds until completion */
  remainingSeconds: number;
  /**
   * Handler for a speedup — receives the tier, a phase reporter, and `count`
   * (the held charge; 1 on a tap). Returns a tx promise.
   */
  onSpeedup: (tier: number, reportPhase: (p: TxPhase) => void, count?: number) => Promise<string>;
  /** Available tiers — defaults to standard Tier 1 / Tier 2 */
  tiers?: SpeedupTier[];
  /** Gem cost per minute (used for dynamic cost calculation) */
  gemsPerMinute?: number;
  /** Player's current gem balance */
  gemBalance?: number;
  /** Hide the outer container border + header (when parent already provides context) */
  inline?: boolean;
  /** Optional className */
  className?: string;
  /** Visual theme — `parchment` matches the world-map travel skin */
  variant?: "default" | "parchment";
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
 * How many speedup instructions of one tier are worth packing into a single
 * transaction — the lesser of (a) collapsing the timer to zero (a speedup past
 * that fails on-chain) and (b) what the player's gems cover. Replays the
 * processor's truncating math, so the cap matches the chain exactly.
 */
export function maxSpeedupCount(opts: {
  remainingSeconds: number;
  /** Fraction of time left after one speedup (0.5 = a 50%-cut tier). */
  timeMultiplier: number;
  /** Gem-cost multiplier for the tier, per the processor's tier table. */
  costMultiplier: number;
  gemsPerMinute: number;
  gemBalance: number;
  /** Hard ceiling so one tx can't overflow size / compute budget. */
  hardCap?: number;
}): number {
  const {
    remainingSeconds,
    timeMultiplier,
    costMultiplier,
    gemsPerMinute,
    gemBalance,
    hardCap = 40,
  } = opts;
  let remaining = Math.max(0, Math.floor(remainingSeconds));
  let spentGems = 0;
  let count = 0;
  while (remaining > 0 && count < hardCap) {
    const minutes = Math.ceil(remaining / 60);
    const cost = minutes * gemsPerMinute * costMultiplier;
    if (spentGems + cost > gemBalance) break; // next speedup is unaffordable
    spentGems += cost;
    count++;
    remaining = Math.floor(remaining * timeMultiplier);
  }
  return count;
}

/**
 * Hold-to-charge cap for the EXPEDITION speedup — its processor prices a
 * speedup on the time it *removes*, not the time remaining, and floors the
 * minute count differently. Replays `expedition/speedup.rs`; the cap is the
 * lesser of collapsing the timer and gem affordability.
 */
export function maxExpeditionSpeedupCount(opts: {
  remainingSeconds: number;
  /** Tier time-reduction in basis points (5000 = 50%, 7500 = 75%). */
  reductionBps: number;
  /** Gem-cost multiplier for the tier (1x / 2x). */
  costMultiplier: number;
  /** Flat gems-per-minute rate (the processor's EXPEDITION constant). */
  gemsPerMinute: number;
  gemBalance: number;
  hardCap?: number;
}): number {
  const {
    remainingSeconds,
    reductionBps,
    costMultiplier,
    gemsPerMinute,
    gemBalance,
    hardCap = 40,
  } = opts;
  let remaining = Math.max(0, Math.floor(remainingSeconds));
  let spentGems = 0;
  let count = 0;
  while (remaining > 0 && count < hardCap) {
    const secondsToReduce = Math.floor((remaining * reductionBps) / 10000);
    // The processor floors then clamps to >= 1 minute of charged cost.
    const minutesToReduce = Math.max(1, Math.floor(secondsToReduce / 60));
    const cost = minutesToReduce * gemsPerMinute * costMultiplier;
    if (spentGems + cost > gemBalance) break; // next speedup is unaffordable
    spentGems += cost;
    count++;
    // A 0-second reduction can't collapse the timer — stop to avoid looping.
    if (secondsToReduce <= 0) break;
    remaining -= secondsToReduce;
  }
  return count;
}

/** Each tier-1 "Hasten" research speedup skips this many seconds. */
const RESEARCH_HASTEN_STEP = 3600;

/**
 * Research speedup gem cost is level-banded — `speed_up_research.rs` prices it
 * via `calculate_gem_cost(_, current_level)`, not the template's flat rate.
 * Mirrored here so the hold cap matches the chain.
 */
export function researchGemsPerMinute(level: number): number {
  if (level <= 5) return 1;
  if (level <= 10) return 2;
  if (level <= 15) return 5;
  if (level <= 20) return 10;
  return 20;
}

/**
 * Hold-to-charge cap for the research "Hasten" speedup — it skips a fixed
 * `RESEARCH_HASTEN_STEP` per step (not a time-%, so `maxSpeedupCount` doesn't
 * fit). The cap is the lesser of collapsing the timer and what gems cover.
 */
export function maxResearchHastenCount(opts: {
  remainingSeconds: number;
  /** Level being researched — sets the on-chain per-minute gem rate. */
  currentLevel: number;
  gemBalance: number;
  hardCap?: number;
}): number {
  const { remainingSeconds, currentLevel, gemBalance, hardCap = 40 } = opts;
  const gemsPerMinute = researchGemsPerMinute(currentLevel);
  let remaining = Math.max(0, Math.floor(remainingSeconds));
  let spentGems = 0;
  let count = 0;
  while (remaining > 0 && count < hardCap) {
    const skipped = Math.min(RESEARCH_HASTEN_STEP, remaining);
    const cost = Math.ceil(skipped / 60) * gemsPerMinute;
    if (spentGems + cost > gemBalance) break; // next skip is unaffordable
    spentGems += cost;
    count++;
    remaining -= skipped;
  }
  return count;
}

/**
 * Reusable speedup panel with tier selection.
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
  inline,
  className,
  variant = "default",
}: SpeedupPanelProps) {
  if (!visible || remainingSeconds <= 0) return null;

  const parchment = variant === "parchment";
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  const headerCls = parchment
    ? styles.panelHeader
    : "text-xs font-semibold uppercase tracking-wider text-text-gold";
  const boxCls = parchment ? styles.infoBox : "rounded-lg bg-surface/60 px-3 py-2";
  const labelCls = parchment ? styles.infoLabel : "text-zinc-500";
  const valueCls = cn("font-mono tabular-nums", parchment ? styles.infoValue : "text-text-gold");

  /** Cost for a given tier multiplier */
  function costForTier(tier: number): number {
    return remainingMinutes * gemsPerMinute * tier;
  }

  return (
    <div
      className={cn(
        !inline &&
          (parchment
            ? styles.panel
            : "rounded-xl border border-border-gold/40 bg-surface-raised p-4"),
        className,
      )}
    >
      {/* Header — hidden in inline mode */}
      {!inline && (
        <div className="mb-3 flex items-center gap-2">
          <svg
            className={cn("h-4 w-4", parchment ? styles.panelIcon : "text-text-gold")}
            viewBox="0 0 16 16"
            fill="none"
          >
            <path d="M8.5 1L3 9h4.5l-1 6L13 7H8.5l1-6z" fill="currentColor" />
          </svg>
          <span className={headerCls}>Speed Up</span>
        </div>
      )}

      {/* Time remaining + gem balance context — hidden in inline mode */}
      {!inline && (
        <div className={cn("mb-3", boxCls)}>
          <div className="flex items-center justify-between text-xs">
            <span className={labelCls}>Time Remaining</span>
            <span className={valueCls}>
              {remainingMinutes >= 60
                ? `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m`
                : `${remainingMinutes}m`}
            </span>
          </div>
          {gemBalance != null && (
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className={labelCls}>Your Gems</span>
              <span className={valueCls}>{gemBalance.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {inline && gemBalance != null && (
        <div className={cn("mb-3 flex items-center justify-between text-xs", boxCls)}>
          <span className={labelCls}>Your Gems</span>
          <span className={valueCls}>{gemBalance.toLocaleString()}</span>
        </div>
      )}

      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiers.length}, 1fr)` }}>
        {tiers.map((t) => {
          const cost = t.gemCost ?? costForTier(t.tier);
          const canAfford = gemBalance == null || gemBalance >= cost;
          const cardClass = cn(
            "w-full flex-col items-center gap-1 rounded-lg border border-border-default p-3",
            !canAfford && "opacity-40",
          );
          const content = (
            <span className="flex flex-col items-center gap-1">
              <span className="text-sm font-bold text-text-primary">{t.label}</span>
              <span className="text-[10px] text-zinc-500">{t.description}</span>
              <span className="font-mono text-lg font-bold text-text-primary">
                {cost.toLocaleString()}
              </span>
              <span className="text-[10px] text-zinc-500">
                {canAfford ? "gems" : "Not enough gems"}
              </span>
            </span>
          );
          return (
            <div key={t.tier}>
              <TxButton
                onClick={(reportPhase) => onSpeedup(t.tier, reportPhase, 1)}
                onHold={(reportPhase, count) => onSpeedup(t.tier, reportPhase, count)}
                holdMax={t.maxCount}
                variant="secondary"
                disabled={!canAfford}
                className={cn(cardClass, "hidden lg:flex")}
              >
                {content}
              </TxButton>
              <div
                className={cn(
                  cardClass,
                  "flex lg:hidden",
                  parchment ? "bg-surface-raised" : "bg-surface-raised/40",
                )}
              >
                {content}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  const valueCls = cn(
    "font-mono tabular-nums",
    parchment ? styles.infoValue : "text-text-gold",
  );

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
            : "rounded-xl border border-amber-900/40 bg-surface-raised p-4"),
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
                onClick={(reportPhase: (p: TxPhase) => void) => onSpeedup(t.tier, reportPhase)}
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

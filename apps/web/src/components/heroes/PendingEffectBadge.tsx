"use client";

import {
  getAbilityKindMeta,
  getBuffStatMeta,
  formatDurationCompact,
  AbilityKind,
} from "novus-mundus-sdk";
import { usePendingEffect } from "@/lib/hooks/useHeroAbility";

interface PendingEffectBadgeProps {
  /** "inline": compact pill for headers / sidebars. "block": fuller card for prominent slots. */
  variant?: "inline" | "block";
}

/**
 * Surfaces the player's currently-armed pending one-shot effect (set by
 * use_ability ix, consumed by combat). Renders nothing if no effect is armed.
 */
export function PendingEffectBadge({ variant = "inline" }: PendingEffectBadgeProps) {
  const pending = usePendingEffect();
  if (!pending) return null;

  const meta = getAbilityKindMeta(pending.kind);
  const label = describePending(pending);
  const remaining = formatDurationCompact(pending.remainingSecs);

  if (variant === "inline") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-surface px-2.5 py-1 text-[10px]">
        <span className={meta.accentClass}>{meta.icon}</span>
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">· {remaining}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-md border bg-surface px-3 py-2 ${borderForKind(pending.kind)}`}>
      <div className="flex items-center justify-between">
        <div className={`text-xs font-semibold ${meta.accentClass}`}>
          {meta.icon} {meta.label} armed
        </div>
        <div className="text-[10px] font-mono text-text-muted">{remaining}</div>
      </div>
      <p className="mt-0.5 text-[11px] text-text-secondary">{label}</p>
    </div>
  );
}

function describePending(p: { kind: number; stat: number; param: number }): string {
  switch (p.kind) {
    case AbilityKind.BuffNext: {
      const stat = getBuffStatMeta(p.stat);
      const pct = (p.param / 100).toFixed(1);
      return `Next combat action: +${pct}% ${stat?.name ?? "stat"}`;
    }
    case AbilityKind.CritNext:
      return "Next attack will be a guaranteed crit";
    case AbilityKind.ShieldNext:
      return "Next defense will be doubled";
    case AbilityKind.EncounterSkip:
      return "Next encounter will be auto-defeated";
    default:
      return "Effect armed";
  }
}

function borderForKind(kind: number): string {
  switch (kind) {
    case AbilityKind.CritNext: return "border-red-900/40";
    case AbilityKind.ShieldNext: return "border-blue-900/40";
    case AbilityKind.EncounterSkip: return "border-fuchsia-900/40";
    case AbilityKind.BuffNext: return "border-amber-900/40";
    default: return "border-zinc-800";
  }
}

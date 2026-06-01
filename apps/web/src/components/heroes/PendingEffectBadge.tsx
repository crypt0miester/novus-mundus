"use client";

import { useEffect, useRef } from "react";
import {
  getAbilityKindMeta,
  getBuffStatMeta,
  formatDurationCompact,
  AbilityKind,
} from "novus-mundus-sdk";
import { animate } from "animejs";
import { usePendingEffect } from "@/lib/hooks/useHeroAbility";
import { prefersReducedMotion } from "@/lib/utils";
import { BLOOM } from "@/lib/motion/tokens";

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

  // The wrapper the one-shot arm-in bloom plays on.
  const rootRef = useRef<HTMLDivElement>(null);
  // Edge-detect arming: usePendingEffect re-evaluates on every second tick, so a
  // raw mount check would re-fire on each render. Track the previous armed kind
  // and bloom only when an effect newly arms (none or kind change).
  const prevKindRef = useRef<number>(0);

  const kind = pending?.kind ?? 0;

  // One-shot arm-in: bloom on the edge where an effect appears or swaps kind.
  useEffect(() => {
    if (kind === 0 || prefersReducedMotion()) {
      prevKindRef.current = kind;
      return;
    }
    if (kind !== prevKindRef.current && rootRef.current) {
      animate(rootRef.current, {
        scale: [0.92, 1.04, 1],
        opacity: [0, 1],
        ease: BLOOM,
        duration: 480,
      });
    }
    prevKindRef.current = kind;
  }, [kind]);

  if (!pending) return null;

  const meta = getAbilityKindMeta(pending.kind);
  const label = describePending(pending);
  const remaining = formatDurationCompact(pending.remainingSecs);

  if (variant === "inline") {
    return (
      <div
        ref={rootRef}
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-surface px-2.5 py-1 text-[10px]"
      >
        <span className={meta.accentClass}>{meta.icon}</span>
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">· {remaining}</span>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`rounded-md border bg-surface px-3 py-2 ${borderForKind(pending.kind)}`}
    >
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
      return `combat action: +${pct}% ${stat?.name ?? "stat"}`;
    }
    case AbilityKind.CritNext:
      return "attack will be a guaranteed crit";
    case AbilityKind.ShieldNext:
      return "defense will be doubled";
    case AbilityKind.EncounterSkip:
      return "encounter will be auto-defeated";
    default:
      return "effect armed";
  }
}

function borderForKind(kind: number): string {
  switch (kind) {
    case AbilityKind.CritNext:
      return "border-red-900/40";
    case AbilityKind.ShieldNext:
      return "border-blue-900/40";
    case AbilityKind.EncounterSkip:
      return "border-fuchsia-900/40";
    case AbilityKind.BuffNext:
      return "border-border-gold/40";
    default:
      return "border-zinc-800";
  }
}

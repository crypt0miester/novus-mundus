"use client";

import { useState } from "react";
import { GameFooter } from "./_shell";

/** Client-safe Ordering presentation (server `ordering` archetype). */
export interface OrderingPresentation {
  instruction: string;
  metricLabel: string;
  items: { label: string; metric: number }[];
}

interface OrderingGameProps {
  presentation: OrderingPresentation;
  submitting: boolean;
  onSubmit: (answer: number[]) => void;
}

/**
 * Ordering game UI. The player nudges items up and down into the right order
 * and submits the final sequence.
 */
export function OrderingGame({ presentation, submitting, onSubmit }: OrderingGameProps) {
  const { instruction, metricLabel, items } = presentation;
  const [order, setOrder] = useState<number[]>(() => items.map((_, i) => i));

  const move = (pos: number, dir: -1 | 1) => {
    const target = pos + dir;
    if (target < 0 || target >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      const held = next[pos]!;
      next[pos] = next[target]!;
      next[target] = held;
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">{instruction}</p>
      <div className="space-y-1.5">
        {order.map((itemIdx, pos) => {
          const it = items[itemIdx];
          if (!it) return null;
          return (
            <div key={itemIdx} className="card flex items-center justify-between gap-2 py-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-overlay text-[11px] font-bold tabular-nums text-text-muted">
                  {pos + 1}
                </span>
                <span className="text-sm font-semibold text-text-primary">{it.label}</span>
                <span className="text-[11px] tabular-nums text-text-muted">
                  {metricLabel} {it.metric}
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={submitting || pos === 0}
                  onClick={() => move(pos, -1)}
                  aria-label="Move up"
                  className="rounded border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors hover:border-border-gold/50 disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={submitting || pos === order.length - 1}
                  onClick={() => move(pos, 1)}
                  aria-label="Move down"
                  className="rounded border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors hover:border-border-gold/50 disabled:opacity-30"
                >
                  ▼
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <GameFooter
        submitLabel="Submit order"
        submitting={submitting}
        onSubmit={() => onSubmit(order)}
      />
    </div>
  );
}

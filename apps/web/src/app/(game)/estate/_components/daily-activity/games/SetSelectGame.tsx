"use client";

import { GameFooter, useIndexedSelection } from "./_shell";

/** Client-safe SetSelect presentation (server `set-select` archetype). */
export interface SetSelectPresentation {
  instruction: string;
  aLabel: string;
  bLabel: string;
  items: { label: string; a: number; b: number }[];
}

interface SetSelectGameProps {
  presentation: SetSelectPresentation;
  submitting: boolean;
  onSubmit: (answer: boolean[]) => void;
}

/**
 * SetSelect game UI. Each item shows two labelled numbers; the player taps the
 * items that satisfy the rule (the genuine ones) and submits once.
 */
export function SetSelectGame({ presentation, submitting, onSubmit }: SetSelectGameProps) {
  const { instruction, aLabel, bLabel, items } = presentation;
  const [selected, setSelectedAt] = useIndexedSelection<boolean>(() => items.map(() => false));

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">{instruction}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((it, i) => {
          const on = selected[i] ?? false;
          return (
            <button
              key={i}
              type="button"
              disabled={submitting}
              onClick={() => setSelectedAt(i, !on)}
              className={`card flex items-center justify-between gap-2 text-left transition-colors ${
                on ? "border-border-gold bg-accent/20" : "hover:border-border-gold/50"
              }`}
            >
              <div>
                <div className="text-sm font-semibold text-text-primary">{it.label}</div>
                <div className="text-[11px] tabular-nums text-text-muted">
                  {aLabel} {it.a} · {bLabel} {it.b}
                </div>
              </div>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                  on
                    ? "border-border-gold-bright bg-gold-500/30 text-text-gold"
                    : "border-border-default"
                }`}
              >
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <GameFooter
        submitLabel="Submit"
        submitting={submitting}
        onSubmit={() => onSubmit(items.map((_, i) => selected[i] ?? false))}
      />
    </div>
  );
}

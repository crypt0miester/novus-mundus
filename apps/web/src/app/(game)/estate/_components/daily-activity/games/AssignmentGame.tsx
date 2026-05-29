"use client";

import { GameFooter, GameHeader, GameTimer, useFireOnce, useIndexedSelection } from "./_shell";

/** Client-safe Assignment presentation (server `assignment` archetype). */
export interface AssignmentPresentation {
  instruction: string;
  valueLabel: string;
  bins: { label: string; from: number; to: number }[];
  items: { label: string; value: number }[];
}

interface AssignmentGameProps {
  presentation: AssignmentPresentation;
  submitting: boolean;
  onSubmit: (answer: number[]) => void;
}

// 4s per item — enough to read the value, glance at the bins, and tap.
const MS_PER_ITEM = 4_000;

/**
 * Assignment game UI. Each item shows a value; the player taps the bin it
 * belongs in, then submits once every item is sorted — or the round-wide
 * timer runs out, snap-submitting current state with unsorted items as -1.
 */
export function AssignmentGame({ presentation, submitting, onSubmit }: AssignmentGameProps) {
  const { instruction, valueLabel, bins, items } = presentation;
  const [assigned, setAssignedAt] = useIndexedSelection<number | null>(() => items.map(() => null));

  const sorted = assigned.filter((a) => a !== null).length;
  const allSorted = sorted === items.length;

  const fireSubmit = useFireOnce(() => onSubmit(assigned.map((a) => a ?? -1)));

  return (
    <div className="space-y-3">
      <GameHeader current={Math.min(sorted + 1, items.length)} total={items.length} noun="Sort" />
      <GameTimer totalMs={MS_PER_ITEM * items.length} paused={submitting} onExpire={fireSubmit} />

      <p className="text-sm text-text-secondary">{instruction}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-text-muted">
        {bins.map((b, bi) => (
          <span key={bi}>
            <span className="text-text-secondary">{b.label}</span> {b.from}–{b.to}
          </span>
        ))}
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="card flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-sm font-semibold text-text-primary">{it.label}</span>
              <span className="ml-2 text-[11px] tabular-nums text-text-muted">
                {valueLabel} {it.value}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bins.map((b, bi) => (
                <button
                  key={bi}
                  type="button"
                  disabled={submitting}
                  onClick={() => setAssignedAt(i, bi)}
                  className={`rounded-lg border px-3 py-1 text-xs font-medium transition-all ${
                    assigned[i] === bi
                      ? "scale-105 border-border-gold bg-accent/30 text-text-gold shadow-[0_0_10px_-3px_rgba(220,180,90,0.55)]"
                      : "border-border-default text-text-secondary hover:border-border-gold/50"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <GameFooter
        progress={{ done: sorted, total: items.length, noun: "sorted" }}
        submitLabel={allSorted ? "Submit roll" : "Submit (unsorted count as wrong)"}
        submitting={submitting}
        disabled={false}
        onSubmit={fireSubmit}
      />
    </div>
  );
}

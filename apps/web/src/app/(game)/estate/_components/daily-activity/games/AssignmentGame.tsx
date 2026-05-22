"use client";

import { GameFooter, useIndexedSelection } from "./_shell";

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

/**
 * Assignment game UI. Each item shows a value; the player taps the bin it
 * belongs in, then submits once every item is sorted.
 */
export function AssignmentGame({ presentation, submitting, onSubmit }: AssignmentGameProps) {
  const { instruction, valueLabel, bins, items } = presentation;
  const [assigned, setAssignedAt] = useIndexedSelection<number | null>(() => items.map(() => null));

  const sorted = assigned.filter((a) => a !== null).length;
  const allSorted = sorted === items.length;

  return (
    <div className="space-y-3">
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
                  className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                    assigned[i] === bi
                      ? "border-border-gold bg-accent/30 text-text-gold"
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
        submitLabel="Submit"
        submitting={submitting}
        disabled={!allSorted}
        onSubmit={() => onSubmit(assigned.map((a) => a ?? -1))}
      />
    </div>
  );
}

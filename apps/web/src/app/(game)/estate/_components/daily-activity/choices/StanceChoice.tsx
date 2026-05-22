"use client";

/**
 * Citadel "Watch Report" — a Class A choice, not a graded game. The player
 * picks one of three stances; the co-sign route encodes it into the on-chain
 * stance bucket (all three reachable, Defensive included).
 */

const STANCES = [
  {
    id: 0,
    name: "Defensive",
    glyph: "🛡",
    desc: "Hold the walls — your estate favors defense today.",
  },
  {
    id: 1,
    name: "Balanced",
    glyph: "⚖",
    desc: "Even footing — no bias toward attack or defense.",
  },
  {
    id: 2,
    name: "Aggressive",
    glyph: "⚔",
    desc: "Press the advantage — your estate favors attack today.",
  },
];

/** The stance label for a chosen id — used in the result summary. */
export function stanceName(choice: number): string {
  return STANCES[choice]?.name ?? "Balanced";
}

interface StanceChoiceProps {
  submitting: boolean;
  onChoose: (choice: number) => void;
}

export function StanceChoice({ submitting, onChoose }: StanceChoiceProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {STANCES.map((s) => (
        <button
          key={s.id}
          disabled={submitting}
          onClick={() => onChoose(s.id)}
          className="card text-left transition-colors hover:border-border-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <div className="text-2xl">{s.glyph}</div>
          <div className="mt-1 font-display font-semibold text-text-primary">{s.name}</div>
          <p className="mt-1 text-xs text-text-muted">{s.desc}</p>
        </button>
      ))}
    </div>
  );
}

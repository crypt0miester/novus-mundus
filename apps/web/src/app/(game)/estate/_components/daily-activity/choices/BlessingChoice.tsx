"use client";

/**
 * Sanctuary "Hero Blessing" — a Class A choice. The player picks one locked
 * hero; the co-sign route validates it against the roster and blesses it for
 * the day (+25% effectiveness).
 */

interface BlessingChoiceProps {
  /** Base58 mints of the player's locked (active) heroes. */
  heroes: string[];
  submitting: boolean;
  onChoose: (heroMint: string) => void;
}

export function BlessingChoice({
  heroes,
  submitting,
  onChoose,
}: BlessingChoiceProps) {
  if (heroes.length === 0) {
    return (
      <div className="card text-center text-sm text-text-muted">
        Lock a hero to your roster before performing the Sanctuary blessing.
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {heroes.map((mint, i) => (
        <button
          key={mint}
          disabled={submitting}
          onClick={() => onChoose(mint)}
          className="card text-left transition-colors hover:border-amber-700/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <div className="text-2xl">🦅</div>
          <div className="mt-1 font-display font-semibold text-text-primary">
            Hero {i + 1}
          </div>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            {mint.slice(0, 4)}…{mint.slice(-4)}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            +25% effectiveness for the day
          </p>
        </button>
      ))}
    </div>
  );
}

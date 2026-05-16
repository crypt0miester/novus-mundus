"use client";

import { useCallback, useState } from "react";

/**
 * Shared shell for the single-shot mini-games. Each one collects one slot of
 * state per presentation item and submits the whole array once, so they all
 * want the same immutable indexed setter and the same submit footer.
 */

/**
 * Indexed selection state — one value per item, with an immutable `setAt`.
 * `initial` builds the starting array (e.g. `() => items.map(() => null)`).
 */
export function useIndexedSelection<T>(initial: () => T[]) {
  const [values, setValues] = useState<T[]>(initial);

  const setAt = useCallback((i: number, v: T) => {
    setValues((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  }, []);

  return [values, setAt] as const;
}

interface GameFooterProps {
  /** Item-completion count; omit for games with no progress meter. */
  progress?: { done: number; total: number; noun: string };
  submitLabel: string;
  submitting: boolean;
  /** Disable the button beyond the `submitting` lock (e.g. incomplete answers). */
  disabled?: boolean;
  onSubmit: () => void;
}

/** The submit footer shared by the single-shot mini-games. */
export function GameFooter({
  progress,
  submitLabel,
  submitting,
  disabled,
  onSubmit,
}: GameFooterProps) {
  return (
    <div
      className={`flex items-center gap-3 pt-1 ${
        progress ? "justify-between" : "justify-end"
      }`}
    >
      {progress && (
        <span className="text-xs tabular-nums text-text-muted">
          {progress.done} / {progress.total} {progress.noun}
        </span>
      )}
      <button
        type="button"
        disabled={disabled || submitting}
        onClick={onSubmit}
        className="rounded-lg border border-border-gold bg-amber-900/20 px-6 py-2 text-sm font-semibold text-text-gold transition-colors hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Submitting…" : submitLabel}
      </button>
    </div>
  );
}

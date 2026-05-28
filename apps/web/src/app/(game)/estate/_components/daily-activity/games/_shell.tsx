"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Mini-games are co-signed by the game_authority: the cosigner is the
// authoritative arbiter of reward. Client-side tier display is the human
// urgency signal and sets up the wire for cosigner-side elapsed_ms scoring
// (the actual bot defense). See docs/dev-todo.md #18.

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

/**
 * Wraps an action so it runs at most once even if called from multiple sources
 * (button click + timer expiry). Captures the latest `fn` via ref so the
 * caller can re-create the callback freely without restarting the guard.
 */
export function useFireOnce(fn: () => void): () => void {
  const firedRef = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    fnRef.current();
  }, []);
}

// Tier ramp — single source of truth shared with ReflexGame's reactionTag /
// precisionTag (which still own their domain-specific labels). The label here
// is the neutral fallback; games pass their own flavored label when present.
export type ScoreTier = "razor" | "sharp" | "steady" | "slow";

const TIER_STYLE: Record<
  ScoreTier,
  { label: string; tone: string; chip: string }
> = {
  razor: {
    label: "Razor sharp",
    tone: "text-text-gold",
    chip: "border-gold-300 bg-gold-500/20",
  },
  sharp: {
    label: "Sharp",
    tone: "text-gold-300",
    chip: "border-gold-400/60 bg-gold-500/10",
  },
  steady: {
    label: "Steady",
    tone: "text-gold-400",
    chip: "border-border-default bg-surface-overlay/40",
  },
  slow: {
    label: "Slow off the mark",
    tone: "text-zinc-400",
    chip: "border-zinc-800 bg-zinc-950/60",
  },
};

/** Tier from remaining fraction (0..1). Round-wide timers: more time left = higher tier. */
export function tierFromRemaining(frac: number): ScoreTier {
  if (frac >= 0.66) return "razor";
  if (frac >= 0.33) return "sharp";
  if (frac > 0) return "steady";
  return "slow";
}

/** Tier from move efficiency for Memory: `pairs` is the optimal-flip baseline. */
export function tierFromMemoryMoves(moves: number, pairs: number): ScoreTier {
  const ratio = moves / pairs;
  if (ratio <= 2.2) return "razor";
  if (ratio <= 3) return "sharp";
  if (ratio <= 4) return "steady";
  return "slow";
}

/**
 * Progress pips lifted out of ReflexGame so MCQ / Memory / Ordering / etc. read
 * with the same visual cadence. `current` is 1-based; pass `current=total+1` to
 * show every pip lit (completion state). `pips={false}` hides the dots for
 * games whose progress isn't sequential (Ordering, SetSelect).
 */
export function GameHeader({
  current,
  total,
  noun,
  trailing,
  pips = true,
}: {
  current: number;
  total: number;
  noun?: string;
  trailing?: React.ReactNode;
  pips?: boolean;
}) {
  const completed = Math.max(0, current - 1);
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] uppercase tracking-wider text-text-muted">
        {noun ?? "Step"} {Math.min(current, total)} / {total}
      </span>
      <div className="flex items-center gap-3">
        {trailing}
        {pips && (
          <div className="flex gap-1.5">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={`h-2 w-2 rounded-full ${
                  i < completed
                    ? "bg-gold-400"
                    : i === completed
                      ? "bg-gold-400/40 ring-1 ring-gold-400"
                      : "bg-border-default"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Gold-ramp chip used at per-round / per-completion summary moments. */
export function ResultBadge({
  tier,
  label,
}: {
  tier: ScoreTier;
  label?: string;
}) {
  const s = TIER_STYLE[tier];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.chip} ${s.tone}`}
    >
      {label ?? s.label}
    </span>
  );
}

// Re-render the bar only when remaining ms crosses a 100ms quantum.
// 60Hz raf × no quantization = ~60 React renders/sec of the whole game tree;
// 10Hz is plenty for a draining bar and reduces render cost ~6×.
const REMAINING_QUANTUM_MS = 100;

/**
 * Draining countdown bar. Color-shifts gold → amber → red and pulses red in
 * the danger band. `onExpire` fires once when the bar hits zero. Pause is a
 * single-trip in practice (paused={submitting}); resetting on pause is the
 * right semantics — the session deadline in MinigameSession handles longer
 * suspensions.
 */
export function GameTimer({
  totalMs,
  paused,
  onExpire,
}: {
  totalMs: number;
  paused?: boolean;
  onExpire?: () => void;
}) {
  const [remaining, setRemaining] = useState(totalMs);
  const firedRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    let raf = 0;
    const loop = () => {
      const elapsed = performance.now() - start;
      const r = Math.max(0, totalMs - elapsed);
      const quantized = Math.floor(r / REMAINING_QUANTUM_MS) * REMAINING_QUANTUM_MS;
      setRemaining(quantized);
      if (r <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current?.();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, totalMs]);

  // Guard totalMs=0 — frac would be NaN and the bar would silently vanish.
  const frac = totalMs > 0 ? remaining / totalMs : 0;
  const danger = frac <= 0.2;
  const warning = !danger && frac <= 0.5;
  const barColor = danger
    ? "bg-red-500"
    : warning
      ? "bg-amber-400"
      : "bg-gold-400";

  return (
    <div className="space-y-0.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
        <div
          className={`h-full ${barColor} ${danger ? "animate-pulse" : ""}`}
          style={{ width: `${frac * 100}%` }}
        />
      </div>
      <div className="flex justify-end font-mono text-[10px] tabular-nums text-text-muted">
        {(remaining / 1000).toFixed(1)}s
      </div>
    </div>
  );
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
    <div className={`flex items-center gap-3 pt-1 ${progress ? "justify-between" : "justify-end"}`}>
      {progress && (
        <span className="text-xs tabular-nums text-text-muted">
          {progress.done} / {progress.total} {progress.noun}
        </span>
      )}
      <button
        type="button"
        disabled={disabled || submitting}
        onClick={onSubmit}
        className="rounded-lg border border-border-gold bg-accent/20 px-6 py-2 text-sm font-semibold text-text-gold transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Submitting…" : submitLabel}
      </button>
    </div>
  );
}

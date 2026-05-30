"use client";

import {
  type AnimatableObject,
  type Timeline,
  createAnimatable,
  createTimeline,
  steps,
  utils,
} from "animejs";
import { useCallback, useEffect, useRef, useState } from "react";
import { registerCountdown } from "@/lib/motion/countdownClock";
import { DUR, EASE, SETTLE } from "@/lib/motion/tokens";
import { prefersReducedMotion } from "@/lib/utils";

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

// Pick a slot-roll step count tuned to the score range so the count-up reads as
// a ledger ticking over rather than a smooth lerp. Wider scores get more steps.
function rollSteps(score: number): number {
  if (score <= 0) return 1;
  if (score <= 20) return Math.max(6, score);
  if (score <= 100) return 24;
  return 30;
}

/**
 * The shared score-reveal celebration so ActivityResult / MemoryGame / the
 * single-shot games inherit one cadence: the card springs in, the score rolls
 * up on a `steps()` slot cadence (fits an economy game), and the final number
 * pops on `outElastic`. `onTick` writes the rolling value to the DOM each frame
 * (drive the number node directly, do not re-render per frame). Returns a cancel
 * fn; under reduced motion it sets the final value once and skips choreography.
 */
export function celebrate(opts: {
  card: HTMLElement;
  number: HTMLElement;
  score: number;
  format?: (v: number) => string;
  onTick: (v: number) => void;
}): () => void {
  const { card, number, score, format, onTick } = opts;
  const render = format ?? ((v: number) => Math.round(v).toLocaleString());

  if (prefersReducedMotion()) {
    onTick(score);
    number.textContent = render(score);
    return () => {};
  }

  const counter = { v: 0 };
  const tl: Timeline = createTimeline({ defaults: { ease: EASE.drama } });
  tl.add(card, { scale: [0.86, 1], opacity: [0, 1], ease: SETTLE, duration: DUR.base }, 0)
    .add(
      counter,
      {
        v: [0, score],
        duration: DUR.slow,
        ease: steps(rollSteps(score)),
        onUpdate: () => {
          const v = Math.round(counter.v);
          number.textContent = render(v);
          onTick(v);
        },
      },
      "+=80",
    )
    // Final number lands and rings out on outElastic, the earned-stamp beat.
    .add(
      number,
      { scale: [1, 1.25, 1], ease: "outElastic(1, 0.5)", duration: DUR.base },
      "<<+=520",
    );

  return () => tl.cancel();
}

// Tier ramp — single source of truth shared with ReflexGame's reactionTag /
// precisionTag (which still own their domain-specific labels). The label here
// is the neutral fallback; games pass their own flavored label when present.
export type ScoreTier = "razor" | "sharp" | "steady" | "slow";

const TIER_STYLE: Record<ScoreTier, { label: string; tone: string; chip: string }> = {
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
export function ResultBadge({ tier, label }: { tier: ScoreTier; label?: string }) {
  const s = TIER_STYLE[tier];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.chip} ${s.tone}`}
    >
      {label ?? s.label}
    </span>
  );
}

// Re-render the bar band only when the urgency tier crosses a boundary.
// Width / seconds / urgency var / heartbeat are all driven from the shared
// countdown clock's onTick straight onto the DOM, so the React tree only
// re-renders on the three color-band transitions, not every frame.
type UrgencyBand = "calm" | "warning" | "danger";

function bandFor(frac: number): UrgencyBand {
  if (frac <= 0.2) return "danger";
  if (frac <= 0.5) return "warning";
  return "calm";
}

/**
 * Single accelerating-urgency countdown bar on the shared countdown clock (one
 * createTimer fans out to every live countdown, frame-synced and paused
 * together). The bar fill and seconds text are driven straight from onTick; a
 * `--urgency` var smoothly cross-fades the bar color across the whole drain via
 * one reused createAnimatable; and the danger heartbeat *accelerates* (cadence
 * shrinks as ms drop) rather than a fixed blink. The `firedRef` onExpire guard
 * fires once at zero. Pause is a single trip in practice (paused={submitting});
 * resetting on pause is the right semantics — the session deadline in
 * MinigameSession handles longer suspensions.
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
  const [band, setBand] = useState<UrgencyBand>("calm");
  const firedRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const secondsRef = useRef<HTMLSpanElement>(null);
  // One reused animatable carries the per-frame --urgency channel (never an
  // animate() per frame). The danger heartbeat is a separate pulse animatable.
  const urgencyRef = useRef<AnimatableObject | null>(null);
  const beatRef = useRef<AnimatableObject | null>(null);
  // Edge state so the band React-render and the heartbeat each fire on the edge,
  // not every tick.
  const bandRef = useRef<UrgencyBand>("calm");
  const lastBeatRef = useRef(0);

  useEffect(() => {
    const root = rootRef.current;
    const fill = fillRef.current;
    if (!root || !fill) return;
    // Reset the one-shot guard whenever the timer is (re)armed.
    firedRef.current = false;
    bandRef.current = "calm";
    lastBeatRef.current = 0;
    setBand("calm");

    const reduce = prefersReducedMotion();
    // The --urgency channel rides on the root as a real CSS custom property
    // (anime.js writes any "--"-prefixed key via setProperty); CSS color-mixes
    // the bar color from it. One reused animatable, never an animate() per frame.
    const urgency = createAnimatable(root, { "--urgency": 0, duration: reduce ? 0 : 220 });
    urgencyRef.current = urgency;
    // The danger heartbeat dims and restores the fill (opacity is compositor
    // cheap); on a 6px bar an opacity throb reads far better than a scale pulse.
    const beat = createAnimatable(fill, { opacity: 1, duration: 120, ease: EASE.out });
    beatRef.current = beat;

    const paint = (remainingMs: number, frac: number) => {
      // Drain via scaleX (transform-origin: left) rather than width, so the
      // per-frame DOM write rides the compositor and React's static width:100%
      // never clobbers it on a band re-render. Seconds text goes straight to DOM.
      fill.style.transform = `scaleX(${utils.clamp(frac, 0, 1)})`;
      const s = secondsRef.current;
      if (s) s.textContent = `${(remainingMs / 1000).toFixed(1)}s`;

      // --urgency cross-fades 0 -> 1 across the whole drain (CSS mixes the band
      // color from it). mapRange so it tracks elapsed, not just the danger band.
      urgency["--urgency"](utils.mapRange(utils.clamp(frac, 0, 1), 1, 0, 0, 1));

      const next = bandFor(frac);
      if (next !== bandRef.current) {
        bandRef.current = next;
        setBand(next);
      }

      // Accelerating danger heartbeat: the cadence shrinks from ~520ms toward
      // ~140ms as the last fifth burns down, so the pulse visibly quickens.
      if (next === "danger" && remainingMs > 0 && !reduce) {
        const cadence = utils.mapRange(utils.clamp(frac, 0, 0.2), 0.2, 0, 520, 140);
        const now = Date.now();
        if (now - lastBeatRef.current >= cadence) {
          lastBeatRef.current = now;
          // Dim sharply then restore: one throb per accelerating cadence window.
          beat.opacity(0.45);
          beat.opacity(1, 140);
        }
      }
    };

    if (paused || totalMs <= 0) {
      // Paused / armed-empty: paint a full bar and idle, no live countdown.
      paint(totalMs, totalMs > 0 ? 1 : 0);
      return () => {
        urgency.revert();
        beat.revert();
        urgencyRef.current = null;
        beatRef.current = null;
      };
    }

    const startTs = Date.now();
    const unregister = registerCountdown({
      startTs,
      endTs: startTs + totalMs,
      onTick: (remainingMs, fraction) => {
        // fraction is elapsed progress 0..1; the bar shows remaining.
        const remFrac = 1 - fraction;
        paint(remainingMs, remFrac);
        if (remainingMs <= 0 && !firedRef.current) {
          firedRef.current = true;
          onExpireRef.current?.();
        }
      },
    });

    return () => {
      unregister();
      urgency.revert();
      beat.revert();
      urgencyRef.current = null;
      beatRef.current = null;
    };
  }, [paused, totalMs]);

  // The --urgency channel (0 calm -> 1 expired) cross-fades the fill color
  // continuously through amber via color-mix, so the bar shifts gold -> red over
  // the whole drain instead of snapping at the band edges. The discrete `band`
  // state is reserved for the reduced-motion danger pulse, where the live
  // heartbeat is suppressed.
  const danger = band === "danger";

  return (
    <div
      ref={rootRef}
      className="space-y-0.5"
      style={{ ["--urgency" as string]: 0 } as React.CSSProperties}
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
        <div
          ref={fillRef}
          className={`h-full w-full origin-left ${danger ? "motion-reduce:animate-pulse" : ""}`}
          style={{
            transform: `scaleX(${totalMs > 0 ? 1 : 0})`,
            backgroundColor:
              "color-mix(in oklab, var(--color-gold-400) calc((1 - var(--urgency)) * 100%), #ef4444)",
          }}
        />
      </div>
      <div className="flex justify-end font-mono text-[10px] tabular-nums text-text-muted">
        <span ref={secondsRef}>{(totalMs / 1000).toFixed(1)}s</span>
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

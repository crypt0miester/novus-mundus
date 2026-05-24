"use client";

import { useEffect, useRef, useState } from "react";
import { JumpAhead } from "./JumpAhead";
import { BeatEyebrow } from "./Beat";
import { useRevealOnMount } from "./useRevealOnMount";
import { useJumpAhead } from "@/lib/jumpstart/useJumpAhead";
import {
  JUMP_RECIPES,
  JUMP_TIER_ORDER,
  jumpTierSol,
  type JumpTier,
} from "@/lib/jumpstart/recipes";
import type { CityChoice } from "./Arrival";

interface JumpAheadBeatProps {
  /** The ground chosen in the preceding ChoiceBeat. */
  city: CityChoice | null;
  /** Ends the Arrival and drops the player into the realm. */
  onComplete: () => void;
  /** Set when resuming a persisted jump — auto-runs this tier, skips the picker. */
  resumeTier?: JumpTier;
}

/** What each tier visibly grants — one line for the picker card. */
const TIER_BLURB: Record<JumpTier, string> = {
  settled: "An estate, a Barracks, and a standing garrison.",
  established: "Barracks, Camp, Market, Stables, Academy — and a fuller host.",
  veteran: "A built-out estate through the Citadel, and an army.",
};

/**
 * The jump-ahead beat — an alternative to playing through the early game.
 * Pick a tier; the executor replays the real instruction pipeline behind one
 * signature and the stepper shows it land.
 */
export function JumpAheadBeat({
  city,
  onComplete,
  resumeTier,
}: JumpAheadBeatProps) {
  const jump = useJumpAhead();
  const [tier, setTier] = useState<JumpTier | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  useRevealOnMount(pickerRef, { translateY: 14, staggerStep: 90, duration: 600 });

  const pick = (t: JumpTier) => {
    if (!city) return;
    setTier(t);
    jump.start(JUMP_RECIPES[t], city);
  };

  // Resuming a persisted jump — auto-run the saved tier (start reads the
  // localStorage journal, so confirmed steps are skipped).
  useEffect(() => {
    if (resumeTier && city && !startedRef.current) {
      startedRef.current = true;
      pick(resumeTier);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeTier, city]);

  // Once a tier is chosen and the run has begun, the stepper owns the screen.
  if (tier && jump.phase !== "idle") {
    return (
      <JumpAhead
        tierLabel={JUMP_RECIPES[tier].label}
        steps={jump.steps}
        phase={jump.phase}
        elapsedMs={jump.elapsedMs}
        log={jump.log}
        onEnter={jump.phase === "done" ? onComplete : undefined}
        onRetry={jump.phase === "failed" ? jump.resume : undefined}
        walletSol={jump.walletSol}
        onRefetchBalance={jump.refetchBalance}
      />
    );
  }

  return (
    <div
      ref={pickerRef}
      className="mx-auto flex w-full max-w-md flex-col items-center text-center"
    >
      <BeatEyebrow reveal className="mb-2">
        The Leap
      </BeatEyebrow>
      <h2
        data-reveal
        className="tier-title mb-3 font-display text-2xl font-bold tracking-wide opacity-0"
      >
        Jump ahead
      </h2>
      <p
        data-reveal
        className="mb-7 text-sm leading-relaxed text-text-secondary opacity-0"
      >
        the early road is a known road.
      </p>
      <p
        data-reveal
        className="mb-7 text-sm leading-relaxed text-text-secondary opacity-0"
      >
        pay it forward instead.
      </p>
      <p
        data-reveal
        className="mb-7 text-sm leading-relaxed text-text-secondary opacity-0"
      >
        arrive with ground already broken and a host already raised.
      </p>

      <div data-reveal className="flex w-full flex-col gap-3 opacity-0">
        {JUMP_TIER_ORDER.map((t) => {
          const r = JUMP_RECIPES[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => pick(t)}
              disabled={!city}
              className="group flex items-center justify-between gap-4 rounded-xl border border-border-default bg-surface-raised px-4 py-3 text-left transition-colors hover:border-[var(--tier-accent)] disabled:opacity-40"
            >
              <span>
                <span className="block font-display text-sm font-bold text-text-primary">
                  {r.label}
                </span>
                <span className="block text-xs text-text-muted">
                  {TIER_BLURB[t]}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-surface px-3 py-1 font-mono text-xs font-bold text-text-gold">
                {jumpTierSol(r)} SOL
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

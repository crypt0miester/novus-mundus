"use client";

import { useEffect, useRef } from "react";
import { celebrate } from "./games/_shell";

interface ActivityResultProps {
  title: string;
  /** 0-100 for graded mini-games; omitted for Class A choices. */
  score?: number;
  /** The reward / outcome line. */
  summary: string;
  onClose: () => void;
}

/**
 * The reward reveal shown after a daily activity is co-signed. Graded
 * mini-games slot-roll the score up via the shared `celebrate()` helper (card
 * spring, `steps()` ledger cadence, `outElastic` final pop); Class A choices
 * just show the outcome. Under reduced motion `celebrate()` sets the final
 * value once and skips the choreography.
 */
export function ActivityResult({ title, score, summary, onClose }: ActivityResultProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLSpanElement>(null);

  // When a score is present, celebrate() owns the card entrance spring (and sets
  // final state directly under reduced motion), so the card opts out of the CSS
  // animate-in entrance to avoid a double-fire. Class A choices (no score) keep
  // the lightweight CSS entrance.
  const graded = score !== undefined;

  useEffect(() => {
    if (score === undefined) return;
    const card = cardRef.current;
    const number = numberRef.current;
    if (!card || !number) return;
    const cancel = celebrate({ card, number, score, onTick: () => {} });
    return cancel;
  }, [score]);

  return (
    <div
      ref={cardRef}
      className={`card accent-border text-center ${graded ? "" : "animate-in fade-in zoom-in-95 duration-300"}`}
    >
      <div className="text-xs uppercase tracking-wider text-text-muted">{title} — complete</div>
      {score !== undefined && (
        <div className="mt-2 font-display text-5xl font-bold tabular-nums text-text-gold">
          <span ref={numberRef} className="inline-block">
            0
          </span>
          <span className="ml-1 text-lg text-text-muted">/ 100</span>
        </div>
      )}
      <p className="mt-2 text-sm text-text-secondary">{summary}</p>
      <button
        onClick={onClose}
        className="mt-4 rounded-lg border border-border-gold bg-accent/20 px-6 py-2 text-sm font-semibold text-text-gold transition-colors hover:bg-accent/40"
      >
        Done
      </button>
    </div>
  );
}

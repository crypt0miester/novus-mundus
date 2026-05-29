"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MoveResponse } from "@/lib/hooks/useDailyActivity";
import { GameHeader, GameTimer, ResultBadge, tierFromMemoryMoves } from "./_shell";

/** Client-safe Memory presentation (server `memory` archetype). */
export interface MemoryPresentation {
  tiles: number;
  pairs: number;
}

/** The shape of a `memory` archetype `/move` result. */
interface MemoryMoveResult {
  flipped: number;
  face: number;
  outcome: "first" | "match" | "mismatch";
  pair?: [number, number];
  matched: number[];
  moves: number;
}

const SYMBOLS = ["◆", "●", "▲", "■", "★", "✦", "❖", "⬟"];
// Pairs match on symbol+color, so all 8 colours must be distinct.
const SYMBOL_COLORS = [
  "text-gold-300",
  "text-sky-300",
  "text-teal-300",
  "text-rose-300",
  "text-violet-300",
  "text-zinc-300",
  "text-orange-500",
  "text-fuchsia-300",
];

interface MemoryGameProps {
  presentation: MemoryPresentation;
  submitting: boolean;
  sendMove: (move: unknown) => Promise<MoveResponse>;
  onComplete: () => void;
}

// ~3s per pair as a soft target — enough room for a clean run, tight enough
// that hesitation costs a tier. Time pressure is *display-only* here: Memory's
// tier metric is efficiency (moves vs `pairs`), not clock; the bar exists to
// push the player to commit rather than dither.
const MS_PER_PAIR = 3_000;

const SUMMARY_BEAT_MS = 1_800;

/**
 * Memory game UI — Treasury "Ledger Audit". The board lives server-side; each
 * tile tap is a `/move` and the server returns just that tile's face. Matched
 * pairs stay revealed; a mismatch shows both briefly, then flips them back.
 */
export function MemoryGame({ presentation, submitting, sendMove, onComplete }: MemoryGameProps) {
  const { tiles, pairs } = presentation;
  const [revealed, setRevealed] = useState<Record<number, number>>({});
  const [matched, setMatched] = useState<Set<number>>(() => new Set());
  const [faceUp, setFaceUp] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [pulseIdx, setPulseIdx] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ moves: number; pairs: number } | null>(null);
  // Track every pending setTimeout so we can clear them on unmount — without
  // this, a player navigating away mid-game can fire setState on an unmounted
  // component (silent in React 18 but defensive) and, worse, the 1.8s summary
  // timeout would call the parent's onComplete on a stale session.
  const timersRef = useRef<Set<number>>(new Set());
  useEffect(
    () => () => {
      for (const id of timersRef.current) clearTimeout(id);
      timersRef.current.clear();
    },
    [],
  );
  const trackedTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  }, []);

  const matchedPairs = matched.size / 2;

  const flip = useCallback(
    async (i: number) => {
      if (busy || submitting || matched.has(i) || i === faceUp || revealed[i] !== undefined) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const { result, done } = await sendMove({ flip: i });
        const r = result as MemoryMoveResult;
        setMoves(r.moves);
        setRevealed((prev) => ({ ...prev, [r.flipped]: r.face }));

        if (r.outcome === "first") {
          setFaceUp(r.flipped);
          setBusy(false);
        } else if (r.outcome === "match") {
          setMatched((prev) => new Set([...prev, ...r.matched]));
          setFaceUp(null);
          // Brief pulse on the pair so the match registers visually.
          const pulsePair = r.pair ?? [r.flipped];
          setPulseIdx(pulsePair);
          trackedTimeout(() => setPulseIdx(null), 450);
          setBusy(false);
          if (done) {
            setSummary({ moves: r.moves, pairs });
            trackedTimeout(onComplete, SUMMARY_BEAT_MS);
          }
        } else {
          // Mismatch — both faces stay up through the flip-back, and the board
          // stays locked (busy) until they turn back down, so a fast tap can't
          // race the timeout that clears `faceUp`.
          const pair = r.pair ?? [r.flipped];
          trackedTimeout(() => {
            setRevealed((prev) => {
              const next = { ...prev };
              for (const t of pair) delete next[t];
              return next;
            });
            setFaceUp(null);
            setBusy(false);
          }, 900);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "move failed");
        setBusy(false);
      }
    },
    [busy, submitting, matched, faceUp, revealed, sendMove, onComplete, pairs, trackedTimeout],
  );

  const cols = tiles <= 12 ? 4 : 6;
  const summaryTier = summary ? tierFromMemoryMoves(summary.moves, summary.pairs) : null;

  return (
    <div className="space-y-3">
      <GameHeader
        current={summary ? pairs + 1 : Math.min(matchedPairs + 1, pairs)}
        total={pairs}
        noun="Pair"
        trailing={
          <span className="font-mono text-[10px] tabular-nums text-text-muted">{moves} flips</span>
        }
      />
      <GameTimer totalMs={MS_PER_PAIR * pairs} paused={submitting || !!summary} />

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: tiles }, (_, i) => {
          const isMatched = matched.has(i);
          const face = revealed[i];
          const shown = face !== undefined;
          const isPulsing = pulseIdx?.includes(i) ?? false;
          return (
            <button
              key={i}
              disabled={busy || submitting || isMatched || shown || !!summary}
              onClick={() => flip(i)}
              className={`flex aspect-square items-center justify-center rounded-lg border text-2xl font-bold transition-all ${
                isMatched
                  ? `border-border-gold/50 bg-accent/30 ${isPulsing ? "scale-110 shadow-[0_0_18px_-2px_rgba(220,180,90,0.7)]" : "opacity-60"}`
                  : shown
                    ? "border-border-gold bg-accent/20"
                    : "border-border-default bg-surface-raised hover:border-border-gold/50"
              }`}
            >
              {shown ? (
                <span className={SYMBOL_COLORS[face % SYMBOL_COLORS.length]}>
                  {SYMBOLS[face % SYMBOLS.length]}
                </span>
              ) : (
                <span className="text-text-muted/50">◇</span>
              )}
            </button>
          );
        })}
      </div>

      {summary && summaryTier ? (
        <div className="card accent-border animate-in fade-in zoom-in-95 text-center duration-300">
          <div className="text-xs uppercase tracking-wider text-text-muted">Ledger reconciled</div>
          <div className="mt-2 font-display text-3xl font-bold tabular-nums text-text-gold">
            {summary.moves} flips
          </div>
          <div className="mt-2 flex justify-center">
            <ResultBadge tier={summaryTier} />
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Optimal pace is {summary.pairs * 2} flips · you closed in {summary.moves}.
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs tabular-nums text-text-muted">
          <span>
            {matchedPairs} / {pairs} pairs matched
          </span>
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";
import type { MoveResponse } from "@/lib/hooks/useDailyActivity";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          setBusy(false);
          if (done) setTimeout(onComplete, 650);
        } else {
          // Mismatch — both faces stay up through the flip-back, and the board
          // stays locked (busy) until they turn back down, so a fast tap can't
          // race the timeout that clears `faceUp`.
          const pair = r.pair ?? [r.flipped];
          setTimeout(() => {
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
    [busy, submitting, matched, faceUp, revealed, sendMove, onComplete],
  );

  const cols = tiles <= 12 ? 4 : 6;

  return (
    <div className="space-y-3">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: tiles }, (_, i) => {
          const isMatched = matched.has(i);
          const face = revealed[i];
          const shown = face !== undefined;
          return (
            <button
              key={i}
              disabled={busy || submitting || isMatched || shown}
              onClick={() => flip(i)}
              className={`flex aspect-square items-center justify-center rounded-lg border text-2xl font-bold transition-all ${
                isMatched
                  ? "border-border-gold/50 bg-accent/30 opacity-60"
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
      <div className="flex items-center justify-between text-xs tabular-nums text-text-muted">
        <span>
          {matched.size / 2} / {pairs} pairs matched
        </span>
        <span>{moves} flips</span>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

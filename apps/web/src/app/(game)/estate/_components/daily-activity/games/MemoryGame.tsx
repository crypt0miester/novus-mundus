"use client";

import { animate, stagger, waapi } from "animejs";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { playSfx } from "@/lib/audio/sfx";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import type { MoveResponse } from "@/lib/hooks/useDailyActivity";
import { BLOOM, DUR, PRESS, SETTLE, STAGGER } from "@/lib/motion/tokens";
import { prefersReducedMotion } from "@/lib/utils";
import { useWebGL2Ready } from "@/lib/webgl/useWebGL2Ready";
import { useFx } from "../GameStage";
import { GameHeader, GameTimer, ResultBadge, celebrate, tierFromMemoryMoves } from "./_shell";

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
// The 3D WebGL board (lazy — three.js stays out of the bundle until a memory
// game opens). Falls back to the DOM board below when WebGL2 is unavailable.
const MemoryGame3D = lazy(() => import("./MemoryGame3D"));

export function MemoryGame(props: MemoryGameProps) {
  if (useWebGL2Ready()) {
    return (
      <Suspense fallback={<MemoryGame2D {...props} />}>
        <MemoryGame3D {...props} />
      </Suspense>
    );
  }
  return <MemoryGame2D {...props} />;
}

function MemoryGame2D({ presentation, submitting, sendMove, onComplete }: MemoryGameProps) {
  const { tiles, pairs } = presentation;
  const fx = useFx();
  const [revealed, setRevealed] = useState<Record<number, number>>({});
  const [matched, setMatched] = useState<Set<number>>(() => new Set());
  const [faceUp, setFaceUp] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [pulseIdx, setPulseIdx] = useState<number[] | null>(null);
  const [mismatchIdx, setMismatchIdx] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ moves: number; pairs: number } | null>(null);

  // Motion refs. gridRef roots the deal-in scope; flipRefs hold each tile's
  // inner 3D flip element so flips are driven imperatively on the state edge
  // (not as a CSS transition that fights anime). summaryCardRef / summaryNumRef
  // feed the shared celebrate() slot-roll.
  const gridRef = useRef<HTMLDivElement>(null);
  const flipRefs = useRef<(HTMLDivElement | null)[]>([]);
  const summaryCardRef = useRef<HTMLDivElement>(null);
  const summaryNumRef = useRef<HTMLSpanElement>(null);
  // Edge state for the flip choreography: which tiles were face-up / recoiling /
  // pulsing on the previous render, so each one-shot fires on the transition.
  const prevShownRef = useRef<Set<number>>(new Set());
  const prevMismatchRef = useRef<Set<number>>(new Set());
  const prevPulseRef = useRef<Set<number>>(new Set());

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
  const cols = tiles <= 12 ? 4 : 6;

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
          playSfx("flip");
        } else if (r.outcome === "match") {
          setMatched((prev) => new Set([...prev, ...r.matched]));
          setFaceUp(null);
          // Brief pulse on the pair so the match registers visually.
          const pulsePair = r.pair ?? [r.flipped];
          setPulseIdx(pulsePair);
          trackedTimeout(() => setPulseIdx(null), 450);
          setBusy(false);
          // Juice: gold burst on each matched tile + a light shake.
          playSfx("match");
          for (const t of pulsePair) fx.burstEl(flipRefs.current[t]);
          fx.shake(0.8);
          if (done) {
            setSummary({ moves: r.moves, pairs });
            trackedTimeout(onComplete, SUMMARY_BEAT_MS);
            playSfx("win");
            fx.confetti();
          }
        } else {
          // Mismatch — both faces stay up through the flip-back, and the board
          // stays locked (busy) until they turn back down, so a fast tap can't
          // race the timeout that clears `faceUp`.
          playSfx("wrong");
          const pair = r.pair ?? [r.flipped];
          // Mark the pair so the tiles recoil (outElastic) while both faces are
          // up; cleared on the flip-back below.
          setMismatchIdx(pair);
          trackedTimeout(() => {
            setRevealed((prev) => {
              const next = { ...prev };
              for (const t of pair) delete next[t];
              return next;
            });
            setMismatchIdx(null);
            setFaceUp(null);
            setBusy(false);
          }, 900);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "move failed");
        setBusy(false);
      }
    },
    [busy, submitting, matched, faceUp, revealed, sendMove, onComplete, pairs, trackedTimeout, fx],
  );

  // Deal-in: tiles ripple out from the grid center, then a cheap waapi
  // scale/opacity breathe loops on the facedown faces. Both are entrance /
  // ambient and own the CSS resting state, so the default scope.revert() teardown
  // is correct. Under reduced motion the builder sets the final state and bails
  // before the breathe (an instant-but-looping breathe is wasted compositor work).
  useAnimeScope({ root: gridRef, deps: [tiles, cols] }, ({ reduce }) => {
    const cells = gridRef.current?.querySelectorAll<HTMLElement>("[data-tile]");
    if (!cells || cells.length === 0) return;
    if (reduce) {
      for (const el of cells) {
        el.style.opacity = "1";
        el.style.transform = "none";
      }
      return;
    }
    animate(cells, {
      opacity: [0, 1],
      scale: [0.6, 1],
      ease: SETTLE,
      delay: stagger(STAGGER.tight, { grid: [cols, Math.ceil(tiles / cols)], from: "center" }),
    });
    // Ambient idle breathe on facedown faces (transform + opacity only, so the
    // compositor carries it through busy main-thread work / submits).
    const faces = gridRef.current?.querySelectorAll<HTMLElement>("[data-facedown]");
    if (faces && faces.length > 0) {
      waapi.animate(faces, {
        scale: [1, 1.04],
        opacity: [0.85, 1],
        duration: 2200,
        ease: "inOutSine",
        loop: true,
        alternate: true,
        delay: stagger(90),
      });
    }
  });

  // Flip / match / mismatch choreography, edge-detected so each one-shot fires
  // on the transition (not every render / poll). rotateY swings the two-face
  // tile; match springs (BLOOM), mismatch recoils (outElastic). FLIP-style
  // settle-to-identity, so cancel rather than revert is implicit (these are
  // imperative animate() calls cleaned by overwrite on the next edge).
  useEffect(() => {
    if (prefersReducedMotion()) {
      // Snap each face to its resting rotation; no swing.
      for (let i = 0; i < tiles; i++) {
        const el = flipRefs.current[i];
        if (!el) continue;
        const up = matched.has(i) || revealed[i] !== undefined;
        el.style.transform = `rotateY(${up ? 180 : 0}deg)`;
      }
      return;
    }
    const shownNow = new Set<number>();
    for (let i = 0; i < tiles; i++) {
      if (matched.has(i) || revealed[i] !== undefined) shownNow.add(i);
    }
    // Flip edges: newly face-up -> 180, newly face-down -> 0.
    for (let i = 0; i < tiles; i++) {
      const el = flipRefs.current[i];
      if (!el) continue;
      const isUp = shownNow.has(i);
      const wasUp = prevShownRef.current.has(i);
      if (isUp !== wasUp) {
        animate(el, { rotateY: isUp ? 180 : 0, ease: PRESS, duration: DUR.fast });
      }
    }
    prevShownRef.current = shownNow;

    // Match pulse: spring the matched pair (scale punch).
    const pulseNow = new Set(pulseIdx ?? []);
    for (const i of pulseNow) {
      if (prevPulseRef.current.has(i)) continue;
      const el = flipRefs.current[i];
      if (el) animate(el, { scale: [1, 1.16, 1], ease: BLOOM });
    }
    prevPulseRef.current = pulseNow;

    // Mismatch recoil: outElastic shake on the rejected pair.
    const mismatchNow = new Set(mismatchIdx ?? []);
    for (const i of mismatchNow) {
      if (prevMismatchRef.current.has(i)) continue;
      const el = flipRefs.current[i];
      if (el)
        animate(el, { x: [0, -6, 5, -3, 0], ease: "outElastic(1, 0.45)", duration: DUR.base });
    }
    prevMismatchRef.current = mismatchNow;
  }, [tiles, matched, revealed, pulseIdx, mismatchIdx]);

  // Summary slot-roll via the shared celebration helper.
  useEffect(() => {
    if (!summary) return;
    const card = summaryCardRef.current;
    const number = summaryNumRef.current;
    if (!card || !number) return;
    return celebrate({
      card,
      number,
      score: summary.moves,
      format: (v) => `${v} flips`,
      onTick: () => {},
    });
  }, [summary]);

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
        ref={gridRef}
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
              type="button"
              data-tile
              disabled={busy || submitting || isMatched || shown || !!summary}
              onClick={() => flip(i)}
              className="relative aspect-square select-none rounded-lg text-2xl font-bold"
              // Start hidden so the deal-in ripple (which runs on mount) brings
              // each tile up; the scope sets opacity 1 on both the animated and
              // reduced-motion paths, so the board is never left invisible.
              style={{ perspective: "600px", opacity: 0 }}
            >
              {/* The flip body. rotateY is driven imperatively on the state edge;
                  preserve-3d keeps both faces in 3D space so the swing reads. */}
              <div
                ref={(el) => {
                  flipRefs.current[i] = el;
                }}
                className="absolute inset-0"
                style={{ transformStyle: "preserve-3d" }}
              >
                {/* Facedown face at rotateY(0). */}
                <div
                  data-facedown
                  className="absolute inset-0 flex items-center justify-center rounded-lg border border-border-default bg-surface-raised text-text-muted/50"
                  style={{ backfaceVisibility: "hidden" }}
                >
                  ◇
                </div>
                {/* Revealed face at rotateY(180). Gold-framed when matched. */}
                <div
                  className={`absolute inset-0 flex items-center justify-center rounded-lg border ${
                    isMatched
                      ? "border-border-gold/50 bg-accent/30"
                      : "border-border-gold bg-accent/20"
                  }`}
                  style={{
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                  }}
                >
                  {shown && (
                    <span className={SYMBOL_COLORS[face % SYMBOL_COLORS.length]}>
                      {SYMBOLS[face % SYMBOLS.length]}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {summary && summaryTier ? (
        <div ref={summaryCardRef} className="card accent-border text-center">
          <div className="text-xs uppercase tracking-wider text-text-muted">Ledger reconciled</div>
          <div className="mt-2 font-display text-3xl font-bold tabular-nums text-text-gold">
            <span ref={summaryNumRef} className="inline-block">
              0 flips
            </span>
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

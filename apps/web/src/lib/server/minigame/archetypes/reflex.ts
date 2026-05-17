import { clamp } from "../grade";
import type {
  Archetype,
  Difficulty,
  GeneratedPuzzle,
  RandomSource,
} from "../types";

/**
 * Reflex archetype — the timed Class C games (`DAILY_ACTIVITY_MINIGAMES.md` §5,
 * §13; the §15 design spike).
 *
 * Two modes:
 *  - **react** (Barracks "Morning Drill") — the server holds the round's GO
 *    response open for a secret, randomized delay; the player taps; the score
 *    is the reaction time.
 *  - **precision** (Forge "Fire the Furnace") — the server starts a sweep; the
 *    player releases when the marker is over the target band; the score is the
 *    distance from it.
 *
 * Everything timed is stamped on the *server* clock (see `reflex-session.ts`).
 * Network latency is estimated from the round-start→arm leg and subtracted,
 * capped — the client never reports a time. This file is the pure logic:
 * generation and grading; the timed move state machine lives in the route.
 */

export type ReflexMode = "react" | "precision";

/** Per-round parameters — `goDelayMs` is secret; the sweep is revealed at arm. */
export interface ReflexRound {
  /** react: the held delay before GO (ms). */
  goDelayMs?: number;
  /** precision: total sweep duration (ms). */
  sweepMs?: number;
  /** precision: the target band, as fractions of the sweep [0, 1]. */
  bandFrom?: number;
  bandTo?: number;
}

export interface ReflexPuzzle {
  mode: ReflexMode;
  rounds: number;
  perRound: ReflexRound[];
  /** react grading band (ms): reaction ≤ targetMs scores 1, ≥ floorMs scores 0. */
  targetMs: number;
  floorMs: number;
  /** precision grading: how far outside the band still scores, as a fraction. */
  tolerance: number;
}

export type ReflexPhase =
  | "idle"
  | "started"
  | "awaiting-tap"
  | "awaiting-release";

export interface ReflexProgress {
  mode: ReflexMode;
  rounds: number;
  /** 0-based index of the current round. */
  round: number;
  phase: ReflexPhase;
  token: string | null;
  /** Server stamps (ms epoch). */
  tStart: number;
  tGo: number;
  tSweepStart: number;
  /** One round-start→arm round-trip sample per round. */
  rttSamples: number[];
  /** Per completed round, the score fraction 0-1. */
  results: number[];
}

export interface ReflexPresentation {
  mode: ReflexMode;
  rounds: number;
  instruction: string;
}

/** Cap on the latency subtracted from a reaction — bounds RTT inflation (§15). */
export const REFLEX_RTT_CAP_MS = 400;

const REACT_DELAY_MIN_MS = 1500;
const REACT_DELAY_SPAN_MS = 3500; // 1500-5000ms

/** The latency to subtract: the smallest round-trip sample, capped. */
export function rttEstimate(samples: number[]): number {
  if (samples.length === 0) return 0;
  return Math.min(Math.min(...samples), REFLEX_RTT_CAP_MS);
}

/** react: a reaction time (ms) → score fraction 0-1. */
export function reactionFraction(
  reactionMs: number,
  targetMs: number,
  floorMs: number,
): number {
  if (floorMs <= targetMs) return reactionMs <= targetMs ? 1 : 0;
  return clamp((floorMs - reactionMs) / (floorMs - targetMs), 0, 1);
}

/** precision: the marker position vs the target band → score fraction 0-1. */
export function precisionFraction(
  markerPos: number,
  bandFrom: number,
  bandTo: number,
  tolerance: number,
): number {
  if (markerPos >= bandFrom && markerPos <= bandTo) return 1;
  const dist = markerPos < bandFrom ? bandFrom - markerPos : markerPos - bandTo;
  if (tolerance <= 0) return 0;
  return clamp(1 - dist / tolerance, 0, 1);
}

function generate(
  rng: RandomSource,
  difficulty: Difficulty,
  content?: unknown,
): GeneratedPuzzle {
  const mode: ReflexMode =
    (content as { mode?: ReflexMode } | undefined)?.mode ?? "react";
  const rounds = Math.max(1, difficulty.rounds ?? (mode === "react" ? 4 : 3));

  const perRound: ReflexRound[] = [];
  for (let i = 0; i < rounds; i += 1) {
    if (mode === "react") {
      perRound.push({
        goDelayMs: REACT_DELAY_MIN_MS + rng.nextInt(REACT_DELAY_SPAN_MS + 1),
      });
    } else {
      const sweepMs = 2000 + rng.nextInt(1001); // 2000-3000ms
      const centerPct = 42 + rng.nextInt(39); // 42-80%
      const halfPct = 7;
      perRound.push({
        sweepMs,
        bandFrom: (centerPct - halfPct) / 100,
        bandTo: (centerPct + halfPct) / 100,
      });
    }
  }

  const puzzle: ReflexPuzzle = {
    mode,
    rounds,
    perRound,
    targetMs: difficulty.targetMs ?? 280,
    floorMs: difficulty.floorMs ?? 620,
    tolerance: (difficulty.tolerancePct ?? 26) / 100,
  };
  const progress: ReflexProgress = {
    mode,
    rounds,
    round: 0,
    phase: "idle",
    token: null,
    tStart: 0,
    tGo: 0,
    tSweepStart: 0,
    rttSamples: [],
    results: [],
  };
  const presentation: ReflexPresentation = {
    mode,
    rounds,
    instruction:
      mode === "react"
        ? "Hold steady — then strike the instant the signal flares."
        : "Release at the optimal heat — when the marker is inside the glowing band.",
  };
  return { puzzle, progress, presentation };
}

/** Grade from accumulated progress — the mean of the per-round fractions. */
function grade(_puzzle: unknown, progress: unknown, _answer: unknown): number {
  const { results } = progress as ReflexProgress;
  if (results.length === 0) return 0;
  return results.reduce((sum, r) => sum + r, 0) / results.length;
}

export const reflexArchetype: Archetype = {
  name: "reflex",
  multiMove: true,
  generate,
  grade,
};

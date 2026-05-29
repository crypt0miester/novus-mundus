/**
 * The grade curve — the single web-side tuning lever for daily-activity rewards
 * (`DAILY_ACTIVITY_MINIGAMES.md` §7). It maps an archetype's raw success
 * fraction (0-1) to a final on-chain score (0-100).
 *
 * The curve is deliberately generous: an exponent below 1 lifts the whole range
 * above the diagonal, so an *attentive* player (fraction ~0.8+) scores ~90-100
 * and only careless or blind play falls toward the floor. There is no dead zone
 * — fraction 0 still maps to 0 — so idlers and bots earn the floor by design.
 *
 * Pure functions, no secrets — safe to unit test and to reuse for the
 * expedition `strike` score later.
 */

import type { ArchetypeName } from "./types";

/** Tuning knob: lower = more generous. Re-tune from real data in Phase 5. */
const GRADE_CURVE_EXPONENT = 0.65;

/** Clamp `x` into `[lo, hi]`; NaN folds to `lo`. */
export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** Map a raw success fraction (0-1) through the curve to a shaped fraction (0-1). */
export function gradeCurve(fraction: number): number {
  return clamp01(fraction) ** GRADE_CURVE_EXPONENT;
}

/** Map a raw success fraction (0-1) to a final on-chain score (integer 0-100). */
export function finalScore(fraction: number): number {
  return clamp(Math.round(gradeCurve(fraction) * 100), 0, 100);
}

/**
 * Validate a single-submit `answer` against the archetype's expected shape
 * BEFORE grading, so a malformed or out-of-range answer is rejected with a
 * clean error instead of being silently coerced to `[]` and scored zero. The
 * server-held `puzzle` (and client-safe `presentation`) define the exact shape:
 * the pick count and the valid option-index range per archetype.
 *
 * Returns `null` when the answer is valid, or a human-readable reason when not.
 * Multi-move archetypes (reflex, memory) carry no single-submit answer and are
 * not validated here.
 */
export function validateAnswer(
  archetype: ArchetypeName,
  puzzle: unknown,
  presentation: unknown,
  answer: unknown,
): string | null {
  if (!Array.isArray(answer)) {
    return "answer must be an array";
  }

  switch (archetype) {
    case "mcq": {
      const questions = (puzzle as { questions?: { options?: unknown[] }[] }).questions ?? [];
      if (answer.length !== questions.length) {
        return `answer must have ${questions.length} entries`;
      }
      for (let i = 0; i < questions.length; i += 1) {
        const optionCount = questions[i]?.options?.length ?? 0;
        if (!isIndexInRange(answer[i], optionCount)) {
          return `answer[${i}] must be an option index in [0, ${optionCount})`;
        }
      }
      return null;
    }

    case "set-select": {
      const real = (puzzle as { real?: unknown[] }).real ?? [];
      if (answer.length !== real.length) {
        return `answer must have ${real.length} entries`;
      }
      for (let i = 0; i < answer.length; i += 1) {
        if (typeof answer[i] !== "boolean") {
          return `answer[${i}] must be a boolean`;
        }
      }
      return null;
    }

    case "assignment": {
      const correctBin = (puzzle as { correctBin?: unknown[] }).correctBin ?? [];
      // The puzzle stores only the correct bins; the bin count lives in the
      // client-safe presentation, which defines the valid pick range exactly.
      const binCount = (presentation as { bins?: unknown[] }).bins?.length ?? 0;
      if (answer.length !== correctBin.length) {
        return `answer must have ${correctBin.length} entries`;
      }
      for (let i = 0; i < answer.length; i += 1) {
        if (!isIndexInRange(answer[i], binCount)) {
          return `answer[${i}] must be a bin index in [0, ${binCount})`;
        }
      }
      return null;
    }

    case "ordering": {
      const items = (puzzle as { items?: unknown[] }).items ?? [];
      if (answer.length !== items.length) {
        return `answer must have ${items.length} entries`;
      }
      // A valid answer is a permutation of the item indices [0, items.length).
      const seen = new Set<number>();
      for (let i = 0; i < answer.length; i += 1) {
        if (!isIndexInRange(answer[i], items.length)) {
          return `answer[${i}] must be an item index in [0, ${items.length})`;
        }
        const idx = answer[i] as number;
        if (seen.has(idx)) {
          return "answer must be a permutation without repeats";
        }
        seen.add(idx);
      }
      return null;
    }

    default:
      // Multi-move archetypes are graded from server progress, not an answer.
      return null;
  }
}

/** True when `v` is an integer in `[0, count)`. */
function isIndexInRange(v: unknown, count: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < count;
}

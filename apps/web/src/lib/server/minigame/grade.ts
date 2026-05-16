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
  return Math.pow(clamp01(fraction), GRADE_CURVE_EXPONENT);
}

/** Map a raw success fraction (0-1) to a final on-chain score (integer 0-100). */
export function finalScore(fraction: number): number {
  return clamp(Math.round(gradeCurve(fraction) * 100), 0, 100);
}

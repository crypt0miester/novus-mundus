/**
 * Small grading/generation helpers shared by the archetype modules. Kept apart
 * from `index.ts` so an archetype can import them without pulling in the
 * `ARCHETYPES` registry (which imports every archetype — a cycle otherwise).
 */

/**
 * Overlay per-building `content` (round-tripped through Redis JSON, hence
 * `unknown`) onto an archetype's defaults — missing keys fall back.
 */
export function mergeContent<T>(defaults: T, content: unknown): T {
  return { ...defaults, ...(content as Partial<T> | undefined) };
}

/** Coerce a single-submit `answer` to an array, or an empty one when malformed. */
export function asAnswerArray(answer: unknown): unknown[] {
  return Array.isArray(answer) ? (answer as unknown[]) : [];
}

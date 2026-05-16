import type { TimeWindow } from "novus-mundus-sdk";

/**
 * Core types for the estate daily-activity mini-game framework.
 *
 * See `DAILY_ACTIVITY_MINIGAMES.md`. A mini-game is a *puzzle* (generated
 * deterministically from a server-seeded RNG, answer key included) plus a
 * client-safe *presentation* (the key removed). Skill puzzles fall into six
 * reusable *archetypes* (see `archetypes/`), single-submit or multi-move.
 *
 * Pure types only — no `server-only` import, so the archetype logic stays unit
 * testable.
 */

/** The six puzzle archetypes. */
export type ArchetypeName =
  | "mcq"
  | "set-select"
  | "assignment"
  | "ordering"
  | "memory"
  | "reflex";

/** Per-building difficulty knobs — archetype-specific, read with defaults. */
export type Difficulty = Record<string, number>;

/**
 * The randomness an archetype generator needs. The server's seeded `Rng`
 * satisfies this structurally; a test can pass a deterministic fake.
 */
export interface RandomSource {
  /** Integer in [0, n). */
  nextInt(n: number): number;
  /** `count` distinct entries from `pool`, order randomised. */
  sampleDistinct<T>(pool: T[], count: number): T[];
}

/** What an archetype's `generate` produces. */
export interface GeneratedPuzzle {
  /** Full server-side puzzle, answer key included. Stored in the session. */
  puzzle: unknown;
  /** Initial per-move progress (single-submit archetypes: an empty object). */
  progress: unknown;
  /** Client-safe view — never contains the answer key. */
  presentation: unknown;
}

/** The result of applying one move to a multi-move archetype. */
export type MoveOutcome =
  | { ok: true; progress: unknown; result: unknown; done: boolean }
  | { ok: false; error: string };

/**
 * A reusable puzzle archetype. Implementations cast `unknown` puzzle/progress
 * to their own shapes at the boundary — the values are server-generated and
 * round-tripped through Redis JSON, so the registry stays untyped on purpose.
 */
export interface Archetype {
  readonly name: ArchetypeName;
  /** True when driven move-by-move via `/move`; false for single-submit. */
  readonly multiMove: boolean;
  /**
   * Deterministically build a puzzle from a seeded RNG, per-building
   * difficulty, and optional per-building content (flavor labels, or a
   * question bank). Archetypes that need no content ignore the third argument.
   */
  generate(
    rng: RandomSource,
    difficulty: Difficulty,
    content?: unknown,
  ): GeneratedPuzzle;
  /** Apply one move (multi-move archetypes only). */
  applyMove?(puzzle: unknown, progress: unknown, move: unknown): MoveOutcome;
  /**
   * Grade to a fraction in [0, 1]. Single-submit archetypes read `answer`;
   * multi-move archetypes read accumulated `progress`.
   */
  grade(puzzle: unknown, progress: unknown, answer: unknown): number;
}

/** A live mini-game session, stored as JSON at `mg:session:{id}` in Redis. */
export interface MinigameSession {
  /** 128-bit unguessable hex token; also the Redis key suffix. */
  id: string;
  /** Base58 wallet the session is bound to. */
  owner: string;
  /** `BuildingType` id. */
  building: number;
  archetype: ArchetypeName;
  /** The window the puzzle was seeded for; co-sign rejects a stale window. */
  window: TimeWindow;
  /** The effective estate `dailyDate` at start. */
  day: number;
  /** Full server-side puzzle (answer key included) — never sent to the client. */
  puzzle: unknown;
  /** Per-move progress. */
  progress: unknown;
  /** Client-safe presentation, kept so `/start` can resume without re-deriving. */
  presentation: unknown;
  /** Final score 0-100 once known (multi-move: on completion); else null. */
  score: number | null;
  status: "active" | "finished";
  /** ms epoch. */
  createdAt: number;
  /** ms epoch — moves and co-sign past this are rejected. */
  deadline: number;
}

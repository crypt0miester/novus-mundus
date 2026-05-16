import type {
  Archetype,
  Difficulty,
  GeneratedPuzzle,
  MoveOutcome,
  RandomSource,
} from "../types";

/**
 * Memory archetype — the server holds a board of `P` symbol pairs; the client
 * flips tiles one move at a time and the server reveals each face. The client
 * never receives the board, so "keeping a tile visible" buys nothing — the
 * score is server-counted move efficiency.
 *
 * Phase 1 reference building: **Treasury** — "Ledger Audit". It exists to prove
 * the multi-move `/move` loop and the once-per-window idempotency.
 *
 * Grade: a perfect-memory player clears the board having flipped each tile
 * exactly once (`2P` flips). `fraction = 2P / max(flips, 2P)` — flipping each
 * tile once scores 1.0; twice as many flips scores 0.5.
 */

/** Server-side board: `faces[tile]` is a symbol id; each id appears twice. */
interface MemoryPuzzle {
  faces: number[];
}
interface MemoryProgress {
  /** Total flips so far (one per `/move`). */
  moves: number;
  /** Tile indices locked in matched pairs. */
  matched: number[];
  /** The lone unmatched tile currently face-up awaiting its partner, or null. */
  faceUp: number | null;
}
/** Client-safe view — just the board size. */
interface MemoryPresentation {
  tiles: number;
  pairs: number;
}

function generate(rng: RandomSource, difficulty: Difficulty): GeneratedPuzzle {
  const pairs = Math.max(2, difficulty.pairs ?? 6);
  const deck: number[] = [];
  for (let s = 0; s < pairs; s += 1) deck.push(s, s);
  const faces = rng.sampleDistinct(deck, deck.length);

  const puzzle: MemoryPuzzle = { faces };
  const progress: MemoryProgress = { moves: 0, matched: [], faceUp: null };
  const presentation: MemoryPresentation = { tiles: pairs * 2, pairs };
  return { puzzle, progress, presentation };
}

/** `move` is `{ flip: tileIndex }`. */
function applyMove(puzzle: unknown, progress: unknown, move: unknown): MoveOutcome {
  const { faces } = puzzle as MemoryPuzzle;
  const g = progress as MemoryProgress;

  const flip =
    move && typeof move === "object"
      ? (move as { flip?: unknown }).flip
      : undefined;
  if (
    typeof flip !== "number" ||
    !Number.isInteger(flip) ||
    flip < 0 ||
    flip >= faces.length
  ) {
    return { ok: false, error: "'move.flip' must be a valid tile index" };
  }
  if (g.matched.includes(flip)) {
    return { ok: false, error: "that tile is already matched" };
  }
  if (flip === g.faceUp) {
    return { ok: false, error: "that tile is already face up" };
  }

  const moves = g.moves + 1;
  const face = faces[flip]!;

  // No tile face-up yet — this flip just reveals one and waits for its partner.
  if (g.faceUp == null) {
    const next: MemoryProgress = { moves, matched: g.matched, faceUp: flip };
    return {
      ok: true,
      progress: next,
      done: false,
      result: { flipped: flip, face, outcome: "first", matched: g.matched, moves },
    };
  }

  // A tile is already up — this flip is the comparison.
  const other = g.faceUp;
  if (faces[flip]! === faces[other]!) {
    const matched = [...g.matched, other, flip];
    const next: MemoryProgress = { moves, matched, faceUp: null };
    return {
      ok: true,
      progress: next,
      done: matched.length === faces.length,
      result: {
        flipped: flip,
        face,
        outcome: "match",
        pair: [other, flip],
        matched,
        moves,
      },
    };
  }

  // Mismatch — both tiles flip back down (the client animates `pair`).
  const next: MemoryProgress = { moves, matched: g.matched, faceUp: null };
  return {
    ok: true,
    progress: next,
    done: false,
    result: {
      flipped: flip,
      face,
      outcome: "mismatch",
      pair: [other, flip],
      matched: g.matched,
      moves,
    },
  };
}

/** Grade from accumulated progress — efficiency vs the `2P`-flip optimum. */
function grade(puzzle: unknown, progress: unknown, _answer: unknown): number {
  const { faces } = puzzle as MemoryPuzzle;
  const { moves } = progress as MemoryProgress;
  const optimal = faces.length; // 2P — every tile flipped exactly once
  if (moves <= 0) return 0;
  return optimal / Math.max(moves, optimal);
}

export const memoryArchetype: Archetype = {
  name: "memory",
  multiMove: true,
  generate,
  applyMove,
  grade,
};

import type {
  Archetype,
  Difficulty,
  GeneratedPuzzle,
  RandomSource,
} from "../types";
import { asAnswerArray, mergeContent } from "./helpers";

/**
 * Ordering archetype — `M` items, each carrying a metric; the player arranges
 * them in order. Single-submit; graded on the fraction of correct adjacent
 * pairs, so a near-right order still scores well.
 *
 * Reused across Arena, DungeonEntry and TransportBay with per-building flavor.
 */

interface OrderingContent {
  instruction: string;
  metricLabel: string;
  names: string[];
  /** true = ascending order is correct; false = descending. */
  ascending: boolean;
}

interface OrderingItem {
  label: string;
  metric: number;
}
interface OrderingPuzzle {
  items: OrderingItem[];
  ascending: boolean;
}
interface OrderingPresentation {
  instruction: string;
  metricLabel: string;
  items: OrderingItem[];
}

const DEFAULT_CONTENT: OrderingContent = {
  instruction: "Arrange the items from lowest to highest.",
  metricLabel: "Value",
  names: ["Item"],
  ascending: true,
};

function generate(
  rng: RandomSource,
  difficulty: Difficulty,
  content?: unknown,
): GeneratedPuzzle {
  const c = mergeContent(DEFAULT_CONTENT, content);
  const count = Math.max(3, difficulty.items ?? 5);

  // Distinct metrics so the correct order is unambiguous.
  const pool: number[] = [];
  for (let n = 1; n <= 99; n += 1) pool.push(n);
  const metrics = rng.sampleDistinct(pool, count);
  const names = rng.sampleDistinct(c.names, c.names.length);

  const items: OrderingItem[] = metrics.map((metric, i) => ({
    label: names[i % names.length] ?? `Item ${i + 1}`,
    metric,
  }));

  const presentation: OrderingPresentation = {
    instruction: c.instruction,
    metricLabel: c.metricLabel,
    items,
  };
  return {
    puzzle: { items, ascending: c.ascending } satisfies OrderingPuzzle,
    progress: {},
    presentation,
  };
}

/** `answer` is the player's ordering of item indices; grade = correct pairs. */
function grade(puzzle: unknown, _progress: unknown, answer: unknown): number {
  const { items, ascending } = puzzle as OrderingPuzzle;
  if (items.length < 2) return 1;
  const order = asAnswerArray(answer);
  if (order.length !== items.length) return 0;

  let correctPairs = 0;
  for (let j = 0; j < items.length - 1; j += 1) {
    const x = items[order[j] as number]?.metric;
    const y = items[order[j + 1] as number]?.metric;
    if (x === undefined || y === undefined) continue;
    if (ascending ? x <= y : x >= y) correctPairs += 1;
  }
  return correctPairs / (items.length - 1);
}

export const orderingArchetype: Archetype = {
  name: "ordering",
  multiMove: false,
  generate,
  grade,
};

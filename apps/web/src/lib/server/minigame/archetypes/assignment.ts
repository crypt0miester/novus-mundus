import type {
  Archetype,
  Difficulty,
  GeneratedPuzzle,
  RandomSource,
} from "../types";
import { asAnswerArray, mergeContent } from "./helpers";

/**
 * Assignment archetype — `M` items, each carrying a value; the player bins each
 * into one of `C` ranges. Single-submit; graded on the fraction binned right.
 *
 * Reused across Workshop, Camp and Farm with per-building flavor (the value and
 * the bin names are relabeled via `content`).
 */

interface AssignmentContent {
  instruction: string;
  valueLabel: string;
  /** Bin labels, low range first. */
  bins: string[];
  names: string[];
}

interface AssignmentItem {
  label: string;
  value: number;
}
interface AssignmentBin {
  label: string;
  from: number;
  to: number;
}
interface AssignmentPuzzle {
  items: AssignmentItem[];
  /** The correct bin index for each item. */
  correctBin: number[];
}
interface AssignmentPresentation {
  instruction: string;
  valueLabel: string;
  bins: AssignmentBin[];
  items: AssignmentItem[];
}

const DEFAULT_CONTENT: AssignmentContent = {
  instruction: "Sort each item into the right bin by its reading.",
  valueLabel: "Reading",
  bins: ["Low", "Mid", "High"],
  names: ["Item"],
};

function generate(
  rng: RandomSource,
  difficulty: Difficulty,
  content?: unknown,
): GeneratedPuzzle {
  const c = mergeContent(DEFAULT_CONTENT, content);
  const binCount = Math.max(
    2,
    Math.min(c.bins.length, difficulty.bins ?? c.bins.length),
  );
  const count = Math.max(3, difficulty.items ?? 6);
  const span = Math.floor(100 / binCount);

  const bins: AssignmentBin[] = c.bins.slice(0, binCount).map((label, i) => ({
    label,
    from: i * span,
    to: i === binCount - 1 ? 99 : (i + 1) * span - 1,
  }));

  const names = rng.sampleDistinct(c.names, c.names.length);
  const items: AssignmentItem[] = [];
  const correctBin: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const value = rng.nextInt(100);
    items.push({ label: names[i % names.length] ?? `Item ${i + 1}`, value });
    correctBin.push(Math.min(binCount - 1, Math.floor(value / span)));
  }

  const presentation: AssignmentPresentation = {
    instruction: c.instruction,
    valueLabel: c.valueLabel,
    bins,
    items,
  };
  return {
    puzzle: { items, correctBin } satisfies AssignmentPuzzle,
    progress: {},
    presentation,
  };
}

/** `answer` is the chosen bin per item; grade = fraction binned correctly. */
function grade(puzzle: unknown, _progress: unknown, answer: unknown): number {
  const { correctBin } = puzzle as AssignmentPuzzle;
  if (correctBin.length === 0) return 0;
  const picks = asAnswerArray(answer);
  let correct = 0;
  correctBin.forEach((bin, i) => {
    if (picks[i] === bin) correct += 1;
  });
  return correct / correctBin.length;
}

export const assignmentArchetype: Archetype = {
  name: "assignment",
  multiMove: false,
  generate,
  grade,
};

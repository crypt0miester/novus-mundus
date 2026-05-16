import type {
  Archetype,
  Difficulty,
  GeneratedPuzzle,
  RandomSource,
} from "../types";
import { asAnswerArray, mergeContent } from "./helpers";

/**
 * SetSelect archetype — `M` items, each carrying two numbers; the player picks
 * the items where the derivable rule holds (`a < b`). Single-submit; graded
 * `(correct − wrong) / K`, clamped at zero.
 *
 * Reused across Dock, Vault, Market and Mine with per-building flavor (the two
 * numbers and the item nouns are relabeled via `content`).
 */

interface SetSelectContent {
  instruction: string;
  aLabel: string;
  bLabel: string;
  names: string[];
}

interface SetSelectItem {
  label: string;
  a: number;
  b: number;
}
interface SetSelectPuzzle {
  items: SetSelectItem[];
  /** Per item: is it genuine (`a < b`) and should be selected. */
  real: boolean[];
}
interface SetSelectPresentation {
  instruction: string;
  aLabel: string;
  bLabel: string;
  items: SetSelectItem[];
}

const DEFAULT_CONTENT: SetSelectContent = {
  instruction: "Select the genuine items — skip the rest.",
  aLabel: "A",
  bLabel: "B",
  names: ["Item"],
};

function generate(
  rng: RandomSource,
  difficulty: Difficulty,
  content?: unknown,
): GeneratedPuzzle {
  const c = mergeContent(DEFAULT_CONTENT, content);
  const count = Math.max(3, difficulty.items ?? 6);
  const names = rng.sampleDistinct(c.names, c.names.length);

  const items: SetSelectItem[] = [];
  const real: boolean[] = [];
  for (let i = 0; i < count; i += 1) {
    const isReal = rng.nextInt(2) === 0;
    const a = 10 + rng.nextInt(70);
    const b = isReal
      ? a + 1 + rng.nextInt(90 - a) // b > a — genuine
      : Math.max(1, a - rng.nextInt(a)); // b <= a — a trap
    items.push({ label: names[i % names.length] ?? `Item ${i + 1}`, a, b });
    real.push(isReal);
  }
  // Guarantee at least one genuine item (a sane grade denominator) and one trap.
  if (!real.includes(true)) {
    real[0] = true;
    items[0]!.b = items[0]!.a + 5;
  }
  if (!real.includes(false)) {
    real[count - 1] = false;
    items[count - 1]!.b = Math.max(1, items[count - 1]!.a - 5);
  }

  const presentation: SetSelectPresentation = {
    instruction: c.instruction,
    aLabel: c.aLabel,
    bLabel: c.bLabel,
    items,
  };
  return { puzzle: { items, real } satisfies SetSelectPuzzle, progress: {}, presentation };
}

/** `answer` is a per-item boolean (selected); grade = (correct − wrong)/K, ≥0. */
function grade(puzzle: unknown, _progress: unknown, answer: unknown): number {
  const { real } = puzzle as SetSelectPuzzle;
  const picks = asAnswerArray(answer);
  const k = real.filter(Boolean).length;
  if (k === 0) return 0;

  let correct = 0;
  let wrong = 0;
  real.forEach((isReal, i) => {
    if (picks[i] === true) {
      if (isReal) correct += 1;
      else wrong += 1;
    }
  });
  return Math.max(0, (correct - wrong) / k);
}

export const setSelectArchetype: Archetype = {
  name: "set-select",
  multiMove: false,
  generate,
  grade,
};

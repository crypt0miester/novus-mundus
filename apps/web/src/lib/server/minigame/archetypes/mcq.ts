import type {
  Archetype,
  Difficulty,
  GeneratedPuzzle,
  RandomSource,
} from "../types";
import { asAnswerArray } from "./helpers";

/**
 * MCQ archetype — `N` questions, `K` options, one correct; single-submit;
 * graded on the fraction correct.
 *
 * Two content modes:
 *  - a question **bank** passed in `content` (Academy's lore quiz, Infirmary's
 *    triage) — `N` questions are sampled and each question's options shuffled;
 *  - **procedural** when `content` is absent — Observatory's "Star Reading":
 *    count the bright (★) stars in a generated constellation.
 */

interface McqQuestion {
  prompt: string;
  /** Optional glyph block rendered above the prompt (procedural archetypes). */
  display?: string;
  options: string[];
  correctIndex: number;
}
interface McqPuzzle {
  questions: McqQuestion[];
}
interface McqBank {
  questions: McqQuestion[];
}
interface McqPresentation {
  questions: { prompt: string; display?: string; options: string[] }[];
}

const CONSTELLATIONS = [
  "the Hunter",
  "the Serpent",
  "the Ferryman",
  "the Twins",
  "the Crown",
  "the Wolf",
  "the Loom",
  "the Anvil",
  "the Heron",
  "the Mariner",
];
const BRIGHT = "★";
const DIM = "☆";

/** Sample `n` questions from a bank, shuffling each one's options. */
function sampleFromBank(
  rng: RandomSource,
  pool: McqQuestion[],
  n: number,
): McqQuestion[] {
  return rng.sampleDistinct(pool, Math.min(n, pool.length)).map((q) => {
    const order = rng.sampleDistinct(
      q.options.map((_, i) => i),
      q.options.length,
    );
    return {
      prompt: q.prompt,
      display: q.display,
      options: order.map((i) => q.options[i] ?? ""),
      correctIndex: Math.max(0, order.indexOf(q.correctIndex)),
    };
  });
}

/** Generate `n` "count the bright stars" questions. */
function proceduralStars(
  rng: RandomSource,
  difficulty: Difficulty,
  n: number,
): McqQuestion[] {
  const nOptions = Math.max(2, difficulty.options ?? 4);
  const minStars = Math.max(2, difficulty.minStars ?? 3);
  const maxStars = Math.max(minStars, difficulty.maxStars ?? 9);
  const names = rng.sampleDistinct(CONSTELLATIONS, n);
  const questions: McqQuestion[] = [];

  for (let q = 0; q < n; q += 1) {
    const total = minStars + rng.nextInt(maxStars - minStars + 1);
    const bright = 1 + rng.nextInt(total - 1);

    const glyphs: string[] = [];
    for (let i = 0; i < total; i += 1) glyphs.push(i < bright ? BRIGHT : DIM);
    const display = rng.sampleDistinct(glyphs, glyphs.length).join(" ");

    const pool: number[] = [];
    for (let v = 0; v <= total; v += 1) if (v !== bright) pool.push(v);
    const distractors = rng.sampleDistinct(pool, Math.min(nOptions - 1, pool.length));
    const values = rng.sampleDistinct([bright, ...distractors], 1 + distractors.length);

    questions.push({
      prompt: `${names[q] ?? "the constellation"} — how many bright stars (${BRIGHT})?`,
      display,
      options: values.map(String),
      correctIndex: values.indexOf(bright),
    });
  }
  return questions;
}

function generate(
  rng: RandomSource,
  difficulty: Difficulty,
  content?: unknown,
): GeneratedPuzzle {
  const n = Math.max(1, difficulty.questions ?? 5);
  const bank = content as McqBank | undefined;
  const questions =
    bank?.questions && bank.questions.length > 0
      ? sampleFromBank(rng, bank.questions, n)
      : proceduralStars(rng, difficulty, n);

  const presentation: McqPresentation = {
    questions: questions.map(({ prompt, display, options }) => ({
      prompt,
      display,
      options,
    })),
  };
  return { puzzle: { questions } satisfies McqPuzzle, progress: {}, presentation };
}

/** `answer` is the selected option index per question; grade = fraction correct. */
function grade(puzzle: unknown, _progress: unknown, answer: unknown): number {
  const { questions } = puzzle as McqPuzzle;
  if (questions.length === 0) return 0;
  const picks = asAnswerArray(answer);
  let correct = 0;
  questions.forEach((q, i) => {
    if (picks[i] === q.correctIndex) correct += 1;
  });
  return correct / questions.length;
}

export const mcqArchetype: Archetype = {
  name: "mcq",
  multiMove: false,
  generate,
  grade,
};

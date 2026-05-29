/**
 * Mini-game archetype unit tests — the pure puzzle logic (generate, grade,
 * applyMove). Runs under `bun test`; no Redis, no server secrets.
 */

import { describe, it, expect } from "bun:test";
import { mcqArchetype } from "./mcq";
import { memoryArchetype } from "./memory";
import { setSelectArchetype } from "./set-select";
import { assignmentArchetype } from "./assignment";
import { orderingArchetype } from "./ordering";
import { FakeRng } from "./__test__/fake-rng";
import { finalScore, gradeCurve } from "../grade";

interface McqQuestion {
  prompt: string;
  display: string;
  options: string[];
  correctIndex: number;
}

describe("mcq archetype", () => {
  const difficulty = { questions: 5, options: 4, minStars: 3, maxStars: 9 };

  it("generates N questions with K options and a correct key", () => {
    const { puzzle, presentation } = mcqArchetype.generate(new FakeRng(7), difficulty);
    const questions = (puzzle as { questions: McqQuestion[] }).questions;
    expect(questions).toHaveLength(5);
    for (const q of questions) {
      expect(q.options).toHaveLength(4);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(q.options.length);
      // The keyed option is the count of bright stars actually shown.
      const brightShown = q.display.split(" ").filter((g) => g === "★").length;
      expect(Number(q.options[q.correctIndex])).toBe(brightShown);
    }
    // The presentation never carries the answer key.
    const presented = (presentation as { questions: unknown[] }).questions[0]!;
    expect(presented).not.toHaveProperty("correctIndex");
  });

  it("is seed-deterministic — same seed yields the same puzzle", () => {
    const a = mcqArchetype.generate(new FakeRng(42), difficulty).puzzle;
    const b = mcqArchetype.generate(new FakeRng(42), difficulty).puzzle;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("grades the fraction correct", () => {
    const { puzzle } = mcqArchetype.generate(new FakeRng(3), difficulty);
    const questions = (puzzle as { questions: McqQuestion[] }).questions;
    const allRight = questions.map((q) => q.correctIndex);
    const allWrong = questions.map((q) => (q.correctIndex === 0 ? 1 : 0));
    const half = questions.map((q, i) => (i < 2 ? q.correctIndex : -1));

    expect(mcqArchetype.grade(puzzle, {}, allRight)).toBe(1);
    expect(mcqArchetype.grade(puzzle, {}, allWrong)).toBe(0);
    expect(mcqArchetype.grade(puzzle, {}, half)).toBeCloseTo(2 / 5);
    expect(mcqArchetype.grade(puzzle, {}, [])).toBe(0);
    expect(mcqArchetype.grade(puzzle, {}, "not-an-array")).toBe(0);
  });
});

interface MemoryPuzzle {
  faces: number[];
}
interface MemoryProgress {
  moves: number;
  matched: number[];
  faceUp: number | null;
}

describe("memory archetype", () => {
  it("generates a shuffled board of P symbol pairs", () => {
    const { puzzle, progress, presentation } = memoryArchetype.generate(new FakeRng(9), {
      pairs: 6,
    });
    const faces = (puzzle as MemoryPuzzle).faces;
    expect(faces).toHaveLength(12);
    for (let s = 0; s < 6; s += 1) {
      expect(faces.filter((f) => f === s)).toHaveLength(2);
    }
    expect(progress).toEqual({ moves: 0, matched: [], faceUp: null });
    expect(presentation).toEqual({ tiles: 12, pairs: 6 });
  });

  it("rejects invalid flips", () => {
    const { puzzle, progress } = memoryArchetype.generate(new FakeRng(1), { pairs: 6 });
    expect(memoryArchetype.applyMove!(puzzle, progress, { flip: -1 }).ok).toBe(false);
    expect(memoryArchetype.applyMove!(puzzle, progress, { flip: 99 }).ok).toBe(false);
    expect(memoryArchetype.applyMove!(puzzle, progress, {}).ok).toBe(false);
  });

  it("reveals, matches, and mismatches; clears the board in 2P moves", () => {
    const gen = memoryArchetype.generate(new FakeRng(5), { pairs: 6 });
    const puzzle = gen.puzzle;
    const faces = (puzzle as MemoryPuzzle).faces;

    // The two tile indices for each symbol.
    const seen = new Map<number, number>();
    const pairs: [number, number][] = [];
    faces.forEach((f, i) => {
      const first = seen.get(f);
      if (first === undefined) seen.set(f, i);
      else pairs.push([first, i]);
    });

    let progress: unknown = gen.progress;
    let done = false;
    for (const [a, b] of pairs) {
      const first = memoryArchetype.applyMove!(puzzle, progress, { flip: a });
      if (!first.ok) throw new Error(first.error);
      expect((first.result as { outcome: string }).outcome).toBe("first");
      progress = first.progress;

      const second = memoryArchetype.applyMove!(puzzle, progress, { flip: b });
      if (!second.ok) throw new Error(second.error);
      expect((second.result as { outcome: string }).outcome).toBe("match");
      progress = second.progress;
      done = second.done;
    }

    expect(done).toBe(true);
    expect((progress as MemoryProgress).moves).toBe(12);
    expect((progress as MemoryProgress).matched).toHaveLength(12);
    expect(memoryArchetype.grade(puzzle, progress, undefined)).toBe(1);
  });

  it("reports a mismatch without locking the tiles", () => {
    const gen = memoryArchetype.generate(new FakeRng(11), { pairs: 6 });
    const faces = (gen.puzzle as MemoryPuzzle).faces;
    const i = 0;
    const j = faces.findIndex((f) => f !== faces[0]);

    const first = memoryArchetype.applyMove!(gen.puzzle, gen.progress, { flip: i });
    if (!first.ok) throw new Error(first.error);
    const second = memoryArchetype.applyMove!(gen.puzzle, first.progress, { flip: j });
    if (!second.ok) throw new Error(second.error);

    expect((second.result as { outcome: string }).outcome).toBe("mismatch");
    expect((second.progress as MemoryProgress).matched).toHaveLength(0);
    expect((second.progress as MemoryProgress).faceUp).toBeNull();
  });

  it("grades move efficiency against the 2P optimum", () => {
    const faces = [0, 0, 1, 1, 2, 2]; // P = 3, optimum 6 flips
    expect(
      memoryArchetype.grade({ faces }, { moves: 6, matched: [], faceUp: null }, undefined),
    ).toBe(1);
    expect(
      memoryArchetype.grade({ faces }, { moves: 12, matched: [], faceUp: null }, undefined),
    ).toBe(0.5);
    expect(
      memoryArchetype.grade({ faces }, { moves: 0, matched: [], faceUp: null }, undefined),
    ).toBe(0);
  });
});

describe("grade curve", () => {
  it("maps the endpoints exactly", () => {
    expect(finalScore(0)).toBe(0);
    expect(finalScore(1)).toBe(100);
  });

  it("is generous in the mid-to-upper range and monotonic", () => {
    expect(finalScore(0.5)).toBeGreaterThan(50); // above the diagonal
    expect(finalScore(0.8)).toBeGreaterThanOrEqual(85);
    expect(gradeCurve(0.7)).toBeGreaterThan(gradeCurve(0.5));
    expect(gradeCurve(1)).toBeGreaterThan(gradeCurve(0.9));
  });

  it("clamps out-of-range fractions", () => {
    expect(finalScore(-1)).toBe(0);
    expect(finalScore(2)).toBe(100);
  });
});

describe("mcq archetype — content bank", () => {
  const bank = {
    questions: [
      { prompt: "Q1", options: ["a", "b", "c", "d"], correctIndex: 0 },
      { prompt: "Q2", options: ["w", "x", "y", "z"], correctIndex: 3 },
      { prompt: "Q3", options: ["m", "n", "o", "p"], correctIndex: 2 },
    ],
  };

  it("samples questions from the bank when content is provided", () => {
    const { puzzle } = mcqArchetype.generate(new FakeRng(1), { questions: 3 }, bank);
    const qs = (puzzle as { questions: { prompt: string }[] }).questions;
    expect(qs).toHaveLength(3);
    for (const q of qs) expect(["Q1", "Q2", "Q3"]).toContain(q.prompt);
  });

  it("keeps the answer key correct after shuffling options", () => {
    const { puzzle } = mcqArchetype.generate(new FakeRng(5), { questions: 2 }, bank);
    const qs = (puzzle as { questions: { correctIndex: number }[] }).questions;
    expect(
      mcqArchetype.grade(
        puzzle,
        {},
        qs.map((q) => q.correctIndex),
      ),
    ).toBe(1);
  });
});

describe("set-select archetype", () => {
  const content = {
    instruction: "Pick.",
    aLabel: "A",
    bLabel: "B",
    names: ["X", "Y", "Z", "W", "V", "U"],
  };

  it("generates items whose real/trap key matches the a < b rule", () => {
    const { puzzle } = setSelectArchetype.generate(new FakeRng(4), { items: 6 }, content);
    const p = puzzle as { items: { a: number; b: number }[]; real: boolean[] };
    expect(p.items).toHaveLength(6);
    p.items.forEach((it, i) => expect(p.real[i]).toBe(it.a < it.b));
    expect(p.real.includes(true)).toBe(true);
    expect(p.real.includes(false)).toBe(true);
  });

  it("grades (correct − wrong)/K, clamped at zero", () => {
    const { puzzle } = setSelectArchetype.generate(new FakeRng(4), { items: 6 }, content);
    const p = puzzle as { real: boolean[] };
    expect(setSelectArchetype.grade(puzzle, {}, p.real.slice())).toBe(1);
    expect(
      setSelectArchetype.grade(
        puzzle,
        {},
        p.real.map(() => false),
      ),
    ).toBe(0);
    expect(
      setSelectArchetype.grade(
        puzzle,
        {},
        p.real.map(() => true),
      ),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("assignment archetype", () => {
  const content = {
    instruction: "Sort.",
    valueLabel: "V",
    bins: ["Low", "Mid", "High"],
    names: ["A", "B", "C", "D", "E", "F"],
  };

  it("generates items, three bins, and an in-range key", () => {
    const { puzzle, presentation } = assignmentArchetype.generate(
      new FakeRng(8),
      { items: 6, bins: 3 },
      content,
    );
    const p = puzzle as { items: unknown[]; correctBin: number[] };
    expect(p.items).toHaveLength(6);
    expect(p.correctBin).toHaveLength(6);
    expect((presentation as { bins: unknown[] }).bins).toHaveLength(3);
    for (const b of p.correctBin) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(3);
    }
  });

  it("grades the fraction binned correctly", () => {
    const { puzzle } = assignmentArchetype.generate(new FakeRng(8), { items: 6, bins: 3 }, content);
    const p = puzzle as { correctBin: number[] };
    expect(assignmentArchetype.grade(puzzle, {}, p.correctBin.slice())).toBe(1);
    expect(
      assignmentArchetype.grade(
        puzzle,
        {},
        p.correctBin.map((b) => (b + 1) % 3),
      ),
    ).toBe(0);
  });
});

describe("ordering archetype", () => {
  const content = {
    instruction: "Order.",
    metricLabel: "M",
    names: ["A", "B", "C", "D", "E"],
    ascending: true,
  };

  it("generates items with distinct metrics", () => {
    const { puzzle } = orderingArchetype.generate(new FakeRng(2), { items: 5 }, content);
    const metrics = (puzzle as { items: { metric: number }[] }).items.map((it) => it.metric);
    expect(metrics).toHaveLength(5);
    expect(new Set(metrics).size).toBe(5);
  });

  it("grades correct adjacent pairs", () => {
    const { puzzle } = orderingArchetype.generate(new FakeRng(2), { items: 5 }, content);
    const items = (puzzle as { items: { metric: number }[] }).items;
    const sorted = items.map((_, i) => i).sort((x, y) => items[x]!.metric - items[y]!.metric);
    expect(orderingArchetype.grade(puzzle, {}, sorted)).toBe(1);
    expect(orderingArchetype.grade(puzzle, {}, sorted.slice().reverse())).toBe(0);
  });
});

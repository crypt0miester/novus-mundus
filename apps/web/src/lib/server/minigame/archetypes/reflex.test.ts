/**
 * Reflex archetype unit tests — the pure logic (generate, grading helpers).
 * The timed move state machine is in `reflex-session.ts` (server-only).
 */

import { describe, it, expect } from "bun:test";
import {
  reflexArchetype,
  reactionFraction,
  precisionFraction,
  rttEstimate,
  REFLEX_RTT_CAP_MS,
  type ReflexProgress,
  type ReflexPuzzle,
} from "./reflex";
import { FakeRng } from "./__test__/fake-rng";

describe("reflex archetype — generate", () => {
  it("builds react rounds with secret GO delays and a leak-free presentation", () => {
    const g = reflexArchetype.generate(new FakeRng(3), { rounds: 4 }, { mode: "react" });
    const puzzle = g.puzzle as ReflexPuzzle;
    expect(puzzle.mode).toBe("react");
    expect(puzzle.perRound).toHaveLength(4);
    for (const r of puzzle.perRound) {
      expect(r.goDelayMs!).toBeGreaterThanOrEqual(800);
      expect(r.goDelayMs!).toBeLessThanOrEqual(3000);
    }
    // The secret delays must never reach the client.
    expect(JSON.stringify(g.presentation)).not.toContain("goDelay");
    expect((g.presentation as { rounds: number }).rounds).toBe(4);
  });

  it("builds precision rounds with a valid target band", () => {
    const g = reflexArchetype.generate(
      new FakeRng(7),
      { rounds: 3 },
      { mode: "precision" },
    );
    const puzzle = g.puzzle as ReflexPuzzle;
    expect(puzzle.mode).toBe("precision");
    expect(puzzle.perRound).toHaveLength(3);
    for (const r of puzzle.perRound) {
      expect(r.sweepMs!).toBeGreaterThan(0);
      expect(r.bandFrom!).toBeLessThan(r.bandTo!);
      expect(r.bandFrom!).toBeGreaterThanOrEqual(0);
      expect(r.bandTo!).toBeLessThanOrEqual(1);
    }
  });

  it("is seed-deterministic", () => {
    const a = reflexArchetype.generate(new FakeRng(9), { rounds: 4 }, { mode: "react" });
    const b = reflexArchetype.generate(new FakeRng(9), { rounds: 4 }, { mode: "react" });
    expect(JSON.stringify(a.puzzle)).toBe(JSON.stringify(b.puzzle));
  });
});

describe("reflex grading", () => {
  it("rttEstimate takes the smallest sample, capped", () => {
    expect(rttEstimate([])).toBe(0);
    expect(rttEstimate([120, 80, 200])).toBe(80);
    expect(rttEstimate([900, 1200])).toBe(REFLEX_RTT_CAP_MS);
  });

  it("reactionFraction rewards a fast reaction", () => {
    expect(reactionFraction(200, 280, 620)).toBe(1); // at or under target
    expect(reactionFraction(620, 280, 620)).toBe(0); // at the floor
    expect(reactionFraction(900, 280, 620)).toBe(0); // past the floor
    const mid = reactionFraction(450, 280, 620);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("precisionFraction rewards releasing inside the band", () => {
    expect(precisionFraction(0.5, 0.4, 0.6, 0.26)).toBe(1); // inside
    expect(precisionFraction(0.95, 0.4, 0.6, 0.26)).toBe(0); // far outside
    const near = precisionFraction(0.7, 0.4, 0.6, 0.26); // 0.1 past the band
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
  });

  it("grade is the mean of the per-round fractions", () => {
    const filled = { results: [1, 0.5, 0] } as unknown as ReflexProgress;
    expect(reflexArchetype.grade({}, filled, undefined)).toBeCloseTo(0.5);
    const empty = { results: [] } as unknown as ReflexProgress;
    expect(reflexArchetype.grade({}, empty, undefined)).toBe(0);
  });
});

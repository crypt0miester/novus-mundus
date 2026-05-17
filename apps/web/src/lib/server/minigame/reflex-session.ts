import "server-only";
import { randomBytes } from "node:crypto";
import { finalScore } from "./grade";
import { loadSession, saveSession } from "./session";
import {
  reflexArchetype,
  reactionFraction,
  precisionFraction,
  rttEstimate,
  type ReflexProgress,
  type ReflexPuzzle,
} from "./archetypes/reflex";
import type { MinigameSession } from "./types";

/**
 * The Reflex move state machine — `round-start` → `arm` → `tap`/`release`.
 *
 * Reflex is timed, so it bypasses the synchronous `applyMove` interface: every
 * instant is stamped here on the server clock (`Date.now()`), and the `arm`
 * response in `react` mode is *held open* for the secret GO delay — which is
 * what makes "tap before GO" impossible. RTT is sampled on the round-start→arm
 * leg and subtracted (capped) so the reaction is the player's, not the wire's.
 */

/** A reflex error code, so `/move` can return something more precise than `BAD_MOVE`. */
export type ReflexErrorCode = "ALL_ROUNDS_DONE" | "ROUND_NOT_READY" | "BAD_MOVE";

type ReflexOutcome =
  | { result: unknown; done: boolean }
  | { error: string; status: number; code: ReflexErrorCode };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export async function handleReflexMove(
  session: MinigameSession,
  rawMove: unknown,
): Promise<ReflexOutcome> {
  const puzzle = session.puzzle as ReflexPuzzle;
  const progress = session.progress as ReflexProgress;
  const move = (rawMove ?? {}) as { kind?: unknown; token?: unknown };

  // round-start — issue a token and stamp the round-trip clock.
  if (move.kind === "round-start") {
    if (progress.round >= puzzle.rounds) {
      return {
        error: "all rounds are already complete",
        status: 409,
        code: "ALL_ROUNDS_DONE",
      };
    }
    // A non-idle phase here means the previous attempt at this round was
    // abandoned (the player navigated away mid-round). The round was never
    // scored, so round-start just re-arms it from scratch — the session
    // self-heals instead of wedging on "finish the current round first".
    const token = randomBytes(8).toString("hex");
    progress.phase = "started";
    progress.token = token;
    progress.tStart = Date.now();
    await saveSession(session, "keep");
    return {
      result: {
        kind: "round-start",
        token,
        round: progress.round,
        rounds: puzzle.rounds,
      },
      done: false,
    };
  }

  // arm — record the RTT sample, then deliver GO (held) or the sweep params.
  if (move.kind === "arm") {
    // Idempotent: a retried arm after the round already armed just re-delivers.
    if (progress.phase === "awaiting-tap") {
      return { result: { kind: "go" }, done: false };
    }
    const armedRound = puzzle.perRound[progress.round];
    if (progress.phase === "awaiting-release" && armedRound) {
      return {
        result: {
          kind: "sweep",
          sweepMs: armedRound.sweepMs,
          bandFrom: armedRound.bandFrom,
          bandTo: armedRound.bandTo,
        },
        done: false,
      };
    }
    if (progress.phase !== "started" || move.token !== progress.token) {
      return {
        error: "this round is not ready to arm",
        status: 409,
        code: "ROUND_NOT_READY",
      };
    }
    const round = puzzle.perRound[progress.round];
    if (!round) return { error: "no such round", status: 409, code: "BAD_MOVE" };

    // The round-start → arm round-trip — the RTT sample for this round.
    const rtt = Math.max(0, Date.now() - progress.tStart);

    if (puzzle.mode === "react") {
      await sleep(round.goDelayMs ?? 1500); // held open — the secret GO delay

      // The GO was held open for up to ~5s. In that gap the player may have
      // false-started (an early tap that already burned this round) or
      // restarted it — re-read the session and abort rather than clobber.
      const fresh = await loadSession(session.id);
      const fp = fresh?.progress as ReflexProgress | undefined;
      if (
        !fresh ||
        fresh.status !== "active" ||
        !fp ||
        fp.round !== progress.round ||
        fp.phase !== "started" ||
        fp.token !== progress.token
      ) {
        return {
          error: "this round was already resolved",
          status: 409,
          code: "ROUND_NOT_READY",
        };
      }
      fp.rttSamples.push(rtt);
      fp.phase = "awaiting-tap";
      fp.tGo = Date.now(); // stamp GO as late as possible
      await saveSession(fresh, "keep");
      return { result: { kind: "go" }, done: false };
    }

    progress.rttSamples.push(rtt);
    progress.phase = "awaiting-release";
    progress.tSweepStart = Date.now();
    await saveSession(session, "keep");
    return {
      result: {
        kind: "sweep",
        sweepMs: round.sweepMs,
        bandFrom: round.bandFrom,
        bandTo: round.bandTo,
      },
      done: false,
    };
  }

  // tap / release — stamp the action, subtract RTT, score the round.
  if (move.kind === "tap" || move.kind === "release") {
    const now = Date.now();
    const round = puzzle.perRound[progress.round];
    if (!round) return { error: "no such round", status: 409, code: "BAD_MOVE" };

    let fraction: number;
    let payload: Record<string, unknown>;

    if (puzzle.mode === "react") {
      if (progress.phase === "started") {
        // Tapped before the GO signal — a false start. The round is burned at
        // zero instead of retried, so jumping the gun carries a real cost.
        fraction = 0;
        payload = { kind: "reaction", reactionMs: 0, fraction, falseStart: true };
      } else if (progress.phase === "awaiting-tap") {
        const raw = now - progress.tGo;
        const reaction = Math.max(0, raw - rttEstimate(progress.rttSamples));
        fraction = reactionFraction(reaction, puzzle.targetMs, puzzle.floorMs);
        payload = { kind: "reaction", reactionMs: Math.round(reaction), fraction };
      } else {
        // idle / awaiting-release — no react round is open to tap.
        return {
          error: "no round in progress",
          status: 409,
          code: "ROUND_NOT_READY",
        };
      }
    } else {
      if (progress.phase !== "awaiting-release") {
        return {
          error: "the sweep has not started",
          status: 409,
          code: "ROUND_NOT_READY",
        };
      }
      const raw = now - progress.tSweepStart;
      const elapsed = Math.max(0, raw - rttEstimate(progress.rttSamples));
      const markerPos = Math.min(1, elapsed / (round.sweepMs ?? 2500));
      fraction = precisionFraction(
        markerPos,
        round.bandFrom ?? 0.5,
        round.bandTo ?? 0.6,
        puzzle.tolerance,
      );
      payload = { kind: "release", markerPos, fraction };
    }

    progress.results.push(fraction);
    progress.round += 1;
    progress.phase = "idle";
    progress.token = null;
    const done = progress.round >= puzzle.rounds;
    if (done) {
      session.score = finalScore(reflexArchetype.grade(puzzle, progress, undefined));
    }
    await saveSession(session, "keep");
    return { result: { ...payload, round: progress.round, done }, done };
  }

  return { error: "unknown reflex move", status: 400, code: "BAD_MOVE" };
}

import "server-only";
import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/server/rate-limit";
import { fail, parseSessionBody } from "@/lib/server/route-helpers";
import { ARCHETYPES } from "@/lib/server/minigame/archetypes";
import { finalScore } from "@/lib/server/minigame/grade";
import { handleReflexMove } from "@/lib/server/minigame/reflex-session";
import { loadSession, saveSession } from "@/lib/server/minigame/session";

export const runtime = "nodejs";
// Reflex `react` rounds hold the GO response open for up to ~3s — give the
// handler ample headroom over a single round's delay.
export const maxDuration = 20;

interface MoveRequest {
  move?: unknown;
}

/**
 * POST /api/minigame/[sessionId]/move
 *
 * Apply one move to a multi-move mini-game session. The server holds the board;
 * the response reveals only what this move uncovered, never the rest of the
 * answer key. The move that clears the puzzle records the session's score for
 * co-sign to read.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const limited = await rateLimited(req);
  if (limited) return limited;

  const parsed = await parseSessionBody<MoveRequest>(req);
  if ("error" in parsed) return parsed.error;
  const { owner, body } = parsed;

  const { sessionId } = await ctx.params;

  try {
    const session = await loadSession(sessionId);
    if (!session) {
      return fail("mini-game session not found — start a new one", 404, "NO_SESSION");
    }
    if (session.owner !== owner.toBase58()) {
      return fail("this mini-game session is not yours", 403, "NOT_OWNER");
    }
    if (session.status !== "active") {
      return fail("this mini-game is already finished", 409, "FINISHED");
    }
    if (Date.now() > session.deadline) {
      return fail("this mini-game session has expired", 409, "SESSION_EXPIRED");
    }

    const archetype = ARCHETYPES[session.archetype];

    // Reflex is timed — it bypasses the synchronous applyMove and runs its own
    // server-clocked state machine (which holds the GO response open).
    if (session.archetype === "reflex") {
      const outcome = await handleReflexMove(session, body.move);
      if ("error" in outcome) {
        return fail(outcome.error, outcome.status, outcome.code);
      }
      return NextResponse.json({ result: outcome.result, done: outcome.done });
    }

    if (!archetype.multiMove || !archetype.applyMove) {
      return fail("this mini-game has no moves — submit it directly", 400, "NO_MOVES");
    }

    const outcome = archetype.applyMove(session.puzzle, session.progress, body.move);
    if (!outcome.ok) {
      return fail(outcome.error, 400, "BAD_MOVE");
    }

    session.progress = outcome.progress;
    if (outcome.done) {
      session.score = finalScore(
        archetype.grade(session.puzzle, outcome.progress, undefined),
      );
    }
    await saveSession(session, "keep");

    return NextResponse.json({ result: outcome.result, done: outcome.done });
  } catch (e) {
    console.error("minigame move failed", e);
    return fail(
      "the mini-game service is unavailable — try again shortly",
      503,
      "SERVICE_DOWN",
    );
  }
}

import "server-only";
import { NextResponse } from "next/server";
import {
  buildingAllowedWindows,
  currentTimeWindow,
  dailyDateFor,
  hasBuildingAtLevel,
  isDailyStateStale,
} from "novus-mundus-sdk";
import { estatePda, getEstate } from "@/lib/server/chain";
import { rateLimited } from "@/lib/server/rate-limit";
import { fail, requireSession } from "@/lib/server/route-helpers";
import { ARCHETYPES } from "@/lib/server/minigame/archetypes";
import { getBuildingMinigame, type BuildingMinigame } from "@/lib/server/minigame/buildings";
import { activityPreconditionError } from "@/lib/server/minigame/preconditions";
import { generatePuzzle } from "@/lib/server/minigame/puzzle";
import {
  claimStartLock,
  clearLock,
  getLock,
  loadSession,
  newSessionId,
  saveSession,
  setLock,
  SESSION_TTL_SECONDS,
} from "@/lib/server/minigame/session";
import type { MinigameSession } from "@/lib/server/minigame/types";

export const runtime = "nodejs";

/**
 * POST /api/minigame/estate/[building]/start
 *
 * Validate the daily-activity preconditions, then generate — or resume — a
 * Redis-backed mini-game session and return its client-safe presentation. The
 * answer key stays server-side in the session; the client only ever sees the
 * presentation. Generation is seed-deterministic, so a player who abandons and
 * restarts gets the identical puzzle.
 */
export async function POST(req: Request, ctx: { params: Promise<{ building: string }> }) {
  const limited = await rateLimited(req);
  if (limited) return limited;

  const session = requireSession(req);
  if ("error" in session) return session.error;
  const owner = session.owner;

  const { building: buildingParam } = await ctx.params;
  const building = Number(buildingParam);
  if (!Number.isInteger(building) || building < 0 || building > 18) {
    return fail("invalid building id", 400, "BAD_BUILDING");
  }

  const config = getBuildingMinigame(building);
  if (!config) {
    return fail("this building's mini-game isn't available yet", 409, "NO_MINIGAME");
  }

  const estate = await getEstate(owner);
  if (!estate) return fail("you have not established an estate", 409, "NO_ESTATE");
  if (!hasBuildingAtLevel(estate, building, 1)) {
    return fail("that building is not built and active", 409, "BUILDING_INACTIVE");
  }

  const now = Math.floor(Date.now() / 1000);
  const precondition = activityPreconditionError(estate, building, now);
  // Local-dev preview: ignore the time-of-day window (and the once-per-window
  // lock) so any built mini-game can be opened regardless of the clock. The
  // on-chain `daily_activity` gate still enforces the window, so an
  // out-of-window submit won't claim a reward — this only unblocks playing the
  // game. NO_MINIGAME / BUILDING_INACTIVE etc. still apply.
  const devBypass = process.env.NODE_ENV === "development";
  const WINDOW_BYPASS_CODES = new Set(["WINDOW_EXPIRED", "WRONG_WINDOW", "ALREADY_DONE"]);
  if (precondition && !(devBypass && WINDOW_BYPASS_CODES.has(precondition.code))) {
    return fail(precondition.error, 409, precondition.code);
  }

  // The real current window when the gate passed; when dev-bypassing an
  // out-of-window preview, fall back to the building's own first window so the
  // session, lock, and seeded puzzle stay coherent.
  const window = precondition
    ? (buildingAllowedWindows(building)[0] ?? "dawn")
    : currentTimeWindow(estate, now); // gate passed — never "expired"
  const day = isDailyStateStale(estate, now) ? dailyDateFor(now) : estate.dailyDate;
  const ownerKey = owner.toBase58();

  // Dev preview: the puzzle is deterministic per (building, day, window) in
  // production (no re-rolling for an easier draw), so it never changes while
  // you're pinned to one window in dev. Here we mint a fresh, nonce-seeded
  // session on every Begin so the game actually varies while evaluating. The
  // session is still used consistently for grading; only the on-chain claim
  // stays gated.
  if (process.env.NODE_ENV === "development") {
    const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const generated = generatePuzzle(building, (await estatePda(owner)).toBase58(), day, window, nonce);
    const fresh = makeSession(generated, ownerKey, building, window, day);
    await saveSession(fresh, SESSION_TTL_SECONDS);
    return NextResponse.json(sessionResponse(fresh, config));
  }

  try {
    // Resume a live session for this window, or start a fresh one.
    let lock = await getLock(ownerKey, day, window, building);
    if (lock === "done") {
      // The on-chain precondition above already passed — the chain says this
      // activity is NOT done for this window — so a "done" lock here is stale:
      // a co-sign that never confirmed on-chain (wallet rejected, tx dropped,
      // or the run abandoned). The chain is authoritative; clear the stale
      // lock and let the player start fresh.
      await clearLock(ownerKey, day, window, building).catch(() => {});
      lock = null;
    }
    // A lock can outlive its session (lock TTL 18h, session TTL 10min); such a
    // stale lock is taken over below rather than blocking a fresh start.
    let staleLock = false;
    if (lock) {
      const resumed = await resumeSession(lock, ownerKey);
      if (resumed) return NextResponse.json(sessionResponse(resumed, config));
      staleLock = true;
    }

    // Mint a fresh session, claiming the lock first — two concurrent /start
    // calls for a clean window race the atomic claim, and only the winner
    // persists a session.
    const generated = generatePuzzle(building, (await estatePda(owner)).toBase58(), day, window);
    const fresh = makeSession(generated, ownerKey, building, window, day);

    if (staleLock) {
      // The stale lock makes the atomic claim a no-op, so overwrite it. A
      // concurrent takeover may already have done so — resume that instead.
      const current = await getLock(ownerKey, day, window, building);
      if (current && current !== lock) {
        const resumed = await resumeSession(current, ownerKey);
        if (resumed) return NextResponse.json(sessionResponse(resumed, config));
      }
      await saveSession(fresh, SESSION_TTL_SECONDS);
      await setLock(ownerKey, day, window, building, fresh.id);
      return NextResponse.json(sessionResponse(fresh, config));
    }

    const won = await claimStartLock(ownerKey, day, window, building, fresh.id);
    if (!won) {
      // Lost the race — resume whatever session the winner just minted.
      const winnerId = await getLock(ownerKey, day, window, building);
      const resumed = winnerId ? await resumeSession(winnerId, ownerKey) : null;
      if (resumed) return NextResponse.json(sessionResponse(resumed, config));
      return fail("the mini-game service is unavailable — try again shortly", 503, "SERVICE_DOWN");
    }
    await saveSession(fresh, SESSION_TTL_SECONDS);
    return NextResponse.json(sessionResponse(fresh, config));
  } catch (e) {
    console.error("minigame start failed", e);
    return fail("the mini-game service is unavailable — try again shortly", 503, "SERVICE_DOWN");
  }
}

/**
 * Load a live, owned, unexpired session by id, or null. The winner of the start
 * race claims the lock before its `saveSession` lands, so a loser briefly
 * retries the read to give that write time to settle.
 */
async function resumeSession(id: string, ownerKey: string): Promise<MinigameSession | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await loadSession(id);
    if (session) {
      const live =
        session.status === "active" && session.owner === ownerKey && Date.now() < session.deadline;
      return live ? session : null;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

/** Build a fresh active session from a generated puzzle. */
function makeSession(
  generated: ReturnType<typeof generatePuzzle>,
  ownerKey: string,
  building: number,
  window: MinigameSession["window"],
  day: number,
): MinigameSession {
  const createdAt = Date.now();
  return {
    id: newSessionId(),
    owner: ownerKey,
    building,
    archetype: generated.archetype,
    window,
    day,
    puzzle: generated.puzzle,
    progress: generated.progress,
    presentation: generated.presentation,
    score: null,
    status: "active",
    createdAt,
    deadline: createdAt + SESSION_TTL_SECONDS * 1000,
  };
}

/** The client-safe `/start` payload — never the answer key. */
function sessionResponse(s: MinigameSession, config: BuildingMinigame) {
  return {
    sessionId: s.id,
    building: s.building,
    archetype: s.archetype,
    multiMove: ARCHETYPES[s.archetype].multiMove,
    window: s.window,
    flavor: config.flavor,
    presentation: s.presentation,
    progress: s.progress,
    deadline: s.deadline,
  };
}

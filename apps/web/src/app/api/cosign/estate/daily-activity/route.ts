import "server-only";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  createDailyActivityInstruction,
  currentTimeWindow,
  deriveNoviMintPda,
  deriveResearchPda,
  getAssociatedTokenAddressSyncForPda,
  hasBuildingAtLevel,
  isNullPubkey,
  BuildingType,
} from "novus-mundus-sdk";
import { gameAuthorityKeypair } from "@/lib/server/game-authority";
import {
  estatePda,
  gameEnginePda,
  getEstate,
  getPlayer,
  playerPda,
} from "@/lib/server/chain";
import { coSign } from "@/lib/server/cosign";
import { rateLimited } from "@/lib/server/rate-limit";
import { rollScore } from "@/lib/server/score-logic";
import { coSignResponse, fail, parseSessionBody } from "@/lib/server/route-helpers";
import { ARCHETYPES } from "@/lib/server/minigame/archetypes";
import { getBuildingMinigame } from "@/lib/server/minigame/buildings";
import { finalScore } from "@/lib/server/minigame/grade";
import { activityPreconditionError } from "@/lib/server/minigame/preconditions";
import {
  claimSubmit,
  loadSession,
  releaseSubmit,
  saveSession,
  setLock,
} from "@/lib/server/minigame/session";
import type { MinigameSession } from "@/lib/server/minigame/types";
import { windowCompletionBonus } from "@/lib/server/minigame/window-completion";

export const runtime = "nodejs";

interface DailyActivityRequest {
  buildingType?: number;
  /** Citadel only — the chosen stance: 0 Defensive / 1 Balanced / 2 Aggressive. */
  choice?: number;
  /** Sanctuary (MeditationChamber) only — the hero NFT mint to bless. */
  heroMint?: string;
  /** A finished mini-game session to grade and co-sign (Class B/C buildings). */
  sessionId?: string;
  /** Single-submit answer (e.g. MCQ selected indices), when grading a session. */
  answer?: unknown;
}

/**
 * Citadel stance to a representative score inside that stance's on-chain bucket
 * (`<34` Defensive, `<67` Balanced, else Aggressive). The midpoints make all
 * three stances reachable; the flat score roll can only land on Balanced or
 * Aggressive.
 */
const STANCE_SCORES = [16, 50, 83];

/**
 * POST /api/cosign/estate/daily-activity
 *
 * Co-signs an estate `daily_activity`. The score comes from one of three paths:
 *  - Citadel — a stance *choice* encoded into its on-chain bucket.
 *  - a building with a mini-game + a finished session — the graded result.
 *  - everything else — the server score roll (the Class A fallback, and any
 *    building whose mini-game has not shipped yet).
 */
export async function POST(req: Request) {
  const limited = await rateLimited(req);
  if (limited) return limited;

  const parsed = await parseSessionBody<DailyActivityRequest>(req);
  if ("error" in parsed) return parsed.error;
  const { owner, body } = parsed;

  const buildingType = Number(body.buildingType);
  if (!Number.isInteger(buildingType) || buildingType < 0 || buildingType > 18) {
    return fail("'buildingType' must be a valid building id (0-18)", 400, "BAD_BUILDING");
  }

  const estate = await getEstate(owner);
  if (!estate) return fail("you have not established an estate", 409, "NO_ESTATE");
  if (!hasBuildingAtLevel(estate, buildingType, 1)) {
    return fail("that building is not built and active", 409, "BUILDING_INACTIVE");
  }

  // Precondition gate — mirror the program's window check (shared with /start).
  const now = Math.floor(Date.now() / 1000);
  const precondition = activityPreconditionError(estate, buildingType, now);
  if (precondition) return fail(precondition.error, 409, precondition.code);
  const currentWindow = currentTimeWindow(estate, now);

  const player = playerPda(owner);

  // Conditional accounts, attached per building type.
  let heroMint = PublicKey.default;
  let playerTokenAccount: PublicKey | undefined;
  let noviMint: PublicKey | undefined;
  let researchProgress: PublicKey | undefined;

  if (buildingType === BuildingType.MeditationChamber) {
    // Sanctuary: bless the player's chosen hero, validated against the roster;
    // fall back to the first locked hero (keeps the pre-choice-screen UI working).
    const playerAccount = await getPlayer(owner);
    const activeHeroes = (playerAccount?.activeHeroes ?? []).filter(
      (h) => !isNullPubkey(h),
    );
    if (body.heroMint != null) {
      let chosen: PublicKey;
      try {
        chosen = new PublicKey(body.heroMint);
      } catch {
        return fail("'heroMint' is not a valid pubkey", 400, "BAD_HERO");
      }
      if (!activeHeroes.some((h) => h.equals(chosen))) {
        return fail("that hero is not locked to your roster", 409, "HERO_NOT_ACTIVE");
      }
      heroMint = chosen;
    } else {
      const hero = activeHeroes[0];
      if (!hero) {
        return fail("lock a hero before doing the Sanctuary activity", 409, "NO_HERO");
      }
      heroMint = hero;
    }
  } else if (buildingType === BuildingType.Treasury) {
    noviMint = deriveNoviMintPda()[0];
    playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);
  } else if (buildingType === BuildingType.Academy) {
    // Pad slots 6 & 7 so researchProgress lands at the program's index 8.
    playerTokenAccount = PublicKey.default;
    noviMint = PublicKey.default;
    researchProgress = deriveResearchPda(player)[0];
  }

  // Resolve the score.
  let score: number;
  let sessionToFinalize: MinigameSession | undefined;

  if (buildingType === BuildingType.Citadel && body.choice != null) {
    const choice = Number(body.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice > 2) {
      return fail(
        "'choice' must be 0 (Defensive), 1 (Balanced), or 2 (Aggressive)",
        400,
        "BAD_CHOICE",
      );
    }
    score = STANCE_SCORES[choice]!;
  } else if (getBuildingMinigame(buildingType) && body.sessionId != null) {
    const graded = await gradeSession(
      body.sessionId,
      owner.toBase58(),
      buildingType,
      currentWindow,
      body.answer,
    );
    if ("error" in graded) return graded.error;
    score = graded.score;
    sessionToFinalize = graded.session;
  } else {
    score = rollScore(
      "estate.daily_activity",
      estatePda(owner).toBase58(),
      `${buildingType}:${estate.dailyDate}`,
    );
  }

  // Window-completion bonus (§8) — a flat score bump when this submission
  // completes its window. Excluded for Citadel (the score *is* the stance) and
  // Sanctuary (Class A — the program ignores its score anyway).
  let windowBonus = 0;
  if (
    buildingType !== BuildingType.Citadel &&
    buildingType !== BuildingType.MeditationChamber
  ) {
    windowBonus = windowCompletionBonus(estate, buildingType, now);
    score = Math.min(100, score + windowBonus);
  }

  const ix = createDailyActivityInstruction(
    {
      owner,
      gameEngine: gameEnginePda(),
      gameAuthority: gameAuthorityKeypair().publicKey,
      heroMint,
      playerTokenAccount,
      noviMint,
      researchProgress,
    },
    { buildingType, score },
  );

  // For the mini-game path, finalize the session only after a successful
  // co-sign — a failed co-sign stays retryable.
  if (sessionToFinalize) {
    let transaction: string;
    try {
      transaction = await coSign([ix], owner);
    } catch (e) {
      await releaseSubmit(sessionToFinalize.id).catch(() => {});
      console.error("co-sign failed", e);
      return fail(e instanceof Error ? e.message : "co-sign failed", 500);
    }
    sessionToFinalize.status = "finished";
    await saveSession(sessionToFinalize, "keep").catch(() => {});
    await setLock(
      sessionToFinalize.owner,
      sessionToFinalize.day,
      sessionToFinalize.window,
      sessionToFinalize.building,
      "done",
    ).catch(() => {});
    // `score` and `windowBonus` let the client show the result directly.
    return NextResponse.json({ transaction, score, windowBonus });
  }

  return coSignResponse([ix], owner);
}

/**
 * Load, validate, and grade a finished mini-game session. Returns the score and
 * the session (claimed for co-sign), or a ready-to-return error response.
 */
async function gradeSession(
  sessionId: string,
  ownerKey: string,
  buildingType: number,
  currentWindow: string,
  answer: unknown,
): Promise<{ score: number; session: MinigameSession } | { error: NextResponse }> {
  let session: MinigameSession | null;
  try {
    session = await loadSession(sessionId);
  } catch {
    return {
      error: fail("the mini-game service is unavailable — try again shortly", 503, "SERVICE_DOWN"),
    };
  }
  if (!session) {
    return { error: fail("mini-game session not found — start it again", 409, "NO_SESSION") };
  }
  if (session.owner !== ownerKey) {
    return { error: fail("this mini-game session is not yours", 403, "NOT_OWNER") };
  }
  if (session.building !== buildingType) {
    return { error: fail("that session is for a different building", 409, "WRONG_BUILDING") };
  }
  if (session.status !== "active") {
    return { error: fail("this mini-game was already submitted", 409, "ALREADY_SUBMITTED") };
  }
  if (Date.now() > session.deadline) {
    return { error: fail("the mini-game session has expired — start it again", 409, "SESSION_EXPIRED") };
  }
  if (session.window !== currentWindow) {
    return { error: fail("the activity window changed — refresh and replay", 409, "WINDOW_CHANGED") };
  }

  // Atomically claim the right to co-sign this session (double-submit guard).
  let won: boolean;
  try {
    won = await claimSubmit(session.id);
  } catch {
    return {
      error: fail("the mini-game service is unavailable — try again shortly", 503, "SERVICE_DOWN"),
    };
  }
  if (!won) {
    return { error: fail("this mini-game is already being submitted", 409, "SUBMIT_IN_FLIGHT") };
  }

  const archetype = ARCHETYPES[session.archetype];
  if (archetype.multiMove) {
    // Multi-move: the score was accumulated server-side as moves were applied.
    if (session.score == null) {
      await releaseSubmit(session.id).catch(() => {});
      return { error: fail("finish the mini-game before submitting", 409, "INCOMPLETE") };
    }
    return { score: session.score, session };
  }
  // Single-submit: grade the answer now.
  return {
    score: finalScore(archetype.grade(session.puzzle, session.progress, answer)),
    session,
  };
}

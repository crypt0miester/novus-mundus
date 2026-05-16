import "server-only";
import { createResumeInstruction, DungeonStatus } from "novus-mundus-sdk";
import { gameAuthorityKeypair } from "@/lib/server/game-authority";
import {
  gameEnginePda,
  getDungeonRun,
  getDungeonTemplate,
} from "@/lib/server/chain";
import { rateLimited } from "@/lib/server/rate-limit";
import { rollResumeRoom } from "@/lib/server/dungeon-logic";
import {
  coSignResponse,
  fail,
  parseSessionBody,
} from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/cosign/dungeon/resume
 *
 * Co-signs a dungeon resume. Like `enter`, the backend rolls `first_room_type`
 * and the game_authority signature authenticates it on-chain.
 */
export async function POST(req: Request) {
  const limited = await rateLimited(req);
  if (limited) return limited;

  const parsed = await parseSessionBody<unknown>(req);
  if ("error" in parsed) return parsed.error;
  const { owner } = parsed;

  const run = await getDungeonRun(owner);
  if (!run) return fail("no dungeon run to resume", 409);
  if (run.status !== DungeonStatus.Failed) {
    return fail("the run is not in a resumable (failed) state", 409);
  }
  if (run.lastCheckpoint === 0) {
    return fail("the run has no checkpoint to resume from", 409);
  }

  const template = await getDungeonTemplate(run.dungeonId);
  if (!template) return fail("dungeon template not found", 404);

  const ix = createResumeInstruction(
    {
      owner,
      gameEngine: gameEnginePda(),
      gameAuthority: gameAuthorityKeypair().publicKey,
    },
    {
      templateId: run.dungeonId,
      firstRoomType: rollResumeRoom(run, template),
    },
  );

  return coSignResponse([ix], owner);
}

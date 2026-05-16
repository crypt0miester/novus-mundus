import "server-only";
import { createInteractInstruction, DungeonStatus, RoomType } from "novus-mundus-sdk";
import { gameAuthorityKeypair } from "@/lib/server/game-authority";
import {
  gameEnginePda,
  getDungeonRun,
  getDungeonTemplate,
} from "@/lib/server/chain";
import { rateLimited } from "@/lib/server/rate-limit";
import { rollDungeonInteract } from "@/lib/server/dungeon-logic";
import { coSignResponse, fail, requireSession } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/cosign/dungeon/interact
 *
 * Co-signs a dungeon `interact` for a non-combat room (Treasure / Camp / Rest /
 * Trap). The camp buff is only attached when the current room is a Camp.
 */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const session = requireSession(req);
  if ("error" in session) return session.error;
  const { owner } = session;

  const run = await getDungeonRun(owner);
  if (!run) return fail("no active dungeon run", 409);
  if (run.status !== DungeonStatus.Active && run.status !== DungeonStatus.BossFight) {
    return fail("dungeon run is not in an active state", 409);
  }
  if (run.roomType === RoomType.Combat) {
    return fail("a combat room cannot be resolved with interact", 409);
  }

  const template = await getDungeonTemplate(run.dungeonId);
  if (!template) return fail("dungeon template not found", 500);

  const rolls = rollDungeonInteract(run, template);

  const ix = createInteractInstruction(
    {
      owner,
      gameEngine: gameEnginePda(),
      gameAuthority: gameAuthorityKeypair().publicKey,
    },
    {
      templateId: run.dungeonId,
      nextRoomType: rolls.nextRoomType,
      campBonusBps:
        run.roomType === RoomType.Camp ? rolls.campBonusBps : undefined,
    },
  );

  return coSignResponse([ix], owner);
}

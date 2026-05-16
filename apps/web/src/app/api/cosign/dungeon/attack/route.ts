import "server-only";
import { createAttackInstruction } from "novus-mundus-sdk";
import { gameAuthorityKeypair } from "@/lib/server/game-authority";
import { gameEnginePda } from "@/lib/server/chain";
import { rateLimited } from "@/lib/server/rate-limit";
import { rollDungeonAttack } from "@/lib/server/dungeon-logic";
import { coSignResponse, parseOwnerBody } from "@/lib/server/route-helpers";
import { loadCombatRun } from "../_shared";

export const runtime = "nodejs";

interface AttackRequest {
  owner?: string;
}

/**
 * POST /api/cosign/dungeon/attack
 *
 * Co-signs a dungeon `attack`. The server reads the live run state, rolls the
 * next room type + crit / double-strike, builds the instruction, and returns a
 * game_authority-signed VersionedTransaction for the wallet to finish.
 */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const parsed = await parseOwnerBody<AttackRequest>(req);
  if ("error" in parsed) return parsed.error;
  const { owner } = parsed;

  const loaded = await loadCombatRun(owner);
  if ("error" in loaded) return loaded.error;
  const { run, template } = loaded;

  const rolls = rollDungeonAttack(run, template);

  const ix = createAttackInstruction(
    {
      owner,
      gameEngine: gameEnginePda(),
      gameAuthority: gameAuthorityKeypair().publicKey,
    },
    {
      templateId: run.dungeonId,
      nextRoomType: rolls.nextRoomType,
      doubleStrike: rolls.doubleStrike,
      crit: rolls.crit,
    },
  );

  return coSignResponse([ix], owner);
}

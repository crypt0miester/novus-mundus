import "server-only";
import { createAttackMultiInstruction } from "novus-mundus-sdk";
import { gameAuthorityKeypair } from "@/lib/server/game-authority";
import { gameEnginePda } from "@/lib/server/chain";
import { rateLimited } from "@/lib/server/rate-limit";
import { rollDungeonAttack } from "@/lib/server/dungeon-logic";
import { coSignResponse, fail, parseSessionBody } from "@/lib/server/route-helpers";
import { loadCombatRun } from "../_shared";

export const runtime = "nodejs";

interface MultiAttackRequest {
  attackCount?: number;
}

/**
 * POST /api/cosign/dungeon/attack-multi
 *
 * Co-signs a dungeon `attack_multi` (1-5 attacks). One roll covers the whole
 * batch — the program applies the same crit / double-strike to every attack.
 */
export async function POST(req: Request) {
  const limited = await rateLimited(req);
  if (limited) return limited;

  const parsed = await parseSessionBody<MultiAttackRequest>(req);
  if ("error" in parsed) return parsed.error;
  const { owner, body } = parsed;

  const attackCount = Number(body.attackCount ?? 0);
  if (!Number.isInteger(attackCount) || attackCount < 1 || attackCount > 5) {
    return fail("'attackCount' must be an integer between 1 and 5");
  }

  const loaded = await loadCombatRun(owner);
  if ("error" in loaded) return loaded.error;
  const { run, template } = loaded;

  const rolls = rollDungeonAttack(run, template);

  const ix = createAttackMultiInstruction(
    {
      owner,
      gameEngine: gameEnginePda(),
      gameAuthority: gameAuthorityKeypair().publicKey,
    },
    {
      templateId: run.dungeonId,
      attackCount,
      nextRoomType: rolls.nextRoomType,
      doubleStrike: rolls.doubleStrike,
      crit: rolls.crit,
    },
  );

  return coSignResponse([ix], owner);
}

import "server-only";
import { createExpeditionStrikeInstruction } from "novus-mundus-sdk";
import { gameAuthorityKeypair } from "@/lib/server/game-authority";
import { expeditionPda, gameEnginePda, getExpedition } from "@/lib/server/chain";
import { rateLimited } from "@/lib/server/rate-limit";
import { rollScore } from "@/lib/server/score-logic";
import { coSignResponse, fail, requireSession } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/cosign/expedition/strike
 *
 * Co-signs an expedition `strike`. The score is computed server-side (see
 * score-logic.ts) and seeded by the strike index, so the value is authoritative
 * and a retry reproduces it. On-chain timing limits are enforced by the program.
 */
export async function POST(req: Request) {
  const limited = await rateLimited(req);
  if (limited) return limited;

  const session = requireSession(req);
  if ("error" in session) return session.error;
  const { owner } = session;

  const expedition = await getExpedition(owner);
  if (!expedition) return fail("no active expedition", 409);

  const score = rollScore(
    "expedition.strike",
    (await expeditionPda(owner)).toBase58(),
    String(expedition.strikes),
  );

  const ix = await createExpeditionStrikeInstruction(
    {
      owner,
      gameEngine: gameEnginePda(),
      gameAuthority: (await gameAuthorityKeypair()).publicKey,
    },
    { score },
  );

  return coSignResponse([ix], owner);
}

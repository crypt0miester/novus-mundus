import "server-only";
import { PublicKey } from "@solana/web3.js";
import {
  createDailyActivityInstruction,
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
import { rateLimited } from "@/lib/server/rate-limit";
import { rollScore } from "@/lib/server/score-logic";
import { coSignResponse, fail, parseSessionBody } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface DailyActivityRequest {
  buildingType?: number;
}

/**
 * POST /api/cosign/estate/daily-activity
 *
 * Co-signs an estate `daily_activity` for a given building. The mini-game score
 * is computed server-side (score-logic.ts). Conditional accounts are attached
 * per building type: a hero for the MeditationChamber, the NOVI token account
 * for the Treasury, the research progress for the Academy.
 */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const parsed = await parseSessionBody<DailyActivityRequest>(req);
  if ("error" in parsed) return parsed.error;
  const { owner, body } = parsed;

  const buildingType = Number(body.buildingType);
  if (!Number.isInteger(buildingType) || buildingType < 0 || buildingType > 18) {
    return fail("'buildingType' must be a valid building id (0-18)");
  }

  const estate = await getEstate(owner);
  if (!estate) return fail("you have not established an estate", 409);
  if (!hasBuildingAtLevel(estate, buildingType, 1)) {
    return fail("that building is not built and active", 409);
  }

  const player = playerPda(owner);

  // Conditional accounts, attached per building type.
  let heroMint = PublicKey.default;
  let playerTokenAccount: PublicKey | undefined;
  let noviMint: PublicKey | undefined;
  let researchProgress: PublicKey | undefined;

  if (buildingType === BuildingType.MeditationChamber) {
    const playerAccount = await getPlayer(owner);
    const hero = playerAccount?.activeHeroes?.find((h) => !isNullPubkey(h));
    if (!hero) {
      return fail("lock a hero before doing the Sanctuary activity", 409);
    }
    heroMint = hero;
  } else if (buildingType === BuildingType.Treasury) {
    noviMint = deriveNoviMintPda()[0];
    playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);
  } else if (buildingType === BuildingType.Academy) {
    // Pad slots 6 & 7 so researchProgress lands at the program's index 8.
    playerTokenAccount = PublicKey.default;
    noviMint = PublicKey.default;
    researchProgress = deriveResearchPda(player)[0];
  }

  const score = rollScore(
    "estate.daily_activity",
    estatePda(owner).toBase58(),
    `${buildingType}:${estate.dailyDate}`,
  );

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

  return coSignResponse([ix], owner);
}

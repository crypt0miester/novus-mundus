import "server-only";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { createEnterDungeonInstruction, createPurchaseStaminaInstruction } from "novus-mundus-sdk";
import { gameAuthorityKeypair } from "@/lib/server/game-authority";
import { gameEnginePda, getDungeonRun, getDungeonTemplate, getPlayer } from "@/lib/server/chain";
import { rateLimited } from "@/lib/server/rate-limit";
import { rollEnterRoom } from "@/lib/server/dungeon-logic";
import { coSignResponse, fail, parseSessionBody } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface EnterBody {
  dungeonId?: number;
  heroMint?: string;
  heroSpecialization?: number;
  /** When set, prepend a purchase-stamina ix covering the entry shortfall. */
  buyStamina?: boolean;
}

/**
 * POST /api/cosign/dungeon/enter
 *
 * Co-signs a dungeon entry. The backend rolls `first_room_type` and the
 * game_authority signature on the returned transaction authenticates it — the
 * `enter` instruction rejects any entry not co-signed by the game authority.
 */
export async function POST(req: Request) {
  const limited = await rateLimited(req);
  if (limited) return limited;

  const parsed = await parseSessionBody<EnterBody>(req);
  if ("error" in parsed) return parsed.error;
  const { owner, body } = parsed;

  const dungeonId = Number(body.dungeonId);
  if (!Number.isInteger(dungeonId) || dungeonId < 0) {
    return fail("'dungeonId' must be a non-negative integer");
  }

  const heroSpecialization = Number(body.heroSpecialization);
  if (!Number.isInteger(heroSpecialization) || heroSpecialization < 0 || heroSpecialization > 3) {
    return fail("'heroSpecialization' must be an integer 0-3");
  }

  let heroMint: PublicKey;
  try {
    heroMint = new PublicKey(body.heroMint ?? "");
  } catch {
    return fail("'heroMint' must be a valid pubkey");
  }

  // A run already occupies the DungeonRun PDA — the program rejects re-entry
  // (DungeonRunExists) until it is claimed or fled.
  if (await getDungeonRun(owner)) {
    return fail("a dungeon run is already in progress", 409);
  }

  const template = await getDungeonTemplate(dungeonId);
  if (!template) return fail("dungeon template not found", 404);

  const gameEngine = gameEnginePda();
  const instructions: TransactionInstruction[] = [];

  // Optionally cover the stamina shortfall in the same (co-signed) transaction.
  if (body.buyStamina) {
    const player = await getPlayer(owner);
    if (!player) return fail("player account not found", 404);
    const shortfall = template.staminaCost - Number(player.encounterStamina);
    if (shortfall > 0) {
      instructions.push(
        await createPurchaseStaminaInstruction({ owner, gameEngine }, { amount: shortfall }),
      );
    }
  }

  const gameAuthority = (await gameAuthorityKeypair()).publicKey;
  instructions.push(
    await createEnterDungeonInstruction(
      {
        owner,
        gameEngine,
        heroMint,
        gameAuthority,
      },
      {
        templateId: dungeonId,
        firstRoomType: rollEnterRoom(template, owner.toBase58(), dungeonId),
        heroSpecialization,
      },
    ),
  );

  return coSignResponse(instructions, owner);
}

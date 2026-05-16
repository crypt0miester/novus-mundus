import "server-only";
import { PublicKey } from "@solana/web3.js";
import {
  createChallengePlayerInstruction,
  derivePlayerPda,
  deriveEstatePda,
  isNullPubkey,
  isSeasonActive,
} from "novus-mundus-sdk";
import { gameAuthorityKeypair, serverClient } from "@/lib/server/game-authority";
import { gameEnginePda, getArenaLoadout } from "@/lib/server/chain";
import { rateLimited } from "@/lib/server/rate-limit";
import { findMatch } from "@/lib/server/matchmaker";
import { coSignResponse, fail, parseSessionBody } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

const DEFAULT_SEASON_ID = 1;

interface ChallengeRequest {
  seasonId?: number;
}

/**
 * POST /api/cosign/arena/challenge
 *
 * Matchmakes an ELO-appropriate opponent, builds the `challenge_player`
 * instruction, and returns a game_authority-co-signed transaction plus the
 * resolved opponent for display.
 */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const parsed = await parseSessionBody<ChallengeRequest>(req);
  if ("error" in parsed) return parsed.error;
  const { owner, body } = parsed;

  const seasonId =
    typeof body.seasonId === "number" && Number.isInteger(body.seasonId)
      ? body.seasonId
      : DEFAULT_SEASON_ID;

  const client = serverClient();
  const gameEngine = gameEnginePda();

  // The season fetch and matchmaking are independent — run them together.
  const [season, matchOrError] = await Promise.all([
    client.fetchArenaSeason(seasonId),
    findMatch(seasonId, owner).catch((e: unknown) =>
      e instanceof Error ? e : new Error("matchmaking failed"),
    ),
  ]);
  if (!season?.account) return fail("arena season not found", 409);
  if (!isSeasonActive(season.account)) {
    return fail("the arena season is not active", 409);
  }
  if (matchOrError instanceof Error) return fail(matchOrError.message, 409);
  const match = matchOrError;

  const challengerPlayer = derivePlayerPda(gameEngine, owner)[0];
  const defenderPlayer = derivePlayerPda(gameEngine, match.defenderWallet)[0];
  const [challengerLoadout, defenderLoadout] = await Promise.all([
    getArenaLoadout(challengerPlayer),
    getArenaLoadout(defenderPlayer),
  ]);

  const ix = createChallengePlayerInstruction(
    {
      challenger: owner,
      gameEngine,
      gameAuthority: gameAuthorityKeypair().publicKey,
      seasonAuthority: season.account.authority,
      seasonId,
      defenderAuthority: match.defenderWallet,
      challengerHero: heroOf(challengerLoadout),
      challengerEstate: deriveEstatePda(challengerPlayer)[0],
      defenderHero: heroOf(defenderLoadout),
      defenderEstate: deriveEstatePda(defenderPlayer)[0],
    },
    { matchId: match.matchId, matchTimestamp: match.matchTimestamp },
  );

  return coSignResponse([ix], owner, {
    defender: {
      wallet: match.defenderWallet.toBase58(),
      elo: match.defenderElo,
    },
  });
}

/** The arena hero on a loadout, or the null pubkey when none is set. */
function heroOf(loadout: { arenaHero: PublicKey } | null): PublicKey {
  if (loadout && !isNullPubkey(loadout.arenaHero)) return loadout.arenaHero;
  return PublicKey.default;
}

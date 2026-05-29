import "server-only";
import type { PublicKey } from "@solana/web3.js";
import {
  ARENA_MAX_BATTLES_PER_OPPONENT,
  ARENA_MAX_DAILY_BATTLES,
  SECONDS_PER_DAY,
  derivePlayerPda,
  parsePlayer,
} from "novus-mundus-sdk";
import { serverClient, serverConnection } from "./game-authority";

export interface MatchResult {
  defenderWallet: PublicKey;
  defenderElo: number;
  matchId: number;
  matchTimestamp: number;
}

/** Resolve a participant player-PDA to its owner wallet, or null. */
async function resolveWallet(playerPda: PublicKey): Promise<PublicKey | null> {
  const info = await serverConnection().getAccountInfo(playerPda);
  if (!info) return null;
  return parsePlayer(info)?.owner ?? null;
}

/**
 * Deterministic ELO matchmaker.
 *
 * Picks the eligible opponent whose ELO is closest to the challenger's (ties
 * broken by pubkey), so a retried request yields the same match — no
 * match-shopping. Enforces the on-chain caps (rolling-24h battle limit and
 * per-opponent cooldown) before issuing a match, and resolves the chosen
 * opponent's player PDA to a wallet address (challenge_player needs the
 * defender's wallet).
 */
export async function findMatch(
  seasonId: number,
  challengerWallet: PublicKey,
): Promise<MatchResult> {
  const client = serverClient();
  const gameEngine = client.gameEngine;
  const now = Math.floor(Date.now() / 1000);

  const challengerPlayer = derivePlayerPda(gameEngine, challengerWallet)[0];
  const challengerPlayerKey = challengerPlayer.toBase58();

  const participants = await client.fetchArenaParticipants(seasonId);
  const challengerEntry = participants.find(
    (p) => p.account.player.toBase58() === challengerPlayerKey,
  );
  if (!challengerEntry) {
    throw new Error("You have not joined this arena season");
  }
  const challenger = challengerEntry.account;

  // Rolling-24h battle cap.
  const recentBattles = challenger.battleTimestamps.filter(
    (t) => now - t.toNumber() < SECONDS_PER_DAY,
  ).length;
  if (recentBattles >= ARENA_MAX_DAILY_BATTLES) {
    throw new Error("Daily battle limit reached — try again later");
  }

  // Per-opponent battle counts within the last 24h (opponents are player PDAs).
  const opponentCounts = new Map<string, number>();
  challenger.battleOpponents.forEach((opponent, i) => {
    const ts = challenger.battleTimestamps[i]?.toNumber() ?? 0;
    if (now - ts < SECONDS_PER_DAY) {
      const key = opponent.toBase58();
      opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1);
    }
  });

  // Eligible = not self, under the per-opponent cap — ordered closest ELO
  // first with a deterministic pubkey tie-break.
  const eligible = participants
    .filter((p) => {
      const pda = p.account.player.toBase58();
      if (pda === challengerPlayerKey) return false;
      return (opponentCounts.get(pda) ?? 0) < ARENA_MAX_BATTLES_PER_OPPONENT;
    })
    .sort((a, b) => {
      const da = Math.abs(a.account.eloRating - challenger.eloRating);
      const db = Math.abs(b.account.eloRating - challenger.eloRating);
      if (da !== db) return da - db;
      return a.account.player.toBase58().localeCompare(b.account.player.toBase58());
    });

  // Resolve wallets in closest-ELO order and take the first that resolves, so
  // the common case costs a single account fetch instead of the whole season.
  for (const candidate of eligible) {
    const wallet = await resolveWallet(candidate.account.player);
    if (wallet) {
      return {
        defenderWallet: wallet,
        defenderElo: candidate.account.eloRating,
        matchId: challenger.lastMatchId.toNumber() + 1,
        matchTimestamp: now,
      };
    }
  }
  throw new Error("No eligible opponents are available right now");
}

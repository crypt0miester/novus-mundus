import "server-only";
import type { AccountInfo } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { derivePlayerPda, parsePlayer } from "novus-mundus-sdk";
import { serverClient, serverConnection } from "./game-authority";

const SECONDS_PER_DAY = 86_400;
const MAX_DAILY_BATTLES = 10;
const MAX_BATTLES_PER_OPPONENT = 2;
const ACCOUNTS_PER_FETCH = 100; // getMultipleAccountsInfo per-call cap

export interface MatchResult {
  defenderWallet: PublicKey;
  defenderElo: number;
  matchId: number;
  matchTimestamp: number;
}

/** Resolve participant player-PDAs to their owner wallets in bounded batches. */
async function resolveWallets(
  playerPdas: PublicKey[],
): Promise<Map<string, PublicKey>> {
  const conn = serverConnection();
  const pdaToWallet = new Map<string, PublicKey>();
  for (let i = 0; i < playerPdas.length; i += ACCOUNTS_PER_FETCH) {
    const slice = playerPdas.slice(i, i + ACCOUNTS_PER_FETCH);
    const infos = await conn.getMultipleAccountsInfo(slice);
    slice.forEach((pda, j) => {
      const info = infos[j];
      if (!info) return;
      const player = parsePlayer(info as AccountInfo<Buffer>);
      if (player) pdaToWallet.set(pda.toBase58(), player.owner);
    });
  }
  return pdaToWallet;
}

/**
 * Deterministic ELO matchmaker.
 *
 * Picks the eligible opponent whose ELO is closest to the challenger's (ties
 * broken by pubkey), so a retried request yields the same match — no
 * match-shopping. Enforces the on-chain caps (rolling-24h battle limit and
 * per-opponent cooldown) before issuing a match, and resolves opponent player
 * PDAs to wallet addresses (challenge_player needs the defender's wallet).
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
  if (recentBattles >= MAX_DAILY_BATTLES) {
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

  // Resolve only the season's participant player-PDAs to owner wallets.
  const pdaToWallet = await resolveWallets(
    participants.map((p) => p.account.player),
  );

  const candidates = participants.filter((p) => {
    const pda = p.account.player.toBase58();
    if (pda === challengerPlayerKey) return false; // not self
    if ((opponentCounts.get(pda) ?? 0) >= MAX_BATTLES_PER_OPPONENT) return false;
    return pdaToWallet.has(pda); // wallet must be resolvable
  });
  if (candidates.length === 0) {
    throw new Error("No eligible opponents are available right now");
  }

  // Closest ELO; deterministic tie-break by pubkey.
  candidates.sort((a, b) => {
    const da = Math.abs(a.account.eloRating - challenger.eloRating);
    const db = Math.abs(b.account.eloRating - challenger.eloRating);
    if (da !== db) return da - db;
    return a.account.player.toBase58().localeCompare(b.account.player.toBase58());
  });

  const defender = candidates[0]!;
  return {
    defenderWallet: pdaToWallet.get(defender.account.player.toBase58())!,
    defenderElo: defender.account.eloRating,
    matchId: challenger.lastMatchId.toNumber() + 1,
    matchTimestamp: now,
  };
}

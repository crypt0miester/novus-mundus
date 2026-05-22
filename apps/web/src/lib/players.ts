import { calculateDefensivePower } from "novus-mundus-sdk";
import type { PlayerAccount } from "novus-mundus-sdk";

/**
 * True if a player matches a free-text search query — a case-insensitive
 * substring match against the display name, the resolved domain name, or the
 * wallet address. An empty query matches everything. Shared by the players
 * directory and the team invite picker.
 */
export function matchesPlayerQuery(
  player: PlayerAccount,
  ownerAddress: string,
  domain: string | null | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (player.name && player.name.toLowerCase().includes(q)) return true;
  if (domain && domain.toLowerCase().includes(q)) return true;
  return ownerAddress.toLowerCase().includes(q);
}

/** Player metrics the directory and leaderboard sort by. */
export type PlayerSortKey =
  | "networth"
  | "level"
  | "combat"
  | "reputation"
  | "newest"
  | "attacks"
  | "encounters";

/** A player's score for a sort key — higher ranks first. */
export function playerScore(player: PlayerAccount, key: PlayerSortKey): number {
  switch (key) {
    case "networth":
      return player.networth.toNumber();
    case "level":
      return player.level;
    case "combat":
      return calculateDefensivePower(
        player.defensiveUnit1.toNumber(),
        player.defensiveUnit2.toNumber(),
        player.defensiveUnit3.toNumber(),
      );
    case "reputation":
      return player.reputation.toNumber();
    case "newest":
      return player.createdAt.toNumber();
    case "attacks":
      return player.totalAttacks.toNumber();
    case "encounters":
      return player.totalEncounterAttacks.toNumber();
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

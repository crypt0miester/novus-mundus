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
  if (player.name?.toLowerCase().includes(q)) return true;
  if (domain?.toLowerCase().includes(q)) return true;
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
      return Number(player.networth);
    case "level":
      return player.level;
    case "combat":
      return calculateDefensivePower(
        Number(player.defensiveUnit1),
        Number(player.defensiveUnit2),
        Number(player.defensiveUnit3),
      );
    case "reputation":
      return Number(player.reputation);
    case "newest":
      return Number(player.createdAt);
    case "attacks":
      return Number(player.totalAttacks);
    case "encounters":
      return Number(player.totalEncounterAttacks);
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

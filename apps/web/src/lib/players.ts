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

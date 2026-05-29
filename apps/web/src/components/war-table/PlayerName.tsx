"use client";

// Renders a player's display identity from their PlayerAccount PDA, matching the
// app convention used by StatusBar: a registered domain name first, then the
// player's in-game name, then a shortened address as a last resort. The bare
// DomainName component falls straight from "no domain" to the shortened pubkey,
// which is why message senders showed a raw address instead of their name.

import { useDomainName } from "@/lib/hooks/useDomainName";
import { useAccountStore } from "@/lib/store/accounts";
import { shortenAddress } from "@/lib/utils";

interface PlayerNameProps {
  // base58 PlayerAccount PDA; may be null while the chain client warms up.
  playerPda: string | null;
  // base58 key shortened only when nothing else resolves (e.g. the sender wallet).
  fallbackKey?: string;
  className?: string;
}

export function PlayerName({ playerPda, fallbackKey, className }: PlayerNameProps) {
  // Domains resolve by the key passed; the app keys player domains on the PDA.
  const domain = useDomainName(playerPda);

  // The in-game name comes from whichever store holds this player: the directory
  // of other players, or the connected player when the sender is the viewer.
  const name = useAccountStore((s) => {
    if (!playerPda) return null;
    const other = s.otherPlayers.get(playerPda);
    if (other) return other.account.name;
    if (s.player && s.player.pubkey.toBase58() === playerPda) return s.player.account.name;
    return null;
  });

  const trimmed = name?.trim();
  const label =
    domain ||
    (trimmed && trimmed.length > 0 ? trimmed : null) ||
    shortenAddress(playerPda ?? fallbackKey ?? "", 4);

  const title = playerPda ?? fallbackKey ?? undefined;
  return (
    <span className={className} title={title}>
      {label}
    </span>
  );
}

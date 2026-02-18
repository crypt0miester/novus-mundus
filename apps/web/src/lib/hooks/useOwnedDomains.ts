"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { getOwnedDomains } from "@/lib/domains";

/**
 * Fetch all domains owned by a wallet via @onsol/tldparser.
 * Returns { nameAccount, domain }[] sorted alphabetically.
 *
 * Use on the settings page to let users pick a domain for their name.
 */
export function useOwnedDomains(owner: PublicKey | string | null | undefined) {
  const { connection } = useConnection();
  const key = owner
    ? typeof owner === "string"
      ? owner
      : owner.toBase58()
    : null;

  return useQuery({
    queryKey: ["owned-domains", key],
    queryFn: () => getOwnedDomains(connection, owner!),
    enabled: !!owner,
    staleTime: 60_000, // 1 min — user might just buy a domain
    gcTime: 5 * 60_000,
  });
}

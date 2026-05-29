"use client";

import { useEffect, useMemo } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useDomainStore } from "@/lib/store/domains";

/**
 * Batch-resolve wallets to domain names.
 * Uses getMultipleAccountsInfo via @onsol/tldparser under the hood.
 * Reads from zustand domain cache; batch-fetches any missing keys.
 *
 * Use for leaderboards, garrison lists, team rosters, combat logs.
 */
export function useDomainNames(owners: (PublicKey | string)[] | null | undefined) {
  const { connection } = useConnection();
  const resolveBatch = useDomainStore((s) => s.resolveBatch);
  const names = useDomainStore((s) => s.names);

  const keys = useMemo(
    () => (owners ?? []).map((o) => (typeof o === "string" ? o : o.toBase58())),
    [owners],
  );

  useEffect(() => {
    if (keys.length > 0) resolveBatch(connection, keys);
  }, [keys, connection, resolveBatch]);

  // Return a lookup function so callers don't subscribe to the whole map
  return useMemo(() => {
    const result = new Map<string, string | null>();
    for (const k of keys) {
      const v = names.get(k);
      if (v !== undefined) result.set(k, v);
    }
    return result;
  }, [keys, names]);
}

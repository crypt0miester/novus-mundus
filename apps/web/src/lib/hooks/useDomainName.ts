"use client";

import { useEffect } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useDomainStore } from "@/lib/store/domains";

/**
 * Resolve a single wallet to domain name.
 * Reads from the zustand domain cache; triggers a lazy fetch if missing.
 *
 * For lists, use useDomainNames() to batch-resolve.
 */
export function useDomainName(owner: PublicKey | string | null | undefined) {
  const { connection } = useConnection();
  const key = owner ? (typeof owner === "string" ? owner : owner.toBase58()) : null;

  const name = useDomainStore((s) => (key ? s.names.get(key) : undefined));
  const resolve = useDomainStore((s) => s.resolve);

  useEffect(() => {
    if (key) resolve(connection, key);
  }, [key, connection, resolve]);

  return name;
}

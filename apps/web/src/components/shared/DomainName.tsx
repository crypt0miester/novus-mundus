"use client";

import type { PublicKey } from "@solana/web3.js";
import { useDomainName } from "@/lib/hooks/useDomainName";
import { shortenAddress } from "@/lib/utils";

interface DomainNameProps {
  pubkey: PublicKey | string | null | undefined;
  className?: string;
  chars?: number;
}

/**
 * Renders a domain name for a wallet, falling back to shortened address.
 * Reads from the zustand domain cache; lazy-resolves on mount.
 *
 * For lists, prefer useDomainNames() batch hook + inline rendering.
 */
export function DomainName({ pubkey, className, chars = 4 }: DomainNameProps) {
  const base58 = pubkey ? (typeof pubkey === "string" ? pubkey : pubkey.toBase58()) : null;

  const domain = useDomainName(pubkey);

  if (!base58) return null;

  return (
    <span className={className} title={base58}>
      {domain ?? shortenAddress(base58, chars)}
    </span>
  );
}

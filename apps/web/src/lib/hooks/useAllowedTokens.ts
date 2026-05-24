"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useAccountStore } from "@/lib/store/accounts";

/**
 * Whitelisted payment token, enriched with what the UI needs to render +
 * convert prices: mint, peg/oracle status, decimals, and a display symbol.
 *
 * Decimals don't live on `AllowedTokenAccount` (the chain reads them from
 * the SPL Mint at runtime), so we fetch them lazily and cache per mint.
 */
export interface AllowedToken {
  /** SPL mint address. */
  mint: PublicKey;
  /** True iff `AllowedTokenAccount.pegged_to_usd = 1`. Skips the oracle. */
  pegged: boolean;
  /** Display symbol (e.g. "USDC"). Falls back to a shortened mint. */
  symbol: string;
  /** SPL mint decimals (e.g. 6 for USDC). */
  decimals: number;
  /** Per-token shop discount in basis points (0 if none). */
  discountBps: number;
}

/** Curated registry — mainnet stablecoins get friendly labels with no RPC. */
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  // PayPal USD
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { symbol: "PYUSD", decimals: 6 },
};

function shortMint(s: string): string {
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Lists all whitelisted payment tokens, enriched with display symbol +
 * decimals. Pulls from the live `accountStore.allowedTokens` (already
 * subscription-fed) and resolves any unknown mints' decimals lazily via
 * a single `getMultipleAccountsInfo` RPC.
 */
export function useAllowedTokens(): {
  data: AllowedToken[];
  loading: boolean;
} {
  const tokens = useAccountStore((s) => s.allowedTokens);
  const { connection } = useConnection();

  // Decimals cache keyed by mint base58. Survives token-store churn.
  const [decimalsByMint, setDecimalsByMint] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  // Mint strings that we still need to resolve.
  const unresolvedMints = useMemo(() => {
    const out: string[] = [];
    for (const e of tokens.values()) {
      const s = e.account.mint.toString();
      if (KNOWN_TOKENS[s] || decimalsByMint[s] !== undefined) continue;
      out.push(s);
    }
    return out;
  }, [tokens, decimalsByMint]);

  // Batch-fetch decimals for any mints we haven't seen yet. SPL Mint layout
  // is fixed; decimals live at byte offset 44.
  useEffect(() => {
    if (unresolvedMints.length === 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const pubkeys = unresolvedMints.map((s) => new PublicKey(s));
        const infos = await connection.getMultipleAccountsInfo(pubkeys);
        if (cancelled) return;
        const next: Record<string, number> = {};
        infos.forEach((info, i) => {
          if (info && info.data.length >= 45) {
            next[pubkeys[i].toString()] = info.data[44];
          }
        });
        if (Object.keys(next).length > 0) {
          setDecimalsByMint((prev) => ({ ...prev, ...next }));
        }
      } catch {
        // Network blip — leave the cache alone; the hook will retry on the
        // next subscription tick.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `unresolvedMints.join` so React doesn't refetch when an unrelated key
    // in `decimalsByMint` mutates the array identity.
  }, [connection, unresolvedMints.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo<AllowedToken[]>(() => {
    const arr: AllowedToken[] = [];
    for (const e of tokens.values()) {
      const mintStr = e.account.mint.toString();
      const known = KNOWN_TOKENS[mintStr];
      const decimals = known?.decimals ?? decimalsByMint[mintStr];
      if (decimals === undefined) continue; // wait for decimals to land
      arr.push({
        mint: e.account.mint,
        pegged: e.account.peggedToUsd,
        symbol: known?.symbol ?? shortMint(mintStr),
        decimals,
        discountBps: e.account.discountBps,
      });
    }
    // Pegged stablecoins first (most users pay in USDC/USDT), then alphabetical.
    return arr.sort((a, b) => {
      if (a.pegged !== b.pegged) return a.pegged ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [tokens, decimalsByMint]);

  return { data, loading };
}

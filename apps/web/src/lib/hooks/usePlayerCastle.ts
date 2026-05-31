"use client";

import { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { deriveKingRegistryPda, parseKingRegistry } from "novus-mundus-sdk";
import { useAccountStore } from "@/lib/store/accounts";

export interface PlayerCastleState {
  /** True once the player holds a castle — the Act V signal (§5). */
  ownsCastle: boolean;
  /** The held castle's pubkey, when one is held. */
  castle: PublicKey | null;
  loading: boolean;
}

/**
 * Whether the player holds a castle. Reads the `KingRegistry` PDA — one account
 * per king wallet — so a single account fetch answers it; its existence is the
 * crown.
 */
export function usePlayerCastle(): PlayerCastleState {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const setMyCastlePda = useAccountStore((s) => s.setMyCastlePda);
  const [state, setState] = useState<PlayerCastleState>({
    ownsCastle: false,
    castle: null,
    loading: true,
  });

  useEffect(() => {
    if (!publicKey) {
      setState({ ownsCastle: false, castle: null, loading: false });
      setMyCastlePda(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [pda] = await deriveKingRegistryPda(publicKey);
        const info = await connection.getAccountInfo(pda);
        if (cancelled) return;
        const registry = info ? parseKingRegistry(info) : null;
        const castle = registry?.castle ?? null;
        setState({ ownsCastle: !!registry, castle, loading: false });
        // Surface the held castle to the store so the WS can route rallies
        // aimed at it into incomingRallies (the Cairn's castle-attack warning).
        setMyCastlePda(castle ? castle.toBase58() : null);
      } catch {
        if (!cancelled) setState({ ownsCastle: false, castle: null, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, connection, setMyCastlePda]);

  return state;
}

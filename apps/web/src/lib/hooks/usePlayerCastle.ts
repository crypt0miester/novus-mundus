"use client";

import { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { deriveKingRegistryPda, parseKingRegistry } from "novus-mundus-sdk";

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
  const [state, setState] = useState<PlayerCastleState>({
    ownsCastle: false,
    castle: null,
    loading: true,
  });

  useEffect(() => {
    if (!publicKey) {
      setState({ ownsCastle: false, castle: null, loading: false });
      return;
    }
    let cancelled = false;
    const [pda] = deriveKingRegistryPda(publicKey);
    connection
      .getAccountInfo(pda)
      .then((info) => {
        if (cancelled) return;
        const registry = info ? parseKingRegistry(info) : null;
        setState({
          ownsCastle: !!registry,
          castle: registry?.castle ?? null,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ ownsCastle: false, castle: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey, connection]);

  return state;
}

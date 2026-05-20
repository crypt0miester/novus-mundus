"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSyncForPda } from "novus-mundus-sdk";
import { usePlayer } from "./usePlayer";
import { useGameEngine } from "./useGameEngine";

/**
 * Reads the player's NOVI Associated Token Account balance — the real spendable
 * amount that hire/build/burn instructions debit from on-chain. Distinct from
 * `player.lockedNovi`, which is game-state accounting on the PlayerAccount PDA
 * itself. Both should match; when they don't, the ATA balance is the truth
 * because that's what burns are deducted from.
 *
 * NOTE: the NOVI ATA is owned by the PlayerAccount PDA (not the wallet) — see
 * `getAssociatedTokenAddressSyncForPda`.
 *
 * Returns raw (pre-decimal) units. NOVI has 1 decimal — divide by 10 to display.
 */
export function useNoviBalance(): {
  raw: number;
  loading: boolean;
  ataExists: boolean;
} {
  const { connection } = useConnection();
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();

  const playerPda = playerData?.pubkey;
  const noviMint = geData?.account?.noviMint;
  const [raw, setRaw] = useState(0);
  const [loading, setLoading] = useState(false);
  const [ataExists, setAtaExists] = useState(false);

  useEffect(() => {
    if (!playerPda || !noviMint) {
      setRaw(0);
      setAtaExists(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const ata = getAssociatedTokenAddressSyncForPda(noviMint, playerPda);
        const info = await connection.getTokenAccountBalance(ata);
        if (cancelled) return;
        setRaw(Number(info.value.amount));
        setAtaExists(true);
      } catch {
        // ATA doesn't exist or RPC failure — treat as zero balance.
        if (!cancelled) {
          setRaw(0);
          setAtaExists(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, playerPda, noviMint]);

  return { raw, loading, ataExists };
}

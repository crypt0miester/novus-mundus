"use client";

import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { derivePlayerPda } from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";

// The connected wallet's own PlayerAccount PDA, or null when no wallet is
// connected. On-chain, ownership-keyed fields store the PLAYER PDA, not the
// wallet (castle.king = player_account.address(), team membership, treasury
// requests, reinforcement sender/destination), so identity checks must compare
// against this PDA. Derivation is async under the web3.js v3 seam, hence the
// effect + state rather than a plain memo.
export function usePlayerPda(): PublicKey | null {
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const [playerPda, setPlayerPda] = useState<PublicKey | null>(null);
  useEffect(() => {
    if (!publicKey) {
      setPlayerPda(null);
      return;
    }
    let cancelled = false;
    derivePlayerPda(client.gameEngine, publicKey).then(([pda]) => {
      if (!cancelled) setPlayerPda(pda);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, client.gameEngine]);
  return playerPda;
}

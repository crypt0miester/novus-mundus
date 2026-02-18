"use client";

import { useEffect, useMemo } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "./usePlayer";

export function useLoot() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const loot = useAccountStore((s) => s.loot);
  const loading = useAccountStore((s) => s.loading);
  const client = useNovusMundusClient();

  // On-demand fetch: seed zustand with player's unclaimed loot
  useEffect(() => {
    if (!publicKey || !playerData?.exists) return;

    client.fetchPlayerLoot(playerData.pubkey, { unclaimedOnly: true }).then((results) => {
      const store = useAccountStore.getState();
      for (const r of results) {
        if (r.account) store.upsertLoot(r.pubkey, r.account);
      }
    }).catch(() => {});
  }, [publicKey, playerData?.pubkey?.toBase58(), client]);

  const data = useMemo(() => Array.from(loot.values()), [loot]);

  return {
    data,
    isLoading: loading && loot.size === 0,
    isSuccess: !loading,
  };
}

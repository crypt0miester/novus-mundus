"use client";

import { useEffect, useState } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "./usePlayer";

export function useExpedition() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const entry = useAccountStore((s) => s.expedition);
  const loading = useAccountStore((s) => s.loading);
  const client = useNovusMundusClient();
  const [fetchDone, setFetchDone] = useState(false);

  // On-demand fetch: seed zustand with player's expedition
  useEffect(() => {
    if (!publicKey || !playerData?.exists) {
      setFetchDone(true);
      return;
    }

    setFetchDone(false);
    client.fetchExpedition(playerData.pubkey).then((result) => {
      if (result.account) {
        useAccountStore.getState().setExpedition(result.pubkey, result.account);
      }
    }).catch(() => {}).finally(() => setFetchDone(true));
  }, [publicKey, playerData?.pubkey?.toBase58(), client]);

  const data = entry
    ? { pubkey: entry.pubkey, account: entry.account, exists: true }
    : null;

  return {
    data,
    isLoading: !fetchDone && !entry,
    isSuccess: !!data || fetchDone,
  };
}

"use client";

import { useEffect, useState } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useConnection } from "@solana/wallet-adapter-react";
import { parseTeam } from "novus-mundus-sdk";
import type { PublicKey } from "@solana/web3.js";

export function useTeam(teamPubkey: PublicKey | null | undefined) {
  const entry = useAccountStore((s) => s.team);
  const loading = useAccountStore((s) => s.loading);
  const { connection } = useConnection();
  const [fetchDone, setFetchDone] = useState(false);

  // On-demand fetch: seed zustand when teamPubkey is set but data isn't loaded
  useEffect(() => {
    if (!teamPubkey) {
      setFetchDone(true);
      return;
    }
    // If we already have this team, skip
    if (entry && entry.pubkey.equals(teamPubkey)) {
      setFetchDone(true);
      return;
    }

    setFetchDone(false);
    connection.getAccountInfo(teamPubkey).then((info) => {
      if (info) {
        const account = parseTeam(info);
        if (account) useAccountStore.getState().setTeam(teamPubkey, account);
      }
    }).catch(() => {}).finally(() => setFetchDone(true));
  }, [teamPubkey?.toBase58(), connection, entry]);

  const data = entry && teamPubkey && entry.pubkey.equals(teamPubkey)
    ? { pubkey: entry.pubkey, account: entry.account, exists: true }
    : null;

  return {
    data,
    isLoading: !fetchDone && !entry,
    isSuccess: !!data || fetchDone,
  };
}

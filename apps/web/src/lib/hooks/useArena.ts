"use client";

import { useEffect } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";

export function useArenaSeason(seasonId: number | null | undefined) {
  const entry = useAccountStore((s) => s.arenaSeason);
  const loading = useAccountStore((s) => s.loading);
  const client = useNovusMundusClient();

  useEffect(() => {
    if (seasonId == null) return;

    client
      .fetchArenaSeason(seasonId)
      .then((result) => {
        if (result.account) {
          useAccountStore.getState().setArenaSeason(result.pubkey, result.account);
        }
      })
      .catch(() => {});
  }, [seasonId, client]);

  const seasonData = entry ? { pubkey: entry.pubkey, account: entry.account, exists: true } : null;

  return {
    data: seasonData,
    isLoading: loading && !entry,
    isSuccess: seasonData !== null,
  };
}

export function useArenaParticipant(seasonId: number | null | undefined) {
  const { publicKey } = useWallet();
  const entry = useAccountStore((s) => s.arenaParticipant);
  const loading = useAccountStore((s) => s.loading);
  const client = useNovusMundusClient();

  useEffect(() => {
    if (seasonId == null || !publicKey) return;

    client
      .fetchArenaParticipant(seasonId, publicKey)
      .then((result) => {
        if (result.account) {
          useAccountStore.getState().setArenaParticipant(result.pubkey, result.account);
        }
      })
      .catch(() => {});
  }, [seasonId, publicKey, client]);

  const participantData = entry
    ? { pubkey: entry.pubkey, account: entry.account, exists: true }
    : null;

  return {
    data: participantData,
    isLoading: loading && !entry,
    isSuccess: participantData !== null,
  };
}

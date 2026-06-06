"use client";

import { useEffect } from "react";
import { deriveArenaLoadoutPda, derivePlayerPda, parseArenaLoadout } from "novus-mundus-sdk";
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

// The player's arena loadout (per-player, not per-season). The client has no
// dedicated fetch helper, so we derive the PDA here and read it straight off the
// connection, mirroring how fetchArenaSeason resolves its account. The loadout
// account is created at join time, so it exists for any participant.
export function useArenaLoadout() {
  const { publicKey } = useWallet();
  const entry = useAccountStore((s) => s.arenaLoadout);
  const loading = useAccountStore((s) => s.loading);
  const client = useNovusMundusClient();

  useEffect(() => {
    if (!publicKey) return;

    let cancelled = false;
    (async () => {
      const ge = client.gameEngine;
      const [player] = await derivePlayerPda(ge, publicKey);
      const [loadoutPda] = await deriveArenaLoadoutPda(ge, player);
      const accountInfo = await client.connection.getAccountInfo(loadoutPda, client.commitment);
      if (!accountInfo) return;
      const account = parseArenaLoadout(accountInfo);
      if (!cancelled && account) {
        useAccountStore.getState().setArenaLoadout(loadoutPda, account);
      }
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [publicKey, client]);

  const loadoutData = entry ? { pubkey: entry.pubkey, account: entry.account, exists: true } : null;

  return {
    data: loadoutData,
    isLoading: loading && !entry,
    isSuccess: loadoutData !== null,
  };
}

"use client";

import { useEffect, useMemo } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";

/**
 * All players in the same city, excluding the current user.
 * Initial fetch seeds zustand. WS keeps it updated.
 */
export function useCityPlayers(cityId: number | undefined) {
  const otherPlayers = useAccountStore((s) => s.otherPlayers);
  const myPlayerPda = useAccountStore((s) => s.myPlayerPda);
  const loading = useAccountStore((s) => s.loading);
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();

  // Boot-time `startGameSubscriptions` seeds `otherPlayers` for the whole
  // kingdom in a single fetchAllPlayers, and the program-wide WS keeps it
  // live thereafter. Only fall back to a local refetch if the boot seed
  // hasn't populated the map yet (e.g. the user navigated here before the
  // boot Promise.all resolved, or a cold-start race).
  useEffect(() => {
    if (cityId === undefined || !publicKey) return;
    if (useAccountStore.getState().otherPlayers.size > 0) return;
    client.fetchAllPlayers().then((results) => {
      const store = useAccountStore.getState();
      for (const p of results) {
        if (p.pubkey.toBase58() !== store.myPlayerPda) {
          store.upsertOtherPlayer(p.pubkey, p.account);
        }
      }
    }).catch(() => {});
  }, [cityId, publicKey, client]);

  // Filter by city + exclude self
  const data = useMemo(() => {
    if (cityId === undefined) return [];
    return Array.from(otherPlayers.values()).filter(
      (p) => p.account.currentCity === cityId
    );
  }, [otherPlayers, cityId]);

  return {
    data,
    isLoading: loading && otherPlayers.size === 0,
    isSuccess: !loading,
  };
}

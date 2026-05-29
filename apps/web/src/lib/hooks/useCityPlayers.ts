"use client";

import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";

/**
 * All players in the same city, excluding the current user.
 * Initial fetch seeds zustand. WS keeps it updated.
 */
export function useCityPlayers(cityId: number | undefined) {
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
    client
      .fetchAllPlayers()
      .then((results) => {
        const store = useAccountStore.getState();
        for (const p of results) {
          if (p.pubkey.toBase58() !== store.myPlayerPda) {
            store.upsertOtherPlayer(p.pubkey, p.account);
          }
        }
      })
      .catch(() => {});
  }, [cityId, publicKey, client]);

  // Selector narrowing: the program-wide WS replaces the whole otherPlayers
  // Map on every player tick anywhere in the kingdom. Filtering by city
  // INSIDE the selector (under useShallow) means the subscribed value only
  // changes when this city's roster actually changes — an out-of-city tick
  // produces a shallow-equal array and skips the re-render entirely.
  const data = useAccountStore(
    useShallow((s) =>
      cityId === undefined
        ? []
        : Array.from(s.otherPlayers.values()).filter((p) => p.account.currentCity === cityId),
    ),
  );
  const playersEmpty = useAccountStore((s) => s.otherPlayers.size === 0);

  return {
    data,
    isLoading: loading && playersEmpty,
    isSuccess: !loading,
  };
}

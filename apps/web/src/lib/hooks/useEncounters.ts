"use client";

import { useEffect, useMemo } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";

export function useEncounters(cityId: number | null | undefined) {
  const encounters = useAccountStore((s) => s.encounters);
  const loading = useAccountStore((s) => s.loading);
  const client = useNovusMundusClient();

  // On-demand fetch: seed zustand with encounters for this city
  useEffect(() => {
    if (cityId == null) return;

    client
      .fetchEncountersInCity(cityId, { aliveOnly: true })
      .then((results) => {
        const store = useAccountStore.getState();
        for (const r of results) {
          if (r.account) store.upsertEncounter(r.pubkey, r.account);
        }
      })
      .catch(() => {});
  }, [cityId, client]);

  // Filter encounters for this city — exclude dead/despawned
  const data = useMemo(() => {
    if (cityId == null) return [];
    const now = Math.floor(Date.now() / 1000);
    return Array.from(encounters.values()).filter(
      (e) =>
        e.account.cityId === cityId &&
        e.account.health > 0n &&
        Number(e.account.despawnAt) > now,
    );
  }, [encounters, cityId]);

  return {
    data,
    isLoading: loading && encounters.size === 0,
    isSuccess: !loading,
  };
}

"use client";

import { useMemo } from "react";
import { useAccountStore } from "@/lib/store/accounts";

export function useCity(cityId: number | null | undefined) {
  const cities = useAccountStore((s) => s.cities);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  // Find the city with matching cityId from the Map
  const data = useMemo(() => {
    if (cityId == null) return null;
    for (const entry of cities.values()) {
      if (entry.account.cityId === cityId) {
        return { pubkey: entry.pubkey, account: entry.account, exists: true };
      }
    }
    return null;
  }, [cities, cityId]);

  return {
    data,
    isLoading: !active || loading,
    isSuccess: !!data || (active && !loading),
  };
}

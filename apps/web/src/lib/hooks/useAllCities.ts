"use client";

import { useMemo } from "react";
import { useAccountStore } from "@/lib/store/accounts";

/**
 * All cities from zustand, sorted by cityId ascending.
 * Initial fetch handled by SubscriptionBridge. WS keeps them updated.
 */
export function useAllCities() {
  const cities = useAccountStore((s) => s.cities);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const data = useMemo(
    () => Array.from(cities.values()).sort((a, b) => a.account.cityId - b.account.cityId),
    [cities],
  );

  return {
    data,
    isLoading: !active || loading,
    isSuccess: cities.size > 0 || (active && !loading),
  };
}

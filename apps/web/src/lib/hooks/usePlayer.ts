"use client";

import { useAccountStore } from "@/lib/store/accounts";

/**
 * Read player data from zustand.
 * Initial fetch is handled by SubscriptionBridge.
 * WS keeps it updated.
 */
export function usePlayer() {
  const entry = useAccountStore((s) => s.player);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const data = entry ? { pubkey: entry.pubkey, account: entry.account, exists: true } : null;

  return {
    data,
    isLoading: !active || loading,
    isSuccess: !!entry || (active && !loading),
  };
}

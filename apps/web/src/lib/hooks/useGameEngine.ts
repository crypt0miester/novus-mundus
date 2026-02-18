"use client";

import { useAccountStore } from "@/lib/store/accounts";

export function useGameEngine() {
  const entry = useAccountStore((s) => s.gameEngine);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const data = entry
    ? { pubkey: entry.pubkey, account: entry.account, exists: true }
    : null;

  return {
    data,
    isLoading: !active || loading,
    isSuccess: !!entry || (active && !loading),
  };
}

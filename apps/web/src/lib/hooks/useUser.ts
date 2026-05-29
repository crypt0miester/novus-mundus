"use client";

import { useAccountStore } from "@/lib/store/accounts";

export function useUser() {
  const entry = useAccountStore((s) => s.user);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const data = entry ? { pubkey: entry.pubkey, account: entry.account, exists: true } : null;

  return {
    data,
    isLoading: !active || loading,
    isSuccess: !!entry || (active && !loading),
  };
}

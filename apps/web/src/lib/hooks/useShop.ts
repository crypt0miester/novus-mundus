"use client";

import { useMemo } from "react";
import { useAccountStore } from "@/lib/store/accounts";

export function useShopConfig() {
  const entry = useAccountStore((s) => s.shopConfig);
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

export function useShopItems() {
  const shopItems = useAccountStore((s) => s.shopItems);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const data = useMemo(
    () =>
      Array.from(shopItems.values()).sort(
        (a, b) => a.account.itemType - b.account.itemType
      ),
    [shopItems]
  );

  return {
    data,
    isLoading: !active || loading,
    isSuccess: shopItems.size > 0 || (active && !loading),
  };
}

export function useBundles() {
  const bundles = useAccountStore((s) => s.bundles);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const data = useMemo(
    () =>
      Array.from(bundles.values()).sort(
        (a, b) => a.account.tier - b.account.tier
      ),
    [bundles]
  );

  return {
    data,
    isLoading: !active || loading,
    isSuccess: bundles.size > 0 || (active && !loading),
  };
}

export function useFlashSales() {
  const flashSales = useAccountStore((s) => s.flashSales);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const data = useMemo(
    () => Array.from(flashSales.values()),
    [flashSales]
  );

  return {
    data,
    isLoading: !active || loading,
    isSuccess: flashSales.size > 0 || (active && !loading),
  };
}

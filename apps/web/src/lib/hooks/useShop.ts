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

export function useDailyDeals() {
  const dailyDeals = useAccountStore((s) => s.dailyDeals);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const data = useMemo(
    () => Array.from(dailyDeals.values()).sort((a, b) => a.slot - b.slot),
    [dailyDeals]
  );

  return {
    data,
    isLoading: !active || loading,
    isSuccess: dailyDeals.size > 0 || (active && !loading),
  };
}

export function useWeeklySale() {
  const entry = useAccountStore((s) => s.weeklySale);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  return {
    data: entry ? { pubkey: entry.pubkey, account: entry.account } : null,
    isLoading: !active || loading,
    isSuccess: !!entry || (active && !loading),
  };
}

export function useSeasonalSale() {
  const entry = useAccountStore((s) => s.seasonalSale);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  return {
    data: entry ? { pubkey: entry.pubkey, account: entry.account } : null,
    isLoading: !active || loading,
    isSuccess: !!entry || (active && !loading),
  };
}

export function useDaoPromotions() {
  const daoPromotions = useAccountStore((s) => s.daoPromotions);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const data = useMemo(
    () => Array.from(daoPromotions.values()),
    [daoPromotions]
  );

  return {
    data,
    isLoading: !active || loading,
    isSuccess: daoPromotions.size > 0 || (active && !loading),
  };
}

/** The current player's purchase record for a given item, or null if none. */
export function usePlayerPurchase(itemId: number | null) {
  const playerPurchases = useAccountStore((s) => s.playerPurchases);
  return useMemo(() => {
    if (itemId == null) return null;
    for (const e of playerPurchases.values()) {
      if (e.itemId === itemId) return e.account;
    }
    return null;
  }, [playerPurchases, itemId]);
}

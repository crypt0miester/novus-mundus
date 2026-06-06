"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { isWeeklySaleActive, isSeasonalSaleActive } from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";

/**
 * Shop catalog hooks - dual-mode, mirroring `lib/hooks/world/*`.
 *
 * Path A (wallet connected): the zustand `useAccountStore` is seeded by
 * `startGameSubscriptions` and kept live by the program-wide WS, so we read
 * the catalog straight from the store.
 *
 * Path B (spectator, no wallet): the store is never seeded, so each hook falls
 * back to an `enabled: !subscriptionActive` react-query that fetches the same
 * data directly off the RPC `Connection` via the SDK client. The fetch methods
 * already attach the PDA-derived ids (`itemId` / `bundleId` / `saleId` / `slot`)
 * the views read, so the fallback array elements are shape-compatible with the
 * store entries - no consumer change needed.
 *
 * `subscriptionActive` (not just "store empty") is the gate: a connected wallet
 * whose store is momentarily empty mid-boot must NOT trigger the unbounded scan;
 * only a true spectator (no active subscription) does.
 */

// The catalog is global and changes slowly; a spectator only needs a snapshot.
const SHOP_STALE_MS = 60_000;

/**
 * Game engine for the shop surface - dual-mode like the catalog hooks above.
 *
 * The NOVI package prices and the Game-Parameters panel read off
 * `gameEngine.noviPurchaseConfig`, so a spectator needs the engine too. The
 * store-backed `useGameEngine` only seeds with a wallet; this falls back to an
 * RPC fetch when there is no active subscription. Same `{ pubkey, account,
 * exists }` shape either way, so callers swap in with no other change.
 */
export function useShopGameEngine() {
  const client = useNovusMundusClient();
  const entry = useAccountStore((s) => s.gameEngine);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const query = useQuery({
    queryKey: ["world", "shop", "gameEngine"],
    queryFn: () => client.fetchGameEngine(),
    staleTime: SHOP_STALE_MS,
    enabled: !active,
  });

  if (!active) {
    const r = query.data;
    return {
      data: r?.account ? { pubkey: r.pubkey, account: r.account, exists: true } : null,
      isLoading: query.isLoading,
      isSuccess: query.isSuccess,
    };
  }

  const data = entry ? { pubkey: entry.pubkey, account: entry.account, exists: true } : null;
  return {
    data,
    isLoading: !active || loading,
    isSuccess: !!entry || (active && !loading),
  };
}

export function useShopConfig() {
  const client = useNovusMundusClient();
  const entry = useAccountStore((s) => s.shopConfig);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const query = useQuery({
    queryKey: ["world", "shop", "config"],
    queryFn: () => client.fetchShopConfig(),
    staleTime: SHOP_STALE_MS,
    enabled: !active,
  });

  if (!active) {
    const r = query.data;
    return {
      data: r?.account ? { pubkey: r.pubkey, account: r.account, exists: true } : null,
      isLoading: query.isLoading,
      isSuccess: query.isSuccess,
    };
  }

  const data = entry ? { pubkey: entry.pubkey, account: entry.account, exists: true } : null;
  return {
    data,
    isLoading: !active || loading,
    isSuccess: !!entry || (active && !loading),
  };
}

export function useShopItems() {
  const client = useNovusMundusClient();
  const shopItems = useAccountStore((s) => s.shopItems);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const query = useQuery({
    queryKey: ["world", "shop", "items"],
    queryFn: () => client.fetchAllShopItems(),
    staleTime: SHOP_STALE_MS,
    enabled: !active,
  });

  const storeData = useMemo(
    () => Array.from(shopItems.values()).sort((a, b) => a.account.itemType - b.account.itemType),
    [shopItems],
  );
  const fallbackData = useMemo(
    () => (query.data ?? []).slice().sort((a, b) => a.account.itemType - b.account.itemType),
    [query.data],
  );

  if (!active) {
    return { data: fallbackData, isLoading: query.isLoading, isSuccess: query.isSuccess };
  }
  return {
    data: storeData,
    isLoading: !active || loading,
    isSuccess: shopItems.size > 0 || (active && !loading),
  };
}

export function useBundles() {
  const client = useNovusMundusClient();
  const bundles = useAccountStore((s) => s.bundles);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const query = useQuery({
    queryKey: ["world", "shop", "bundles"],
    queryFn: () => client.fetchAllBundles(),
    staleTime: SHOP_STALE_MS,
    enabled: !active,
  });

  const storeData = useMemo(
    () => Array.from(bundles.values()).sort((a, b) => a.account.tier - b.account.tier),
    [bundles],
  );
  const fallbackData = useMemo(
    () => (query.data ?? []).slice().sort((a, b) => a.account.tier - b.account.tier),
    [query.data],
  );

  if (!active) {
    return { data: fallbackData, isLoading: query.isLoading, isSuccess: query.isSuccess };
  }
  return {
    data: storeData,
    isLoading: !active || loading,
    isSuccess: bundles.size > 0 || (active && !loading),
  };
}

export function useFlashSales() {
  const client = useNovusMundusClient();
  const flashSales = useAccountStore((s) => s.flashSales);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const query = useQuery({
    queryKey: ["world", "shop", "flashSales"],
    queryFn: () => client.fetchAllFlashSales(),
    staleTime: SHOP_STALE_MS,
    enabled: !active,
  });

  const storeData = useMemo(() => Array.from(flashSales.values()), [flashSales]);
  const fallbackData = useMemo(() => query.data ?? [], [query.data]);

  if (!active) {
    return { data: fallbackData, isLoading: query.isLoading, isSuccess: query.isSuccess };
  }
  return {
    data: storeData,
    isLoading: !active || loading,
    isSuccess: flashSales.size > 0 || (active && !loading),
  };
}

export function useDailyDeals() {
  const client = useNovusMundusClient();
  const dailyDeals = useAccountStore((s) => s.dailyDeals);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const query = useQuery({
    queryKey: ["world", "shop", "dailyDeals"],
    queryFn: () => client.fetchAllDailyDeals(),
    staleTime: SHOP_STALE_MS,
    enabled: !active,
  });

  const storeData = useMemo(
    () => Array.from(dailyDeals.values()).sort((a, b) => a.slot - b.slot),
    [dailyDeals],
  );
  const fallbackData = useMemo(
    () => (query.data ?? []).slice().sort((a, b) => a.slot - b.slot),
    [query.data],
  );

  if (!active) {
    return { data: fallbackData, isLoading: query.isLoading, isSuccess: query.isSuccess };
  }
  return {
    data: storeData,
    isLoading: !active || loading,
    isSuccess: dailyDeals.size > 0 || (active && !loading),
  };
}

export function useWeeklySale() {
  const client = useNovusMundusClient();
  const entry = useAccountStore((s) => s.weeklySale);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const query = useQuery({
    queryKey: ["world", "shop", "weeklySales"],
    queryFn: () => client.fetchAllWeeklySales(),
    staleTime: SHOP_STALE_MS,
    enabled: !active,
  });

  // Boot seeding picks the currently-active sale (else the first); mirror that
  // selection here so a spectator sees the same one EventsView would render.
  const fallback = useMemo(() => {
    const sales = query.data ?? [];
    if (sales.length === 0) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    return sales.find((w) => isWeeklySaleActive(w.account, nowSec)) ?? sales[0];
  }, [query.data]);

  if (!active) {
    return {
      data: fallback ? { pubkey: fallback.pubkey, account: fallback.account } : null,
      isLoading: query.isLoading,
      isSuccess: query.isSuccess,
    };
  }
  return {
    data: entry ? { pubkey: entry.pubkey, account: entry.account } : null,
    isLoading: !active || loading,
    isSuccess: !!entry || (active && !loading),
  };
}

export function useSeasonalSale() {
  const client = useNovusMundusClient();
  const entry = useAccountStore((s) => s.seasonalSale);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const query = useQuery({
    queryKey: ["world", "shop", "seasonalSales"],
    queryFn: () => client.fetchAllSeasonalSales(),
    staleTime: SHOP_STALE_MS,
    enabled: !active,
  });

  // Boot seeding picks the currently-active sale (else the first); mirror that.
  const fallback = useMemo(() => {
    const sales = query.data ?? [];
    if (sales.length === 0) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    return sales.find((s) => isSeasonalSaleActive(s.account, nowSec)) ?? sales[0];
  }, [query.data]);

  if (!active) {
    return {
      data: fallback ? { pubkey: fallback.pubkey, account: fallback.account } : null,
      isLoading: query.isLoading,
      isSuccess: query.isSuccess,
    };
  }
  return {
    data: entry ? { pubkey: entry.pubkey, account: entry.account } : null,
    isLoading: !active || loading,
    isSuccess: !!entry || (active && !loading),
  };
}

export function useDaoPromotions() {
  const client = useNovusMundusClient();
  const daoPromotions = useAccountStore((s) => s.daoPromotions);
  const loading = useAccountStore((s) => s.loading);
  const active = useAccountStore((s) => s.subscriptionActive);

  const query = useQuery({
    queryKey: ["world", "shop", "daoPromotions"],
    queryFn: () => client.fetchAllDaoPromotions(),
    staleTime: SHOP_STALE_MS,
    enabled: !active,
  });

  const storeData = useMemo(() => Array.from(daoPromotions.values()), [daoPromotions]);
  const fallbackData = useMemo(() => query.data ?? [], [query.data]);

  if (!active) {
    return { data: fallbackData, isLoading: query.isLoading, isSuccess: query.isSuccess };
  }
  return {
    data: storeData,
    isLoading: !active || loading,
    isSuccess: daoPromotions.size > 0 || (active && !loading),
  };
}

/**
 * The current player's purchase record for a given item, or null if none.
 *
 * Player-scoped, so there is no spectator fallback: with no wallet the store
 * is empty and this correctly returns null (the views key purchase chips off a
 * connected player and the write buttons are gated by `useCanAct` anyway).
 */
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

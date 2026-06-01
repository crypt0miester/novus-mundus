"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useShopConfig, useShopItems, usePlayerPurchase } from "@/lib/hooks/useShop";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { NumberField } from "@/components/shared/NumberField";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
import {
  deriveShopItemPda,
  createPurchaseItemInstruction,
  isItemAvailable,
  getShopItemName,
  calculateFinalShopPrice,
  milestoneDiscountBps,
  streakDiscountBps,
  fibDiscountBps,
  getEffectiveTier,
} from "novus-mundus-sdk";
import { decodeCosmeticItemType } from "@/lib/config/cosmetics-catalog";
import {
  CATEGORY_LABELS,
  RARITY_LABELS,
  RARITY_COLORS,
  lamportsToSol,
  selectShopTile,
  useShopTileRipple,
} from "./shared";
import { useIsDesktop } from "./useIsDesktop";

export function ItemsView() {
  const { data: playerData } = usePlayer();
  const { data: shopConfigData } = useShopConfig();
  const { data: items, isSuccess: itemsReady } = useShopItems();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  // Wallet SOL balance (lamports) — caps how many SOL-priced wares are affordable.
  // getBalance returns a bigint under the v3 seam; coerce to number so the
  // affordability math (solLamports / unitPrice) doesn't throw "cannot mix BigInt".
  const { data: solLamports = 0 } = useQuery({
    queryKey: ["solBalance", publicKey?.toBase58()],
    queryFn: async () => Number(await connection.getBalance(publicKey!)),
    enabled: !!publicKey,
    staleTime: 30_000,
  });
  const transact = useTransact();
  const { data: geData } = useGameEngine();

  const player = playerData?.account;
  const gameEngine = geData?.account;
  const shopConfig = shopConfigData?.account;
  const ge = client.gameEngine;

  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [itemQuantities, setItemQuantities] = useState<Record<number, number>>({});

  const isDesktop = useIsDesktop();
  const reduce = useReducedMotion();
  // Tile-ripple grid root. grid-cols-2 md:grid-cols-3 -> read live breakpoint.
  const gridRef = useRef<HTMLDivElement>(null);

  // PDA derivation is async under web3.js v3, so the pubkey -> id lookup is
  // built off-thread and held in state. Empty until derivation resolves; the
  // dependent memos re-run when it lands.
  const [itemIdMap, setItemIdMap] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = new Map<string, number>();
      const entries = await Promise.all(
        Array.from({ length: 200 }, async (_unused, i) => {
          const [pda] = await deriveShopItemPda(ge, i);
          return [pda.toBase58(), i] as const;
        }),
      );
      for (const [key, id] of entries) map.set(key, id);
      if (!cancelled) setItemIdMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [ge]);

  const nowSec = Math.floor(Date.now() / 1000);

  const handlePurchaseItem = async (
    itemId: number,
    quantity: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey || !gameEngine) throw new Error("Not ready");
    const ix = await createPurchaseItemInstruction(
      {
        buyer: publicKey,
        gameEngine: ge,
        itemId,
        treasury: gameEngine.treasuryWallet,
      },
      { quantity },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Purchased x${quantity}!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  // Enrich with IDs and filter active
  const activeItems = useMemo(() => {
    return items
      .map((i) => ({ ...i, itemId: itemIdMap.get(i.pubkey.toBase58()) }))
      .filter(
        (i): i is typeof i & { itemId: number } =>
          i.itemId !== undefined && i.account.isActive && isItemAvailable(i.account, nowSec),
      );
  }, [items, itemIdMap, nowSec]);

  // Non-cosmetic items in the regular Wares tab.
  const nonCosmeticItems = useMemo(
    () => activeItems.filter((i) => decodeCosmeticItemType(i.account.itemType) === null),
    [activeItems],
  );

  // On desktop, default to first entry so the sidebar is always populated.
  const desktopDefaultItem = (() => {
    if (!isDesktop) return null;
    return nonCosmeticItems[0]?.itemId ?? null;
  })();
  const effectiveItem = selectedItem ?? desktopDefaultItem;
  const itemPurchase = usePlayerPurchase(effectiveItem);

  const morphActions = useMemo<PanelAction[] | null>(() => {
    if (effectiveItem != null) {
      const item = activeItems.find((i) => i.itemId === effectiveItem);
      if (!item) return null;
      const hasStock = item.account.maxGlobalStock === 0n || item.account.currentGlobalStock > 0n;
      const qty = itemQuantities[effectiveItem] ?? 1;
      return [
        {
          id: `buy-item-${effectiveItem}-${qty}`,
          label: hasStock ? `Buy` : "Sold Out",
          variant: "primary",
          disabled: !hasStock,
          onClick: (rp) => handlePurchaseItem(effectiveItem, qty, rp),
        },
      ];
    }
    return null;
  }, [effectiveItem, activeItems, itemQuantities, handlePurchaseItem]);
  useMorphActions(morphActions);

  // Rarity-aware tile ripple. Keyed on the visible ware ids so the diagonal
  // wash-in replays whenever the catalog set changes.
  const rippleSig = nonCosmeticItems.map((i) => i.itemId).join(",");
  useShopTileRipple(gridRef, [rippleSig], { base: 2, md: 3 });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {!itemsReady ? (
          <div className="card">
            <p className="text-sm text-text-muted">Loading wares...</p>
          </div>
        ) : nonCosmeticItems.length === 0 ? (
          <div className="card">
            <p className="text-sm text-text-muted">
              The caravan has no wares laid out at the moment.
            </p>
          </div>
        ) : (
          <div ref={gridRef} className="grid gap-2 grid-cols-2 md:grid-cols-3">
            {nonCosmeticItems.map((item) => {
              const a = item.account;
              const isSelected = effectiveItem === item.itemId;
              return (
                <button
                  key={item.itemId}
                  data-shop-tile
                  onClick={(e) => {
                    selectShopTile(e.currentTarget, reduce);
                    setSelectedItem(item.itemId);
                  }}
                  className={`rounded-lg border p-3 text-left opacity-0 transition-colors ${
                    isSelected
                      ? "border-border-gold bg-accent/20 ring-1 ring-border-gold/30"
                      : a.isFeatured
                        ? "border-border-gold/40 hover:border-border-gold/60"
                        : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <span
                    className={`text-[10px] font-semibold uppercase ${RARITY_COLORS[a.rarity] ?? "text-zinc-400"}`}
                  >
                    {RARITY_LABELS[a.rarity] ?? "Unknown"}
                  </span>
                  <div className="text-sm font-semibold text-text-primary truncate">
                    {getShopItemName(a.itemType, a.quantityPerPurchase)}
                  </div>
                  <div className="mt-1 text-xs text-text-gold">
                    {lamportsToSol(Number(a.priceSolLamports))} SOL
                  </div>
                  {a.maxGlobalStock !== 0n && a.currentGlobalStock === 0n && (
                    <div className="text-[10px] text-red-400">Sold Out</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <DetailPanel open={effectiveItem != null} onClose={() => setSelectedItem(null)}>
        {effectiveItem != null &&
          (() => {
            const item = activeItems.find((i) => i.itemId === effectiveItem);
            if (!item) return null;
            const a = item.account;
            const baseLamports = Number(a.priceSolLamports);
            const hasStock = a.maxGlobalStock === 0n || a.currentGlobalStock > 0n;
            const subTier = player ? getEffectiveTier(player, nowSec) : 0;
            // Mirror chain `calculate_final_price`: stack subscription ×
            // milestone × streak × fib × market multiplicatively (in that
            // order). Previously this only applied the milestone bps as
            // if they were sub discount, which produced a strike-through
            // price the chain never charged.
            const discountedLamports =
              shopConfig && player
                ? calculateFinalShopPrice(baseLamports, {
                    subscriptionTier: subTier,
                    milestoneDiscountBps: milestoneDiscountBps(player.totalShopSpent, shopConfig),
                    loyaltyDiscountBps: streakDiscountBps(player.loyaltyStreak, shopConfig),
                    fibDiscountBps: fibDiscountBps(player.dailyPurchaseCount, shopConfig),
                    maxTotalDiscountBps: shopConfig.maxTotalDiscountBps,
                  })
                : baseLamports;
            const hasDiscount = discountedLamports < baseLamports;
            const qty = itemQuantities[effectiveItem] ?? 1;
            const unitPrice = hasDiscount ? discountedLamports : baseLamports;
            const dayNow = Math.floor(nowSec / 86400);
            const lifetimeBought = itemPurchase ? Number(itemPurchase.lifetimePurchased) : 0;
            const todayBought =
              itemPurchase && Number(itemPurchase.lastPurchaseDay) === dayNow
                ? Number(itemPurchase.purchasedToday)
                : 0;

            return (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Ware
                  </h3>
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="hidden rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary lg:block"
                  >
                    Close
                  </button>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold uppercase ${RARITY_COLORS[a.rarity] ?? "text-zinc-400"}`}
                    >
                      {RARITY_LABELS[a.rarity] ?? "Unknown"}
                    </span>
                    <span className="text-xs text-text-muted">
                      {CATEGORY_LABELS[a.category] ?? "Unknown"}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-text-primary">
                    {getShopItemName(a.itemType, a.quantityPerPurchase)}
                  </div>
                </div>

                <div className="rounded-lg bg-surface/60 px-3 py-2 space-y-1">
                  {a.maxPerPlayer > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Bought (per player)</span>
                      <span
                        className={`text-text-muted ${lifetimeBought >= a.maxPerPlayer ? "text-red-400" : ""}`}
                      >
                        {lifetimeBought}/{a.maxPerPlayer}
                      </span>
                    </div>
                  )}
                  {a.maxPerDay > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Bought today</span>
                      <span
                        className={`text-text-muted ${todayBought >= a.maxPerDay ? "text-red-400" : ""}`}
                      >
                        {todayBought}/{a.maxPerDay}
                      </span>
                    </div>
                  )}
                  {a.maxGlobalStock !== 0n && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Stock</span>
                      <span
                        className={`text-text-muted ${a.currentGlobalStock === 0n ? "text-red-400" : ""}`}
                      >
                        {a.currentGlobalStock.toString()}/{a.maxGlobalStock.toString()}
                      </span>
                    </div>
                  )}
                </div>

                <div className="rounded-lg bg-surface/60 px-3 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Unit price</span>
                    {hasDiscount ? (
                      <span>
                        <span className="text-text-muted line-through mr-1">
                          {lamportsToSol(baseLamports)}
                        </span>
                        <span className="text-text-gold">
                          {lamportsToSol(discountedLamports)} SOL
                        </span>
                      </span>
                    ) : (
                      <span className="font-mono tabular-nums text-text-gold">
                        {lamportsToSol(baseLamports)} SOL
                      </span>
                    )}
                  </div>
                  {qty > 1 && (
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Total ({qty}x)</span>
                      <span className="font-mono tabular-nums text-text-gold">
                        {lamportsToSol(unitPrice * qty)} SOL
                      </span>
                    </div>
                  )}
                </div>

                <NumberField
                  label="Quantity"
                  value={qty}
                  onChange={(n) => setItemQuantities((prev) => ({ ...prev, [effectiveItem!]: n }))}
                  min={1}
                  max={unitPrice > 0 ? Math.max(1, Math.floor(solLamports / unitPrice)) : 1}
                />

                <TxButton
                  onClick={(rp) => handlePurchaseItem(effectiveItem!, qty, rp)}
                  className="hidden w-full lg:block"
                  disabled={!hasStock}
                >
                  {hasStock ? `Buy ${lamportsToSol(unitPrice * qty)} SOL` : "Sold Out"}
                </TxButton>
              </>
            );
          })()}
      </DetailPanel>
    </div>
  );
}

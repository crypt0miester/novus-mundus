"use client";

import { useState, useMemo, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useShopItems, useFlashSales, useDailyDeals } from "@/lib/hooks/useShop";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { TabNav } from "@/components/shared/TabNav";
import {
  deriveShopItemPda,
  deriveFlashSalePda,
  FlashSaleStatus,
  isItemAvailable,
  isFlashSaleActive,
  deciToNovi,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isGoldenHour,
} from "novus-mundus-sdk";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { systemFraming } from "@/lib/narrative";
import { bpsToPercent } from "@/lib/utils";
import { ItemsView } from "./views/ItemsView";
import { CosmeticsView } from "./views/CosmeticsView";
import { BundlesView } from "./views/BundlesView";
import { FlashView } from "./views/FlashView";
import { DailyView } from "./views/DailyView";
import { EventsView } from "./views/EventsView";
import { NoviView } from "./views/NoviView";
import { ReservedNoviNote } from "./views/ReservedNoviNote";

const CARAVAN_FRAMING = systemFraming("shop");

const SHOP_CATEGORIES = [
  { key: "novi", label: "Get NOVI" },
  { key: "items", label: "Wares" },
  { key: "cosmetics", label: "Cosmetics" },
  { key: "bundles", label: "Caravan Lots" },
  { key: "flash", label: "Passing Trade" },
  { key: "daily", label: "Daily Deals" },
  { key: "events", label: "Events" },
];

// Each shop category maps to a self-contained view that owns its selection
// state and registers its own morph actions. `placement` mirrors the original
// DOM order: the Buy NOVI view renders after the Game Parameters panel, every
// other view before it.
const SHOP_VIEWS: Record<
  string,
  { component: React.ComponentType; placement: "before" | "after" }
> = {
  items: { component: ItemsView, placement: "before" },
  cosmetics: { component: CosmeticsView, placement: "before" },
  bundles: { component: BundlesView, placement: "before" },
  flash: { component: FlashView, placement: "before" },
  daily: { component: DailyView, placement: "before" },
  events: { component: EventsView, placement: "before" },
  novi: { component: NoviView, placement: "after" },
};

export function ShopTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const { data: items } = useShopItems();
  const { data: flashSales } = useFlashSales();
  const { data: dailyDeals } = useDailyDeals();
  const client = useNovusMundusClient();

  const player = playerData?.account;
  const gameEngine = geData?.account;
  const ge = client.gameEngine;

  const [activeTab, setActiveTab] = useState("novi");

  // Build reverse-lookup maps: pubkey -> numeric ID. Needed here to compute the
  // flash / daily tab badges (their counts mirror the per-view derivations).
  // PDA derivation is async under web3.js v3, so the pubkey -> id lookups are
  // built off-thread and held in state. Empty until derivation resolves; the
  // dependent memos re-run when each lands.
  const [itemIdMap, setItemIdMap] = useState<Map<string, number>>(() => new Map());
  const [saleIdMap, setSaleIdMap] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const itemEntries = await Promise.all(
        Array.from({ length: 200 }, async (_unused, i) => {
          const [pda] = await deriveShopItemPda(ge, i);
          return [pda.toBase58(), i] as const;
        }),
      );
      const saleEntries = await Promise.all(
        Array.from({ length: 100 }, async (_unused, i) => {
          const [pda] = await deriveFlashSalePda(ge, i);
          return [pda.toBase58(), i] as const;
        }),
      );
      if (cancelled) return;
      setItemIdMap(new Map(itemEntries));
      setSaleIdMap(new Map(saleEntries));
    })();
    return () => {
      cancelled = true;
    };
  }, [ge]);

  const nowSec = Math.floor(Date.now() / 1000);

  // Time-of-day info for the player's location
  const timeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = player.currentLong ?? 0;
    const tod = getCurrentTimeOfDay(nowSec, longitude);
    return {
      tod,
      name: getTimeOfDayName(tod),
      isGolden: isGoldenHour(tod),
      purchasingMult: getActivityMultiplier(1 as any, tod), // ActivityType.Purchasing = 1
    };
  }, [player, nowSec]);

  // Enrich with IDs and filter active — used only for the flash / daily tab
  // badges below; the views re-derive their own lists.
  const activeItems = useMemo(() => {
    return items
      .map((i) => ({ ...i, itemId: itemIdMap.get(i.pubkey.toBase58()) }))
      .filter(
        (i): i is typeof i & { itemId: number } =>
          i.itemId !== undefined && i.account.isActive && isItemAvailable(i.account, nowSec),
      );
  }, [items, itemIdMap, nowSec]);

  const activeFlashSales = useMemo(() => {
    return flashSales
      .map((s) => ({ ...s, saleId: saleIdMap.get(s.pubkey.toBase58()) }))
      .filter(
        (s): s is typeof s & { saleId: number } =>
          s.saleId !== undefined &&
          s.account.status === FlashSaleStatus.Active &&
          isFlashSaleActive(s.account, nowSec),
      );
  }, [flashSales, saleIdMap, nowSec]);

  // Daily deals: resolve each slot's discounted shop item; keep only configured slots.
  const activeDailyDeals = useMemo(() => {
    return dailyDeals
      .map((d) => ({
        slot: d.slot,
        account: d.account,
        item: activeItems.find((i) => i.itemId === d.account.itemId) ?? null,
      }))
      .filter(
        (d): d is typeof d & { item: NonNullable<typeof d.item> } =>
          d.slot >= 0 && d.account.discountBps > 0 && d.item !== null,
      );
  }, [dailyDeals, activeItems]);

  const view = SHOP_VIEWS[activeTab];
  const ActiveView = view?.component;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-primary">
          {CARAVAN_FRAMING.title}
        </h2>
        <p className="mt-1 text-xs text-text-muted">{CARAVAN_FRAMING.line}</p>
      </div>

      {/* Balance Bar */}
      {player && (
        <div className="card accent-border">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-text-muted">Cash</div>
              <span className="inline-flex items-center gap-1">
                <GameIcon id="resource-cash" size={14} />
                <GoldNumber value={Number(player.cashOnHand)} format="compact" />
              </span>
            </div>
            <div>
              <div className="text-xs text-text-muted">Gems</div>
              <span className="inline-flex items-center gap-1">
                <GameIcon id="resource-gem" size={14} />
                <GoldNumber value={Number(player.gems)} />
              </span>
            </div>
            <div>
              <div className="text-xs text-text-muted">NOVI</div>
              <span className="inline-flex items-center gap-1">
                <GameIcon id="resource-novi" size={14} />
                <GoldNumber value={deciToNovi(player.lockedNovi)} />
              </span>
            </div>
          </div>
          {timeInfo && (
            <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
              <span
                className={`text-[11px] font-semibold ${timeInfo.isGolden ? "text-text-gold" : "text-text-muted"}`}
              >
                {timeInfo.isGolden ? "✦ " : ""}
                {timeInfo.name}
              </span>
              {timeInfo.purchasingMult > 1.05 ? (
                <span className="text-[11px] text-text-gold">
                  bonus ({((timeInfo.purchasingMult - 1) * 100).toFixed(0)}%
                  discount)
                </span>
              ) : timeInfo.purchasingMult < 0.95 ? (
                <span className="text-[11px] text-danger">
                  Off-peak prices (+{((1 / timeInfo.purchasingMult - 1) * 100).toFixed(0)}% cost)
                </span>
              ) : (
                <span className="text-[11px] text-text-muted">Normal pricing</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Category Tabs */}
      <TabNav
        tabs={SHOP_CATEGORIES.map((cat) => ({
          key: cat.key,
          label: cat.label,
          badge:
            (cat.key === "flash" && activeFlashSales.length > 0) ||
            (cat.key === "daily" && activeDailyDeals.length > 0),
        }))}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Active view — every category except Buy NOVI renders here, before the
          Game Parameters panel. Each view owns its selection state and morph
          actions. */}
      {ActiveView && view.placement === "before" && <ActiveView />}

      {/* Game Parameters */}
      {gameEngine &&
        (() => {
          const npc = gameEngine.noviPurchaseConfig;
          return (
            <GameInfoPanel>
              <InfoGrid
                items={[
                  ...npc.noviPurchaseAmounts.map((a, i) => ({
                    label: `Package ${i + 1}`,
                    value: (Number(a) / 10).toLocaleString(),
                    suffix: "NOVI",
                  })),
                  ...npc.noviBulkBonusBps.map((b, i) => ({
                    label: `Bulk Bonus ${i + 1}`,
                    value: bpsToPercent(b),
                  })),
                  ...npc.noviSubBonusBps.map((b, i) => ({
                    label: `Sub Bonus T${i}`,
                    value: bpsToPercent(b),
                  })),
                  ...npc.noviStreakBonusBps.map((b, i) => ({
                    label: `Streak Day ${i + 1}`,
                    value: bpsToPercent(b),
                  })),
                  ...npc.noviSubDailyCap.map((c, i) => ({
                    label: `Daily Cap T${i}`,
                    value: (Number(c) / 10).toLocaleString(),
                    suffix: "NOVI",
                  })),
                ]}
              />
            </GameInfoPanel>
          );
        })()}

      {/* Buy NOVI view renders after the Game Parameters panel, matching the
          original DOM order. */}
      {ActiveView && view.placement === "after" && <ActiveView />}

      <ReservedNoviNote className="hidden lg:block" />
    </div>
  );
}

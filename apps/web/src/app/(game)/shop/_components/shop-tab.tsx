"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useUser } from "@/lib/hooks/useUser";
import { useShopConfig, useShopItems, useBundles, useFlashSales } from "@/lib/hooks/useShop";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { TabNav } from "@/components/shared/TabNav";
import {
  deriveShopItemPda,
  deriveBundlePda,
  deriveFlashSalePda,
  createPurchaseItemInstruction,
  createPurchaseNoviInstruction,
  createPurchaseBundleInstruction,
  createPurchaseFlashSaleInstruction,
  ShopItemCategory,
  ShopItemRarity,
  FlashSaleStatus,
  isItemAvailable,
  isFlashSaleActive,
  calculateNoviPurchasePreview,
  calculateNoviStreak,
  getRemainingDailyAllowance,
  formatNoviAmount,
  formatLamportsAsSol,
  NOVI_PACKAGE_TIERS,
  calculateShopPrice,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isGoldenHour,
  getEffectiveTier,
} from "@/lib/sdk";
import type { PublicKey } from "@solana/web3.js";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToPercent } from "@/lib/utils";

const SHOP_CATEGORIES = [
  { key: "items", label: "Items" },
  { key: "bundles", label: "Bundles" },
  { key: "flash", label: "Flash Sales" },
  { key: "novi", label: "Buy NOVI" },
];

const CATEGORY_LABELS: Record<number, string> = {
  [ShopItemCategory.Equipment]: "Equipment",
  [ShopItemCategory.Consumable]: "Consumable",
  [ShopItemCategory.Material]: "Material",
  [ShopItemCategory.Cosmetic]: "Cosmetic",
};

const RARITY_LABELS: Record<number, string> = {
  [ShopItemRarity.Common]: "Common",
  [ShopItemRarity.Uncommon]: "Uncommon",
  [ShopItemRarity.Rare]: "Rare",
  [ShopItemRarity.Epic]: "Epic",
  [ShopItemRarity.Legendary]: "Legendary",
};

const RARITY_COLORS: Record<number, string> = {
  [ShopItemRarity.Common]: "text-zinc-400",
  [ShopItemRarity.Uncommon]: "text-green-400",
  [ShopItemRarity.Rare]: "text-blue-400",
  [ShopItemRarity.Epic]: "text-purple-400",
  [ShopItemRarity.Legendary]: "text-amber-400",
};

function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4);
}

/** Reverse-lookup map: pubkey base58 -> numeric ID for PDA-derived accounts */
function buildIdLookup(
  ge: PublicKey,
  deriveFn: (ge: PublicKey, id: number) => [PublicKey, number],
  maxId: number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < maxId; i++) {
    const [pda] = deriveFn(ge, i);
    map.set(pda.toBase58(), i);
  }
  return map;
}

export function ShopTab() {
  const { data: playerData } = usePlayer();
  const { data: userData } = useUser();
  const { data: shopConfigData } = useShopConfig();
  const { data: geData } = useGameEngine();
  const { data: items, isSuccess: itemsReady } = useShopItems();
  const { data: bundles, isSuccess: bundlesReady } = useBundles();
  const { data: flashSales, isSuccess: flashSalesReady } = useFlashSales();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const user = userData?.account;
  const gameEngine = geData?.account;
  const shopConfig = shopConfigData?.account;
  const ge = client.gameEngine;

  const [activeTab, setActiveTab] = useState("items");
  const [selectedPackage, setSelectedPackage] = useState(0);

  // Build reverse-lookup maps: pubkey -> numeric ID
  const itemIdMap = useMemo(() => buildIdLookup(ge, deriveShopItemPda, 200), [ge]);
  const bundleIdMap = useMemo(() => buildIdLookup(ge, deriveBundlePda, 100), [ge]);
  const saleIdMap = useMemo(() => buildIdLookup(ge, deriveFlashSalePda, 100), [ge]);

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

  // NOVI purchase preview for selected package
  const noviPreview = useMemo(() => {
    if (!gameEngine || !player) return null;
    const config = gameEngine.noviPurchaseConfig;
    const tier = getEffectiveTier(player, nowSec);
    const streakDay = user ? user.noviPurchaseStreak : 1;
    try {
      return calculateNoviPurchasePreview(selectedPackage, tier, streakDay, config);
    } catch {
      return null;
    }
  }, [gameEngine, player, user, selectedPackage, nowSec]);

  // Streak info
  const streakInfo = useMemo(() => {
    if (!user) return null;
    return calculateNoviStreak(
      user.noviLastPurchaseDay,
      user.noviPurchaseStreak,
      nowSec,
    );
  }, [user, nowSec]);

  // Remaining daily allowance
  const dailyAllowance = useMemo(() => {
    if (!gameEngine || !player || !user) return null;
    const config = gameEngine.noviPurchaseConfig;
    const tier = getEffectiveTier(player, nowSec);
    return getRemainingDailyAllowance(user.noviPurchasedToday, tier, config);
  }, [gameEngine, player, user, nowSec]);

  const handlePurchaseItem = async (itemId: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !gameEngine) throw new Error("Not ready");
    const ix = createPurchaseItemInstruction(
      {
        buyer: publicKey,
        gameEngine: ge,
        itemId,
        treasury: gameEngine.treasuryWallet,
      },
      { quantity: 1 },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Item purchased!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handlePurchaseBundle = async (bundleId: number, bundleItems: { itemId: number }[], reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !gameEngine) throw new Error("Not ready");
    const shopItemAccounts = bundleItems.map(
      (bi) => deriveShopItemPda(ge, bi.itemId)[0],
    );
    const ix = createPurchaseBundleInstruction(
      {
        buyer: publicKey,
        gameEngine: ge,
        bundleId,
        treasury: gameEngine.treasuryWallet,
        shopItemAccounts,
      },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Bundle purchased!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handlePurchaseFlashSale = async (saleId: number, itemOrBundle: PublicKey, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !gameEngine) throw new Error("Not ready");
    const ix = createPurchaseFlashSaleInstruction(
      {
        buyer: publicKey,
        gameEngine: ge,
        saleId,
        itemOrBundle,
        treasury: gameEngine.treasuryWallet,
      },
      { quantity: 1 },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Flash sale purchased!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handlePurchaseNovi = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !gameEngine) throw new Error("Not ready");
    const noviConfig = gameEngine.noviPurchaseConfig;
    const maxLamports = noviConfig.noviBasePriceLamports
      .muln(noviConfig.noviPurchaseAmounts[selectedPackage].toNumber())
      .muln(15)
      .divn(10);
    const ix = createPurchaseNoviInstruction(
      {
        buyer: publicKey,
        gameEngine: ge,
        treasury: gameEngine.treasuryWallet,
        noviMint: gameEngine.noviMint,
      },
      { packageIndex: selectedPackage, maxLamports },
    );
    const amount = noviConfig.noviPurchaseAmounts[selectedPackage].toNumber() / 10;
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Purchased ${amount} NOVI!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  // Enrich with IDs and filter active
  const activeItems = useMemo(() => {
    return items
      .map((i) => ({ ...i, itemId: itemIdMap.get(i.pubkey.toBase58()) }))
      .filter((i): i is typeof i & { itemId: number } =>
        i.itemId !== undefined && i.account.isActive && isItemAvailable(i.account, nowSec),
      );
  }, [items, itemIdMap, nowSec]);

  const activeBundles = useMemo(() => {
    return bundles
      .map((b) => ({ ...b, bundleId: bundleIdMap.get(b.pubkey.toBase58()) }))
      .filter((b): b is typeof b & { bundleId: number } =>
        b.bundleId !== undefined && b.account.isActive,
      );
  }, [bundles, bundleIdMap]);

  const activeFlashSales = useMemo(() => {
    return flashSales
      .map((s) => ({ ...s, saleId: saleIdMap.get(s.pubkey.toBase58()) }))
      .filter((s): s is typeof s & { saleId: number } =>
        s.saleId !== undefined &&
        s.account.status === FlashSaleStatus.Active &&
        isFlashSaleActive(s.account, nowSec),
      );
  }, [flashSales, saleIdMap, nowSec]);

  return (
    <div className="space-y-6">
      {/* Balance Bar */}
      {player && (
        <div className="card accent-border">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-text-muted">Cash</div>
              <GoldNumber value={player.cashOnHand.toNumber()} prefix="$ " format="compact" />
            </div>
            <div>
              <div className="text-xs text-text-muted">Gems</div>
              <GoldNumber value={player.gems.toNumber()} />
            </div>
            <div>
              <div className="text-xs text-text-muted">NOVI</div>
              <GoldNumber value={player.lockedNovi.toNumber()} format="compact" />
            </div>
          </div>
          {timeInfo && (
            <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
              <span className={`text-[11px] font-semibold ${timeInfo.isGolden ? "text-amber-400" : "text-text-muted"}`}>
                {timeInfo.isGolden ? "\u2726 " : ""}{timeInfo.name}
              </span>
              {timeInfo.purchasingMult > 1.05 ? (
                <span className="text-[11px] text-green-400">
                  Purchasing bonus active ({((timeInfo.purchasingMult - 1) * 100).toFixed(0)}% discount)
                </span>
              ) : timeInfo.purchasingMult < 0.95 ? (
                <span className="text-[11px] text-amber-400">
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
          badge: cat.key === "flash" && activeFlashSales.length > 0,
        }))}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        size="compact"
      />

      {/* Items Tab */}
      {activeTab === "items" && (
        <div>
          {!itemsReady ? (
            <div className="card">
              <p className="text-sm text-text-muted">Loading items...</p>
            </div>
          ) : activeItems.length === 0 ? (
            <div className="card">
              <p className="text-sm text-text-muted">No items available in the shop right now.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {activeItems.map((item) => {
                const a = item.account;
                const baseLamports = a.priceSolLamports.toNumber();
                const solPrice = lamportsToSol(baseLamports);
                const hasStock = a.maxGlobalStock.eqn(0) || a.currentGlobalStock.gtn(0);

                // Calculate discounted price if player has a subscription
                const subTier = player ? getEffectiveTier(player, nowSec) : 0;
                const tierDiscounts = shopConfig
                  ? [0, shopConfig.bronzeDiscountBps, shopConfig.silverDiscountBps, shopConfig.goldDiscountBps]
                  : [0, 0, 0, 0];
                const discountedLamports = subTier > 0
                  ? calculateShopPrice(baseLamports, subTier, tierDiscounts)
                  : baseLamports;
                const hasDiscount = discountedLamports < baseLamports;

                return (
                  <div key={item.itemId} className={`card group ${a.isFeatured ? "accent-border" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold uppercase ${RARITY_COLORS[a.rarity] ?? "text-zinc-400"}`}>
                        {RARITY_LABELS[a.rarity] ?? "Unknown"}
                      </span>
                      <span className="text-xs text-text-muted">
                        {CATEGORY_LABELS[a.category] ?? "Unknown"}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-semibold text-text-primary">
                      Item #{item.itemId}
                    </div>
                    <div className="text-xs text-text-muted">
                      x{a.quantityPerPurchase} per purchase
                    </div>
                    {a.maxPerPlayer > 0 && (
                      <div className="text-[11px] text-text-muted">
                        Limit: {a.maxPerPlayer} per player
                      </div>
                    )}
                    {a.maxPerDay > 0 && (
                      <div className="text-[11px] text-text-muted">
                        Daily limit: {a.maxPerDay}
                      </div>
                    )}
                    {!a.maxGlobalStock.eqn(0) && (
                      <div className="text-xs text-text-muted">
                        Stock: {a.currentGlobalStock.toString()}/{a.maxGlobalStock.toString()}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <div>
                        {hasDiscount ? (
                          <>
                            <span className="text-xs text-text-muted line-through">{solPrice} SOL</span>
                            <span className="ml-1 text-sm text-green-400">{lamportsToSol(discountedLamports)} SOL</span>
                          </>
                        ) : (
                          <span className="text-sm text-text-gold">{solPrice} SOL</span>
                        )}
                      </div>
                      <TxButton
                        onClick={(reportPhase) => handlePurchaseItem(item.itemId, reportPhase)}
                        variant="secondary"
                        className="text-xs"
                        disabled={!hasStock}
                      >
                        {hasStock ? "Buy" : "Sold Out"}
                      </TxButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Bundles Tab */}
      {activeTab === "bundles" && (
        <div>
          {!bundlesReady ? (
            <div className="card">
              <p className="text-sm text-text-muted">Loading bundles...</p>
            </div>
          ) : activeBundles.length === 0 ? (
            <div className="card">
              <p className="text-sm text-text-muted">No bundles available right now.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {activeBundles.map((bundle) => {
                const b = bundle.account;
                const solPrice = lamportsToSol(b.priceSolLamports.toNumber());
                return (
                  <div key={bundle.bundleId} className="card accent-border">
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-semibold text-text-gold">
                        Bundle #{bundle.bundleId}
                      </div>
                      {b.savingsBps > 0 && (
                        <span className="rounded bg-green-900/30 px-2 py-0.5 text-xs font-semibold text-green-400">
                          {(b.savingsBps / 100).toFixed(0)}% off
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      Tier {b.tier} &middot; {b.itemCount} items
                      {b.requiresSubscription > 0 && " \u00b7 Subscription required"}
                    </div>
                    <div className="mt-2 space-y-1">
                      {b.items.map((bi, idx) => (
                        <div key={idx} className="text-xs text-text-secondary">
                          Item #{bi.itemId} x{bi.quantity}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-lg text-text-gold">{solPrice} SOL</span>
                      <TxButton
                        variant="primary"
                        onClick={(reportPhase) => handlePurchaseBundle(bundle.bundleId, b.items, reportPhase)}
                      >
                        Purchase
                      </TxButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Flash Sales Tab */}
      {activeTab === "flash" && (
        <div>
          {!flashSalesReady ? (
            <div className="card">
              <p className="text-sm text-text-muted">Loading flash sales...</p>
            </div>
          ) : activeFlashSales.length === 0 ? (
            <div className="card text-center">
              <p className="text-text-muted">No flash sales active right now. Check back soon!</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {activeFlashSales.map((sale) => {
                const s = sale.account;
                const itemPda = s.isBundle
                  ? deriveBundlePda(ge, s.itemId)[0]
                  : deriveShopItemPda(ge, s.itemId)[0];
                const discountPct = (s.discountBps / 100).toFixed(0);
                const endsAtSec = s.endsAt.toNumber();
                const remainingSec = Math.max(0, endsAtSec - nowSec);
                const totalDurationSec = endsAtSec - s.startsAt.toNumber();
                const pctRemaining = totalDurationSec > 0
                  ? Math.round((remainingSec / totalDurationSec) * 100)
                  : 0;
                const stockPct = s.maxStock.gtn(0)
                  ? Math.round((s.remainingStock.toNumber() / s.maxStock.toNumber()) * 100)
                  : 100;
                return (
                  <div key={sale.saleId} className="card accent-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold uppercase text-red-400">Flash Sale</span>
                        <div className="mt-1 text-sm font-semibold text-text-primary">
                          {s.isBundle ? `Bundle #${s.itemId}` : `Item #${s.itemId}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="rounded bg-red-900/30 px-2 py-0.5 text-sm font-bold text-red-400">
                          -{discountPct}%
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
                      <span>Stock: {s.remainingStock.toString()}/{s.maxStock.toString()}</span>
                      <span className={stockPct <= 20 ? "text-red-400 font-semibold" : ""}>
                        {stockPct <= 20 ? "Almost gone!" : `${stockPct}% left`}
                      </span>
                    </div>
                    <div className="mt-1">
                      <GoldCountdown
                        endsAt={endsAtSec}
                        startedAt={s.startsAt.toNumber()}
                        format="compact"
                        size="sm"
                      />
                    </div>
                    {pctRemaining <= 25 && pctRemaining > 0 && (
                      <div className="mt-1 text-[11px] font-semibold text-amber-400">
                        Ending soon &mdash; {pctRemaining}% time remaining
                      </div>
                    )}
                    <div className="mt-3">
                      <TxButton
                        onClick={(reportPhase) => handlePurchaseFlashSale(sale.saleId, itemPda, reportPhase)}
                        disabled={s.remainingStock.eqn(0)}
                      >
                        {s.remainingStock.eqn(0) ? "Sold Out" : `Buy Now (-${discountPct}%)`}
                      </TxButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Game Parameters */}
      {gameEngine && (() => {
        const npc = gameEngine.noviPurchaseConfig;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              ...npc.noviPurchaseAmounts.map((a, i) => ({
                label: `Package ${i + 1}`,
                value: (a.toNumber() / 10).toLocaleString(),
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
                value: (c.toNumber() / 10).toLocaleString(),
                suffix: "NOVI",
              })),
            ]} />
          </GameInfoPanel>
        );
      })()}

      {/* Buy NOVI Tab */}
      {activeTab === "novi" && (
        <div className="space-y-4">
          {/* Streak & Allowance Banner */}
          {(streakInfo || dailyAllowance) && (
            <div className="card flex flex-wrap items-center gap-4">
              {streakInfo && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">Streak:</span>
                  <span className={`text-sm font-semibold ${streakInfo.streakDay >= 5 ? "text-amber-400" : streakInfo.streakDay >= 3 ? "text-green-400" : "text-text-secondary"}`}>
                    Day {streakInfo.streakDay}/7
                  </span>
                  {streakInfo.bonusBps > 0 && (
                    <span className="text-[11px] text-green-400">
                      +{(streakInfo.bonusBps / 100).toFixed(0)}% bonus
                    </span>
                  )}
                  {streakInfo.isResetting && (
                    <span className="text-[11px] text-amber-400">Streak reset</span>
                  )}
                </div>
              )}
              {dailyAllowance && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">Daily limit:</span>
                  <span className={`text-sm font-semibold ${dailyAllowance.eqn(0) ? "text-red-400" : "text-text-gold"}`}>
                    {dailyAllowance.eqn(0) ? "Reached" : `${formatNoviAmount(dailyAllowance)} NOVI left`}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Purchase NOVI Tokens
            </h3>
            {!gameEngine ? (
              <p className="text-sm text-text-muted">Loading...</p>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-5">
                  {gameEngine.noviPurchaseConfig.noviPurchaseAmounts.map((amount, idx) => {
                    const tierInfo = NOVI_PACKAGE_TIERS[idx];
                    const noviAmount = amount.toNumber() / 10;
                    const bonusBps = gameEngine.noviPurchaseConfig.noviBulkBonusBps[idx] ?? 0;
                    const isSelected = selectedPackage === idx;
                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectedPackage(idx)}
                        className={`rounded-lg border p-4 text-center transition-all ${
                          isSelected
                            ? "border-amber-600 bg-amber-900/20"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        {tierInfo && (
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                            {tierInfo.name}
                          </div>
                        )}
                        <div className="text-lg font-semibold text-text-gold">
                          {noviAmount.toLocaleString()}
                        </div>
                        <div className="text-xs text-text-muted">NOVI</div>
                        {bonusBps > 0 && (
                          <div className="mt-1 text-xs text-green-400">
                            +{(bonusBps / 100).toFixed(0)}% bulk bonus
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Purchase Preview */}
                {noviPreview && (
                  <div className="mt-4 rounded-lg border border-zinc-800 bg-surface p-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Purchase Preview
                    </div>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-text-muted">Base amount</span>
                        <span className="text-text-secondary">{formatNoviAmount(noviPreview.baseAmount)} NOVI</span>
                      </div>
                      {!noviPreview.bulkBonus.eqn(0) && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">Bulk bonus</span>
                          <span className="text-green-400">+{formatNoviAmount(noviPreview.bulkBonus)} NOVI</span>
                        </div>
                      )}
                      {!noviPreview.subscriptionBonus.eqn(0) && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">Subscription bonus</span>
                          <span className="text-green-400">+{formatNoviAmount(noviPreview.subscriptionBonus)} NOVI</span>
                        </div>
                      )}
                      {!noviPreview.streakBonus.eqn(0) && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">Streak bonus (Day {streakInfo?.streakDay ?? 1})</span>
                          <span className="text-green-400">+{formatNoviAmount(noviPreview.streakBonus)} NOVI</span>
                        </div>
                      )}
                      {noviPreview.totalBonusBps > 0 && (
                        <div className="border-t border-zinc-800 pt-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-text-muted">Total bonus</span>
                            <span className="text-green-400">+{(noviPreview.totalBonusBps / 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      )}
                      <div className="border-t border-zinc-800 pt-1">
                        <div className="flex items-center justify-between text-sm font-semibold">
                          <span className="text-text-muted">You receive</span>
                          <span className="text-text-gold">{formatNoviAmount(noviPreview.totalNovi)} NOVI</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">Cost</span>
                          <span className="text-text-secondary">{formatLamportsAsSol(noviPreview.costLamports)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-text-muted">
                    Base price:{" "}
                    <span className="text-text-gold">
                      {lamportsToSol(gameEngine.noviPurchaseConfig.noviBasePriceLamports.toNumber())} SOL/NOVI
                    </span>
                  </div>
                  <TxButton
                    onClick={handlePurchaseNovi}
                    disabled={dailyAllowance?.eqn(0) ?? false}
                  >
                    {dailyAllowance?.eqn(0)
                      ? "Daily limit reached"
                      : `Buy ${noviPreview ? formatNoviAmount(noviPreview.totalNovi) : (gameEngine.noviPurchaseConfig.noviPurchaseAmounts[selectedPackage].toNumber() / 10)} NOVI`}
                  </TxButton>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useMemo, useEffect } from "react";
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
import { DetailPanel } from "@/components/shared/DetailPanel";
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
  getShopItemName,
  getItemTypeInfo,
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
} from "novus-mundus-sdk";
import type { PublicKey } from "@solana/web3.js";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { systemFraming } from "@/lib/narrative";
import { bpsToPercent } from "@/lib/utils";

const CARAVAN_FRAMING = systemFraming("shop");

const SHOP_CATEGORIES = [
  { key: "items", label: "Wares" },
  { key: "bundles", label: "Caravan Lots" },
  { key: "flash", label: "Passing Trade" },
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
  [ShopItemRarity.Epic]: "text-fuchsia-400",
  [ShopItemRarity.Legendary]: "text-amber-400",
};

function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4);
}

/** Look up an item's itemType from the active items list by its PDA-derived itemId */
function findItemType(activeItems: { itemId: number; account: { itemType: number } }[], itemId: number): number {
  return activeItems.find((i) => i.itemId === itemId)?.account.itemType ?? -1;
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
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [itemQuantities, setItemQuantities] = useState<Record<number, number>>({});

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => { setIsDesktop(window.innerWidth >= 1024); }, []);
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<number | null>(null);
  const [selectedSale, setSelectedSale] = useState<number | null>(null);
  const effectivePackage = selectedPackage ?? (isDesktop ? 0 : null);

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
    if (!gameEngine || !player || effectivePackage == null) return null;
    const config = gameEngine.noviPurchaseConfig;
    const tier = getEffectiveTier(player, nowSec);
    const streakDay = user ? user.noviPurchaseStreak : 1;
    try {
      return calculateNoviPurchasePreview(effectivePackage, tier, streakDay, config);
    } catch {
      return null;
    }
  }, [gameEngine, player, user, effectivePackage, nowSec]);

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

  const handlePurchaseItem = async (itemId: number, quantity: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !gameEngine) throw new Error("Not ready");
    const ix = createPurchaseItemInstruction(
      {
        buyer: publicKey,
        gameEngine: ge,
        itemId,
        treasury: gameEngine.treasuryWallet,
      },
      { quantity },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Purchased x${quantity}!`,
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
    if (!publicKey || !gameEngine || effectivePackage == null) throw new Error("Not ready");
    const noviConfig = gameEngine.noviPurchaseConfig;
    const maxLamports = noviConfig.noviBasePriceLamports
      .muln(noviConfig.noviPurchaseAmounts[effectivePackage].toNumber())
      .muln(15)
      .divn(10);
    const ix = createPurchaseNoviInstruction(
      {
        buyer: publicKey,
        gameEngine: ge,
        treasury: gameEngine.treasuryWallet,
        noviMint: gameEngine.noviMint,
      },
      { packageIndex: effectivePackage, maxLamports },
    );
    const amount = noviConfig.noviPurchaseAmounts[effectivePackage].toNumber() / 10;
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Purchased ${amount} NOVI — credited to your Reserved balance.`,
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

  // On desktop, default to first entry so the sidebar is always populated
  const effectiveItem = selectedItem ?? (isDesktop && activeItems.length > 0 ? activeItems[0].itemId : null);
  const effectiveBundle = selectedBundle ?? (isDesktop && activeBundles.length > 0 ? activeBundles[0].bundleId : null);
  const effectiveSale = selectedSale ?? (isDesktop && activeFlashSales.length > 0 ? activeFlashSales[0].saleId : null);

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
      />

      {/* Items Tab */}
      {activeTab === "items" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {!itemsReady ? (
              <div className="card"><p className="text-sm text-text-muted">Loading wares...</p></div>
            ) : activeItems.length === 0 ? (
              <div className="card"><p className="text-sm text-text-muted">The caravan has no wares laid out at the moment.</p></div>
            ) : (
              <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
                {activeItems.map((item) => {
                  const a = item.account;
                  const isSelected = effectiveItem === item.itemId;
                  return (
                    <button
                      key={item.itemId}
                      onClick={() => setSelectedItem(item.itemId)}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? "border-amber-600 bg-amber-900/20 ring-1 ring-amber-600/30"
                          : a.isFeatured
                            ? "border-amber-800/40 hover:border-amber-700/60"
                            : "border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <span className={`text-[10px] font-semibold uppercase ${RARITY_COLORS[a.rarity] ?? "text-zinc-400"}`}>
                        {RARITY_LABELS[a.rarity] ?? "Unknown"}
                      </span>
                      <div className="text-sm font-semibold text-text-primary truncate">
                        {getShopItemName(a.itemType, a.quantityPerPurchase)}
                      </div>
                      <div className="mt-1 text-xs text-text-gold">
                        {lamportsToSol(a.priceSolLamports.toNumber())} SOL
                      </div>
                      {!a.maxGlobalStock.eqn(0) && a.currentGlobalStock.eqn(0) && (
                        <div className="text-[10px] text-red-400">Sold Out</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DetailPanel open={effectiveItem != null} onClose={() => setSelectedItem(null)}>
            {effectiveItem != null && (() => {
              const item = activeItems.find((i) => i.itemId === effectiveItem);
              if (!item) return null;
              const a = item.account;
              const baseLamports = a.priceSolLamports.toNumber();
              const hasStock = a.maxGlobalStock.eqn(0) || a.currentGlobalStock.gtn(0);
              const subTier = player ? getEffectiveTier(player, nowSec) : 0;
              const tierDiscounts = shopConfig
                ? [0, shopConfig.bronzeDiscountBps, shopConfig.silverDiscountBps, shopConfig.goldDiscountBps]
                : [0, 0, 0, 0];
              const discountedLamports = subTier > 0
                ? calculateShopPrice(baseLamports, subTier, tierDiscounts)
                : baseLamports;
              const hasDiscount = discountedLamports < baseLamports;
              const qty = itemQuantities[effectiveItem] ?? 1;
              const unitPrice = hasDiscount ? discountedLamports : baseLamports;

              return (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Ware</h3>
                    <button onClick={() => setSelectedItem(null)} className="hidden rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary lg:block">Close</button>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold uppercase ${RARITY_COLORS[a.rarity] ?? "text-zinc-400"}`}>
                        {RARITY_LABELS[a.rarity] ?? "Unknown"}
                      </span>
                      <span className="text-xs text-text-muted">{CATEGORY_LABELS[a.category] ?? "Unknown"}</span>
                    </div>
                    <div className="mt-1 text-sm font-semibold text-text-primary">
                      {getShopItemName(a.itemType, a.quantityPerPurchase)}
                    </div>
                  </div>

                  <div className="rounded-lg bg-surface/60 px-3 py-2 space-y-1">
                    {a.maxPerPlayer > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Limit per player</span>
                        <span className="text-text-muted">{a.maxPerPlayer}</span>
                      </div>
                    )}
                    {a.maxPerDay > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Daily limit</span>
                        <span className="text-text-muted">{a.maxPerDay}</span>
                      </div>
                    )}
                    {!a.maxGlobalStock.eqn(0) && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Stock</span>
                        <span className={`text-text-muted ${a.currentGlobalStock.eqn(0) ? "text-red-400" : ""}`}>
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
                          <span className="text-text-muted line-through mr-1">{lamportsToSol(baseLamports)}</span>
                          <span className="text-green-400">{lamportsToSol(discountedLamports)} SOL</span>
                        </span>
                      ) : (
                        <span className="font-mono tabular-nums text-text-gold">{lamportsToSol(baseLamports)} SOL</span>
                      )}
                    </div>
                    {qty > 1 && (
                      <div className="mt-1 flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Total ({qty}x)</span>
                        <span className="font-mono tabular-nums text-text-gold">{lamportsToSol(unitPrice * qty)} SOL</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-text-muted">Quantity</label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setItemQuantities((prev) => ({ ...prev, [effectiveItem!]: Math.max(1, qty - 1) }))}
                        className="flex h-8 w-8 items-center justify-center rounded border border-zinc-700 text-sm text-text-muted hover:border-zinc-600"
                      >−</button>
                      <span className="w-8 text-center font-mono text-sm text-text-primary">{qty}</span>
                      <button
                        onClick={() => setItemQuantities((prev) => ({ ...prev, [effectiveItem!]: Math.min(100, qty + 1) }))}
                        className="flex h-8 w-8 items-center justify-center rounded border border-zinc-700 text-sm text-text-muted hover:border-zinc-600"
                      >+</button>
                    </div>
                  </div>

                  <TxButton
                    onClick={(rp) => handlePurchaseItem(effectiveItem!, qty, rp)}
                    className="w-full"
                    disabled={!hasStock}
                  >
                    {hasStock ? `Buy ${qty}x for ${lamportsToSol(unitPrice * qty)} SOL` : "Sold Out"}
                  </TxButton>
                </>
              );
            })()}
          </DetailPanel>
        </div>
      )}

      {/* Bundles Tab */}
      {activeTab === "bundles" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {!bundlesReady ? (
              <div className="card"><p className="text-sm text-text-muted">Loading caravan lots...</p></div>
            ) : activeBundles.length === 0 ? (
              <div className="card"><p className="text-sm text-text-muted">The caravan is carrying no lots at the moment.</p></div>
            ) : (
              <div className="grid gap-2 grid-cols-2">
                {activeBundles.map((bundle) => {
                  const b = bundle.account;
                  const isSelected = effectiveBundle === bundle.bundleId;
                  return (
                    <button
                      key={bundle.bundleId}
                      onClick={() => setSelectedBundle(bundle.bundleId)}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? "border-amber-600 bg-amber-900/20 ring-1 ring-amber-600/30"
                          : "border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-text-gold">Lot #{bundle.bundleId}</span>
                        {b.savingsBps > 0 && (
                          <span className="text-[10px] text-green-400">{(b.savingsBps / 100).toFixed(0)}% off</span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted">Tier {b.tier} &middot; {b.itemCount} items</div>
                      <div className="mt-1 text-xs text-text-gold">{lamportsToSol(b.priceSolLamports.toNumber())} SOL</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DetailPanel open={effectiveBundle != null} onClose={() => setSelectedBundle(null)}>
            {effectiveBundle != null && (() => {
              const bundle = activeBundles.find((b) => b.bundleId === effectiveBundle);
              if (!bundle) return null;
              const b = bundle.account;
              const solPrice = lamportsToSol(b.priceSolLamports.toNumber());
              return (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Caravan Lot</h3>
                    <button onClick={() => setSelectedBundle(null)} className="hidden rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary lg:block">Close</button>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-text-gold">Lot #{effectiveBundle}</div>
                    <div className="text-xs text-text-muted">
                      Tier {b.tier} &middot; {b.itemCount} items
                      {b.requiresSubscription > 0 && " \u00b7 Subscription required"}
                    </div>
                  </div>

                  {b.savingsBps > 0 && (
                    <div className="rounded-lg bg-green-900/20 px-3 py-1.5 text-xs font-semibold text-green-400">
                      {(b.savingsBps / 100).toFixed(0)}% savings
                    </div>
                  )}

                  <div className="rounded-lg bg-surface/60 px-3 py-2">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Contents</div>
                    <div className="space-y-1">
                      {b.items.map((bi) => {
                        const itemType = findItemType(activeItems, bi.itemId);
                        const info = getItemTypeInfo(itemType);
                        const matchingItem = activeItems.find((i) => i.itemId === bi.itemId);
                        const qty = matchingItem ? matchingItem.account.quantityPerPurchase * bi.quantity : bi.quantity;
                        return (
                          <div key={bi.itemId} className="flex items-center justify-between text-xs">
                            <span className="text-text-secondary">{info ? info.name : `Item #${bi.itemId}`}</span>
                            <span className="font-mono text-text-muted">x{qty}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-lg bg-surface/60 px-3 py-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Price</span>
                      <span className="font-mono tabular-nums text-text-gold">{solPrice} SOL</span>
                    </div>
                  </div>

                  <TxButton
                    onClick={(rp) => handlePurchaseBundle(effectiveBundle!, b.items, rp)}
                    className="w-full"
                  >
                    Purchase for {solPrice} SOL
                  </TxButton>
                </>
              );
            })()}
          </DetailPanel>
        </div>
      )}

      {/* Flash Sales Tab */}
      {activeTab === "flash" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {!flashSalesReady ? (
              <div className="card"><p className="text-sm text-text-muted">Loading passing trade...</p></div>
            ) : activeFlashSales.length === 0 ? (
              <div className="card text-center"><p className="text-text-muted">No merchant is passing through with a limited offer at the moment.</p></div>
            ) : (
              <div className="grid gap-2 grid-cols-2">
                {activeFlashSales.map((sale) => {
                  const s = sale.account;
                  const discountPct = (s.discountBps / 100).toFixed(0);
                  const isSelected = effectiveSale === sale.saleId;
                  const itemName = s.isBundle
                    ? `Lot #${s.itemId}`
                    : (() => {
                        const info = getItemTypeInfo(findItemType(activeItems, s.itemId));
                        return info ? info.name : `Item #${s.itemId}`;
                      })();
                  return (
                    <button
                      key={sale.saleId}
                      onClick={() => setSelectedSale(sale.saleId)}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? "border-red-600 bg-red-900/20 ring-1 ring-red-600/30"
                          : "border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase text-red-400">Passing Trade</span>
                        <span className="text-[10px] font-bold text-red-400">-{discountPct}%</span>
                      </div>
                      <div className="text-sm font-semibold text-text-primary truncate">{itemName}</div>
                      {s.remainingStock.eqn(0) && (
                        <div className="text-[10px] text-red-400">Sold Out</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DetailPanel open={effectiveSale != null} onClose={() => setSelectedSale(null)}>
            {effectiveSale != null && (() => {
              const sale = activeFlashSales.find((s) => s.saleId === effectiveSale);
              if (!sale) return null;
              const s = sale.account;
              const itemPda = s.isBundle
                ? deriveBundlePda(ge, s.itemId)[0]
                : deriveShopItemPda(ge, s.itemId)[0];
              const discountPct = (s.discountBps / 100).toFixed(0);
              const endsAtSec = s.endsAt.toNumber();
              const itemName = s.isBundle
                ? `Lot #${s.itemId}`
                : (() => {
                    const info = getItemTypeInfo(findItemType(activeItems, s.itemId));
                    return info ? info.name : `Item #${s.itemId}`;
                  })();
              return (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Passing Trade</h3>
                    <button onClick={() => setSelectedSale(null)} className="hidden rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary lg:block">Close</button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-text-primary">{itemName}</div>
                    <span className="rounded bg-red-900/30 px-2 py-0.5 text-sm font-bold text-red-400">-{discountPct}%</span>
                  </div>

                  <div className="rounded-lg bg-surface/60 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Stock</span>
                      <span className="text-text-muted">
                        {s.remainingStock.toString()}/{s.maxStock.toString()}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3 text-center">
                    <div className="text-xs text-text-muted">Offer ends</div>
                    <GoldCountdown endsAt={endsAtSec} startedAt={s.startsAt.toNumber()} format="compact" size="sm" />
                  </div>

                  <TxButton
                    onClick={(rp) => handlePurchaseFlashSale(effectiveSale!, itemPda, rp)}
                    className="w-full"
                    disabled={s.remainingStock.eqn(0)}
                  >
                    {s.remainingStock.eqn(0) ? "Sold Out" : `Buy for -${discountPct}%`}
                  </TxButton>
                </>
              );
            })()}
          </DetailPanel>
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
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {streakInfo && (
                <div className="flex items-center gap-2">
                  <span className="text-text-muted">Streak:</span>
                  <span className={`text-sm font-semibold ${streakInfo.streakDay >= 5 ? "text-amber-400" : streakInfo.streakDay >= 3 ? "text-green-400" : "text-text-secondary"}`}>
                    Day {streakInfo.streakDay}/7
                  </span>
                  {streakInfo.bonusBps > 0 && (
                    <span className="text-[11px] text-green-400">+{(streakInfo.bonusBps / 100).toFixed(0)}% bonus</span>
                  )}
                  {streakInfo.isResetting && (
                    <span className="text-[11px] text-amber-400">Streak reset</span>
                  )}
                </div>
              )}
              {dailyAllowance && (
                <div className="flex items-center gap-2">
                  <span className="text-text-muted">Daily limit:</span>
                  <span className={`text-sm font-semibold ${dailyAllowance.eqn(0) ? "text-red-400" : "text-text-gold"}`}>
                    {dailyAllowance.eqn(0) ? "Reached" : `${formatNoviAmount(dailyAllowance)} NOVI left`}
                  </span>
                </div>
              )}
            </div>
          )}

          {!gameEngine ? (
            <div className="card"><p className="text-sm text-text-muted">Loading...</p></div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className="grid gap-2 grid-cols-3 md:grid-cols-5">
                  {gameEngine.noviPurchaseConfig.noviPurchaseAmounts.map((amount, idx) => {
                    const tierInfo = NOVI_PACKAGE_TIERS[idx];
                    const noviAmount = amount.toNumber() / 10;
                    const bonusBps = gameEngine.noviPurchaseConfig.noviBulkBonusBps[idx] ?? 0;
                    const isSelected = effectivePackage === idx;
                    return (
                      <button
                        key={amount.toString()}
                        onClick={() => setSelectedPackage(idx)}
                        className={`rounded-lg border p-3 text-center transition-all ${
                          isSelected
                            ? "border-amber-600 bg-amber-900/20 ring-1 ring-amber-600/30"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        {tierInfo && (
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                            {tierInfo.name}
                          </div>
                        )}
                        <div className="text-lg font-semibold text-text-gold">
                          {noviAmount.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-text-muted">NOVI</div>
                        {bonusBps > 0 && (
                          <div className="mt-1 text-[10px] text-green-400">
                            +{(bonusBps / 100).toFixed(0)}%
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <DetailPanel open={effectivePackage != null} onClose={() => setSelectedPackage(null)}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Purchase Preview</h3>
                  <button onClick={() => setSelectedPackage(null)} className="hidden lg:block text-xs text-text-muted hover:text-text-secondary">Close</button>
                </div>

                {noviPreview && (
                  <div className="rounded-lg bg-surface/60 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Base amount</span>
                      <span className="text-text-secondary">{formatNoviAmount(noviPreview.baseAmount)} NOVI</span>
                    </div>
                    {!noviPreview.bulkBonus.eqn(0) && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Bulk bonus</span>
                        <span className="text-green-400">+{formatNoviAmount(noviPreview.bulkBonus)} NOVI</span>
                      </div>
                    )}
                    {!noviPreview.subscriptionBonus.eqn(0) && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Subscription bonus</span>
                        <span className="text-green-400">+{formatNoviAmount(noviPreview.subscriptionBonus)} NOVI</span>
                      </div>
                    )}
                    {!noviPreview.streakBonus.eqn(0) && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Streak (Day {streakInfo?.streakDay ?? 1})</span>
                        <span className="text-green-400">+{formatNoviAmount(noviPreview.streakBonus)} NOVI</span>
                      </div>
                    )}
                    {noviPreview.totalBonusBps > 0 && (
                      <div className="flex items-center justify-between text-xs border-t border-zinc-800 pt-1">
                        <span className="text-zinc-500">Total bonus</span>
                        <span className="text-green-400">+{(noviPreview.totalBonusBps / 100).toFixed(1)}%</span>
                      </div>
                    )}
                  </div>
                )}

                {noviPreview && (
                  <div className="rounded-lg bg-surface/60 px-3 py-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">You receive</span>
                      <span className="font-mono tabular-nums text-text-gold font-semibold">{formatNoviAmount(noviPreview.totalNovi)} NOVI</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Cost</span>
                      <span className="font-mono tabular-nums text-text-muted">{formatLamportsAsSol(noviPreview.costLamports)}</span>
                    </div>
                  </div>
                )}

                <div className="text-[10px] text-text-muted">
                  Base: {lamportsToSol(gameEngine.noviPurchaseConfig.noviBasePriceLamports.toNumber())} SOL/NOVI
                </div>

                <div className="rounded-md border border-amber-900/40 bg-amber-900/10 px-3 py-2 text-[10px] leading-relaxed text-amber-300/90">
                  Purchased NOVI is credited to your{" "}
                  <span className="font-semibold">Reserved</span> balance — not Locked.
                  Convert it to Locked NOVI (Dashboard, or Estate &rarr; Vault) before you
                  can spend it on gameplay.
                </div>

                <TxButton
                  onClick={handlePurchaseNovi}
                  className="w-full"
                  disabled={dailyAllowance?.eqn(0) ?? false}
                >
                  {dailyAllowance?.eqn(0)
                    ? "Daily limit reached"
                    : `Buy ${noviPreview ? formatNoviAmount(noviPreview.totalNovi) : "NOVI"}`}
                </TxButton>
              </DetailPanel>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

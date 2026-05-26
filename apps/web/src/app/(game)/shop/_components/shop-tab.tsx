"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useUser } from "@/lib/hooks/useUser";
import {
  useShopConfig,
  useShopItems,
  useBundles,
  useFlashSales,
  useDailyDeals,
  useWeeklySale,
  useSeasonalSale,
  useDaoPromotions,
  usePlayerPurchase,
} from "@/lib/hooks/useShop";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { TabNav } from "@/components/shared/TabNav";
import { NumberField } from "@/components/shared/NumberField";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
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
  isWeeklySaleActive,
  isSeasonalSaleActive,
  isDaoPromotionActive,
  applyBpsPenalty,
  getShopItemName,
  getItemTypeInfo,
  calculateNoviPurchasePreview,
  calculateNoviStreak,
  getRemainingDailyAllowance,
  formatNoviAmount,
  deciToNovi,
  formatLamportsAsSol,
  NOVI_PACKAGE_TIERS,
  calculateShopPrice,
  calculateFinalShopPrice,
  milestoneDiscountBps,
  streakDiscountBps,
  fibDiscountBps,
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
import { bpsToPercent, formatNumber, cn } from "@/lib/utils";
import {
  decodeCosmeticItemType,
  getCosmeticBadge,
  getCosmeticTitle,
  getCosmeticColor,
  getCosmeticFrame,
  cosmeticColorAnimationClass,
  RARITY_BORDER,
  type CosmeticRarity,
} from "@/lib/config/cosmetics-catalog";
import { CosmeticBadge } from "@/components/cosmetics/CosmeticBadge";
import { CosmeticBadgeChip } from "@/components/cosmetics/CosmeticBadgeChip";
import { CosmeticTitleChip } from "@/components/cosmetics/CosmeticTitleChip";
import { CosmeticFrame } from "@/components/cosmetics/CosmeticFrame";

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

// Gold-intensity rarity ladder: mundane tiers stay neutral grey, precious
// tiers climb through bronze -> gold -> bright gold. No off-palette hues.
const RARITY_COLORS: Record<number, string> = {
  [ShopItemRarity.Common]: "text-zinc-500",
  [ShopItemRarity.Uncommon]: "text-zinc-300",
  [ShopItemRarity.Rare]: "text-gold-600",
  [ShopItemRarity.Epic]: "text-gold-400",
  [ShopItemRarity.Legendary]: "text-gold-200",
};

function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4);
}

function findItemType(
  activeItems: { itemId: number; account: { itemType: number } }[],
  itemId: number,
): number {
  return activeItems.find((i) => i.itemId === itemId)?.account.itemType ?? -1;
}

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

/**
 * Hint shown after a NOVI purchase — purchased NOVI lands in the Reserved
 * balance and must be converted. Rendered once per breakpoint (the mobile and
 * desktop layouts place it at different points in the tree).
 */
function ReservedNoviNote({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md border border-border-gold/40 bg-accent/10 px-3 py-2 text-[10px] leading-relaxed text-text-gold w-full",
        className,
      )}
    >
      Purchased NOVI is credited to your <span className="font-semibold">Reserved Novi</span>{" "}
      balance. Convert it to Locked NOVI (Dashboard, or Vault in the Estate)
    </div>
  );
}

export function ShopTab() {
  const { data: playerData } = usePlayer();
  const { data: userData } = useUser();
  const { data: shopConfigData } = useShopConfig();
  const { data: geData } = useGameEngine();
  const { data: items, isSuccess: itemsReady } = useShopItems();
  const { data: bundles, isSuccess: bundlesReady } = useBundles();
  const { data: flashSales, isSuccess: flashSalesReady } = useFlashSales();
  const { data: dailyDeals, isSuccess: dailyDealsReady } = useDailyDeals();
  const { data: weeklySaleData } = useWeeklySale();
  const { data: seasonalSaleData } = useSeasonalSale();
  const { data: daoPromotions } = useDaoPromotions();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  // Wallet SOL balance (lamports) — caps how many SOL-priced wares are affordable.
  const { data: solLamports = 0 } = useQuery({
    queryKey: ["solBalance", publicKey?.toBase58()],
    queryFn: () => connection.getBalance(publicKey!),
    enabled: !!publicKey,
    staleTime: 30_000,
  });
  const transact = useTransact();

  const player = playerData?.account;
  const user = userData?.account;
  const gameEngine = geData?.account;
  const shopConfig = shopConfigData?.account;
  const ge = client.gameEngine;

  const [activeTab, setActiveTab] = useState("novi");
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [itemQuantities, setItemQuantities] = useState<Record<number, number>>({});
  // Sub-filter inside the Cosmetics tab — drilling into one kind at a
  // time keeps the grid scannable. "all" surfaces the full catalog for
  // first-time browsing; tapping a kind narrows.
  const [cosmeticKind, setCosmeticKind] = useState<
    "all" | "badge" | "title" | "color" | "frame"
  >("all");

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(window.innerWidth >= 1024);
  }, []);
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<number | null>(null);
  const [selectedSale, setSelectedSale] = useState<number | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<number | null>(null);
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
    return calculateNoviStreak(user.noviLastPurchaseDay, user.noviPurchaseStreak, nowSec);
  }, [user, nowSec]);

  // Remaining daily allowance
  const dailyAllowance = useMemo(() => {
    if (!gameEngine || !player || !user) return null;
    const config = gameEngine.noviPurchaseConfig;
    const tier = getEffectiveTier(player, nowSec);
    return getRemainingDailyAllowance(user.noviPurchasedToday, tier, config);
  }, [gameEngine, player, user, nowSec]);

  const handlePurchaseItem = async (
    itemId: number,
    quantity: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Purchased x${quantity}!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handlePurchaseBundle = async (
    bundleId: number,
    bundleItems: { itemId: number }[],
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey || !gameEngine) throw new Error("Not ready");
    const shopItemAccounts = bundleItems.map((bi) => deriveShopItemPda(ge, bi.itemId)[0]);
    const ix = createPurchaseBundleInstruction({
      buyer: publicKey,
      gameEngine: ge,
      bundleId,
      treasury: gameEngine.treasuryWallet,
      shopItemAccounts,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Bundle purchased!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handlePurchaseFlashSale = async (
    saleId: number,
    itemOrBundle: PublicKey,
    reportPhase: (p: TxPhase) => void,
  ) => {
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Flash sale purchased!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handlePurchaseDailyDeal = async (
    itemId: number,
    slot: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey || !gameEngine) throw new Error("Not ready");
    const ix = createPurchaseItemInstruction(
      {
        buyer: publicKey,
        gameEngine: ge,
        itemId,
        treasury: gameEngine.treasuryWallet,
      },
      // discountFlags bit 0 = apply daily deal; dailyDealSlot selects which slot.
      { quantity: 1, discountFlags: 1, dailyDealSlot: slot },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Daily deal claimed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Purchased ${amount} NOVI — credited to your Reserved balance.`,
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

  // Cosmetic items: itemType in 1000-1255 routes through fulfill_item's
  // CosmeticsSection branches (badges/titles/colors/frames). Same purchase
  // ix as other wares — split out into its own tab so non-CLI players can
  // actually find them.
  const cosmeticItems = useMemo(() => {
    return activeItems
      .map((i) => {
        const decoded = decodeCosmeticItemType(i.account.itemType);
        return decoded ? { ...i, cosmetic: decoded } : null;
      })
      .filter((i): i is NonNullable<typeof i> => i !== null);
  }, [activeItems]);

  // Per-kind counts power the sub-filter row's badge numbers.
  const cosmeticCounts = useMemo(() => {
    const out = { all: cosmeticItems.length, badge: 0, title: 0, color: 0, frame: 0 };
    for (const i of cosmeticItems) {
      if (i.cosmetic.kind === "badge") out.badge++;
      else if (i.cosmetic.kind === "title") out.title++;
      else if (i.cosmetic.kind === "color") out.color++;
      else if (i.cosmetic.kind === "frame") out.frame++;
    }
    return out;
  }, [cosmeticItems]);

  // Items in the active sub-filter — narrowed to one kind unless "all".
  const filteredCosmetics = useMemo(() => {
    if (cosmeticKind === "all") return cosmeticItems;
    return cosmeticItems.filter((i) => i.cosmetic.kind === cosmeticKind);
  }, [cosmeticItems, cosmeticKind]);
  // Non-cosmetic items in the regular Wares tab.
  const nonCosmeticItems = useMemo(
    () => activeItems.filter((i) => decodeCosmeticItemType(i.account.itemType) === null),
    [activeItems],
  );

  const activeBundles = useMemo(() => {
    return bundles
      .map((b) => ({ ...b, bundleId: bundleIdMap.get(b.pubkey.toBase58()) }))
      .filter(
        (b): b is typeof b & { bundleId: number } => b.bundleId !== undefined && b.account.isActive,
      );
  }, [bundles, bundleIdMap]);

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

  // On desktop, default to first entry so the sidebar is always populated.
  // The default is tab-scoped: the Cosmetics tab seeds from cosmeticItems
  // and the Wares tab from nonCosmeticItems — otherwise activeItems[0]
  // might be a cosmetic while the user is on Wares (or vice versa),
  // surfacing a card the grid doesn't render and a Buy button that
  // priced the wrong category.
  const desktopDefaultItem = (() => {
    if (!isDesktop) return null;
    if (activeTab === "cosmetics") return filteredCosmetics[0]?.itemId ?? null;
    if (activeTab === "items") return nonCosmeticItems[0]?.itemId ?? null;
    return activeItems[0]?.itemId ?? null;
  })();
  const effectiveItem = selectedItem ?? desktopDefaultItem;
  const effectiveBundle =
    selectedBundle ?? (isDesktop && activeBundles.length > 0 ? activeBundles[0].bundleId : null);
  const effectiveSale =
    selectedSale ?? (isDesktop && activeFlashSales.length > 0 ? activeFlashSales[0].saleId : null);
  const effectiveDeal =
    selectedDeal ?? (isDesktop && activeDailyDeals.length > 0 ? activeDailyDeals[0].slot : null);
  const itemPurchase = usePlayerPurchase(effectiveItem);

  const morphActions = useMemo<PanelAction[] | null>(() => {
    if (activeTab === "items" && effectiveItem != null) {
      const item = activeItems.find((i) => i.itemId === effectiveItem);
      if (!item) return null;
      const hasStock = item.account.maxGlobalStock.eqn(0) || item.account.currentGlobalStock.gtn(0);
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
    if (activeTab === "cosmetics" && effectiveItem != null) {
      const item = cosmeticItems.find((i) => i.itemId === effectiveItem);
      if (!item) return null;
      const a = item.account;
      const hasStock = a.maxGlobalStock.eqn(0) || a.currentGlobalStock.gtn(0);
      const dayNow = Math.floor(nowSec / 86400);
      const lifetimeBought = itemPurchase ? itemPurchase.lifetimePurchased.toNumber() : 0;
      const todayBought =
        itemPurchase && itemPurchase.lastPurchaseDay.toNumber() === dayNow
          ? itemPurchase.purchasedToday.toNumber()
          : 0;
      const { kind, id } = item.cosmetic;
      const ownedMask =
        kind === "badge"
          ? player?.ownedBadges
          : kind === "title"
            ? player?.ownedTitles
            : kind === "color"
              ? player?.ownedColors
              : kind === "frame"
                ? player?.ownedFrames
                : null;
      const alreadyOwned = !!ownedMask?.testn?.(id);
      const lifetimeCapped =
        alreadyOwned || (a.maxPerPlayer > 0 && lifetimeBought >= a.maxPerPlayer);
      const dailyCapped = a.maxPerDay > 0 && todayBought >= a.maxPerDay;
      const limitReached = lifetimeCapped || dailyCapped;
      return [
        {
          id: `buy-cosmetic-${effectiveItem}`,
          label: !hasStock
            ? "Sold Out"
            : lifetimeCapped
              ? "Already owned"
              : dailyCapped
                ? "Daily limit reached"
                : "Buy",
          variant: "primary",
          disabled: !hasStock || limitReached,
          onClick: (rp) => handlePurchaseItem(effectiveItem, 1, rp),
        },
      ];
    }
    if (activeTab === "bundles" && effectiveBundle != null) {
      const bundle = activeBundles.find((b) => b.bundleId === effectiveBundle);
      if (!bundle) return null;
      // Bundles don't track global stock — gate on `isActive` + time window.
      const nowSec = Math.floor(Date.now() / 1000);
      const available =
        bundle.account.isActive &&
        bundle.account.availableFrom.toNumber() <= nowSec &&
        (bundle.account.availableUntil.eqn(0) ||
          bundle.account.availableUntil.toNumber() >= nowSec);
      return [
        {
          id: `buy-bundle-${effectiveBundle}`,
          label: available ? "Buy Bundle" : "Unavailable",
          variant: "primary",
          disabled: !available,
          onClick: (rp) => handlePurchaseBundle(effectiveBundle, bundle.account.items, rp),
        },
      ];
    }
    if (activeTab === "flash" && effectiveSale != null) {
      const sale = activeFlashSales.find((s) => s.saleId === effectiveSale);
      if (!sale) return null;
      const s = sale.account;
      const hasStock = s.maxStock.eqn(0) || s.remainingStock.gtn(0);
      const itemPda = s.isBundle
        ? deriveBundlePda(ge, s.itemId)[0]
        : deriveShopItemPda(ge, s.itemId)[0];
      return [
        {
          id: `buy-flash-${effectiveSale}`,
          label: hasStock ? "Claim Flash Sale" : "Sold Out",
          variant: "primary",
          disabled: !hasStock,
          onClick: (rp) => handlePurchaseFlashSale(effectiveSale, itemPda, rp),
        },
      ];
    }
    if (activeTab === "daily" && effectiveDeal != null) {
      const deal = activeDailyDeals.find((d) => d.slot === effectiveDeal);
      if (!deal) return null;
      const hasStock =
        deal.item.account.maxGlobalStock.eqn(0) || deal.item.account.currentGlobalStock.gtn(0);
      return [
        {
          id: `claim-deal-${effectiveDeal}`,
          label: hasStock ? "Claim Deal" : "Sold Out",
          variant: "primary",
          disabled: !hasStock,
          onClick: (rp) => handlePurchaseDailyDeal(deal.item.itemId, deal.slot, rp),
        },
      ];
    }
    if (activeTab === "novi" && selectedPackage != null) {
      const limitReached = dailyAllowance?.eqn(0) ?? false;
      return [
        {
          id: `buy-novi-${selectedPackage}`,
          label: limitReached ? "Daily limit reached" : "Buy NOVI",
          variant: "primary",
          disabled: limitReached,
          onClick: handlePurchaseNovi,
        },
      ];
    }
    return null;
  }, [
    activeTab,
    effectiveItem,
    effectiveBundle,
    effectiveSale,
    effectiveDeal,
    selectedPackage,
    activeItems,
    cosmeticItems,
    activeBundles,
    activeFlashSales,
    activeDailyDeals,
    itemQuantities,
    itemPurchase,
    nowSec,
    player,
    dailyAllowance,
    handlePurchaseItem,
    handlePurchaseBundle,
    handlePurchaseFlashSale,
    handlePurchaseDailyDeal,
    handlePurchaseNovi,
    ge,
  ]);
  useMorphActions(morphActions);

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
                <GoldNumber value={player.cashOnHand.toNumber()} format="compact" />
              </span>
            </div>
            <div>
              <div className="text-xs text-text-muted">Gems</div>
              <span className="inline-flex items-center gap-1">
                <GameIcon id="resource-gem" size={14} />
                <GoldNumber value={player.gems.toNumber()} />
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
                {timeInfo.isGolden ? "\u2726 " : ""}
                {timeInfo.name}
              </span>
              {timeInfo.purchasingMult > 1.05 ? (
                <span className="text-[11px] text-text-gold">
                  Purchasing bonus active ({((timeInfo.purchasingMult - 1) * 100).toFixed(0)}%
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
        onTabChange={(tab) => {
          // Reset category-local selection so e.g. a cosmetic itemId picked on
          // the Cosmetics tab doesn't continue to drive the Wares-tab detail
          // panel after a flip (and vice versa).
          setActiveTab(tab);
          setSelectedItem(null);
        }}
      />

      {/* Items Tab */}
      {activeTab === "items" && (
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
              <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
                {nonCosmeticItems.map((item) => {
                  const a = item.account;
                  const isSelected = effectiveItem === item.itemId;
                  return (
                    <button
                      key={item.itemId}
                      onClick={() => setSelectedItem(item.itemId)}
                      className={`rounded-lg border p-3 text-left transition-all ${
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
            {effectiveItem != null &&
              (() => {
                const item = activeItems.find((i) => i.itemId === effectiveItem);
                if (!item) return null;
                const a = item.account;
                const baseLamports = a.priceSolLamports.toNumber();
                const hasStock = a.maxGlobalStock.eqn(0) || a.currentGlobalStock.gtn(0);
                const subTier = player ? getEffectiveTier(player, nowSec) : 0;
                // Mirror chain `calculate_final_price`: stack subscription ×
                // milestone × streak × fib × market multiplicatively (in that
                // order). Previously this only applied the milestone bps as
                // if they were sub discount, which produced a strike-through
                // price the chain never charged.
                const discountedLamports = shopConfig && player
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
                const lifetimeBought = itemPurchase ? itemPurchase.lifetimePurchased.toNumber() : 0;
                const todayBought =
                  itemPurchase && itemPurchase.lastPurchaseDay.toNumber() === dayNow
                    ? itemPurchase.purchasedToday.toNumber()
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
                      {!a.maxGlobalStock.eqn(0) && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Stock</span>
                          <span
                            className={`text-text-muted ${a.currentGlobalStock.eqn(0) ? "text-red-400" : ""}`}
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
                      onChange={(n) =>
                        setItemQuantities((prev) => ({ ...prev, [effectiveItem!]: n }))
                      }
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
      )}

      {/* Cosmetics Tab */}
      {activeTab === "cosmetics" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
            {/* Sub-filter row — narrows the grid to one cosmetic kind so
                40 items don't crowd a single view. Counts in each pill
                hint how much catalog density each kind has. */}
            <TabNav
              tabs={[
                { key: "all", label: `All · ${cosmeticCounts.all}` },
                { key: "badge", label: `Badges · ${cosmeticCounts.badge}` },
                { key: "title", label: `Titles · ${cosmeticCounts.title}` },
                { key: "color", label: `Name Colors · ${cosmeticCounts.color}` },
                { key: "frame", label: `Frames · ${cosmeticCounts.frame}` },
              ]}
              activeTab={cosmeticKind}
              onTabChange={(k) =>
                setCosmeticKind(k as "all" | "badge" | "title" | "color" | "frame")
              }
            />
            {!itemsReady ? (
              <div className="card">
                <p className="text-sm text-text-muted">Loading cosmetics...</p>
              </div>
            ) : filteredCosmetics.length === 0 ? (
              <div className="card">
                <p className="text-sm text-text-muted">
                  {cosmeticKind === "all"
                    ? "No cosmetics currently on offer."
                    : `No ${cosmeticKind} cosmetics in the catalog yet.`}
                </p>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                {filteredCosmetics.map((item) => {
                  const a = item.account;
                  const isSelected = effectiveItem === item.itemId;
                  const { kind, id } = item.cosmetic;
                  const badge = kind === "badge" ? getCosmeticBadge(id) : null;
                  const title = kind === "title" ? getCosmeticTitle(id) : null;
                  const color = kind === "color" ? getCosmeticColor(id) : null;
                  const frame = kind === "frame" ? getCosmeticFrame(id) : null;
                  const rarity: CosmeticRarity =
                    badge?.rarity ?? title?.rarity ?? color?.rarity ?? frame?.rarity ?? "common";
                  const name =
                    badge?.name ?? title?.displayName ?? color?.name ?? frame?.name ?? "Unknown";
                  // Ownership bitmask check — one bit per id. The chain's
                  // `fulfill_item` cosmetic branch flips `owned_<kind> |= 1<<id`
                  // on purchase, and the shop's `max_per_player=1` cap means
                  // a re-buy would be rejected as `PurchaseLimitReached`.
                  // Reflect that here so the tile reads "Owned" instead of
                  // letting the user click into a doomed Buy.
                  const ownedMask =
                    kind === "badge"
                      ? player?.ownedBadges
                      : kind === "title"
                        ? player?.ownedTitles
                        : kind === "color"
                          ? player?.ownedColors
                          : kind === "frame"
                            ? player?.ownedFrames
                            : null;
                  const owned = !!ownedMask?.testn?.(id);
                  const soldOut = !a.maxGlobalStock.eqn(0) && a.currentGlobalStock.eqn(0);
                  return (
                    <button
                      key={item.itemId}
                      onClick={() => setSelectedItem(item.itemId)}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? "border-border-gold bg-accent/20 ring-1 ring-border-gold/30"
                          : "border-zinc-800 hover:border-zinc-700"
                      }`}
                      style={{
                        borderColor: isSelected ? undefined : RARITY_BORDER[rarity],
                        opacity: owned ? 0.55 : 1,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {badge ? (
                          <CosmeticBadge id={id} size={36} />
                        ) : color ? (
                          <span
                            aria-hidden
                            className={cosmeticColorAnimationClass(color) ?? undefined}
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 6,
                              border: `2px solid ${RARITY_BORDER[rarity]}`,
                              background:
                                color.animation === "vesper" ? "currentColor" : color.hex,
                              color: color.hex,
                              flexShrink: 0,
                            }}
                          />
                        ) : frame ? (
                          <CosmeticFrame id={id} size={36}>
                            <span
                              aria-hidden
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: "50%",
                                background: "var(--readout-tint, #efe2c4)",
                              }}
                            />
                          </CosmeticFrame>
                        ) : (
                          <span
                            aria-hidden
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 6,
                              border: `2px solid ${RARITY_BORDER[rarity]}`,
                              display: "grid",
                              placeItems: "center",
                              fontWeight: 700,
                              color: RARITY_BORDER[rarity],
                              flexShrink: 0,
                            }}
                          >
                            T
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] uppercase tracking-wider" style={{ color: RARITY_BORDER[rarity] }}>
                            {rarity} {kind}
                          </div>
                          <div className="text-sm font-semibold text-text-primary truncate">
                            {name}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-text-gold">
                        {lamportsToSol(a.priceSolLamports.toNumber())} SOL
                      </div>
                      {owned ? (
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--seal)" }}>
                          Owned
                        </div>
                      ) : soldOut ? (
                        <div className="text-[10px] text-red-400">Sold Out</div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DetailPanel open={effectiveItem != null} onClose={() => setSelectedItem(null)}>
            {effectiveItem != null &&
              (() => {
                const item = cosmeticItems.find((i) => i.itemId === effectiveItem);
                if (!item) return null;
                const a = item.account;
                const baseLamports = a.priceSolLamports.toNumber();
                const hasStock = a.maxGlobalStock.eqn(0) || a.currentGlobalStock.gtn(0);
                const subTier = player ? getEffectiveTier(player, nowSec) : 0;
                // Mirror chain `calculate_final_price`: stack subscription ×
                // milestone × streak × fib × market multiplicatively (in that
                // order). Previously this only applied the milestone bps as
                // if they were sub discount, which produced a strike-through
                // price the chain never charged.
                const discountedLamports = shopConfig && player
                  ? calculateFinalShopPrice(baseLamports, {
                      subscriptionTier: subTier,
                      milestoneDiscountBps: milestoneDiscountBps(player.totalShopSpent, shopConfig),
                      loyaltyDiscountBps: streakDiscountBps(player.loyaltyStreak, shopConfig),
                      fibDiscountBps: fibDiscountBps(player.dailyPurchaseCount, shopConfig),
                      maxTotalDiscountBps: shopConfig.maxTotalDiscountBps,
                    })
                  : baseLamports;
                const hasDiscount = discountedLamports < baseLamports;
                const dayNow = Math.floor(nowSec / 86400);
                const lifetimeBought = itemPurchase ? itemPurchase.lifetimePurchased.toNumber() : 0;
                const todayBought =
                  itemPurchase && itemPurchase.lastPurchaseDay.toNumber() === dayNow
                    ? itemPurchase.purchasedToday.toNumber()
                    : 0;
                const { kind, id } = item.cosmetic;
                const badge = kind === "badge" ? getCosmeticBadge(id) : null;
                const title = kind === "title" ? getCosmeticTitle(id) : null;
                const color = kind === "color" ? getCosmeticColor(id) : null;
                const frame = kind === "frame" ? getCosmeticFrame(id) : null;
                // Authoritative "already owned" — the chain's owned_<kind>
                // bitmask is on the player account and doesn't need a
                // PlayerPurchase fetch. lifetime cap from player_purchase
                // is the redundant signal that catches re-buy attempts
                // when max_per_player > 1 (shouldn't happen for cosmetics
                // but the check is cheap).
                const ownedMask =
                  kind === "badge"
                    ? player?.ownedBadges
                    : kind === "title"
                      ? player?.ownedTitles
                      : kind === "color"
                        ? player?.ownedColors
                        : kind === "frame"
                          ? player?.ownedFrames
                          : null;
                const alreadyOwned = !!ownedMask?.testn?.(id);
                const lifetimeCapped =
                  alreadyOwned || (a.maxPerPlayer > 0 && lifetimeBought >= a.maxPerPlayer);
                const dailyCapped = a.maxPerDay > 0 && todayBought >= a.maxPerDay;
                const limitReached = lifetimeCapped || dailyCapped;
                const rarity: CosmeticRarity =
                  badge?.rarity ?? title?.rarity ?? color?.rarity ?? frame?.rarity ?? "common";
                const name =
                  badge?.name ?? title?.displayName ?? color?.name ?? frame?.name ?? "Unknown";
                const flavor = badge?.flavorText ?? frame?.flavorText ?? null;

                // Preview uses the player's own on-chain name — verbatim,
                // including the chain's default "Player #N". Hardcoding a
                // placeholder buries the user's actual identity and is
                // straight wrong; "Your name" is the fallback when the
                // account itself hasn't loaded yet.
                const previewName = player?.name?.trim() || "Your name";
                const colorAnimClass = color ? cosmeticColorAnimationClass(color) : null;
                // "Visible on" surfaces this cosmetic shows up in once
                // equipped. Helps justify the spend by naming the places
                // every other player will see it.
                const visibleOn: string[] =
                  kind === "color"
                    ? ["Map dot", "Walk line + marker", "Inspection label", "Hover tooltip", "EntityPanel name"]
                    : kind === "frame"
                      ? ["Map dot stroke + glow", "Walk marker ring", "Hover tooltip", "EntityPanel level pip"]
                      : kind === "title"
                        ? ["Inspection label", "Hover tooltip", "EntityPanel chip"]
                        : ["Hover tooltip", "EntityPanel chip"];

                return (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Cosmetic</h3>
                      <button
                        onClick={() => setSelectedItem(null)}
                        className="hidden rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary lg:block"
                      >
                        Close
                      </button>
                    </div>

                    {/* ── Preview block ───────────────────────────────
                        Composes the cosmetic the way it will actually
                        render once equipped, so the player can see what
                        they're buying instead of a static catalog tile. */}
                    <div
                      className="rounded-lg px-3 py-4 flex flex-col items-center gap-2"
                      style={{
                        background: "var(--readout-tint, rgba(239, 226, 196, 0.4))",
                        border: `1px solid ${RARITY_BORDER[rarity]}`,
                      }}
                    >
                      {color ? (
                        <>
                          <span
                            className={colorAnimClass ?? undefined}
                            style={{
                              fontSize: "1.35rem",
                              fontWeight: 700,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: color.hex,
                              fontFamily: "var(--font-cinzel), serif",
                            }}
                          >
                            {previewName}
                          </span>
                          <span
                            aria-hidden
                            className={colorAnimClass ?? undefined}
                            style={{
                              width: 100,
                              height: 8,
                              borderRadius: 4,
                              background:
                                color.animation === "vesper" ? "currentColor" : color.hex,
                              color: color.hex,
                              border: `1px solid ${RARITY_BORDER[rarity]}`,
                            }}
                          />
                          <span className="text-[10px] italic text-text-muted">
                            {color.animation
                              ? "Pulses on your name + dot + walk line"
                              : "Your name color on every surface"}
                          </span>
                        </>
                      ) : badge ? (
                        <>
                          <CosmeticBadge id={id} size={80} />
                          <div className="mt-1">
                            <CosmeticBadgeChip id={id} />
                          </div>
                          <span className="text-[10px] italic text-text-muted">
                            Shown beside your name on every panel
                          </span>
                        </>
                      ) : frame ? (
                        <>
                          {/* Frame previewed wrapping the player's CURRENTLY
                              equipped badge (or a placeholder when none), so
                              the user sees how their composed identity
                              changes when they pay for the frame. */}
                          <CosmeticFrame id={id} size={88}>
                            {player?.equippedBadge ? (
                              <CosmeticBadge id={player.equippedBadge} size={56} />
                            ) : (
                              <span
                                aria-hidden
                                style={{
                                  width: 56,
                                  height: 56,
                                  borderRadius: "50%",
                                  background: "var(--readout-tint, #efe2c4)",
                                  display: "grid",
                                  placeItems: "center",
                                  color: "var(--ink-soft)",
                                  fontSize: "0.6rem",
                                  letterSpacing: "0.18em",
                                  textTransform: "uppercase",
                                }}
                              >
                                avatar
                              </span>
                            )}
                          </CosmeticFrame>
                          <span className="text-[10px] italic text-text-muted">
                            Wraps your avatar on the dot, walk marker, + panels
                          </span>
                        </>
                      ) : title ? (
                        <>
                          <div
                            style={{
                              fontSize: "1.15rem",
                              fontWeight: 700,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: "var(--ink)",
                              fontFamily: "var(--font-cinzel), serif",
                              textAlign: "center",
                            }}
                          >
                            {previewName} · {title.displayName}
                          </div>
                          <div className="mt-1">
                            <CosmeticTitleChip id={id} />
                          </div>
                          <span className="text-[10px] italic text-text-muted">
                            Appears beside your name on the map + panels
                          </span>
                        </>
                      ) : null}
                    </div>

                    {/* Identity / lore line. Pre-existing rarity + name +
                        flavor moved underneath the preview so the eye
                        lands on the preview first. */}
                    <div>
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: RARITY_BORDER[rarity] }}>
                        {rarity} {kind}
                      </div>
                      <div className="text-sm font-semibold text-text-primary">{name}</div>
                      {flavor && (
                        <div className="mt-1 text-xs italic text-text-muted">{flavor}</div>
                      )}
                    </div>

                    {/* "Visible on" — names the surfaces every other
                        player will see this cosmetic on. Concrete value
                        comms beats abstract rarity. */}
                    <div className="rounded-lg bg-surface/60 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                        Visible on
                      </div>
                      <div className="text-xs text-text-secondary leading-relaxed">
                        {visibleOn.join(" · ")}
                      </div>
                    </div>

                    {(a.maxPerPlayer > 0 || a.maxPerDay > 0 || !a.maxGlobalStock.eqn(0)) && (
                      <div className="rounded-lg bg-surface/60 px-3 py-2 space-y-1">
                        {a.maxPerPlayer > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Owned</span>
                            <span className={`text-text-muted ${lifetimeCapped ? "text-red-400" : ""}`}>
                              {lifetimeBought}/{a.maxPerPlayer}
                            </span>
                          </div>
                        )}
                        {a.maxPerDay > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Bought today</span>
                            <span className={`text-text-muted ${dailyCapped ? "text-red-400" : ""}`}>
                              {todayBought}/{a.maxPerDay}
                            </span>
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
                    )}

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
                    </div>

                    <TxButton
                      onClick={(rp) => handlePurchaseItem(effectiveItem!, 1, rp)}
                      className="hidden w-full lg:block"
                      disabled={!hasStock || limitReached}
                    >
                      {!hasStock
                        ? "Sold Out"
                        : lifetimeCapped
                          ? "Already owned"
                          : dailyCapped
                            ? "Daily limit reached"
                            : `Buy ${lamportsToSol(hasDiscount ? discountedLamports : baseLamports)} SOL`}
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
              <div className="card">
                <p className="text-sm text-text-muted">Loading caravan lots...</p>
              </div>
            ) : activeBundles.length === 0 ? (
              <div className="card">
                <p className="text-sm text-text-muted">
                  The caravan is carrying no lots at the moment.
                </p>
              </div>
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
                          ? "border-border-gold bg-accent/20 ring-1 ring-border-gold/30"
                          : "border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-text-gold">
                          Lot #{bundle.bundleId}
                        </span>
                        {b.savingsBps > 0 && (
                          <span className="text-[10px] text-text-gold">
                            {(b.savingsBps / 100).toFixed(0)}% off
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted">
                        Tier {b.tier} &middot; {b.itemCount} items
                      </div>
                      <div className="mt-1 text-xs text-text-gold">
                        {lamportsToSol(b.priceSolLamports.toNumber())} SOL
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DetailPanel open={effectiveBundle != null} onClose={() => setSelectedBundle(null)}>
            {effectiveBundle != null &&
              (() => {
                const bundle = activeBundles.find((b) => b.bundleId === effectiveBundle);
                if (!bundle) return null;
                const b = bundle.account;
                const solPrice = lamportsToSol(b.priceSolLamports.toNumber());
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Caravan Lot
                      </h3>
                      <button
                        onClick={() => setSelectedBundle(null)}
                        className="hidden rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary lg:block"
                      >
                        Close
                      </button>
                    </div>

                    <div>
                      <div className="text-sm font-semibold text-text-gold">
                        Lot #{effectiveBundle}
                      </div>
                      <div className="text-xs text-text-muted">
                        Tier {b.tier} &middot; {b.itemCount} items
                        {b.requiresSubscription > 0 && " \u00b7 Subscription required"}
                      </div>
                    </div>

                    {b.savingsBps > 0 && (
                      <div className="rounded-lg bg-accent/20 px-3 py-1.5 text-xs font-semibold text-text-gold">
                        {(b.savingsBps / 100).toFixed(0)}% savings
                      </div>
                    )}

                    <div className="rounded-lg bg-surface/60 px-3 py-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                        Contents
                      </div>
                      <div className="space-y-1">
                        {b.items.map((bi) => {
                          const itemType = findItemType(activeItems, bi.itemId);
                          const info = getItemTypeInfo(itemType);
                          const matchingItem = activeItems.find((i) => i.itemId === bi.itemId);
                          const qty = matchingItem
                            ? matchingItem.account.quantityPerPurchase * bi.quantity
                            : bi.quantity;
                          return (
                            <div
                              key={bi.itemId}
                              className="flex items-center justify-between text-xs"
                            >
                              <span className="text-text-secondary">
                                {info ? info.name : `Item #${bi.itemId}`}
                              </span>
                              <span className="font-mono text-text-muted">x{qty}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-lg bg-surface/60 px-3 py-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Price</span>
                        <span className="font-mono tabular-nums text-text-gold">
                          {solPrice} SOL
                        </span>
                      </div>
                    </div>

                    <TxButton
                      onClick={(rp) => handlePurchaseBundle(effectiveBundle!, b.items, rp)}
                      className="hidden w-full lg:block"
                    >
                      Purchase
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
              <div className="card">
                <p className="text-sm text-text-muted">Loading passing trade...</p>
              </div>
            ) : activeFlashSales.length === 0 ? (
              <div className="card text-center">
                <p className="text-text-muted">
                  No merchant is passing through with a limited offer at the moment.
                </p>
              </div>
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
                        <span className="text-[10px] font-semibold uppercase text-red-400">
                          Passing Trade
                        </span>
                        <span className="text-[10px] font-bold text-red-400">-{discountPct}%</span>
                      </div>
                      <div className="text-sm font-semibold text-text-primary truncate">
                        {itemName}
                      </div>
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
            {effectiveSale != null &&
              (() => {
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
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Passing Trade
                      </h3>
                      <button
                        onClick={() => setSelectedSale(null)}
                        className="hidden rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary lg:block"
                      >
                        Close
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-text-primary">{itemName}</div>
                      <span className="rounded bg-red-900/30 px-2 py-0.5 text-sm font-bold text-red-400">
                        -{discountPct}%
                      </span>
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
                      <GoldCountdown
                        endsAt={endsAtSec}
                        startedAt={s.startsAt.toNumber()}
                        format="compact"
                        size="sm"
                      />
                    </div>

                    <TxButton
                      onClick={(rp) => handlePurchaseFlashSale(effectiveSale!, itemPda, rp)}
                      className="hidden w-full lg:block"
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

      {/* Daily Deals Tab */}
      {activeTab === "daily" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {!dailyDealsReady ? (
              <div className="card">
                <p className="text-sm text-text-muted">Loading daily deals...</p>
              </div>
            ) : activeDailyDeals.length === 0 ? (
              <div className="card">
                <p className="text-sm text-text-muted">
                  No deals on the table today. Check back tomorrow.
                </p>
              </div>
            ) : (
              <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
                {activeDailyDeals.map((deal) => {
                  const a = deal.item.account;
                  const isSelected = effectiveDeal === deal.slot;
                  const base = a.priceSolLamports.toNumber();
                  const dealLamports = applyBpsPenalty(base, deal.account.discountBps);
                  const discountPct = (deal.account.discountBps / 100).toFixed(0);
                  return (
                    <button
                      key={deal.slot}
                      onClick={() => setSelectedDeal(deal.slot)}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? "border-border-gold bg-accent/20 ring-1 ring-border-gold/30"
                          : "border-border-gold/40 hover:border-border-gold/60"
                      }`}
                    >
                      <span className="text-[10px] font-semibold uppercase text-text-gold">
                        −{discountPct}% today
                      </span>
                      <div className="text-sm font-semibold text-text-primary truncate">
                        {getShopItemName(a.itemType, a.quantityPerPurchase)}
                      </div>
                      <div className="mt-1 text-xs">
                        <span className="text-text-muted line-through mr-1">
                          {lamportsToSol(base)}
                        </span>
                        <span className="text-text-gold">{lamportsToSol(dealLamports)} SOL</span>
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

          <DetailPanel open={effectiveDeal != null} onClose={() => setSelectedDeal(null)}>
            {effectiveDeal != null &&
              (() => {
                const deal = activeDailyDeals.find((d) => d.slot === effectiveDeal);
                if (!deal) return null;
                const a = deal.item.account;
                const base = a.priceSolLamports.toNumber();
                const dealLamports = applyBpsPenalty(base, deal.account.discountBps);
                const discountPct = (deal.account.discountBps / 100).toFixed(0);
                const hasStock = a.maxGlobalStock.eqn(0) || a.currentGlobalStock.gtn(0);
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Daily Deal
                      </h3>
                      <button
                        onClick={() => setSelectedDeal(null)}
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
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Deal discount</span>
                        <span className="text-text-gold">−{discountPct}%</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Claimed today</span>
                        <span className="text-text-muted">
                          {deal.account.purchasesToday.toString()}
                        </span>
                      </div>
                      {!a.maxGlobalStock.eqn(0) && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Stock</span>
                          <span
                            className={`text-text-muted ${a.currentGlobalStock.eqn(0) ? "text-red-400" : ""}`}
                          >
                            {a.currentGlobalStock.toString()}/{a.maxGlobalStock.toString()}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg bg-surface/60 px-3 py-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Price</span>
                        <span>
                          <span className="text-text-muted line-through mr-1">
                            {lamportsToSol(base)}
                          </span>
                          <span className="text-text-gold">{lamportsToSol(dealLamports)} SOL</span>
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-zinc-500">
                        Subscription and time-of-day discounts may stack — final price is settled
                        on-chain.
                      </p>
                    </div>

                    <TxButton
                      onClick={(rp) => handlePurchaseDailyDeal(deal.item.itemId, deal.slot, rp)}
                      className="hidden w-full lg:block"
                      disabled={!hasStock}
                    >
                      {hasStock ? `Claim deal for ${lamportsToSol(dealLamports)} SOL` : "Sold Out"}
                    </TxButton>
                  </>
                );
              })()}
          </DetailPanel>
        </div>
      )}

      {/* Events Tab */}
      {activeTab === "events" && (
        <div className="space-y-4">
          {(() => {
            const weekly =
              weeklySaleData && isWeeklySaleActive(weeklySaleData.account, nowSec)
                ? weeklySaleData.account
                : null;
            const seasonal =
              seasonalSaleData && isSeasonalSaleActive(seasonalSaleData.account, nowSec)
                ? seasonalSaleData.account
                : null;
            const promos = daoPromotions.filter((p) => isDaoPromotionActive(p.account, nowSec));

            if (!weekly && !seasonal && promos.length === 0) {
              return (
                <div className="card">
                  <p className="text-sm text-text-muted">
                    No sitewide events running right now. The caravan keeps its usual prices.
                  </p>
                </div>
              );
            }

            return (
              <>
                {weekly && (
                  <div className="card accent-border">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-text-primary">Weekly Sale</h3>
                      <GoldCountdown
                        endsAt={weekly.endsAt.toNumber()}
                        startedAt={weekly.startsAt.toNumber()}
                        format="compact"
                        size="sm"
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {weekly.categoryDiscounts.map((bps, i) =>
                        bps > 0 ? (
                          <div key={i} className="rounded bg-surface/60 px-2 py-1.5 text-center">
                            <div className="text-[10px] text-text-muted">
                              {CATEGORY_LABELS[i] ?? `Category ${i}`}
                            </div>
                            <div className="text-sm font-semibold text-text-gold">
                              −{bpsToPercent(bps)}
                            </div>
                          </div>
                        ) : null,
                      )}
                    </div>
                    {weekly.bonusValueBps > 0 && (
                      <p className="mt-2 text-[11px] text-text-muted">
                        Themed bonus: +{bpsToPercent(weekly.bonusValueBps)}
                      </p>
                    )}
                  </div>
                )}

                {seasonal && (
                  <div className="card accent-border">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-text-primary">
                        {seasonal.name || "Seasonal Sale"}
                      </h3>
                      <GoldCountdown
                        endsAt={seasonal.endsAt.toNumber()}
                        startedAt={seasonal.startsAt.toNumber()}
                        format="compact"
                        size="sm"
                      />
                    </div>
                    <div className="mt-2 space-y-1 text-xs">
                      {seasonal.globalDiscountBps > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Storewide discount</span>
                          <span className="text-text-gold">
                            −{bpsToPercent(seasonal.globalDiscountBps)}
                          </span>
                        </div>
                      )}
                      {seasonal.featuredCount > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Featured items</span>
                          <span className="text-text-secondary">{seasonal.featuredCount}</span>
                        </div>
                      )}
                      {seasonal.exclusiveCosmeticId > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-muted">Exclusive cosmetic</span>
                          <span className="text-text-secondary">
                            #{seasonal.exclusiveCosmeticId}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {promos.map((p) => {
                  const d = p.account;
                  const rows = (
                    [
                      ["Storewide", d.globalDiscountBps],
                      ["Equipment", d.equipmentDiscountBps],
                      ["Consumables", d.consumableDiscountBps],
                      ["Materials", d.materialDiscountBps],
                      ["Cosmetics", d.cosmeticDiscountBps],
                    ] as [string, number][]
                  ).filter(([, bps]) => bps > 0);
                  return (
                    <div key={p.pubkey.toBase58()} className="card accent-border">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-text-primary">
                          {d.title || "DAO Promotion"}
                        </h3>
                        <GoldCountdown
                          endsAt={d.endsAt.toNumber()}
                          startedAt={d.startsAt.toNumber()}
                          format="compact"
                          size="sm"
                        />
                      </div>
                      <p className="text-[10px] uppercase tracking-wider text-text-muted">
                        Community promotion
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {rows.map(([label, bps]) => (
                          <div
                            key={label}
                            className="rounded bg-surface/60 px-2 py-1.5 text-center"
                          >
                            <div className="text-[10px] text-text-muted">{label}</div>
                            <div className="text-sm font-semibold text-text-gold">
                              −{bpsToPercent(bps)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      )}

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
                ]}
              />
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
                  <span
                    className={`text-sm font-semibold ${streakInfo.streakDay >= 3 ? "text-text-gold" : "text-text-secondary"}`}
                  >
                    Day {streakInfo.streakDay}/7
                  </span>
                  {streakInfo.bonusBps > 0 && (
                    <span className="text-[11px] text-green-400">
                      +{(streakInfo.bonusBps / 100).toFixed(0)}% bonus
                    </span>
                  )}
                  {streakInfo.isResetting && (
                    <span className="text-[11px] text-danger">Streak reset</span>
                  )}
                </div>
              )}
              {dailyAllowance && (
                <div className="flex items-center gap-2">
                  <span className="text-text-muted">Daily limit:</span>
                  <span
                    className={`text-sm font-semibold ${dailyAllowance.eqn(0) ? "text-red-400" : "text-text-gold"}`}
                  >
                    {dailyAllowance.eqn(0)
                      ? "Reached"
                      : `${formatNoviAmount(dailyAllowance)} NOVI left`}
                  </span>
                </div>
              )}
            </div>
          )}

          {!gameEngine ? (
            <div className="card">
              <p className="text-sm text-text-muted">Loading...</p>
            </div>
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
                            ? "border-border-gold bg-accent/20 ring-1 ring-border-gold/30"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        {tierInfo && (
                          <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                            {tierInfo.name}
                          </div>
                        )}
                        <div
                          className="font-semibold tabular-nums text-text-gold text-base sm:text-lg"
                          title={noviAmount.toLocaleString()}
                        >
                          {formatNumber(noviAmount, "compact")}
                        </div>
                        <div className="text-[10px] text-text-muted">NOVI</div>
                        {bonusBps > 0 && (
                          <div className="mt-1 text-[10px] text-text-gold">
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
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Purchase Preview
                  </h3>
                  <button
                    onClick={() => setSelectedPackage(null)}
                    className="hidden lg:block text-xs text-text-muted hover:text-text-secondary"
                  >
                    Close
                  </button>
                </div>

                {noviPreview && (
                  <div className="rounded-lg bg-surface/60 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Base amount</span>
                      <span className="text-text-secondary">
                        {formatNoviAmount(noviPreview.baseAmount)} NOVI
                      </span>
                    </div>
                    {!noviPreview.bulkBonus.eqn(0) && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Bulk bonus</span>
                        <span className="text-text-gold">
                          +{formatNoviAmount(noviPreview.bulkBonus)} NOVI
                        </span>
                      </div>
                    )}
                    {!noviPreview.subscriptionBonus.eqn(0) && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Subscription bonus</span>
                        <span className="text-text-gold">
                          +{formatNoviAmount(noviPreview.subscriptionBonus)} NOVI
                        </span>
                      </div>
                    )}
                    {!noviPreview.streakBonus.eqn(0) && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">
                          Streak (Day {streakInfo?.streakDay ?? 1})
                        </span>
                        <span className="text-text-gold">
                          +{formatNoviAmount(noviPreview.streakBonus)} NOVI
                        </span>
                      </div>
                    )}
                    {noviPreview.totalBonusBps > 0 && (
                      <div className="flex items-center justify-between text-xs border-t border-zinc-800 pt-1">
                        <span className="text-zinc-500">Total bonus</span>
                        <span className="text-text-gold">
                          +{(noviPreview.totalBonusBps / 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {noviPreview && (
                  <div className="rounded-lg bg-surface/60 px-3 py-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">You receive</span>
                      <span className="font-mono tabular-nums text-text-gold font-semibold">
                        {formatNoviAmount(noviPreview.totalNovi)} NOVI
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Cost</span>
                      <span className="font-mono tabular-nums text-text-muted">
                        {formatLamportsAsSol(noviPreview.costLamports)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="text-[10px] text-text-muted">
                  Base:{" "}
                  {lamportsToSol(gameEngine.noviPurchaseConfig.noviBasePriceLamports.toNumber())}{" "}
                  SOL/NOVI
                </div>

                <TxButton
                  onClick={handlePurchaseNovi}
                  className="hidden w-full lg:block"
                  disabled={dailyAllowance?.eqn(0) ?? false}
                >
                  {dailyAllowance?.eqn(0)
                    ? "Daily limit reached"
                    : `Buy ${noviPreview ? formatNoviAmount(noviPreview.totalNovi) : "NOVI"}`}
                </TxButton>
              </DetailPanel>

              <ReservedNoviNote className="lg:hidden" />
            </div>
          )}
        </div>
      )}

      <ReservedNoviNote className="hidden lg:block" />
    </div>
  );
}

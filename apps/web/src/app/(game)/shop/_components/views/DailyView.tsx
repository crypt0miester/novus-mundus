"use client";

import { useState, useMemo } from "react";
import { useShopItems, useDailyDeals } from "@/lib/hooks/useShop";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
import {
  deriveShopItemPda,
  createPurchaseItemInstruction,
  isItemAvailable,
  applyBpsPenalty,
  getShopItemName,
} from "novus-mundus-sdk";
import {
  CATEGORY_LABELS,
  RARITY_LABELS,
  RARITY_COLORS,
  lamportsToSol,
  buildIdLookup,
} from "./shared";
import { useIsDesktop } from "./useIsDesktop";

export function DailyView() {
  const { data: items } = useShopItems();
  const { data: dailyDeals, isSuccess: dailyDealsReady } = useDailyDeals();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const { data: geData } = useGameEngine();

  const gameEngine = geData?.account;
  const ge = client.gameEngine;

  const [selectedDeal, setSelectedDeal] = useState<number | null>(null);

  const isDesktop = useIsDesktop();

  const itemIdMap = useMemo(() => buildIdLookup(ge, deriveShopItemPda, 200), [ge]);

  const nowSec = Math.floor(Date.now() / 1000);

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

  // Enrich with IDs and filter active
  const activeItems = useMemo(() => {
    return items
      .map((i) => ({ ...i, itemId: itemIdMap.get(i.pubkey.toBase58()) }))
      .filter(
        (i): i is typeof i & { itemId: number } =>
          i.itemId !== undefined && i.account.isActive && isItemAvailable(i.account, nowSec),
      );
  }, [items, itemIdMap, nowSec]);

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

  const effectiveDeal =
    selectedDeal ?? (isDesktop && activeDailyDeals.length > 0 ? activeDailyDeals[0].slot : null);

  const morphActions = useMemo<PanelAction[] | null>(() => {
    if (effectiveDeal != null) {
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
    return null;
  }, [effectiveDeal, activeDailyDeals, handlePurchaseDailyDeal]);
  useMorphActions(morphActions);

  return (
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
                    <span className="text-text-muted line-through mr-1">{lamportsToSol(base)}</span>
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
  );
}

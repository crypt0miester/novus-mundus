"use client";

import { useState, useMemo, useRef } from "react";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { useShopItems, useFlashSales } from "@/lib/hooks/useShop";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
import type { PublicKey } from "@solana/web3.js";
import {
  deriveShopItemPda,
  deriveBundlePda,
  deriveFlashSalePda,
  createPurchaseFlashSaleInstruction,
  FlashSaleStatus,
  isItemAvailable,
  isFlashSaleActive,
  getItemTypeInfo,
} from "novus-mundus-sdk";
import {
  findItemType,
  buildIdLookup,
  selectShopTile,
  useShopTileRipple,
} from "./shared";
import { useIsDesktop } from "./useIsDesktop";

export function FlashView() {
  const { data: items } = useShopItems();
  const { data: flashSales, isSuccess: flashSalesReady } = useFlashSales();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const { data: geData } = useGameEngine();

  const gameEngine = geData?.account;
  const ge = client.gameEngine;

  const [selectedSale, setSelectedSale] = useState<number | null>(null);

  const isDesktop = useIsDesktop();
  const reduce = useReducedMotion();
  // Tile-ripple grid root. Flash sales sit in a fixed grid-cols-2 grid.
  const gridRef = useRef<HTMLDivElement>(null);

  const itemIdMap = useMemo(() => buildIdLookup(ge, deriveShopItemPda, 200), [ge]);
  const saleIdMap = useMemo(() => buildIdLookup(ge, deriveFlashSalePda, 100), [ge]);

  const nowSec = Math.floor(Date.now() / 1000);

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

  // Enrich with IDs and filter active
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

  const effectiveSale =
    selectedSale ?? (isDesktop && activeFlashSales.length > 0 ? activeFlashSales[0].saleId : null);

  const morphActions = useMemo<PanelAction[] | null>(() => {
    if (effectiveSale != null) {
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
    return null;
  }, [effectiveSale, activeFlashSales, handlePurchaseFlashSale, ge]);
  useMorphActions(morphActions);

  // Rarity-aware tile ripple, ranking each tile's flare by discount depth.
  // Keyed on the visible sale ids so the wash-in replays as offers come and go.
  const rippleSig = activeFlashSales.map((s) => s.saleId).join(",");
  useShopTileRipple(gridRef, [rippleSig], { base: 2 });

  return (
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
          <div ref={gridRef} className="grid gap-2 grid-cols-2">
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
                  data-shop-tile
                  onClick={(e) => {
                    selectShopTile(e.currentTarget, reduce);
                    setSelectedSale(sale.saleId);
                  }}
                  className={`rounded-lg border p-3 text-left opacity-0 transition-colors ${
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
  );
}

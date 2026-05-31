"use client";

import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { useShopItems, useBundles } from "@/lib/hooks/useShop";
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
  deriveBundlePda,
  createPurchaseBundleInstruction,
  isItemAvailable,
  getItemTypeInfo,
} from "novus-mundus-sdk";
import { lamportsToSol, findItemType, selectShopTile, useShopTileRipple } from "./shared";
import { useIsDesktop } from "./useIsDesktop";

// Shared empty Map so the query fallback is referentially stable across renders.
const EMPTY_ID_MAP: Map<string, number> = new Map();

// Async id->pda lookup. v3 PDA derivers return Promises, so each id's PDA is
// awaited; the resulting base58 -> id Map mirrors the sync buildIdLookup helper.
async function buildIdLookupAsync(
  ge: PublicKey,
  deriveFn: (ge: PublicKey, id: number) => Promise<[PublicKey, number]>,
  maxId: number,
): Promise<Map<string, number>> {
  const entries = await Promise.all(
    Array.from({ length: maxId }, async (_, i) => {
      const [pda] = await deriveFn(ge, i);
      return [pda.toBase58(), i] as const;
    }),
  );
  return new Map(entries);
}

export function BundlesView() {
  const { data: items } = useShopItems();
  const { data: bundles, isSuccess: bundlesReady } = useBundles();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const { data: geData } = useGameEngine();

  const gameEngine = geData?.account;
  const ge = client.gameEngine;

  const [selectedBundle, setSelectedBundle] = useState<number | null>(null);

  const isDesktop = useIsDesktop();
  const reduce = useReducedMotion();
  // Tile-ripple grid root. Bundles sit in a fixed grid-cols-2 grid.
  const gridRef = useRef<HTMLDivElement>(null);

  // v3 PDA derivation is async, so the id->pda lookups are built off-render in a
  // query rather than a sync useMemo. Empty Map fallback keeps the enrich memos
  // safe until the lookups resolve.
  const { data: itemIdMap = EMPTY_ID_MAP } = useQuery({
    queryKey: ["bundleViewItemIdMap", ge.toBase58()],
    queryFn: () => buildIdLookupAsync(ge, deriveShopItemPda, 200),
    staleTime: Infinity,
  });
  const { data: bundleIdMap = EMPTY_ID_MAP } = useQuery({
    queryKey: ["bundleViewBundleIdMap", ge.toBase58()],
    queryFn: () => buildIdLookupAsync(ge, deriveBundlePda, 100),
    staleTime: Infinity,
  });

  const nowSec = Math.floor(Date.now() / 1000);

  const handlePurchaseBundle = async (
    bundleId: number,
    bundleItems: { itemId: number }[],
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey || !gameEngine) throw new Error("Not ready");
    const shopItemAccounts = await Promise.all(
      bundleItems.map(async (bi) => (await deriveShopItemPda(ge, bi.itemId))[0]),
    );
    const ix = await createPurchaseBundleInstruction({
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

  // Enrich with IDs and filter active
  const activeItems = useMemo(() => {
    return items
      .map((i) => ({ ...i, itemId: itemIdMap.get(i.pubkey.toBase58()) }))
      .filter(
        (i): i is typeof i & { itemId: number } =>
          i.itemId !== undefined && i.account.isActive && isItemAvailable(i.account, nowSec),
      );
  }, [items, itemIdMap, nowSec]);

  const activeBundles = useMemo(() => {
    return bundles
      .map((b) => ({ ...b, bundleId: bundleIdMap.get(b.pubkey.toBase58()) }))
      .filter(
        (b): b is typeof b & { bundleId: number } => b.bundleId !== undefined && b.account.isActive,
      );
  }, [bundles, bundleIdMap]);

  const effectiveBundle =
    selectedBundle ?? (isDesktop && activeBundles.length > 0 ? activeBundles[0].bundleId : null);

  const morphActions = useMemo<PanelAction[] | null>(() => {
    if (effectiveBundle != null) {
      const bundle = activeBundles.find((b) => b.bundleId === effectiveBundle);
      if (!bundle) return null;
      // Bundles don't track global stock — gate on `isActive` + time window.
      const nowSec = Math.floor(Date.now() / 1000);
      const available =
        bundle.account.isActive &&
        Number(bundle.account.availableFrom) <= nowSec &&
        (bundle.account.availableUntil === 0n ||
          Number(bundle.account.availableUntil) >= nowSec);
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
    return null;
  }, [effectiveBundle, activeBundles, handlePurchaseBundle]);
  useMorphActions(morphActions);

  // Rarity-aware tile ripple, climbing the bloom ladder by lot tier. Keyed on
  // the visible bundle ids so the diagonal wash-in replays on caravan changes.
  const rippleSig = activeBundles.map((b) => b.bundleId).join(",");
  useShopTileRipple(gridRef, [rippleSig], { base: 2 });

  return (
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
          <div ref={gridRef} className="grid gap-2 grid-cols-2">
            {activeBundles.map((bundle) => {
              const b = bundle.account;
              const isSelected = effectiveBundle === bundle.bundleId;
              return (
                <button
                  key={bundle.bundleId}
                  data-shop-tile
                  onClick={(e) => {
                    selectShopTile(e.currentTarget, reduce);
                    setSelectedBundle(bundle.bundleId);
                  }}
                  className={`rounded-lg border p-3 text-left opacity-0 transition-colors ${
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
                    {lamportsToSol(Number(b.priceSolLamports))} SOL
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
            const solPrice = lamportsToSol(Number(b.priceSolLamports));
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
                  <div className="text-sm font-semibold text-text-gold">Lot #{effectiveBundle}</div>
                  <div className="text-xs text-text-muted">
                    Tier {b.tier} &middot; {b.itemCount} items
                    {b.requiresSubscription > 0 && " · Subscription required"}
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
                        <div key={bi.itemId} className="flex items-center justify-between text-xs">
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
                    <span className="font-mono tabular-nums text-text-gold">{solPrice} SOL</span>
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
  );
}

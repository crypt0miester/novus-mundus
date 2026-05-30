"use client";

import { useState, useMemo, useRef } from "react";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useShopConfig, useShopItems, usePlayerPurchase } from "@/lib/hooks/useShop";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { TabNav } from "@/components/shared/TabNav";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
import {
  deriveShopItemPda,
  createPurchaseItemInstruction,
  isItemAvailable,
  calculateFinalShopPrice,
  milestoneDiscountBps,
  streakDiscountBps,
  fibDiscountBps,
  getEffectiveTier,
} from "novus-mundus-sdk";
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
import {
  lamportsToSol,
  buildIdLookup,
  selectShopTile,
  useShopTileRipple,
} from "./shared";
import { useIsDesktop } from "./useIsDesktop";

export function CosmeticsView() {
  const { data: playerData } = usePlayer();
  const { data: shopConfigData } = useShopConfig();
  const { data: items, isSuccess: itemsReady } = useShopItems();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const { data: geData } = useGameEngine();

  const player = playerData?.account;
  const gameEngine = geData?.account;
  const shopConfig = shopConfigData?.account;
  const ge = client.gameEngine;

  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  // Sub-filter inside the Cosmetics tab — drilling into one kind at a
  // time keeps the grid scannable. "all" surfaces the full catalog for
  // first-time browsing; tapping a kind narrows.
  const [cosmeticKind, setCosmeticKind] = useState<"all" | "badge" | "title" | "color" | "frame">(
    "all",
  );

  const isDesktop = useIsDesktop();
  const reduce = useReducedMotion();
  // Tile-ripple grid root. The wash-in re-runs whenever the visible tile set
  // changes (sub-filter switch), so each newly-rendered grid gets its diagonal
  // rarity reveal. grid-cols-2 md:grid-cols-3 -> read the live breakpoint.
  const gridRef = useRef<HTMLDivElement>(null);

  const itemIdMap = useMemo(() => buildIdLookup(ge, deriveShopItemPda, 200), [ge]);

  const nowSec = Math.floor(Date.now() / 1000);

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

  // On desktop, default to first entry so the sidebar is always populated.
  const desktopDefaultItem = (() => {
    if (!isDesktop) return null;
    return filteredCosmetics[0]?.itemId ?? null;
  })();
  const effectiveItem = selectedItem ?? desktopDefaultItem;
  const itemPurchase = usePlayerPurchase(effectiveItem);

  const morphActions = useMemo<PanelAction[] | null>(() => {
    if (effectiveItem != null) {
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
    return null;
  }, [effectiveItem, cosmeticItems, itemPurchase, nowSec, player, handlePurchaseItem]);
  useMorphActions(morphActions);

  // Rarity-aware tile ripple. utils.set pins the pre-entrance state on mount to
  // avoid a first-frame flash, then the grid washes in on a 2D diagonal stagger
  // whose bloom blur encodes each tile's rarity. Keyed on the visible item ids
  // so a sub-filter switch replays the reveal for the new grid.
  const rippleSig = filteredCosmetics.map((i) => i.itemId).join(",");
  useShopTileRipple(gridRef, [rippleSig], { base: 2, md: 3 });

  return (
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
          onTabChange={(k) => setCosmeticKind(k as "all" | "badge" | "title" | "color" | "frame")}
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
          <div ref={gridRef} className="grid gap-3 grid-cols-2 md:grid-cols-3">
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
                  data-shop-tile
                  data-rest-opacity={owned ? 0.55 : 1}
                  onClick={(e) => {
                    selectShopTile(e.currentTarget, reduce);
                    setSelectedItem(item.itemId);
                  }}
                  className={`rounded-lg border p-3 text-left opacity-0 transition-colors ${
                    isSelected
                      ? "border-border-gold bg-accent/20 ring-1 ring-border-gold/30"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                  style={{
                    borderColor: isSelected ? undefined : RARITY_BORDER[rarity],
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
                          background: color.animation === "vesper" ? "currentColor" : color.hex,
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
                      <div
                        className="text-[10px] uppercase tracking-wider"
                        style={{ color: RARITY_BORDER[rarity] }}
                      >
                        {rarity} {kind}
                      </div>
                      <div className="text-sm font-semibold text-text-primary truncate">{name}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-text-gold">
                    {lamportsToSol(a.priceSolLamports.toNumber())} SOL
                  </div>
                  {owned ? (
                    <div
                      className="text-[10px] uppercase tracking-wider"
                      style={{ color: "var(--seal)" }}
                    >
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
                ? [
                    "Map dot",
                    "Walk line + marker",
                    "Inspection label",
                    "Hover tooltip",
                    "EntityPanel name",
                  ]
                : kind === "frame"
                  ? [
                      "Map dot stroke + glow",
                      "Walk marker ring",
                      "Hover tooltip",
                      "EntityPanel level pip",
                    ]
                  : kind === "title"
                    ? ["Inspection label", "Hover tooltip", "EntityPanel chip"]
                    : ["Hover tooltip", "EntityPanel chip"];

            return (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Cosmetic
                  </h3>
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
                          background: color.animation === "vesper" ? "currentColor" : color.hex,
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
                  <div
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: RARITY_BORDER[rarity] }}
                  >
                    {rarity} {kind}
                  </div>
                  <div className="text-sm font-semibold text-text-primary">{name}</div>
                  {flavor && <div className="mt-1 text-xs italic text-text-muted">{flavor}</div>}
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
                        <span
                          className={`text-text-muted ${a.currentGlobalStock.eqn(0) ? "text-red-400" : ""}`}
                        >
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
  );
}

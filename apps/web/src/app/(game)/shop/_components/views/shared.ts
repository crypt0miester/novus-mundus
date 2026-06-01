import { ShopItemCategory, ShopItemRarity } from "novus-mundus-sdk";
import type { PublicKey } from "@solana/web3.js";
import { animate, stagger, utils } from "animejs";
import type { Target } from "animejs";
import type { RefObject } from "react";
import { PRESS, DUR, STAGGER, EASE } from "@/lib/motion/tokens";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";

export const CATEGORY_LABELS: Record<number, string> = {
  [ShopItemCategory.Equipment]: "Equipment",
  [ShopItemCategory.Consumable]: "Consumable",
  [ShopItemCategory.Material]: "Material",
  [ShopItemCategory.Cosmetic]: "Cosmetic",
};

export const RARITY_LABELS: Record<number, string> = {
  [ShopItemRarity.Common]: "Common",
  [ShopItemRarity.Uncommon]: "Uncommon",
  [ShopItemRarity.Rare]: "Rare",
  [ShopItemRarity.Epic]: "Epic",
  [ShopItemRarity.Legendary]: "Legendary",
};

// Gold-intensity rarity ladder: mundane tiers stay neutral grey, precious
// tiers climb through bronze -> gold -> bright gold. No off-palette hues.
export const RARITY_COLORS: Record<number, string> = {
  [ShopItemRarity.Common]: "text-zinc-500",
  [ShopItemRarity.Uncommon]: "text-zinc-300",
  [ShopItemRarity.Rare]: "text-gold-600",
  [ShopItemRarity.Epic]: "text-gold-400",
  [ShopItemRarity.Legendary]: "text-gold-200",
};

export function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4);
}

export function findItemType(
  activeItems: { itemId: number; account: { itemType: number } }[],
  itemId: number,
): number {
  return activeItems.find((i) => i.itemId === itemId)?.account.itemType ?? -1;
}

export function buildIdLookup(
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

// Shop tile ripple + selection physics. One shared motion material across all
// six shop grids: tiles wash in on a 2D diagonal grid stagger, and selecting a
// tile runs a snappy scale-bounce. Springs come from the motion tokens module
// (built once) so every view speaks one language.

const RIPPLE_TILE = "[data-shop-tile]";

// Live breakpoint -> grid columns. The ripple direction depends on the real
// column count, so reading a stale value skews the diagonal on resize. Callers
// pass the Tailwind breakpoint columns; we resolve against window width.
export function gridColsFor(cols: { base: number; md?: number; lg?: number }): number {
  if (typeof window === "undefined") return cols.base;
  const w = window.innerWidth;
  if (cols.lg != null && w >= 1024) return cols.lg;
  if (cols.md != null && w >= 768) return cols.md;
  return cols.base;
}

// A tile's resting opacity. anime owns style.opacity once the ripple writes to
// it, so any per-tile dimming (e.g. an already-owned cosmetic) cannot live on a
// className the inline opacity would override. Tiles carry data-rest-opacity for
// that case; the wash-in lands there instead of a hard 1.
function tileRestOpacity(el: HTMLElement): number {
  const raw = el.dataset.restOpacity;
  const v = raw != null ? Number.parseFloat(raw) : 1;
  return Number.isFinite(v) ? v : 1;
}

// Pin the pre-entrance state of every tile on the same frame they mount so the
// staggered wash-in has no first-frame flash. The tiles ship at rest opacity
// in CSS; the scale + downward nudge are not expressed there. Under reduced
// motion this sets the final resting state directly instead.
export function pinShopTiles(root: Element, reduce: boolean): void {
  const tiles = Array.from(root.querySelectorAll<HTMLElement>(RIPPLE_TILE));
  if (tiles.length === 0) return;
  if (reduce) {
    for (const el of tiles) {
      utils.set(el, { opacity: tileRestOpacity(el), scale: 1, translateY: 0 });
    }
    return;
  }
  utils.set(tiles, { opacity: 0, scale: 0.92, translateY: 8 });
}

// Wash the tiles in on a 2D diagonal grid stagger (opacity + scale + a small
// upward settle). Reduced motion early-returns: pinning already set the final
// state, so there is nothing to choreograph.
export function rippleShopTilesIn(root: Element, cols: number, reduce: boolean): void {
  if (reduce) return;
  const tiles = Array.from(root.querySelectorAll<HTMLElement>(RIPPLE_TILE));
  if (tiles.length === 0) return;
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  animate(tiles, {
    // Land at each tile's resting opacity (1 by default, dimmed for owned tiles)
    // so anime's inline opacity does not fight an authored dim class.
    opacity: (target?: Target) => [0, tileRestOpacity(target as HTMLElement)],
    scale: [0.92, 1],
    translateY: [8, 0],
    delay: stagger(STAGGER.tight, { grid: [cols, rows], from: "first" }),
    duration: DUR.base,
    ease: PRESS,
  });
}

// The rarity-aware tile ripple every shop grid runs: pin the pre-entrance state
// on the mount frame, then wash the tiles in on the live column grid. Re-runs
// when `deps` change (the visible item-id signature) so the diagonal replays on
// caravan/config changes. Reduced motion is honored inside pin/ripple. Lifted
// out of the six views, which each inlined a byte-identical scope.
export function useShopTileRipple(
  gridRef: RefObject<Element | null>,
  deps: unknown[],
  cols: { base: number; md?: number; lg?: number },
): void {
  useAnimeScope({ root: gridRef, deps }, ({ reduce: r }) => {
    const root = gridRef.current;
    if (!root) return;
    pinShopTiles(root, r);
    rippleShopTilesIn(root, gridColsFor(cols), r);
  });
}

// NoviView's selected package floats higher as a physics gesture. The original
// idea was a hard md:-translate-y-3 jump; this REPLACES that class-driven jump
// with an outElastic translateY float so the lift overshoots and settles like a
// real object. The selected tile rises, every other tile settles back to rest.
// Reduced motion sets the float state directly (no overshoot).
const NOVI_FLOAT_Y = -5;

export function floatNoviTiles(root: Element, selectedIndex: number, reduce: boolean): void {
  const tiles = Array.from(root.querySelectorAll<HTMLElement>(RIPPLE_TILE));
  if (tiles.length === 0) return;
  tiles.forEach((el, i) => {
    const target = i === selectedIndex ? NOVI_FLOAT_Y : 0;
    if (reduce) {
      utils.set(el, { translateY: target });
      return;
    }
    animate(el, {
      translateY: target,
      duration: DUR.slow,
      ease: i === selectedIndex ? "outElastic(1, 0.5)" : EASE.out,
    });
  });
}

// Tactile selection: a snappy scale-bounce gives instant feedback. The scale
// rides composition:"blend" so a hover-while-selected bounce stacks instead of
// fighting; under blend we pass a plain numeric [from,to] array (no keyframes).
export function selectShopTile(el: HTMLElement, reduce: boolean): void {
  if (reduce) {
    utils.set(el, { scale: 1 });
    return;
  }
  // Snappy bounce, settles back to rest scale via the press spring. Blendable.
  animate(el, {
    scale: [1.06, 1],
    duration: DUR.fast,
    ease: PRESS,
    composition: "blend",
  });
}

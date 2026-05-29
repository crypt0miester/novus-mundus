import { ShopItemCategory, ShopItemRarity } from "novus-mundus-sdk";
import type { PublicKey } from "@solana/web3.js";

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

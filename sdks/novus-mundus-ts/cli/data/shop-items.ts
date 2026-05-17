/**
 * Shop Item & Bundle Data
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export interface ShopItemData {
  itemId: number;
  name: string;
  itemType: number;
  category: number;    // 0=Equipment, 1=Consumable, 2=Material, 3=Cosmetic, 4=Currency
  rarity: number;
  quantityPerPurchase: number;
  baseStatsBps: number;
  priceSolLamports: number;
  maxGlobalStock: number;   // 0=unlimited
  maxPerPlayer: number;     // 0=unlimited
  maxPerDay: number;        // 0=unlimited
  isActive: boolean;
  isFeatured: boolean;
}

export interface BundleItemData {
  itemId: number;
  quantity: number;
}

export interface ShopBundleData {
  bundleId: number;
  name: string;
  tier: number;
  category: number;
  requiresSubscription: number;
  savingsBps: number;
  priceSolLamports: number;
  isActive: boolean;
  items: BundleItemData[];
}

export interface AllowedTokenData {
  name: string;
  mintAddress: string;
  discountBps: number;
}

export const SHOP_ITEMS: ShopItemData[] = [
  {
    itemId: 1,
    name: 'Gem Pack (100)',
    itemType: 50,
    category: 1,            // Consumable (Currency=4 not yet deployed)
    rarity: 0,
    quantityPerPurchase: 100,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.01),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    itemId: 2,
    name: 'Fragment Pack (100)',
    itemType: 52,
    category: 1,            // Consumable (Currency=4 not yet deployed)
    rarity: 0,
    quantityPerPurchase: 100,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.01),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    itemId: 3,
    name: 'Material Pack (50)',
    itemType: 200,
    category: 2,
    rarity: 0,
    quantityPerPurchase: 50,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.01),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    // Legacy/broken: item_type 53 has no arm in fulfill_item, so this granted
    // nothing. item_type is immutable on-chain (update_item can't change it),
    // so this slot is retired and superseded by item #9 below.
    itemId: 4,
    name: 'Stamina Refill (legacy)',
    itemType: 53,
    category: 1,
    rarity: 0,
    quantityPerPurchase: 1,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.005),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 10,
    isActive: false,
    isFeatured: false,
  },
  {
    itemId: 5,
    name: 'Small NOVI Pack',
    itemType: 51,
    category: 1,            // Consumable (Currency=4 not yet deployed)
    rarity: 0,
    quantityPerPurchase: 10000,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.05),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: true,
  },
  // Larger gem packs — same itemType (50) as Gem Pack (100), priced with a
  // bulk discount so buying gems in volume costs fewer txs and less SOL.
  {
    itemId: 6,
    name: 'Gem Pack (1,000)',
    itemType: 50,
    category: 1,
    rarity: 1,
    quantityPerPurchase: 1000,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.09),  // ~10% bulk saving
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    itemId: 7,
    name: 'Gem Pack (10,000)',
    itemType: 50,
    category: 1,
    rarity: 2,
    quantityPerPurchase: 10000,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.8),   // ~20% bulk saving
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    itemId: 8,
    name: 'Gem Pack (100,000)',
    itemType: 50,
    category: 1,
    rarity: 3,
    quantityPerPurchase: 100000,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 7),     // ~30% bulk saving
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: true,
  },
  {
    // Working stamina refill — replaces the retired item #4. item_type 60 is
    // `encounter_stamina` in fulfill_item, so a purchase adds 100 stamina.
    itemId: 9,
    name: 'Stamina Refill (100)',
    itemType: 60,
    category: 1,
    rarity: 0,
    quantityPerPurchase: 100,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.005),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 10,
    isActive: true,
    isFeatured: false,
  },
];

export const SHOP_BUNDLES: ShopBundleData[] = [
  {
    bundleId: 1,
    name: 'Starter Bundle',
    tier: 0,
    category: 0,
    requiresSubscription: 0,
    savingsBps: 1500,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),
    isActive: true,
    items: [
      { itemId: 1, quantity: 2 },  // Gems x200
      { itemId: 2, quantity: 1 },  // Fragments x100
      { itemId: 3, quantity: 1 },  // Materials x50
    ],
  },
  {
    bundleId: 2,
    name: 'Combat Bundle',
    tier: 0,
    category: 0,
    requiresSubscription: 0,
    savingsBps: 2000,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.04),
    isActive: true,
    items: [
      { itemId: 2, quantity: 5 },  // Fragments x500
      { itemId: 4, quantity: 3 },  // Stamina x3
    ],
  },
];

export const ALLOWED_TOKENS: AllowedTokenData[] = [];

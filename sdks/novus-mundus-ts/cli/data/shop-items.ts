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
    itemId: 4,
    name: 'Stamina Refill',
    itemType: 53,
    category: 1,
    rarity: 0,
    quantityPerPurchase: 1,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.005),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 10,
    isActive: true,
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

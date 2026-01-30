/**
 * Shop Accounts
 *
 * ShopConfigAccount - Global shop settings (168 bytes)
 * ShopItemAccount - Individual item definition (80 bytes)
 * BundleAccount - Pre-built bundle (144 bytes)
 * DailyDealAccount - Rotating daily deals (57 bytes)
 * FlashSaleAccount - Time-limited flash sales (112 bytes)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize.ts';

// ============================================================
// Shop Enums
// ============================================================

export enum ShopItemCategory {
  Equipment = 0,
  Consumable = 1,
  Material = 2,
  Cosmetic = 3,
}

export enum ShopItemRarity {
  Common = 0,
  Uncommon = 1,
  Rare = 2,
  Epic = 3,
  Legendary = 4,
}

export enum FlashSaleStatus {
  Announced = 0,
  Active = 1,
  Ended = 2,
  SoldOut = 3,
}

export enum WeeklySaleTheme {
  Combat = 0,
  Defense = 1,
  Resource = 2,
  Growth = 3,
  Expedition = 4,
}

// ============================================================
// Shop Config Account Interface
// ============================================================

export interface ShopConfigAccount {
  // Discount caps
  maxBaseDiscountBps: number;
  maxBundleDiscountBps: number;
  maxFibDiscountBps: number;
  maxTotalDiscountBps: number;

  // Sale limits
  maxFlashSalesPerDay: number;
  maxDailyDeals: number;
  flashSaleMinDurationSecs: number;
  flashSaleMaxDurationSecs: number;

  // Milestone thresholds
  bronzeThreshold: BN;
  silverThreshold: BN;
  goldThreshold: BN;
  platinumThreshold: BN;
  diamondThreshold: BN;

  // Milestone discounts
  bronzeDiscountBps: number;
  silverDiscountBps: number;
  goldDiscountBps: number;
  platinumDiscountBps: number;
  diamondDiscountBps: number;

  // Loyalty streak discounts
  streakDay2Bps: number;
  streakDay3Bps: number;
  streakDay5Bps: number;
  streakDay7Bps: number;

  // Global stats
  totalSolCollected: BN;
  totalNoviBurned: BN;

  // State
  nextFlashSaleId: BN;

  // Oracle config
  solPythFeed: PublicKey;
  solSwitchboardFeed: PublicKey;
  solMaxStalenessSlots: number;
  solConfidenceThresholdBps: number;

  bump: number;
}

/** ShopConfigAccount size in bytes */
export const SHOP_CONFIG_ACCOUNT_SIZE = 168;

// ============================================================
// Shop Item Account Interface
// ============================================================

export interface ShopItemAccount {
  itemType: number;
  category: ShopItemCategory;
  rarity: ShopItemRarity;
  quantityPerPurchase: number;
  baseStatsBps: number;
  priceSolLamports: BN;
  availableFrom: BN;
  availableUntil: BN;
  maxGlobalStock: BN;
  currentGlobalStock: BN;
  maxPerPlayer: number;
  maxPerDay: number;
  isActive: boolean;
  isFeatured: boolean;
  bump: number;
}

/** ShopItemAccount size in bytes */
export const SHOP_ITEM_ACCOUNT_SIZE = 80;

// ============================================================
// Bundle Item
// ============================================================

export interface BundleItem {
  itemId: number;
  quantity: number;
}

// ============================================================
// Bundle Account Interface
// ============================================================

export interface BundleAccount {
  tier: number;
  category: number;
  itemCount: number;
  requiresSubscription: number;
  savingsBps: number;
  isActive: boolean;
  items: BundleItem[];
  priceSolLamports: BN;
  availableFrom: BN;
  availableUntil: BN;
  totalPurchases: BN;
  totalRevenueLamports: BN;
  bump: number;
}

/** BundleAccount size in bytes */
export const BUNDLE_ACCOUNT_SIZE = 144;

// ============================================================
// Daily Deal Account Interface
// ============================================================

export interface DailyDealAccount {
  itemId: number;
  discountBps: number;
  startedAt: BN;
  nextItemId: number;
  nextDiscountBps: number;
  purchasesToday: BN;
  revenueTodayLamports: BN;
  bump: number;
}

/** DailyDealAccount size in bytes */
export const DAILY_DEAL_ACCOUNT_SIZE = 57;

// ============================================================
// Flash Sale Account Interface
// ============================================================

export interface FlashSaleAccount {
  payer: PublicKey;
  itemId: number;
  isBundle: boolean;
  status: FlashSaleStatus;
  discountBps: number;
  announcedAt: BN;
  startsAt: BN;
  endsAt: BN;
  maxStock: BN;
  remainingStock: BN;
  totalClaims: BN;
  totalRevenueLamports: BN;
  bump: number;
}

/** FlashSaleAccount size in bytes */
export const FLASH_SALE_ACCOUNT_SIZE = 112;

// ============================================================
// Deserialization
// ============================================================

/** Deserialize ShopConfigAccount from raw bytes */
export function deserializeShopConfig(data: Uint8Array | Buffer): ShopConfigAccount {
  const reader = new BufferReader(data);

  // Discount caps
  const maxBaseDiscountBps = reader.readU16();
  const maxBundleDiscountBps = reader.readU16();
  const maxFibDiscountBps = reader.readU16();
  const maxTotalDiscountBps = reader.readU16();

  // Sale limits
  const maxFlashSalesPerDay = reader.readU8();
  const maxDailyDeals = reader.readU8();
  const flashSaleMinDurationSecs = reader.readU16();
  const flashSaleMaxDurationSecs = reader.readU16();
  reader.skip(2); // padding

  // Milestone thresholds
  const bronzeThreshold = reader.readU64();
  const silverThreshold = reader.readU64();
  const goldThreshold = reader.readU64();
  const platinumThreshold = reader.readU64();
  const diamondThreshold = reader.readU64();

  // Milestone discounts
  const bronzeDiscountBps = reader.readU16();
  const silverDiscountBps = reader.readU16();
  const goldDiscountBps = reader.readU16();
  const platinumDiscountBps = reader.readU16();
  const diamondDiscountBps = reader.readU16();

  // Loyalty streak discounts
  const streakDay2Bps = reader.readU16();
  const streakDay3Bps = reader.readU16();
  const streakDay5Bps = reader.readU16();
  const streakDay7Bps = reader.readU16();

  // Global stats
  const totalSolCollected = reader.readU64();
  const totalNoviBurned = reader.readU64();

  // State
  const nextFlashSaleId = reader.readU64();

  // Oracle config
  const solPythFeed = reader.readPubkey();
  const solSwitchboardFeed = reader.readPubkey();
  const solMaxStalenessSlots = reader.readU16();
  const solConfidenceThresholdBps = reader.readU16();

  reader.skip(8); // _reserved
  reader.skip(3); // padding
  const bump = reader.readU8();

  return {
    maxBaseDiscountBps,
    maxBundleDiscountBps,
    maxFibDiscountBps,
    maxTotalDiscountBps,
    maxFlashSalesPerDay,
    maxDailyDeals,
    flashSaleMinDurationSecs,
    flashSaleMaxDurationSecs,
    bronzeThreshold,
    silverThreshold,
    goldThreshold,
    platinumThreshold,
    diamondThreshold,
    bronzeDiscountBps,
    silverDiscountBps,
    goldDiscountBps,
    platinumDiscountBps,
    diamondDiscountBps,
    streakDay2Bps,
    streakDay3Bps,
    streakDay5Bps,
    streakDay7Bps,
    totalSolCollected,
    totalNoviBurned,
    nextFlashSaleId,
    solPythFeed,
    solSwitchboardFeed,
    solMaxStalenessSlots,
    solConfidenceThresholdBps,
    bump,
  };
}

/** Deserialize ShopItemAccount from raw bytes */
export function deserializeShopItem(data: Uint8Array | Buffer): ShopItemAccount {
  const reader = new BufferReader(data);

  const itemType = reader.readU16();
  const categoryValue = reader.readU8();
  const category = categoryValue as ShopItemCategory;
  const rarityValue = reader.readU8();
  const rarity = rarityValue as ShopItemRarity;
  const quantityPerPurchase = reader.readU16();
  const baseStatsBps = reader.readU16();

  const priceSolLamports = reader.readU64();
  reader.skip(8); // _reserved_price

  const availableFrom = reader.readI64();
  const availableUntil = reader.readI64();

  const maxGlobalStock = reader.readU64();
  const currentGlobalStock = reader.readU64();

  const maxPerPlayer = reader.readU32();
  const maxPerDay = reader.readU16();
  reader.skip(2); // padding

  const isActive = reader.readBool();
  const isFeatured = reader.readBool();

  reader.skip(8); // _reserved
  reader.skip(5); // padding
  const bump = reader.readU8();

  return {
    itemType,
    category,
    rarity,
    quantityPerPurchase,
    baseStatsBps,
    priceSolLamports,
    availableFrom,
    availableUntil,
    maxGlobalStock,
    currentGlobalStock,
    maxPerPlayer,
    maxPerDay,
    isActive,
    isFeatured,
    bump,
  };
}

/** Deserialize BundleAccount from raw bytes */
export function deserializeBundle(data: Uint8Array | Buffer): BundleAccount {
  const reader = new BufferReader(data);

  const tier = reader.readU8();
  const category = reader.readU8();
  const itemCount = reader.readU8();
  const requiresSubscription = reader.readU8();
  const savingsBps = reader.readU16();
  const isActive = reader.readBool();
  reader.skip(1); // padding

  // Read items (max 10)
  const items: BundleItem[] = [];
  for (let i = 0; i < 10; i++) {
    const itemId = reader.readU32();
    const quantity = reader.readU32();
    if (i < itemCount) {
      items.push({ itemId, quantity });
    }
  }

  const priceSolLamports = reader.readU64();
  const availableFrom = reader.readI64();
  const availableUntil = reader.readI64();
  const totalPurchases = reader.readU64();
  const totalRevenueLamports = reader.readU64();

  reader.skip(8); // _reserved
  reader.skip(7); // padding
  const bump = reader.readU8();

  return {
    tier,
    category,
    itemCount,
    requiresSubscription,
    savingsBps,
    isActive,
    items,
    priceSolLamports,
    availableFrom,
    availableUntil,
    totalPurchases,
    totalRevenueLamports,
    bump,
  };
}

/** Deserialize DailyDealAccount from raw bytes */
export function deserializeDailyDeal(data: Uint8Array | Buffer): DailyDealAccount {
  const reader = new BufferReader(data);

  const itemId = reader.readU32();
  const discountBps = reader.readU16();
  reader.skip(2); // padding
  const startedAt = reader.readI64();

  const nextItemId = reader.readU32();
  const nextDiscountBps = reader.readU16();
  reader.skip(2); // padding

  const purchasesToday = reader.readU64();
  const revenueTodayLamports = reader.readU64();

  reader.skip(8); // _reserved
  const bump = reader.readU8();

  return {
    itemId,
    discountBps,
    startedAt,
    nextItemId,
    nextDiscountBps,
    purchasesToday,
    revenueTodayLamports,
    bump,
  };
}

/** Deserialize FlashSaleAccount from raw bytes */
export function deserializeFlashSale(data: Uint8Array | Buffer): FlashSaleAccount {
  const reader = new BufferReader(data);

  const payer = reader.readPubkey();
  const itemId = reader.readU32();
  const isBundle = reader.readBool();
  const statusValue = reader.readU8();
  const status = statusValue as FlashSaleStatus;
  const discountBps = reader.readU16();

  const announcedAt = reader.readI64();
  const startsAt = reader.readI64();
  const endsAt = reader.readI64();

  const maxStock = reader.readU64();
  const remainingStock = reader.readU64();

  const totalClaims = reader.readU64();
  const totalRevenueLamports = reader.readU64();

  reader.skip(8); // _reserved
  reader.skip(7); // padding
  const bump = reader.readU8();

  return {
    payer,
    itemId,
    isBundle,
    status,
    discountBps,
    announcedAt,
    startsAt,
    endsAt,
    maxStock,
    remainingStock,
    totalClaims,
    totalRevenueLamports,
    bump,
  };
}

// ============================================================
// Parse Functions
// ============================================================

/** Parse ShopConfigAccount from account info */
export function parseShopConfig(accountInfo: AccountInfo<Buffer>): ShopConfigAccount | null {
  if (!accountInfo.data || accountInfo.data.length < SHOP_CONFIG_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeShopConfig(accountInfo.data);
}

/** Parse ShopItemAccount from account info */
export function parseShopItem(accountInfo: AccountInfo<Buffer>): ShopItemAccount | null {
  if (!accountInfo.data || accountInfo.data.length < SHOP_ITEM_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeShopItem(accountInfo.data);
}

/** Parse BundleAccount from account info */
export function parseBundle(accountInfo: AccountInfo<Buffer>): BundleAccount | null {
  if (!accountInfo.data || accountInfo.data.length < BUNDLE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeBundle(accountInfo.data);
}

/** Parse DailyDealAccount from account info */
export function parseDailyDeal(accountInfo: AccountInfo<Buffer>): DailyDealAccount | null {
  if (!accountInfo.data || accountInfo.data.length < DAILY_DEAL_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeDailyDeal(accountInfo.data);
}

/** Parse FlashSaleAccount from account info */
export function parseFlashSale(accountInfo: AccountInfo<Buffer>): FlashSaleAccount | null {
  if (!accountInfo.data || accountInfo.data.length < FLASH_SALE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeFlashSale(accountInfo.data);
}

// ============================================================
// Helper Functions
// ============================================================

/** Check if item is available for purchase */
export function isItemAvailable(item: ShopItemAccount, nowSeconds: number): boolean {
  if (!item.isActive) return false;
  const from = item.availableFrom.toNumber();
  const until = item.availableUntil.toNumber();
  if (from > 0 && nowSeconds < from) return false;
  if (until > 0 && nowSeconds > until) return false;
  return true;
}

/** Check if flash sale is currently active */
export function isFlashSaleActive(sale: FlashSaleAccount, nowSeconds: number): boolean {
  if (sale.status !== FlashSaleStatus.Active) return false;
  return nowSeconds >= sale.startsAt.toNumber() && nowSeconds < sale.endsAt.toNumber();
}

/** Check if flash sale can be closed */
export function canCloseFlashSale(sale: FlashSaleAccount): boolean {
  return sale.status === FlashSaleStatus.Ended || sale.status === FlashSaleStatus.SoldOut;
}

/** Get milestone tier from total spent */
export function getMilestoneTier(
  config: ShopConfigAccount,
  totalSpent: BN
): 'none' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' {
  if (totalSpent.gte(config.diamondThreshold)) return 'diamond';
  if (totalSpent.gte(config.platinumThreshold)) return 'platinum';
  if (totalSpent.gte(config.goldThreshold)) return 'gold';
  if (totalSpent.gte(config.silverThreshold)) return 'silver';
  if (totalSpent.gte(config.bronzeThreshold)) return 'bronze';
  return 'none';
}

/** Get discount for milestone tier */
export function getMilestoneDiscount(config: ShopConfigAccount, tier: string): number {
  switch (tier) {
    case 'diamond':
      return config.diamondDiscountBps;
    case 'platinum':
      return config.platinumDiscountBps;
    case 'gold':
      return config.goldDiscountBps;
    case 'silver':
      return config.silverDiscountBps;
    case 'bronze':
      return config.bronzeDiscountBps;
    default:
      return 0;
  }
}

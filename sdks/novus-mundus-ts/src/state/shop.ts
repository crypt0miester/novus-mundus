/**
 * Shop Accounts
 *
 * ShopConfigAccount - Global shop settings (224 bytes with repr(C) padding)
 * ShopItemAccount - Individual item definition (88 bytes with repr(C) padding)
 * BundleAccount - Pre-built bundle (152 bytes with repr(C) padding)
 * DailyDealAccount - Rotating daily deals (64 bytes with repr(C) padding)
 * FlashSaleAccount - Time-limited flash sales (120 bytes with repr(C) padding)
 * WeeklySaleAccount - Rotating weekly themed sales (104 bytes with repr(C) padding)
 * SeasonalSaleAccount - Seasonal event sales (208 bytes with repr(C) padding)
 * DAOPromotionAccount - DAO-approved discount promotions (168 bytes with repr(C) padding)
 * PlayerPurchaseAccount - Per-player purchase tracking (48 bytes with repr(C) padding)
 * AllowedTokenAccount - Whitelisted SPL tokens for payment (122 bytes with repr(C) padding)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize';

// Shop Enums

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

// Shop Config Account Interface

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
  /** Pyth SOL/USD feed id (32-byte feed identifier, not an account). */
  solPythFeed: PublicKey;
  /** Switchboard SOL/USD OracleQuote feed id (32-byte feed hash). */
  solSwitchboardFeed: PublicKey;
  /** Switchboard On-Demand queue account; seeds the oracle-quote PDA. */
  solSwitchboardQueue: PublicKey;
  solMaxStalenessSlots: number;
  solConfidenceThresholdBps: number;

  bump: number;
}

/** ShopConfigAccount size in bytes */
export const SHOP_CONFIG_ACCOUNT_SIZE = 224;

// Shop Item Account Interface

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
export const SHOP_ITEM_ACCOUNT_SIZE = 88;

// Bundle Item

export interface BundleItem {
  itemId: number;
  quantity: number;
}

// Bundle Account Interface

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
export const BUNDLE_ACCOUNT_SIZE = 152;

// Daily Deal Account Interface

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
export const DAILY_DEAL_ACCOUNT_SIZE = 64;

// Flash Sale Account Interface

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
export const FLASH_SALE_ACCOUNT_SIZE = 120;

// Deserialization

/** Deserialize ShopConfigAccount from raw bytes */
export function deserializeShopConfig(data: Uint8Array | Buffer): ShopConfigAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key
  reader.skip(1); // implicit padding for u16 alignment

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
  reader.skip(2); // _padding1
  reader.skip(6); // implicit padding for u64 alignment

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
  reader.skip(6); // implicit padding for u64 alignment

  // Global stats
  const totalSolCollected = reader.readU64();
  const totalNoviBurned = reader.readU64();

  // State
  const nextFlashSaleId = reader.readU64();

  // Oracle config
  const solPythFeed = reader.readPubkey();
  const solSwitchboardFeed = reader.readPubkey();
  const solSwitchboardQueue = reader.readPubkey();
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
    solSwitchboardQueue,
    solMaxStalenessSlots,
    solConfidenceThresholdBps,
    bump,
  };
}

/** Deserialize ShopItemAccount from raw bytes */
export function deserializeShopItem(data: Uint8Array | Buffer): ShopItemAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key
  reader.skip(1); // implicit padding for u16 alignment

  const itemType = reader.readU16();
  const categoryValue = reader.readU8();
  const category = categoryValue as ShopItemCategory;
  const rarityValue = reader.readU8();
  const rarity = rarityValue as ShopItemRarity;
  const quantityPerPurchase = reader.readU16();
  const baseStatsBps = reader.readU16();
  reader.skip(6); // implicit padding for u64 alignment

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

  reader.readU8(); // account_key

  const tier = reader.readU8();
  const category = reader.readU8();
  const itemCount = reader.readU8();
  const requiresSubscription = reader.readU8();
  reader.skip(1); // implicit padding for u16 alignment
  const savingsBps = reader.readU16();
  const isActive = reader.readBool();
  reader.skip(1); // _padding
  reader.skip(2); // implicit padding for u32 alignment (BundleItem)

  // Read items (max 10)
  const items: BundleItem[] = [];
  for (let i = 0; i < 10; i++) {
    const itemId = reader.readU32();
    const quantity = reader.readU32();
    if (i < itemCount) {
      items.push({ itemId, quantity });
    }
  }

  reader.skip(4); // implicit padding for u64 alignment
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

  reader.readU8(); // account_key
  reader.skip(3); // implicit padding for u32 alignment

  const itemId = reader.readU32();
  const discountBps = reader.readU16();
  reader.skip(2); // _padding1
  reader.skip(4); // implicit padding for i64 alignment
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

  reader.readU8(); // account_key

  const payer = reader.readPubkey();
  reader.skip(3); // implicit padding for u32 alignment
  const itemId = reader.readU32();
  const isBundle = reader.readBool();
  const statusValue = reader.readU8();
  const status = statusValue as FlashSaleStatus;
  const discountBps = reader.readU16();
  reader.skip(4); // implicit padding for i64 alignment

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

// Parse Functions

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

// Helper Functions

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

// Weekly Sale Enums

export enum SeasonalSaleStatus {
  Upcoming = 0,
  Active = 1,
  Ended = 2,
}

export enum DaoPromotionStatus {
  Pending = 0,
  Active = 1,
  Ended = 2,
  Cancelled = 3,
}

// Weekly Sale Account Interface

export interface WeeklySaleAccount {
  payer: PublicKey;
  theme: number;
  bonusType: number;
  bonusValueBps: number;
  categoryDiscounts: number[];
  startsAt: BN;
  endsAt: BN;
  totalPurchases: BN;
  totalRevenueLamports: BN;
  bump: number;
}

/** WeeklySaleAccount size in bytes */
export const WEEKLY_SALE_ACCOUNT_SIZE = 104;

// Seasonal Sale Account Interface

export interface SeasonalSaleAccount {
  payer: PublicKey;
  name: string;
  featuredItemIds: number[];
  featuredDiscountsBps: number[];
  featuredCount: number;
  status: SeasonalSaleStatus;
  globalDiscountBps: number;
  startsAt: BN;
  endsAt: BN;
  spendThreshold: BN;
  exclusiveCosmeticId: number;
  exclusiveClaims: number;
  totalPurchases: BN;
  totalRevenueLamports: BN;
  bump: number;
}

/** SeasonalSaleAccount size in bytes */
export const SEASONAL_SALE_ACCOUNT_SIZE = 208;

// DAO Promotion Account Interface

export interface DAOPromotionAccount {
  payer: PublicKey;
  title: string;
  equipmentDiscountBps: number;
  consumableDiscountBps: number;
  materialDiscountBps: number;
  cosmeticDiscountBps: number;
  globalDiscountBps: number;
  maxDiscountBps: number;
  status: DaoPromotionStatus;
  approvedAt: BN;
  startsAt: BN;
  endsAt: BN;
  maxDiscountBudgetLamports: BN;
  usedDiscountBudget: BN;
  totalPurchases: BN;
  totalRevenueLamports: BN;
  uniquePurchasers: BN;
  bump: number;
}

/** DAOPromotionAccount size in bytes */
export const DAO_PROMOTION_ACCOUNT_SIZE = 168;

// Player Purchase Account Interface

export interface PlayerPurchaseAccount {
  lifetimePurchased: BN;
  purchasedToday: BN;
  lastPurchaseDay: BN;
  bump: number;
}

/** PlayerPurchaseAccount size in bytes */
export const PLAYER_PURCHASE_ACCOUNT_SIZE = 48;

// Allowed Token Account Interface

export interface AllowedTokenAccount {
  mint: PublicKey;
  pythFeed: PublicKey;
  switchboardFeed: PublicKey;
  maxStalenessSlots: number;
  confidenceThresholdBps: number;
  discountBps: number;
  /** 0 = oracle path (Pyth/Switchboard); 1 = $1-pegged stablecoin (skips
   *  oracle and computes token amount directly from cost_usd_cents). */
  peggedToUsd: boolean;
  bump: number;
}

/** AllowedTokenAccount size in bytes */
export const ALLOWED_TOKEN_ACCOUNT_SIZE = 122;

// New Account Deserialization

/** Deserialize WeeklySaleAccount from raw bytes */
export function deserializeWeeklySale(data: Uint8Array | Buffer): WeeklySaleAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key

  const payer = reader.readPubkey();
  const theme = reader.readU8();
  const bonusType = reader.readU8();
  reader.skip(1); // implicit padding for u16 alignment
  const bonusValueBps = reader.readU16();
  reader.skip(4); // _padding1
  const categoryDiscounts = reader.readU16Array(4);
  reader.skip(6); // implicit padding for i64 alignment
  const startsAt = reader.readI64();
  const endsAt = reader.readI64();
  const totalPurchases = reader.readU64();
  const totalRevenueLamports = reader.readU64();
  reader.skip(8); // _reserved
  reader.skip(7); // _padding2
  const bump = reader.readU8();

  return {
    payer,
    theme,
    bonusType,
    bonusValueBps,
    categoryDiscounts,
    startsAt,
    endsAt,
    totalPurchases,
    totalRevenueLamports,
    bump,
  };
}

/** Deserialize SeasonalSaleAccount from raw bytes */
export function deserializeSeasonalSale(data: Uint8Array | Buffer): SeasonalSaleAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key

  const payer = reader.readPubkey();
  const name = reader.readString(32);
  reader.skip(3); // implicit padding for u32 alignment
  const featuredItemIds = reader.readU32Array(10);
  const featuredDiscountsBps = reader.readU16Array(10);
  const featuredCount = reader.readU8();
  const statusValue = reader.readU8();
  const status = statusValue as SeasonalSaleStatus;
  const globalDiscountBps = reader.readU16();
  reader.skip(4); // _padding1
  const startsAt = reader.readI64();
  const endsAt = reader.readI64();
  const spendThreshold = reader.readU64();
  const exclusiveCosmeticId = reader.readU32();
  const exclusiveClaims = reader.readU32();
  const totalPurchases = reader.readU64();
  const totalRevenueLamports = reader.readU64();
  reader.skip(8); // _reserved
  reader.skip(7); // _padding2
  const bump = reader.readU8();

  return {
    payer,
    name,
    featuredItemIds,
    featuredDiscountsBps,
    featuredCount,
    status,
    globalDiscountBps,
    startsAt,
    endsAt,
    spendThreshold,
    exclusiveCosmeticId,
    exclusiveClaims,
    totalPurchases,
    totalRevenueLamports,
    bump,
  };
}

/** Deserialize DAOPromotionAccount from raw bytes */
export function deserializeDaoPromotion(data: Uint8Array | Buffer): DAOPromotionAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key

  const payer = reader.readPubkey();
  const title = reader.readString(32);
  reader.skip(1); // implicit padding for u16 alignment
  const equipmentDiscountBps = reader.readU16();
  const consumableDiscountBps = reader.readU16();
  const materialDiscountBps = reader.readU16();
  const cosmeticDiscountBps = reader.readU16();
  const globalDiscountBps = reader.readU16();
  const maxDiscountBps = reader.readU16();
  const statusValue = reader.readU8();
  const status = statusValue as DaoPromotionStatus;
  reader.skip(3); // _padding1
  reader.skip(6); // implicit padding for i64 alignment
  const approvedAt = reader.readI64();
  const startsAt = reader.readI64();
  const endsAt = reader.readI64();
  const maxDiscountBudgetLamports = reader.readU64();
  const usedDiscountBudget = reader.readU64();
  const totalPurchases = reader.readU64();
  const totalRevenueLamports = reader.readU64();
  const uniquePurchasers = reader.readU64();
  reader.skip(8); // _reserved
  reader.skip(7); // _padding2
  const bump = reader.readU8();

  return {
    payer,
    title,
    equipmentDiscountBps,
    consumableDiscountBps,
    materialDiscountBps,
    cosmeticDiscountBps,
    globalDiscountBps,
    maxDiscountBps,
    status,
    approvedAt,
    startsAt,
    endsAt,
    maxDiscountBudgetLamports,
    usedDiscountBudget,
    totalPurchases,
    totalRevenueLamports,
    uniquePurchasers,
    bump,
  };
}

/** Deserialize PlayerPurchaseAccount from raw bytes */
export function deserializePlayerPurchase(data: Uint8Array | Buffer): PlayerPurchaseAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key
  reader.skip(7); // implicit padding for u64 alignment

  const lifetimePurchased = reader.readU64();
  const purchasedToday = reader.readU64();
  const lastPurchaseDay = reader.readU64();
  reader.skip(8); // _reserved
  const bump = reader.readU8();

  return {
    lifetimePurchased,
    purchasedToday,
    lastPurchaseDay,
    bump,
  };
}

/** Deserialize AllowedTokenAccount from raw bytes */
export function deserializeAllowedToken(data: Uint8Array | Buffer): AllowedTokenAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key

  const mint = reader.readPubkey();
  const pythFeed = reader.readPubkey();
  const switchboardFeed = reader.readPubkey();
  reader.skip(1); // implicit padding for u16 alignment
  const maxStalenessSlots = reader.readU16();
  const confidenceThresholdBps = reader.readU16();
  const discountBps = reader.readU16();
  reader.skip(2); // _padding
  // pegged_to_usd took 1 byte from the head of _reserved. Existing accounts
  // pre-dating this field deserialize as `false` (the byte was zero-init).
  const peggedToUsd = reader.readU8() === 1;
  reader.skip(14); // _reserved
  const bump = reader.readU8();

  return {
    mint,
    pythFeed,
    switchboardFeed,
    maxStalenessSlots,
    confidenceThresholdBps,
    discountBps,
    peggedToUsd,
    bump,
  };
}

// New Account Parse Functions

/** Parse WeeklySaleAccount from account info */
export function parseWeeklySale(accountInfo: AccountInfo<Buffer>): WeeklySaleAccount | null {
  if (!accountInfo.data || accountInfo.data.length < WEEKLY_SALE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeWeeklySale(accountInfo.data);
}

/** Parse SeasonalSaleAccount from account info */
export function parseSeasonalSale(accountInfo: AccountInfo<Buffer>): SeasonalSaleAccount | null {
  if (!accountInfo.data || accountInfo.data.length < SEASONAL_SALE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeSeasonalSale(accountInfo.data);
}

/** Parse DAOPromotionAccount from account info */
export function parseDaoPromotion(accountInfo: AccountInfo<Buffer>): DAOPromotionAccount | null {
  if (!accountInfo.data || accountInfo.data.length < DAO_PROMOTION_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeDaoPromotion(accountInfo.data);
}

/** Parse PlayerPurchaseAccount from account info */
export function parsePlayerPurchase(accountInfo: AccountInfo<Buffer>): PlayerPurchaseAccount | null {
  if (!accountInfo.data || accountInfo.data.length < PLAYER_PURCHASE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializePlayerPurchase(accountInfo.data);
}

/** Parse AllowedTokenAccount from account info */
export function parseAllowedToken(accountInfo: AccountInfo<Buffer>): AllowedTokenAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ALLOWED_TOKEN_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeAllowedToken(accountInfo.data);
}

// New Account Helper Functions

/** Check if weekly sale is currently active */
export function isWeeklySaleActive(sale: WeeklySaleAccount, nowSeconds: number): boolean {
  return nowSeconds >= sale.startsAt.toNumber() && nowSeconds < sale.endsAt.toNumber();
}

/** Check if seasonal sale is currently active */
export function isSeasonalSaleActive(sale: SeasonalSaleAccount, nowSeconds: number): boolean {
  if (sale.status !== SeasonalSaleStatus.Active) return false;
  return nowSeconds >= sale.startsAt.toNumber() && nowSeconds < sale.endsAt.toNumber();
}

/** Check if DAO promotion is currently active */
export function isDaoPromotionActive(promotion: DAOPromotionAccount, nowSeconds: number): boolean {
  if (promotion.status !== DaoPromotionStatus.Active) return false;
  return nowSeconds >= promotion.startsAt.toNumber() && nowSeconds < promotion.endsAt.toNumber();
}

/** Check if DAO promotion has remaining budget */
export function hasDaoPromotionBudget(promotion: DAOPromotionAccount): boolean {
  return promotion.usedDiscountBudget.lt(promotion.maxDiscountBudgetLamports);
}

// Item Type Metadata (derived from on-chain fulfill_item)

export interface ItemTypeInfo {
  name: string;
  field: string;
  group: 'equipment' | 'consumable' | 'material' | 'currency' | 'cosmetic';
}

const ITEM_TYPE_MAP: Record<number, ItemTypeInfo> = {
  // Equipment (0-99)
  0:   { name: 'Melee Weapons',        field: 'meleeWeapons',        group: 'equipment' },
  1:   { name: 'Ranged Weapons',       field: 'rangedWeapons',       group: 'equipment' },
  2:   { name: 'Siege Weapons',        field: 'siegeWeapons',        group: 'equipment' },
  3:   { name: 'Armor Pieces',         field: 'armorPieces',         group: 'equipment' },
  4:   { name: 'Vehicles',             field: 'vehicles',            group: 'equipment' },

  // Currency (50-61)
  50:  { name: 'Gems',                 field: 'gems',                group: 'currency' },
  51:  { name: 'Cash',                 field: 'cashOnHand',          group: 'currency' },
  52:  { name: 'Fragments',            field: 'fragments',           group: 'currency' },
  53:  { name: 'Stamina Refill',       field: 'encounterStamina',    group: 'currency' },
  60:  { name: 'Encounter Stamina',    field: 'encounterStamina',    group: 'currency' },
  61:  { name: 'Produce',              field: 'produce',             group: 'currency' },

  // Consumables (100-199)
  100: { name: 'Stamina Potions',      field: 'staminaPotions',      group: 'consumable' },
  101: { name: 'XP Boosters',          field: 'xpBoosters',          group: 'consumable' },
  102: { name: 'Loot Magnets',         field: 'lootMagnets',         group: 'consumable' },
  103: { name: 'Shield Tokens',        field: 'shieldTokens',        group: 'consumable' },
  104: { name: 'Speed Elixirs',        field: 'speedElixirs',        group: 'consumable' },
  105: { name: 'Attack Boosters',      field: 'attackBoosters',      group: 'consumable' },
  106: { name: 'Defense Boosters',     field: 'defenseBoosters',     group: 'consumable' },
  107: { name: 'Collection Boosters',  field: 'collectionBoosters',  group: 'consumable' },
  108: { name: 'Rally Horns',          field: 'rallyHorns',          group: 'consumable' },
  109: { name: 'Teleport Scrolls',     field: 'teleportScrolls',     group: 'consumable' },
  110: { name: 'Mystery Keys',         field: 'mysteryKeys',         group: 'consumable' },

  // Materials (200-299)
  200: { name: 'Common Materials',     field: 'commonMaterials',     group: 'material' },
  201: { name: 'Uncommon Materials',   field: 'uncommonMaterials',   group: 'material' },
  202: { name: 'Rare Materials',       field: 'rareMaterials',       group: 'material' },
  203: { name: 'Epic Materials',       field: 'epicMaterials',       group: 'material' },
  204: { name: 'Legendary Materials',  field: 'legendaryMaterials',  group: 'material' },
};

/** Get human-readable info for an item type code from on-chain data */
export function getItemTypeInfo(itemType: number): ItemTypeInfo | null {
  return ITEM_TYPE_MAP[itemType] ?? null;
}

/** Get display name for a shop item based on its itemType and quantity */
export function getShopItemName(itemType: number, quantity: number): string {
  const info = ITEM_TYPE_MAP[itemType];
  if (!info) return `Item (type ${itemType})`;
  if (quantity > 1) return `${info.name} x${quantity}`;
  return info.name;
}

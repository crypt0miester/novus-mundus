/**
 * Shop Accounts
 *
 * ShopConfigAccount - Global shop settings (192 bytes with repr(C) padding)
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

import type { Address } from '@solana/kit';
import { reprC, struct, pad, u8, u16, u32, u64, i64, bool, pubkey, array, fixedString } from '../utils/codec';

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
  bronzeThreshold: bigint;
  silverThreshold: bigint;
  goldThreshold: bigint;
  platinumThreshold: bigint;
  diamondThreshold: bigint;

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
  totalSolCollected: bigint;
  totalNoviBurned: bigint;

  // State
  nextFlashSaleId: bigint;

  // Oracle config
  /** Pyth SOL/USD feed id (32-byte feed identifier, not an account). */
  solPythFeed: Address;
  /** Switchboard SOL/USD OracleQuote feed id (32-byte feed hash). */
  solSwitchboardFeed: Address;
  /** Switchboard On-Demand queue account; seeds the oracle-quote PDA. */
  solSwitchboardQueue: Address;
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
  priceSolLamports: bigint;
  availableFrom: bigint;
  availableUntil: bigint;
  maxGlobalStock: bigint;
  currentGlobalStock: bigint;
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
  priceSolLamports: bigint;
  availableFrom: bigint;
  availableUntil: bigint;
  totalPurchases: bigint;
  totalRevenueLamports: bigint;
  bump: number;
}

/** BundleAccount size in bytes */
export const BUNDLE_ACCOUNT_SIZE = 152;

// Daily Deal Account Interface

export interface DailyDealAccount {
  itemId: number;
  discountBps: number;
  startedAt: bigint;
  nextItemId: number;
  nextDiscountBps: number;
  purchasesToday: bigint;
  revenueTodayLamports: bigint;
  bump: number;
}

/** DailyDealAccount size in bytes */
export const DAILY_DEAL_ACCOUNT_SIZE = 64;

// Flash Sale Account Interface

export interface FlashSaleAccount {
  payer: Address;
  itemId: number;
  isBundle: boolean;
  status: FlashSaleStatus;
  discountBps: number;
  announcedAt: bigint;
  startsAt: bigint;
  endsAt: bigint;
  maxStock: bigint;
  remainingStock: bigint;
  totalClaims: bigint;
  totalRevenueLamports: bigint;
  bump: number;
}

/** FlashSaleAccount size in bytes */
export const FLASH_SALE_ACCOUNT_SIZE = 120;

// Codecs

/** ShopConfigAccount `#[repr(C)]` codec */
const shopConfigCodec = reprC<ShopConfigAccount>([
  pad(1), // account_key
  ['maxBaseDiscountBps', u16],
  ['maxBundleDiscountBps', u16],
  ['maxFibDiscountBps', u16],
  ['maxTotalDiscountBps', u16],
  ['maxFlashSalesPerDay', u8],
  ['maxDailyDeals', u8],
  ['flashSaleMinDurationSecs', u16],
  ['flashSaleMaxDurationSecs', u16],
  pad(2), // _padding1
  ['bronzeThreshold', u64],
  ['silverThreshold', u64],
  ['goldThreshold', u64],
  ['platinumThreshold', u64],
  ['diamondThreshold', u64],
  ['bronzeDiscountBps', u16],
  ['silverDiscountBps', u16],
  ['goldDiscountBps', u16],
  ['platinumDiscountBps', u16],
  ['diamondDiscountBps', u16],
  ['streakDay2Bps', u16],
  ['streakDay3Bps', u16],
  ['streakDay5Bps', u16],
  ['streakDay7Bps', u16],
  ['totalSolCollected', u64],
  ['totalNoviBurned', u64],
  ['nextFlashSaleId', u64],
  ['solPythFeed', pubkey],
  ['solSwitchboardFeed', pubkey],
  ['solSwitchboardQueue', pubkey],
  ['solMaxStalenessSlots', u16],
  ['solConfidenceThresholdBps', u16],
  pad(8), // _reserved
  pad(3), // _padding
  ['bump', u8],
], SHOP_CONFIG_ACCOUNT_SIZE);

/** ShopItemAccount `#[repr(C)]` codec */
const shopItemCodec = reprC<ShopItemAccount>([
  pad(1), // account_key
  ['itemType', u16],
  ['category', u8],
  ['rarity', u8],
  ['quantityPerPurchase', u16],
  ['baseStatsBps', u16],
  ['priceSolLamports', u64],
  pad(8), // _reserved_price
  ['availableFrom', i64],
  ['availableUntil', i64],
  ['maxGlobalStock', u64],
  ['currentGlobalStock', u64],
  ['maxPerPlayer', u32],
  ['maxPerDay', u16],
  pad(2), // _padding
  ['isActive', bool],
  ['isFeatured', bool],
  pad(8), // _reserved
  pad(5), // _padding
  ['bump', u8],
], SHOP_ITEM_ACCOUNT_SIZE);

/** BundleItem `#[repr(C)]` codec */
const bundleItemCodec = struct<BundleItem>([
  ['itemId', u32],
  ['quantity', u32],
]);

/** BundleAccount `#[repr(C)]` codec */
const bundleCodec = reprC<BundleAccount>([
  pad(1), // account_key
  ['tier', u8],
  ['category', u8],
  ['itemCount', u8],
  ['requiresSubscription', u8],
  ['savingsBps', u16],
  ['isActive', bool],
  pad(1), // _padding
  ['items', array(bundleItemCodec, 10)],
  ['priceSolLamports', u64],
  ['availableFrom', i64],
  ['availableUntil', i64],
  ['totalPurchases', u64],
  ['totalRevenueLamports', u64],
  pad(8), // _reserved
  pad(7), // _padding
  ['bump', u8],
], BUNDLE_ACCOUNT_SIZE);

/** DailyDealAccount `#[repr(C)]` codec */
const dailyDealCodec = reprC<DailyDealAccount>([
  pad(1), // account_key
  ['itemId', u32],
  ['discountBps', u16],
  pad(2), // _padding1
  ['startedAt', i64],
  ['nextItemId', u32],
  ['nextDiscountBps', u16],
  pad(2), // _padding
  ['purchasesToday', u64],
  ['revenueTodayLamports', u64],
  pad(8), // _reserved
  ['bump', u8],
], DAILY_DEAL_ACCOUNT_SIZE);

/** FlashSaleAccount `#[repr(C)]` codec */
const flashSaleCodec = reprC<FlashSaleAccount>([
  pad(1), // account_key
  ['payer', pubkey],
  ['itemId', u32],
  ['isBundle', bool],
  ['status', u8],
  ['discountBps', u16],
  ['announcedAt', i64],
  ['startsAt', i64],
  ['endsAt', i64],
  ['maxStock', u64],
  ['remainingStock', u64],
  ['totalClaims', u64],
  ['totalRevenueLamports', u64],
  pad(8), // _reserved
  pad(7), // _padding
  ['bump', u8],
], FLASH_SALE_ACCOUNT_SIZE);

// Deserialization

/** Deserialize ShopConfigAccount from raw bytes */
export function deserializeShopConfig(data: Uint8Array): ShopConfigAccount {
  return shopConfigCodec.decode(data);
}

/** Deserialize ShopItemAccount from raw bytes */
export function deserializeShopItem(data: Uint8Array): ShopItemAccount {
  return shopItemCodec.decode(data);
}

/** Deserialize BundleAccount from raw bytes */
export function deserializeBundle(data: Uint8Array): BundleAccount {
  const decoded = bundleCodec.decode(data);
  // `items` is a fixed [BundleItem; 10] array on-chain; expose only `itemCount`.
  return { ...decoded, items: decoded.items.slice(0, decoded.itemCount) };
}

/** Deserialize DailyDealAccount from raw bytes */
export function deserializeDailyDeal(data: Uint8Array): DailyDealAccount {
  return dailyDealCodec.decode(data);
}

/** Deserialize FlashSaleAccount from raw bytes */
export function deserializeFlashSale(data: Uint8Array): FlashSaleAccount {
  return flashSaleCodec.decode(data);
}

// Parse Functions

/** Parse ShopConfigAccount from account info */
export function parseShopConfig(accountInfo: { data: Uint8Array }): ShopConfigAccount | null {
  if (!accountInfo.data || accountInfo.data.length < SHOP_CONFIG_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeShopConfig(accountInfo.data);
}

/** Parse ShopItemAccount from account info */
export function parseShopItem(accountInfo: { data: Uint8Array }): ShopItemAccount | null {
  if (!accountInfo.data || accountInfo.data.length < SHOP_ITEM_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeShopItem(accountInfo.data);
}

/** Parse BundleAccount from account info */
export function parseBundle(accountInfo: { data: Uint8Array }): BundleAccount | null {
  if (!accountInfo.data || accountInfo.data.length < BUNDLE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeBundle(accountInfo.data);
}

/** Parse DailyDealAccount from account info */
export function parseDailyDeal(accountInfo: { data: Uint8Array }): DailyDealAccount | null {
  if (!accountInfo.data || accountInfo.data.length < DAILY_DEAL_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeDailyDeal(accountInfo.data);
}

/** Parse FlashSaleAccount from account info */
export function parseFlashSale(accountInfo: { data: Uint8Array }): FlashSaleAccount | null {
  if (!accountInfo.data || accountInfo.data.length < FLASH_SALE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeFlashSale(accountInfo.data);
}

// Helper Functions

/** Check if item is available for purchase */
export function isItemAvailable(item: ShopItemAccount, nowSeconds: number): boolean {
  if (!item.isActive) return false;
  const from = Number(item.availableFrom);
  const until = Number(item.availableUntil);
  if (from > 0 && nowSeconds < from) return false;
  if (until > 0 && nowSeconds > until) return false;
  return true;
}

/** Check if flash sale is currently active */
export function isFlashSaleActive(sale: FlashSaleAccount, nowSeconds: number): boolean {
  if (sale.status !== FlashSaleStatus.Active) return false;
  return nowSeconds >= Number(sale.startsAt) && nowSeconds < Number(sale.endsAt);
}

/** Check if flash sale can be closed */
export function canCloseFlashSale(sale: FlashSaleAccount): boolean {
  return sale.status === FlashSaleStatus.Ended || sale.status === FlashSaleStatus.SoldOut;
}

/** Get milestone tier from total spent */
export function getMilestoneTier(
  config: ShopConfigAccount,
  totalSpent: bigint
): 'none' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' {
  if (totalSpent >= config.diamondThreshold) return 'diamond';
  if (totalSpent >= config.platinumThreshold) return 'platinum';
  if (totalSpent >= config.goldThreshold) return 'gold';
  if (totalSpent >= config.silverThreshold) return 'silver';
  if (totalSpent >= config.bronzeThreshold) return 'bronze';
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
  payer: Address;
  theme: number;
  bonusType: number;
  bonusValueBps: number;
  categoryDiscounts: number[];
  startsAt: bigint;
  endsAt: bigint;
  totalPurchases: bigint;
  totalRevenueLamports: bigint;
  bump: number;
}

/** WeeklySaleAccount size in bytes */
export const WEEKLY_SALE_ACCOUNT_SIZE = 104;

// Seasonal Sale Account Interface

export interface SeasonalSaleAccount {
  payer: Address;
  name: string;
  featuredItemIds: number[];
  featuredDiscountsBps: number[];
  featuredCount: number;
  status: SeasonalSaleStatus;
  globalDiscountBps: number;
  startsAt: bigint;
  endsAt: bigint;
  spendThreshold: bigint;
  exclusiveCosmeticId: number;
  exclusiveClaims: number;
  totalPurchases: bigint;
  totalRevenueLamports: bigint;
  bump: number;
}

/** SeasonalSaleAccount size in bytes */
export const SEASONAL_SALE_ACCOUNT_SIZE = 200;

// DAO Promotion Account Interface

export interface DAOPromotionAccount {
  payer: Address;
  title: string;
  equipmentDiscountBps: number;
  consumableDiscountBps: number;
  materialDiscountBps: number;
  cosmeticDiscountBps: number;
  globalDiscountBps: number;
  maxDiscountBps: number;
  status: DaoPromotionStatus;
  approvedAt: bigint;
  startsAt: bigint;
  endsAt: bigint;
  maxDiscountBudgetLamports: bigint;
  usedDiscountBudget: bigint;
  totalPurchases: bigint;
  totalRevenueLamports: bigint;
  uniquePurchasers: bigint;
  bump: number;
}

/** DAOPromotionAccount size in bytes */
export const DAO_PROMOTION_ACCOUNT_SIZE = 168;

// Player Purchase Account Interface

export interface PlayerPurchaseAccount {
  lifetimePurchased: bigint;
  purchasedToday: bigint;
  lastPurchaseDay: bigint;
  bump: number;
}

/** PlayerPurchaseAccount size in bytes */
export const PLAYER_PURCHASE_ACCOUNT_SIZE = 48;

// Allowed Token Account Interface

export interface AllowedTokenAccount {
  mint: Address;
  pythFeed: Address;
  switchboardFeed: Address;
  maxStalenessSlots: number;
  confidenceThresholdBps: number;
  discountBps: number;
  bump: number;
}

/** AllowedTokenAccount size in bytes */
export const ALLOWED_TOKEN_ACCOUNT_SIZE = 122;

// New Account Deserialization

/** WeeklySaleAccount `#[repr(C)]` codec */
const weeklySaleCodec = reprC<WeeklySaleAccount>([
  pad(1), // account_key
  ['payer', pubkey],
  ['theme', u8],
  ['bonusType', u8],
  ['bonusValueBps', u16],
  pad(4), // _padding1
  ['categoryDiscounts', array(u16, 4)],
  ['startsAt', i64],
  ['endsAt', i64],
  ['totalPurchases', u64],
  ['totalRevenueLamports', u64],
  pad(8), // _reserved
  pad(7), // _padding2
  ['bump', u8],
], WEEKLY_SALE_ACCOUNT_SIZE);

/** SeasonalSaleAccount `#[repr(C)]` codec */
const seasonalSaleCodec = reprC<SeasonalSaleAccount>([
  pad(1), // account_key
  ['payer', pubkey],
  ['name', fixedString(32)],
  ['featuredItemIds', array(u32, 10)],
  ['featuredDiscountsBps', array(u16, 10)],
  ['featuredCount', u8],
  ['status', u8],
  ['globalDiscountBps', u16],
  pad(4), // _padding1
  ['startsAt', i64],
  ['endsAt', i64],
  ['spendThreshold', u64],
  ['exclusiveCosmeticId', u32],
  ['exclusiveClaims', u32],
  ['totalPurchases', u64],
  ['totalRevenueLamports', u64],
  pad(8), // _reserved
  pad(7), // _padding2
  ['bump', u8],
], SEASONAL_SALE_ACCOUNT_SIZE);

/** DAOPromotionAccount `#[repr(C)]` codec */
const daoPromotionCodec = reprC<DAOPromotionAccount>([
  pad(1), // account_key
  ['payer', pubkey],
  ['title', fixedString(32)],
  ['equipmentDiscountBps', u16],
  ['consumableDiscountBps', u16],
  ['materialDiscountBps', u16],
  ['cosmeticDiscountBps', u16],
  ['globalDiscountBps', u16],
  ['maxDiscountBps', u16],
  ['status', u8],
  pad(3), // _padding1
  ['approvedAt', i64],
  ['startsAt', i64],
  ['endsAt', i64],
  ['maxDiscountBudgetLamports', u64],
  ['usedDiscountBudget', u64],
  ['totalPurchases', u64],
  ['totalRevenueLamports', u64],
  ['uniquePurchasers', u64],
  pad(8), // _reserved
  pad(7), // _padding2
  ['bump', u8],
], DAO_PROMOTION_ACCOUNT_SIZE);

/** PlayerPurchaseAccount `#[repr(C)]` codec */
const playerPurchaseCodec = reprC<PlayerPurchaseAccount>([
  pad(1), // account_key
  ['lifetimePurchased', u64],
  ['purchasedToday', u64],
  ['lastPurchaseDay', u64],
  pad(8), // _reserved
  ['bump', u8],
], PLAYER_PURCHASE_ACCOUNT_SIZE);

/** AllowedTokenAccount `#[repr(C)]` codec */
const allowedTokenCodec = reprC<AllowedTokenAccount>([
  pad(1), // account_key
  ['mint', pubkey],
  ['pythFeed', pubkey],
  ['switchboardFeed', pubkey],
  ['maxStalenessSlots', u16],
  ['confidenceThresholdBps', u16],
  ['discountBps', u16],
  pad(2), // _padding
  pad(15), // _reserved
  ['bump', u8],
], ALLOWED_TOKEN_ACCOUNT_SIZE);

/** Deserialize WeeklySaleAccount from raw bytes */
export function deserializeWeeklySale(data: Uint8Array): WeeklySaleAccount {
  return weeklySaleCodec.decode(data);
}

/** Deserialize SeasonalSaleAccount from raw bytes */
export function deserializeSeasonalSale(data: Uint8Array): SeasonalSaleAccount {
  return seasonalSaleCodec.decode(data);
}

/** Deserialize DAOPromotionAccount from raw bytes */
export function deserializeDaoPromotion(data: Uint8Array): DAOPromotionAccount {
  return daoPromotionCodec.decode(data);
}

/** Deserialize PlayerPurchaseAccount from raw bytes */
export function deserializePlayerPurchase(data: Uint8Array): PlayerPurchaseAccount {
  return playerPurchaseCodec.decode(data);
}

/** Deserialize AllowedTokenAccount from raw bytes */
export function deserializeAllowedToken(data: Uint8Array): AllowedTokenAccount {
  return allowedTokenCodec.decode(data);
}

// New Account Parse Functions

/** Parse WeeklySaleAccount from account info */
export function parseWeeklySale(accountInfo: { data: Uint8Array }): WeeklySaleAccount | null {
  if (!accountInfo.data || accountInfo.data.length < WEEKLY_SALE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeWeeklySale(accountInfo.data);
}

/** Parse SeasonalSaleAccount from account info */
export function parseSeasonalSale(accountInfo: { data: Uint8Array }): SeasonalSaleAccount | null {
  if (!accountInfo.data || accountInfo.data.length < SEASONAL_SALE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeSeasonalSale(accountInfo.data);
}

/** Parse DAOPromotionAccount from account info */
export function parseDaoPromotion(accountInfo: { data: Uint8Array }): DAOPromotionAccount | null {
  if (!accountInfo.data || accountInfo.data.length < DAO_PROMOTION_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeDaoPromotion(accountInfo.data);
}

/** Parse PlayerPurchaseAccount from account info */
export function parsePlayerPurchase(accountInfo: { data: Uint8Array }): PlayerPurchaseAccount | null {
  if (!accountInfo.data || accountInfo.data.length < PLAYER_PURCHASE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializePlayerPurchase(accountInfo.data);
}

/** Parse AllowedTokenAccount from account info */
export function parseAllowedToken(accountInfo: { data: Uint8Array }): AllowedTokenAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ALLOWED_TOKEN_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeAllowedToken(accountInfo.data);
}

// New Account Helper Functions

/** Check if weekly sale is currently active */
export function isWeeklySaleActive(sale: WeeklySaleAccount, nowSeconds: number): boolean {
  return nowSeconds >= Number(sale.startsAt) && nowSeconds < Number(sale.endsAt);
}

/** Check if seasonal sale is currently active */
export function isSeasonalSaleActive(sale: SeasonalSaleAccount, nowSeconds: number): boolean {
  if (sale.status !== SeasonalSaleStatus.Active) return false;
  return nowSeconds >= Number(sale.startsAt) && nowSeconds < Number(sale.endsAt);
}

/** Check if DAO promotion is currently active */
export function isDaoPromotionActive(promotion: DAOPromotionAccount, nowSeconds: number): boolean {
  if (promotion.status !== DaoPromotionStatus.Active) return false;
  return nowSeconds >= Number(promotion.startsAt) && nowSeconds < Number(promotion.endsAt);
}

/** Check if DAO promotion has remaining budget */
export function hasDaoPromotionBudget(promotion: DAOPromotionAccount): boolean {
  return promotion.usedDiscountBudget < promotion.maxDiscountBudgetLamports;
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

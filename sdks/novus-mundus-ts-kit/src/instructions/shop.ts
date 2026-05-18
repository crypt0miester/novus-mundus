/**
 * Shop Instructions
 *
 * Instructions for shop system:
 * - Initialize config (admin)
 * - Create/update/purchase items
 * - Create/update/purchase bundles
 * - Flash sales, daily deals, weekly sales
 * - Seasonal sales, DAO promotions
 * - Allowed token management
 */

import type { Address, Instruction } from '@solana/kit';
import { addressBytes } from '../crypto';
import BN from 'bn.js';
import { PROGRAM_ID, DISCRIMINATORS, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  deriveGameEnginePda,
  derivePlayerPda,
  deriveEstatePda,
  deriveShopConfigPda,
  deriveShopItemPda,
  deriveBundlePda,
  deriveFlashSalePda,
  deriveDailyDealPda,
  deriveWeeklySalePda,
  deriveSeasonalSalePda,
  deriveDaoPromotionPda,
  derivePlayerPurchasePda,
  deriveInventoryPda,
  deriveAllowedTokenPda,
  deriveUserPda,
} from '../pda';
import { getAssociatedTokenAddressSyncForPda, SPL_TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '../utils/token';

// Initialize Config (Admin)

export interface InitializeConfigAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
}

export interface InitializeConfigParams {
  /** Max base discount in basis points */
  maxBaseDiscountBps?: number;
  /** Max bundle discount in basis points */
  maxBundleDiscountBps?: number;
  /** Max fibonacci discount in basis points */
  maxFibDiscountBps?: number;
  /** Max total discount in basis points */
  maxTotalDiscountBps?: number;
}

/** ~5,000 CU */
/**
 * Initialize shop configuration.
 *
 * Admin-only. Creates global shop config with discount caps.
 */
export function createInitializeConfigInstruction(
  accounts: InitializeConfigAccounts,
  params: InitializeConfigParams = {}
): Instruction {
    const [shopConfig] = deriveShopConfigPda(accounts.gameEngine);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: shopConfig, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Optional overrides (zeros use defaults)
  const writer = new BufferWriter(8);
  writer.writeU16(params.maxBaseDiscountBps ?? 0);
  writer.writeU16(params.maxBundleDiscountBps ?? 0);
  writer.writeU16(params.maxFibDiscountBps ?? 0);
  writer.writeU16(params.maxTotalDiscountBps ?? 0);

  const data = createInstructionData(DISCRIMINATORS.SHOP_INIT_CONFIG, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Item (Admin)

export interface CreateItemAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
}

export interface CreateItemParams {
  /** Unique item ID */
  itemId: number;
  /** Item type (0-99=equipment, 100-199=consumables, etc.) */
  itemType: number;
  /** Category (0=Equipment, 1=Consumable, 2=Material, 3=Cosmetic, 4=Currency) */
  category: number;
  /** Rarity (0-4) */
  rarity: number;
  /** Items received per purchase */
  quantityPerPurchase: number;
  /** Base stats bonus in basis points */
  baseStatsBps: number;
  /** Price in SOL lamports */
  priceSolLamports: BN | number | bigint;
  /** Available from timestamp (0=now) */
  availableFrom?: BN | number | bigint;
  /** Available until timestamp (0=forever) */
  availableUntil?: BN | number | bigint;
  /** Max global stock (0=unlimited) */
  maxGlobalStock?: BN | number | bigint;
  /** Max per player (0=unlimited) */
  maxPerPlayer?: number;
  /** Max per day (0=unlimited) */
  maxPerDay?: number;
  /** Is item active */
  isActive?: boolean;
  /** Is item featured */
  isFeatured?: boolean;
}

/** ~5,000 CU */
/**
 * Create a shop item.
 *
 * Admin-only. Creates a purchasable item in the shop.
 */
export function createCreateItemInstruction(
  accounts: CreateItemAccounts,
  params: CreateItemParams
): Instruction {
    const [shopItem] = deriveShopItemPda(accounts.gameEngine, params.itemId);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: shopItem, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data
  const writer = new BufferWriter(52);
  writer.writeU32(params.itemId);
  writer.writeU16(params.itemType);
  writer.writeU8(params.category);
  writer.writeU8(params.rarity);
  writer.writeU16(params.quantityPerPurchase);
  writer.writeU16(params.baseStatsBps);
  writer.writeU64(params.priceSolLamports);
  writer.writeI64(params.availableFrom ?? 0);
  writer.writeI64(params.availableUntil ?? 0);
  writer.writeU64(params.maxGlobalStock ?? 0);
  writer.writeU32(params.maxPerPlayer ?? 0);
  writer.writeU16(params.maxPerDay ?? 0);
  writer.writeBool(params.isActive ?? true);
  writer.writeBool(params.isFeatured ?? false);

  const data = createInstructionData(DISCRIMINATORS.SHOP_CREATE_ITEM, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Item (Admin)

export interface UpdateItemAccounts {
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Item ID to update */
  itemId: number;
}

/** Update field flags - which fields to update */
export enum UpdateItemField {
  PriceSol = 1,
  IsActive = 4,
  IsFeatured = 8,
  AvailableFrom = 16,
  AvailableUntil = 32,
  Stock = 64,
}

export interface UpdateItemParams {
  /** New price in lamports (requires PriceSol flag) */
  priceSolLamports?: BN | number | bigint;
  /** Is active (requires IsActive flag) */
  isActive?: boolean;
  /** Is featured (requires IsFeatured flag) */
  isFeatured?: boolean;
  /** Available from timestamp (requires AvailableFrom flag) */
  availableFrom?: BN | number | bigint;
  /** Available until timestamp (requires AvailableUntil flag) */
  availableUntil?: BN | number | bigint;
  /** Max global stock (requires Stock flag) */
  maxGlobalStock?: BN | number | bigint;
  /** Current global stock (requires Stock flag) */
  currentGlobalStock?: BN | number | bigint;
}

/** ~5,000 CU */
/**
 * Update a shop item.
 *
 * Admin-only. Updates item properties using bitmask flags.
 * Only fields with their flag set will be updated.
 */
export function createUpdateItemInstruction(
  accounts: UpdateItemAccounts,
  params: UpdateItemParams = {}
): Instruction {
    const [shopItem] = deriveShopItemPda(accounts.gameEngine, accounts.itemId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: shopItem, isSigner: false, isWritable: true },
  ];

  // Build update_flags bitmask and conditional data
  let updateFlags = 0;

  // Calculate data size: item_id(4) + update_flags(1) + conditional fields
  let dataSize = 5;
  if (params.priceSolLamports !== undefined) {
    updateFlags |= UpdateItemField.PriceSol;
    dataSize += 8;
  }
  if (params.isActive !== undefined) {
    updateFlags |= UpdateItemField.IsActive;
    dataSize += 1;
  }
  if (params.isFeatured !== undefined) {
    updateFlags |= UpdateItemField.IsFeatured;
    dataSize += 1;
  }
  if (params.availableFrom !== undefined) {
    updateFlags |= UpdateItemField.AvailableFrom;
    dataSize += 8;
  }
  if (params.availableUntil !== undefined) {
    updateFlags |= UpdateItemField.AvailableUntil;
    dataSize += 8;
  }
  if (params.maxGlobalStock !== undefined || params.currentGlobalStock !== undefined) {
    updateFlags |= UpdateItemField.Stock;
    dataSize += 16; // max_global_stock + current_global_stock
  }

  const writer = new BufferWriter(dataSize);
  writer.writeU32(accounts.itemId);
  writer.writeU8(updateFlags);

  // Write conditional fields in flag order
  if (updateFlags & UpdateItemField.PriceSol) {
    writer.writeU64(params.priceSolLamports!);
  }
  if (updateFlags & UpdateItemField.IsActive) {
    writer.writeBool(params.isActive!);
  }
  if (updateFlags & UpdateItemField.IsFeatured) {
    writer.writeBool(params.isFeatured!);
  }
  if (updateFlags & UpdateItemField.AvailableFrom) {
    writer.writeI64(params.availableFrom!);
  }
  if (updateFlags & UpdateItemField.AvailableUntil) {
    writer.writeI64(params.availableUntil!);
  }
  if (updateFlags & UpdateItemField.Stock) {
    writer.writeU64(params.maxGlobalStock ?? 0);
    writer.writeU64(params.currentGlobalStock ?? 0);
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ITEM, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Purchase Item

/**
 * The 6 caller-supplied accounts for an SPL-token payment (the 7th, the SPL
 * Token program, is fixed and appended automatically). Required when
 * `PurchaseItemParams.paymentType >= 2`. The on-chain processor expects them
 * in exactly this order after the base + discount accounts.
 */
export interface TokenPaymentAccounts {
  /** AllowedTokenAccount PDA for `tokenMint`. */
  allowedToken: Address;
  /** SPL mint of the payment token. */
  tokenMint: Address;
  /** Buyer's ATA for `tokenMint` (writable). */
  buyerTokenAta: Address;
  /** Treasury's ATA for `tokenMint` (writable). */
  treasuryTokenAta: Address;
  /** SOL/USD oracle feed — must equal shop_config.sol_pyth_feed. */
  solOracleFeed: Address;
  /** TOKEN/USD oracle feed — must equal allowed_token.pyth_feed. */
  tokenOracleFeed: Address;
}

export interface PurchaseItemAccounts {
  /** Buyer's wallet (signer) */
  buyer: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Item ID to purchase */
  itemId: number;
  /** Treasury wallet to receive payment */
  treasury: Address;
  /** Token-payment accounts — required iff params.paymentType >= 2. */
  tokenPayment?: TokenPaymentAccounts;
}

export interface PurchaseItemParams {
  /** Quantity of purchases (each gives quantityPerPurchase items) */
  quantity: number;
  /** Payment type (0=SOL, 2+=Token) */
  paymentType?: number;
  /** Discount flags bitmask (1=daily_deal, 2=weekly_sale) */
  discountFlags?: number;
  /** Daily deal slot index (if using daily deal) */
  dailyDealSlot?: number;
  /** Weekly sale week number (if using weekly sale) */
  weeklySaleWeek?: BN | number | bigint;
}

/** ~20,000 CU */
/**
 * Purchase an item from the shop.
 *
 * Handles payment and inventory fulfillment.
 */
export function createPurchaseItemInstruction(
  accounts: PurchaseItemAccounts,
  params: PurchaseItemParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.buyer);
    const [shopConfig] = deriveShopConfigPda(accounts.gameEngine);
  const [shopItem] = deriveShopItemPda(accounts.gameEngine, accounts.itemId);
  const [playerPurchase] = derivePlayerPurchasePda(accounts.buyer, accounts.itemId);
  const [inventory] = deriveInventoryPda(player);
  const [estate] = deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.buyer, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: shopConfig, isSigner: false, isWritable: false },
    { pubkey: shopItem, isSigner: false, isWritable: true },
    { pubkey: playerPurchase, isSigner: false, isWritable: true },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: inventory, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Add optional discount accounts
  if (params.discountFlags && (params.discountFlags & 1) !== 0 && params.dailyDealSlot !== undefined) {
    const [dailyDeal] = deriveDailyDealPda(accounts.gameEngine, params.dailyDealSlot);
    keys.push({ pubkey: dailyDeal, isSigner: false, isWritable: false });
  }
  if (params.discountFlags && (params.discountFlags & 2) !== 0 && params.weeklySaleWeek !== undefined) {
    const weekNum = BN.isBN(params.weeklySaleWeek) ? params.weeklySaleWeek.toNumber() : params.weeklySaleWeek;
    const [weeklySale] = deriveWeeklySalePda(accounts.gameEngine, weekNum);
    keys.push({ pubkey: weeklySale, isSigner: false, isWritable: false });
  }

  // Token-payment accounts (paymentType >= 2). The on-chain processor reads
  // these from accounts[token_offset..] where token_offset = 10 + discountAccts,
  // so they must come AFTER the discount accounts above.
  if ((params.paymentType ?? 0) >= 2) {
    if (!accounts.tokenPayment) {
      throw new Error('purchaseItem: tokenPayment accounts required when paymentType >= 2');
    }
    const tp = accounts.tokenPayment;
    keys.push({ pubkey: tp.allowedToken, isSigner: false, isWritable: false });
    keys.push({ pubkey: tp.tokenMint, isSigner: false, isWritable: false });
    keys.push({ pubkey: tp.buyerTokenAta, isSigner: false, isWritable: true });
    keys.push({ pubkey: tp.treasuryTokenAta, isSigner: false, isWritable: true });
    keys.push({ pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
    keys.push({ pubkey: tp.solOracleFeed, isSigner: false, isWritable: false });
    keys.push({ pubkey: tp.tokenOracleFeed, isSigner: false, isWritable: false });
  }

  // Instruction data
  const writer = new BufferWriter(16);
  writer.writeU32(accounts.itemId);
  writer.writeU16(params.quantity);
  writer.writeU8(params.paymentType ?? 0);
  writer.writeU8(params.discountFlags ?? 0);
  if (params.discountFlags && (params.discountFlags & 1) !== 0) {
    writer.writeU8(params.dailyDealSlot ?? 0);
  }
  if (params.discountFlags && (params.discountFlags & 2) !== 0) {
    writer.writeU64(params.weeklySaleWeek ?? 0);
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_PURCHASE_ITEM, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Bundle (Admin)

export interface CreateBundleItemInput {
  /** Item ID */
  itemId: number;
  /** Quantity of this item in bundle */
  quantity: number;
}

export interface CreateBundleAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
}

export interface CreateBundleParams {
  /** Unique bundle ID */
  bundleId: number;
  /** Bundle tier (0-4) */
  tier: number;
  /** Category */
  category: number;
  /** Subscription tier required (0=none) */
  requiresSubscription: number;
  /** Savings in basis points (for display) */
  savingsBps: number;
  /** Price in SOL lamports */
  priceSolLamports: BN | number | bigint;
  /** Available from timestamp */
  availableFrom: BN | number | bigint;
  /** Available until timestamp */
  availableUntil: BN | number | bigint;
  /** Is active */
  isActive: boolean;
  /** Items in bundle (2-10 items) */
  items: CreateBundleItemInput[];
}

/** ~10,000 CU */
/**
 * Create a bundle.
 *
 * Admin-only. Creates a pre-built bundle of items.
 */
export function createCreateBundleInstruction(
  accounts: CreateBundleAccounts,
  params: CreateBundleParams
): Instruction {
    const [bundle] = deriveBundlePda(accounts.gameEngine, params.bundleId);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: bundle, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Header: 35 bytes + items (8 bytes each)
  const writer = new BufferWriter(35 + params.items.length * 8);
  writer.writeU32(params.bundleId);
  writer.writeU8(params.tier);
  writer.writeU8(params.category);
  writer.writeU8(params.items.length);
  writer.writeU8(params.requiresSubscription);
  writer.writeU16(params.savingsBps);
  writer.writeU64(params.priceSolLamports);
  writer.writeI64(params.availableFrom);
  writer.writeI64(params.availableUntil);
  writer.writeBool(params.isActive);

  // Items
  for (const item of params.items) {
    writer.writeU32(item.itemId);
    writer.writeU32(item.quantity);
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_CREATE_BUNDLE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Bundle (Admin)

export interface UpdateBundleAccounts {
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Bundle ID to update */
  bundleId: number;
}

/** Update field flags for bundles */
export const UPDATE_BUNDLE_PRICE_SOL = 1;
export const UPDATE_BUNDLE_IS_ACTIVE = 2;
export const UPDATE_BUNDLE_AVAILABILITY = 4;
export const UPDATE_BUNDLE_SAVINGS_BPS = 8;

export interface UpdateBundleParams {
  /** New price in lamports */
  priceSolLamports?: BN | number | bigint;
  /** Is active */
  isActive?: boolean;
  /** Available from timestamp */
  availableFrom?: BN | number | bigint;
  /** Available until timestamp */
  availableUntil?: BN | number | bigint;
  /** Savings in basis points */
  savingsBps?: number;
}

/** ~5,000 CU */
/**
 * Update a bundle.
 *
 * Admin-only. Updates bundle properties using bitmask flags.
 * Only fields with their flag set will be updated.
 */
export function createUpdateBundleInstruction(
  accounts: UpdateBundleAccounts,
  params: UpdateBundleParams = {}
): Instruction {
    const [bundle] = deriveBundlePda(accounts.gameEngine, accounts.bundleId);

  // Rust account order: dao_authority, game_engine, bundle
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: bundle, isSigner: false, isWritable: true },
  ];

  // Build update_flags bitmask and conditional data
  let updateFlags = 0;

  // Calculate data size: bundle_id(4) + update_flags(1) + conditional fields
  let dataSize = 5;
  if (params.priceSolLamports !== undefined) {
    updateFlags |= UPDATE_BUNDLE_PRICE_SOL;
    dataSize += 8;
  }
  if (params.isActive !== undefined) {
    updateFlags |= UPDATE_BUNDLE_IS_ACTIVE;
    dataSize += 1;
  }
  if (params.availableFrom !== undefined || params.availableUntil !== undefined) {
    updateFlags |= UPDATE_BUNDLE_AVAILABILITY;
    dataSize += 16; // available_from + available_until
  }
  if (params.savingsBps !== undefined) {
    updateFlags |= UPDATE_BUNDLE_SAVINGS_BPS;
    dataSize += 2;
  }

  const writer = new BufferWriter(dataSize);
  writer.writeU32(accounts.bundleId);
  writer.writeU8(updateFlags);

  // Write conditional fields in flag order
  if (updateFlags & UPDATE_BUNDLE_PRICE_SOL) {
    writer.writeU64(params.priceSolLamports!);
  }
  if (updateFlags & UPDATE_BUNDLE_IS_ACTIVE) {
    writer.writeBool(params.isActive!);
  }
  if (updateFlags & UPDATE_BUNDLE_AVAILABILITY) {
    writer.writeI64(params.availableFrom ?? 0);
    writer.writeI64(params.availableUntil ?? 0);
  }
  if (updateFlags & UPDATE_BUNDLE_SAVINGS_BPS) {
    writer.writeU16(params.savingsBps!);
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_UPDATE_BUNDLE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Purchase Bundle

export interface PurchaseBundleAccounts {
  /** Buyer's wallet (signer) */
  buyer: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Bundle ID to purchase */
  bundleId: number;
  /** Treasury wallet */
  treasury: Address;
  /** Shop item accounts for each item in bundle */
  shopItemAccounts: Address[];
}

export interface PurchaseBundleParams {
  /** Payment type (0=SOL, 2+=Token) */
  paymentType?: number;
}

/** ~15,000 CU */
/**
 * Purchase a bundle.
 *
 * Handles bundled payment and fulfillment.
 */
export function createPurchaseBundleInstruction(
  accounts: PurchaseBundleAccounts,
  params: PurchaseBundleParams = {}
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.buyer);
    const [shopConfig] = deriveShopConfigPda(accounts.gameEngine);
  const [bundle] = deriveBundlePda(accounts.gameEngine, accounts.bundleId);
  const [inventory] = deriveInventoryPda(player);
  const [estate] = deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.buyer, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: shopConfig, isSigner: false, isWritable: false },
    { pubkey: bundle, isSigner: false, isWritable: true },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: inventory, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Add shop item accounts
  for (const itemAccount of accounts.shopItemAccounts) {
    keys.push({ pubkey: itemAccount, isSigner: false, isWritable: false });
  }

  const writer = new BufferWriter(5);
  writer.writeU32(accounts.bundleId);
  writer.writeU8(params.paymentType ?? 0);

  const data = createInstructionData(DISCRIMINATORS.SHOP_PURCHASE_BUNDLE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Flash Sale (Admin)

export interface CreateFlashSaleAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Sale ID (next_flash_sale_id from shop config, starts at 0) */
  saleId: number | bigint;
}

export interface CreateFlashSaleParams {
  /** Item or bundle ID */
  itemId: number;
  /** Is this a bundle (vs item) */
  isBundle: boolean;
  /** Discount in basis points (max 50%) */
  discountBps: number;
  /** Start timestamp */
  startsAt: BN | number | bigint;
  /** Duration in seconds */
  durationSecs: number;
  /** Max stock available */
  maxStock: BN | number | bigint;
}

/** ~10,000 CU */
/**
 * Create a flash sale.
 *
 * Admin-only. Time-limited sale with limited stock.
 */
export function createCreateFlashSaleInstruction(
  accounts: CreateFlashSaleAccounts,
  params: CreateFlashSaleParams
): Instruction {
    const [shopConfig] = deriveShopConfigPda(accounts.gameEngine);
  const [flashSale] = deriveFlashSalePda(accounts.gameEngine, accounts.saleId);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: shopConfig, isSigner: false, isWritable: true },
    { pubkey: flashSale, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(27);
  writer.writeU32(params.itemId);
  writer.writeBool(params.isBundle);
  writer.writeU16(params.discountBps);
  writer.writeI64(params.startsAt);
  writer.writeU32(params.durationSecs);
  writer.writeU64(params.maxStock);

  const data = createInstructionData(DISCRIMINATORS.SHOP_CREATE_FLASH_SALE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Purchase Flash Sale

export interface PurchaseFlashSaleAccounts {
  /** Buyer's wallet (signer) */
  buyer: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Flash sale ID */
  saleId: bigint | number;
  /** Item or bundle account being purchased (ShopItemAccount or BundleAccount) */
  itemOrBundle: Address;
  /** Treasury wallet */
  treasury: Address;
}

export interface PurchaseFlashSaleParams {
  /** Quantity to purchase (usually 1 for flash sales) */
  quantity: number;
  /** Payment type (0=SOL, 2+=Token via AllowedToken) */
  paymentType?: number;
}

/** ~40,000 CU */
/**
 * Purchase from a flash sale.
 *
 * Flash sales have limited stock and time. Applies flash sale discount
 * plus subscription tier discount.
 */
export function createPurchaseFlashSaleInstruction(
  accounts: PurchaseFlashSaleAccounts,
  params: PurchaseFlashSaleParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.buyer);
    const [shopConfig] = deriveShopConfigPda(accounts.gameEngine);
  const [flashSale] = deriveFlashSalePda(accounts.gameEngine, accounts.saleId);
  const [inventory] = deriveInventoryPda(player);
  const [estate] = deriveEstatePda(player);

  // Rust account order: buyer, player, game_engine, shop_config, flash_sale,
  //                     item_or_bundle, treasury, inventory, system_program, estate
  const keys = [
    { pubkey: accounts.buyer, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: shopConfig, isSigner: false, isWritable: false },
    { pubkey: flashSale, isSigner: false, isWritable: true },
    { pubkey: accounts.itemOrBundle, isSigner: false, isWritable: false },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: inventory, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Instruction data: sale_id (u64) + quantity (u16) + payment_type (u8)
  const saleIdBN = typeof accounts.saleId === 'bigint'
    ? new BN(accounts.saleId.toString())
    : new BN(accounts.saleId);

  const writer = new BufferWriter(11);
  writer.writeU64(saleIdBN);
  writer.writeU16(params.quantity);
  writer.writeU8(params.paymentType ?? 0);

  const data = createInstructionData(DISCRIMINATORS.SHOP_PURCHASE_FLASH_SALE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Close Sale (Admin / Owner)

/**
 * SaleType discriminant for `close_sale`. Mirrors the Rust enum:
 * 0=FlashSale, 1=WeeklySale, 2=SeasonalSale, 3=DAOPromotion, 4=PlayerPurchase.
 */
export type CloseSaleParams =
  | { saleType: 0; saleId: bigint | number }
  | { saleType: 1; weekNumber: bigint | number }
  | { saleType: 2; event: Address }
  | { saleType: 3; proposalId: bigint | number }
  | { saleType: 4; player: Address; itemId: number; shopItem: Address };

export interface CloseSaleAccounts {
  /** Signer — DAO authority OR the account's original payer/owner. */
  authority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Rent recipient (must equal account.payer when authority is not DAO). */
  rentRecipient: Address;
}

/** ~5,000 CU */
/**
 * Close a sale account and return rent to the recipient.
 *
 * The Rust processor accepts five SaleType variants — pass the matching
 * `CloseSaleParams` to derive the right PDA and ix payload. DAO authority can
 * close any sale regardless of state; non-DAO callers must be the original
 * payer AND the sale must be closable (ended/sold-out).
 */
export function createCloseSaleInstruction(
  accounts: CloseSaleAccounts,
  params: CloseSaleParams,
): Instruction {
  // Resolve sale PDA + numeric sale_id (encoded as u64 in ix data; SeasonalSale
  // is keyed by event pubkey so sale_id is unused on-chain but we still send 0
  // to satisfy the 9-byte payload length check).
  let salePda: Address;
  let saleIdU64: bigint;
  let extraKey: { pubkey: Address; isSigner: boolean; isWritable: boolean } | undefined;

  switch (params.saleType) {
    case 0:
      [salePda] = deriveFlashSalePda(accounts.gameEngine, params.saleId);
      saleIdU64 = BigInt(params.saleId);
      break;
    case 1:
      [salePda] = deriveWeeklySalePda(accounts.gameEngine, params.weekNumber);
      saleIdU64 = BigInt(params.weekNumber);
      break;
    case 2:
      [salePda] = deriveSeasonalSalePda(accounts.gameEngine, params.event);
      saleIdU64 = 0n;
      break;
    case 3:
      [salePda] = deriveDaoPromotionPda(accounts.gameEngine, params.proposalId);
      saleIdU64 = BigInt(params.proposalId);
      break;
    case 4: {
      [salePda] = derivePlayerPurchasePda(params.player, params.itemId);
      saleIdU64 = BigInt(params.itemId); // Rust treats sale_id as u32 item_id
      extraKey = { pubkey: params.shopItem, isSigner: false, isWritable: false };
      break;
    }
  }

  // Rust account order: [signer authority, gameEngine, sale (W), rentRecipient (W), shopItem?]
  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: salePda, isSigner: false, isWritable: true },
    { pubkey: accounts.rentRecipient, isSigner: false, isWritable: true },
  ];
  if (extraKey) keys.push(extraKey);

  // Payload: sale_type (u8) + sale_id (u64 LE)
  const writer = new BufferWriter(9);
  writer.writeU8(params.saleType);
  writer.writeU64(saleIdU64);

  const data = createInstructionData(DISCRIMINATORS.SHOP_CLOSE_SALE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Daily Deal (Admin)

export interface CreateDailyDealAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
}

export interface CreateDailyDealParams {
  /** Slot index (0-2) */
  slotIndex: number;
  /** Initial item ID for this deal */
  itemId: number;
  /** Initial discount in basis points (1500-4000) */
  discountBps: number;
  /** Next item ID (pre-computed for rotation) */
  nextItemId: number;
  /** Next discount in basis points (1500-4000) */
  nextDiscountBps: number;
}

/** ~5,000 CU */
/**
 * Create a daily deal.
 *
 * Admin-only. Creates rotating daily deals.
 */
export function createCreateDailyDealInstruction(
  accounts: CreateDailyDealAccounts,
  params: CreateDailyDealParams
): Instruction {
    const [dailyDeal] = deriveDailyDealPda(accounts.gameEngine, params.slotIndex);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: dailyDeal, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // slot(1) + item_id(4) + discount(2) + next_item(4) + next_discount(2) = 13
  const writer = new BufferWriter(13);
  writer.writeU8(params.slotIndex);
  writer.writeU32(params.itemId);
  writer.writeU16(params.discountBps);
  writer.writeU32(params.nextItemId);
  writer.writeU16(params.nextDiscountBps);

  const data = createInstructionData(DISCRIMINATORS.SHOP_CREATE_DAILY_DEAL, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Rotate Daily Deal (Admin)

export interface RotateDailyDealAccounts {
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Slot index to rotate */
  slotIndex: number;
}

export interface RotateDailyDealParams {
  /** New item ID */
  newItemId: number;
  /** New discount in basis points */
  newDiscountBps: number;
}

/** ~5,000 CU */
/**
 * Rotate a daily deal to a new item.
 *
 * Admin-only. Updates an existing daily deal slot.
 */
export function createRotateDailyDealInstruction(
  accounts: RotateDailyDealAccounts,
  params: RotateDailyDealParams
): Instruction {
    const [dailyDeal] = deriveDailyDealPda(accounts.gameEngine, accounts.slotIndex);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: dailyDeal, isSigner: false, isWritable: true },
  ];

  // slot_index(1) + new_next_item_id(4) + new_next_discount_bps(2) = 7
  const writer = new BufferWriter(7);
  writer.writeU8(accounts.slotIndex);
  writer.writeU32(params.newItemId);
  writer.writeU16(params.newDiscountBps);

  const data = createInstructionData(DISCRIMINATORS.SHOP_ROTATE_DAILY_DEAL, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Weekly Sale (Admin)

export interface CreateWeeklySaleAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
}

export interface CreateWeeklySaleParams {
  /** Week number (epoch week number for PDA) */
  weekNumber: BN | number | bigint;
  /** Theme (0=Combat, 1=Defense, 2=Resource, 3=Growth, 4=Expedition) */
  theme: number;
  /** Bonus type */
  bonusType: number;
  /** Bonus value in basis points */
  bonusValueBps: number;
  /** Category discounts [Equipment, Consumable, Material, Cosmetic] in bps (max 3000) */
  categoryDiscounts: [number, number, number, number];
  /** Start timestamp */
  startsAt: BN | number | bigint;
  /** Duration in days (1-7) */
  durationDays: number;
}

/** ~5,000 CU */
/**
 * Create a weekly sale.
 *
 * Admin-only. Category-wide discounts for a week.
 */
export function createCreateWeeklySaleInstruction(
  accounts: CreateWeeklySaleAccounts,
  params: CreateWeeklySaleParams
): Instruction {
    const weekNum = BN.isBN(params.weekNumber) ? params.weekNumber.toNumber() : params.weekNumber;
  const [weeklySale] = deriveWeeklySalePda(accounts.gameEngine, weekNum);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: weeklySale, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // week(8) + theme(1) + bonus_type(1) + bonus_value(2) + cats(8) + starts(8) + duration(1) = 29
  const writer = new BufferWriter(29);
  writer.writeU64(params.weekNumber);
  writer.writeU8(params.theme);
  writer.writeU8(params.bonusType);
  writer.writeU16(params.bonusValueBps);
  for (const discount of params.categoryDiscounts) {
    writer.writeU16(discount);
  }
  writer.writeI64(params.startsAt);
  writer.writeU8(params.durationDays);

  const data = createInstructionData(DISCRIMINATORS.SHOP_CREATE_WEEKLY_SALE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Seasonal Sale (Admin)

export interface CreateSeasonalSaleAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Event to link to */
  event: Address;
}

export interface CreateSeasonalSaleParams {
  /** Sale name (max 32 bytes UTF-8) */
  name: string;
  /** Global discount in basis points (max 5000) */
  globalDiscountBps: number;
  /** Start timestamp */
  startsAt: BN | number | bigint;
  /** End timestamp */
  endsAt: BN | number | bigint;
  /** Spend threshold for exclusive reward (lamports) */
  spendThreshold: BN | number | bigint;
  /** Exclusive cosmetic item ID */
  exclusiveCosmeticId: number;
  /** Featured items with individual discounts */
  featuredItems: Array<{ itemId: number; discountBps: number }>;
}

/** ~5,000 CU */
/**
 * Create a seasonal sale.
 *
 * Admin-only. Event-linked promotional sale.
 */
export function createCreateSeasonalSaleInstruction(
  accounts: CreateSeasonalSaleAccounts,
  params: CreateSeasonalSaleParams
): Instruction {
    const [seasonalSale] = deriveSeasonalSalePda(accounts.gameEngine, accounts.event);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.event, isSigner: false, isWritable: false },
    { pubkey: seasonalSale, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // name(32) + global_discount(2) + starts(8) + ends(8) + threshold(8) + cosmetic(4) + count(1) + items(6*n)
  const featuredCount = params.featuredItems.length;
  const writer = new BufferWriter(63 + featuredCount * 6);

  // Write name as fixed 32-byte buffer
  const nameBytes = Buffer.alloc(32);
  nameBytes.write(params.name.slice(0, 32), 'utf8');
  writer.writeBytes(nameBytes);

  writer.writeU16(params.globalDiscountBps);
  writer.writeI64(params.startsAt);
  writer.writeI64(params.endsAt);
  writer.writeU64(params.spendThreshold);
  writer.writeU32(params.exclusiveCosmeticId);
  writer.writeU8(featuredCount);

  for (const item of params.featuredItems) {
    writer.writeU32(item.itemId);
    writer.writeU16(item.discountBps);
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_CREATE_SEASONAL_SALE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create DAO Promotion (Admin)

export interface CreateDaoPromotionAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
}

export interface CreateDaoPromotionParams {
  /** Governance proposal ID (used in PDA) */
  proposalId: BN | number | bigint;
  /** Title (max 32 bytes UTF-8) */
  title: string;
  /** Equipment category discount in bps (max 5000) */
  equipmentDiscountBps: number;
  /** Consumable category discount in bps (max 5000) */
  consumableDiscountBps: number;
  /** Material category discount in bps (max 5000) */
  materialDiscountBps: number;
  /** Cosmetic category discount in bps (max 5000) */
  cosmeticDiscountBps: number;
  /** Global discount in bps (max 5000) */
  globalDiscountBps: number;
  /** Max discount in bps (max 5000) */
  maxDiscountBps: number;
  /** Start timestamp */
  startsAt: BN | number | bigint;
  /** End timestamp */
  endsAt: BN | number | bigint;
  /** Max discount budget in lamports */
  maxDiscountBudgetLamports: BN | number | bigint;
}

/** ~5,000 CU */
/**
 * Create a DAO promotion.
 *
 * Admin-only. Governance-approved promotional campaign.
 */
export function createCreateDaoPromotionInstruction(
  accounts: CreateDaoPromotionAccounts,
  params: CreateDaoPromotionParams
): Instruction {
    const proposalNum = BN.isBN(params.proposalId) ? params.proposalId.toNumber() : params.proposalId;
  const [daoPromotion] = deriveDaoPromotionPda(accounts.gameEngine, proposalNum);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: daoPromotion, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // proposal_id(8) + title(32) + discounts(12) + starts(8) + ends(8) + budget(8) = 76
  const writer = new BufferWriter(76);
  writer.writeU64(params.proposalId);

  const titleBytes = Buffer.alloc(32);
  titleBytes.write(params.title.slice(0, 32), 'utf8');
  writer.writeBytes(titleBytes);

  writer.writeU16(params.equipmentDiscountBps);
  writer.writeU16(params.consumableDiscountBps);
  writer.writeU16(params.materialDiscountBps);
  writer.writeU16(params.cosmeticDiscountBps);
  writer.writeU16(params.globalDiscountBps);
  writer.writeU16(params.maxDiscountBps);
  writer.writeI64(params.startsAt);
  writer.writeI64(params.endsAt);
  writer.writeU64(params.maxDiscountBudgetLamports);

  const data = createInstructionData(DISCRIMINATORS.SHOP_CREATE_DAO_PROMOTION, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Config (Admin)

export interface UpdateConfigAccounts {
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
}

export interface UpdateConfigParams {
  /** SOL Pyth price feed */
  solPythFeed?: Address;
  /** SOL Switchboard price feed */
  solSwitchboardFeed?: Address;
  /** Max staleness in slots */
  solMaxStalenessSlots?: number;
  /** Confidence threshold in basis points */
  solConfidenceThresholdBps?: number;
}

// Rust `update_config` update flag bits.
const UPDATE_SOL_ORACLE = 32;

/** ~20,000 CU */
/**
 * Update shop config.
 *
 * Admin-only. Currently this builder only sets the SOL oracle config flag
 * (other flags are pure DAO knobs not yet exposed). Layout matches the
 * Rust processor: `[update_flags: u8] + [...conditional sections...]`.
 *
 * For each non-zero feed pubkey in the SOL oracle section, the
 * corresponding feed account is appended after the 3 base accounts so
 * the program can owner-check + layout-validate at DAO config time.
 */
export function createUpdateConfigInstruction(
  accounts: UpdateConfigAccounts,
  params: UpdateConfigParams = {}
): Instruction {
    const [shopConfig] = deriveShopConfigPda(accounts.gameEngine);

  // Rust order: dao_authority, game_engine, shop_config
  // + trailing feed accounts for DAO-time validation when SOL oracle is being updated.
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: shopConfig, isSigner: false, isWritable: true },
  ];

  // Decide whether we're touching the SOL oracle section.
  const setsSolOracle =
    params.solPythFeed !== undefined ||
    params.solSwitchboardFeed !== undefined ||
    params.solMaxStalenessSlots !== undefined ||
    params.solConfidenceThresholdBps !== undefined;

  let updateFlags = 0;
  if (setsSolOracle) updateFlags |= UPDATE_SOL_ORACLE;

  // 1 byte flags + 68 bytes SOL oracle section (when flagged).
  const dataLen = 1 + (setsSolOracle ? 68 : 0);
  const writer = new BufferWriter(dataLen);
  writer.writeU8(updateFlags);

  if (setsSolOracle) {
    if (params.solPythFeed) {
      writer.writePubkey(params.solPythFeed);
      keys.push({ pubkey: params.solPythFeed, isSigner: false, isWritable: false });
    } else {
      writer.writeZeros(32);
    }
    if (params.solSwitchboardFeed) {
      writer.writePubkey(params.solSwitchboardFeed);
      keys.push({ pubkey: params.solSwitchboardFeed, isSigner: false, isWritable: false });
    } else {
      writer.writeZeros(32);
    }
    writer.writeU16(params.solMaxStalenessSlots ?? 0);
    writer.writeU16(params.solConfidenceThresholdBps ?? 0);
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_UPDATE_CONFIG, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Activate Sale (Permissionless crank)

/**
 * Activates SeasonalSale (saleType=0) or DAOPromotion (saleType=1).
 * The Rust processor walks the status state machine based on the current
 * clock; callers don't pass a target state.
 */
export type ActivateSaleParams =
  | { saleType: 0; event: Address }
  | { saleType: 1; proposalId: bigint | number };

export interface ActivateSaleAccounts {
  /** Anyone can call (permissionless crank). */
  crank: Address;
  /** GameEngine account */
  gameEngine: Address;
}

/** ~5,000 CU */
/**
 * Crank a sale forward through its lifecycle (Scheduled → Active → Ended).
 *
 * Permissionless. Caller pays the tx fee but never receives anything from
 * the call. Used by anyone to push a stale sale into its correct state.
 */
export function createActivateSaleInstruction(
  accounts: ActivateSaleAccounts,
  params: ActivateSaleParams,
): Instruction {
  let salePda: Address;
  // Payload: sale_type (u8) + sale_id (Seasonal: 32-byte event; DAOPromo: u64)
  let payload: Buffer;

  switch (params.saleType) {
    case 0: {
      [salePda] = deriveSeasonalSalePda(accounts.gameEngine, params.event);
      const w = new BufferWriter(33);
      w.writeU8(0);
      w.writeBytes(addressBytes(params.event));
      payload = w.toBuffer();
      break;
    }
    case 1: {
      [salePda] = deriveDaoPromotionPda(accounts.gameEngine, params.proposalId);
      const w = new BufferWriter(9);
      w.writeU8(1);
      w.writeU64(BigInt(params.proposalId));
      payload = w.toBuffer();
      break;
    }
  }

  // Rust account order: [signer crank, gameEngine, sale (W)]
  const keys = [
    { pubkey: accounts.crank, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: salePda, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.SHOP_ACTIVATE_SALE, payload);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Allowed Token (Admin)

export interface CreateAllowedTokenAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Token mint to allow */
  tokenMint: Address;
  /** Treasury wallet — must equal game_engine.treasury_wallet. Its ATA for
   *  `tokenMint` is provisioned by this instruction. */
  treasuryWallet: Address;
}

export interface CreateAllowedTokenParams {
  /** Pyth price feed (optional — at least one of pyth/switchboard must be set) */
  pythFeed?: Address;
  /** Switchboard price feed (optional — at least one of pyth/switchboard must be set) */
  switchboardFeed?: Address;
  /** Max staleness in slots */
  maxStalenessSlots: number;
  /** Confidence threshold in basis points */
  confidenceThresholdBps: number;
  /** Discount in basis points (0-10000) */
  discountBps: number;
}

/** ~10,000 CU */
/**
 * Create an allowed token for shop payments.
 *
 * Admin-only. Enables payment with this SPL token.
 */
export function createCreateAllowedTokenInstruction(
  accounts: CreateAllowedTokenAccounts,
  params: CreateAllowedTokenParams
): Instruction {
    const [allowedToken] = deriveAllowedTokenPda(accounts.gameEngine, accounts.tokenMint);
  const treasuryTokenAccount = getAssociatedTokenAddressSyncForPda(accounts.tokenMint, accounts.treasuryWallet);

  // Rust order (base 9): authority(signer+payer), game_engine, allowed_token,
  // token_mint, system_program, treasury_wallet, treasury_token_account,
  // token_program, associated_token_program — followed by 0–2 trailing feed
  // accounts (pyth then switchboard) for DAO-time owner + discriminator validation.
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: allowedToken, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenMint, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: accounts.treasuryWallet, isSigner: false, isWritable: false },
    { pubkey: treasuryTokenAccount, isSigner: false, isWritable: true },
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Pyth first, then Switchboard. Each only appears when the
  // corresponding pubkey is set; the program iterates in this fixed order.
  if (params.pythFeed) {
    keys.push({ pubkey: params.pythFeed, isSigner: false, isWritable: false });
  }
  if (params.switchboardFeed) {
    keys.push({ pubkey: params.switchboardFeed, isSigner: false, isWritable: false });
  }

  // Rust expects: pyth_feed(32) + switchboard_feed(32) + max_staleness_slots(u16) + confidence_threshold_bps(u16) + discount_bps(u16) = 70 bytes
  const writer = new BufferWriter(70);
  if (params.pythFeed) {
    writer.writePubkey(params.pythFeed);
  } else {
    writer.writeZeros(32);
  }
  if (params.switchboardFeed) {
    writer.writePubkey(params.switchboardFeed);
  } else {
    writer.writeZeros(32);
  }
  writer.writeU16(params.maxStalenessSlots);
  writer.writeU16(params.confidenceThresholdBps);
  writer.writeU16(params.discountBps);

  const data = createInstructionData(DISCRIMINATORS.SHOP_CREATE_ALLOWED_TOKEN, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Allowed Token (Admin)

export interface UpdateAllowedTokenAccounts {
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Token mint to update */
  tokenMint: Address;
}

export interface UpdateAllowedTokenParams {
  /** New Pyth feed (optional) */
  pythFeed?: Address;
  /** New Switchboard feed (optional) */
  switchboardFeed?: Address;
  /** New max staleness */
  maxStalenessSlots?: number;
  /** New confidence threshold */
  confidenceThresholdBps?: number;
  /** New discount in basis points */
  discountBps?: number;
}

/** ~5,000 CU */
/**
 * Update an allowed token configuration.
 *
 * Admin-only. Rust processor accepts one field per instruction call.
 * Returns an array of instructions (one per specified field).
 */
export function createUpdateAllowedTokenInstruction(
  accounts: UpdateAllowedTokenAccounts,
  params: UpdateAllowedTokenParams = {}
): Instruction[] {
  const [allowedToken] = deriveAllowedTokenPda(accounts.gameEngine, accounts.tokenMint);

  // Rust order: authority(signer), game_engine, allowed_token, token_mint
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: allowedToken, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenMint, isSigner: false, isWritable: false },
  ];

  const instructions: Instruction[] = [];

  // Field enum: PythFeed=0, SwitchboardFeed=1, MaxStalenessSlots=2, ConfidenceThresholdBps=3, DiscountBps=4
  // For PythFeed/SwitchboardFeed updates with a non-zero new pubkey, the
  // program requires the matching feed account in slot 4 to validate
  // owner + layout at DAO config time.
  if (params.pythFeed) {
    const writer = new BufferWriter(33);
    writer.writeU8(0); // PythFeed
    writer.writePubkey(params.pythFeed);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      [...keys, { pubkey: params.pythFeed, isSigner: false, isWritable: false }],
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, writer.toBuffer()),
    ));
  }
  if (params.switchboardFeed) {
    const writer = new BufferWriter(33);
    writer.writeU8(1); // SwitchboardFeed
    writer.writePubkey(params.switchboardFeed);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      [...keys, { pubkey: params.switchboardFeed, isSigner: false, isWritable: false }],
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, writer.toBuffer()),
    ));
  }
  if (params.maxStalenessSlots !== undefined) {
    const writer = new BufferWriter(3);
    writer.writeU8(2); // MaxStalenessSlots
    writer.writeU16(params.maxStalenessSlots);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      keys,
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, writer.toBuffer()),
    ));
  }
  if (params.confidenceThresholdBps !== undefined) {
    const writer = new BufferWriter(3);
    writer.writeU8(3); // ConfidenceThresholdBps
    writer.writeU16(params.confidenceThresholdBps);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      keys,
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, writer.toBuffer()),
    ));
  }
  if (params.discountBps !== undefined) {
    const writer = new BufferWriter(3);
    writer.writeU8(4); // DiscountBps
    writer.writeU16(params.discountBps);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      keys,
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, writer.toBuffer()),
    ));
  }

  return instructions;
}

// Close Allowed Token (Admin)

export interface CloseAllowedTokenAccounts {
  /** DAO authority (signer, receives rent) */
  daoAuthority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Token mint to close */
  tokenMint: Address;
}

/** ~5,000 CU */
/**
 * Close an allowed token.
 *
 * Admin-only. Reclaims rent.
 */
export function createCloseAllowedTokenInstruction(
  accounts: CloseAllowedTokenAccounts
): Instruction {
    const [allowedToken] = deriveAllowedTokenPda(accounts.gameEngine, accounts.tokenMint);

  // Rust order: authority(signer), game_engine, allowed_token, token_mint
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: allowedToken, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenMint, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.SHOP_CLOSE_ALLOWED_TOKEN);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Purchase NOVI

export interface PurchaseNoviAccounts {
  /** Buyer's wallet (signer) */
  buyer: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Treasury wallet to receive SOL payment */
  treasury: Address;
  /** NOVI token mint */
  noviMint: Address;
}

/** Optional oracle accounts for price discovery */
export interface PurchaseNoviOracleAccounts {
  /** ShopConfig account (for SOL oracle config) */
  shopConfig: Address;
  /** SOL/USD oracle feed (Pyth price account or Switchboard pull feed) */
  solOracleFeed: Address;
  /** NOVI/USD oracle feed (same oracle program as solOracleFeed) */
  noviOracleFeed: Address;
}

export interface PurchaseNoviParams {
  /** Package index (0-4) */
  packageIndex: number;
  /** Maximum lamports willing to pay (slippage protection) */
  maxLamports: BN | number | bigint;
  /** Optional oracle accounts for price discovery with 15% undercut */
  oracleAccounts?: PurchaseNoviOracleAccounts;
}

/** ~10,000 CU */
/**
 * Purchase NOVI tokens from the shop.
 *
 * Users select from fixed package amounts. NOVI is minted to the user's
 * reserved token account. Bonuses are applied based on:
 * - Package tier (bulk discount)
 * - Subscription tier
 * - Purchase streak (consecutive daily purchases)
 *
 * # Pricing
 * - If oracleAccounts is provided: uses oracle price with 15% undercut
 * - Otherwise: uses DAO-set fallback price (novi_base_price_lamports)
 *
 * # Accounts (Required - 9)
 * 0. [signer, writable] buyer - Wallet paying SOL
 * 1. [writable] user_account - UserAccount PDA (tracks purchases)
 * 2. [] player_account - PlayerAccount PDA (for subscription tier)
 * 3. [] game_engine - GameEngine (config & pricing)
 * 4. [writable] treasury - Treasury wallet (receives SOL)
 * 5. [writable] novi_mint - NOVI token mint
 * 6. [writable] reserved_token_account - User's reserved ATA (receives minted NOVI)
 * 7. [] token_program - SPL Token program
 * 8. [] system_program - System program
 *
 * # Accounts (Optional - Oracle Pricing, +3; Pyth or Switchboard)
 * 9. [] shop_config - ShopConfigAccount
 * 10. [] sol_oracle_feed - SOL/USD feed (Pyth or Switchboard pull feed)
 * 11. [] novi_oracle_feed - NOVI/USD feed (same oracle program as sol)
 */
export function createPurchaseNoviInstruction(
  accounts: PurchaseNoviAccounts,
  params: PurchaseNoviParams
): Instruction {
    const [user] = deriveUserPda(accounts.buyer);
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.buyer);

  // Reserved token account is owned by UserAccount PDA
  const reservedTokenAccount = getAssociatedTokenAddressSyncForPda(accounts.noviMint, user);

  const keys = [
    { pubkey: accounts.buyer, isSigner: true, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: accounts.noviMint, isSigner: false, isWritable: true },
    { pubkey: reservedTokenAccount, isSigner: false, isWritable: true },
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  if (params.oracleAccounts) {
    const oracle = params.oracleAccounts;
    keys.push(
      { pubkey: oracle.shopConfig, isSigner: false, isWritable: false },
      { pubkey: oracle.solOracleFeed, isSigner: false, isWritable: false },
      { pubkey: oracle.noviOracleFeed, isSigner: false, isWritable: false },
    );
  }

  // Instruction data: package_index (u8) + max_lamports (u64)
  const writer = new BufferWriter(9);
  writer.writeU8(params.packageIndex);
  writer.writeU64(params.maxLamports);

  const data = createInstructionData(DISCRIMINATORS.SHOP_PURCHASE_NOVI, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

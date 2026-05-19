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

import type { Address, Instruction, ReadonlyUint8Array } from '@solana/kit';
import { addressBytes } from '../crypto';
import { PROGRAM_ID, DISCRIMINATORS, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { concatBytes } from '../utils/bytes';
import { packed, u8, u16, u32, u64, i64, bool, fixedString, array, bytes } from '../utils/codec';
import {
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

/**
 * Decode a 32-byte Pyth feed id (64 hex chars, optional `0x` prefix).
 *
 * A Pyth pull-oracle feed is identified by this 32-byte feed id — NOT by an
 * account address. The on-chain program stores it in the `*_pyth_feed` config
 * fields and verifies it against the `PriceUpdateV2` account at purchase time.
 */
function feedIdBytes(feedId: string): Uint8Array {
  const hex = feedId.startsWith('0x') ? feedId.slice(2) : feedId;
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid Pyth feed id (expected 64 hex chars): ${feedId}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

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

/** InitializeConfig args (8 bytes) */
const initializeConfigArgs = packed<{
  maxBaseDiscountBps: number;
  maxBundleDiscountBps: number;
  maxFibDiscountBps: number;
  maxTotalDiscountBps: number;
}>([
  ['maxBaseDiscountBps', u16],
  ['maxBundleDiscountBps', u16],
  ['maxFibDiscountBps', u16],
  ['maxTotalDiscountBps', u16],
], 8);

/** ~5,000 CU */
/**
 * Initialize shop configuration.
 *
 * Admin-only. Creates global shop config with discount caps.
 */
export async function createInitializeConfigInstruction(
  accounts: InitializeConfigAccounts,
  params: InitializeConfigParams = {}
): Promise<Instruction> {
    const [shopConfig] = await deriveShopConfigPda(accounts.gameEngine);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: shopConfig, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Optional overrides (zeros use defaults)
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_INIT_CONFIG,
    initializeConfigArgs.encode({
      maxBaseDiscountBps: params.maxBaseDiscountBps ?? 0,
      maxBundleDiscountBps: params.maxBundleDiscountBps ?? 0,
      maxFibDiscountBps: params.maxFibDiscountBps ?? 0,
      maxTotalDiscountBps: params.maxTotalDiscountBps ?? 0,
    })
  );

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
  priceSolLamports: bigint | number;
  /** Available from timestamp (0=now) */
  availableFrom?: bigint | number;
  /** Available until timestamp (0=forever) */
  availableUntil?: bigint | number;
  /** Max global stock (0=unlimited) */
  maxGlobalStock?: bigint | number;
  /** Max per player (0=unlimited) */
  maxPerPlayer?: number;
  /** Max per day (0=unlimited) */
  maxPerDay?: number;
  /** Is item active */
  isActive?: boolean;
  /** Is item featured */
  isFeatured?: boolean;
}

/** CreateItem args (52 bytes) */
const createItemArgs = packed<{
  itemId: number;
  itemType: number;
  category: number;
  rarity: number;
  quantityPerPurchase: number;
  baseStatsBps: number;
  priceSolLamports: bigint;
  availableFrom: bigint;
  availableUntil: bigint;
  maxGlobalStock: bigint;
  maxPerPlayer: number;
  maxPerDay: number;
  isActive: boolean;
  isFeatured: boolean;
}>([
  ['itemId', u32],
  ['itemType', u16],
  ['category', u8],
  ['rarity', u8],
  ['quantityPerPurchase', u16],
  ['baseStatsBps', u16],
  ['priceSolLamports', u64],
  ['availableFrom', i64],
  ['availableUntil', i64],
  ['maxGlobalStock', u64],
  ['maxPerPlayer', u32],
  ['maxPerDay', u16],
  ['isActive', bool],
  ['isFeatured', bool],
], 52);

/** ~5,000 CU */
/**
 * Create a shop item.
 *
 * Admin-only. Creates a purchasable item in the shop.
 */
export async function createCreateItemInstruction(
  accounts: CreateItemAccounts,
  params: CreateItemParams
): Promise<Instruction> {
    const [shopItem] = await deriveShopItemPda(accounts.gameEngine, params.itemId);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: shopItem, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data (52 bytes)
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_CREATE_ITEM,
    createItemArgs.encode({
      itemId: params.itemId,
      itemType: params.itemType,
      category: params.category,
      rarity: params.rarity,
      quantityPerPurchase: params.quantityPerPurchase,
      baseStatsBps: params.baseStatsBps,
      priceSolLamports: BigInt(params.priceSolLamports),
      availableFrom: BigInt(params.availableFrom ?? 0),
      availableUntil: BigInt(params.availableUntil ?? 0),
      maxGlobalStock: BigInt(params.maxGlobalStock ?? 0),
      maxPerPlayer: params.maxPerPlayer ?? 0,
      maxPerDay: params.maxPerDay ?? 0,
      isActive: params.isActive ?? true,
      isFeatured: params.isFeatured ?? false,
    })
  );

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
  priceSolLamports?: bigint | number;
  /** Is active (requires IsActive flag) */
  isActive?: boolean;
  /** Is featured (requires IsFeatured flag) */
  isFeatured?: boolean;
  /** Available from timestamp (requires AvailableFrom flag) */
  availableFrom?: bigint | number;
  /** Available until timestamp (requires AvailableUntil flag) */
  availableUntil?: bigint | number;
  /** Max global stock (requires Stock flag) */
  maxGlobalStock?: bigint | number;
  /** Current global stock (requires Stock flag) */
  currentGlobalStock?: bigint | number;
}

/** UpdateItem fixed head (5 bytes): item_id (u32) + update_flags (u8). */
const updateItemHead = packed<{ itemId: number; updateFlags: number }>([
  ['itemId', u32],
  ['updateFlags', u8],
], 5);

/** ~5,000 CU */
/**
 * Update a shop item.
 *
 * Admin-only. Updates item properties using bitmask flags.
 * Only fields with their flag set will be updated.
 */
export async function createUpdateItemInstruction(
  accounts: UpdateItemAccounts,
  params: UpdateItemParams = {}
): Promise<Instruction> {
    const [shopItem] = await deriveShopItemPda(accounts.gameEngine, accounts.itemId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: shopItem, isSigner: false, isWritable: true },
  ];

  // Build update_flags bitmask and conditional data
  let updateFlags = 0;
  if (params.priceSolLamports !== undefined) updateFlags |= UpdateItemField.PriceSol;
  if (params.isActive !== undefined) updateFlags |= UpdateItemField.IsActive;
  if (params.isFeatured !== undefined) updateFlags |= UpdateItemField.IsFeatured;
  if (params.availableFrom !== undefined) updateFlags |= UpdateItemField.AvailableFrom;
  if (params.availableUntil !== undefined) updateFlags |= UpdateItemField.AvailableUntil;
  if (params.maxGlobalStock !== undefined || params.currentGlobalStock !== undefined) {
    updateFlags |= UpdateItemField.Stock;
  }

  // Variable-length payload: item_id (u32) + update_flags (u8) + conditional
  // fields written in flag order.
  const chunks: Array<Uint8Array | ReadonlyUint8Array> = [
    updateItemHead.encode({ itemId: accounts.itemId, updateFlags }),
  ];
  if (updateFlags & UpdateItemField.PriceSol) {
    chunks.push(u64.codec.encode(BigInt(params.priceSolLamports!)));
  }
  if (updateFlags & UpdateItemField.IsActive) {
    chunks.push(bool.codec.encode(params.isActive!));
  }
  if (updateFlags & UpdateItemField.IsFeatured) {
    chunks.push(bool.codec.encode(params.isFeatured!));
  }
  if (updateFlags & UpdateItemField.AvailableFrom) {
    chunks.push(i64.codec.encode(BigInt(params.availableFrom!)));
  }
  if (updateFlags & UpdateItemField.AvailableUntil) {
    chunks.push(i64.codec.encode(BigInt(params.availableUntil!)));
  }
  if (updateFlags & UpdateItemField.Stock) {
    chunks.push(u64.codec.encode(BigInt(params.maxGlobalStock ?? 0)));
    chunks.push(u64.codec.encode(BigInt(params.currentGlobalStock ?? 0)));
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ITEM, concatBytes(chunks));

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
  /** SOL/USD price feed account — a Pyth `PriceUpdateV2` account or a
   *  Switchboard pull feed (same oracle program as `tokenOracleFeed`). */
  solOracleFeed: Address;
  /** TOKEN/USD price feed account — a Pyth `PriceUpdateV2` account or a
   *  Switchboard pull feed (same oracle program as `solOracleFeed`). */
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
  weeklySaleWeek?: bigint | number;
}

/** PurchaseItem fixed head (8 bytes): item_id (u32) + quantity (u16) + payment_type (u8) + discount_flags (u8). */
const purchaseItemHead = packed<{
  itemId: number;
  quantity: number;
  paymentType: number;
  discountFlags: number;
}>([
  ['itemId', u32],
  ['quantity', u16],
  ['paymentType', u8],
  ['discountFlags', u8],
], 8);

/** ~20,000 CU */
/**
 * Purchase an item from the shop.
 *
 * Handles payment and inventory fulfillment.
 */
export async function createPurchaseItemInstruction(
  accounts: PurchaseItemAccounts,
  params: PurchaseItemParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.buyer);
    const [shopConfig] = await deriveShopConfigPda(accounts.gameEngine);
  const [shopItem] = await deriveShopItemPda(accounts.gameEngine, accounts.itemId);
  const [playerPurchase] = await derivePlayerPurchasePda(accounts.buyer, accounts.itemId);
  const [inventory] = await deriveInventoryPda(player);
  const [estate] = await deriveEstatePda(player);

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
    const [dailyDeal] = await deriveDailyDealPda(accounts.gameEngine, params.dailyDealSlot);
    keys.push({ pubkey: dailyDeal, isSigner: false, isWritable: false });
  }
  if (params.discountFlags && (params.discountFlags & 2) !== 0 && params.weeklySaleWeek !== undefined) {
    const weekNum = Number(params.weeklySaleWeek);
    const [weeklySale] = await deriveWeeklySalePda(accounts.gameEngine, weekNum);
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

  // Variable-length instruction data: fixed head + conditional discount fields.
  const chunks: Array<Uint8Array | ReadonlyUint8Array> = [
    purchaseItemHead.encode({
      itemId: accounts.itemId,
      quantity: params.quantity,
      paymentType: params.paymentType ?? 0,
      discountFlags: params.discountFlags ?? 0,
    }),
  ];
  if (params.discountFlags && (params.discountFlags & 1) !== 0) {
    chunks.push(u8.codec.encode(params.dailyDealSlot ?? 0));
  }
  if (params.discountFlags && (params.discountFlags & 2) !== 0) {
    chunks.push(u64.codec.encode(BigInt(params.weeklySaleWeek ?? 0)));
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_PURCHASE_ITEM, concatBytes(chunks));

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
  priceSolLamports: bigint | number;
  /** Available from timestamp */
  availableFrom: bigint | number;
  /** Available until timestamp */
  availableUntil: bigint | number;
  /** Is active */
  isActive: boolean;
  /** Items in bundle (2-10 items) */
  items: CreateBundleItemInput[];
}

/** CreateBundle fixed head (35 bytes). */
const createBundleHead = packed<{
  bundleId: number;
  tier: number;
  category: number;
  itemCount: number;
  requiresSubscription: number;
  savingsBps: number;
  priceSolLamports: bigint;
  availableFrom: bigint;
  availableUntil: bigint;
  isActive: boolean;
}>([
  ['bundleId', u32],
  ['tier', u8],
  ['category', u8],
  ['itemCount', u8],
  ['requiresSubscription', u8],
  ['savingsBps', u16],
  ['priceSolLamports', u64],
  ['availableFrom', i64],
  ['availableUntil', i64],
  ['isActive', bool],
], 35);

/** Single bundle item entry (8 bytes): item_id (u32) + quantity (u32). */
const bundleItemArgs = packed<{ itemId: number; quantity: number }>([
  ['itemId', u32],
  ['quantity', u32],
], 8);

/** ~10,000 CU */
/**
 * Create a bundle.
 *
 * Admin-only. Creates a pre-built bundle of items.
 */
export async function createCreateBundleInstruction(
  accounts: CreateBundleAccounts,
  params: CreateBundleParams
): Promise<Instruction> {
    const [bundle] = await deriveBundlePda(accounts.gameEngine, params.bundleId);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: bundle, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Variable-length payload: fixed 35-byte header + items (8 bytes each).
  const chunks: Array<Uint8Array | ReadonlyUint8Array> = [
    createBundleHead.encode({
      bundleId: params.bundleId,
      tier: params.tier,
      category: params.category,
      itemCount: params.items.length,
      requiresSubscription: params.requiresSubscription,
      savingsBps: params.savingsBps,
      priceSolLamports: BigInt(params.priceSolLamports),
      availableFrom: BigInt(params.availableFrom),
      availableUntil: BigInt(params.availableUntil),
      isActive: params.isActive,
    }),
  ];
  for (const item of params.items) {
    chunks.push(bundleItemArgs.encode({ itemId: item.itemId, quantity: item.quantity }));
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_CREATE_BUNDLE, concatBytes(chunks));

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
  priceSolLamports?: bigint | number;
  /** Is active */
  isActive?: boolean;
  /** Available from timestamp */
  availableFrom?: bigint | number;
  /** Available until timestamp */
  availableUntil?: bigint | number;
  /** Savings in basis points */
  savingsBps?: number;
}

/** UpdateBundle fixed head (5 bytes): bundle_id (u32) + update_flags (u8). */
const updateBundleHead = packed<{ bundleId: number; updateFlags: number }>([
  ['bundleId', u32],
  ['updateFlags', u8],
], 5);

/** ~5,000 CU */
/**
 * Update a bundle.
 *
 * Admin-only. Updates bundle properties using bitmask flags.
 * Only fields with their flag set will be updated.
 */
export async function createUpdateBundleInstruction(
  accounts: UpdateBundleAccounts,
  params: UpdateBundleParams = {}
): Promise<Instruction> {
    const [bundle] = await deriveBundlePda(accounts.gameEngine, accounts.bundleId);

  // Rust account order: dao_authority, game_engine, bundle
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: bundle, isSigner: false, isWritable: true },
  ];

  // Build update_flags bitmask and conditional data
  let updateFlags = 0;
  if (params.priceSolLamports !== undefined) updateFlags |= UPDATE_BUNDLE_PRICE_SOL;
  if (params.isActive !== undefined) updateFlags |= UPDATE_BUNDLE_IS_ACTIVE;
  if (params.availableFrom !== undefined || params.availableUntil !== undefined) {
    updateFlags |= UPDATE_BUNDLE_AVAILABILITY;
  }
  if (params.savingsBps !== undefined) updateFlags |= UPDATE_BUNDLE_SAVINGS_BPS;

  // Variable-length payload: bundle_id (u32) + update_flags (u8) + conditional
  // fields written in flag order.
  const chunks: Array<Uint8Array | ReadonlyUint8Array> = [
    updateBundleHead.encode({ bundleId: accounts.bundleId, updateFlags }),
  ];
  if (updateFlags & UPDATE_BUNDLE_PRICE_SOL) {
    chunks.push(u64.codec.encode(BigInt(params.priceSolLamports!)));
  }
  if (updateFlags & UPDATE_BUNDLE_IS_ACTIVE) {
    chunks.push(bool.codec.encode(params.isActive!));
  }
  if (updateFlags & UPDATE_BUNDLE_AVAILABILITY) {
    chunks.push(i64.codec.encode(BigInt(params.availableFrom ?? 0)));
    chunks.push(i64.codec.encode(BigInt(params.availableUntil ?? 0)));
  }
  if (updateFlags & UPDATE_BUNDLE_SAVINGS_BPS) {
    chunks.push(u16.codec.encode(params.savingsBps!));
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_UPDATE_BUNDLE, concatBytes(chunks));

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

/** PurchaseBundle args (5 bytes): bundle_id (u32) + payment_type (u8) */
const purchaseBundleArgs = packed<{ bundleId: number; paymentType: number }>([
  ['bundleId', u32],
  ['paymentType', u8],
], 5);

/** ~15,000 CU */
/**
 * Purchase a bundle.
 *
 * Handles bundled payment and fulfillment.
 */
export async function createPurchaseBundleInstruction(
  accounts: PurchaseBundleAccounts,
  params: PurchaseBundleParams = {}
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.buyer);
    const [shopConfig] = await deriveShopConfigPda(accounts.gameEngine);
  const [bundle] = await deriveBundlePda(accounts.gameEngine, accounts.bundleId);
  const [inventory] = await deriveInventoryPda(player);
  const [estate] = await deriveEstatePda(player);

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

  const data = createInstructionData(
    DISCRIMINATORS.SHOP_PURCHASE_BUNDLE,
    purchaseBundleArgs.encode({
      bundleId: accounts.bundleId,
      paymentType: params.paymentType ?? 0,
    })
  );

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
  startsAt: bigint | number;
  /** Duration in seconds */
  durationSecs: number;
  /** Max stock available */
  maxStock: bigint | number;
}

/** CreateFlashSale args (27 bytes) */
const createFlashSaleArgs = packed<{
  itemId: number;
  isBundle: boolean;
  discountBps: number;
  startsAt: bigint;
  durationSecs: number;
  maxStock: bigint;
}>([
  ['itemId', u32],
  ['isBundle', bool],
  ['discountBps', u16],
  ['startsAt', i64],
  ['durationSecs', u32],
  ['maxStock', u64],
], 27);

/** ~10,000 CU */
/**
 * Create a flash sale.
 *
 * Admin-only. Time-limited sale with limited stock.
 */
export async function createCreateFlashSaleInstruction(
  accounts: CreateFlashSaleAccounts,
  params: CreateFlashSaleParams
): Promise<Instruction> {
    const [shopConfig] = await deriveShopConfigPda(accounts.gameEngine);
  const [flashSale] = await deriveFlashSalePda(accounts.gameEngine, accounts.saleId);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: shopConfig, isSigner: false, isWritable: true },
    { pubkey: flashSale, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.SHOP_CREATE_FLASH_SALE,
    createFlashSaleArgs.encode({
      itemId: params.itemId,
      isBundle: params.isBundle,
      discountBps: params.discountBps,
      startsAt: BigInt(params.startsAt),
      durationSecs: params.durationSecs,
      maxStock: BigInt(params.maxStock),
    })
  );

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

/** PurchaseFlashSale args (11 bytes): sale_id (u64) + quantity (u16) + payment_type (u8) */
const purchaseFlashSaleArgs = packed<{
  saleId: bigint;
  quantity: number;
  paymentType: number;
}>([
  ['saleId', u64],
  ['quantity', u16],
  ['paymentType', u8],
], 11);

/** ~40,000 CU */
/**
 * Purchase from a flash sale.
 *
 * Flash sales have limited stock and time. Applies flash sale discount
 * plus subscription tier discount.
 */
export async function createPurchaseFlashSaleInstruction(
  accounts: PurchaseFlashSaleAccounts,
  params: PurchaseFlashSaleParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.buyer);
    const [shopConfig] = await deriveShopConfigPda(accounts.gameEngine);
  const [flashSale] = await deriveFlashSalePda(accounts.gameEngine, accounts.saleId);
  const [inventory] = await deriveInventoryPda(player);
  const [estate] = await deriveEstatePda(player);

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
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_PURCHASE_FLASH_SALE,
    purchaseFlashSaleArgs.encode({
      saleId: BigInt(accounts.saleId),
      quantity: params.quantity,
      paymentType: params.paymentType ?? 0,
    })
  );

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

/** CloseSale args (9 bytes): sale_type (u8) + sale_id (u64) */
const closeSaleArgs = packed<{ saleType: number; saleId: bigint }>([
  ['saleType', u8],
  ['saleId', u64],
], 9);

/** ~5,000 CU */
/**
 * Close a sale account and return rent to the recipient.
 *
 * The Rust processor accepts five SaleType variants — pass the matching
 * `CloseSaleParams` to derive the right PDA and ix payload. DAO authority can
 * close any sale regardless of state; non-DAO callers must be the original
 * payer AND the sale must be closable (ended/sold-out).
 */
export async function createCloseSaleInstruction(
  accounts: CloseSaleAccounts,
  params: CloseSaleParams,
): Promise<Instruction> {
  // Resolve sale PDA + numeric sale_id (encoded as u64 in ix data; SeasonalSale
  // is keyed by event pubkey so sale_id is unused on-chain but we still send 0
  // to satisfy the 9-byte payload length check).
  let salePda: Address;
  let saleIdU64: bigint;
  let extraKey: { pubkey: Address; isSigner: boolean; isWritable: boolean } | undefined;

  switch (params.saleType) {
    case 0:
      [salePda] = await deriveFlashSalePda(accounts.gameEngine, params.saleId);
      saleIdU64 = BigInt(params.saleId);
      break;
    case 1:
      [salePda] = await deriveWeeklySalePda(accounts.gameEngine, params.weekNumber);
      saleIdU64 = BigInt(params.weekNumber);
      break;
    case 2:
      [salePda] = await deriveSeasonalSalePda(accounts.gameEngine, params.event);
      saleIdU64 = 0n;
      break;
    case 3:
      [salePda] = await deriveDaoPromotionPda(accounts.gameEngine, params.proposalId);
      saleIdU64 = BigInt(params.proposalId);
      break;
    case 4: {
      [salePda] = await derivePlayerPurchasePda(params.player, params.itemId);
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
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_CLOSE_SALE,
    closeSaleArgs.encode({ saleType: params.saleType, saleId: saleIdU64 })
  );

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

/** CreateDailyDeal args (13 bytes) */
const createDailyDealArgs = packed<{
  slotIndex: number;
  itemId: number;
  discountBps: number;
  nextItemId: number;
  nextDiscountBps: number;
}>([
  ['slotIndex', u8],
  ['itemId', u32],
  ['discountBps', u16],
  ['nextItemId', u32],
  ['nextDiscountBps', u16],
], 13);

/** ~5,000 CU */
/**
 * Create a daily deal.
 *
 * Admin-only. Creates rotating daily deals.
 */
export async function createCreateDailyDealInstruction(
  accounts: CreateDailyDealAccounts,
  params: CreateDailyDealParams
): Promise<Instruction> {
    const [dailyDeal] = await deriveDailyDealPda(accounts.gameEngine, params.slotIndex);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: dailyDeal, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // slot(1) + item_id(4) + discount(2) + next_item(4) + next_discount(2) = 13
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_CREATE_DAILY_DEAL,
    createDailyDealArgs.encode({
      slotIndex: params.slotIndex,
      itemId: params.itemId,
      discountBps: params.discountBps,
      nextItemId: params.nextItemId,
      nextDiscountBps: params.nextDiscountBps,
    })
  );

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

/** RotateDailyDeal args (7 bytes) */
const rotateDailyDealArgs = packed<{
  slotIndex: number;
  newItemId: number;
  newDiscountBps: number;
}>([
  ['slotIndex', u8],
  ['newItemId', u32],
  ['newDiscountBps', u16],
], 7);

/** ~5,000 CU */
/**
 * Rotate a daily deal to a new item.
 *
 * Admin-only. Updates an existing daily deal slot.
 */
export async function createRotateDailyDealInstruction(
  accounts: RotateDailyDealAccounts,
  params: RotateDailyDealParams
): Promise<Instruction> {
    const [dailyDeal] = await deriveDailyDealPda(accounts.gameEngine, accounts.slotIndex);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: dailyDeal, isSigner: false, isWritable: true },
  ];

  // slot_index(1) + new_next_item_id(4) + new_next_discount_bps(2) = 7
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_ROTATE_DAILY_DEAL,
    rotateDailyDealArgs.encode({
      slotIndex: accounts.slotIndex,
      newItemId: params.newItemId,
      newDiscountBps: params.newDiscountBps,
    })
  );

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
  weekNumber: bigint | number;
  /** Theme (0=Combat, 1=Defense, 2=Resource, 3=Growth, 4=Expedition) */
  theme: number;
  /** Bonus type */
  bonusType: number;
  /** Bonus value in basis points */
  bonusValueBps: number;
  /** Category discounts [Equipment, Consumable, Material, Cosmetic] in bps (max 3000) */
  categoryDiscounts: [number, number, number, number];
  /** Start timestamp */
  startsAt: bigint | number;
  /** Duration in days (1-7) */
  durationDays: number;
}

/** CreateWeeklySale args (29 bytes) */
const createWeeklySaleArgs = packed<{
  weekNumber: bigint;
  theme: number;
  bonusType: number;
  bonusValueBps: number;
  categoryDiscounts: number[];
  startsAt: bigint;
  durationDays: number;
}>([
  ['weekNumber', u64],
  ['theme', u8],
  ['bonusType', u8],
  ['bonusValueBps', u16],
  ['categoryDiscounts', array(u16, 4)],
  ['startsAt', i64],
  ['durationDays', u8],
], 29);

/** ~5,000 CU */
/**
 * Create a weekly sale.
 *
 * Admin-only. Category-wide discounts for a week.
 */
export async function createCreateWeeklySaleInstruction(
  accounts: CreateWeeklySaleAccounts,
  params: CreateWeeklySaleParams
): Promise<Instruction> {
    const weekNum = Number(params.weekNumber);
  const [weeklySale] = await deriveWeeklySalePda(accounts.gameEngine, weekNum);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: weeklySale, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // week(8) + theme(1) + bonus_type(1) + bonus_value(2) + cats(8) + starts(8) + duration(1) = 29
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_CREATE_WEEKLY_SALE,
    createWeeklySaleArgs.encode({
      weekNumber: BigInt(params.weekNumber),
      theme: params.theme,
      bonusType: params.bonusType,
      bonusValueBps: params.bonusValueBps,
      categoryDiscounts: [...params.categoryDiscounts],
      startsAt: BigInt(params.startsAt),
      durationDays: params.durationDays,
    })
  );

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
  startsAt: bigint | number;
  /** End timestamp */
  endsAt: bigint | number;
  /** Spend threshold for exclusive reward (lamports) */
  spendThreshold: bigint | number;
  /** Exclusive cosmetic item ID */
  exclusiveCosmeticId: number;
  /** Featured items with individual discounts */
  featuredItems: Array<{ itemId: number; discountBps: number }>;
}

/** CreateSeasonalSale fixed head (63 bytes). */
const seasonalSaleHead = packed<{
  name: string;
  globalDiscountBps: number;
  startsAt: bigint;
  endsAt: bigint;
  spendThreshold: bigint;
  exclusiveCosmeticId: number;
  featuredCount: number;
}>([
  ['name', fixedString(32)],
  ['globalDiscountBps', u16],
  ['startsAt', i64],
  ['endsAt', i64],
  ['spendThreshold', u64],
  ['exclusiveCosmeticId', u32],
  ['featuredCount', u8],
], 63);

/** Single seasonal-sale featured item (6 bytes): item_id (u32) + discount_bps (u16). */
const seasonalFeaturedArgs = packed<{ itemId: number; discountBps: number }>([
  ['itemId', u32],
  ['discountBps', u16],
], 6);

/** ~5,000 CU */
/**
 * Create a seasonal sale.
 *
 * Admin-only. Event-linked promotional sale.
 */
export async function createCreateSeasonalSaleInstruction(
  accounts: CreateSeasonalSaleAccounts,
  params: CreateSeasonalSaleParams
): Promise<Instruction> {
    const [seasonalSale] = await deriveSeasonalSalePda(accounts.gameEngine, accounts.event);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.event, isSigner: false, isWritable: false },
    { pubkey: seasonalSale, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Variable-length payload: fixed 63-byte header + featured items (6 bytes each).
  // Header: name(32) + global_discount(2) + starts(8) + ends(8) + threshold(8) + cosmetic(4) + count(1)
  const featuredCount = params.featuredItems.length;
  const chunks: Array<Uint8Array | ReadonlyUint8Array> = [
    seasonalSaleHead.encode({
      name: params.name.slice(0, 32),
      globalDiscountBps: params.globalDiscountBps,
      startsAt: BigInt(params.startsAt),
      endsAt: BigInt(params.endsAt),
      spendThreshold: BigInt(params.spendThreshold),
      exclusiveCosmeticId: params.exclusiveCosmeticId,
      featuredCount,
    }),
  ];
  for (const item of params.featuredItems) {
    chunks.push(seasonalFeaturedArgs.encode({ itemId: item.itemId, discountBps: item.discountBps }));
  }

  const data = createInstructionData(
    DISCRIMINATORS.SHOP_CREATE_SEASONAL_SALE,
    concatBytes(chunks),
  );

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
  proposalId: bigint | number;
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
  startsAt: bigint | number;
  /** End timestamp */
  endsAt: bigint | number;
  /** Max discount budget in lamports */
  maxDiscountBudgetLamports: bigint | number;
}

/** CreateDaoPromotion args (76 bytes) */
const createDaoPromotionArgs = packed<{
  proposalId: bigint;
  title: string;
  equipmentDiscountBps: number;
  consumableDiscountBps: number;
  materialDiscountBps: number;
  cosmeticDiscountBps: number;
  globalDiscountBps: number;
  maxDiscountBps: number;
  startsAt: bigint;
  endsAt: bigint;
  maxDiscountBudgetLamports: bigint;
}>([
  ['proposalId', u64],
  ['title', fixedString(32)],
  ['equipmentDiscountBps', u16],
  ['consumableDiscountBps', u16],
  ['materialDiscountBps', u16],
  ['cosmeticDiscountBps', u16],
  ['globalDiscountBps', u16],
  ['maxDiscountBps', u16],
  ['startsAt', i64],
  ['endsAt', i64],
  ['maxDiscountBudgetLamports', u64],
], 76);

/** ~5,000 CU */
/**
 * Create a DAO promotion.
 *
 * Admin-only. Governance-approved promotional campaign.
 */
export async function createCreateDaoPromotionInstruction(
  accounts: CreateDaoPromotionAccounts,
  params: CreateDaoPromotionParams
): Promise<Instruction> {
    const proposalNum = Number(params.proposalId);
  const [daoPromotion] = await deriveDaoPromotionPda(accounts.gameEngine, proposalNum);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: daoPromotion, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // proposal_id(8) + title(32) + discounts(12) + starts(8) + ends(8) + budget(8) = 76
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_CREATE_DAO_PROMOTION,
    createDaoPromotionArgs.encode({
      proposalId: BigInt(params.proposalId),
      title: params.title,
      equipmentDiscountBps: params.equipmentDiscountBps,
      consumableDiscountBps: params.consumableDiscountBps,
      materialDiscountBps: params.materialDiscountBps,
      cosmeticDiscountBps: params.cosmeticDiscountBps,
      globalDiscountBps: params.globalDiscountBps,
      maxDiscountBps: params.maxDiscountBps,
      startsAt: BigInt(params.startsAt),
      endsAt: BigInt(params.endsAt),
      maxDiscountBudgetLamports: BigInt(params.maxDiscountBudgetLamports),
    })
  );

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
  /** SOL/USD Pyth feed id — 32-byte feed id as 64 hex chars (NOT an account). */
  solPythFeed?: string;
  /** SOL/USD Switchboard pull-feed account address. */
  solSwitchboardFeed?: Address;
  /** Max price age — seconds for Pyth, slots for Switchboard. */
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
 * The Pyth feed is a bare 32-byte feed id (no account). When a non-zero
 * Switchboard feed is set, its account is appended after the 3 base accounts
 * so the program can owner-check + layout-validate it at DAO config time.
 */
export async function createUpdateConfigInstruction(
  accounts: UpdateConfigAccounts,
  params: UpdateConfigParams = {}
): Promise<Instruction> {
    const [shopConfig] = await deriveShopConfigPda(accounts.gameEngine);

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
  const chunks: Array<Uint8Array | ReadonlyUint8Array> = [u8.codec.encode(updateFlags)];

  if (setsSolOracle) {
    // Pyth feed is a 32-byte feed id encoded into instruction data — it has
    // no account and consumes no trailing key slot.
    const pythFeed = params.solPythFeed
      ? feedIdBytes(params.solPythFeed)
      : new Uint8Array(32);
    const switchboardFeed = params.solSwitchboardFeed
      ? addressBytes(params.solSwitchboardFeed)
      : new Uint8Array(32);
    if (params.solSwitchboardFeed) {
      keys.push({ pubkey: params.solSwitchboardFeed, isSigner: false, isWritable: false });
    }
    chunks.push(pythFeed);
    chunks.push(switchboardFeed);
    chunks.push(u16.codec.encode(params.solMaxStalenessSlots ?? 0));
    chunks.push(u16.codec.encode(params.solConfidenceThresholdBps ?? 0));
  }

  const data = createInstructionData(DISCRIMINATORS.SHOP_UPDATE_CONFIG, concatBytes(chunks));

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
export async function createActivateSaleInstruction(
  accounts: ActivateSaleAccounts,
  params: ActivateSaleParams,
): Promise<Instruction> {
  let salePda: Address;
  // Payload: sale_type (u8) + sale_id (Seasonal: 32-byte event; DAOPromo: u64)
  let payload: Uint8Array;

  switch (params.saleType) {
    case 0: {
      [salePda] = await deriveSeasonalSalePda(accounts.gameEngine, params.event);
      payload = concatBytes([u8.codec.encode(0), addressBytes(params.event)]);
      break;
    }
    case 1: {
      [salePda] = await deriveDaoPromotionPda(accounts.gameEngine, params.proposalId);
      payload = concatBytes([u8.codec.encode(1), u64.codec.encode(BigInt(params.proposalId))]);
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
  /** Pyth feed id — 32-byte feed id as 64 hex chars, NOT an account.
   *  Optional; at least one of pyth/switchboard must be set. */
  pythFeed?: string;
  /** Switchboard pull-feed account address.
   *  Optional; at least one of pyth/switchboard must be set. */
  switchboardFeed?: Address;
  /** Max price age — seconds for Pyth, slots for Switchboard. */
  maxStalenessSlots: number;
  /** Confidence threshold in basis points */
  confidenceThresholdBps: number;
  /** Discount in basis points (0-10000) */
  discountBps: number;
}

/**
 * CreateAllowedToken args (70 bytes): pyth_feed [u8;32] + switchboard_feed
 * [u8;32] + max_staleness_slots (u16) + confidence_threshold_bps (u16) +
 * discount_bps (u16). Unset feeds are encoded as 32 zero bytes.
 */
const createAllowedTokenArgs = packed<{
  pythFeed: Uint8Array;
  switchboardFeed: Uint8Array;
  maxStalenessSlots: number;
  confidenceThresholdBps: number;
  discountBps: number;
}>([
  ['pythFeed', bytes(32)],
  ['switchboardFeed', bytes(32)],
  ['maxStalenessSlots', u16],
  ['confidenceThresholdBps', u16],
  ['discountBps', u16],
], 70);

const ZERO_PUBKEY_BYTES = new Uint8Array(32);

/** ~10,000 CU */
/**
 * Create an allowed token for shop payments.
 *
 * Admin-only. Enables payment with this SPL token.
 */
export async function createCreateAllowedTokenInstruction(
  accounts: CreateAllowedTokenAccounts,
  params: CreateAllowedTokenParams
): Promise<Instruction> {
    const [allowedToken] = await deriveAllowedTokenPda(accounts.gameEngine, accounts.tokenMint);
  const treasuryTokenAccount = await getAssociatedTokenAddressSyncForPda(accounts.tokenMint, accounts.treasuryWallet);

  // Rust order (base 9): authority(signer+payer), game_engine, allowed_token,
  // token_mint, system_program, treasury_wallet, treasury_token_account,
  // token_program, associated_token_program — followed by an optional trailing
  // Switchboard feed account for DAO-time owner + discriminator validation.
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

  // The Pyth feed is a bare 32-byte feed id (no account). Only a non-zero
  // Switchboard feed appends a trailing account, which the program
  // owner-checks + layout-validates at config time.
  if (params.switchboardFeed) {
    keys.push({ pubkey: params.switchboardFeed, isSigner: false, isWritable: false });
  }

  // Rust expects: pyth_feed(32) + switchboard_feed(32) + max_staleness_slots(u16) + confidence_threshold_bps(u16) + discount_bps(u16) = 70 bytes
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_CREATE_ALLOWED_TOKEN,
    createAllowedTokenArgs.encode({
      pythFeed: params.pythFeed ? feedIdBytes(params.pythFeed) : ZERO_PUBKEY_BYTES,
      switchboardFeed: params.switchboardFeed ? addressBytes(params.switchboardFeed) : ZERO_PUBKEY_BYTES,
      maxStalenessSlots: params.maxStalenessSlots,
      confidenceThresholdBps: params.confidenceThresholdBps,
      discountBps: params.discountBps,
    })
  );

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
  /** New Pyth feed id — 32-byte feed id as 64 hex chars (NOT an account). */
  pythFeed?: string;
  /** New Switchboard pull-feed account address. */
  switchboardFeed?: Address;
  /** New max price age — seconds for Pyth, slots for Switchboard. */
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
export async function createUpdateAllowedTokenInstruction(
  accounts: UpdateAllowedTokenAccounts,
  params: UpdateAllowedTokenParams = {}
): Promise<Instruction[]> {
  const [allowedToken] = await deriveAllowedTokenPda(accounts.gameEngine, accounts.tokenMint);

  // Rust order: authority(signer), game_engine, allowed_token, token_mint
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: allowedToken, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenMint, isSigner: false, isWritable: false },
  ];

  const instructions: Instruction[] = [];

  // Field enum: PythFeed=0, SwitchboardFeed=1, MaxStalenessSlots=2, ConfidenceThresholdBps=3, DiscountBps=4
  // A Pyth feed update carries only the 32-byte feed id (no account). A
  // Switchboard feed update appends the feed account in slot 4 so the
  // program can validate owner + layout at DAO config time.
  if (params.pythFeed) {
    const payload = concatBytes([u8.codec.encode(0), feedIdBytes(params.pythFeed)]);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      keys,
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, payload),
    ));
  }
  if (params.switchboardFeed) {
    const payload = concatBytes([u8.codec.encode(1), addressBytes(params.switchboardFeed)]);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      [...keys, { pubkey: params.switchboardFeed, isSigner: false, isWritable: false }],
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, payload),
    ));
  }
  if (params.maxStalenessSlots !== undefined) {
    const payload = concatBytes([u8.codec.encode(2), u16.codec.encode(params.maxStalenessSlots)]);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      keys,
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, payload),
    ));
  }
  if (params.confidenceThresholdBps !== undefined) {
    const payload = concatBytes([u8.codec.encode(3), u16.codec.encode(params.confidenceThresholdBps)]);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      keys,
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, payload),
    ));
  }
  if (params.discountBps !== undefined) {
    const payload = concatBytes([u8.codec.encode(4), u16.codec.encode(params.discountBps)]);
    instructions.push(buildInstruction(
      PROGRAM_ID,
      keys,
      createInstructionData(DISCRIMINATORS.SHOP_UPDATE_ALLOWED_TOKEN, payload),
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
export async function createCloseAllowedTokenInstruction(
  accounts: CloseAllowedTokenAccounts
): Promise<Instruction> {
    const [allowedToken] = await deriveAllowedTokenPda(accounts.gameEngine, accounts.tokenMint);

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
  maxLamports: bigint | number;
  /** Optional oracle accounts for price discovery with 15% undercut */
  oracleAccounts?: PurchaseNoviOracleAccounts;
}

/** PurchaseNovi args (9 bytes): package_index (u8) + max_lamports (u64) */
const purchaseNoviArgs = packed<{ packageIndex: number; maxLamports: bigint }>([
  ['packageIndex', u8],
  ['maxLamports', u64],
], 9);

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
export async function createPurchaseNoviInstruction(
  accounts: PurchaseNoviAccounts,
  params: PurchaseNoviParams
): Promise<Instruction> {
    const [user] = await deriveUserPda(accounts.buyer);
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.buyer);

  // Reserved token account is owned by UserAccount PDA
  const reservedTokenAccount = await getAssociatedTokenAddressSyncForPda(accounts.noviMint, user);

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
  const data = createInstructionData(
    DISCRIMINATORS.SHOP_PURCHASE_NOVI,
    purchaseNoviArgs.encode({
      packageIndex: params.packageIndex,
      maxLamports: BigInt(params.maxLamports),
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

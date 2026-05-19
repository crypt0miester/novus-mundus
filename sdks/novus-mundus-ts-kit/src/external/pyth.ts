/**
 * Pyth Network pull-oracle helpers.
 *
 * Mirrors the on-chain `p-pyth` reader: parses the modern `PriceUpdateV2`
 * account (Anchor / Borsh-serialized), NOT the deprecated legacy push-oracle
 * price account (magic `0xa1b2c3d4`), which Pyth sunset on 2024-06-30.
 *
 * A Pyth feed is identified by a 32-byte **feed id** (`FeedId`), not by an
 * account address — the on-chain program pins feeds by id and verifies it
 * against the `PriceUpdateV2`'s embedded `price_message.feed_id`.
 */

import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import type { SolanaRpc } from '../rpc';
import { fetchAccount } from '../rpc';

// Program IDs

/** Pyth price-feed program — owns sponsored, continuously-updated feeds. */
export const PYTH_PRICE_FEED_PROGRAM_ID = address(
  'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT'
);

/** Pyth Solana Receiver — owns caller-posted ephemeral price updates. */
export const PYTH_RECEIVER_PROGRAM_ID = address(
  'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ'
);

// Well-Known Price Feed IDs (32-byte hex identifiers; chain-agnostic)
//
// These are Pyth *feed ids*, NOT Solana account addresses. They are what the
// on-chain program stores in its `*_pyth_feed` config fields.

/** SOL/USD feed id */
export const PYTH_SOL_USD_FEED_ID =
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

/** USDC/USD feed id */
export const PYTH_USDC_USD_FEED_ID =
  'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a';

/** USDT/USD feed id */
export const PYTH_USDT_USD_FEED_ID =
  '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b';

/** BTC/USD feed id */
export const PYTH_BTC_USD_FEED_ID =
  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';

/** ETH/USD feed id */
export const PYTH_ETH_USD_FEED_ID =
  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

/** `PriceUpdateV2` Anchor account discriminator. */
const PRICE_UPDATE_V2_DISCRIMINATOR = Uint8Array.from([
  34, 241, 35, 99, 157, 126, 244, 205,
]);

// Types

/** Pyth `VerificationLevel`. */
export type PythVerificationLevel =
  | { kind: 'partial'; numSignatures: number }
  | { kind: 'full' };

/** Parsed `PriceUpdateV2` account. */
export interface PythPriceUpdate {
  /** Authority that posted/owns the update account. */
  writeAuthority: Uint8Array;
  /** How thoroughly the underlying Wormhole VAA was verified. */
  verificationLevel: PythVerificationLevel;
  /** 32-byte feed id. */
  feedId: Uint8Array;
  /** Price value (real value = `price * 10^exponent`). */
  price: bigint;
  /** Confidence interval, same scale as `price`. */
  conf: bigint;
  /** Price exponent (typically negative). */
  exponent: number;
  /** Publish timestamp (Unix seconds). */
  publishTime: number;
  /** Previous publish timestamp (Unix seconds). */
  prevPublishTime: number;
  /** EMA price. */
  emaPrice: bigint;
  /** EMA confidence. */
  emaConf: bigint;
  /** Slot at which the update was posted. */
  postedSlot: bigint;
}

// Feed id helpers

/** Convert a 64-hex-char (optionally `0x`-prefixed) feed id to 32 bytes. */
export function feedIdToBytes(feedId: string): Uint8Array {
  const hex = feedId.startsWith('0x') ? feedId.slice(2) : feedId;
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid Pyth feed id (expected 64 hex chars): ${feedId}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Convert a 32-byte feed id to a 64-hex-char string. */
export function feedIdToHex(feedId: Uint8Array): string {
  return Array.from(feedId, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Parsing

/**
 * Parse a `PriceUpdateV2` account.
 *
 * The account is Borsh-serialized: `verification_level` is a variable-length
 * enum (`Full` = 1 byte, `Partial` = 2 bytes) that shifts every field after it.
 *
 * @param data - Raw account data (including the 8-byte discriminator)
 * @returns Parsed update, or `null` if the data is not a `PriceUpdateV2`
 */
export function parsePythPriceUpdate(data: Uint8Array): PythPriceUpdate | null {
  // discriminator(8) + write_authority(32) + verification_level tag(1)
  if (data.length < 41) return null;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PRICE_UPDATE_V2_DISCRIMINATOR[i]) return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const writeAuthority = data.slice(8, 40);

  // Borsh enum: 1-byte variant tag (+ payload). 0 = Partial, 1 = Full.
  let verificationLevel: PythVerificationLevel;
  let pmOff: number;
  if (data[40] === 0) {
    if (data.length < 42) return null;
    verificationLevel = { kind: 'partial', numSignatures: data[41]! };
    pmOff = 42;
  } else if (data[40] === 1) {
    verificationLevel = { kind: 'full' };
    pmOff = 41;
  } else {
    return null;
  }

  // price_message(84) + posted_slot(8)
  if (data.length < pmOff + 84 + 8) return null;

  return {
    writeAuthority,
    verificationLevel,
    feedId: data.slice(pmOff, pmOff + 32),
    price: view.getBigInt64(pmOff + 32, true),
    conf: view.getBigUint64(pmOff + 40, true),
    exponent: view.getInt32(pmOff + 48, true),
    publishTime: Number(view.getBigInt64(pmOff + 52, true)),
    prevPublishTime: Number(view.getBigInt64(pmOff + 60, true)),
    emaPrice: view.getBigInt64(pmOff + 68, true),
    emaConf: view.getBigUint64(pmOff + 76, true),
    postedSlot: view.getBigUint64(pmOff + 84, true),
  };
}

// Conversions

/** Convert a Pyth price to a human-readable decimal number. */
export function pythPriceToDecimal(price: bigint, exponent: number): number {
  return Number(price) * Math.pow(10, exponent);
}

/** Convert a decimal price to Pyth integer form at `exponent`. */
export function decimalToPythPrice(decimalPrice: number, exponent = -8): bigint {
  return BigInt(Math.round(decimalPrice * Math.pow(10, -exponent)));
}

// Validation (mirrors `PriceUpdateV2::get_price_no_older_than`)

/** Whether the update is fully verified (the safe default to require). */
export function isFullyVerified(update: PythPriceUpdate): boolean {
  return update.verificationLevel.kind === 'full';
}

/** Whether `publishTime` is older than `maxStalenessSeconds`. */
export function isPriceStale(
  update: PythPriceUpdate,
  currentTimestamp: number,
  maxStalenessSeconds = 60
): boolean {
  return currentTimestamp - update.publishTime > maxStalenessSeconds;
}

/** Whether the confidence interval is within `maxConfidenceBps` of the price. */
export function isConfidenceAcceptable(
  update: PythPriceUpdate,
  maxConfidenceBps = 100
): boolean {
  if (maxConfidenceBps === 0) return true;
  if (update.price === 0n) return false;
  const priceAbs = update.price < 0n ? -update.price : update.price;
  const confBps = (update.conf * 10000n) / priceAbs;
  return confBps <= BigInt(maxConfidenceBps);
}

/**
 * Validate a Pyth price update for use in a transaction.
 *
 * Mirrors the on-chain checks: full verification, feed-id match, staleness,
 * confidence, positive price.
 */
export function validatePythPriceUpdate(
  update: PythPriceUpdate,
  expectedFeedId: Uint8Array,
  currentTimestamp: number,
  maxStalenessSeconds = 60,
  maxConfidenceBps = 100
): { valid: boolean; error?: string } {
  if (!isFullyVerified(update)) {
    return { valid: false, error: 'Price update is not fully verified' };
  }
  if (feedIdToHex(update.feedId) !== feedIdToHex(expectedFeedId)) {
    return { valid: false, error: 'Price update feed id mismatch' };
  }
  if (isPriceStale(update, currentTimestamp, maxStalenessSeconds)) {
    return { valid: false, error: 'Price is stale' };
  }
  if (!isConfidenceAcceptable(update, maxConfidenceBps)) {
    return { valid: false, error: 'Price confidence too wide' };
  }
  if (update.price <= 0n) {
    return { valid: false, error: 'Invalid price value' };
  }
  return { valid: true };
}

// Fetch

/**
 * Fetch and parse a Pyth `PriceUpdateV2` account.
 *
 * @param rpc - Solana RPC client
 * @param priceAccount - The price-update / sponsored-feed account address
 */
export async function fetchPythPriceUpdate(
  rpc: SolanaRpc,
  priceAccount: Address
): Promise<PythPriceUpdate | null> {
  const accountInfo = await fetchAccount(rpc, priceAccount);
  if (!accountInfo || !accountInfo.data) return null;
  return parsePythPriceUpdate(accountInfo.data);
}

/** Fetch the USD price for a Pyth price account. */
export async function fetchUsdPrice(
  rpc: SolanaRpc,
  priceAccount: Address
): Promise<number | null> {
  const update = await fetchPythPriceUpdate(rpc, priceAccount);
  if (!update) return null;
  return pythPriceToDecimal(update.price, update.exponent);
}

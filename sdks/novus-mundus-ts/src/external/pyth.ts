/**
 * Pyth Network Price Feed Helpers
 *
 * Utilities for working with Pyth price oracles on Solana.
 */

import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';

// ============================================================
// Program IDs
// ============================================================

/** Pyth Oracle Program ID (Mainnet) */
export const PYTH_ORACLE_PROGRAM_ID = new PublicKey(
  'FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH'
);

/** Pyth Oracle Program ID (Devnet) */
export const PYTH_ORACLE_PROGRAM_ID_DEVNET = new PublicKey(
  'gSbePebfvPy7tRqimPoVecS2UsBvYv46ynrzWocc92s'
);

// ============================================================
// Well-Known Price Feed IDs (Mainnet)
// ============================================================

/** SOL/USD price feed */
export const PYTH_SOL_USD_FEED = new PublicKey(
  'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'
);

/** USDC/USD price feed */
export const PYTH_USDC_USD_FEED = new PublicKey(
  'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD'
);

/** USDT/USD price feed */
export const PYTH_USDT_USD_FEED = new PublicKey(
  '3vxLXJqLqF3JG5TCbYycbKWRBbCJQLxQmBGCkyqEEefL'
);

/** BTC/USD price feed */
export const PYTH_BTC_USD_FEED = new PublicKey(
  'GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU'
);

/** ETH/USD price feed */
export const PYTH_ETH_USD_FEED = new PublicKey(
  'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB'
);

// ============================================================
// Price Data Types
// ============================================================

/** Pyth price data structure */
export interface PythPrice {
  /** Price value (scaled by 10^expo) */
  price: bigint;
  /** Confidence interval (scaled by 10^expo) */
  conf: bigint;
  /** Price exponent (negative means decimal places) */
  expo: number;
  /** Publish timestamp (Unix seconds) */
  publishTime: number;
}

/** Extended price data with EMA */
export interface PythPriceData extends PythPrice {
  /** EMA price */
  emaPrice: bigint;
  /** EMA confidence */
  emaConf: bigint;
  /** Status (0=unknown, 1=trading, 2=halted, 3=auction) */
  status: number;
  /** Number of publishers */
  numPublishers: number;
  /** Max number of publishers */
  maxNumPublishers: number;
}

// ============================================================
// Price Parsing Functions
// ============================================================

/**
 * Parse Pyth price account data.
 *
 * @param data - Raw account data buffer
 * @returns Parsed price data or null if invalid
 */
export function parsePythPriceData(data: Buffer): PythPriceData | null {
  if (data.length < 208) {
    return null;
  }

  // Pyth V2 price account layout:
  // 0-4: magic number (0xa1b2c3d4)
  // 4-8: version
  // 8-12: type (1 = price)
  // 12-16: size
  // ...
  // 208+: price data

  const magic = data.readUInt32LE(0);
  if (magic !== 0xa1b2c3d4) {
    return null;
  }

  const accountType = data.readUInt32LE(8);
  if (accountType !== 3) {
    // 3 = price account
    return null;
  }

  // Price data offset varies by version, use standard offsets for V2
  const priceOffset = 208;
  if (data.length < priceOffset + 96) {
    return null;
  }

  // Read current price data
  const expo = data.readInt32LE(priceOffset + 20);
  const status = data.readUInt32LE(priceOffset + 12);
  const numPublishers = data.readUInt32LE(priceOffset + 16);
  const maxNumPublishers = data.readUInt32LE(priceOffset + 28);

  // Price and confidence at offset + 32
  const price = data.readBigInt64LE(priceOffset + 32);
  const conf = data.readBigUInt64LE(priceOffset + 40);

  // EMA price and confidence at offset + 72
  const emaPrice = data.readBigInt64LE(priceOffset + 72);
  const emaConf = data.readBigUInt64LE(priceOffset + 80);

  // Publish time at offset + 48
  const publishTime = Number(data.readBigInt64LE(priceOffset + 48));

  return {
    price,
    conf,
    expo,
    publishTime,
    emaPrice,
    emaConf,
    status,
    numPublishers,
    maxNumPublishers,
  };
}

/**
 * Convert Pyth price to human-readable decimal.
 *
 * @param price - Price value from Pyth
 * @param expo - Price exponent from Pyth
 * @returns Price as a decimal number
 */
export function pythPriceToDecimal(price: bigint, expo: number): number {
  return Number(price) * Math.pow(10, expo);
}

/**
 * Convert decimal price to Pyth format.
 *
 * @param decimalPrice - Human-readable price
 * @param expo - Target exponent (typically -8 for USD prices)
 * @returns Price value for Pyth
 */
export function decimalToPythPrice(decimalPrice: number, expo: number = -8): bigint {
  return BigInt(Math.round(decimalPrice * Math.pow(10, -expo)));
}

// ============================================================
// Price Validation Functions
// ============================================================

/**
 * Check if a price is stale based on slot age.
 *
 * @param priceData - Pyth price data
 * @param currentSlot - Current Solana slot
 * @param maxStalenessSlots - Maximum allowed age in slots
 * @returns true if price is stale
 */
export function isPriceStale(
  priceData: PythPriceData,
  currentTimestamp: number,
  maxStalenessSeconds: number = 60
): boolean {
  return currentTimestamp - priceData.publishTime > maxStalenessSeconds;
}

/**
 * Check if price confidence is within acceptable threshold.
 *
 * @param priceData - Pyth price data
 * @param maxConfidenceBps - Maximum confidence as basis points of price
 * @returns true if confidence is acceptable
 */
export function isConfidenceAcceptable(
  priceData: PythPriceData,
  maxConfidenceBps: number = 100 // 1% default
): boolean {
  if (priceData.price === 0n) return false;

  // Calculate confidence as percentage of price
  const confidenceBps = Number((priceData.conf * 10000n) / BigInt(Math.abs(Number(priceData.price))));

  return confidenceBps <= maxConfidenceBps;
}

/**
 * Validate a Pyth price for use in transactions.
 *
 * @param priceData - Pyth price data
 * @param currentTimestamp - Current Unix timestamp
 * @param maxStalenessSeconds - Maximum age in seconds
 * @param maxConfidenceBps - Maximum confidence in basis points
 * @returns Validation result with error message if invalid
 */
export function validatePythPrice(
  priceData: PythPriceData,
  currentTimestamp: number,
  maxStalenessSeconds: number = 60,
  maxConfidenceBps: number = 100
): { valid: boolean; error?: string } {
  if (priceData.status !== 1) {
    return { valid: false, error: 'Price feed not trading' };
  }

  if (isPriceStale(priceData, currentTimestamp, maxStalenessSeconds)) {
    return { valid: false, error: 'Price is stale' };
  }

  if (!isConfidenceAcceptable(priceData, maxConfidenceBps)) {
    return { valid: false, error: 'Price confidence too wide' };
  }

  if (priceData.price <= 0n) {
    return { valid: false, error: 'Invalid price value' };
  }

  return { valid: true };
}

// ============================================================
// Fetch Functions
// ============================================================

/**
 * Fetch and parse Pyth price data from the network.
 *
 * @param connection - Solana connection
 * @param feedAddress - Pyth price feed address
 * @returns Parsed price data or null if unavailable
 */
export async function fetchPythPrice(
  connection: Connection,
  feedAddress: PublicKey
): Promise<PythPriceData | null> {
  const accountInfo = await connection.getAccountInfo(feedAddress);

  if (!accountInfo || !accountInfo.data) {
    return null;
  }

  return parsePythPriceData(Buffer.from(accountInfo.data));
}

/**
 * Fetch USD price for a token using Pyth.
 *
 * @param connection - Solana connection
 * @param feedAddress - Pyth price feed address
 * @returns Price in USD or null if unavailable
 */
export async function fetchUsdPrice(
  connection: Connection,
  feedAddress: PublicKey
): Promise<number | null> {
  const priceData = await fetchPythPrice(connection, feedAddress);

  if (!priceData) {
    return null;
  }

  return pythPriceToDecimal(priceData.price, priceData.expo);
}

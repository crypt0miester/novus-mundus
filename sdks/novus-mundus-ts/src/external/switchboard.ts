/**
 * Switchboard Oracle Helpers
 *
 * Utilities for working with Switchboard price oracles on Solana.
 */

import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';

// ============================================================
// Program IDs
// ============================================================

/** Switchboard V2 Program ID (Mainnet) */
export const SWITCHBOARD_V2_PROGRAM_ID = new PublicKey(
  'SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f'
);

/** Switchboard V2 Program ID (Devnet) */
export const SWITCHBOARD_V2_PROGRAM_ID_DEVNET = new PublicKey(
  '2TfB33aLaneQb5TNVwyDz3jSZXS6jdW2ARw1Dgf84XCG'
);

/** Switchboard On-Demand Program ID (Mainnet) */
export const SWITCHBOARD_ON_DEMAND_PROGRAM_ID = new PublicKey(
  'SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv'
);

// ============================================================
// Aggregator Data Types
// ============================================================

/** Switchboard aggregator result */
export interface SwitchboardAggregatorResult {
  /** Median value from oracles */
  value: number;
  /** Standard deviation */
  stdDev: number;
  /** Mean value */
  mean: number;
  /** Number of oracle responses */
  numSuccess: number;
  /** Number of oracle errors */
  numError: number;
  /** Last updated timestamp (Unix seconds) */
  timestamp: number;
  /** Last updated slot */
  slot: number;
}

/** Switchboard aggregator configuration */
export interface SwitchboardAggregatorConfig {
  /** Minimum number of oracle responses required */
  minOracleResults: number;
  /** Minimum update delay in seconds */
  minUpdateDelaySeconds: number;
  /** Variance threshold for acceptable results */
  varianceThreshold: number;
}

// ============================================================
// Aggregator Parsing Functions
// ============================================================

/**
 * Parse Switchboard aggregator account data (V2).
 *
 * @param data - Raw account data buffer
 * @returns Parsed aggregator result or null if invalid
 */
export function parseSwitchboardAggregator(data: Buffer): SwitchboardAggregatorResult | null {
  if (data.length < 2104) {
    return null;
  }

  // Switchboard V2 Aggregator layout:
  // Discriminator: 8 bytes
  // Various config fields...
  // Latest confirmed result at offset 584

  // Check discriminator (varies by account type)
  // For aggregator accounts, we check the data length and structure

  // Latest confirmed round result offset
  const resultOffset = 584;

  if (data.length < resultOffset + 96) {
    return null;
  }

  // Parse SwitchboardDecimal at result offset
  // SwitchboardDecimal: mantissa (i128, 16 bytes) + scale (u32, 4 bytes)
  const mantissa = data.readBigInt64LE(resultOffset);
  const scale = data.readUInt32LE(resultOffset + 16);

  // Convert to decimal
  const value = Number(mantissa) * Math.pow(10, -scale);

  // Standard deviation at offset + 20
  const stdDevMantissa = data.readBigInt64LE(resultOffset + 20);
  const stdDevScale = data.readUInt32LE(resultOffset + 36);
  const stdDev = Number(stdDevMantissa) * Math.pow(10, -stdDevScale);

  // Mean at offset + 40
  const meanMantissa = data.readBigInt64LE(resultOffset + 40);
  const meanScale = data.readUInt32LE(resultOffset + 56);
  const mean = Number(meanMantissa) * Math.pow(10, -meanScale);

  // Success/error counts at offset + 60
  const numSuccess = data.readUInt32LE(resultOffset + 60);
  const numError = data.readUInt32LE(resultOffset + 64);

  // Timestamp at offset + 72
  const timestamp = Number(data.readBigInt64LE(resultOffset + 72));

  // Slot at offset + 80
  const slot = Number(data.readBigUInt64LE(resultOffset + 80));

  return {
    value,
    stdDev,
    mean,
    numSuccess,
    numError,
    timestamp,
    slot,
  };
}

/**
 * Parse Switchboard On-Demand feed data.
 *
 * @param data - Raw account data buffer
 * @returns Parsed result or null if invalid
 */
export function parseSwitchboardOnDemand(data: Buffer): SwitchboardAggregatorResult | null {
  // Switchboard On-Demand has a different layout
  // This is a simplified parser for the common fields

  if (data.length < 200) {
    return null;
  }

  // On-Demand feed layout (simplified):
  // Discriminator: 8 bytes
  // Gateway: 32 bytes (offset 8)
  // Queue: 32 bytes (offset 40)
  // Feed hash: 32 bytes (offset 72)
  // Result: at offset 104

  const resultOffset = 104;

  if (data.length < resultOffset + 48) {
    return null;
  }

  // Value (i128 as two i64s)
  const valueLow = data.readBigInt64LE(resultOffset);
  const value = Number(valueLow) / 1e9; // Typically stored with 9 decimals

  // Standard deviation
  const stdDevLow = data.readBigInt64LE(resultOffset + 16);
  const stdDev = Number(stdDevLow) / 1e9;

  // Timestamp
  const timestamp = Number(data.readBigInt64LE(resultOffset + 32));

  // Slot
  const slot = Number(data.readBigUInt64LE(resultOffset + 40));

  return {
    value,
    stdDev,
    mean: value, // On-Demand doesn't separate mean
    numSuccess: 1, // Single result
    numError: 0,
    timestamp,
    slot,
  };
}

// ============================================================
// Price Validation Functions
// ============================================================

/**
 * Check if Switchboard result is stale.
 *
 * @param result - Switchboard aggregator result
 * @param currentSlot - Current Solana slot
 * @param maxStalenessSlots - Maximum allowed age in slots
 * @returns true if result is stale
 */
export function isSwitchboardStale(
  result: SwitchboardAggregatorResult,
  currentTimestamp: number,
  maxStalenessSeconds: number = 60
): boolean {
  return currentTimestamp - result.timestamp > maxStalenessSeconds;
}

/**
 * Check if Switchboard result has sufficient oracle responses.
 *
 * @param result - Switchboard aggregator result
 * @param minResponses - Minimum required responses
 * @returns true if sufficient responses
 */
export function hasSufficientResponses(
  result: SwitchboardAggregatorResult,
  minResponses: number = 3
): boolean {
  return result.numSuccess >= minResponses;
}

/**
 * Check if Switchboard result variance is acceptable.
 *
 * @param result - Switchboard aggregator result
 * @param maxVarianceBps - Maximum variance as basis points of value
 * @returns true if variance is acceptable
 */
export function isVarianceAcceptable(
  result: SwitchboardAggregatorResult,
  maxVarianceBps: number = 100 // 1% default
): boolean {
  if (result.value === 0) return false;

  const varianceBps = (result.stdDev / Math.abs(result.value)) * 10000;
  return varianceBps <= maxVarianceBps;
}

/**
 * Validate Switchboard result for use in transactions.
 *
 * @param result - Switchboard aggregator result
 * @param currentTimestamp - Current Unix timestamp
 * @param maxStalenessSeconds - Maximum age in seconds
 * @param minResponses - Minimum oracle responses
 * @param maxVarianceBps - Maximum variance in basis points
 * @returns Validation result with error message if invalid
 */
export function validateSwitchboardResult(
  result: SwitchboardAggregatorResult,
  currentTimestamp: number,
  maxStalenessSeconds: number = 60,
  minResponses: number = 3,
  maxVarianceBps: number = 100
): { valid: boolean; error?: string } {
  if (isSwitchboardStale(result, currentTimestamp, maxStalenessSeconds)) {
    return { valid: false, error: 'Oracle result is stale' };
  }

  if (!hasSufficientResponses(result, minResponses)) {
    return { valid: false, error: 'Insufficient oracle responses' };
  }

  if (!isVarianceAcceptable(result, maxVarianceBps)) {
    return { valid: false, error: 'Oracle variance too high' };
  }

  if (result.value <= 0) {
    return { valid: false, error: 'Invalid price value' };
  }

  return { valid: true };
}

// ============================================================
// Fetch Functions
// ============================================================

/**
 * Fetch and parse Switchboard aggregator data from the network.
 *
 * @param connection - Solana connection
 * @param aggregatorAddress - Switchboard aggregator address
 * @param isOnDemand - Whether this is an On-Demand feed
 * @returns Parsed result or null if unavailable
 */
export async function fetchSwitchboardResult(
  connection: Connection,
  aggregatorAddress: PublicKey,
  isOnDemand: boolean = false
): Promise<SwitchboardAggregatorResult | null> {
  const accountInfo = await connection.getAccountInfo(aggregatorAddress);

  if (!accountInfo || !accountInfo.data) {
    return null;
  }

  const buffer = Buffer.from(accountInfo.data);

  return isOnDemand
    ? parseSwitchboardOnDemand(buffer)
    : parseSwitchboardAggregator(buffer);
}

/**
 * Fetch USD price from Switchboard feed.
 *
 * @param connection - Solana connection
 * @param aggregatorAddress - Switchboard aggregator address
 * @param isOnDemand - Whether this is an On-Demand feed
 * @returns Price in USD or null if unavailable
 */
export async function fetchSwitchboardPrice(
  connection: Connection,
  aggregatorAddress: PublicKey,
  isOnDemand: boolean = false
): Promise<number | null> {
  const result = await fetchSwitchboardResult(connection, aggregatorAddress, isOnDemand);

  return result?.value ?? null;
}

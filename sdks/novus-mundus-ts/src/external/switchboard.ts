/**
 * Switchboard On-Demand oracle helpers.
 *
 * Mirrors the on-chain `p-switchboard` reader: parses a `PullFeedAccountData`
 * account and resolves a price via the `get_value` algorithm (median over the
 * fresh oracle submissions, with a minimum-samples requirement).
 *
 * Values are `i128` fixed-point scaled by `10^18` (`PRECISION = 18`).
 */

import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';

// Program IDs

/** Switchboard On-Demand program (mainnet). */
export const SWITCHBOARD_ON_DEMAND_PROGRAM_ID = new PublicKey(
  'SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv'
);

/** Switchboard On-Demand program (devnet). */
export const SWITCHBOARD_ON_DEMAND_PROGRAM_ID_DEVNET = new PublicKey(
  'Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2'
);

/** Switchboard On-Demand fixed-point precision (values scaled by 10^18). */
export const SWITCHBOARD_PRECISION = 18;

/** `PullFeedAccountData` Anchor discriminator. */
const PULL_FEED_DISCRIMINATOR = Buffer.from([
  196, 27, 108, 196, 10, 215, 219, 40,
]);

// Layout offsets (into account data, including the 8-byte discriminator),
// derived from `PullFeedAccountData` in switchboard-on-demand v0.11.3.
const OFF_SUBMISSIONS = 8;
const NUM_SUBMISSIONS = 32;
const SUBMISSION_SIZE = 64;
const SUB_OFF_SLOT = 32;
const SUB_OFF_VALUE = 48;
const OFF_MIN_RESPONSES = 2176;
const OFF_MIN_SAMPLE_SIZE = 2215;
const OFF_LAST_UPDATE_TS = 2216;
const OFF_RESULT_VALUE = 2264;
const OFF_RESULT_STD_DEV = 2280;
const OFF_RESULT_NUM_SAMPLES = 2360;
const OFF_RESULT_SLOT = 2368;
const OFF_MAX_STALENESS = 2392;
const MIN_PULL_FEED_LEN = 3208;

// Types

/** One oracle submission from the feed's ring buffer. */
export interface SwitchboardSubmission {
  /** Slot at which the value was signed (`0` => empty/uninitialised). */
  slot: bigint;
  /** Submitted value (`i128`, scaled by 10^18). */
  value: bigint;
}

/** Parsed `PullFeedAccountData` (the fields needed to resolve a price). */
export interface SwitchboardFeed {
  /** Non-empty oracle submissions, in ring-buffer order. */
  submissions: SwitchboardSubmission[];
  /** `CurrentResult.value` — on-chain aggregated median (`i128`, 10^18). */
  resultValue: bigint;
  /** `CurrentResult.std_dev` — std deviation of the aggregated result. */
  resultStdDev: bigint;
  /** `CurrentResult.slot` — slot the aggregated result was signed at. */
  resultSlot: bigint;
  /** `CurrentResult.num_samples` — submissions behind the aggregated result. */
  resultNumSamples: number;
  /** Feed's configured minimum sample size. */
  minSampleSize: number;
  /** Feed's configured minimum oracle responses. */
  minResponses: number;
  /** Feed's own staleness bound, in slots. */
  maxStaleness: number;
  /** Unix timestamp of the last feed update. */
  lastUpdateTimestamp: number;
}

// i128 reader

/** Read a little-endian signed 128-bit integer from a Buffer. */
function readI128(data: Buffer, offset: number): bigint {
  const low = data.readBigUInt64LE(offset);
  const high = data.readBigInt64LE(offset + 8);
  return (high << 64n) | low;
}

// Parsing

/**
 * Parse a Switchboard `PullFeedAccountData` account.
 *
 * @param data - Raw account data (including the 8-byte discriminator)
 * @returns Parsed feed, or `null` if the data is not a pull feed
 */
export function parseSwitchboardFeed(data: Buffer): SwitchboardFeed | null {
  if (data.length < MIN_PULL_FEED_LEN) return null;
  if (!data.subarray(0, 8).equals(PULL_FEED_DISCRIMINATOR)) return null;

  // submissions: take_while(slot != 0)
  const submissions: SwitchboardSubmission[] = [];
  for (let i = 0; i < NUM_SUBMISSIONS; i++) {
    const base = OFF_SUBMISSIONS + i * SUBMISSION_SIZE;
    const slot = data.readBigUInt64LE(base + SUB_OFF_SLOT);
    if (slot === 0n) break;
    submissions.push({ slot, value: readI128(data, base + SUB_OFF_VALUE) });
  }

  return {
    submissions,
    resultValue: readI128(data, OFF_RESULT_VALUE),
    resultStdDev: readI128(data, OFF_RESULT_STD_DEV),
    resultSlot: data.readBigUInt64LE(OFF_RESULT_SLOT),
    resultNumSamples: data[OFF_RESULT_NUM_SAMPLES]!,
    minSampleSize: data[OFF_MIN_SAMPLE_SIZE]!,
    minResponses: data.readUInt32LE(OFF_MIN_RESPONSES),
    maxStaleness: data.readUInt32LE(OFF_MAX_STALENESS),
    lastUpdateTimestamp: Number(data.readBigInt64LE(OFF_LAST_UPDATE_TS)),
  };
}

// Price resolution (mirrors `PullFeedAccountData::get_value`)

export interface SwitchboardValueOptions {
  /** Current Solana slot. */
  clockSlot: bigint;
  /** Maximum submission age, in slots. */
  maxStaleness: bigint;
  /** Minimum number of fresh submissions required. */
  minSamples: number;
  /** Reject a non-positive median. Defaults to `true`. */
  onlyPositive?: boolean;
}

/**
 * Resolve the feed value: the lower-bound median of the oracle submissions
 * made within the last `maxStaleness` slots.
 *
 * Faithful port of `PullFeedAccountData::get_value`.
 *
 * @returns the median (`i128`, scaled by 10^18), or `null` on failure
 *   (too few fresh samples, or a non-positive median when `onlyPositive`).
 */
export function getSwitchboardValue(
  feed: SwitchboardFeed,
  opts: SwitchboardValueOptions
): bigint | null {
  const onlyPositive = opts.onlyPositive ?? true;
  const minValidSlot =
    opts.clockSlot > opts.maxStaleness ? opts.clockSlot - opts.maxStaleness : 0n;

  const fresh = feed.submissions
    .filter((s) => s.slot >= minValidSlot)
    .map((s) => s.value);

  if (fresh.length === 0 || fresh.length < opts.minSamples) return null;

  // lower_bound_median: sort ascending, take element at len / 2.
  fresh.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const median = fresh[Math.floor(fresh.length / 2)]!;

  if (onlyPositive && median <= 0n) return null;
  return median;
}

/** Convert a 10^18-scaled `i128` value to a human-readable decimal. */
export function switchboardValueToDecimal(value: bigint): number {
  return Number(value) / Math.pow(10, SWITCHBOARD_PRECISION);
}

// Validation

/** Whether the std deviation is within `maxStdDevBps` of `resultValue`. */
export function isVarianceAcceptable(
  feed: SwitchboardFeed,
  maxStdDevBps = 100
): boolean {
  if (maxStdDevBps === 0) return true;
  if (feed.resultValue <= 0n) return false;
  const stdDevAbs =
    feed.resultStdDev < 0n ? -feed.resultStdDev : feed.resultStdDev;
  const bps = (stdDevAbs * 10000n) / feed.resultValue;
  return bps <= BigInt(maxStdDevBps);
}

/**
 * Validate a Switchboard feed for use in a transaction.
 *
 * Mirrors the on-chain checks: enough fresh samples via `get_value`
 * (`minSamples` defaults to the feed's own `minSampleSize`, floored to 1),
 * a positive value, and the variance gate.
 */
export function validateSwitchboardFeed(
  feed: SwitchboardFeed,
  clockSlot: bigint,
  maxStalenessSlots: bigint,
  maxStdDevBps = 100,
  minSamples?: number
): { valid: boolean; error?: string; value?: bigint } {
  const samples = minSamples ?? Math.max(feed.minSampleSize, 1);
  const value = getSwitchboardValue(feed, {
    clockSlot,
    maxStaleness: maxStalenessSlots,
    minSamples: samples,
    onlyPositive: true,
  });
  if (value === null) {
    return { valid: false, error: 'Insufficient fresh oracle samples' };
  }
  if (!isVarianceAcceptable(feed, maxStdDevBps)) {
    return { valid: false, error: 'Oracle variance too high' };
  }
  return { valid: true, value };
}

// Fetch

/** Fetch and parse a Switchboard On-Demand `PullFeedAccountData` account. */
export async function fetchSwitchboardFeed(
  connection: Connection,
  feedAddress: PublicKey
): Promise<SwitchboardFeed | null> {
  const accountInfo = await connection.getAccountInfo(feedAddress);
  if (!accountInfo || !accountInfo.data) return null;
  return parseSwitchboardFeed(Buffer.from(accountInfo.data));
}

/**
 * Fetch the USD price from a Switchboard feed.
 *
 * Uses the on-chain aggregated `CurrentResult.value`; for the staleness- and
 * sample-checked path use {@link fetchSwitchboardFeed} + {@link getSwitchboardValue}.
 */
export async function fetchSwitchboardPrice(
  connection: Connection,
  feedAddress: PublicKey
): Promise<number | null> {
  const feed = await fetchSwitchboardFeed(connection, feedAddress);
  if (!feed || feed.resultValue <= 0n) return null;
  return switchboardValueToDecimal(feed.resultValue);
}

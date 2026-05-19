/**
 * LiteSVM Test Environment
 *
 * Creates an in-process SVM instance with all programs and accounts
 * needed for E2E tests. Replaces solana-test-validator.
 */

import { LiteSVM, Clock, FailedTransactionMetadata, type TransactionMetadata } from 'litesvm';
import { address, lamports, getProgramDerivedAddress, type Address } from '@solana/kit';
import { addressBytes } from '../../src/crypto';
import * as path from 'path';
import * as fs from 'fs';

export { LiteSVM, Clock, FailedTransactionMetadata };
export type { TransactionMetadata };

const SDK_DIR = path.join(__dirname, '../..');
const ROOT_DIR = path.join(SDK_DIR, '../..');
const BIN_DIR = path.join(SDK_DIR, 'programs/.bin');
const NOVUS_MUNDUS_SO = path.join(ROOT_DIR, 'target/deploy/novus_mundus.so');

// Program IDs
const NOVUS_MUNDUS_PROGRAM_ID = address('J4DxMg1RfwRzjpZ3N6D1ULNjuwLHuhe6qLNeX9rYNz3V');
const MPL_CORE_PROGRAM_ID = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const TLD_HOUSE_PROGRAM_ID = address('TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S');
const ALT_NAME_SERVICE_PROGRAM_ID = address('ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK');

// TLD accounts (mainnet snapshots)
const TLD_STATE = address('VmmhRjr64KbpTZpgmeiVSWmR8H8RyqgigF1XQf8AvET');
const TLD_HOUSE_SOLANA = address('8Y1BpwTwqwFXpLDiTmjQKm1RNR8pdhB7VFfEayaSddVz');

/**
 * Create a fresh LiteSVM instance with all programs loaded and TLD accounts seeded.
 */
export function createTestSvm(): LiteSVM {
  const svm = new LiteSVM()
    .withTransactionHistory(10000n)
    .withLamports(100_000_000_000_000n); // 100k SOL for airdrops

  // Load program binaries
  const novusSoPath = NOVUS_MUNDUS_SO;
  svm.addProgramFromFile(NOVUS_MUNDUS_PROGRAM_ID, novusSoPath);
  svm.addProgramFromFile(MPL_CORE_PROGRAM_ID, path.join(BIN_DIR, 'mpl_core.so'));
  svm.addProgramFromFile(TLD_HOUSE_PROGRAM_ID, path.join(BIN_DIR, 'tld_house.so'));
  svm.addProgramFromFile(ALT_NAME_SERVICE_PROGRAM_ID, path.join(BIN_DIR, 'alt_name_service.so'));

  // Seed TLD accounts from mainnet snapshots
  const dataDir = path.join(__dirname, 'data');
  loadAccountFromJson(svm, TLD_STATE, path.join(dataDir, 'tld-state.json'));
  loadAccountFromJson(svm, TLD_HOUSE_SOLANA, path.join(dataDir, 'tld-house-solana.json'));

  // Pin the initial clock to a deterministic Midday-at-Americas timestamp.
  const now = BigInt(Math.floor(Date.UTC(2024, 0, 15, 4, 48, 0) / 1000));
  const clock = new Clock(1n, now, 0n, 0n, now);
  svm.setClock(clock);

  return svm;
}

/**
 * Load an account from a `solana account --output json` snapshot file.
 */
function loadAccountFromJson(svm: LiteSVM, addr: Address, jsonPath: string): void {
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const acct = json.account;
  const data = Buffer.from(acct.data[0], 'base64');

  svm.setAccount({
    address: addr,
    data,
    executable: acct.executable,
    lamports: lamports(BigInt(acct.lamports)),
    programAddress: address(acct.owner),
    space: BigInt(data.length),
  });
}

/** BPFLoaderUpgradeab1e11111111111111111111111 — owns `ProgramData` PDAs. */
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = address(
  'BPFLoaderUpgradeab1e11111111111111111111111',
);

/** Pyth on-mainnet program ID — owner of legit Pyth price feed accounts. */
const PYTH_PROGRAM_ID = address('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT');

/** Switchboard on-demand program ID — owner of Switchboard pull feed accounts. */
const SWITCHBOARD_PROGRAM_ID = address('SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv');

export interface MockPythPrice {
  /** Price as a signed integer in units of 10^expo (e.g., 15023 with expo=-2 = $150.23). */
  price: bigint | number;
  /** Confidence interval in the same units as `price`. */
  conf?: bigint | number;
  /** Exponent (negative power of 10). Typical: -8 for USD prices. */
  expo?: number;
  /**
   * Publish time (Unix seconds). The on-chain staleness check is
   * `publish_time + max_staleness >= now`. Defaults to the current LiteSVM
   * clock so a fresh price always passes; override to exercise stale branches.
   */
  publishTime?: bigint | number;
}

/** Anchor account discriminator for Pyth `PriceUpdateV2`. */
const PRICE_UPDATE_V2_DISCRIMINATOR = Buffer.from([
  34, 241, 35, 99, 157, 126, 244, 205,
]);

/**
 * Seed a synthetic Pyth `PriceUpdateV2` pull-oracle account at `pubkey`.
 *
 * The modern pull-oracle model: a feed is identified by a 32-byte `feedId`,
 * and the price lives in a `PriceUpdateV2` account owned by the Pyth program.
 * The on-chain `read_pyth_price` parses it and enforces
 * `VerificationLevel::Full`, that `price_message.feed_id == feedId`, and a
 * `publish_time` no older than `max_staleness` seconds.
 *
 * `feedId` is the 32-byte identifier embedded in the account — it must equal
 * the id stored in the DAO config (`*_pyth_feed`). Pass 32 raw bytes or a
 * 64-hex string.
 *
 * Layout (Borsh, `VerificationLevel::Full`): discriminator(8) +
 * write_authority(32) + verification_level tag(1) + price_message(84) +
 * posted_slot(8) = 133 bytes.
 */
export function seedMockPythFeed(
  svm: LiteSVM,
  pubkey: Address,
  feedId: Buffer | Uint8Array | string,
  price?: MockPythPrice,
): void {
  const feedIdBuf =
    typeof feedId === 'string'
      ? Buffer.from(feedId.replace(/^0x/, ''), 'hex')
      : Buffer.from(feedId);
  if (feedIdBuf.length !== 32) {
    throw new Error(`Pyth feedId must be 32 bytes, got ${feedIdBuf.length}`);
  }

  const data = Buffer.alloc(133);
  PRICE_UPDATE_V2_DISCRIMINATOR.copy(data, 0);
  // write_authority @8 left as zeros.
  data.writeUInt8(1, 40); // verification_level = Full

  const pm = 41; // price_message offset (Full => single-byte verification tag)
  feedIdBuf.copy(data, pm); // feed_id
  data.writeBigInt64LE(BigInt(price?.price ?? 0), pm + 32); // price
  data.writeBigUInt64LE(BigInt(price?.conf ?? 0), pm + 40); // conf
  data.writeInt32LE(price?.expo ?? -8, pm + 48); // exponent
  const publishTime =
    price?.publishTime !== undefined
      ? BigInt(price.publishTime)
      : svm.getClock().unixTimestamp;
  data.writeBigInt64LE(publishTime, pm + 52); // publish_time
  data.writeBigInt64LE(publishTime, pm + 60); // prev_publish_time
  data.writeBigInt64LE(BigInt(price?.price ?? 0), pm + 68); // ema_price
  data.writeBigUInt64LE(BigInt(price?.conf ?? 0), pm + 76); // ema_conf
  data.writeBigUInt64LE(svm.getClock().slot, pm + 84); // posted_slot

  svm.setAccount({
    address: pubkey,
    data,
    executable: false,
    lamports: lamports(1_000_000_000n),
    programAddress: PYTH_PROGRAM_ID,
    space: BigInt(data.length),
  });
}

/** Write a positive i128 in little-endian (low 64 bits then high 64 bits). */
function writeI128LE(buf: Buffer, value: bigint, offset: number): void {
  const mask = (1n << 64n) - 1n;
  buf.writeBigUInt64LE(value & mask, offset);
  buf.writeBigUInt64LE((value >> 64n) & mask, offset + 8);
}

export interface MockSwitchboardPrice {
  /**
   * Median price scaled to 10^18 (Switchboard's fixed precision).
   * E.g. $150 → 150n * 10n ** 18n.
   */
  value: bigint | number;
  /** Standard deviation, same 10^18 scale. Default 0 (always passes the std-dev gate). */
  stdDev?: bigint | number;
  /**
   * Slot of the seeded oracle submissions, for the `get_value` staleness
   * filter (`submission.slot >= clock_slot - max_staleness`). Defaults to the
   * current LiteSVM slot.
   */
  slot?: bigint | number;
}

/**
 * Seed a synthetic Switchboard On-Demand `PullFeedAccountData` account.
 *
 * The on-chain `read_switchboard_price` resolves the price via `get_value`:
 * it walks the `submissions` ring buffer, keeps submissions no older than
 * `max_staleness` slots, requires at least `min_sample_size` of them, and
 * takes the median. We seed three identical fresh submissions so the median
 * is unambiguous, plus the matching `CurrentResult` (its `std_dev` feeds the
 * confidence gate).
 *
 * `validate_switchboard_feed_at_config` only needs the discriminator + the
 * full 3208-byte length, so the price-less form still satisfies config-gate
 * tests. Layout offsets are pinned from `p_switchboard` (`PullFeedAccountData`).
 */
export function seedMockSwitchboardFeed(
  svm: LiteSVM,
  pubkey: Address,
  price?: MockSwitchboardPrice,
): void {
  const PULL_FEED_LEN = 3208;
  const OFF_SUBMISSIONS = 8;
  const SUBMISSION_SIZE = 64;
  const SUB_OFF_SLOT = 32;
  const SUB_OFF_LANDED_AT = 40;
  const SUB_OFF_VALUE = 48;
  const OFF_MIN_SAMPLE_SIZE = 2215;
  const OFF_LAST_UPDATE_TS = 2216;
  const OFF_RESULT_VALUE = 2264;
  const OFF_RESULT_STD_DEV = 2280;
  const OFF_RESULT_NUM_SAMPLES = 2360;
  const OFF_RESULT_SLOT = 2368;

  const data = Buffer.alloc(PULL_FEED_LEN);
  Buffer.from([196, 27, 108, 196, 10, 215, 219, 40]).copy(data, 0);
  // min_sample_size: the program floors `min_samples` at 1, but set it
  // explicitly so even a price-less mock has a sane value.
  data.writeUInt8(1, OFF_MIN_SAMPLE_SIZE);

  if (price !== undefined) {
    const slot =
      price.slot !== undefined ? BigInt(price.slot) : svm.getClock().slot;
    const value = BigInt(price.value);
    const stdDev = BigInt(price.stdDev ?? 0);

    // Three identical fresh submissions → median == value.
    const NUM_SUBMISSIONS = 3;
    for (let i = 0; i < NUM_SUBMISSIONS; i++) {
      const base = OFF_SUBMISSIONS + i * SUBMISSION_SIZE;
      data.writeBigUInt64LE(slot, base + SUB_OFF_SLOT);
      data.writeBigUInt64LE(slot, base + SUB_OFF_LANDED_AT);
      writeI128LE(data, value, base + SUB_OFF_VALUE);
    }

    data.writeBigInt64LE(svm.getClock().unixTimestamp, OFF_LAST_UPDATE_TS);

    // CurrentResult — std_dev feeds the confidence gate; value/slot mirror
    // the submissions for realism.
    writeI128LE(data, value, OFF_RESULT_VALUE);
    writeI128LE(data, stdDev, OFF_RESULT_STD_DEV);
    data.writeUInt8(NUM_SUBMISSIONS, OFF_RESULT_NUM_SAMPLES);
    data.writeBigUInt64LE(slot, OFF_RESULT_SLOT);
  }

  svm.setAccount({
    address: pubkey,
    data,
    executable: false,
    lamports: lamports(1_000_000_000n),
    programAddress: SWITCHBOARD_PROGRAM_ID,
    space: BigInt(data.length),
  });
}

/** SPL Token program — owner of mint and token accounts. */
const SPL_TOKEN_PROGRAM_ID = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/**
 * Seed an initialized SPL Mint account directly (82-byte layout).
 *
 * Bypasses the InitializeMint instruction — LiteSVM lets us write the final
 * account state straight in. Layout:
 *   0..4    mint_authority COption tag (1 = Some)
 *   4..36   mint_authority pubkey
 *   36..44  supply (u64 LE)
 *   44      decimals (u8)
 *   45      is_initialized (1)
 *   46..50  freeze_authority COption tag (0 = None)
 *   50..82  freeze_authority pubkey (zeros)
 */
export function seedSplMint(
  svm: LiteSVM,
  mint: Address,
  opts: { decimals: number; mintAuthority: Address; supply?: bigint | number },
): void {
  const data = Buffer.alloc(82);
  data.writeUInt32LE(1, 0); // mint_authority = Some
  Buffer.from(addressBytes(opts.mintAuthority)).copy(data, 4);
  data.writeBigUInt64LE(BigInt(opts.supply ?? 0), 36);
  data.writeUInt8(opts.decimals, 44);
  data.writeUInt8(1, 45); // is_initialized
  // freeze_authority COption tag stays 0 (None)
  svm.setAccount({
    address: mint,
    data,
    executable: false,
    lamports: lamports(1_000_000_000n),
    programAddress: SPL_TOKEN_PROGRAM_ID,
    space: BigInt(data.length),
  });
}

/**
 * Seed an initialized SPL token account directly (165-byte layout).
 *
 * Use the ATA address (getAssociatedTokenAddressSync) as `tokenAccount` so the
 * on-chain program finds it where it expects. Layout:
 *   0..32    mint
 *   32..64   owner
 *   64..72   amount (u64 LE)
 *   72..76   delegate COption tag (0 = None)
 *   76..108  delegate pubkey (zeros)
 *   108      state (1 = Initialized)
 *   109..113 is_native COption tag (0 = None)
 *   113..121 is_native value (zeros)
 *   121..129 delegated_amount (u64, 0)
 *   129..133 close_authority COption tag (0 = None)
 *   133..165 close_authority pubkey (zeros)
 */
export function seedSplTokenAccount(
  svm: LiteSVM,
  tokenAccount: Address,
  opts: { mint: Address; owner: Address; amount: bigint | number },
): void {
  const data = Buffer.alloc(165);
  Buffer.from(addressBytes(opts.mint)).copy(data, 0);
  Buffer.from(addressBytes(opts.owner)).copy(data, 32);
  data.writeBigUInt64LE(BigInt(opts.amount), 64);
  data.writeUInt8(1, 108); // state = Initialized
  svm.setAccount({
    address: tokenAccount,
    data,
    executable: false,
    lamports: lamports(2_039_280n), // rent-exempt minimum for 165 bytes
    programAddress: SPL_TOKEN_PROGRAM_ID,
    space: BigInt(data.length),
  });
}

/** Read the `amount` (u64 LE @ offset 64) from a seeded SPL token account. */
export function readSplTokenAmount(svm: LiteSVM, tokenAccount: Address): bigint {
  const acct = svm.getAccount(tokenAccount);
  if (!acct.exists || acct.data.length < 72) return 0n;
  return Buffer.from(acct.data).readBigUInt64LE(64);
}

/**
 * Seed the `ProgramData` PDA for the test program so the on-chain
 * `assert_is_program_authority` check passes.
 *
 * LiteSVM's `addProgramFromFile` loads program binaries directly as
 * executable accounts at the program ID — it doesn't synthesize the
 * upgradeable-loader two-account layout (program account + program-data
 * PDA). The on-chain `init_game_engine` handler still expects to find
 * the program-data PDA and verify its upgrade authority matches the
 * caller. We replicate the relevant byte layout here:
 *   - bytes 0..4   : enum tag (3 = ProgramData)
 *   - bytes 4..12  : slot (zero in tests)
 *   - bytes 12     : Option<Address> tag (1 = Some)
 *   - bytes 13..45 : upgrade authority pubkey
 *
 * Mirrors `UpgradeableLoaderState::ProgramData` (the upstream
 * solana-program-loader layout) and the offsets read by
 * `assert_is_program_authority` in `init_game_engine.rs`.
 */
export async function seedProgramDataPda(
  svm: LiteSVM,
  programId: Address,
  upgradeAuthority: Address,
): Promise<void> {
  const [programData] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    seeds: [addressBytes(programId)],
  });

  const data = Buffer.alloc(45);
  data.writeUInt32LE(3, 0); // enum tag = ProgramData
  // slot at 4..12 stays zero
  data.writeUInt8(1, 12); // Some(upgrade_authority)
  Buffer.from(addressBytes(upgradeAuthority)).copy(data, 13);

  svm.setAccount({
    address: programData,
    data,
    executable: false,
    lamports: lamports(1_000_000_000n),
    programAddress: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    space: BigInt(data.length),
  });
}

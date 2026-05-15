/**
 * LiteSVM Test Environment
 *
 * Creates an in-process SVM instance with all programs and accounts
 * needed for E2E tests. Replaces solana-test-validator.
 */

import { LiteSVM, Clock, FailedTransactionMetadata, type TransactionMetadata } from 'litesvm';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import * as path from 'path';
import * as fs from 'fs';

export { LiteSVM, Clock, FailedTransactionMetadata };
export type { TransactionMetadata };

const SDK_DIR = path.join(__dirname, '../..');
const ROOT_DIR = path.join(SDK_DIR, '../..');
const BIN_DIR = path.join(SDK_DIR, 'programs/.bin');
const NOVUS_MUNDUS_SO = path.join(ROOT_DIR, 'target/deploy/novus_mundus.so');

// Program IDs
const NOVUS_MUNDUS_PROGRAM_ID = new PublicKey('J4DxMg1RfwRzjpZ3N6D1ULNjuwLHuhe6qLNeX9rYNz3V');
const MPL_CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const TLD_HOUSE_PROGRAM_ID = new PublicKey('TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S');
const ALT_NAME_SERVICE_PROGRAM_ID = new PublicKey('ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK');

// TLD accounts (mainnet snapshots)
const TLD_STATE = new PublicKey('VmmhRjr64KbpTZpgmeiVSWmR8H8RyqgigF1XQf8AvET');
const TLD_HOUSE_SOLANA = new PublicKey('8Y1BpwTwqwFXpLDiTmjQKm1RNR8pdhB7VFfEayaSddVz');

/**
 * Create a fresh LiteSVM instance with all programs loaded and TLD accounts seeded.
 */
export function createTestSvm(): LiteSVM {
  const svm = new LiteSVM()
    .withTransactionHistory(10000n)
    .withLamports(100_000_000_000_000n); // 100k SOL for airdrops

  // Load program binaries
  const novusSoPath = fs.existsSync(NOVUS_MUNDUS_SO)
    ? NOVUS_MUNDUS_SO
    : path.join(SDK_DIR, 'target/deploy/novus_mundus.so');

  svm.addProgramFromFile(NOVUS_MUNDUS_PROGRAM_ID, novusSoPath);
  svm.addProgramFromFile(MPL_CORE_PROGRAM_ID, path.join(BIN_DIR, 'mpl_core.so'));
  svm.addProgramFromFile(TLD_HOUSE_PROGRAM_ID, path.join(BIN_DIR, 'tld_house.so'));
  svm.addProgramFromFile(ALT_NAME_SERVICE_PROGRAM_ID, path.join(BIN_DIR, 'alt_name_service.so'));

  // Seed TLD accounts from mainnet snapshots
  const dataDir = path.join(__dirname, 'data');
  loadAccountFromJson(svm, TLD_STATE, path.join(dataDir, 'tld-state.json'));
  loadAccountFromJson(svm, TLD_HOUSE_SOLANA, path.join(dataDir, 'tld-house-solana.json'));

  // Pin the initial clock to a deterministic Midday-at-Americas timestamp.
  //
  // `get_time_of_day(timestamp, longitude)` in the program maps local time to
  // multipliers; for `ActivityType::Hiring`, DeepNight and Evening apply a
  // 0.618× penalty that rounds 1-unit hires down to 0 → InsufficientPower.
  // Using `Date.now()` made the suite flaky: tests passed or failed depending
  // on what wall-clock time the runner happened to start at.
  //
  // 04:48:00 UTC → global_time bucket 200, which places every test city
  // (longitudes -125..+40 incl. Americas, Europe, Western Asia) in Morning,
  // Midday, Afternoon, or Dusk (all ≥ 1.0× for Hiring). Choice is calendar-
  // arbitrary (Jan 15 2024) — only the time-of-day matters.
  const now = BigInt(Math.floor(Date.UTC(2024, 0, 15, 4, 48, 0) / 1000));
  const clock = new Clock(1n, now, 0n, 0n, now);
  svm.setClock(clock);

  return svm;
}

/**
 * Load an account from a `solana account --output json` snapshot file.
 */
function loadAccountFromJson(svm: LiteSVM, address: PublicKey, jsonPath: string): void {
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const acct = json.account;
  const data = Buffer.from(acct.data[0], 'base64');

  svm.setAccount(address, {
    data,
    executable: acct.executable,
    lamports: acct.lamports,
    owner: new PublicKey(acct.owner),
    rentEpoch: 0,
  });
}

/**
 * Convert LiteSVM's AccountInfo<Uint8Array> to web3.js AccountInfo<Buffer>.
 * All deserialization functions in the SDK expect Buffer data.
 */
export function toAccountInfo(account: AccountInfo<Uint8Array>): AccountInfo<Buffer> {
  return {
    ...account,
    data: Buffer.from(account.data),
  };
}

/** BPFLoaderUpgradeab1e11111111111111111111111 — owns `ProgramData` PDAs. */
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
);

/** Pyth on-mainnet program ID — owner of legit Pyth price feed accounts. */
const PYTH_PROGRAM_ID = new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT');

/** Switchboard on-demand program ID — owner of Switchboard pull feed accounts. */
const SWITCHBOARD_PROGRAM_ID = new PublicKey('SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv');

export interface MockPythPrice {
  /** Price as a signed integer in units of 10^expo (e.g., 15023 with expo=-2 = $150.23). */
  price: bigint | number;
  /** Confidence interval in the same units as `price`. */
  conf?: bigint | number;
  /** Exponent (negative power of 10). Typical: -8 for USD prices. */
  expo?: number;
  /**
   * Slot the price was published at. Defaults to the current LiteSVM slot so
   * `agg.pub_slot >= now - max_staleness` always succeeds. Override to
   * exercise stale-price branches.
   */
  pubSlot?: bigint | number;
}

/**
 * Seed a synthetic Pyth price-feed account at `pubkey`.
 *
 * The on-chain `validate_oracle_feed_at_config` does:
 *   1. owner == PYTH_PROGRAM_ID
 *   2. `PythPriceAccount::load(&data)` — checks magic, version, account type
 *
 * The price-read path (called from `purchase_item` token-payment flow,
 * `purchase_novi`, etc.) additionally requires `agg.status == Trading` and
 * `agg.pub_slot >= current_slot - max_staleness_slots`. Pass `price` to seed
 * a live, queryable price; pass nothing for the header-only legacy mock used
 * by config-only tests.
 *
 * Field offsets are pinned from `p_pyth::PythPriceAccount` (240-byte struct);
 * `agg` is the 32-byte PriceInfo at offset 208.
 */
const PYTH = {
  MAGIC: 0,
  VER: 4,
  ATYPE: 8,
  SIZE: 12,
  PTYPE: 16,
  EXPO: 20,
  AGG_PRICE: 208,
  AGG_CONF: 216,
  AGG_STATUS: 224,
  AGG_PUB_SLOT: 232,
  LEN: 240,
} as const;

export function seedMockPythFeed(
  svm: LiteSVM,
  pubkey: PublicKey,
  price?: MockPythPrice,
): void {
  const data = Buffer.alloc(PYTH.LEN);
  data.writeUInt32LE(0xa1b2c3d4, PYTH.MAGIC);
  data.writeUInt32LE(2, PYTH.VER);
  data.writeUInt32LE(3, PYTH.ATYPE); // Price
  data.writeUInt32LE(PYTH.LEN, PYTH.SIZE);

  if (price !== undefined) {
    data.writeUInt8(1, PYTH.PTYPE); // Price
    data.writeInt32LE(price.expo ?? -8, PYTH.EXPO);
    data.writeBigInt64LE(BigInt(price.price), PYTH.AGG_PRICE);
    data.writeBigUInt64LE(BigInt(price.conf ?? 0), PYTH.AGG_CONF);
    data.writeUInt8(1, PYTH.AGG_STATUS); // Trading
    const pubSlot = price.pubSlot !== undefined
      ? BigInt(price.pubSlot)
      : svm.getClock().slot;
    data.writeBigUInt64LE(pubSlot, PYTH.AGG_PUB_SLOT);
  }

  svm.setAccount(pubkey, {
    data,
    executable: false,
    lamports: 1_000_000_000,
    owner: PYTH_PROGRAM_ID,
    rentEpoch: 0,
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
   * Result slot for the staleness check (`current_slot - result_slot <= max`).
   * Defaults to the current LiteSVM slot.
   */
  resultSlot?: bigint | number;
}

/**
 * Seed a synthetic Switchboard pull-feed account at `pubkey`.
 *
 * The on-chain `validate_oracle_feed_at_config` checks:
 *   1. owner == SWITCHBOARD_PROGRAM_ID
 *   2. `p_switchboard::validate_discriminator(&data)` — first 8 bytes
 *      must match the Anchor discriminator for `PullFeedAccountData`.
 *
 * The price-read path (`load_switchboard_price`, used by the token-payment
 * and purchase_novi Switchboard branches) additionally reads:
 *   - result_value  (i128 LE @ 2264) — the price, must be > 0
 *   - result_std_dev(i128 LE @ 2280) — for the confidence gate
 *   - result_slot   (u64  LE @ 2368) — for the staleness gate
 *   - last_update_ts(i64  LE @ 2216)
 * Offsets are pinned from `p_switchboard` (MIN_PULL_FEED_LEN = 2396).
 *
 * Pass `price` to seed a live, queryable feed; pass nothing for the
 * discriminator-only mock used by config-gate-only tests.
 */
export function seedMockSwitchboardFeed(
  svm: LiteSVM,
  pubkey: PublicKey,
  price?: MockSwitchboardPrice,
): void {
  const MIN_PULL_FEED_LEN = 2396;
  const data = Buffer.alloc(MIN_PULL_FEED_LEN);
  const discriminator = Buffer.from([196, 27, 108, 196, 10, 215, 219, 40]);
  discriminator.copy(data, 0);

  if (price !== undefined) {
    const OFF_LAST_UPDATE_TS = 2216;
    const OFF_RESULT_VALUE = 2264;
    const OFF_RESULT_STD_DEV = 2280;
    const OFF_RESULT_SLOT = 2368;
    writeI128LE(data, BigInt(price.value), OFF_RESULT_VALUE);
    writeI128LE(data, BigInt(price.stdDev ?? 0), OFF_RESULT_STD_DEV);
    const slot = price.resultSlot !== undefined
      ? BigInt(price.resultSlot)
      : svm.getClock().slot;
    data.writeBigUInt64LE(slot, OFF_RESULT_SLOT);
    data.writeBigInt64LE(svm.getClock().unixTimestamp, OFF_LAST_UPDATE_TS);
  }

  svm.setAccount(pubkey, {
    data,
    executable: false,
    lamports: 1_000_000_000,
    owner: SWITCHBOARD_PROGRAM_ID,
    rentEpoch: 0,
  });
}

/** SPL Token program — owner of mint and token accounts. */
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

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
  mint: PublicKey,
  opts: { decimals: number; mintAuthority: PublicKey; supply?: bigint | number },
): void {
  const data = Buffer.alloc(82);
  data.writeUInt32LE(1, 0); // mint_authority = Some
  opts.mintAuthority.toBuffer().copy(data, 4);
  data.writeBigUInt64LE(BigInt(opts.supply ?? 0), 36);
  data.writeUInt8(opts.decimals, 44);
  data.writeUInt8(1, 45); // is_initialized
  // freeze_authority COption tag stays 0 (None)
  svm.setAccount(mint, {
    data,
    executable: false,
    lamports: 1_000_000_000,
    owner: SPL_TOKEN_PROGRAM_ID,
    rentEpoch: 0,
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
  tokenAccount: PublicKey,
  opts: { mint: PublicKey; owner: PublicKey; amount: bigint | number },
): void {
  const data = Buffer.alloc(165);
  opts.mint.toBuffer().copy(data, 0);
  opts.owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(opts.amount), 64);
  data.writeUInt8(1, 108); // state = Initialized
  svm.setAccount(tokenAccount, {
    data,
    executable: false,
    lamports: 2_039_280, // rent-exempt minimum for 165 bytes
    owner: SPL_TOKEN_PROGRAM_ID,
    rentEpoch: 0,
  });
}

/** Read the `amount` (u64 LE @ offset 64) from a seeded SPL token account. */
export function readSplTokenAmount(svm: LiteSVM, tokenAccount: PublicKey): bigint {
  const acct = svm.getAccount(tokenAccount);
  if (!acct || acct.data.length < 72) return 0n;
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
export function seedProgramDataPda(
  svm: LiteSVM,
  programId: PublicKey,
  upgradeAuthority: PublicKey,
): void {
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  );

  const data = Buffer.alloc(45);
  data.writeUInt32LE(3, 0); // enum tag = ProgramData
  // slot at 4..12 stays zero
  data.writeUInt8(1, 12); // Some(upgrade_authority)
  upgradeAuthority.toBuffer().copy(data, 13);

  svm.setAccount(programData, {
    data,
    executable: false,
    lamports: 1_000_000_000,
    owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    rentEpoch: 0,
  });
}

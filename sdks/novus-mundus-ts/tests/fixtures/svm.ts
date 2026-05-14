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

  // Set a realistic initial clock (LiteSVM defaults to epoch 0)
  const now = BigInt(Math.floor(Date.now() / 1000));
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

/**
 * Seed a synthetic Pyth price-feed account at `pubkey`.
 *
 * The on-chain `validate_oracle_feed_at_config` does:
 *   1. owner == PYTH_PROGRAM_ID
 *   2. `PythPriceAccount::load(&data)` — checks magic, version, account type
 *
 * Layout (from p_pyth::PythPriceAccount, 240-byte header):
 *   bytes  0..4  : magic (u32 LE = 0xa1b2c3d4)
 *   bytes  4..8  : ver   (u32 LE = 2)
 *   bytes  8..12 : atype (u32 LE = 3 = Price)
 *   bytes 12..16 : size  (u32 LE, any)
 *   bytes 16..   : remaining header fields — zeros are fine for the
 *                  validation pass at config time (price read happens at
 *                  purchase time and is out of scope for the config gate)
 */
export function seedMockPythFeed(svm: LiteSVM, pubkey: PublicKey): void {
  const data = Buffer.alloc(240);
  data.writeUInt32LE(0xa1b2c3d4, 0); // magic
  data.writeUInt32LE(2, 4);          // ver
  data.writeUInt32LE(3, 8);          // atype = Price
  data.writeUInt32LE(240, 12);       // size
  svm.setAccount(pubkey, {
    data,
    executable: false,
    lamports: 1_000_000_000,
    owner: PYTH_PROGRAM_ID,
    rentEpoch: 0,
  });
}

/**
 * Seed a synthetic Switchboard pull-feed account at `pubkey`.
 *
 * The on-chain `validate_oracle_feed_at_config` checks:
 *   1. owner == SWITCHBOARD_PROGRAM_ID
 *   2. `p_switchboard::validate_discriminator(&data)` — first 8 bytes
 *      must match the Anchor discriminator for `PullFeedAccountData`.
 *
 * Discriminator bytes are pinned from `p_switchboard::DISCRIMINATOR`.
 * Data length must be at least `MIN_PULL_FEED_LEN` (2396) for the
 * full-purchase-time read; at config time only the first 8 bytes are
 * inspected, but we size the account to `MIN_PULL_FEED_LEN` so the same
 * mock works for both call sites.
 */
export function seedMockSwitchboardFeed(svm: LiteSVM, pubkey: PublicKey): void {
  const MIN_PULL_FEED_LEN = 2396;
  const data = Buffer.alloc(MIN_PULL_FEED_LEN);
  const discriminator = Buffer.from([196, 27, 108, 196, 10, 215, 219, 40]);
  discriminator.copy(data, 0);
  svm.setAccount(pubkey, {
    data,
    executable: false,
    lamports: 1_000_000_000,
    owner: SWITCHBOARD_PROGRAM_ID,
    rentEpoch: 0,
  });
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

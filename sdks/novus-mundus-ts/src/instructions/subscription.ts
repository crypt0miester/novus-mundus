/**
 * Subscription Instructions
 *
 * Instructions for subscription management:
 * - Purchase subscription
 * - Update tier (admin payment)
 * - Downgrade expired
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '../utils/token';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  deriveAllowedTokenPda,
  deriveNoviMintPda,
  derivePlayerPda,
  deriveShopConfigPda,
  deriveUserPda,
} from '../pda';
import { getAssociatedTokenAddressSync, getAssociatedTokenAddressSyncForPda } from '../utils/token';

// Purchase Subscription

/**
 * Accounts and oracle/peg context for a TOKEN-payment subscription
 * (`paymentType = 2`). Set this when paying with an SPL token.
 *
 * Pricing path is selected per-token by `AllowedTokenAccount.pegged_to_usd`:
 * - **Pegged** (USDC/USDT/PYUSD): omit all `*OracleFeed` / `switchboard*`
 *   fields. The chain skips the oracle and computes the token amount as
 *   `cost_usd_cents × 10^(decimals - 2)`.
 * - **Pyth**: set `solPythFeed` + `tokenPythFeed`.
 * - **Switchboard**: set `switchboardQuote` + `switchboardQueue` + `slotHashes`.
 *
 * `tokenMint`, `buyerTokenAta`, and `treasuryTokenAta` are always required.
 * If omitted, sensible defaults derive `buyerTokenAta` /
 * `treasuryTokenAta` from `tokenMint` + the corresponding owner.
 */
export interface SubscriptionTokenPayment {
  tokenMint: PublicKey;
  /** Buyer's ATA for `tokenMint`. Derived from owner if omitted. */
  buyerTokenAta?: PublicKey;
  /** Treasury wallet's ATA for `tokenMint`. Derived from treasury if omitted. */
  treasuryTokenAta?: PublicKey;
  /** Pyth path: SOL/USD PriceUpdateV2. */
  solPythFeed?: PublicKey;
  /** Pyth path: TOKEN/USD PriceUpdateV2. */
  tokenPythFeed?: PublicKey;
  /** Switchboard path: program-owned OracleQuote PDA. */
  switchboardQuote?: PublicKey;
  /** Switchboard path: queue account. */
  switchboardQueue?: PublicKey;
  /** Switchboard path: SlotHashes sysvar. */
  slotHashes?: PublicKey;
}

export interface PurchaseSubscriptionAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Payment authority for offchain payments (signer). Pass owner if not using offchain. */
  paymentAuthority: PublicKey;
  /** Treasury wallet to receive SOL payments */
  treasury: PublicKey;
  /** Optional token-payment accounts. Required (and consulted) only when
   *  `paymentType === 2`. */
  tokenPayment?: SubscriptionTokenPayment;
}

export interface PurchaseSubscriptionParams {
  /** Payment type: 0=SOL, 1=OFFCHAIN, 2=TOKEN */
  paymentType: number;
  /** Target tier (0=Rookie, 1=Expert, 2=Epic, 3=Legendary) */
  tier: number;
}

/** ~55,000 CU */
/**
 * Purchase or upgrade subscription tier.
 *
 * Supports three payment modes:
 * - 0: ONCHAIN SOL - Transfers SOL from player to treasury
 * - 1: OFFCHAIN - Backend verifies real-money payment (Stripe/PayPal)
 * - 2: TOKEN - Pay with whitelisted token using oracle price conversion
 *
 * Tiers:
 * - 0: Rookie (free)
 * - 1: Expert ($10/mo)
 * - 2: Epic ($50/mo)
 * - 3: Legendary ($250/mo)
 *
 * Benefits increase with tier:
 * - Generation multiplier
 * - Max locked NOVI
 * - Daily reward multiplier
 * - Rally caps
 * - Transfer limits
 * - Travel speed bonus
 */
export function createPurchaseSubscriptionInstruction(
  accounts: PurchaseSubscriptionAccounts,
  params: PurchaseSubscriptionParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [user] = deriveUserPda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  // Token account is owned by UserAccount PDA (not PlayerAccount)
  const userNoviAta = getAssociatedTokenAddressSyncForPda(noviMint, user);

  // Rust account order (10 base accounts):
  // 0. player (writable)
  // 1. user (writable)
  // 2. owner (signer)
  // 3. payment_authority (signer) - only required for offchain
  // 4. treasury_wallet (writable)
  // 5. user_novi_ata (writable)
  // 6. novi_mint (writable)
  // 7. game_engine
  // 8. token_program
  // 9. system_program
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: accounts.paymentAuthority ?? user, isSigner: true, isWritable: false },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: userNoviAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // TOKEN payment (`paymentType === 2`): append the shop_config + the
  // token-payment account layout that `process_token_payment_flow` consumes.
  // Order mirrors `subscription/purchase.rs:307-335` (shop_config at slot 10,
  // then the token_accounts[..] passed straight through to the helper).
  if (params.paymentType === 2) {
    if (!accounts.tokenPayment) {
      throw new Error(
        'createPurchaseSubscriptionInstruction: paymentType=2 requires `tokenPayment` accounts',
      );
    }
    const tp = accounts.tokenPayment;
    const [shopConfig] = deriveShopConfigPda(accounts.gameEngine);
    const [allowedToken] = deriveAllowedTokenPda(accounts.gameEngine, tp.tokenMint);
    const buyerAta = tp.buyerTokenAta ?? getAssociatedTokenAddressSync(tp.tokenMint, accounts.owner);
    const treasuryAta =
      tp.treasuryTokenAta ?? getAssociatedTokenAddressSync(tp.tokenMint, accounts.treasury);

    keys.push(
      { pubkey: shopConfig, isSigner: false, isWritable: false },           // [10] shop_config
      { pubkey: allowedToken, isSigner: false, isWritable: false },         // [11] allowed_token
      { pubkey: tp.tokenMint, isSigner: false, isWritable: false },         // [12] token_mint
      { pubkey: buyerAta, isSigner: false, isWritable: true },              // [13] buyer_token_ata
      { pubkey: treasuryAta, isSigner: false, isWritable: true },           // [14] treasury_token_ata
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },     // [15] token_program (the inner one read by the helper)
    );

    // Oracle accounts (slots 16+) are *only* required for non-pegged tokens.
    // For a $1-pegged stablecoin (USDC/USDT/PYUSD whitelisted with
    // `peggedToUsd: true`), omit all of these — the chain skips the oracle.
    if (tp.solPythFeed && tp.tokenPythFeed) {
      keys.push(
        { pubkey: tp.solPythFeed, isSigner: false, isWritable: false },     // [16] sol PriceUpdateV2
        { pubkey: tp.tokenPythFeed, isSigner: false, isWritable: false },   // [17] token PriceUpdateV2
      );
    } else if (tp.switchboardQuote && tp.switchboardQueue && tp.slotHashes) {
      keys.push(
        { pubkey: tp.switchboardQuote, isSigner: false, isWritable: false }, // [16] oracle-quote PDA
        { pubkey: tp.switchboardQueue, isSigner: false, isWritable: false }, // [17] Switchboard queue
        { pubkey: tp.slotHashes, isSigner: false, isWritable: false },       // [18] SlotHashes sysvar
      );
    }
    // else: pegged path — no oracle accounts.

    /*
     * Append the ATA program so `process_token_payment_flow`'s defensive
     * `create_associated_token_account` backstop (fires when the treasury
     * ATA doesn't exist) can CPI the ATA program. Appended last so
     * positional `&accounts[..]` reads in the on-chain processor are not
     * shifted; the helper indexes the leading token-payment slots only.
     */
    keys.push({ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // Instruction data: payment_type (u8) + new_tier_index (u8)
  const writer = new BufferWriter(2);
  writer.writeU8(params.paymentType);
  writer.writeU8(params.tier);

  const data = createInstructionData(DISCRIMINATORS.SUBSCRIPTION_PURCHASE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Update Tier Configuration (DAO ONLY)

export interface UpdateTierConfigAccounts {
  /** DAO governance authority (signer) */
  authority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface RallyCapsConfig {
  maxActiveRalliesJoined: number;
  maxRalliesCreatedPerDay: number;
  maxRallyTroopContribution: bigint | number;
  maxRallySize: number;
  maxRallyDurationSeconds: bigint | number;
}

export interface SubscriptionTierConfigInput {
  name: string;
  tierIndex: number;
  costInUsdCents: bigint | number;
  durationDays: number;
  generationMultiplier: bigint | number;
  maxLockedNovi: bigint | number;
  dailyRewardMultiplier: bigint | number;
  synchronyBonus: number;
  novi: bigint | number;
  cash: bigint | number;
  du1: bigint | number;
  du2: bigint | number;
  du3: bigint | number;
  op1: bigint | number;
  op2: bigint | number;
  op3: bigint | number;
  meleeWeapons: bigint | number;
  rangedWeapons: bigint | number;
  siegeWeapons: bigint | number;
  armor: bigint | number;
  produce: bigint | number;
  vehicles: bigint | number;
  reputation: bigint | number;
  xp: bigint | number;
  rallyCaps: RallyCapsConfig;
  maxTeamMembers: number;
  maxDailyTransferAmount: bigint | number;
  maxDailyTransferCount: number;
  travelSpeedBonusBps: number;
}

/**
 * Calculate the serialized size of a SubscriptionTierConfig.
 * Used internally for buffer allocation.
 */
const SUBSCRIPTION_TIER_SIZE = 256; // repr(C) size including alignment padding

/**
 * Serialize a SubscriptionTierConfig to bytes.
 */
function serializeSubscriptionTierConfig(config: SubscriptionTierConfigInput): Buffer {
  const writer = new BufferWriter(SUBSCRIPTION_TIER_SIZE);

  // name: [u8; 16]
  const nameBytes = Buffer.alloc(16);
  const nameEncoded = Buffer.from(config.name, 'utf8');
  nameEncoded.copy(nameBytes, 0, 0, Math.min(nameEncoded.length, 16));
  writer.writeBytes(nameBytes);

  // tier_index: u8
  writer.writeU8(config.tierIndex);
  // _padding1: [u8; 7]
  writer.writeBytes(Buffer.alloc(7));

  // cost_in_usd_cents: u64
  writer.writeU64(BigInt(config.costInUsdCents));
  // duration_days: u32
  writer.writeU32(config.durationDays);
  // _padding2: [u8; 4]
  writer.writeBytes(Buffer.alloc(4));

  // generation_multiplier: u64
  writer.writeU64(BigInt(config.generationMultiplier));
  // max_locked_novi: u64
  writer.writeU64(BigInt(config.maxLockedNovi));
  // daily_reward_multiplier: u64
  writer.writeU64(BigInt(config.dailyRewardMultiplier));
  // synchrony_bonus: u32
  writer.writeU32(config.synchronyBonus);
  // implicit repr(C) alignment padding before next u64
  writer.writeBytes(Buffer.alloc(4));

  // Bonuses
  writer.writeU64(BigInt(config.novi));
  writer.writeU64(BigInt(config.cash));
  writer.writeU64(BigInt(config.du1));
  writer.writeU64(BigInt(config.du2));
  writer.writeU64(BigInt(config.du3));
  writer.writeU64(BigInt(config.op1));
  writer.writeU64(BigInt(config.op2));
  writer.writeU64(BigInt(config.op3));
  writer.writeU64(BigInt(config.meleeWeapons));
  writer.writeU64(BigInt(config.rangedWeapons));
  writer.writeU64(BigInt(config.siegeWeapons));
  writer.writeU64(BigInt(config.armor));
  writer.writeU64(BigInt(config.produce));
  writer.writeU64(BigInt(config.vehicles));
  writer.writeU64(BigInt(config.reputation));
  writer.writeU64(BigInt(config.xp));

  // RallyCaps
  writer.writeU8(config.rallyCaps.maxActiveRalliesJoined);
  writer.writeU8(config.rallyCaps.maxRalliesCreatedPerDay);
  writer.writeBytes(Buffer.alloc(6)); // padding
  writer.writeU64(BigInt(config.rallyCaps.maxRallyTroopContribution));
  writer.writeU8(config.rallyCaps.maxRallySize);
  writer.writeBytes(Buffer.alloc(7)); // padding
  writer.writeI64(BigInt(config.rallyCaps.maxRallyDurationSeconds));

  // Team and transfer limits
  writer.writeU8(config.maxTeamMembers);
  writer.writeBytes(Buffer.alloc(7)); // padding
  writer.writeU64(BigInt(config.maxDailyTransferAmount));
  writer.writeU8(config.maxDailyTransferCount);
  writer.writeBytes(Buffer.alloc(3)); // padding
  writer.writeU32(config.travelSpeedBonusBps);

  return writer.toBuffer();
}

/** ~5,000 CU */
/**
 * Update subscription tier configuration (DAO ONLY).
 *
 * Allows DAO governance to update subscription tier parameters
 * without requiring a full program upgrade.
 *
 * @param accounts - Account inputs
 * @param tierConfig - Full tier configuration to set
 */
export function createUpdateTierConfigInstruction(
  accounts: UpdateTierConfigAccounts,
  tierConfig: SubscriptionTierConfigInput
): TransactionInstruction {
  // Rust account order (2 accounts):
  // 0. game_engine (writable)
  // 1. authority (signer)
  const keys = [
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
  ];

  // Instruction data: tier_index (u8) + SubscriptionTier struct
  const tierData = serializeSubscriptionTierConfig(tierConfig);
  const writer = new BufferWriter(1 + tierData.length);
  writer.writeU8(tierConfig.tierIndex);
  writer.writeBytes(tierData);

  const data = createInstructionData(DISCRIMINATORS.SUBSCRIPTION_UPDATE_TIER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * @deprecated Use createUpdateTierConfigInstruction instead.
 * This function name was misleading - it's for DAO config updates, not offchain payments.
 * For offchain payments, use createPurchaseSubscriptionInstruction with paymentType: 1.
 */
export const createUpdateTierInstruction = createUpdateTierConfigInstruction;

// Downgrade Expired

export interface DowngradeExpiredAccounts {
  /** Player account to check/downgrade */
  playerAccount: PublicKey;
}

/** ~5,000 CU */
/**
 * Downgrade expired subscription to Rookie tier.
 *
 * Permissionless - anyone can call to downgrade expired subscriptions.
 * This helps maintain accurate tier status across the system.
 */
export function createDowngradeExpiredInstruction(
  accounts: DowngradeExpiredAccounts
): TransactionInstruction {
  const keys = [
    { pubkey: accounts.playerAccount, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.SUBSCRIPTION_DOWNGRADE_EXPIRED);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

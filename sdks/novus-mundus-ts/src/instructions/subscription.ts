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
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveUserPda,
} from '../pda';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token';

// ============================================================
// Purchase Subscription
// ============================================================

export interface PurchaseSubscriptionAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Payment authority for offchain payments (signer). Pass owner if not using offchain. */
  paymentAuthority: PublicKey;
  /** Treasury wallet to receive SOL payments */
  treasury: PublicKey;
  /** Payment method (SOL or SPL token) */
  paymentMint?: PublicKey;
  /** Pyth price feed for payment token */
  pythFeed?: PublicKey;
  /** Switchboard feed (alternative) */
  switchboardFeed?: PublicKey;
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
    { pubkey: accounts.paymentAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: userNoviAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Optional accounts for TOKEN payment (payment_type=2)
  if (accounts.paymentMint) {
    keys.push({ pubkey: accounts.paymentMint, isSigner: false, isWritable: false });
  }
  if (accounts.pythFeed) {
    keys.push({ pubkey: accounts.pythFeed, isSigner: false, isWritable: false });
  }
  if (accounts.switchboardFeed) {
    keys.push({ pubkey: accounts.switchboardFeed, isSigner: false, isWritable: false });
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

// ============================================================
// Update Tier Configuration (DAO ONLY)
// ============================================================

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

// ============================================================
// Downgrade Expired
// ============================================================

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

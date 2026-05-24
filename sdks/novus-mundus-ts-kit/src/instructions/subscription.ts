/**
 * Subscription Instructions
 *
 * Instructions for subscription management:
 * - Purchase subscription
 * - Update tier (admin payment)
 * - Downgrade expired
 */

import type { Address, Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u16, u32, u64, i64, fixedString, pad } from '../utils/codec';
import {
  deriveAllowedTokenPda,
  deriveNoviMintPda,
  derivePlayerPda,
  deriveShopConfigPda,
  deriveUserPda,
} from '../pda';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAssociatedTokenAddressSyncForPda } from '../utils/token';

// Purchase Subscription

/**
 * Accounts and oracle/peg context for a TOKEN-payment subscription
 * (`paymentType = 2`). Set this when paying with an SPL token.
 *
 * Pricing path is selected per-token by `AllowedTokenAccount.pegged_to_usd`:
 * - **Pegged** (USDC/USDT/PYUSD): omit all `*PythFeed` / `switchboard*`
 *   fields. The chain skips the oracle and computes the token amount as
 *   `cost_usd_cents × 10^(decimals - 2)`.
 * - **Pyth**: set `solPythFeed` + `tokenPythFeed`.
 * - **Switchboard**: set `switchboardQuote` + `switchboardQueue` + `slotHashes`.
 *
 * `tokenMint` is always required. `buyerTokenAta` and `treasuryTokenAta`
 * default to the ATAs derived from `tokenMint` + the corresponding owner.
 */
export interface SubscriptionTokenPayment {
  tokenMint: Address;
  /** Buyer's ATA for `tokenMint`. Derived from owner if omitted. */
  buyerTokenAta?: Address;
  /** Treasury wallet's ATA for `tokenMint`. Derived from treasury if omitted. */
  treasuryTokenAta?: Address;
  /** Pyth path: SOL/USD PriceUpdateV2. */
  solPythFeed?: Address;
  /** Pyth path: TOKEN/USD PriceUpdateV2. */
  tokenPythFeed?: Address;
  /** Switchboard path: program-owned OracleQuote PDA. */
  switchboardQuote?: Address;
  /** Switchboard path: queue account. */
  switchboardQueue?: Address;
  /** Switchboard path: SlotHashes sysvar. */
  slotHashes?: Address;
}

export interface PurchaseSubscriptionAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Payment authority for offchain payments (signer). Pass owner if not using offchain. */
  paymentAuthority: Address;
  /** Treasury wallet to receive SOL payments */
  treasury: Address;
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

/** PurchaseSubscription args: payment_type (u8) + new_tier_index (u8) */
const purchaseSubscriptionArgs = packed<{ paymentType: number; tier: number }>([
  ['paymentType', u8],
  ['tier', u8],
], 2);

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
export async function createPurchaseSubscriptionInstruction(
  accounts: PurchaseSubscriptionAccounts,
  params: PurchaseSubscriptionParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [user] = await deriveUserPda(accounts.owner);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by UserAccount PDA (not PlayerAccount)
  const userNoviAta = await getAssociatedTokenAddressSyncForPda(noviMint, user);

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
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  /*
   * TOKEN payment (paymentType === 2): append shop_config + the token-payment
   * account layout that `process_token_payment_flow` consumes. Order mirrors
   * `subscription/purchase.rs:307-335` — shop_config at slot 10, then
   * token_accounts[..] which the helper expects to read positionally.
   * Pegged-stablecoin tokens omit the trailing oracle accounts; the chain
   * branches on `AllowedTokenAccount.pegged_to_usd`.
   */
  if (params.paymentType === 2) {
    if (!accounts.tokenPayment) {
      throw new Error(
        'createPurchaseSubscriptionInstruction: paymentType=2 requires `tokenPayment` accounts',
      );
    }
    const tp = accounts.tokenPayment;
    const [shopConfig] = await deriveShopConfigPda(accounts.gameEngine);
    const [allowedToken] = await deriveAllowedTokenPda(accounts.gameEngine, tp.tokenMint);
    const buyerAta = tp.buyerTokenAta ?? await getAssociatedTokenAddressSync(tp.tokenMint, accounts.owner);
    const treasuryAta = tp.treasuryTokenAta ?? await getAssociatedTokenAddressSync(tp.tokenMint, accounts.treasury);

    keys.push(
      { pubkey: shopConfig, isSigner: false, isWritable: false },     /* [10] shop_config */
      { pubkey: allowedToken, isSigner: false, isWritable: false },   /* [11] allowed_token */
      { pubkey: tp.tokenMint, isSigner: false, isWritable: false },   /* [12] token_mint */
      { pubkey: buyerAta, isSigner: false, isWritable: true },        /* [13] buyer_token_ata */
      { pubkey: treasuryAta, isSigner: false, isWritable: true },     /* [14] treasury_token_ata */
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, /* [15] token_program (inner) */
    );

    if (tp.solPythFeed && tp.tokenPythFeed) {
      keys.push(
        { pubkey: tp.solPythFeed, isSigner: false, isWritable: false },   /* [16] sol PriceUpdateV2 */
        { pubkey: tp.tokenPythFeed, isSigner: false, isWritable: false }, /* [17] token PriceUpdateV2 */
      );
    } else if (tp.switchboardQuote && tp.switchboardQueue && tp.slotHashes) {
      keys.push(
        { pubkey: tp.switchboardQuote, isSigner: false, isWritable: false }, /* [16] oracle-quote PDA */
        { pubkey: tp.switchboardQueue, isSigner: false, isWritable: false }, /* [17] Switchboard queue */
        { pubkey: tp.slotHashes, isSigner: false, isWritable: false },        /* [18] SlotHashes sysvar */
      );
    }
    /* else: pegged path — no oracle accounts. */

    /*
     * Append the ATA program so `process_token_payment_flow`'s defensive
     * `create_associated_token_account` backstop can CPI the ATA program
     * when the treasury ATA doesn't exist. Appended last to keep positional
     * `&accounts[..]` reads in the on-chain processor unshifted.
     */
    keys.push({ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // Instruction data: payment_type (u8) + new_tier_index (u8)
  const data = createInstructionData(
    DISCRIMINATORS.SUBSCRIPTION_PURCHASE,
    purchaseSubscriptionArgs.encode({ paymentType: params.paymentType, tier: params.tier })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Tier Configuration (DAO ONLY)

export interface UpdateTierConfigAccounts {
  /** DAO governance authority (signer) */
  authority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
 * UpdateTierConfig args (257 bytes): tier_index (u8) + SubscriptionTier struct
 * (256 bytes, repr(C) with explicit alignment padding written inline).
 */
interface UpdateTierConfigArgs {
  outerTierIndex: number;
  name: string;
  tierIndex: number;
  costInUsdCents: bigint;
  durationDays: number;
  generationMultiplier: bigint;
  maxLockedNovi: bigint;
  dailyRewardMultiplier: bigint;
  synchronyBonus: number;
  novi: bigint;
  cash: bigint;
  du1: bigint;
  du2: bigint;
  du3: bigint;
  op1: bigint;
  op2: bigint;
  op3: bigint;
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  armor: bigint;
  produce: bigint;
  vehicles: bigint;
  reputation: bigint;
  xp: bigint;
  rallyMaxActiveRalliesJoined: number;
  rallyMaxRalliesCreatedPerDay: number;
  rallyMaxRallyTroopContribution: bigint;
  rallyMaxRallySize: number;
  rallyMaxRallyDurationSeconds: bigint;
  maxTeamMembers: number;
  maxDailyTransferAmount: bigint;
  maxDailyTransferCount: number;
  travelSpeedBonusBps: number;
}

const updateTierConfigArgs = packed<UpdateTierConfigArgs>([
  ['outerTierIndex', u8],
  // SubscriptionTier struct (256 bytes)
  ['name', fixedString(16)],
  ['tierIndex', u8],
  pad(7),
  ['costInUsdCents', u64],
  ['durationDays', u32],
  pad(4),
  ['generationMultiplier', u64],
  ['maxLockedNovi', u64],
  ['dailyRewardMultiplier', u64],
  ['synchronyBonus', u32],
  pad(4),
  ['novi', u64],
  ['cash', u64],
  ['du1', u64],
  ['du2', u64],
  ['du3', u64],
  ['op1', u64],
  ['op2', u64],
  ['op3', u64],
  ['meleeWeapons', u64],
  ['rangedWeapons', u64],
  ['siegeWeapons', u64],
  ['armor', u64],
  ['produce', u64],
  ['vehicles', u64],
  ['reputation', u64],
  ['xp', u64],
  ['rallyMaxActiveRalliesJoined', u8],
  ['rallyMaxRalliesCreatedPerDay', u8],
  pad(6),
  ['rallyMaxRallyTroopContribution', u64],
  ['rallyMaxRallySize', u8],
  pad(7),
  ['rallyMaxRallyDurationSeconds', i64],
  ['maxTeamMembers', u8],
  pad(7),
  ['maxDailyTransferAmount', u64],
  ['maxDailyTransferCount', u8],
  pad(3),
  ['travelSpeedBonusBps', u32],
], 257);

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
): Instruction {
  // Rust account order (2 accounts):
  // 0. game_engine (writable)
  // 1. authority (signer)
  const keys = [
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
  ];

  // Instruction data: tier_index (u8) + SubscriptionTier struct (256 bytes)
  const data = createInstructionData(
    DISCRIMINATORS.SUBSCRIPTION_UPDATE_TIER,
    updateTierConfigArgs.encode({
      outerTierIndex: tierConfig.tierIndex,
      name: tierConfig.name,
      tierIndex: tierConfig.tierIndex,
      costInUsdCents: BigInt(tierConfig.costInUsdCents),
      durationDays: tierConfig.durationDays,
      generationMultiplier: BigInt(tierConfig.generationMultiplier),
      maxLockedNovi: BigInt(tierConfig.maxLockedNovi),
      dailyRewardMultiplier: BigInt(tierConfig.dailyRewardMultiplier),
      synchronyBonus: tierConfig.synchronyBonus,
      novi: BigInt(tierConfig.novi),
      cash: BigInt(tierConfig.cash),
      du1: BigInt(tierConfig.du1),
      du2: BigInt(tierConfig.du2),
      du3: BigInt(tierConfig.du3),
      op1: BigInt(tierConfig.op1),
      op2: BigInt(tierConfig.op2),
      op3: BigInt(tierConfig.op3),
      meleeWeapons: BigInt(tierConfig.meleeWeapons),
      rangedWeapons: BigInt(tierConfig.rangedWeapons),
      siegeWeapons: BigInt(tierConfig.siegeWeapons),
      armor: BigInt(tierConfig.armor),
      produce: BigInt(tierConfig.produce),
      vehicles: BigInt(tierConfig.vehicles),
      reputation: BigInt(tierConfig.reputation),
      xp: BigInt(tierConfig.xp),
      rallyMaxActiveRalliesJoined: tierConfig.rallyCaps.maxActiveRalliesJoined,
      rallyMaxRalliesCreatedPerDay: tierConfig.rallyCaps.maxRalliesCreatedPerDay,
      rallyMaxRallyTroopContribution: BigInt(tierConfig.rallyCaps.maxRallyTroopContribution),
      rallyMaxRallySize: tierConfig.rallyCaps.maxRallySize,
      rallyMaxRallyDurationSeconds: BigInt(tierConfig.rallyCaps.maxRallyDurationSeconds),
      maxTeamMembers: tierConfig.maxTeamMembers,
      maxDailyTransferAmount: BigInt(tierConfig.maxDailyTransferAmount),
      maxDailyTransferCount: tierConfig.maxDailyTransferCount,
      travelSpeedBonusBps: tierConfig.travelSpeedBonusBps,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
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
  playerAccount: Address;
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
): Instruction {
  const keys = [
    { pubkey: accounts.playerAccount, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.SUBSCRIPTION_DOWNGRADE_EXPIRED);

  return buildInstruction(PROGRAM_ID, keys, data);
}

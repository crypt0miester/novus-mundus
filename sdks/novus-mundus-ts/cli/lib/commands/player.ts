/**
 * player command — Manage existing players (fund, travel)
 *
 * Usage:
 *   novus player fund <pubkey> --novi 100000     # Fund player with NOVI
 *   novus player travel <pubkey> --city 5        # Teleport player to city
 */

import { PublicKey } from '@solana/web3.js';

import type { CLIContext, ParsedArgs } from '../context';
import { loadKeypair } from '../context';
import { sendWithRetry, accountExists, log } from '../helpers';
import { CITIES } from '../../data/cities';

import {
  createMintForPrizeInstruction,
  MintPurpose,
  createPurchaseItemInstruction,
  createHireUnitsInstruction,
  createReservedToLockedInstruction,
  createIntercityTeleportInstruction,
  createDepositNoviInstruction,
  createTreasurySweepUntrackedNoviInstruction,
  SweepKind,
  DEPOSIT_FEE_BPS,
  derivePlayerPda,
  deriveCityPda,
  deriveLocationPda,
  deriveNoviMintPda,
  getAssociatedTokenAddressAsync,
  deserializePlayer,
} from '../../../src/index';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';

const GRID_PRECISION = 10000;

export async function handlePlayer(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'fund':
      await handleFund(ctx, args);
      break;
    case 'travel':
      await handleTravel(ctx, args);
      break;
    case 'deposit':
      await handleDeposit(ctx, args);
      break;
    case 'sweep':
      await handleSweep(ctx, args);
      break;
    case 'buy-gems':
      await handleBuyGems(ctx, args);
      break;
    case 'hire':
      await handleHire(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus player <fund|travel|deposit|sweep|buy-gems|hire> <pubkey|keypair-path> [options]');
  }
}

// buy-gems — purchase the gem pack (shop item 1, item_type 50). Gems pay for
// rally/travel/building speedups. There is no dedicated buy-gems instruction;
// the gem pack is a normal shop item bought with SOL. Each purchase grants the
// item's quantity_per_purchase (100 gems on the seeded item); --count sets how
// many packs to buy. Requires the player to have EXT_INVENTORY (any prior shop
// purchase or team join unlocks it).

const GEMS_ITEM_ID = 1;

async function handleBuyGems(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const keypairPath = args.extra;
  if (!keypairPath) {
    log.error('Specify the buyer keypair path as third argument (purchase requires the buyer signature)');
    log.info('  novus player buy-gems <keypair> [--count <n>]');
    return;
  }
  const buyer = await loadKeypair(keypairPath);

  const countFlag = getFlag(args.flags, '--count');
  const count = countFlag ? parseInt(countFlag, 10) : 1;
  if (isNaN(count) || count <= 0) {
    log.error('Invalid --count (number of gem packs to buy)');
    return;
  }

  const [playerPda] = await derivePlayerPda(ctx.gameEngine, buyer.publicKey);
  if (!await accountExists(ctx.connection, playerPda)) {
    log.error(`Player account not found for ${buyer.publicKey.toBase58()}`);
    return;
  }

  const ix = createPurchaseItemInstruction(
    {
      buyer: buyer.publicKey,
      gameEngine: ctx.gameEngine,
      itemId: GEMS_ITEM_ID,
      treasury: ctx.treasury.publicKey,
    },
    { quantity: count },
  );

  await sendWithRetry(ctx, ix, [buyer], { computeUnits: 60_000 });
  log.info(`  Bought ${count} gem pack(s) (item ${GEMS_ITEM_ID}) for ${buyer.publicKey.toBase58()}`);
  log.info(`  Check the new balance with: novus show player ${buyer.publicKey.toBase58()}`);
}

// fund

async function handleFund(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const noviFlag = getFlag(args.flags, '--novi');
  if (!noviFlag) {
    log.error('Specify --novi <amount>');
    return;
  }

  const amount = parseInt(noviFlag, 10);
  if (isNaN(amount) || amount <= 0) {
    log.error('Invalid --novi amount');
    return;
  }

  const recipientOwner = await resolvePlayer(args.extra);
  if (!recipientOwner) {
    log.error('Specify player pubkey or keypair path as third argument');
    return;
  }

  const [playerPda] = await derivePlayerPda(ctx.gameEngine, recipientOwner);
  if (!await accountExists(ctx.connection, playerPda)) {
    log.error(`Player account not found for ${recipientOwner.toBase58()}`);
    return;
  }

  /* Fund as DAO ops. After mint_for_prize's internal/external split:
   *   - Prize + Event mint to the player's UserAccount reserved ATA
   *     (player must later call reserved_to_locked themselves to spend).
   *   - All other purposes mint directly to the player's wallet ATA
   *     (player can deposit_novi back to reserved or trade on DEX).
   *
   * We don't have the player's keypair, so we can't drive deposit_novi
   * here — the DAO can only deliver NOVI to one of those two
   * destinations and the player follows up. */
  const MAX_PER_CALL = 100_000_000;
  const purposes: { purpose: MintPurpose; cap: number }[] = [
    { purpose: MintPurpose.Development, cap: 150_000_000 },
    { purpose: MintPurpose.Liquidity,   cap: 200_000_000 },
    { purpose: MintPurpose.Marketing,   cap: 100_000_000 },
    { purpose: MintPurpose.Partnership, cap: 50_000_000 },
    { purpose: MintPurpose.Treasury,    cap: 50_000_000 },
    { purpose: MintPurpose.Prize,       cap: 50_000_000 },
  ];

  const isExternal = (p: MintPurpose) =>
    p !== MintPurpose.Prize && p !== MintPurpose.Event;

  /* External mints land in the recipient's wallet ATA. Pre-create it
   * idempotently with DAO as payer so the MintTo CPI doesn't reject on
   * uninitialized destination. Only emitted if any external purpose
   * will run. */
  if (purposes.some((p) => isExternal(p.purpose))) {
    const [noviMint] = await deriveNoviMintPda();
    const walletAta = await getAssociatedTokenAddressAsync(noviMint, recipientOwner);
    const ataPrep = createAssociatedTokenAccountIdempotentInstruction(
      ctx.daoAuthority.publicKey,
      walletAta,
      recipientOwner,
      noviMint,
    );
    await sendWithRetry(ctx, ataPrep, [ctx.daoAuthority]);
  }

  let remaining = amount;
  let intoReserved = 0;
  let intoWallet = 0;
  for (const { purpose, cap } of purposes) {
    if (remaining <= 0) break;
    let allocated = 0;
    while (allocated < cap && remaining > 0) {
      const thisAmount = Math.min(MAX_PER_CALL, cap - allocated, remaining);

      const mintIx = createMintForPrizeInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          recipientOwner,
        },
        { amount: BigInt(thisAmount), purpose }
      );
      await sendWithRetry(ctx, mintIx, [ctx.daoAuthority]);

      if (isExternal(purpose)) intoWallet += thisAmount;
      else intoReserved += thisAmount;

      allocated += thisAmount;
      remaining -= thisAmount;
    }
  }

  log.info(`  Funded ${amount.toLocaleString()} NOVI for ${recipientOwner.toBase58()}`);
  if (intoReserved > 0) {
    log.info(`    ${intoReserved.toLocaleString()} → reserved (player must reservedToLocked to spend)`);
  }
  if (intoWallet > 0) {
    log.info(`    ${intoWallet.toLocaleString()} → wallet ATA (player can depositNovi or trade)`);
  }
}

// travel

async function handleTravel(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const cityFlag = getFlag(args.flags, '--city');
  if (!cityFlag) {
    log.error('Specify --city <id>');
    return;
  }

  const destCityId = parseInt(cityFlag, 10);
  const destCity = CITIES.find(c => c.id === destCityId);
  if (!destCity) {
    log.error(`City ${destCityId} not found`);
    return;
  }

  // Travel requires the player's keypair (must sign teleport)
  const keypairPath = args.extra;
  if (!keypairPath) {
    log.error('Specify keypair path as third argument (travel requires signature)');
    return;
  }

  const playerKeypair = await loadKeypair(keypairPath);
  const [playerPda] = await derivePlayerPda(ctx.gameEngine, playerKeypair.publicKey);

  const playerInfo = await ctx.connection.getAccountInfo(playerPda);
  if (!playerInfo) {
    log.error(`Player account not found for ${playerKeypair.publicKey.toBase58()}`);
    return;
  }

  const player = deserializePlayer(playerInfo.data);
  const originCityId = player.currentCity;

  if (originCityId === destCityId) {
    log.info(`  Player already in city ${destCityId}`);
    return;
  }

  const originCity = CITIES.find(c => c.id === originCityId);
  if (!originCity) {
    log.error(`Origin city ${originCityId} not found in data`);
    return;
  }

  // Derive location PDAs
  const originGridLat = Math.round(originCity.lat * GRID_PRECISION);
  const originGridLong = Math.round(originCity.lon * GRID_PRECISION);
  const destGridLat = Math.round(destCity.lat * GRID_PRECISION);
  const destGridLong = Math.round(destCity.lon * GRID_PRECISION);

  const [originLocation] = await deriveLocationPda(ctx.gameEngine, originCityId, originGridLat, originGridLong);
  const [destLocation] = await deriveLocationPda(ctx.gameEngine, destCityId, destGridLat, destGridLong);

  const ix = createIntercityTeleportInstruction({
    owner: playerKeypair.publicKey,
    gameEngine: ctx.gameEngine,
    originCityId,
    destinationCityId: destCityId,
    originLocation,
    destinationLocation: destLocation,
  });

  await sendWithRetry(ctx, ix, [playerKeypair]);
  log.info(`  Teleported: ${originCity.name} (${originCityId}) → ${destCity.name} (${destCityId})`);
}

// deposit — wallet NOVI → reserved (5% fee burned)

async function handleDeposit(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const amountFlag = getFlag(args.flags, '--amount');
  if (!amountFlag) {
    log.error('Specify --amount <n>');
    return;
  }
  const amount = parseInt(amountFlag, 10);
  if (isNaN(amount) || amount <= 0) {
    log.error('Invalid --amount');
    return;
  }

  const keypairPath = args.extra;
  if (!keypairPath) {
    log.error('Specify wallet keypair path as third argument (deposit requires signature)');
    return;
  }
  const wallet = await loadKeypair(keypairPath);

  const fee = Math.floor((amount * DEPOSIT_FEE_BPS) / 10_000);
  const credited = amount - fee;

  const ix = createDepositNoviInstruction(
    { owner: wallet.publicKey },
    { amount: BigInt(amount) }
  );

  await sendWithRetry(ctx, ix, [wallet]);
  log.info(`  Deposited ${amount.toLocaleString()} NOVI → ${credited.toLocaleString()} credited`);
  log.info(`  Fee burned: ${fee.toLocaleString()} NOVI (${DEPOSIT_FEE_BPS / 100}%)`);
}

// sweep — wallet recovers its own untracked NOVI surplus from a PDA-owned ATA

async function handleSweep(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kindFlag = getFlag(args.flags, '--kind');
  if (kindFlag !== 'user' && kindFlag !== 'player') {
    log.error('Specify --kind <user|player>');
    return;
  }

  const keypairPath = args.extra;
  if (!keypairPath) {
    log.error('Specify wallet keypair path as third argument (sweep requires signature from the PDA owner)');
    return;
  }
  const wallet = await loadKeypair(keypairPath);
  const kind = kindFlag === 'user' ? SweepKind.User : SweepKind.Player;

  const ix = createTreasurySweepUntrackedNoviInstruction(
    { owner: wallet.publicKey },
    { kind, gameEngine: kind === SweepKind.Player ? ctx.gameEngine : undefined }
  );

  await sendWithRetry(ctx, ix, [wallet]);
  log.info(`  Swept ${kindFlag} PDA surplus → wallet ATA`);
  log.info(`  (ix returns silently if no surplus to recover — check your wallet balance)`);
}

// hire — buy military units with the player's locked NOVI. Defensive units
// (unit-type 0/1/2) are what a rally commits; a Citadel-owner whose units are
// locked in a stuck rally can re-arm this way. Requires a Barracks (capacity)
// and that the passed cityId matches the player's current city (the chain
// validates city_id == player.current_city), so we read it from the account.

async function handleHire(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const keypairPath = args.extra;
  if (!keypairPath) {
    log.error('Specify the player keypair path as third argument (hire requires the owner signature)');
    log.info('  novus player hire <keypair> --unit-type <0-5> --novi <amount>');
    return;
  }
  const owner = await loadKeypair(keypairPath);

  const unitType = parseInt(getFlag(args.flags, '--unit-type') || '0', 10);
  if (isNaN(unitType) || unitType < 0 || unitType > 5) {
    log.error('Invalid --unit-type (0-2 = defensive tiers, 3-5 = operative tiers)');
    return;
  }
  const noviFlag = getFlag(args.flags, '--novi');
  if (!noviFlag) {
    log.error('Specify --novi <amount of locked NOVI to spend>');
    return;
  }
  const noviAmount = parseInt(noviFlag, 10);
  if (isNaN(noviAmount) || noviAmount <= 0) {
    log.error('Invalid --novi amount');
    return;
  }

  const [playerPda] = await derivePlayerPda(ctx.gameEngine, owner.publicKey);
  const playerInfo = await ctx.connection.getAccountInfo(playerPda);
  if (!playerInfo) {
    log.error(`Player account not found for ${owner.publicKey.toBase58()}`);
    return;
  }
  const player = deserializePlayer(playerInfo.data);
  const cityId = player.currentCity;

  const ix = createHireUnitsInstruction(
    { owner: owner.publicKey, gameEngine: ctx.gameEngine },
    { unitType, noviAmount },
  );

  await sendWithRetry(ctx, ix, [owner], { computeUnits: 100_000 });
  log.info(`  Hired unit-type ${unitType} for ${noviAmount.toLocaleString()} NOVI (city ${cityId})`);
  log.info(`  Check with: novus show player ${owner.publicKey.toBase58()}`);
}

// helpers

async function resolvePlayer(extra: string): Promise<PublicKey | null> {
  if (!extra) return null;
  try {
    return new PublicKey(extra);
  } catch {
    // Not a pubkey, might be a keypair path
    try {
      const kp = await loadKeypair(extra);
      return kp.publicKey;
    } catch {
      return null;
    }
  }
}

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}

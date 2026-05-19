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
  createReservedToLockedInstruction,
  createIntercityTeleportInstruction,
  derivePlayerPda,
  deriveCityPda,
  deriveLocationPda,
  deserializePlayer,
} from '../../../src/index';

const GRID_PRECISION = 10000;

export async function handlePlayer(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'fund':
      await handleFund(ctx, args);
      break;
    case 'travel':
      await handleTravel(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus player <fund|travel> <pubkey|keypair-path> [options]');
  }
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

  const recipientOwner = resolvePlayer(args.extra);
  if (!recipientOwner) {
    log.error('Specify player pubkey or keypair path as third argument');
    return;
  }

  const [playerPda] = await derivePlayerPda(ctx.gameEngine, recipientOwner);
  if (!await accountExists(ctx.connection, playerPda)) {
    log.error(`Player account not found for ${recipientOwner.toBase58()}`);
    return;
  }

  // Fund using DAO mint + convert
  const MAX_PER_CALL = 100_000_000;
  const purposes: { purpose: MintPurpose; cap: number }[] = [
    { purpose: MintPurpose.Development, cap: 150_000_000 },
    { purpose: MintPurpose.Liquidity,   cap: 200_000_000 },
    { purpose: MintPurpose.Marketing,   cap: 100_000_000 },
    { purpose: MintPurpose.Partnership, cap: 50_000_000 },
    { purpose: MintPurpose.Treasury,    cap: 50_000_000 },
    { purpose: MintPurpose.Prize,       cap: 50_000_000 },
  ];

  let remaining = amount;
  for (const { purpose, cap } of purposes) {
    if (remaining <= 0) break;
    let allocated = 0;
    while (allocated < cap && remaining > 0) {
      const thisAmount = Math.min(MAX_PER_CALL, cap - allocated, remaining);

      const mintIx = await createMintForPrizeInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          recipientOwner,
        },
        { amount: BigInt(thisAmount), purpose }
      );
      await sendWithRetry(ctx, mintIx, [ctx.daoAuthority]);

      // Convert reserved -> locked requires player signature
      // For fund command, we only mint to reserved (DAO-side operation)
      // The player must convert separately unless we have their keypair
      allocated += thisAmount;
      remaining -= thisAmount;
    }
  }

  log.info(`  Minted ${amount.toLocaleString()} NOVI to reserved for ${recipientOwner.toBase58()}`);
  log.info('  Player must call reservedToLocked to convert to usable NOVI.');
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

  const playerKeypair = loadKeypair(keypairPath);
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

  const ix = await createIntercityTeleportInstruction({
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

// helpers

function resolvePlayer(extra: string): PublicKey | null {
  if (!extra) return null;
  try {
    return new PublicKey(extra);
  } catch {
    // Not a pubkey, might be a keypair path
    try {
      const kp = loadKeypair(extra);
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

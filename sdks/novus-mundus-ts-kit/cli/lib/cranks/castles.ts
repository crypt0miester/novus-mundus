/**
 * Crank: Castles — status transitions + full transition pipeline
 *
 * For each castle:
 * 1. Update status (Ix 289) — permissionless, no-op if not time
 * 2. If TRANSITIONING, run cleanup pipeline:
 *    a. Garrison cleanup (Ix 282)
 *    b. Court cleanup (Ix 283)
 *    c. Rewards cleanup (Ix 284)
 *    d. Finalize transition (Ix 285)
 */

import { PublicKey } from '@solana/web3.js';
import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, accountExists, type PhaseStats } from '../helpers';
import { CASTLES } from '../../data/castles';
import { PROGRAM_ID } from '../../../src/program';
import { deriveCastlePda, deriveCourtPda, derivePlayerPda } from '../../../src/pda';
import {
  createUpdateCastleStatusInstruction,
  createGarrisonCleanupInstruction,
  createCourtCleanupInstruction,
  createRewardsCleanupInstruction,
  createFinalizeTransitionInstruction,
} from '../../../src/instructions/castle';

/** Castle status enum values (from on-chain) */
const CASTLE_STATUS = {
  VACANT: 0,
  PROTECTED: 1,
  VULNERABLE: 2,
  CONTEST: 3,
  TRANSITIONING: 4,
} as const;

export async function crankCastles(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  log.info(`  Processing ${CASTLES.length} castles...`);

  for (const castle of CASTLES) {
    const [castlePda] = await deriveCastlePda(ctx.gameEngine, castle.cityId, castle.castleId);

    // Step 1: Update status (permissionless, no-op if not time)
    const statusIx = await createUpdateCastleStatusInstruction({
      caller: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
      cityId: castle.cityId,
      castleId: castle.castleId,
    });

    if (ctx.dryRun) {
      log.dryRun(`Would update status: ${castle.name}`);
      stats.updated++;
      continue;
    }

    try {
      await sendWithRetry(ctx, statusIx, [ctx.daoAuthority]);
      if (ctx.verbose) log.update(`Status update: ${castle.name}`);
    } catch (err: any) {
      // No-op failures are expected (status didn't change)
      if (ctx.verbose) log.info(`  Status unchanged: ${castle.name}`);
    }

    // Fetch castle account to check if TRANSITIONING
    const accountInfo = await ctx.connection.getAccountInfo(castlePda);
    if (!accountInfo) {
      stats.skipped++;
      continue;
    }

    const data = accountInfo.data;
    // CastleAccount layout (approximate):
    //   0-7: discriminator (8)
    //   8-39: game_engine (32)
    //   40-41: city_id (u16)
    //   42-43: castle_id (u16)
    //   44: status (u8)
    //   45-76: king (32 bytes — Pubkey, zero if vacant)
    //   77-108: pending_king (32 bytes — Pubkey for transition)
    //   109: garrison_count (u8)
    //   110: court_count (u8)
    //   111: reward_count (u8)
    const STATUS_OFFSET = 44;
    const KING_OFFSET = 45;
    const PENDING_KING_OFFSET = 77;
    const GARRISON_COUNT_OFFSET = 109;
    const COURT_COUNT_OFFSET = 110;
    const REWARD_COUNT_OFFSET = 111;

    if (data.length < REWARD_COUNT_OFFSET + 1) {
      stats.skipped++;
      continue;
    }

    const status = data[STATUS_OFFSET];

    if (status !== CASTLE_STATUS.TRANSITIONING) {
      stats.skipped++;
      continue;
    }

    log.info(`  ${castle.name} is TRANSITIONING — running cleanup pipeline`);

    const garrisonCount = data[GARRISON_COUNT_OFFSET];
    const courtCount = data[COURT_COUNT_OFFSET];
    const rewardCount = data[REWARD_COUNT_OFFSET];

    // Step 2a: Garrison cleanup — find garrison PDAs via getProgramAccounts
    if (garrisonCount > 0) {
      log.info(`    Cleaning up ${garrisonCount} garrison(s)...`);
      // Find garrison accounts for this castle using getProgramAccounts
      const garrisonAccounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [
          // Filter by castle pubkey at the expected offset in garrison data
          { memcmp: { offset: 8, bytes: castlePda.toBase58() } },
          { dataSize: 200 }, // GarrisonAccount approximate size
        ],
      });

      for (const garrison of garrisonAccounts) {
        // Extract the member's wallet from garrison data
        // GarrisonAccount: discriminator(8) + castle(32) + player(32) + owner(32) ...
        const memberPlayer = new PublicKey(garrison.account.data.subarray(40, 72));
        const memberWallet = new PublicKey(garrison.account.data.subarray(72, 104));

        const cleanupIx = await createGarrisonCleanupInstruction({
          payer: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          cityId: castle.cityId,
          castleId: castle.castleId,
          garrisonMember: memberWallet,
        });

        try {
          await sendWithRetry(ctx, cleanupIx, [ctx.daoAuthority]);
          log.update(`  Garrison cleanup: ${memberWallet.toBase58().slice(0, 8)}...`);
          stats.updated++;
        } catch (err: any) {
          log.error(`  Garrison cleanup failed: ${err.message}`);
          stats.skipped++;
        }
      }
    }

    // Step 2b: Court cleanup — positions 0-4
    if (courtCount > 0) {
      log.info(`    Cleaning up ${courtCount} court position(s)...`);
      for (let position = 0; position < 5; position++) {
        const [courtPda] = await deriveCourtPda(castlePda, position);
        const courtExists = await accountExists(ctx.connection, courtPda);
        if (!courtExists) continue;

        // Read court account to get holder
        const courtInfo = await ctx.connection.getAccountInfo(courtPda);
        if (!courtInfo) continue;

        // CourtAccount: discriminator(8) + castle(32) + position(1) + holder(32)
        const holderWallet = new PublicKey(courtInfo.data.subarray(41, 73));

        const cleanupIx = await createCourtCleanupInstruction(
          {
            payer: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            cityId: castle.cityId,
            castleId: castle.castleId,
            holder: holderWallet,
          },
          { position }
        );

        try {
          await sendWithRetry(ctx, cleanupIx, [ctx.daoAuthority]);
          log.update(`  Court cleanup: position ${position}`);
          stats.updated++;
        } catch (err: any) {
          log.error(`  Court cleanup position ${position} failed: ${err.message}`);
          stats.skipped++;
        }
      }
    }

    // Step 2c: Rewards cleanup — find TeamCastleReward accounts
    if (rewardCount > 0) {
      log.info(`    Cleaning up ${rewardCount} reward account(s)...`);
      const rewardAccounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [
          { memcmp: { offset: 8, bytes: castlePda.toBase58() } },
          { dataSize: 128 }, // TeamCastleRewardAccount approximate size
        ],
      });

      for (const reward of rewardAccounts) {
        // TeamCastleRewardAccount: discriminator(8) + castle(32) + player(32) + member_wallet(32)
        const memberWallet = new PublicKey(reward.account.data.subarray(72, 104));

        const cleanupIx = await createRewardsCleanupInstruction({
          payer: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          cityId: castle.cityId,
          castleId: castle.castleId,
          member: memberWallet,
        });

        try {
          await sendWithRetry(ctx, cleanupIx, [ctx.daoAuthority]);
          log.update(`  Rewards cleanup: ${memberWallet.toBase58().slice(0, 8)}...`);
          stats.updated++;
        } catch (err: any) {
          log.error(`  Rewards cleanup failed: ${err.message}`);
          stats.skipped++;
        }
      }
    }

    // Step 2d: Finalize transition — re-fetch castle to check cleanup is done
    const updatedInfo = await ctx.connection.getAccountInfo(castlePda);
    if (!updatedInfo) continue;

    const updatedData = updatedInfo.data;
    const updatedGarrison = updatedData[GARRISON_COUNT_OFFSET];
    const updatedCourt = updatedData[COURT_COUNT_OFFSET];
    const updatedReward = updatedData[REWARD_COUNT_OFFSET];

    if (updatedGarrison === 0 && updatedCourt === 0 && updatedReward === 0) {
      // Extract new king from pending_king field
      const newKingBytes = updatedData.subarray(PENDING_KING_OFFSET, PENDING_KING_OFFSET + 32);
      const newKing = new PublicKey(newKingBytes);
      const isZero = newKingBytes.every(b => b === 0);

      if (isZero) {
        log.info(`    No pending king — skipping finalize`);
        continue;
      }

      // Check if there's an old king
      const oldKingBytes = updatedData.subarray(KING_OFFSET, KING_OFFSET + 32);
      const oldKingIsZero = oldKingBytes.every(b => b === 0);
      const oldKing = oldKingIsZero ? undefined : new PublicKey(oldKingBytes);

      const finalizeIx = await createFinalizeTransitionInstruction({
        payer: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        cityId: castle.cityId,
        castleId: castle.castleId,
        newKing,
        oldKing,
      });

      try {
        await sendWithRetry(ctx, finalizeIx, [ctx.daoAuthority]);
        log.update(`  Finalized transition: ${castle.name}`);
        stats.updated++;
      } catch (err: any) {
        log.error(`  Finalize transition failed for ${castle.name}: ${err.message}`);
        stats.skipped++;
      }
    } else {
      log.info(`    Cleanup not complete yet (garrison=${updatedGarrison}, court=${updatedCourt}, reward=${updatedReward})`);
      stats.skipped++;
    }
  }

  return stats;
}

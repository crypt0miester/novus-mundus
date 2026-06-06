/**
 * Crank: Subscriptions - downgrade expired subscriptions to free tier (Ix 102)
 *
 * Scans PlayerAccounts via getProgramAccounts (filtered by the SDK CORE_SIZE
 * constant), parses each with the SDK deserializer, and downgrades any whose
 * subscription window has closed. Permissionless: anyone may call it.
 *
 * Prior versions filtered by `dataSize: 776` and read the tier/end at guessed
 * offsets - the real PlayerAccount is CORE_SIZE (528) bytes, so the filter
 * matched nothing. Always size/parse via the SDK.
 */

import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import { createDowngradeExpiredInstruction } from '../../../src/instructions/subscription';
import { deserializePlayer, CORE_SIZE } from '../../../src/state/player';

const CONCURRENCY = 4;

export async function crankSubscriptions(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const now = Math.floor(Date.now() / 1000);

  log.info('  Fetching player accounts...');
  const accounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: CORE_SIZE }],
  });
  log.info(`  Found ${accounts.length} player accounts`);

  const expired = accounts.filter(({ account }) => {
    let player;
    try {
      player = deserializePlayer(account.data);
    } catch {
      return false;
    }
    // tier > 0 (has a paid tier) and the window has closed.
    return player.subscriptionTier > 0 && Number(player.subscriptionEnd) <= now;
  });

  log.info(`  ${expired.length} expired subscriptions to downgrade`);
  if (expired.length === 0) {
    stats.skipped = accounts.length;
    return stats;
  }

  for (let i = 0; i < expired.length; i += CONCURRENCY) {
    const batch = expired.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async ({ pubkey }) => {
      const ix = createDowngradeExpiredInstruction({ playerAccount: pubkey });
      if (ctx.dryRun) {
        log.dryRun(`Would downgrade: ${pubkey.toBase58().slice(0, 8)}..`);
        stats.updated++;
        return;
      }
      try {
        await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
        log.update(`Downgraded: ${pubkey.toBase58().slice(0, 8)}..`);
        stats.updated++;
      } catch (err: any) {
        log.error(`Failed to downgrade ${pubkey.toBase58().slice(0, 8)}..: ${err.message}`);
        stats.skipped++;
      }
    }));
  }

  return stats;
}

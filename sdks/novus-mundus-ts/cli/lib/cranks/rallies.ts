/**
 * Crank: Rallies - close completed/cancelled rallies once everyone is home (Ix 67)
 *
 * Fetches RallyAccounts via getProgramAccounts (filtered by the SDK size
 * constant), parses them with the SDK deserializer, and closes any that are
 * Completed/Cancelled with all participants returned. Rent returns to the leader.
 *
 * Prior versions filtered by `dataSize: 400` and read fields at guessed offsets
 * - the real RallyAccount is 368 bytes, so the filter matched nothing. Always
 * size/parse via the SDK.
 *
 * NOTE: this only CLOSES rallies (Ix 67). Per-participant `process_return`
 * (Ix 65), which returns loot/units to each member, is a separate permissionless
 * ix exposed as `novus rally process-return` - it is intentionally a member
 * action (loot routing) rather than a blind sweep, so it is not cranked here.
 */

import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import { createRallyCloseInstruction } from '../../../src/instructions/rally';
import { deserializeRally, RALLY_ACCOUNT_SIZE } from '../../../src/state/rally';
import { RallyStatus } from '../../../src/types/enums';

export async function crankRallies(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  log.info('  Fetching rally accounts...');
  const accounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: RALLY_ACCOUNT_SIZE }],
  });
  log.info(`  Found ${accounts.length} rally accounts`);

  for (const { account, pubkey } of accounts) {
    let rally;
    try {
      rally = deserializeRally(account.data);
    } catch {
      stats.skipped++;
      continue;
    }

    const closeable =
      (rally.status === RallyStatus.Completed || rally.status === RallyStatus.Cancelled) &&
      rally.returnedCount >= rally.participantCount;
    if (!closeable) {
      stats.skipped++;
      continue;
    }

    const ix = createRallyCloseInstruction({ rally: pubkey, leaderOwner: rally.creator });

    if (ctx.dryRun) {
      log.dryRun(`Would close: Rally ${pubkey.toBase58().slice(0, 8)}..`);
      stats.updated++;
      continue;
    }

    try {
      await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
      log.update(`Closed: Rally ${pubkey.toBase58().slice(0, 8)}..`);
      stats.updated++;
    } catch (err: any) {
      log.error(`Failed to close rally ${pubkey.toBase58().slice(0, 8)}..: ${err.message}`);
      stats.skipped++;
    }
  }

  return stats;
}

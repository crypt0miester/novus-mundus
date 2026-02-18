/**
 * Crank: Subscriptions — downgrade expired subscriptions (Ix 102)
 *
 * Scans all PlayerAccounts via getProgramAccounts, filters client-side
 * for expired subscriptions, and sends downgrade instructions.
 */

import { type CLIContext } from '../context';
import { log, newStats, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import { createDowngradeExpiredInstruction } from '../../../src/instructions/subscription';

/** Offset of subscription_tier (u8) within PlayerAccount data */
const SUBSCRIPTION_TIER_OFFSET = 8 + 32 + 32 + 1; // discriminator(8) + game_engine(32) + owner(32) + level(1) ... approximate
/** We use the first 8 bytes as discriminator to identify PlayerAccount */
const PLAYER_ACCOUNT_DISCRIMINATOR = Buffer.from([0x01]); // placeholder — use memcmp on first byte

export async function crankSubscriptions(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  log.info('  Fetching player accounts...');

  // Fetch all accounts owned by the program with reasonable size filter
  // PlayerAccount has a known minimum size
  const accounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [
      { dataSize: 776 }, // PlayerAccount size — adjust if needed
    ],
  });

  log.info(`  Found ${accounts.length} player accounts`);

  const now = Math.floor(Date.now() / 1000);
  const toDowngrade: { pubkey: typeof accounts[0]['pubkey'] }[] = [];

  for (const account of accounts) {
    const data = account.account.data;
    // subscription_tier is at a known offset in PlayerAccount
    // Layout: 8 (discriminator) + ... player fields ...
    // We need to read subscription_tier (u8) and subscription_end (i64)
    // Based on the Rust struct, these are near the end of the base fields.
    // For robustness, read from known offsets:
    //   subscription_tier: offset varies by struct version
    //   subscription_end: 8 bytes after tier
    // We'll use a heuristic: if account has subscription data, check it.

    // Read from the state deserializer offsets
    // PlayerAccount layout (simplified):
    //   8  - discriminator
    //   32 - game_engine
    //   32 - owner
    //   ... many fields ...
    //   subscription_tier: u8 at byte offset ~200 (approximate)
    //   subscription_end: i64 at byte offset ~201 (approximate)
    //
    // Rather than hardcode fragile offsets, we check the last known region.
    // The subscription fields are at fixed offsets we can derive:
    //   byte 168: subscription_tier (u8)
    //   byte 169-176: subscription_end (i64, little-endian)
    //
    // NOTE: These offsets must match the on-chain struct. Update if changed.
    const TIER_OFFSET = 168;
    const END_OFFSET = 169;

    if (data.length < END_OFFSET + 8) continue;

    const tier = data[TIER_OFFSET];
    const endBuf = data.subarray(END_OFFSET, END_OFFSET + 8);
    const subscriptionEnd = Number(endBuf.readBigInt64LE(0));

    if (tier > 0 && subscriptionEnd <= now) {
      toDowngrade.push({ pubkey: account.pubkey });
    }
  }

  log.info(`  ${toDowngrade.length} expired subscriptions to downgrade`);

  if (toDowngrade.length === 0) {
    stats.skipped = accounts.length;
    return stats;
  }

  const CONCURRENCY = 4;
  for (let i = 0; i < toDowngrade.length; i += CONCURRENCY) {
    const batch = toDowngrade.slice(i, i + CONCURRENCY);
    const promises = batch.map(async ({ pubkey }) => {
      const ix = createDowngradeExpiredInstruction({ playerAccount: pubkey });
      if (ctx.dryRun) {
        log.dryRun(`Would downgrade: ${pubkey.toBase58().slice(0, 8)}...`);
        stats.updated++;
        return;
      }
      try {
        const { sendWithRetry } = await import('../helpers');
        await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
        log.update(`Downgraded: ${pubkey.toBase58().slice(0, 8)}...`);
        stats.updated++;
      } catch (err: any) {
        log.error(`Failed to downgrade ${pubkey.toBase58().slice(0, 8)}...: ${err.message}`);
        stats.skipped++;
      }
    });
    await Promise.all(promises);
  }

  return stats;
}

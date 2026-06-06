/**
 * Crank: Events — finalize events past end_time (Ix 82)
 *
 * Derives EventPDAs for known event IDs, fetches accounts,
 * filters for events that need finalizing, and sends finalize instructions.
 */

import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, accountExists, type PhaseStats } from '../helpers';
import { EVENTS } from '../../data/events';
import { deriveEventPda } from '../../../src/pda';
import { createFinalizeEventInstruction } from '../../../src/instructions/event';
import { deserializeEvent, EventStatus } from '../../../src/state/event';

export async function crankEvents(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const now = Math.floor(Date.now() / 1000);

  log.info(`  Checking ${EVENTS.length} known events...`);

  for (const event of EVENTS) {
    const [eventPda] = await deriveEventPda(ctx.gameEngine, event.eventId);

    const exists = await accountExists(ctx.connection, eventPda);
    if (!exists) {
      log.skip(`Event ${event.eventId} (${event.name}) [not created]`);
      stats.skipped++;
      continue;
    }

    // Fetch event account data to check status and end_time
    const accountInfo = await ctx.connection.getAccountInfo(eventPda);
    if (!accountInfo) {
      stats.skipped++;
      continue;
    }

    // Parse via the SDK deserializer (single source of truth) rather than
    // hand-typed byte offsets, which drift when the on-chain struct changes.
    let parsed;
    try {
      parsed = deserializeEvent(accountInfo.data);
    } catch {
      stats.skipped++;
      continue;
    }
    const status = parsed.status;
    const endTime = Number(parsed.endTime);

    // Skip if already finalized or cancelled
    if (status === EventStatus.Finalized || status === EventStatus.Cancelled) {
      log.skip(`Event ${event.eventId} (${event.name}) [already finalized/cancelled]`);
      stats.skipped++;
      continue;
    }

    // Skip if not past end_time
    if (endTime > now) {
      log.skip(`Event ${event.eventId} (${event.name}) [not ended yet]`);
      stats.skipped++;
      continue;
    }

    // Finalize this event
    const ix = createFinalizeEventInstruction({
      gameEngine: ctx.gameEngine,
      eventId: event.eventId,
    });

    if (ctx.dryRun) {
      log.dryRun(`Would finalize: Event ${event.eventId} (${event.name})`);
      stats.updated++;
      continue;
    }

    try {
      await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
      log.update(`Finalized: Event ${event.eventId} (${event.name})`);
      stats.updated++;
    } catch (err: any) {
      log.error(`Failed to finalize Event ${event.eventId}: ${err.message}`);
      stats.skipped++;
    }
  }

  return stats;
}

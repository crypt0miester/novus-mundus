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

export async function crankEvents(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const now = Math.floor(Date.now() / 1000);

  log.info(`  Checking ${EVENTS.length} known events...`);

  for (const event of EVENTS) {
    const [eventPda] = deriveEventPda(ctx.gameEngine, event.eventId);

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

    const data = accountInfo.data;
    // EventAccount layout (approximate offsets):
    //   8  - discriminator
    //   32 - game_engine
    //   8  - event_id (u64)
    //   ... name (variable) ...
    //   status: u8
    //   end_time: i64
    //
    // Status values: 0=Created, 1=Active, 2=Finalized, 3=Cancelled
    // We need to check status and end_time.
    // For the event account, the structure is relatively fixed:
    //   byte 8+32+8 = 48: start of variable fields
    //
    // Since the exact layout depends on the Rust struct, we use
    // a conservative approach: read status byte and end_time.
    //
    // EventAccount layout:
    //   0-7: discriminator (8)
    //   8-39: game_engine (32)
    //   40-47: event_id (u64)
    //   48: status (u8)
    //   49-56: start_time (i64)
    //   57-64: end_time (i64)
    const STATUS_OFFSET = 48;
    const END_TIME_OFFSET = 57;

    if (data.length < END_TIME_OFFSET + 8) {
      stats.skipped++;
      continue;
    }

    const status = data[STATUS_OFFSET];
    const endTime = Number(data.readBigInt64LE(END_TIME_OFFSET));

    // Skip if already finalized (2) or cancelled (3)
    if (status === 2 || status === 3) {
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

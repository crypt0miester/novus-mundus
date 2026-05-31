/**
 * Phase 10 — Starter Events
 */

import { type CLIContext } from '../context';
import { createOrSkip, newStats, accountExists, type PhaseStats } from '../helpers';
import {
  createCreateEventInstruction,
  deriveEventPda,
  parseEvent,
} from '../../../src/index';
import { EVENTS } from '../../data/events';
import {
  section, table, bold, dim, green, red, yellow, formatNum, formatDate,
  check, statusBadge,
} from '../format';

export async function initEvents(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  const now = Math.floor(Date.now() / 1000);

  for (const event of EVENTS) {
    const [eventPda] = await deriveEventPda(ctx.gameEngine, event.eventId);

    const startTime = now;
    const endTime = now + event.durationDays * 86400;

    await createOrSkip(
      ctx,
      `Event #${event.eventId} (${event.name})`,
      eventPda,
      () => createCreateEventInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          eventId: event.eventId,
        },
        {
          name: event.name,
          startTime: BigInt(startTime),
          endTime: BigInt(endTime),
          eventType: event.eventType,
          minLevel: event.minLevel,
          minReputation: BigInt(event.minReputation),
          requiredSubscriptionTier: event.requiredSubscriptionTier,
          prizeType: event.prizeType,
          prizeAmount: BigInt(event.prizeAmount),
          autoActivate: event.autoActivate,
        }
      ),
      stats
    );
  }

  return stats;
}

export async function statusEvents(ctx: CLIContext): Promise<string> {
  let count = 0;
  let consecutiveMisses = 0;
  for (let id = 0; consecutiveMisses < 5; id++) {
    const [pda] = await deriveEventPda(ctx.gameEngine, id);
    if (await accountExists(ctx.connection, pda)) {
      count++;
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
    }
  }
  return `${count} events`;
}

const EVENT_STATUS = ['Pending', 'Active', 'Finalized', 'Cancelled'];
const PRIZE_TYPE = ['LockedNovi', 'Gems', 'Cash', 'SPLToken'];

export async function detailEvents(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Events — Kingdom ${ctx.kingdomId}`));

  const rows: string[][] = [];
  let consecutiveMisses = 0;
  for (let id = 0; consecutiveMisses < 5; id++) {
    const [pda] = await deriveEventPda(ctx.gameEngine, id);
    const info = await ctx.connection.getAccountInfo(pda);

    if (!info) {
      consecutiveMisses++;
      continue;
    }
    consecutiveMisses = 0;

    const data = parseEvent(info);
    if (data) {
      const status = EVENT_STATUS[data.status] ?? String(data.status);
      const statusColor = data.status === 1 ? green(status) :
                          data.status === 0 ? yellow(status) :
                          data.status === 3 ? red(status) : dim(status);
      rows.push([
        data.id.toString(),
        data.name || 'Event #' + data.id,
        statusColor,
        String(data.eventType),
        formatDate(data.startTime),
        formatDate(data.endTime),
        PRIZE_TYPE[data.prizeType] ?? String(data.prizeType),
        formatNum(data.prizeAmount),
        formatNum(data.prizeRemaining),
        String(data.participantCount),
      ]);
    } else {
      rows.push([
        String(id), 'Event #' + id, red('BAD DATA'),
        dim('--'), dim('--'), dim('--'),
        dim('--'), dim('--'), dim('--'), dim('--'),
      ]);
    }
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Name', width: 20 },
      { header: 'Status', width: 10 },
      { header: 'Type', align: 'right' },
      { header: 'Start', width: 16 },
      { header: 'End', width: 16 },
      { header: 'Prize', width: 10 },
      { header: 'Amount', align: 'right' },
      { header: 'Remaining', align: 'right' },
      { header: 'Players', align: 'right' },
    ],
    rows
  ));

  lines.push('');
  return lines.join('\n');
}

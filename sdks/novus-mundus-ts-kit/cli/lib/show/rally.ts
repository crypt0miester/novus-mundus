/**
 * show rally — List active rallies or show detailed rally state
 */

import { PublicKey } from '@solana/web3.js';
import type { NovusMundusClient } from '../../../src/client';
import type { CLIContext } from '../context';
import { log } from '../helpers';
import {
  table, section, addr, formatNum, formatDate, dim,
  type Column,
} from '../format';
import { CITIES } from '../../data/cities';
import { RallyStatus } from '../../../src/types/enums';
import {
  getParticipantTotalUnits,
  getParticipantTotalCasualties,
} from '../../../src/state/rally';

const STATUS_NAMES: Record<number, string> = {
  [RallyStatus.Gathering]: 'Gathering',
  [RallyStatus.Marching]: 'Marching',
  [RallyStatus.Combat]: 'Combat',
  [RallyStatus.Returning]: 'Returning',
  [RallyStatus.Completed]: 'Completed',
  [RallyStatus.Cancelled]: 'Cancelled',
};

function cityName(id: number): string {
  return CITIES.find(c => c.id === id)?.name ?? `City ${id}`;
}

export async function showAllRallies(client: NovusMundusClient, ctx: CLIContext): Promise<void> {
  const rallies = await client.fetchActiveRallies();

  log.info(section(`Rallies — Kingdom ${ctx.kingdomId} (${rallies.length} total)`));

  if (rallies.length === 0) {
    log.info(dim('  No rallies found.'));
    return;
  }

  const cols: Column[] = [
    { header: 'ID', align: 'right', width: 4 },
    { header: 'Creator' },
    { header: 'Target' },
    { header: 'Status', width: 10 },
    { header: 'Participants', align: 'right', width: 12 },
    { header: 'Power', align: 'right', width: 10 },
  ];

  const rows = rallies.map(({ account: r }) => [
    r.id.toString(),
    addr(r.creator),
    `${cityName(r.targetCity)} ${addr(r.target)}`,
    STATUS_NAMES[r.status] ?? `${r.status}`,
    `${r.participantCount}/${r.maxParticipants}`,
    formatNum(r.totalPower),
  ]);

  log.info(table(cols, rows));
}

export async function showRally(
  client: NovusMundusClient,
  ctx: CLIContext,
  creatorStr: string,
  flags: string[],
): Promise<void> {
  let creator: PublicKey;
  try {
    creator = new PublicKey(creatorStr);
  } catch {
    log.error(`Invalid creator public key: ${creatorStr}`);
    return;
  }

  // Rally ID comes from flags as the 4th positional arg is captured in flags
  const rallyIdIdx = flags.findIndex(f => !f.startsWith('--'));
  const rallyIdStr = rallyIdIdx >= 0 ? flags[rallyIdIdx] : undefined;
  if (!rallyIdStr) {
    log.error('Usage: novus show rally <creator-pubkey> <rally-id>');
    return;
  }
  const rallyId = parseInt(rallyIdStr, 10);
  if (isNaN(rallyId)) {
    log.error(`Invalid rally ID: ${rallyIdStr}`);
    return;
  }

  const result = await client.fetchRally(creator, rallyId);
  if (!result.exists || !result.account) {
    log.error(`Rally not found (creator=${addr(creator)}, id=${rallyId})`);
    return;
  }

  const r = result.account;

  log.info(`\nRally #${r.id.toString()}  (${STATUS_NAMES[r.status] ?? `Status ${r.status}`})`);
  log.info(`Creator: ${addr(r.creator)}    Team: ${addr(r.team)}`);

  log.info(section('Target'));
  log.info(`  City: ${cityName(r.targetCity)}    Target: ${addr(r.target)}`);

  log.info(section('Timing'));
  log.info(`  Created: ${formatDate(r.createdAt)}    Gather: ${formatDate(r.gatherAt)}    Execute: ${formatDate(r.executeAt)}`);
  if (r.marchStartedAt.toNumber() > 0) {
    log.info(`  March Started: ${formatDate(r.marchStartedAt)}    Arrive: ${formatDate(r.arriveAt)}`);
  }

  log.info(section('Forces'));
  log.info(`  Participants: ${r.participantCount}/${r.maxParticipants} (min ${r.minParticipants})    Total Power: ${formatNum(r.totalPower)}`);
  log.info(`  Units: ${formatNum(r.totalUnits)}    Weapons: ${formatNum(r.totalMeleeWeapons)}M / ${formatNum(r.totalRangedWeapons)}R / ${formatNum(r.totalSiegeWeapons)}S`);

  if (r.status >= RallyStatus.Returning) {
    log.info(section('Combat Results'));
    log.info(`  Casualties: ${formatNum(r.totalCasualties)}    Damage Dealt: ${formatNum(r.attackDamageDealt)}    Received: ${formatNum(r.defenseDamageReceived)}`);
    log.info(`  Winner: ${r.attackerWon ? 'Attacker' : 'Defender'}    Fallback: ${r.fallbackTriggered ? 'yes' : 'no'}`);
    log.info(`  Loot — Cash: ${formatNum(r.totalLootCash)}  NOVI: ${formatNum(r.totalLootLockedNovi)}  Weapons: ${formatNum(r.totalLootMelee)}/${formatNum(r.totalLootRanged)}/${formatNum(r.totalLootSiege)}`);
  }

  // Participants
  const participants = await client.fetchRallyParticipants(result.pubkey, r);
  if (participants.length > 0) {
    log.info(section('Participants'));
    const cols: Column[] = [
      { header: 'Player' },
      { header: 'Units', align: 'right', width: 8 },
      { header: 'Power', align: 'right', width: 8 },
      { header: 'Casualties', align: 'right', width: 10 },
      { header: 'Loot Cash', align: 'right', width: 10 },
      { header: 'Status', width: 8 },
    ];

    const rows = participants.map(({ account: p }) => [
      `${addr(p.participant)}${p.isLeader ? ' *' : ''}`,
      formatNum(getParticipantTotalUnits(p)),
      formatNum(p.contributionPower),
      formatNum(getParticipantTotalCasualties(p)),
      formatNum(p.lootCash),
      p.returned ? 'Returned' : p.includedInMarch ? 'Marched' : p.arrivedAtRally ? 'Arrived' : 'Traveling',
    ]);

    log.info(table(cols, rows));
  }

  log.info('');
}

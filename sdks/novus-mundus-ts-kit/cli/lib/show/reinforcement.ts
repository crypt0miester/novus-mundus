/**
 * show reinforcement — Show sent and received reinforcements for a player
 */

import { PublicKey } from '@solana/web3.js';
import type { NovusMundusClient } from '../../../src/client';
import type { CLIContext } from '../context';
import { log } from '../helpers';
import {
  table, section, addr, formatNum, formatDate, dim,
  type Column,
} from '../format';
import { ReinforcementStatus } from '../../../src/types/enums';
import {
  getReinforcementTotalUnits,
  getReinforcementTotalWeapons,
} from '../../../src/state/reinforcement';

const STATUS_NAMES: Record<number, string> = {
  [ReinforcementStatus.Traveling]: 'Traveling',
  [ReinforcementStatus.Active]: 'Active',
  [ReinforcementStatus.Returning]: 'Returning',
  [ReinforcementStatus.Completed]: 'Completed',
};

const cols: Column[] = [
  { header: 'Direction', width: 9 },
  { header: 'Counterpart' },
  { header: 'Units', align: 'right', width: 8 },
  { header: 'Weapons', align: 'right', width: 8 },
  { header: 'Status', width: 10 },
  { header: 'Sent', width: 16 },
];

export async function showReinforcements(client: NovusMundusClient, ctx: CLIContext, pubkeyStr: string): Promise<void> {
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(pubkeyStr);
  } catch {
    log.error(`Invalid public key: ${pubkeyStr}`);
    return;
  }

  const [sent, received] = await Promise.all([
    client.fetchReinforcementsSent(pubkey),
    client.fetchReinforcementsReceived(pubkey),
  ]);

  const total = sent.length + received.length;
  log.info(section(`Reinforcements for ${addr(pubkey)} (${total} total)`));

  if (total === 0) {
    log.info(dim('  No reinforcements found.'));
    return;
  }

  const rows = [
    ...sent.map(({ account: r }) => [
      'Sent',
      addr(r.destination),
      formatNum(getReinforcementTotalUnits(r)),
      formatNum(getReinforcementTotalWeapons(r)),
      STATUS_NAMES[r.status] ?? `${r.status}`,
      formatDate(r.sentAt),
    ]),
    ...received.map(({ account: r }) => [
      'Received',
      addr(r.sender),
      formatNum(getReinforcementTotalUnits(r)),
      formatNum(getReinforcementTotalWeapons(r)),
      STATUS_NAMES[r.status] ?? `${r.status}`,
      formatDate(r.sentAt),
    ]),
  ];

  log.info(table(cols, rows));
}

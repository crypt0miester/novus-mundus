/**
 * show loot — Show unclaimed loot for a player
 */

import { PublicKey } from '@solana/web3.js';
import type { NovusMundusClient } from '../../../src/client';
import type { CLIContext } from '../context';
import { log } from '../helpers';
import {
  table, section, addr, formatNum, formatDate, dim, green, red,
  type Column,
} from '../format';
import { derivePlayerPda } from '../../../src/pda';
import { LootSourceType } from '../../../src/state/loot';
import { getLootTotalWeapons } from '../../../src/state/loot';

const SOURCE_NAMES: Record<number, string> = {
  [LootSourceType.Encounter]: 'Encounter',
  [LootSourceType.PvP]: 'PvP',
  [LootSourceType.Rally]: 'Rally',
};

export async function showLoot(client: NovusMundusClient, ctx: CLIContext, walletStr: string): Promise<void> {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletStr);
  } catch {
    log.error(`Invalid public key: ${walletStr}`);
    return;
  }

  const [playerPda] = await derivePlayerPda(client.gameEngine, wallet);
  const loot = await client.fetchPlayerLoot(playerPda, { unclaimedOnly: true });

  log.info(section(`Unclaimed Loot for ${addr(wallet)} (${loot.length} items)`));

  if (loot.length === 0) {
    log.info(dim('  No unclaimed loot found.'));
    return;
  }

  const cols: Column[] = [
    { header: 'ID', align: 'right', width: 4 },
    { header: 'Source', width: 10 },
    { header: 'Cash', align: 'right', width: 10 },
    { header: 'NOVI', align: 'right', width: 10 },
    { header: 'Weapons', align: 'right', width: 8 },
    { header: 'Materials', align: 'right', width: 10 },
    { header: 'Expires', width: 16 },
  ];

  const now = Math.floor(Date.now() / 1000);

  const rows = loot
    .sort((a, b) => (a.account.lootId < b.account.lootId ? -1 : a.account.lootId > b.account.lootId ? 1 : 0))
    .map(({ account: l }) => {
      const expiry = Number(l.expiresAt);
      const expiresStr = expiry > 0
        ? (expiry < now ? red('EXPIRED') : formatDate(l.expiresAt))
        : dim('--');

      return [
        l.lootId.toString(),
        SOURCE_NAMES[l.sourceType] ?? `${l.sourceType}`,
        formatNum(l.cash),
        formatNum(l.reservedNovi),
        formatNum(getLootTotalWeapons(l)),
        formatNum(l.fragments + l.gems),
        expiresStr,
      ];
    });

  log.info(table(cols, rows));
}

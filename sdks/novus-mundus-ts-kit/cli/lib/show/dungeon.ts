/**
 * show dungeon — Show a player's active or last dungeon run
 */

import { PublicKey } from '@solana/web3.js';
import type { NovusMundusClient } from '../../../src/client';
import type { CLIContext } from '../context';
import { log } from '../helpers';
import { section, addr, dim, green, red } from '../format';
import { derivePlayerPda, deriveDungeonRunPda } from '../../../src/pda';
import { deserializeDungeonRun, DungeonStatus } from '../../../src/state/dungeon';

const STATUS_NAMES: Record<number, string> = {
  [DungeonStatus.Active]: 'Active',
  [DungeonStatus.AwaitingRelic]: 'Awaiting Relic',
  [DungeonStatus.BossFight]: 'Boss Fight',
  [DungeonStatus.Completed]: 'Completed',
  [DungeonStatus.Failed]: 'Failed',
  [DungeonStatus.Fled]: 'Fled',
};

export async function showDungeon(
  client: NovusMundusClient,
  ctx: CLIContext,
  walletStr: string,
): Promise<void> {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletStr);
  } catch {
    log.error(`Invalid public key: ${walletStr}`);
    return;
  }

  const [playerPda] = await derivePlayerPda(await client.resolveGameEngine(), wallet);
  const [runPda] = await deriveDungeonRunPda(playerPda);

  log.info(section(`Dungeon Run for ${addr(wallet)}`));

  const info = await ctx.connection.getAccountInfo(runPda);
  if (!info) {
    log.info(dim('  No dungeon run account — not currently in a dungeon.'));
    return;
  }

  const run = deserializeDungeonRun(info.data);
  // A run is underway until it reaches a terminal status.
  const ongoing =
    run.status === DungeonStatus.Active ||
    run.status === DungeonStatus.AwaitingRelic ||
    run.status === DungeonStatus.BossFight;
  const statusName = STATUS_NAMES[run.status] ?? String(run.status);

  log.info(`  Run PDA:        ${addr(runPda)}`);
  log.info(`  Status:         ${ongoing ? green(statusName) : red(statusName)}`);
  log.info(`  Dungeon:        #${run.dungeonId}`);
  log.info(`  Floor / Room:   ${run.currentFloor} / ${run.currentRoom}`);
  log.info(
    `  Progress:       ${run.roomsCleared} rooms · ${run.enemiesKilled} foes · ${run.relicsCollected} relics`,
  );
  log.info('');
  log.info(
    ongoing
      ? green('  → Currently IN a dungeon run.')
      : dim(`  → Run has ended (${statusName}); the run account is unclaimed.`),
  );
}

/**
 * Crank: Reinforcements - process arrivals (Ix 191) and returns (Ix 194)
 *
 * Fetches ReinforcementAccounts via getProgramAccounts (filtered by the SDK
 * size constant) and parses each:
 *   - Traveling + arrivesAt passed         -> process_arrival (marks Active)
 *   - Returning + return timer passed       -> process_return (refunds + closes)
 * Both are permissionless; the DAO pays the fee. Active (defending) and not-yet-
 * arrived reinforcements are left untouched.
 *
 * There was no reinforcement crank before; arrive/return were only reachable as
 * manual `novus reinforcement arrive|return` commands per-pair.
 */

import { type CLIContext } from '../context';
import { log, newStats, crankSend, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import {
  createProcessArrivalInstruction,
  createProcessReturnInstruction,
} from '../../../src/instructions/reinforcement';
import { parseReinforcement, REINFORCEMENT_ACCOUNT_SIZE } from '../../../src/state/reinforcement';
import { derivePlayerPda, deriveEstatePda } from '../../../src/pda';
import { ReinforcementStatus } from '../../../src/types/enums';

export async function crankReinforcements(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const now = Math.floor(Date.now() / 1000);

  log.info('  Fetching reinforcement accounts...');
  const accounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: REINFORCEMENT_ACCOUNT_SIZE }],
  });
  log.info(`  Found ${accounts.length} reinforcement accounts`);

  for (const { account, pubkey } of accounts) {
    const r = parseReinforcement(account);
    if (!r) {
      stats.skipped++;
      continue;
    }

    // Arrival: Traveling and travel timer elapsed.
    if (r.status === ReinforcementStatus.Traveling && now >= Number(r.arrivesAt)) {
      const [destinationPlayer] = await derivePlayerPda(ctx.gameEngine, r.destination);
      const ix = createProcessArrivalInstruction({ reinforcement: pubkey, destinationPlayer });
      await crankSend(ctx, stats, ix, `Arrival ${pubkey.toBase58().slice(0, 8)}..`, { would: 'process', done: 'Processed', computeUnits: 20_000 });
      continue;
    }

    // Return: Returning and the return timer elapsed.
    const returnsAt = Number(r.returnStartedAt) + r.returnDuration;
    if (r.status === ReinforcementStatus.Returning && r.returnStartedAt > 0n && now >= returnsAt) {
      const [senderPlayer] = await derivePlayerPda(ctx.gameEngine, r.sender);
      const [estateAccount] = await deriveEstatePda(senderPlayer);
      const ix = createProcessReturnInstruction({
        reinforcement: pubkey,
        senderPlayer,
        senderOwner: r.sender,
        estateAccount,
      });
      await crankSend(ctx, stats, ix, `Return ${pubkey.toBase58().slice(0, 8)}..`, { would: 'process', done: 'Processed', computeUnits: 20_000 });
      continue;
    }

    stats.skipped++;
  }

  return stats;
}

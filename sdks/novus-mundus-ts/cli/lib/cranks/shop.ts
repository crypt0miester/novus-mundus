/**
 * Crank: Shop sales - advance seasonal sales + DAO promotions (Ix 156)
 *
 * `activate_sale` is a permissionless state-machine crank: it walks a sale from
 * Scheduled -> Active -> Ended based on the clock. This crank finds every
 * SeasonalSaleAccount and DAOPromotionAccount (by SDK size) and pokes any whose
 * window boundary has passed so its status reflects reality.
 *
 * There was no shop crank before; activation was only reachable via the manual
 * `novus shop activate-sale` command.
 */

import { type CLIContext } from '../context';
import { log, newStats, crankSend, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import { createActivateSaleInstruction } from '../../../src/instructions/shop';
import {
  parseSeasonalSale,
  SEASONAL_SALE_ACCOUNT_SIZE,
  parseDaoPromotion,
  DAO_PROMOTION_ACCOUNT_SIZE,
} from '../../../src/state/shop';

// Status enum (mirrors on-chain): 0 = Scheduled, 1 = Active, 2 = Ended.
const ENDED = 2;

export async function crankShop(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const now = Math.floor(Date.now() / 1000);

  // Seasonal sales (keyed by event pubkey) + DAO promotions (keyed by proposal
  // id) are independent scans — fetch them concurrently.
  log.info('  Fetching seasonal sales + DAO promotions...');
  const [seasonals, promos] = await Promise.all([
    ctx.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: 'confirmed',
      filters: [{ dataSize: SEASONAL_SALE_ACCOUNT_SIZE }],
    }),
    ctx.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: 'confirmed',
      filters: [{ dataSize: DAO_PROMOTION_ACCOUNT_SIZE }],
    }),
  ]);

  for (const { account } of seasonals) {
    const s = parseSeasonalSale(account);
    if (!s) {
      stats.skipped++;
      continue;
    }
    // Needs a poke if it should be Active (started, not ended) or should be
    // Ended (past end) but its status hasn't caught up yet.
    const shouldAdvance =
      s.status !== ENDED &&
      (now >= Number(s.startsAt) || now >= Number(s.endsAt));
    if (!shouldAdvance) {
      stats.skipped++;
      continue;
    }
    // activate_sale derives the seasonal PDA from the event pubkey, which is now
    // persisted on the account (s.event) so we can target the real sale.
    const ix = createActivateSaleInstruction(
      { crank: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
      { saleType: 0, event: s.event },
    );
    await crankSend(ctx, stats, ix, `Seasonal "${s.name}"`, { would: 'advance', done: 'Advanced', computeUnits: 5_000, benignFail: true });
  }

  for (const { account } of promos) {
    const p = parseDaoPromotion(account);
    if (!p) {
      stats.skipped++;
      continue;
    }
    const shouldAdvance =
      p.status !== ENDED &&
      (now >= Number(p.startsAt) || now >= Number(p.endsAt));
    if (!shouldAdvance) {
      stats.skipped++;
      continue;
    }
    // proposalId is persisted on the account (create_dao_promotion), so we can
    // build activate_sale directly without reversing the PDA.
    const ix = createActivateSaleInstruction(
      { crank: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
      { saleType: 1, proposalId: p.proposalId },
    );
    await crankSend(ctx, stats, ix, `DAO promo "${p.title}" (#${p.proposalId})`, { would: 'advance', done: 'Advanced', computeUnits: 5_000, benignFail: true });
  }

  return stats;
}

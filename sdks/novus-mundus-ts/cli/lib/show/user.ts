/**
 * show user — Display UserAccount state (Reserved NOVI + events + purchase streak)
 */

import { PublicKey } from '@solana/web3.js';
import type { NovusMundusClient } from '../../../src/client';
import type { CLIContext } from '../context';
import { log } from '../helpers';
import { section, addr, formatNum, formatDate, dim } from '../format';

export async function showUser(client: NovusMundusClient, ctx: CLIContext, walletStr: string): Promise<void> {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletStr);
  } catch {
    log.error(`Invalid public key: ${walletStr}`);
    return;
  }

  const result = await client.fetchUser(wallet);
  if (!result.exists || !result.account) {
    log.error(`User account not found for wallet ${addr(wallet)}`);
    return;
  }

  const u = result.account;

  // NOVI is stored on-chain with 1 decimal of precision (e.g. 1,080,000 raw =
  // 108,000 NOVI displayed). The token mint has decimals=1. We surface both so
  // the deci-vs-NOVI distinction is unambiguous.
  const reservedRaw = Number(u.reservedNovi);
  const lifetimeRaw = Number(u.totalReservedEarned);
  const purchasedTodayRaw = Number(u.noviPurchasedToday);

  const _ = ctx;

  log.info(`\nUser account for ${addr(wallet)}`);
  log.info(`Wallet: ${addr(wallet)}    PDA: ${addr(result.pubkey)}    Player: ${addr(u.player)}`);

  log.info(section('Reserved NOVI'));
  log.info(`  Balance:  ${formatNum(reservedRaw)} raw  ${dim('=')} ${(reservedRaw / 10).toLocaleString()} NOVI`);
  log.info(`  Lifetime: ${formatNum(lifetimeRaw)} raw  ${dim('=')} ${(lifetimeRaw / 10).toLocaleString()} NOVI`);
  if (Number(u.reservedNoviEarnedAt) > 0) {
    log.info(`  Earned at: ${formatDate(u.reservedNoviEarnedAt)}`);
  }
  if (Number(u.lastWithdrawal) > 0) {
    log.info(`  Last withdrawal: ${formatDate(u.lastWithdrawal)}`);
  }

  log.info(section('Purchase Streak'));
  log.info(`  Streak: ${u.noviPurchaseStreak} day(s)    Last day: ${u.noviLastPurchaseDay}`);
  log.info(`  Purchased today: ${formatNum(purchasedTodayRaw)} raw  ${dim('=')} ${(purchasedTodayRaw / 10).toLocaleString()} NOVI`);

  log.info(section('Events'));
  log.info(`  Participated: ${formatNum(u.totalEventsParticipated)}    Won: ${formatNum(u.totalEventsWon)}`);

  log.info('');
}

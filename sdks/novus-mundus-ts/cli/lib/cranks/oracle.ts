/**
 * Crank: Oracle — refresh the Switchboard On-Demand oracle-quote PDA (ix 302).
 *
 * Reads the feed set straight off chain: `shop_config.sol_switchboard_feed`
 * plus every whitelisted token's `switchboard_feed`. Fetches one fresh
 * oracle-signed quote covering all of them from the Switchboard gateway and
 * persists it via `crank_oracle_quote`.
 *
 * Switchboard's SDK selects the cluster + cranker keypair from
 * `~/.config/solana` (`AnchorUtils.loadEnv()`) — point that at the same
 * cluster as `--env`, with the game_authority keypair. For a continuous
 * crank loop use `scripts/crank-oracle.ts --interval` instead.
 */

import { type CLIContext } from '../context';
import { log, newStats, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import {
  deriveShopConfigPda,
  parseShopConfig,
  parseAllowedToken,
  ALLOWED_TOKEN_ACCOUNT_SIZE,
} from '../../../src/index';
import { PublicKey } from '@solana/web3.js';

// `@switchboard-xyz/on-demand` (and the crank-oracle script that wraps it) run
// web3.js-v1 top-level code that throws under Bun's runtime. Import both lazily
// so merely loading the CLI module graph — `novus init`, `create-player`,
// `validator`, etc. — never evaluates them; they only load when the oracle
// crank actually reaches the cranking path below.

/** A 32-byte feed-hash key is "unset" when all zero. */
function isZeroKey(key: PublicKey): boolean {
  return key.equals(PublicKey.default);
}

export async function crankOracle(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  const [configPda] = await deriveShopConfigPda(ctx.gameEngine);
  const configInfo = await ctx.connection.getAccountInfo(configPda);
  if (!configInfo) {
    log.error('ShopConfig not found — run `novus init shop` first');
    stats.skipped++;
    return stats;
  }
  const config = parseShopConfig(configInfo);
  if (!config || isZeroKey(config.solSwitchboardQueue)) {
    log.info('  Switchboard not configured — skipping (Pyth-only deployment)');
    stats.skipped++;
    return stats;
  }

  // Feed set: SOL/USD (shop config) + every whitelisted token's TOKEN/USD.
  const feedKeys: PublicKey[] = [];
  if (!isZeroKey(config.solSwitchboardFeed)) feedKeys.push(config.solSwitchboardFeed);

  const tokens = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: ALLOWED_TOKEN_ACCOUNT_SIZE }],
  });
  for (const { account } of tokens) {
    const tok = parseAllowedToken(account);
    if (tok && !isZeroKey(tok.switchboardFeed)) feedKeys.push(tok.switchboardFeed);
  }

  // Dedupe; one OracleQuote carries at most 8 feeds.
  const feeds = [...new Set(feedKeys.map((k) => Buffer.from(k.toBytes()).toString('hex')))];
  if (feeds.length === 0) {
    log.info('  No Switchboard feeds configured — skipping');
    stats.skipped++;
    return stats;
  }
  if (feeds.length > 8) {
    log.error(`  ${feeds.length} feeds configured — OracleQuote carries at most 8`);
    feeds.length = 8;
  }
  log.info(`  Cranking ${feeds.length} feed(s) on queue ${config.solSwitchboardQueue.toBase58()}`);

  // Lazy-load the web3.js-v1 oracle deps only now that we're committed to
  // cranking — see the import note at the top of this file.
  const sb = await import('@switchboard-xyz/on-demand');
  const { crankOnce } = await import('../../../scripts/crank-oracle');

  // `loadEnv` reads ~/.config/solana — cluster + game_authority keypair.
  const env = await sb.AnchorUtils.loadEnv();
  if (!env.queue.pubkey.equals(config.solSwitchboardQueue)) {
    log.error(
      `  Queue mismatch — solana config queue ${env.queue.pubkey.toBase58()} ` +
        `≠ shop_config queue ${config.solSwitchboardQueue.toBase58()}`,
    );
    stats.skipped++;
    return stats;
  }

  await crankOnce(env, ctx.gameEngine, feeds, ctx.dryRun);
  log.update(ctx.dryRun ? 'oracle-quote (simulated)' : 'oracle-quote refreshed');
  stats.updated++;
  return stats;
}

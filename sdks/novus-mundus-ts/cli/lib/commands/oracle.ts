/**
 * `novus oracle <config|init-quote|allow-token|buy|status>` — oracle &
 * token-payment management (Pyth pull-oracle + Switchboard On-Demand, Model B).
 *
 *   config       Set the shop's SOL/USD oracle (Pyth feed id and/or Switchboard
 *                feed id + queue). Merges onto the current ShopConfig.
 *   init-quote   Create the program-owned Switchboard oracle-quote PDA (ix 301).
 *   allow-token  Whitelist an SPL token for payment with its TOKEN/USD feed.
 *   buy          Exercise a token-payment item purchase (Pyth or Switchboard).
 *   status       Print the current oracle config + whitelisted tokens.
 *
 * The Switchboard oracle-quote PDA is kept fresh by `novus crank oracle`.
 */

import {
  PublicKey,
  AddressLookupTableProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import { type CLIContext, type ParsedArgs, loadKeypair } from '../context';
import { log, sendWithRetry, accountExists } from '../helpers';
import { bold, dim, green, yellow, cyan } from '../format';
import {
  createUpdateConfigInstruction,
  createInitOracleQuoteInstruction,
  createCreateAllowedTokenInstruction,
  createPurchaseItemInstruction,
  type TokenPaymentAccounts,
  deriveShopConfigPda,
  deriveAllowedTokenPda,
  deriveOracleQuotePda,
  parseShopConfig,
  parseAllowedToken,
  getAssociatedTokenAddressSync,
  ALLOWED_TOKEN_ACCOUNT_SIZE,
  PYTH_SOL_USD_FEED_ID,
  PYTH_USDC_USD_FEED_ID,
  PYTH_USDT_USD_FEED_ID,
  PYTH_BTC_USD_FEED_ID,
  PYTH_ETH_USD_FEED_ID,
} from '../../../src/index';
import { PROGRAM_ID } from '../../../src/program';

// Well-known Switchboard On-Demand queues — `--switchboard-queue` accepts these
// aliases or a raw pubkey.
const SWITCHBOARD_QUEUES: Record<string, string> = {
  mainnet: 'A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w',
  devnet: 'EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7',
};

// `--pyth-feed` accepts a 64-hex feed id or one of these symbol aliases.
const PYTH_FEED_ALIASES: Record<string, string> = {
  sol: PYTH_SOL_USD_FEED_ID,
  usdc: PYTH_USDC_USD_FEED_ID,
  usdt: PYTH_USDT_USD_FEED_ID,
  btc: PYTH_BTC_USD_FEED_ID,
  eth: PYTH_ETH_USD_FEED_ID,
};

// Flag parsing — the CLI parser flattens `--flag value` pairs into one array.

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1 || idx + 1 >= flags.length) return undefined;
  return flags[idx + 1];
}

function requireFlag(flags: string[], name: string): string {
  const val = getFlag(flags, name);
  if (val === undefined) throw new Error(`Missing required flag: ${name}`);
  return val;
}

/** Resolve a `--pyth-feed` value (alias or hex) to a 64-char hex feed id. */
function resolvePythFeed(value: string): string {
  const alias = PYTH_FEED_ALIASES[value.toLowerCase()];
  const hex = (alias ?? value).replace(/^0x/, '');
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid Pyth feed id (expected 64 hex chars or alias): ${value}`);
  }
  return hex;
}

/** Resolve a Switchboard 32-byte feed hash (hex) to a PublicKey carrier. */
function feedHashToPubkey(value: string): PublicKey {
  const hex = value.replace(/^0x/, '');
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid Switchboard feed hash (expected 64 hex chars): ${value}`);
  }
  return new PublicKey(Buffer.from(hex, 'hex'));
}

/** Resolve a `--switchboard-queue` value (alias or pubkey) to a PublicKey. */
function resolveQueue(value: string): PublicKey {
  return new PublicKey(SWITCHBOARD_QUEUES[value.toLowerCase()] ?? value);
}

/** A 32-byte feed-id PublicKey is "unset" when all zero. */
function isZeroKey(key: PublicKey): boolean {
  return key.equals(PublicKey.default);
}

async function loadShopConfig(ctx: CLIContext) {
  const [configPda] = deriveShopConfigPda(ctx.gameEngine);
  const info = await ctx.connection.getAccountInfo(configPda);
  if (!info) {
    throw new Error('ShopConfig not found — run `novus init shop` first');
  }
  const config = parseShopConfig(info);
  if (!config) throw new Error('Failed to parse ShopConfig');
  return config;
}

// oracle config — set the shop's SOL/USD oracle

async function handleConfig(ctx: CLIContext, flags: string[]): Promise<void> {
  const config = await loadShopConfig(ctx);

  const pythFlag = getFlag(flags, '--pyth-feed');
  const sbFeedFlag = getFlag(flags, '--switchboard-feed');
  const queueFlag = getFlag(flags, '--switchboard-queue');
  const stalenessFlag = getFlag(flags, '--staleness');
  const confidenceFlag = getFlag(flags, '--confidence');

  if (
    pythFlag === undefined &&
    sbFeedFlag === undefined &&
    queueFlag === undefined &&
    stalenessFlag === undefined &&
    confidenceFlag === undefined
  ) {
    log.error(
      'oracle config: pass at least one of --pyth-feed, --switchboard-feed, ' +
        '--switchboard-queue, --staleness, --confidence',
    );
    return;
  }

  // Merge onto the current config — `update_config` replaces the whole SOL
  // oracle section, so unspecified fields keep their existing values.
  const solPythFeed = pythFlag
    ? resolvePythFeed(pythFlag)
    : config.solPythFeed.toBuffer().toString('hex');
  const solSwitchboardFeed = sbFeedFlag
    ? feedHashToPubkey(sbFeedFlag)
    : config.solSwitchboardFeed;
  const solSwitchboardQueue = queueFlag
    ? resolveQueue(queueFlag)
    : config.solSwitchboardQueue;
  const solMaxStalenessSlots = stalenessFlag
    ? parseInt(stalenessFlag, 10)
    : config.solMaxStalenessSlots;
  const solConfidenceThresholdBps = confidenceFlag
    ? parseInt(confidenceFlag, 10)
    : config.solConfidenceThresholdBps;

  log.info(`  Pyth feed         ${solPythFeed}`);
  log.info(`  Switchboard feed  ${solSwitchboardFeed.toBase58()}`);
  log.info(`  Switchboard queue ${solSwitchboardQueue.toBase58()}`);
  log.info(`  max staleness     ${solMaxStalenessSlots}`);
  log.info(`  confidence bps    ${solConfidenceThresholdBps}`);

  if (ctx.dryRun) {
    log.dryRun('Would update SOL oracle config');
    return;
  }

  const ix = createUpdateConfigInstruction(
    { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey },
    {
      solPythFeed,
      solSwitchboardFeed,
      solSwitchboardQueue,
      solMaxStalenessSlots,
      solConfidenceThresholdBps,
    },
  );
  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  log.update('SOL oracle config');
}

// oracle init-quote — create the program-owned oracle-quote PDA

async function handleInitQuote(ctx: CLIContext, flags: string[]): Promise<void> {
  const queueFlag = getFlag(flags, '--switchboard-queue');
  const switchboardQueue = queueFlag
    ? resolveQueue(queueFlag)
    : (await loadShopConfig(ctx)).solSwitchboardQueue;

  if (isZeroKey(switchboardQueue)) {
    log.error(
      'No Switchboard queue — pass --switchboard-queue or run `oracle config` first',
    );
    return;
  }

  const [oracleQuote] = deriveOracleQuotePda(switchboardQueue);
  log.info(`  queue        ${switchboardQueue.toBase58()}`);
  log.info(`  oracle-quote ${oracleQuote.toBase58()}`);

  if (await accountExists(ctx.connection, oracleQuote)) {
    log.skip('oracle-quote PDA [exists]');
    return;
  }
  if (ctx.dryRun) {
    log.dryRun('Would create oracle-quote PDA');
    return;
  }

  const ix = createInitOracleQuoteInstruction({
    authority: ctx.daoAuthority.publicKey,
    gameEngine: ctx.gameEngine,
    switchboardQueue,
  });
  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  log.create('oracle-quote PDA');
}

// oracle allow-token — whitelist an SPL token for payment

async function handleAllowToken(ctx: CLIContext, flags: string[]): Promise<void> {
  const tokenMint = new PublicKey(requireFlag(flags, '--mint'));
  const pythFlag = getFlag(flags, '--pyth-feed');
  const sbFeedFlag = getFlag(flags, '--switchboard-feed');
  // `--pegged` marks USDC/USDT/PYUSD-style $1 stablecoins. When set, the
  // chain skips the oracle and computes the token amount directly from
  // `cost_usd_cents` — no Pyth/Switchboard feeds required (or used).
  const pegged = flags.includes('--pegged');

  if (!pegged && pythFlag === undefined && sbFeedFlag === undefined) {
    log.error(
      'oracle allow-token: pass --pyth-feed and/or --switchboard-feed (or --pegged for a $1 stablecoin)',
    );
    return;
  }

  const maxStalenessSlots = parseInt(getFlag(flags, '--staleness') ?? '60', 10);
  const confidenceThresholdBps = parseInt(getFlag(flags, '--confidence') ?? '100', 10);
  const discountBps = parseInt(getFlag(flags, '--discount') ?? '0', 10);

  const [allowedToken] = deriveAllowedTokenPda(ctx.gameEngine, tokenMint);
  log.info(`  mint          ${tokenMint.toBase58()}`);
  log.info(`  allowed-token ${allowedToken.toBase58()}`);
  if (pegged) log.info(`  pricing       ${green('$1-pegged stablecoin')} (no oracle)`);
  if (pythFlag) log.info(`  Pyth feed     ${resolvePythFeed(pythFlag)}`);
  if (sbFeedFlag) log.info(`  Switchboard   ${feedHashToPubkey(sbFeedFlag).toBase58()}`);

  if (await accountExists(ctx.connection, allowedToken)) {
    log.skip('allowed-token [already registered]');
    return;
  }
  if (ctx.dryRun) {
    log.dryRun('Would register allowed token');
    return;
  }

  const ix = createCreateAllowedTokenInstruction(
    {
      payer: ctx.daoAuthority.publicKey,
      daoAuthority: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
      tokenMint,
      treasuryWallet: ctx.treasury.publicKey,
    },
    {
      pythFeed: pythFlag ? resolvePythFeed(pythFlag) : undefined,
      switchboardFeed: sbFeedFlag ? feedHashToPubkey(sbFeedFlag) : undefined,
      maxStalenessSlots,
      confidenceThresholdBps,
      discountBps,
      peggedToUsd: pegged,
    },
  );
  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  log.create('allowed-token');
}

// oracle buy — exercise a token-payment item purchase

async function handleBuy(ctx: CLIContext, flags: string[]): Promise<void> {
  const buyer = loadKeypair(requireFlag(flags, '--buyer'));
  const itemId = parseInt(requireFlag(flags, '--item'), 10);
  const tokenMint = new PublicKey(requireFlag(flags, '--mint'));
  const payment = requireFlag(flags, '--payment').toLowerCase();
  const quantity = parseInt(getFlag(flags, '--quantity') ?? '1', 10);
  if (payment !== 'pyth' && payment !== 'switchboard') {
    log.error('oracle buy: --payment must be `pyth` or `switchboard`');
    return;
  }

  const [allowedToken] = deriveAllowedTokenPda(ctx.gameEngine, tokenMint);
  const buyerTokenAta = getAssociatedTokenAddressSync(tokenMint, buyer.publicKey);
  const treasuryTokenAta = getAssociatedTokenAddressSync(tokenMint, ctx.treasury.publicKey);

  const tokenPayment: TokenPaymentAccounts = {
    allowedToken,
    tokenMint,
    buyerTokenAta,
    treasuryTokenAta,
  };

  if (payment === 'switchboard') {
    const switchboardQueue = (await loadShopConfig(ctx)).solSwitchboardQueue;
    if (isZeroKey(switchboardQueue)) {
      log.error('Switchboard not configured — run `oracle config --switchboard-queue ...`');
      return;
    }
    const [oracleQuote] = deriveOracleQuotePda(switchboardQueue);
    tokenPayment.oracleQuote = oracleQuote;
    tokenPayment.switchboardQueue = switchboardQueue;
    log.info(`  oracle-quote  ${oracleQuote.toBase58()}`);
  } else {
    // Pyth path needs the two `PriceUpdateV2` account addresses.
    tokenPayment.solOracleFeed = new PublicKey(requireFlag(flags, '--sol-feed'));
    tokenPayment.tokenOracleFeed = new PublicKey(requireFlag(flags, '--token-feed'));
    log.info(`  SOL feed      ${tokenPayment.solOracleFeed.toBase58()}`);
    log.info(`  TOKEN feed    ${tokenPayment.tokenOracleFeed.toBase58()}`);
  }

  log.info(`  buyer         ${buyer.publicKey.toBase58()}`);
  log.info(`  item #${itemId} × ${quantity}  via ${payment}`);

  if (ctx.dryRun) {
    log.dryRun(`Would purchase item #${itemId}`);
    return;
  }

  const ix = createPurchaseItemInstruction(
    { buyer: buyer.publicKey, gameEngine: ctx.gameEngine, itemId, treasury: ctx.treasury.publicKey, tokenPayment },
    { quantity, paymentType: 2 },
  );
  await sendWithRetry(ctx, ix, [buyer]);
  log.create(`purchased item #${itemId} (${payment} payment)`);
}

// oracle status — print oracle config + whitelisted tokens

async function handleStatus(ctx: CLIContext): Promise<void> {
  const config = await loadShopConfig(ctx);
  const pythHex = config.solPythFeed.toBuffer().toString('hex');
  const sbFeed = config.solSwitchboardFeed;
  const queue = config.solSwitchboardQueue;

  console.log(bold('\n  SOL/USD oracle'));
  console.log(`    Pyth feed id      ${isZeroKey(config.solPythFeed) ? dim('unset') : pythHex}`);
  console.log(`    Switchboard feed  ${isZeroKey(sbFeed) ? dim('unset') : sbFeed.toBase58()}`);
  console.log(`    Switchboard queue ${isZeroKey(queue) ? dim('unset') : queue.toBase58()}`);
  console.log(`    max staleness     ${config.solMaxStalenessSlots}`);
  console.log(`    confidence bps    ${config.solConfidenceThresholdBps}`);

  if (!isZeroKey(queue)) {
    const [oracleQuote] = deriveOracleQuotePda(queue);
    const exists = await accountExists(ctx.connection, oracleQuote);
    console.log(
      `    oracle-quote PDA  ${oracleQuote.toBase58()} ` +
        (exists ? green('[initialized]') : yellow('[missing — run `oracle init-quote`]')),
    );
  }

  const accounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: ALLOWED_TOKEN_ACCOUNT_SIZE }],
  });
  console.log(bold(`\n  Whitelisted payment tokens (${accounts.length})`));
  if (accounts.length === 0) {
    console.log(dim('    none — register with `oracle allow-token`'));
  }
  for (const { account } of accounts) {
    const tok = parseAllowedToken(account);
    if (!tok) continue;
    const pricing = tok.peggedToUsd
      ? green('$1-pegged')
      : isZeroKey(tok.pythFeed)
        ? `switchboard ${tok.switchboardFeed.toBase58()}`
        : `pyth ${tok.pythFeed.toBuffer().toString('hex')}`;
    console.log(`    ${cyan(tok.mint.toBase58())}  ${dim(pricing)}  discount ${tok.discountBps}bps`);
  }
  console.log();
}

// oracle init-alt — create the shared Address Lookup Table

/**
 * The kingdom-fixed accounts a Switchboard purchase shares with its bundled
 * crank. Compressing these via an ALT keeps `[ed25519, crank, purchase]` under
 * the 1232-byte transaction limit (see `27-oracle-crank-bundle.test.ts`).
 *
 * This set never changes — the per-token accounts ride as plain static keys —
 * so the ALT is created once and never extended.
 */
async function handleInitAlt(ctx: CLIContext): Promise<void> {
  const config = await loadShopConfig(ctx);
  const queue = config.solSwitchboardQueue;
  if (isZeroKey(queue)) {
    log.error('No Switchboard queue — run `oracle config --switchboard-queue ...` first');
    return;
  }

  const [shopConfig] = deriveShopConfigPda(ctx.gameEngine);
  const [oracleQuote] = deriveOracleQuotePda(queue);
  const fixedAccounts = [
    ctx.gameEngine,
    shopConfig,
    ctx.treasury.publicKey,
    oracleQuote,
    queue,
    SYSVAR_SLOT_HASHES_PUBKEY,
    SYSVAR_INSTRUCTIONS_PUBKEY,
  ];

  // The ALT is derived from a recent slot; `finalized` avoids a slot the
  // cluster might roll back under the new table account.
  const recentSlot = await ctx.connection.getSlot('finalized');
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: ctx.daoAuthority.publicKey,
    payer: ctx.daoAuthority.publicKey,
    recentSlot,
  });
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    lookupTable: altAddress,
    authority: ctx.daoAuthority.publicKey,
    payer: ctx.daoAuthority.publicKey,
    addresses: fixedAccounts,
  });

  log.info(`  table         ${altAddress.toBase58()}`);
  for (const a of fixedAccounts) log.info(`    + ${a.toBase58()}`);

  if (ctx.dryRun) {
    log.dryRun('Would create + extend the shop Address Lookup Table');
    return;
  }

  await sendWithRetry(ctx, [createIx, extendIx], [ctx.daoAuthority]);
  log.create(`Address Lookup Table (${fixedAccounts.length} accounts)`);
  console.log(
    `\n  ${bold('Set this in apps/web/.env.local:')}\n` +
      `  SHOP_ADDRESS_LOOKUP_TABLE=${altAddress.toBase58()}\n`,
  );
}

export async function handleOracle(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const sub = args.target;
  switch (sub) {
    case 'config':
      log.header('Oracle: config');
      await handleConfig(ctx, args.flags);
      break;
    case 'init-quote':
      log.header('Oracle: init-quote');
      await handleInitQuote(ctx, args.flags);
      break;
    case 'init-alt':
      log.header('Oracle: init-alt');
      await handleInitAlt(ctx);
      break;
    case 'allow-token':
      log.header('Oracle: allow-token');
      await handleAllowToken(ctx, args.flags);
      break;
    case 'buy':
      log.header('Oracle: buy');
      await handleBuy(ctx, args.flags);
      break;
    case 'status':
      await handleStatus(ctx);
      break;
    default:
      log.error(`Unknown oracle subcommand: ${sub || '(none)'}`);
      log.info('Valid: config, init-quote, init-alt, allow-token, buy, status');
  }
}

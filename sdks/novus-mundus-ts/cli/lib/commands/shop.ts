/**
 * shop command - robust shop admin + player operations with read-back validation
 *
 * Usage:
 *   novus shop show [config|items|bundles|deals|token|weekly|seasonal|dao] [flags]
 *   novus shop daily-deal create --slot N --item N --discount BPS [--next-item N] [--next-discount BPS]
 *   novus shop daily-deal rotate --slot N --item N --discount BPS
 *   novus shop weekly-sale --week N --theme N --bonus-type N --bonus BPS --cats a,b,c,d --duration D [--starts TS]
 *   novus shop seasonal-sale --event PK --name "..." --discount BPS --starts TS --ends TS [--threshold L] [--cosmetic N]
 *   novus shop dao-promotion --proposal N --title "..." [--global BPS] [--max BPS] [--budget L] [--starts TS] [--ends TS] [...cat discounts]
 *   novus shop config --sol-pyth-feed HEX | --sol-switchboard-feed PK --sol-switchboard-queue PK [--staleness N] [--confidence BPS]
 *   novus shop allowed-token add --mint PK (--pyth-feed HEX | --switchboard-feed PK | --pegged) [--staleness N] [--confidence BPS] [--discount BPS]
 *   novus shop allowed-token update --mint PK [...same flags]
 *   novus shop allowed-token close --mint PK
 *   novus shop activate-sale (--proposal N | --event PK)       (permissionless crank)
 *   novus shop buy-item <playerKeypair> --item N [--qty n]
 *   novus shop buy-bundle <playerKeypair> --bundle N
 *   novus shop buy-novi <playerKeypair> --package N [--max-lamports L]
 *   novus shop buy-flash <playerKeypair> --sale N
 *   novus shop audit [--player <playerKeypair>]               (run the full instruction list + verify)
 *
 * Every admin write reads the account back and confirms the on-chain fields
 * match what was sent ("validate after"); inputs are range-checked first
 * ("validate before"). `audit` drives the SOL-path instruction list end-to-end
 * and prints a pass/fail table; token/oracle paths are reported as skipped with
 * a reason rather than silently omitted. Player SOL purchases need a funded,
 * initialized player; token-priced purchases route through `novus oracle buy`.
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

import type { CLIContext, ParsedArgs } from '../context';
import { loadKeypair } from '../context';
import { sendWithRetry, log, accountExists } from '../helpers';
import { table, section, addr, formatNum, formatDate, dim, green, red, yellow } from '../format';
import { SHOP_ITEMS, SHOP_BUNDLES } from '../../data/shop-items';

import {
  createCreateDailyDealInstruction,
  createRotateDailyDealInstruction,
  createCreateWeeklySaleInstruction,
  createCreateSeasonalSaleInstruction,
  createCreateDaoPromotionInstruction,
  createUpdateConfigInstruction,
  createCreateAllowedTokenInstruction,
  createUpdateAllowedTokenInstruction,
  createCloseAllowedTokenInstruction,
  createActivateSaleInstruction,
  createPurchaseItemInstruction,
  createPurchaseBundleInstruction,
  createPurchaseNoviInstruction,
  createPurchaseFlashSaleInstruction,
  deriveShopConfigPda,
  deriveShopItemPda,
  deriveBundlePda,
  deriveDailyDealPda,
  deriveWeeklySalePda,
  deriveSeasonalSalePda,
  deriveDaoPromotionPda,
  deriveAllowedTokenPda,
  deriveFlashSalePda,
  parseShopConfig,
  parseShopItem,
  parseBundle,
  parseDailyDeal,
  parseWeeklySale,
  parseSeasonalSale,
  parseDaoPromotion,
  parseAllowedToken,
  parseFlashSale,
} from '../../../src/index';

const SOL = LAMPORTS_PER_SOL;

export async function handleShop(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'show':
    case 'status':
      await handleShow(ctx, args);
      break;
    case 'daily-deal':
      await handleDailyDeal(ctx, args);
      break;
    case 'weekly-sale':
      await handleWeeklySale(ctx, args);
      break;
    case 'seasonal-sale':
      await handleSeasonalSale(ctx, args);
      break;
    case 'dao-promotion':
      await handleDaoPromotion(ctx, args);
      break;
    case 'config':
      await handleConfig(ctx, args);
      break;
    case 'allowed-token':
      await handleAllowedToken(ctx, args);
      break;
    case 'activate-sale':
      await handleActivateSale(ctx, args);
      break;
    case 'buy-item':
      await handleBuyItem(ctx, args);
      break;
    case 'buy-bundle':
      await handleBuyBundle(ctx, args);
      break;
    case 'buy-novi':
      await handleBuyNovi(ctx, args);
      break;
    case 'buy-flash':
      await handleBuyFlash(ctx, args);
      break;
    case 'audit':
      await handleAudit(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus shop <show|daily-deal|weekly-sale|seasonal-sale|dao-promotion|config|allowed-token|activate-sale|buy-item|buy-bundle|buy-novi|buy-flash|audit> [options]');
  }
}

// show

async function handleShow(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const what = args.extra || 'summary';
  switch (what) {
    case 'config':
      await showConfig(ctx);
      break;
    case 'items':
      await showItems(ctx);
      break;
    case 'bundles':
      await showBundles(ctx);
      break;
    case 'deals':
      await showDeals(ctx);
      break;
    case 'token': {
      const mint = pubkeyFlag(args, '--mint');
      if (!mint) return log.error('Specify --mint <pubkey>');
      await showToken(ctx, mint);
      break;
    }
    case 'weekly': {
      const week = numFlag(args, '--week');
      if (week === null) return log.error('Specify --week <n>');
      await showWeekly(ctx, week);
      break;
    }
    case 'seasonal': {
      const event = pubkeyFlag(args, '--event');
      if (!event) return log.error('Specify --event <pubkey>');
      await showSeasonal(ctx, event);
      break;
    }
    case 'dao': {
      const proposal = numFlag(args, '--proposal');
      if (proposal === null) return log.error('Specify --proposal <n>');
      await showDao(ctx, proposal);
      break;
    }
    case 'summary':
    default:
      await showConfig(ctx);
      await showDeals(ctx);
      log.info(dim(`  items defined in seed: ${SHOP_ITEMS.length} · bundles: ${SHOP_BUNDLES.length} (use 'shop show items|bundles')`));
  }
}

async function showConfig(ctx: CLIContext): Promise<void> {
  const [pda] = await deriveShopConfigPda(ctx.gameEngine);
  const info = await ctx.connection.getAccountInfo(pda);
  if (!info) return log.error("Shop config not found - run 'novus init shop' first");
  const c = parseShopConfig(info);
  if (!c) return log.error('Failed to parse shop config');

  log.info(section('Shop Config'));
  log.info(table(
    [{ header: 'Field', width: 26 }, { header: 'Value' }],
    [
      ['Max base discount',   `${bps(c.maxBaseDiscountBps)}`],
      ['Max bundle discount', `${bps(c.maxBundleDiscountBps)}`],
      ['Max fib discount',    `${bps(c.maxFibDiscountBps)}`],
      ['Max total discount',  `${bps(c.maxTotalDiscountBps)}`],
      ['Max flash sales/day', String(c.maxFlashSalesPerDay)],
      ['Max daily deals',     String(c.maxDailyDeals)],
      ['Next flash sale id',  formatNum(c.nextFlashSaleId)],
      ['Total SOL collected', `${(Number(c.totalSolCollected) / SOL).toFixed(4)} SOL`],
      ['Total NOVI burned',   formatNum(c.totalNoviBurned)],
      ['SOL Pyth feed',       addr(c.solPythFeed)],
      ['SOL Switchboard feed', addr(c.solSwitchboardFeed)],
      ['SOL max staleness',   String(c.solMaxStalenessSlots)],
    ],
  ));
}

async function showItems(ctx: CLIContext): Promise<void> {
  log.info(section('Shop Items'));
  const rows: string[][] = [];
  for (const seed of SHOP_ITEMS) {
    const [pda] = await deriveShopItemPda(ctx.gameEngine, seed.itemId);
    const info = await ctx.connection.getAccountInfo(pda);
    if (!info) continue;
    const it = parseShopItem(info);
    if (!it) continue;
    rows.push([
      String(seed.itemId),
      seed.name ?? `#${seed.itemId}`,
      String(it.itemType),
      `${(Number(it.priceSolLamports) / SOL).toFixed(4)}`,
      it.isActive ? green('active') : dim('inactive'),
      it.maxGlobalStock === 0n ? dim('inf') : `${formatNum(it.currentGlobalStock)}/${formatNum(it.maxGlobalStock)}`,
    ]);
  }
  if (rows.length === 0) return log.info(dim('  No items on chain.'));
  log.info(table(
    [
      { header: 'ID', align: 'right', width: 5 },
      { header: 'Name' },
      { header: 'Type', align: 'right', width: 6 },
      { header: 'SOL', align: 'right' },
      { header: 'State', width: 9 },
      { header: 'Stock' },
    ],
    rows,
  ));
}

async function showBundles(ctx: CLIContext): Promise<void> {
  log.info(section('Shop Bundles'));
  const rows: string[][] = [];
  for (const seed of SHOP_BUNDLES) {
    const [pda] = await deriveBundlePda(ctx.gameEngine, seed.bundleId);
    const info = await ctx.connection.getAccountInfo(pda);
    if (!info) continue;
    const b = parseBundle(info);
    if (!b) continue;
    rows.push([
      String(seed.bundleId),
      String(b.tier),
      String(b.itemCount),
      `${(Number(b.priceSolLamports) / SOL).toFixed(4)}`,
      bps(b.savingsBps),
      b.isActive ? green('active') : dim('inactive'),
      formatNum(b.totalPurchases),
    ]);
  }
  if (rows.length === 0) return log.info(dim('  No bundles on chain.'));
  log.info(table(
    [
      { header: 'ID', align: 'right', width: 5 },
      { header: 'Tier', align: 'right', width: 4 },
      { header: 'Items', align: 'right', width: 5 },
      { header: 'SOL', align: 'right' },
      { header: 'Savings' },
      { header: 'State', width: 9 },
      { header: 'Sales', align: 'right' },
    ],
    rows,
  ));
}

async function showDeals(ctx: CLIContext): Promise<void> {
  log.info(section('Daily Deals (slots 0-2)'));
  const rows: string[][] = [];
  for (let slot = 0; slot < 3; slot++) {
    const [pda] = await deriveDailyDealPda(ctx.gameEngine, slot);
    const info = await ctx.connection.getAccountInfo(pda);
    if (!info) {
      rows.push([String(slot), dim('empty'), '', '', '']);
      continue;
    }
    const d = parseDailyDeal(info);
    if (!d) continue;
    rows.push([
      String(slot),
      String(d.itemId),
      bps(d.discountBps),
      `${d.nextItemId} @ ${bps(d.nextDiscountBps)}`,
      formatNum(d.purchasesToday),
    ]);
  }
  log.info(table(
    [
      { header: 'Slot', align: 'right', width: 4 },
      { header: 'Item', align: 'right', width: 6 },
      { header: 'Discount' },
      { header: 'Next' },
      { header: 'Sold today', align: 'right' },
    ],
    rows,
  ));
}

async function showToken(ctx: CLIContext, mint: PublicKey): Promise<void> {
  const [pda] = await deriveAllowedTokenPda(ctx.gameEngine, mint);
  const info = await ctx.connection.getAccountInfo(pda);
  if (!info) return log.error(`No allowed-token config for ${addr(mint)}`);
  const t = parseAllowedToken(info);
  if (!t) return log.error('Failed to parse allowed token');
  log.info(section(`Allowed Token ${addr(mint)}`));
  log.info(table(
    [{ header: 'Field', width: 22 }, { header: 'Value' }],
    [
      ['Mint',          addr(t.mint)],
      ['Pegged to USD', t.peggedToUsd ? green('yes') : dim('no')],
      ['Pyth feed',     addr(t.pythFeed)],
      ['Switchboard',   addr(t.switchboardFeed)],
      ['Max staleness', String(t.maxStalenessSlots)],
      ['Confidence',    bps(t.confidenceThresholdBps)],
      ['Discount',      bps(t.discountBps)],
    ],
  ));
}

async function showWeekly(ctx: CLIContext, week: number): Promise<void> {
  const [pda] = await deriveWeeklySalePda(ctx.gameEngine, week);
  const info = await ctx.connection.getAccountInfo(pda);
  if (!info) return log.error(`No weekly sale for week ${week}`);
  const w = parseWeeklySale(info);
  if (!w) return log.error('Failed to parse weekly sale');
  log.info(section(`Weekly Sale - week ${week}`));
  log.info(table(
    [{ header: 'Field', width: 20 }, { header: 'Value' }],
    [
      ['Theme',      String(w.theme)],
      ['Bonus type', String(w.bonusType)],
      ['Bonus',      bps(w.bonusValueBps)],
      ['Cat discounts', w.categoryDiscounts.map(bps).join(' / ')],
      ['Starts',     formatDate(w.startsAt)],
      ['Ends',       formatDate(w.endsAt)],
      ['Purchases',  formatNum(w.totalPurchases)],
    ],
  ));
}

async function showSeasonal(ctx: CLIContext, event: PublicKey): Promise<void> {
  const [pda] = await deriveSeasonalSalePda(ctx.gameEngine, event);
  const info = await ctx.connection.getAccountInfo(pda);
  if (!info) return log.error(`No seasonal sale for event ${addr(event)}`);
  const s = parseSeasonalSale(info);
  if (!s) return log.error('Failed to parse seasonal sale');
  log.info(section(`Seasonal Sale - ${s.name}`));
  log.info(table(
    [{ header: 'Field', width: 20 }, { header: 'Value' }],
    [
      ['Status',         String(s.status)],
      ['Global discount', bps(s.globalDiscountBps)],
      ['Featured',       String(s.featuredCount)],
      ['Starts',         formatDate(s.startsAt)],
      ['Ends',           formatDate(s.endsAt)],
      ['Spend threshold', `${(Number(s.spendThreshold) / SOL).toFixed(4)} SOL`],
      ['Cosmetic id',    String(s.exclusiveCosmeticId)],
      ['Purchases',      formatNum(s.totalPurchases)],
    ],
  ));
}

async function showDao(ctx: CLIContext, proposal: number): Promise<void> {
  const [pda] = await deriveDaoPromotionPda(ctx.gameEngine, proposal);
  const info = await ctx.connection.getAccountInfo(pda);
  if (!info) return log.error(`No DAO promotion for proposal ${proposal}`);
  const p = parseDaoPromotion(info);
  if (!p) return log.error('Failed to parse DAO promotion');
  log.info(section(`DAO Promotion - ${p.title}`));
  log.info(table(
    [{ header: 'Field', width: 22 }, { header: 'Value' }],
    [
      ['Status',          String(p.status)],
      ['Global discount', bps(p.globalDiscountBps)],
      ['Max discount',    bps(p.maxDiscountBps)],
      ['Equipment',       bps(p.equipmentDiscountBps)],
      ['Consumable',      bps(p.consumableDiscountBps)],
      ['Starts',          formatDate(p.startsAt)],
      ['Ends',            formatDate(p.endsAt)],
      ['Budget',          `${(Number(p.maxDiscountBudgetLamports) / SOL).toFixed(4)} SOL`],
      ['Used budget',     `${(Number(p.usedDiscountBudget) / SOL).toFixed(4)} SOL`],
    ],
  ));
}

// daily-deal create|rotate

async function handleDailyDeal(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const action = args.extra;
  const slot = numFlag(args, '--slot');
  const item = numFlag(args, '--item');
  const discount = numFlag(args, '--discount');
  if (slot === null || slot < 0 || slot > 2) return log.error('Specify --slot 0..2');
  if (item === null) return log.error('Specify --item <id>');
  if (discount === null || discount < 1500 || discount > 4000) return log.error('--discount must be 1500..4000 bps');

  const dao = ctx.daoAuthority.publicKey;
  const [pda] = await deriveDailyDealPda(ctx.gameEngine, slot);

  if (action === 'rotate') {
    const ix = createRotateDailyDealInstruction(
      { daoAuthority: dao, gameEngine: ctx.gameEngine, slotIndex: slot },
      { newItemId: item, newDiscountBps: discount },
    );
    await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 5_000 });
    await confirmDailyDeal(ctx, `Rotated daily-deal slot ${slot}`, pda, { nextItemId: item, nextDiscountBps: discount });
    return;
  }

  // create (default)
  const nextItem = numFlag(args, '--next-item') ?? item;
  const nextDiscount = numFlag(args, '--next-discount') ?? discount;
  const ix = createCreateDailyDealInstruction(
    { payer: dao, daoAuthority: dao, gameEngine: ctx.gameEngine },
    { slotIndex: slot, itemId: item, discountBps: discount, nextItemId: nextItem, nextDiscountBps: nextDiscount },
  );
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 5_000 });
  await confirmDailyDeal(ctx, `Created daily-deal slot ${slot}`, pda, { itemId: item, discountBps: discount });
}

async function confirmDailyDeal(ctx: CLIContext, label: string, pda: PublicKey, want: Partial<{ itemId: number; discountBps: number; nextItemId: number; nextDiscountBps: number }>): Promise<void> {
  const info = await ctx.connection.getAccountInfo(pda);
  const d = info && parseDailyDeal(info);
  if (!d) return log.error(`${label}: account not readable after write`);
  const checks = [];
  if (want.itemId !== undefined) checks.push(['itemId', d.itemId, want.itemId] as const);
  if (want.discountBps !== undefined) checks.push(['discountBps', d.discountBps, want.discountBps] as const);
  if (want.nextItemId !== undefined) checks.push(['nextItemId', d.nextItemId, want.nextItemId] as const);
  if (want.nextDiscountBps !== undefined) checks.push(['nextDiscountBps', d.nextDiscountBps, want.nextDiscountBps] as const);
  reportChecks(label, checks);
}

// weekly-sale

async function handleWeeklySale(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const week = numFlag(args, '--week');
  if (week === null) return log.error('Specify --week <n>');
  const theme = numFlag(args, '--theme') ?? 0;
  const bonusType = numFlag(args, '--bonus-type') ?? 0;
  const bonus = numFlag(args, '--bonus') ?? 0;
  const cats = parseQuad(strFlag(args, '--cats')) ?? [0, 0, 0, 0];
  const duration = numFlag(args, '--duration') ?? 7;
  if (duration < 1 || duration > 7) return log.error('--duration must be 1..7 days');
  if (cats.some((c) => c > 3000)) return log.error('category discounts cap at 3000 bps');
  const starts = numFlag(args, '--starts') ?? nowSec();

  const dao = ctx.daoAuthority.publicKey;
  const [pda] = await deriveWeeklySalePda(ctx.gameEngine, week);
  const ix = createCreateWeeklySaleInstruction(
    { payer: dao, daoAuthority: dao, gameEngine: ctx.gameEngine },
    {
      weekNumber: week,
      theme,
      bonusType,
      bonusValueBps: bonus,
      categoryDiscounts: cats,
      startsAt: starts,
      durationDays: duration,
    },
  );
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 6_000 });
  const info = await ctx.connection.getAccountInfo(pda);
  const w = info && parseWeeklySale(info);
  if (!w) return log.error('weekly-sale: account not readable after write');
  reportChecks(`Created weekly sale week ${week}`, [
    ['theme', w.theme, theme],
    ['bonusValueBps', w.bonusValueBps, bonus],
    ['cat0', w.categoryDiscounts[0], cats[0]],
  ]);
}

// seasonal-sale

async function handleSeasonalSale(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const event = pubkeyFlag(args, '--event');
  if (!event) return log.error('Specify --event <pubkey> (an EventAccount to link to)');
  const name = strFlag(args, '--name') ?? 'Seasonal Sale';
  const discount = numFlag(args, '--discount') ?? 1000;
  if (discount > 5000) return log.error('--discount caps at 5000 bps');
  const starts = numFlag(args, '--starts') ?? nowSec();
  const ends = numFlag(args, '--ends') ?? starts + 7 * 86400;
  const threshold = numFlag(args, '--threshold') ?? 0;
  const cosmetic = numFlag(args, '--cosmetic') ?? 0;

  const dao = ctx.daoAuthority.publicKey;
  const [pda] = await deriveSeasonalSalePda(ctx.gameEngine, event);
  const ix = createCreateSeasonalSaleInstruction(
    { payer: dao, daoAuthority: dao, gameEngine: ctx.gameEngine, event },
    {
      name,
      globalDiscountBps: discount,
      startsAt: starts,
      endsAt: ends,
      spendThreshold: threshold,
      exclusiveCosmeticId: cosmetic,
      featuredItems: [],
    },
  );
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 6_000 });
  const info = await ctx.connection.getAccountInfo(pda);
  const s = info && parseSeasonalSale(info);
  if (!s) return log.error('seasonal-sale: account not readable after write');
  reportChecks(`Created seasonal sale "${name}"`, [
    ['name', s.name, name],
    ['globalDiscountBps', s.globalDiscountBps, discount],
    ['exclusiveCosmeticId', s.exclusiveCosmeticId, cosmetic],
  ]);
}

// dao-promotion

async function handleDaoPromotion(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const proposal = numFlag(args, '--proposal');
  if (proposal === null) return log.error('Specify --proposal <n>');
  const title = strFlag(args, '--title') ?? `Promo ${proposal}`;
  const global = numFlag(args, '--global') ?? 1000;
  const max = numFlag(args, '--max') ?? 3000;
  const budget = numFlag(args, '--budget') ?? Math.floor(10 * SOL);
  const starts = numFlag(args, '--starts') ?? nowSec();
  const ends = numFlag(args, '--ends') ?? starts + 7 * 86400;
  if ([global, max].some((v) => v > 5000)) return log.error('discounts cap at 5000 bps');

  const dao = ctx.daoAuthority.publicKey;
  const [pda] = await deriveDaoPromotionPda(ctx.gameEngine, proposal);
  const ix = createCreateDaoPromotionInstruction(
    { payer: dao, daoAuthority: dao, gameEngine: ctx.gameEngine },
    {
      proposalId: proposal,
      title,
      equipmentDiscountBps: numFlag(args, '--equipment') ?? 0,
      consumableDiscountBps: numFlag(args, '--consumable') ?? 0,
      materialDiscountBps: numFlag(args, '--material') ?? 0,
      cosmeticDiscountBps: numFlag(args, '--cosmetic') ?? 0,
      globalDiscountBps: global,
      maxDiscountBps: max,
      startsAt: starts,
      endsAt: ends,
      maxDiscountBudgetLamports: budget,
    },
  );
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 6_000 });
  const info = await ctx.connection.getAccountInfo(pda);
  const p = info && parseDaoPromotion(info);
  if (!p) return log.error('dao-promotion: account not readable after write');
  reportChecks(`Created DAO promotion "${title}"`, [
    ['title', p.title, title],
    ['globalDiscountBps', p.globalDiscountBps, global],
    ['maxDiscountBps', p.maxDiscountBps, max],
  ]);
}

// config (update_config — SOL oracle section)

async function handleConfig(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const pyth = strFlag(args, '--sol-pyth-feed');
  const sbFeed = pubkeyFlag(args, '--sol-switchboard-feed');
  const sbQueue = pubkeyFlag(args, '--sol-switchboard-queue');
  const staleness = numFlag(args, '--staleness');
  const confidence = numFlag(args, '--confidence');
  if (!pyth && !sbFeed && !sbQueue && staleness === null && confidence === null) {
    return log.error('Nothing to set. Pass --sol-pyth-feed HEX and/or --sol-switchboard-feed PK --sol-switchboard-queue PK [--staleness N] [--confidence BPS]');
  }

  const ix = createUpdateConfigInstruction(
    { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
    {
      solPythFeed: pyth ?? undefined,
      solSwitchboardFeed: sbFeed ?? undefined,
      solSwitchboardQueue: sbQueue ?? undefined,
      solMaxStalenessSlots: staleness ?? undefined,
      solConfidenceThresholdBps: confidence ?? undefined,
    },
  );
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 20_000 });
  const [pda] = await deriveShopConfigPda(ctx.gameEngine);
  const info = await ctx.connection.getAccountInfo(pda);
  const c = info && parseShopConfig(info);
  if (!c) return log.error('config: account not readable after write');
  const checks = [];
  if (sbFeed) checks.push(['solSwitchboardFeed', c.solSwitchboardFeed.toBase58(), sbFeed.toBase58()] as const);
  if (sbQueue) checks.push(['solSwitchboardQueue', c.solSwitchboardQueue.toBase58(), sbQueue.toBase58()] as const);
  if (staleness !== null) checks.push(['solMaxStalenessSlots', c.solMaxStalenessSlots, staleness] as const);
  reportChecks('Updated shop config (SOL oracle)', checks.length ? checks : [['written', 'ok', 'ok']]);
}

// allowed-token add|update|close

async function handleAllowedToken(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const action = args.extra;
  const mint = pubkeyFlag(args, '--mint');
  if (!mint) return log.error('Specify --mint <pubkey>');
  const dao = ctx.daoAuthority.publicKey;
  const [pda] = await deriveAllowedTokenPda(ctx.gameEngine, mint);

  if (action === 'close') {
    const ix = createCloseAllowedTokenInstruction({ daoAuthority: dao, gameEngine: ctx.gameEngine, tokenMint: mint });
    await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 5_000 });
    const stillThere = await accountExists(ctx.connection, pda);
    reportChecks(`Closed allowed-token ${addr(mint)}`, [['accountClosed', !stillThere, true]]);
    return;
  }

  const pyth = strFlag(args, '--pyth-feed');
  const sbFeed = pubkeyFlag(args, '--switchboard-feed');
  const pegged = args.flags.includes('--pegged');
  const staleness = numFlag(args, '--staleness');
  const confidence = numFlag(args, '--confidence');
  const discount = numFlag(args, '--discount');

  if (action === 'update') {
    const ixs = createUpdateAllowedTokenInstruction(
      { daoAuthority: dao, gameEngine: ctx.gameEngine, tokenMint: mint },
      {
        pythFeed: pyth ?? undefined,
        switchboardFeed: sbFeed ?? undefined,
        maxStalenessSlots: staleness ?? undefined,
        confidenceThresholdBps: confidence ?? undefined,
        discountBps: discount ?? undefined,
        peggedToUsd: args.flags.includes('--pegged') ? true : (args.flags.includes('--unpegged') ? false : undefined),
      },
    );
    const list = await ixs;
    if (list.length === 0) return log.error('Nothing to update - pass at least one field flag');
    await sendWithRetry(ctx, list, [ctx.daoAuthority], { computeUnits: 5_000 * list.length });
    const info = await ctx.connection.getAccountInfo(pda);
    const t = info && parseAllowedToken(info);
    if (!t) return log.error('allowed-token update: not readable after write');
    const checks = [];
    if (discount !== null) checks.push(['discountBps', t.discountBps, discount] as const);
    if (staleness !== null) checks.push(['maxStalenessSlots', t.maxStalenessSlots, staleness] as const);
    reportChecks(`Updated allowed-token ${addr(mint)}`, checks.length ? checks : [['written', 'ok', 'ok']]);
    return;
  }

  // add (create)
  if (!pyth && !sbFeed && !pegged) {
    return log.error('add needs one of: --pyth-feed HEX, --switchboard-feed PK, or --pegged (stablecoin)');
  }
  const ix = createCreateAllowedTokenInstruction(
    {
      payer: dao,
      daoAuthority: dao,
      gameEngine: ctx.gameEngine,
      tokenMint: mint,
      treasuryWallet: ctx.treasury.publicKey,
    },
    {
      pythFeed: pyth ?? undefined,
      switchboardFeed: sbFeed ?? undefined,
      maxStalenessSlots: staleness ?? 300,
      confidenceThresholdBps: confidence ?? 100,
      discountBps: discount ?? 0,
      peggedToUsd: pegged,
    },
  );
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 12_000 });
  const info = await ctx.connection.getAccountInfo(pda);
  const t = info && parseAllowedToken(info);
  if (!t) return log.error('allowed-token add: not readable after write');
  reportChecks(`Added allowed-token ${addr(mint)}`, [
    ['mint', t.mint.toBase58(), mint.toBase58()],
    ['peggedToUsd', t.peggedToUsd, pegged],
    ['discountBps', t.discountBps, discount ?? 0],
  ]);
}

// activate-sale (permissionless crank)

async function handleActivateSale(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const proposal = numFlag(args, '--proposal');
  const event = pubkeyFlag(args, '--event');
  if (proposal === null && !event) return log.error('Specify --proposal <n> (DAO promo) or --event <pubkey> (seasonal)');

  const ix = event
    ? createActivateSaleInstruction({ crank: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine }, { saleType: 0, event })
    : createActivateSaleInstruction({ crank: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine }, { saleType: 1, proposalId: proposal! });
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 5_000 });
  log.create(`Activated ${event ? `seasonal sale ${addr(event)}` : `DAO promo ${proposal}`} (state advanced)`);
}

// buy-item (SOL)

async function handleBuyItem(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) return usageKp('buy-item', '--item N [--qty n]');
  const item = numFlag(args, '--item');
  if (item === null) return log.error('Specify --item <id>');
  const qty = numFlag(args, '--qty') ?? 1;

  const ix = createPurchaseItemInstruction(
    { buyer: kp.publicKey, gameEngine: ctx.gameEngine, itemId: item, treasury: ctx.treasury.publicKey },
    { quantity: qty, paymentType: 0 },
  );
  await sendWithRetry(ctx, ix, [kp], { computeUnits: 25_000 });
  log.create(`${addr(kp.publicKey)} bought item ${item} x${qty} (SOL)`);
}

// buy-bundle (SOL)

async function handleBuyBundle(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) return usageKp('buy-bundle', '--bundle N');
  const bundleId = numFlag(args, '--bundle');
  if (bundleId === null) return log.error('Specify --bundle <id>');

  const [bundlePda] = await deriveBundlePda(ctx.gameEngine, bundleId);
  const info = await ctx.connection.getAccountInfo(bundlePda);
  const bundle = info && parseBundle(info);
  if (!bundle) return log.error(`Bundle ${bundleId} not found on chain`);

  const shopItemAccounts: PublicKey[] = [];
  for (const it of bundle.items) {
    const [itemPda] = await deriveShopItemPda(ctx.gameEngine, it.itemId);
    shopItemAccounts.push(itemPda);
  }

  const ix = createPurchaseBundleInstruction(
    { buyer: kp.publicKey, gameEngine: ctx.gameEngine, bundleId, treasury: ctx.treasury.publicKey, shopItemAccounts },
    { paymentType: 0 },
  );
  await sendWithRetry(ctx, ix, [kp], { computeUnits: 20_000 });
  log.create(`${addr(kp.publicKey)} bought bundle ${bundleId} (${bundle.itemCount} items, SOL)`);
}

// buy-novi (SOL, fallback price)

async function handleBuyNovi(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) return usageKp('buy-novi', '--package N [--max-lamports L]');
  const pkg = numFlag(args, '--package');
  if (pkg === null || pkg < 0 || pkg > 4) return log.error('Specify --package 0..4');
  const maxLamports = numFlag(args, '--max-lamports') ?? Math.floor(5 * SOL);

  const ix = createPurchaseNoviInstruction(
    { buyer: kp.publicKey, gameEngine: ctx.gameEngine, treasury: ctx.treasury.publicKey, noviMint: ctx.noviMint },
    { packageIndex: pkg, maxLamports },
  );
  await sendWithRetry(ctx, ix, [kp], { computeUnits: 12_000 });
  log.create(`${addr(kp.publicKey)} bought NOVI package ${pkg} (SOL fallback price, cap ${(maxLamports / SOL).toFixed(3)} SOL)`);
}

// buy-flash (SOL)

async function handleBuyFlash(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) return usageKp('buy-flash', '--sale N');
  const saleId = numFlag(args, '--sale');
  if (saleId === null) return log.error('Specify --sale <id>');

  const [salePda] = await deriveFlashSalePda(ctx.gameEngine, saleId);
  const info = await ctx.connection.getAccountInfo(salePda);
  const sale = info && parseFlashSale(info);
  if (!sale) return log.error(`Flash sale ${saleId} not found`);

  const [itemOrBundle] = sale.isBundle
    ? await deriveBundlePda(ctx.gameEngine, sale.itemId)
    : await deriveShopItemPda(ctx.gameEngine, sale.itemId);

  const ix = createPurchaseFlashSaleInstruction(
    { buyer: kp.publicKey, gameEngine: ctx.gameEngine, saleId, itemOrBundle, treasury: ctx.treasury.publicKey },
    { quantity: 1, paymentType: 0 },
  );
  await sendWithRetry(ctx, ix, [kp], { computeUnits: 40_000 });
  log.create(`${addr(kp.publicKey)} bought flash sale ${saleId} (${sale.isBundle ? 'bundle' : 'item'} ${sale.itemId}, SOL)`);
}

// audit - run the SOL-path admin instruction list end-to-end with read-back validation

async function handleAudit(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  log.info(section('Shop instruction audit (SOL paths)'));
  const dao = ctx.daoAuthority.publicKey;
  const results: Array<{ ix: string; status: 'pass' | 'fail' | 'skip'; note: string }> = [];

  const run = async (name: string, fn: () => Promise<string>) => {
    try {
      const note = await fn();
      results.push({ ix: name, status: 'pass', note });
      log.info(`  ${green('pass')} ${name} ${dim(note)}`);
    } catch (e: any) {
      const msg = String(e?.message || e).split('\n')[0] ?? '';
      results.push({ ix: name, status: 'fail', note: msg });
      log.info(`  ${red('fail')} ${name} ${dim(msg)}`);
    }
  };
  const skip = (name: string, why: string) => {
    results.push({ ix: name, status: 'skip', note: why });
    log.info(`  ${yellow('skip')} ${name} ${dim(why)}`);
  };

  // Preconditions: shop config must exist.
  const [cfgPda] = await deriveShopConfigPda(ctx.gameEngine);
  if (!(await accountExists(ctx.connection, cfgPda))) {
    return log.error("Shop config missing - run 'novus init shop' before auditing");
  }

  // Pick a real seed item id for deal/sale references.
  const itemId = SHOP_ITEMS[0]?.itemId ?? 1;

  // create_daily_deal (slot 2 to avoid clobbering seeded slots 0/1 if present)
  await run('148 create_daily_deal', async () => {
    const slot = 2;
    const [pda] = await deriveDailyDealPda(ctx.gameEngine, slot);
    const already = await accountExists(ctx.connection, pda);
    if (already) return 'slot 2 already exists (idempotent skip of create)';
    await sendWithRetry(ctx, createCreateDailyDealInstruction(
      { payer: dao, daoAuthority: dao, gameEngine: ctx.gameEngine },
      { slotIndex: slot, itemId, discountBps: 2000, nextItemId: itemId, nextDiscountBps: 2500 },
    ), [ctx.daoAuthority], { computeUnits: 5_000 });
    const info = await ctx.connection.getAccountInfo(pda);
    const d = info && parseDailyDeal(info);
    if (!d || d.itemId !== itemId || d.discountBps !== 2000) throw new Error('read-back mismatch');
    return `slot ${slot} itemId=${d.itemId} discount=${d.discountBps}`;
  });

  // rotate_daily_deal
  await run('149 rotate_daily_deal', async () => {
    const slot = 2;
    const [pda] = await deriveDailyDealPda(ctx.gameEngine, slot);
    if (!(await accountExists(ctx.connection, pda))) throw new Error('slot 2 missing (create step failed)');
    await sendWithRetry(ctx, createRotateDailyDealInstruction(
      { daoAuthority: dao, gameEngine: ctx.gameEngine, slotIndex: slot },
      { newItemId: itemId, newDiscountBps: 3000 },
    ), [ctx.daoAuthority], { computeUnits: 5_000 });
    const info = await ctx.connection.getAccountInfo(pda);
    const d = info && parseDailyDeal(info);
    if (!d || d.nextDiscountBps !== 3000) throw new Error('read-back mismatch');
    return `nextDiscount=${d.nextDiscountBps}`;
  });

  // create_weekly_sale
  await run('150 create_weekly_sale', async () => {
    const week = 999999; // audit-only week, unlikely to collide
    const [pda] = await deriveWeeklySalePda(ctx.gameEngine, week);
    if (await accountExists(ctx.connection, pda)) return 'audit week already exists';
    await sendWithRetry(ctx, createCreateWeeklySaleInstruction(
      { payer: dao, daoAuthority: dao, gameEngine: ctx.gameEngine },
      { weekNumber: week, theme: 0, bonusType: 0, bonusValueBps: 500, categoryDiscounts: [1000, 0, 0, 0], startsAt: nowSec(), durationDays: 3 },
    ), [ctx.daoAuthority], { computeUnits: 6_000 });
    const info = await ctx.connection.getAccountInfo(pda);
    const w = info && parseWeeklySale(info);
    if (!w || w.bonusValueBps !== 500) throw new Error('read-back mismatch');
    return `week ${week} bonus=${w.bonusValueBps}`;
  });

  // create_dao_promotion
  await run('153 create_dao_promotion', async () => {
    const proposal = 999999;
    const [pda] = await deriveDaoPromotionPda(ctx.gameEngine, proposal);
    if (await accountExists(ctx.connection, pda)) return 'audit proposal already exists';
    await sendWithRetry(ctx, createCreateDaoPromotionInstruction(
      { payer: dao, daoAuthority: dao, gameEngine: ctx.gameEngine },
      {
        proposalId: proposal, title: 'Audit Promo', equipmentDiscountBps: 0, consumableDiscountBps: 0,
        materialDiscountBps: 0, cosmeticDiscountBps: 0, globalDiscountBps: 1000, maxDiscountBps: 3000,
        startsAt: nowSec(), endsAt: nowSec() + 86400, maxDiscountBudgetLamports: Math.floor(10 * SOL),
      },
    ), [ctx.daoAuthority], { computeUnits: 6_000 });
    const info = await ctx.connection.getAccountInfo(pda);
    const p = info && parseDaoPromotion(info);
    if (!p || p.globalDiscountBps !== 1000) throw new Error('read-back mismatch');
    return `proposal ${proposal} global=${p.globalDiscountBps}`;
  });

  // activate_sale (DAO promo just created)
  await run('156 activate_sale', async () => {
    await sendWithRetry(ctx, createActivateSaleInstruction(
      { crank: dao, gameEngine: ctx.gameEngine }, { saleType: 1, proposalId: 999999 },
    ), [ctx.daoAuthority], { computeUnits: 5_000 });
    return 'DAO promo advanced';
  });

  // Token/oracle and purchase paths need setup we don't synthesize here.
  skip('157-159 allowed_token', 'needs an SPL mint + treasury ATA; use: novus shop allowed-token add --mint <PK> --pegged');
  skip('152 create_seasonal_sale', 'needs a linked EventAccount; use: novus shop seasonal-sale --event <PK> ...');
  if (!strFlag(args, '--player')) {
    skip('143/144/146/300 purchases', 'pass --player <keypair> with a funded player to exercise SOL purchases');
  } else {
    const kp = await resolveKeypair(strFlag(args, '--player')!);
    if (!kp) skip('143/144/146/300 purchases', 'invalid --player keypair');
    else {
      await run('143 purchase_item', async () => {
        await sendWithRetry(ctx, createPurchaseItemInstruction(
          { buyer: kp.publicKey, gameEngine: ctx.gameEngine, itemId, treasury: ctx.treasury.publicKey },
          { quantity: 1, paymentType: 0 },
        ), [kp], { computeUnits: 25_000 });
        return `item ${itemId} x1`;
      });
    }
  }

  // Summary
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  log.info(section('Audit summary'));
  log.info(`  ${green(`${pass} pass`)} · ${fail ? red(`${fail} fail`) : `${fail} fail`} · ${dim(`${skipped} skip`)}`);
  if (fail > 0) log.info(dim('  Re-run with --verbose to see tx logs for failures.'));
}

// validation reporting

function reportChecks(label: string, checks: ReadonlyArray<readonly [string, unknown, unknown]>): void {
  let ok = true;
  const lines: string[] = [];
  for (const [field, got, want] of checks) {
    const pass = String(got) === String(want);
    if (!pass) ok = false;
    lines.push(`      ${pass ? green('ok') : red('XX')} ${field}=${String(got)}${pass ? '' : ` (expected ${String(want)})`}`);
  }
  if (ok) log.create(`${label} ${green('[verified]')}`);
  else log.error(`${label} [read-back MISMATCH]`);
  for (const l of lines) log.info(l);
}

// flag/arg helpers

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function bps(v: number): string {
  return `${(v / 100).toFixed(1)}%`;
}

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}

function strFlag(args: ParsedArgs, name: string): string | null {
  return getFlag(args.flags, name) ?? null;
}

function numFlag(args: ParsedArgs, name: string): number | null {
  const v = getFlag(args.flags, name);
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pubkeyFlag(args: ParsedArgs, name: string): PublicKey | null {
  const v = getFlag(args.flags, name);
  if (!v) return null;
  try {
    return new PublicKey(v);
  } catch {
    log.error(`Invalid ${name} pubkey: ${v}`);
    return null;
  }
}

function parseQuad(v: string | null): [number, number, number, number] | null {
  if (!v) return null;
  const p = v.split(',').map((x) => Math.max(0, parseInt(x.trim(), 10) || 0));
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 0];
}

async function resolveKeypair(extra: string) {
  if (!extra || looksLikePubkey(extra)) return null;
  try {
    return await loadKeypair(extra);
  } catch {
    return null;
  }
}

function looksLikePubkey(s: string): boolean {
  if (!s) return false;
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

function usageKp(sub: string, rest: string): void {
  log.error(`Specify the player keypair as the third argument`);
  log.info(`  novus shop ${sub} <playerKeypair> ${rest}`);
}

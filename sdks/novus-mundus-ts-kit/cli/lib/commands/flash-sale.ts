/**
 * `novus flash-sale <create|close|activate|list>` — flash sale management
 */

import BN from 'bn.js';
import { type CLIContext, type ParsedArgs } from '../context';
import { log, sendWithRetry } from '../helpers';
import {
  createCreateFlashSaleInstruction,
  createCloseSaleInstruction,
  createActivateSaleInstruction,
  deriveFlashSalePda,
  deriveShopConfigPda,
  parseShopConfig,
  parseFlashSale,
  FlashSaleStatus,
} from '../../../src/index';
import { section, table, dim, red, green, formatNum } from '../format';

const FLASH_SALE_STATUS_NAMES: Record<number, string> = {
  [FlashSaleStatus.Announced]: 'Announced',
  [FlashSaleStatus.Active]: 'Active',
  [FlashSaleStatus.Ended]: 'Ended',
  [FlashSaleStatus.SoldOut]: 'SoldOut',
};

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1 || idx + 1 >= flags.length) return undefined;
  return flags[idx + 1];
}

function hasFlag(flags: string[], name: string): boolean {
  return flags.includes(name);
}

function requireFlag(flags: string[], name: string): string {
  const val = getFlag(flags, name);
  if (val === undefined) {
    throw new Error(`Missing required flag: ${name}`);
  }
  return val;
}

async function getNextFlashSaleId(ctx: CLIContext): Promise<number> {
  const [configPda] = deriveShopConfigPda(ctx.gameEngine);
  const configInfo = await ctx.connection.getAccountInfo(configPda);
  if (!configInfo) {
    throw new Error('ShopConfig not found — run `novus init shop` first');
  }
  const config = parseShopConfig(configInfo);
  if (!config) {
    throw new Error('Failed to parse ShopConfig');
  }
  return config.nextFlashSaleId.toNumber();
}

async function handleCreate(ctx: CLIContext, flags: string[]): Promise<void> {
  const itemId = parseInt(requireFlag(flags, '--item'), 10);
  const isBundle = hasFlag(flags, '--bundle');
  const discountBps = parseInt(requireFlag(flags, '--discount'), 10);
  const durationSecs = parseInt(requireFlag(flags, '--duration'), 10);
  const startRaw = getFlag(flags, '--start');
  const stockRaw = getFlag(flags, '--stock');

  const startsAt = startRaw ? parseInt(startRaw, 10) : Math.floor(Date.now() / 1000);
  const maxStock = stockRaw ? parseInt(stockRaw, 10) : 0;

  if (discountBps > 5000) {
    log.error('Discount cannot exceed 5000 bps (50%)');
    return;
  }

  const saleId = await getNextFlashSaleId(ctx);

  log.info(`Creating flash sale #${saleId}:`);
  log.info(`  ${isBundle ? 'Bundle' : 'Item'} ID: ${itemId}`);
  log.info(`  Discount: ${discountBps} bps (${discountBps / 100}%)`);
  log.info(`  Duration: ${durationSecs}s`);
  log.info(`  Starts at: ${new Date(startsAt * 1000).toISOString()}`);
  log.info(`  Max stock: ${maxStock === 0 ? 'unlimited' : maxStock}`);

  if (ctx.dryRun) {
    log.dryRun('Would create flash sale');
    return;
  }

  const ix = createCreateFlashSaleInstruction(
    {
      payer: ctx.daoAuthority.publicKey,
      daoAuthority: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
      saleId,
    },
    {
      itemId,
      isBundle,
      discountBps,
      startsAt: new BN(startsAt),
      durationSecs,
      maxStock: new BN(maxStock),
    }
  );

  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  log.create(`Flash Sale #${saleId}`);
}

async function handleClose(ctx: CLIContext, flags: string[]): Promise<void> {
  const saleId = parseInt(requireFlag(flags, '--sale-id'), 10);

  log.info(`Closing flash sale #${saleId}`);

  if (ctx.dryRun) {
    log.dryRun(`Would close flash sale #${saleId}`);
    return;
  }

  const ix = createCloseSaleInstruction({
    rentRecipient: ctx.daoAuthority.publicKey,
    daoAuthority: ctx.daoAuthority.publicKey,
    gameEngine: ctx.gameEngine,
    saleId,
  });

  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  log.info(`  + Closed flash sale #${saleId}`);
}

async function handleActivate(ctx: CLIContext, flags: string[]): Promise<void> {
  const saleId = parseInt(requireFlag(flags, '--sale-id'), 10);

  log.info(`Activating flash sale #${saleId}`);

  if (ctx.dryRun) {
    log.dryRun(`Would activate flash sale #${saleId}`);
    return;
  }

  const ix = createActivateSaleInstruction({
    daoAuthority: ctx.daoAuthority.publicKey,
    gameEngine: ctx.gameEngine,
    saleId,
  });

  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  log.info(`  + Activated flash sale #${saleId}`);
}

async function handleList(ctx: CLIContext): Promise<void> {
  const nextId = await getNextFlashSaleId(ctx);

  if (nextId === 0) {
    log.info('No flash sales found.');
    return;
  }

  console.log(section(`Flash Sales — Kingdom ${ctx.kingdomId}`));

  const rows: string[][] = [];
  for (let id = 0; id < nextId; id++) {
    const [pda] = deriveFlashSalePda(ctx.gameEngine, id);
    const info = await ctx.connection.getAccountInfo(pda);

    if (!info) {
      rows.push([String(id), dim('closed'), dim('--'), dim('--'), dim('--'), dim('--'), dim('--'), dim('--')]);
      continue;
    }

    const sale = parseFlashSale(info);
    if (!sale) {
      rows.push([String(id), red('parse error'), dim('--'), dim('--'), dim('--'), dim('--'), dim('--'), dim('--')]);
      continue;
    }

    const statusName = FLASH_SALE_STATUS_NAMES[sale.status] ?? String(sale.status);
    const statusColored = sale.status === FlashSaleStatus.Active ? green(statusName) : statusName;

    rows.push([
      String(id),
      statusColored,
      sale.isBundle ? `B#${sale.itemId}` : `I#${sale.itemId}`,
      `${sale.discountBps} bps`,
      new Date(sale.startsAt.toNumber() * 1000).toISOString().slice(0, 19),
      new Date(sale.endsAt.toNumber() * 1000).toISOString().slice(0, 19),
      `${formatNum(sale.remainingStock)}/${formatNum(sale.maxStock)}`,
      formatNum(sale.totalClaims),
    ]);
  }

  console.log(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Status', width: 10 },
      { header: 'Target', width: 6 },
      { header: 'Discount', width: 8 },
      { header: 'Starts', width: 19 },
      { header: 'Ends', width: 19 },
      { header: 'Stock', width: 12 },
      { header: 'Claims', align: 'right' },
    ],
    rows
  ));
}

export async function handleFlashSale(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const subcommand = args.target;

  switch (subcommand) {
    case 'create':
      await handleCreate(ctx, args.flags);
      break;
    case 'close':
      await handleClose(ctx, args.flags);
      break;
    case 'activate':
      await handleActivate(ctx, args.flags);
      break;
    case 'list':
      await handleList(ctx);
      break;
    default:
      log.error(`Unknown flash-sale subcommand: ${subcommand || '(none)'}`);
      log.info('Usage: novus flash-sale <create|close|activate|list> [options]');
      log.info('');
      log.info('  create   --item <id> [--bundle] --discount <bps> --duration <secs> [--start <unix>] [--stock <n>]');
      log.info('  close    --sale-id <id>');
      log.info('  activate --sale-id <id>');
      log.info('  list');
  }
}

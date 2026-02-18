/**
 * Phase 6 — Shop Config + Items + Bundles
 */

import BN from 'bn.js';
import { type CLIContext } from '../context';
import {
  accountExists,
  createOrSkip,
  createOrUpdate,
  updateOnly,
  newStats,
  log,
  sendWithRetry,
  type PhaseStats,
} from '../helpers';
import {
  createInitializeConfigInstruction,
  createCreateItemInstruction,
  createUpdateItemInstruction,
  createCreateBundleInstruction,
  createUpdateBundleInstruction,
  createUpdateConfigInstruction,
  createCreateFlashSaleInstruction,
  createActivateSaleInstruction,
  deriveShopConfigPda,
  deriveShopItemPda,
  deriveBundlePda,
  deriveFlashSalePda,
  parseShopConfig,
  parseShopItem,
  parseBundle,
  parseFlashSale,
  FlashSaleStatus,
} from '../../../src/index';
import { SHOP_ITEMS, SHOP_BUNDLES } from '../../data/shop-items';
import { FLASH_SALES } from '../../data/flash-sales';
import {
  section, table, bold, dim, green, red, formatNum, formatSol,
  check, statusBadge, stockLabel,
} from '../format';

export async function initShop(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  // Step 1: ShopConfig
  log.info('  [1/4] ShopConfig');
  const [configPda] = deriveShopConfigPda(ctx.gameEngine);
  await createOrSkip(
    ctx,
    'ShopConfig',
    configPda,
    () => createInitializeConfigInstruction({
      payer: ctx.daoAuthority.publicKey,
      daoAuthority: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
    }),
    stats
  );

  // Step 2: Items
  log.info(`  [2/4] Items (${SHOP_ITEMS.length})`);
  for (const item of SHOP_ITEMS) {
    const [itemPda] = deriveShopItemPda(ctx.gameEngine, item.itemId);
    await createOrUpdate(
      ctx,
      `Shop Item #${item.itemId} (${item.name})`,
      itemPda,
      () => createCreateItemInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          itemId: item.itemId,
          itemType: item.itemType,
          category: item.category,
          rarity: item.rarity,
          quantityPerPurchase: item.quantityPerPurchase,
          baseStatsBps: item.baseStatsBps,
          priceSolLamports: new BN(item.priceSolLamports),
          maxGlobalStock: new BN(item.maxGlobalStock),
          maxPerPlayer: item.maxPerPlayer,
          maxPerDay: item.maxPerDay,
          isActive: item.isActive,
          isFeatured: item.isFeatured,
        }
      ),
      () => {
        const ixs = createUpdateItemInstruction(
          {
            daoAuthority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            itemId: item.itemId,
          },
          {
            priceSolLamports: new BN(item.priceSolLamports),
            isActive: item.isActive,
            isFeatured: item.isFeatured,
          }
        );
        return Array.isArray(ixs) ? ixs : [ixs];
      },
      stats
    );
  }

  // Step 3: Bundles
  log.info(`  [3/4] Bundles (${SHOP_BUNDLES.length})`);
  for (const bundle of SHOP_BUNDLES) {
    const [bundlePda] = deriveBundlePda(ctx.gameEngine, bundle.bundleId);
    await createOrUpdate(
      ctx,
      `Bundle #${bundle.bundleId} (${bundle.name})`,
      bundlePda,
      () => createCreateBundleInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          bundleId: bundle.bundleId,
          tier: bundle.tier,
          category: bundle.category,
          requiresSubscription: bundle.requiresSubscription,
          savingsBps: bundle.savingsBps,
          priceSolLamports: new BN(bundle.priceSolLamports),
          availableFrom: new BN(0),
          availableUntil: new BN(0),
          isActive: bundle.isActive,
          items: bundle.items,
        }
      ),
      () => createUpdateBundleInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          bundleId: bundle.bundleId,
        },
        {
          priceSolLamports: new BN(bundle.priceSolLamports),
          isActive: bundle.isActive,
          savingsBps: bundle.savingsBps,
        }
      ),
      stats
    );
  }

  // Step 4: Flash Sales
  log.info(`  [4/4] Flash Sales (${FLASH_SALES.length})`);
  if (FLASH_SALES.length > 0) {
    const [configPda] = deriveShopConfigPda(ctx.gameEngine);
    const configInfo = await ctx.connection.getAccountInfo(configPda);
    const config = configInfo ? parseShopConfig(configInfo) : null;
    let nextSaleId = config ? config.nextFlashSaleId.toNumber() : 0;

    for (const sale of FLASH_SALES) {
      const saleId = nextSaleId;
      const [salePda] = deriveFlashSalePda(ctx.gameEngine, saleId);
      const startsAt = sale.autoActivate ? Math.floor(Date.now() / 1000) : 0;

      const created = await createOrSkip(
        ctx,
        `Flash Sale #${saleId} (${sale.isBundle ? 'Bundle' : 'Item'} ${sale.itemId})`,
        salePda,
        () => createCreateFlashSaleInstruction(
          {
            payer: ctx.daoAuthority.publicKey,
            daoAuthority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            saleId,
          },
          {
            itemId: sale.itemId,
            isBundle: sale.isBundle,
            discountBps: sale.discountBps,
            startsAt: new BN(startsAt),
            durationSecs: sale.durationSecs,
            maxStock: new BN(sale.maxStock),
          }
        ),
        stats
      );

      if (created && sale.autoActivate && !ctx.dryRun) {
        const activateIx = createActivateSaleInstruction({
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          saleId,
        });
        await sendWithRetry(ctx, activateIx, [ctx.daoAuthority]);
        log.info(`  + Activated Flash Sale #${saleId}`);
      }

      nextSaleId++;
    }
  }

  return stats;
}

export async function updateShop(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  // Update items
  for (const item of SHOP_ITEMS) {
    const [itemPda] = deriveShopItemPda(ctx.gameEngine, item.itemId);
    await updateOnly(
      ctx,
      `Shop Item #${item.itemId} (${item.name})`,
      itemPda,
      () => {
        const ixs = createUpdateItemInstruction(
          {
            daoAuthority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            itemId: item.itemId,
          },
          {
            priceSolLamports: new BN(item.priceSolLamports),
            isActive: item.isActive,
            isFeatured: item.isFeatured,
          }
        );
        return Array.isArray(ixs) ? ixs : [ixs];
      },
      stats
    );
  }

  // Update bundles
  for (const bundle of SHOP_BUNDLES) {
    const [bundlePda] = deriveBundlePda(ctx.gameEngine, bundle.bundleId);
    await updateOnly(
      ctx,
      `Bundle #${bundle.bundleId} (${bundle.name})`,
      bundlePda,
      () => createUpdateBundleInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          bundleId: bundle.bundleId,
        },
        {
          priceSolLamports: new BN(bundle.priceSolLamports),
          isActive: bundle.isActive,
          savingsBps: bundle.savingsBps,
        }
      ),
      stats
    );
  }

  return stats;
}

export async function statusShop(ctx: CLIContext): Promise<string> {
  const [configPda] = deriveShopConfigPda(ctx.gameEngine);
  const configInfo = await ctx.connection.getAccountInfo(configPda);
  if (!configInfo) return 'missing';

  const config = parseShopConfig(configInfo);
  const flashSaleCount = config ? config.nextFlashSaleId.toNumber() : 0;

  // Scan items: stop after 5 consecutive misses
  let items = 0;
  let consecutiveMisses = 0;
  for (let id = 0; consecutiveMisses < 5; id++) {
    const [pda] = deriveShopItemPda(ctx.gameEngine, id);
    if (await accountExists(ctx.connection, pda)) {
      items++;
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
    }
  }

  // Scan bundles: stop after 5 consecutive misses
  let bundles = 0;
  consecutiveMisses = 0;
  for (let id = 0; consecutiveMisses < 5; id++) {
    const [pda] = deriveBundlePda(ctx.gameEngine, id);
    if (await accountExists(ctx.connection, pda)) {
      bundles++;
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
    }
  }

  return `Config + ${items} items + ${bundles} bundles + ${flashSaleCount} flash sales`;
}

const CATEGORY_NAMES = ['Equipment', 'Consumable', 'Material', 'Cosmetic', 'Currency'];
const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

const ITEM_NAMES: Record<number, string> = {};
for (const item of SHOP_ITEMS) ITEM_NAMES[item.itemId] = item.name;
const BUNDLE_NAMES: Record<number, string> = {};
for (const bundle of SHOP_BUNDLES) BUNDLE_NAMES[bundle.bundleId] = bundle.name;

export async function detailShop(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Shop — Kingdom ${ctx.kingdomId}`));

  // Config
  const [configPda] = deriveShopConfigPda(ctx.gameEngine);
  const configInfo = await ctx.connection.getAccountInfo(configPda);
  if (!configInfo) {
    lines.push(red('  ShopConfig not found\n'));
    return lines.join('\n');
  }
  const config = parseShopConfig(configInfo);
  if (config) {
    lines.push(`  Config: ${statusBadge(true)}  Total SOL: ${formatSol(config.totalSolCollected)}  NOVI Burned: ${formatNum(config.totalNoviBurned)}\n`);
  }

  // Items — scan on-chain, stop after 5 consecutive misses
  lines.push(section('Items'));
  const itemRows: string[][] = [];
  {
    let consecutiveMisses = 0;
    for (let id = 0; consecutiveMisses < 5; id++) {
      const [pda] = deriveShopItemPda(ctx.gameEngine, id);
      const info = await ctx.connection.getAccountInfo(pda);
      if (!info) { consecutiveMisses++; continue; }
      consecutiveMisses = 0;

      try {
        const data = parseShopItem(info);
        itemRows.push([
          String(id),
          ITEM_NAMES[id] || 'Item #' + id,
          CATEGORY_NAMES[data.category] ?? String(data.category),
          RARITY_NAMES[data.rarity] ?? String(data.rarity),
          formatSol(data.priceSolLamports),
          check(data.isActive),
          check(data.isFeatured),
          stockLabel(data.maxGlobalStock),
          formatNum(data.currentGlobalStock),
        ]);
      } catch {
        itemRows.push([
          String(id), ITEM_NAMES[id] || 'Item #' + id,
          red('BAD DATA'), dim('--'), dim('--'), dim('--'), dim('--'), dim('--'), dim('--'),
        ]);
      }
    }
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Name', width: 20 },
      { header: 'Category', width: 10 },
      { header: 'Rarity', width: 9 },
      { header: 'Price', align: 'right' },
      { header: 'Active', width: 6 },
      { header: 'Feat', width: 4 },
      { header: 'Stock', align: 'right' },
      { header: 'Sold', align: 'right' },
    ],
    itemRows
  ));

  // Bundles — scan on-chain, stop after 5 consecutive misses
  lines.push(section('Bundles'));
  const bundleRows: string[][] = [];
  {
    let consecutiveMisses = 0;
    for (let id = 0; consecutiveMisses < 5; id++) {
      const [pda] = deriveBundlePda(ctx.gameEngine, id);
      const info = await ctx.connection.getAccountInfo(pda);
      if (!info) { consecutiveMisses++; continue; }
      consecutiveMisses = 0;

      try {
        const data = parseBundle(info);
        bundleRows.push([
          String(id),
          BUNDLE_NAMES[id] || 'Bundle #' + id,
          formatSol(data.priceSolLamports),
          `${data.savingsBps / 100}%`,
          check(data.isActive),
          formatNum(data.totalPurchases),
          formatSol(data.totalRevenueLamports),
        ]);
      } catch {
        bundleRows.push([
          String(id), BUNDLE_NAMES[id] || 'Bundle #' + id,
          red('BAD DATA'), dim('--'), dim('--'), dim('--'), dim('--'),
        ]);
      }
    }
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Name', width: 16 },
      { header: 'Price', align: 'right' },
      { header: 'Save', align: 'right' },
      { header: 'Active', width: 6 },
      { header: 'Sold', align: 'right' },
      { header: 'Revenue', align: 'right' },
    ],
    bundleRows
  ));

  lines.push('');
  return lines.join('\n');
}

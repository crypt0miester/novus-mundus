/**
 * Phase 3 — Hero Collection + 79 templates
 */

import { type CLIContext } from '../context';
import {
  accountExists,
  createOrSkip,
  newStats,
  log,
  sendWithRetry,
  type PhaseStats,
} from '../helpers';
import {
  createCreateCollectionInstruction,
  createCreateTemplateInstruction,
  createUpdateSupplyCapInstruction,
  deriveHeroCollectionPda,
  deriveHeroTemplatePda,
  parseHeroTemplate,
} from '../../../src/index';
import { HERO_TEMPLATES } from '../../data/heroes';
import {
  section, table, bold, dim, green, red, yellow, formatNum, formatSol,
  check, statusBadge, stockLabel,
} from '../format';

export async function initHeroes(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  // Step 1: Hero Collection
  const [collectionPda] = await deriveHeroCollectionPda();
  await createOrSkip(
    ctx,
    'Hero Collection',
    collectionPda,
    () => createCreateCollectionInstruction({
      daoAuthority: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
    }),
    stats
  );

  // Step 2: Templates (batched 8 at a time)
  const batchSize = 8;
  for (let i = 0; i < HERO_TEMPLATES.length; i += batchSize) {
    const batch = HERO_TEMPLATES.slice(i, i + batchSize);

    const promises = batch.map(async (template) => {
      const [templatePda] = await deriveHeroTemplatePda(template.templateId);
      const exists = await accountExists(ctx.connection, templatePda);

      if (!exists) {
        if (ctx.dryRun) {
          log.dryRun(`Would create: Hero Template #${template.templateId} (${template.name})`);
          stats.created++;
          return;
        }
        const ix = createCreateTemplateInstruction(
          {
            daoAuthority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
          },
          {
            templateId: template.templateId,
            name: template.name,
            heroType: template.heroType,
            category: template.category,
            mintCostSol: BigInt(template.mintCostLamports),
            supplyCap: template.supplyCap,
            enabled: template.enabled,
            eventExclusive: template.eventExclusive,
            requiredPlayerLevel: template.requiredPlayerLevel,
            meditationCityId: template.meditationCityId,
            buffs: template.buffs,
            abilityKind: template.abilityKind ?? 0,
            abilityStat: template.abilityStat ?? 0,
            abilityParam1: template.abilityParam1 ?? 0,
            abilityParam2: template.abilityParam2 ?? 0,
            abilityCooldownSecs: template.abilityCooldownSecs ?? 0,
          }
        );
        await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
        log.create(`Hero Template #${template.templateId} (${template.name})`);
        stats.created++;
      } else {
        // Exists — check if supply cap needs update (skip for now, just skip)
        log.skip(`Hero Template #${template.templateId} (${template.name})`);
        stats.skipped++;
      }
    });

    await Promise.all(promises);
  }

  return stats;
}

export async function updateHeroSupplyCaps(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  for (const template of HERO_TEMPLATES) {
    const [templatePda] = await deriveHeroTemplatePda(template.templateId);
    const exists = await accountExists(ctx.connection, templatePda);

    if (!exists) {
      log.error(`Hero Template #${template.templateId} does not exist — use 'init heroes' first`);
      continue;
    }

    if (ctx.dryRun) {
      log.dryRun(`Would update supply cap: Hero #${template.templateId}`);
      stats.updated++;
      continue;
    }

    const ix = createUpdateSupplyCapInstruction(
      {
        daoAuthority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
      },
      {
        templateId: template.templateId,
        newSupplyCap: template.supplyCap,
      }
    );
    await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
    log.update(`Hero Template #${template.templateId} supply cap`);
    stats.updated++;
  }

  return stats;
}

export async function statusHeroes(ctx: CLIContext): Promise<string> {
  const [collectionPda] = await deriveHeroCollectionPda();
  const collectionExists = await accountExists(ctx.connection, collectionPda);

  if (!collectionExists) return 'missing';

  let templateCount = 0;
  let misses = 0;
  for (let id = 0; misses < 5; id++) {
    const [pda] = await deriveHeroTemplatePda(id);
    if (await accountExists(ctx.connection, pda)) {
      templateCount++;
      misses = 0;
    } else {
      misses++;
    }
  }

  return `Collection + ${templateCount} templates`;
}

const HERO_TYPE_NAMES = ['Offensive', 'Defensive', 'Economic', 'Hybrid'];
const HERO_CATEGORY_NAMES = ['Historical', 'Mythological', 'CryptoIcons', 'Gaming', 'Original'];

export async function detailHeroes(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Hero Templates — Kingdom ${ctx.kingdomId}`));

  const [collectionPda] = await deriveHeroCollectionPda();
  const collectionExists = await accountExists(ctx.connection, collectionPda);
  lines.push(`  Collection: ${statusBadge(collectionExists)}\n`);

  const rows: string[][] = [];
  let misses = 0;
  for (let id = 0; misses < 5; id++) {
    const [pda] = await deriveHeroTemplatePda(id);
    const info = await ctx.connection.getAccountInfo(pda);

    if (!info) {
      misses++;
      continue;
    }
    misses = 0;

    try {
      const data = parseHeroTemplate(info);
      if (!data) throw new Error('null');

      rows.push([
        String(data.templateId),
        data.name || `Hero #${data.templateId}`,
        HERO_TYPE_NAMES[data.heroType] ?? String(data.heroType),
        HERO_CATEGORY_NAMES[data.category] ?? String(data.category),
        formatSol(data.mintCostSol),
        stockLabel(data.supplyCap),
        check(data.enabled),
        green('on-chain'),
      ]);
    } catch {
      rows.push([
        String(id),
        dim('--'),
        dim('--'),
        dim('--'),
        dim('--'),
        dim('--'),
        dim('--'),
        red('BAD DATA'),
      ]);
    }
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 4 },
      { header: 'Name', width: 22 },
      { header: 'Type', width: 10 },
      { header: 'Category', width: 13 },
      { header: 'Cost', align: 'right' },
      { header: 'Cap', align: 'right' },
      { header: 'On', width: 3 },
      { header: 'Status' },
    ],
    rows
  ));

  lines.push('');
  return lines.join('\n');
}

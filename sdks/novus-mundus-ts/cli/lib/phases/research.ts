/**
 * Phase 4 — Research Templates (30 nodes)
 */

import { type CLIContext } from '../context';
import {
  accountExists,
  createOrUpdate,
  updateOnly,
  newStats,
  log,
  type PhaseStats,
} from '../helpers';
import {
  createInitializeTemplateInstruction,
  createUpdateTemplateInstruction,
  deriveResearchTemplatePda,
  parseResearchTemplate,
  RESEARCH_CATEGORY_NAMES,
  getResearchName,
} from '../../../src/index';
import { RESEARCH_TEMPLATES, type ResearchTemplateData } from '../../data/research';
import {
  section, table, bold, dim, green, red, formatNum, formatBps,
  formatDuration, check, statusBadge,
} from '../format';

/**
 * Full update-param set for a template, synced from the catalog. The on-chain
 * update_template processor patches one field per call; the SDK builder turns
 * this into one instruction per field.
 */
function templateUpdateParams(t: ResearchTemplateData) {
  return {
    baseTimeSeconds: t.baseTimeSeconds,
    baseCost: BigInt(t.baseNoviCost),
    buffPerLevelBps: t.buffPerLevelBps,
    gemCostPerMinute: t.gemCostPerMinute,
    isActive: t.isActive,
    maxLevel: t.maxLevel,
    prerequisiteResearch: t.prerequisiteResearch,
    prerequisiteLevel: t.prerequisiteLevel,
  };
}

export async function initResearch(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  for (const template of RESEARCH_TEMPLATES) {
    const [templatePda] = await deriveResearchTemplatePda(template.researchType);

    await createOrUpdate(
      ctx,
      `Research #${template.researchType} (${template.name})`,
      templatePda,
      () => createInitializeTemplateInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          researchType: template.researchType,
          category: template.category,
          maxLevel: template.maxLevel,
          baseTimeSeconds: template.baseTimeSeconds,
          baseCost: BigInt(template.baseNoviCost),
          buffType: template.buffType,
          buffPerLevelBps: template.buffPerLevelBps,
          prerequisiteType: template.prerequisiteResearch === 255 ? -1 : template.prerequisiteResearch,
          prerequisiteLevel: template.prerequisiteLevel,
          gemCostPerMinute: template.gemCostPerMinute,
        }
      ),
      () => createUpdateTemplateInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          researchType: template.researchType,
        },
        templateUpdateParams(template),
      ),
      stats
    );
  }

  return stats;
}

export async function updateResearch(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  for (const template of RESEARCH_TEMPLATES) {
    const [templatePda] = await deriveResearchTemplatePda(template.researchType);

    await updateOnly(
      ctx,
      `Research #${template.researchType} (${template.name})`,
      templatePda,
      () => createUpdateTemplateInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          researchType: template.researchType,
        },
        templateUpdateParams(template),
      ),
      stats
    );
  }

  return stats;
}

export async function statusResearch(ctx: CLIContext): Promise<string> {
  let count = 0;
  for (let id = 0; id < 30; id++) {
    const [pda] = await deriveResearchTemplatePda(id);
    if (await accountExists(ctx.connection, pda)) count++;
  }
  return `${count} templates`;
}

export async function detailResearch(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Research Templates — Kingdom ${ctx.kingdomId}`));

  const rows: string[][] = [];
  let consecutiveMisses = 0;

  for (let id = 0; id <= 34; id++) {
    const [pda] = await deriveResearchTemplatePda(id);
    const info = await ctx.connection.getAccountInfo(pda);

    if (!info) {
      consecutiveMisses++;
      if (consecutiveMisses >= 5) break;
      continue;
    }
    consecutiveMisses = 0;

    try {
      const data = parseResearchTemplate(info);
      if (!data) throw new Error('null');

      const prereq = data.prerequisiteResearch === 255
        ? dim('none')
        : '#' + data.prerequisiteResearch + ' L' + data.prerequisiteLevel;

      rows.push([
        String(data.researchType),
        getResearchName(data.researchType),
        RESEARCH_CATEGORY_NAMES[data.category] ?? String(data.category),
        String(data.maxLevel),
        formatDuration(data.baseTimeSeconds),
        formatNum(data.baseNoviCost),
        formatBps(data.buffPerLevelBps),
        prereq,
        green('on-chain'),
      ]);
    } catch {
      rows.push([
        String(id), red('BAD DATA'), '', '', '', '', '', '', red('BAD DATA'),
      ]);
    }
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Name', width: 22 },
      { header: 'Category', width: 9 },
      { header: 'Max', align: 'right', width: 3 },
      { header: 'Base Time', align: 'right' },
      { header: 'Cost', align: 'right' },
      { header: 'Buff/Lvl', align: 'right' },
      { header: 'Prereq' },
      { header: 'Status' },
    ],
    rows
  ));

  lines.push('');
  return lines.join('\n');
}

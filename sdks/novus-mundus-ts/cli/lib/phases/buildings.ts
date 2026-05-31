/**
 * Phase — Building Templates (19 buildings)
 *
 * Seeds the on-chain BuildingTemplate config the estate build/upgrade
 * processors read for cost & time.
 */

import { type CLIContext } from '../context';
import {
  createOrUpdate,
  updateOnly,
  newStats,
  type PhaseStats,
} from '../helpers';
import {
  createInitializeBuildingTemplateInstruction,
  createUpdateBuildingTemplateInstruction,
  deriveBuildingTemplatePda,
  parseBuildingTemplate,
} from '../../../src/index';
import { BUILDING_TEMPLATES, type BuildingTemplateData } from '../../data/buildings';
import {
  section, table, dim, green, red, formatNum, formatDuration,
} from '../format';

/** Full-sync update — one field-update instruction per template field. */
function updateInstructions(ctx: CLIContext, t: BuildingTemplateData) {
  const accounts = {
    daoAuthority: ctx.daoAuthority.publicKey,
    gameEngine: ctx.gameEngine,
    buildingType: t.buildingType,
  };
  return [
    createUpdateBuildingTemplateInstruction(accounts, { field: 'baseNoviCost', value: BigInt(t.baseNoviCost) }),
    createUpdateBuildingTemplateInstruction(accounts, { field: 'baseTimeSeconds', value: t.baseTimeSeconds }),
    createUpdateBuildingTemplateInstruction(accounts, { field: 'costGrowthBps', value: t.costGrowthBps }),
    createUpdateBuildingTemplateInstruction(accounts, { field: 'timeGrowthBps', value: t.timeGrowthBps }),
    createUpdateBuildingTemplateInstruction(accounts, { field: 'maxLevel', value: t.maxLevel }),
    createUpdateBuildingTemplateInstruction(accounts, { field: 'tier', value: t.tier }),
  ];
}

export async function initBuildings(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  for (const t of BUILDING_TEMPLATES) {
    const [pda] = await deriveBuildingTemplatePda(t.buildingType);

    await createOrUpdate(
      ctx,
      `Building #${t.buildingType} (${t.name})`,
      pda,
      () => createInitializeBuildingTemplateInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          buildingType: t.buildingType,
          tier: t.tier,
          maxLevel: t.maxLevel,
          baseTimeSeconds: t.baseTimeSeconds,
          baseNoviCost: BigInt(t.baseNoviCost),
          costGrowthBps: t.costGrowthBps,
          timeGrowthBps: t.timeGrowthBps,
        }
      ),
      () => updateInstructions(ctx, t),
      stats
    );
  }

  return stats;
}

export async function updateBuildings(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  for (const t of BUILDING_TEMPLATES) {
    const [pda] = await deriveBuildingTemplatePda(t.buildingType);
    await updateOnly(
      ctx,
      `Building #${t.buildingType} (${t.name})`,
      pda,
      () => updateInstructions(ctx, t),
      stats
    );
  }

  return stats;
}

export async function statusBuildings(ctx: CLIContext): Promise<string> {
  const pdas = await Promise.all(
    BUILDING_TEMPLATES.map(async (t) => (await deriveBuildingTemplatePda(t.buildingType))[0]),
  );
  const infos = await ctx.connection.getMultipleAccountsInfo(pdas);
  const count = infos.filter((i) => i !== null).length;
  return `${count}/${BUILDING_TEMPLATES.length} templates`;
}

const BUILDING_NAMES: Record<number, string> = {};
for (const t of BUILDING_TEMPLATES) BUILDING_NAMES[t.buildingType] = t.name;

export async function detailBuildings(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Building Templates — Kingdom ${ctx.kingdomId}`));

  const pdas = await Promise.all(
    BUILDING_TEMPLATES.map(async (t) => (await deriveBuildingTemplatePda(t.buildingType))[0]),
  );
  const infos = await ctx.connection.getMultipleAccountsInfo(pdas);
  const rows: string[][] = [];

  BUILDING_TEMPLATES.forEach((t, i) => {
    const info = infos[i];

    if (!info) {
      rows.push([
        String(t.buildingType), BUILDING_NAMES[t.buildingType] ?? '?',
        String(t.tier), '', '', '', dim('missing'),
      ]);
      return;
    }

    try {
      const data = parseBuildingTemplate(info);
      if (!data) throw new Error('null');
      rows.push([
        String(data.buildingType),
        BUILDING_NAMES[data.buildingType] ?? 'Building #' + data.buildingType,
        String(data.tier),
        String(data.maxLevel),
        formatDuration(data.baseTimeSeconds),
        formatNum(data.baseNoviCost),
        data.isActive ? green('on-chain') : red('disabled'),
      ]);
    } catch {
      rows.push([
        String(t.buildingType), red('BAD DATA'), '', '', '', '', red('BAD DATA'),
      ]);
    }
  });

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Name', width: 20 },
      { header: 'Tier', align: 'right', width: 4 },
      { header: 'Max', align: 'right', width: 3 },
      { header: 'Base Time', align: 'right' },
      { header: 'Base Cost', align: 'right' },
      { header: 'Status' },
    ],
    rows
  ));

  lines.push('');
  return lines.join('\n');
}

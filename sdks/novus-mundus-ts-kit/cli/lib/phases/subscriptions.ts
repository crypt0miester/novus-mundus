/**
 * Phase 5 — Subscription Tiers (read-only — tiers set during GameEngine init)
 */

import { type CLIContext } from '../context';
import { newStats, log, type PhaseStats } from '../helpers';
import { parseGameEngine, type SubscriptionTierConfig } from '../../../src/index';
import {
  section, table, dim, formatNum, formatBps, formatUsd,
} from '../format';

async function fetchTiers(ctx: CLIContext): Promise<SubscriptionTierConfig[] | null> {
  const info = await ctx.connection.getAccountInfo(ctx.gameEngine);
  if (!info) return null;
  const ge = parseGameEngine(info);
  return ge?.subscriptionTiers ?? null;
}

export async function initSubscriptions(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const tiers = await fetchTiers(ctx);
  if (!tiers || tiers.length === 0) {
    log.error('GameEngine not found or no tiers — run Phase 1 first');
    return stats;
  }
  for (const tier of tiers) {
    log.skip(`${tier.name} tier (on-chain)`);
    stats.skipped++;
  }
  return stats;
}

export async function updateSubscriptions(ctx: CLIContext): Promise<PhaseStats> {
  // Tiers are managed in Rust GameEngine init — nothing to update from CLI.
  return initSubscriptions(ctx);
}

export async function statusSubscriptions(ctx: CLIContext): Promise<string> {
  const tiers = await fetchTiers(ctx);
  if (!tiers) return 'GameEngine not found';
  return `${tiers.length} tiers on-chain`;
}

export async function detailSubscriptions(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Subscription Tiers — Kingdom ${ctx.kingdomId}`));

  const tiers = await fetchTiers(ctx);
  if (!tiers || tiers.length === 0) {
    lines.push(dim('  GameEngine not found or no tiers configured\n'));
    return lines.join('\n');
  }

  lines.push(dim('  (from on-chain GameEngine)\n'));

  const rows: string[][] = tiers.map(t => [
    String(t.tierIndex),
    t.name,
    formatUsd(t.costInUsdCents.toNumber()),
    t.durationDays === 0 ? dim('free') : `${t.durationDays}d`,
    formatBps(t.generationMultiplier.toNumber()),
    formatBps(t.dailyRewardMultiplier.toNumber()),
    formatBps(t.synchronyBonus),
    formatNum(t.maxLockedNovi),
    String(t.maxTeamMembers),
    formatBps(t.travelSpeedBonusBps),
  ]);

  lines.push(table(
    [
      { header: '#', align: 'right', width: 2 },
      { header: 'Tier', width: 11 },
      { header: 'Price', align: 'right' },
      { header: 'Dur', align: 'right' },
      { header: 'Gen', align: 'right' },
      { header: 'Daily', align: 'right' },
      { header: 'Sync', align: 'right' },
      { header: 'Max NOVI', align: 'right' },
      { header: 'Team', align: 'right' },
      { header: 'Speed', align: 'right' },
    ],
    rows
  ));

  // Item grants summary
  lines.push(section('Starter Items Per Tier'));
  lines.push(table(
    [
      { header: 'Tier', width: 11 },
      { header: 'NOVI', align: 'right' },
      { header: 'Cash', align: 'right' },
      { header: 'DU', align: 'right' },
      { header: 'OP', align: 'right' },
      { header: 'Weapons', align: 'right' },
      { header: 'Armor', align: 'right' },
      { header: 'XP', align: 'right' },
      { header: 'Rep', align: 'right' },
    ],
    tiers.map(t => [
      t.name,
      formatNum(t.novi),
      formatNum(t.cash),
      `${formatNum(t.du1)}/${formatNum(t.du2)}/${formatNum(t.du3)}`,
      `${formatNum(t.op1)}/${formatNum(t.op2)}/${formatNum(t.op3)}`,
      `${formatNum(t.meleeWeapons)}/${formatNum(t.rangedWeapons)}/${formatNum(t.siegeWeapons)}`,
      formatNum(t.armor),
      formatNum(t.xp),
      formatNum(t.reputation),
    ])
  ));

  lines.push('');
  return lines.join('\n');
}

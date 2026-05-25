/**
 * Phase 1 — GameEngine + NOVI mint
 */

import { type CLIContext } from '../context';
import { createOrSkip, newStats, log, type PhaseStats } from '../helpers';
import {
  createInitGameEngineInstruction,
  deriveNoviMintPda,
  parseGameEngine,
} from '../../../src/index';
import {
  section, table, bold, dim, green, red, addr, formatNum, formatBps,
  check, statusBadge, formatUsd,
} from '../format';

export async function initEngine(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  // GameEngine
  await createOrSkip(
    ctx,
    'GameEngine',
    ctx.gameEngine,
    () => createInitGameEngineInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        treasuryWallet: ctx.treasury.publicKey,
        kingdomId: ctx.kingdomId,
      },
      {
        kingdomName: ctx.kingdomName,
        theme: ctx.theme,
        kingdomStartTime: ctx.kingdomStartTime,
        registrationClosesAt: ctx.registrationClosesAt,
      }
    ),
    stats
  );

  return stats;
}

export async function statusEngine(ctx: CLIContext): Promise<string> {
  const info = await ctx.connection.getAccountInfo(ctx.gameEngine);
  if (!info) return 'missing';
  const authority = ctx.daoAuthority.publicKey.toBase58();
  return `Authority: ${authority.slice(0, 4)}..${authority.slice(-4)}`;
}

export async function detailEngine(ctx: CLIContext): Promise<string> {
  const info = await ctx.connection.getAccountInfo(ctx.gameEngine);
  if (!info) return red('GameEngine account not found');

  const ge = parseGameEngine(info);
  if (!ge) return red('Failed to deserialize GameEngine');

  const lines: string[] = [];
  lines.push(section(`GameEngine — Kingdom ${ctx.kingdomId}`));

  lines.push(table(
    [
      { header: 'Field', width: 24 },
      { header: 'Value' },
    ],
    [
      ['Authority',       addr(ge.authority)],
      ['Payment Auth',    addr(ge.paymentAuthority)],
      ['Game Auth',       addr(ge.gameAuthority)],
      ['Treasury',        addr(ge.treasuryWallet)],
      ['NOVI Mint',       addr(ge.noviMint)],
      ['Version',         ge.version.toString()],
      ['Paused',          check(!ge.paused) === check(true) ? green('running') : red('PAUSED')],
      ['Total Players',   formatNum(ge.totalPlayers)],
      ['Max Players',     formatNum(ge.maxPlayers)],
      ['Offchain Pay',    check(ge.allowOffchainPayments)],
    ]
  ));

  // Subscription tiers summary
  if (ge.subscriptionTiers && ge.subscriptionTiers.length > 0) {
    lines.push(section('Subscription Tiers'));
    lines.push(table(
      [
        { header: 'Tier', align: 'right', width: 4 },
        { header: 'Name', width: 12 },
        { header: 'Price', align: 'right' },
        { header: 'Duration', align: 'right' },
        { header: 'Gen Mult', align: 'right' },
        { header: 'Daily Mult', align: 'right' },
      ],
      ge.subscriptionTiers.map((t: any, i: number) => [
        String(i),
        t.name || `Tier ${i}`,
        formatUsd(t.costInUsdCents?.toNumber?.() ?? t.costInUsdCents ?? 0),
        `${t.durationDays?.toNumber?.() ?? t.durationDays ?? 0}d`,
        formatBps(t.generationMultiplier?.toNumber?.() ?? t.generationMultiplier ?? 0),
        formatBps(t.dailyRewardMultiplier?.toNumber?.() ?? t.dailyRewardMultiplier ?? 0),
      ])
    ));
  }

  lines.push('');
  return lines.join('\n');
}

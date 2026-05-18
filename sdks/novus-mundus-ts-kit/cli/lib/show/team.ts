/**
 * show team — List all teams or show detailed team state
 */

import { PublicKey } from '@solana/web3.js';
import type { NovusMundusClient } from '../../../src/client';
import type { CLIContext } from '../context';
import { log } from '../helpers';
import {
  table, section, addr, formatNum, formatDate, dim, check,
  type Column,
} from '../format';
import { deriveTeamPda } from '../../../src/pda';
import { TeamMemberRank } from '../../../src/types/enums';
import { TeamSettings, TeamPermissions } from '../../../src/state/team';

const RANK_NAMES: Record<number, string> = {
  [TeamMemberRank.Member]: 'Member',
  [TeamMemberRank.Officer]: 'Officer',
  [TeamMemberRank.CoLeader]: 'Co-Leader',
  [TeamMemberRank.Leader]: 'Leader',
};

const PERM_LABELS = [
  { flag: TeamPermissions.INVITE, label: 'Invite' },
  { flag: TeamPermissions.KICK, label: 'Kick' },
  { flag: TeamPermissions.MOTD, label: 'MOTD' },
  { flag: TeamPermissions.PROMOTE, label: 'Promote' },
  { flag: TeamPermissions.TREASURY, label: 'Treasury' },
  { flag: TeamPermissions.SETTINGS, label: 'Settings' },
];

export async function showAllTeams(client: NovusMundusClient, ctx: CLIContext): Promise<void> {
  const teams = await client.fetchAllTeams({ activeOnly: true });

  log.info(section(`Teams — Kingdom ${ctx.kingdomId} (${teams.length} active)`));

  if (teams.length === 0) {
    log.info(dim('  No active teams found.'));
    return;
  }

  const cols: Column[] = [
    { header: 'ID', align: 'right', width: 4 },
    { header: 'Name', width: 16 },
    { header: 'Leader' },
    { header: 'Members', align: 'right', width: 8 },
    { header: 'Treasury', align: 'right', width: 10 },
    { header: 'Min Level', align: 'right', width: 9 },
  ];

  const rows = teams
    .sort((a, b) => a.account.id.cmp(b.account.id))
    .map(({ account: t }) => [
      t.id.toString(),
      t.name || dim('--'),
      addr(t.leader),
      `${t.memberCount}/${t.maxMembers}`,
      formatNum(t.treasury),
      String(t.minLevelToJoin),
    ]);

  log.info(table(cols, rows));
}

export async function showTeam(client: NovusMundusClient, ctx: CLIContext, teamIdStr: string): Promise<void> {
  const teamId = parseInt(teamIdStr, 10);
  if (isNaN(teamId)) {
    log.error(`Invalid team ID: ${teamIdStr}`);
    return;
  }

  const result = await client.fetchTeam(teamId);
  if (!result.exists || !result.account) {
    log.error(`Team ${teamId} not found`);
    return;
  }

  const t = result.account;
  const [teamPda] = deriveTeamPda(client.gameEngine, teamId);

  log.info(`\nTeam: ${t.name || dim('(unnamed)')}  (ID ${t.id.toString()})`);
  log.info(`PDA: ${addr(teamPda)}`);

  log.info(section('Info'));
  log.info(`  Leader: ${addr(t.leader)}    Members: ${t.memberCount}/${t.maxMembers}    Treasury: ${formatNum(t.treasury)}`);
  log.info(`  Created: ${formatDate(t.createdAt)}    Last Activity: ${formatDate(t.lastActivity)}`);
  log.info(`  Min Level: ${t.minLevelToJoin}    Public: ${check((t.settings & TeamSettings.PUBLIC) !== 0)}    Auto-Accept: ${check((t.settings & TeamSettings.AUTO_ACCEPT) !== 0)}`);
  if (t.motd) {
    log.info(`  MOTD: ${t.motd}`);
  }

  // Members
  const members = await client.fetchTeamMembers(teamPda);
  if (members.length > 0) {
    log.info(section('Members'));
    const memberCols: Column[] = [
      { header: 'Slot', align: 'right', width: 4 },
      { header: 'Player' },
      { header: 'Rank', width: 10 },
      { header: 'Joined', width: 16 },
    ];

    const memberRows = members
      .sort((a, b) => a.account.slotIndex - b.account.slotIndex)
      .map(({ account: m }) => [
        String(m.slotIndex),
        addr(m.player),
        RANK_NAMES[m.rank] ?? `Rank ${m.rank}`,
        formatDate(m.joinedAt),
      ]);

    log.info(table(memberCols, memberRows));
  }

  // Permissions per role
  log.info(section('Permissions'));
  const roleNames = ['Member', 'Officer', 'Co-Leader', 'Leader'];
  for (let i = 0; i < Math.min(t.rolePermissions.length, roleNames.length); i++) {
    const perms = t.rolePermissions[i]!;
    const permList = PERM_LABELS
      .filter(p => (perms & p.flag) !== 0)
      .map(p => p.label);
    log.info(`  ${roleNames[i]}: ${permList.length > 0 ? permList.join(', ') : dim('none')}`);
  }

  log.info('');
}

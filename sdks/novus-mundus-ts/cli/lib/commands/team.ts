/**
 * team command — Create teams and manage membership for test players
 *
 * Usage:
 *   novus team create <keypair> --name <s> [--tag <t>] [--team-id <n>] [--public] [--min-level <n>]
 *   novus team invite <leaderKeypair> --team-id <id> --invitee <wallet|keypair> [--slot <inviterSlot>]
 *   novus team accept <inviteeKeypair> --team-id <id> --slot <n> --inviter <leaderWallet>
 *   novus team join   --team-id <id> --count <n> [--start-slot <s>] [--city <id>]
 *
 * `--city <id>` only joins candidate players whose current city matches — handy
 * for seeding a team with same-city members. Open-join needs a PUBLIC team.
 * create/invite/accept target a SPECIFIC player (deterministic), which is what
 * the rally flow needs (a Citadel-owner leader + a chosen same-city joiner).
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

import type { CLIContext, ParsedArgs } from '../context';
import { loadKeypair } from '../context';
import { sendWithRetry, accountExists, log } from '../helpers';

import {
  NovusMundusClient,
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createTeamJoinInstruction,
  createPurchaseItemInstruction,
  deriveTeamPda,
  deriveTeamSlotPda,
  derivePlayerPda,
} from '../../../src/index';
import { deserializePlayer, ExtensionFlags } from '../../../src/state/player';
import { TeamSettings } from '../../../src/state/team';

const NULL_PUBKEY = '11111111111111111111111111111111';

// Team join requires EXT_INVENTORY (extension chain: research → inventory →
// team). Beginner test players only have research unlocked; buying a gem pack
// (item 1, item_type 50 — bypasses the Market gate) unlocks inventory as a side
// effect, so the join can proceed.
const INVENTORY_UNLOCK_ITEM_ID = 1;

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  return idx >= 0 ? flags[idx + 1] : undefined;
}

export async function handleTeam(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'create':
      await handleCreate(ctx, args);
      break;
    case 'invite':
      await handleInvite(ctx, args);
      break;
    case 'accept':
      await handleAccept(ctx, args);
      break;
    case 'join':
      await handleJoin(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus team <create|invite|accept|join> [options]');
  }
}

// create — the signer becomes the leader (slot 0). Requires EXT_TEAM +
// EXT_INVENTORY on the creator (the team extension research chain). Pass
// --public so members can open-join; invite/accept work regardless.

async function handleCreate(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await loadKeypairArg(args.extra);
  if (!kp) {
    log.error('Specify the leader keypair path as the third argument');
    log.info('  novus team create <keypair> --name <s> [--tag <t>] [--team-id <n>] [--public] [--min-level <n>]');
    return;
  }

  const name = getFlag(args.flags, '--name');
  if (!name) {
    log.error('Specify --name <team name>');
    return;
  }
  
  const isPublic = args.flags.includes('--public');

  // Pick a fresh team id unless one is supplied. Team ids are global, so scan
  // for the first unused id starting from a high base to avoid the populated
  // low ids.
  const teamIdFlag = getFlag(args.flags, '--team-id');
  let teamId: number;
  if (teamIdFlag !== undefined) {
    teamId = parseInt(teamIdFlag, 10);
  } else {
    teamId = 990000;
    for (; teamId < 990500; teamId++) {
      const [pda] = await deriveTeamPda(ctx.gameEngine, teamId);
      if (!(await accountExists(ctx.connection, pda))) break;
    }
  }

  const [playerPda] = await derivePlayerPda(ctx.gameEngine, kp.publicKey);
  const info = await ctx.connection.getAccountInfo(playerPda);
  if (!info) {
    log.error(`No player account for ${kp.publicKey.toBase58()}`);
    return;
  }
  const player = deserializePlayer(info.data);
  if (player.team.toBase58() !== NULL_PUBKEY) {
    log.error('Leader is already on a team — leave it first (a player can only lead/join one team)');
    return;
  }

  const ix = createTeamCreateInstruction(
    { owner: kp.publicKey, gameEngine: ctx.gameEngine, teamId },
    { name },
  );

  await sendWithRetry(ctx, ix, [kp], { computeUnits: 30_000 });
  const [teamPda] = await deriveTeamPda(ctx.gameEngine, teamId);
  log.create(`Team "${name}" (#${teamId}) ${teamPda.toBase58()}`);
  log.info(`  Leader: ${kp.publicKey.toBase58()} (slot 0)    Public: ${isPublic}`);
  log.info(`  Invite a member: novus team invite ${args.extra} --team-id ${teamId} --invitee <wallet|keypair>`);
}

// invite — leader (or any member with INVITE permission) creates an invite for a
// specific player. The invitee PDA is derived from their wallet.

async function handleInvite(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const inviter = await loadKeypairArg(args.extra);
  if (!inviter) {
    log.error('Specify the inviter (leader) keypair path as the third argument');
    log.info('  novus team invite <leaderKeypair> --team-id <id> --invitee <wallet|keypair> [--slot <inviterSlot>]');
    return;
  }

  const teamIdFlag = getFlag(args.flags, '--team-id');
  if (teamIdFlag === undefined) {
    log.error('Specify --team-id <id>');
    return;
  }
  const teamId = parseInt(teamIdFlag, 10);

  const inviteeFlag = getFlag(args.flags, '--invitee');
  if (!inviteeFlag) {
    log.error('Specify --invitee <wallet pubkey or keypair path>');
    return;
  }
  const inviteeWallet = await resolveWallet(inviteeFlag);
  if (!inviteeWallet) {
    log.error(`Could not resolve --invitee: ${inviteeFlag}`);
    return;
  }

  const inviterSlot = parseInt(getFlag(args.flags, '--slot') || '0', 10);
  const [teamPda] = await deriveTeamPda(ctx.gameEngine, teamId);
  const [inviteePlayer] = await derivePlayerPda(ctx.gameEngine, inviteeWallet);
  const [leaderPlayer] = await derivePlayerPda(ctx.gameEngine, inviter.publicKey);

  const ix = createTeamInviteInstruction({
    gameEngine: ctx.gameEngine,
    inviter: inviter.publicKey,
    team: teamPda,
    inviteePlayer,
    teamId,
    inviterSlotIndex: inviterSlot,
    leaderPlayer,
  });

  await sendWithRetry(ctx, ix, [inviter], { computeUnits: 30_000 });
  log.create(`Invited ${inviteeWallet.toBase58()} to team #${teamId}`);
  log.info(`  They accept with: novus team accept <inviteeKeypair> --team-id ${teamId} --slot 1 --inviter ${inviter.publicKey.toBase58()}`);
}

// accept — the invitee signs to occupy a slot. Auto-unlocks EXT_INVENTORY if
// eligible. --inviter is the wallet that paid for the invite (gets the rent
// refund); for a fresh team that's the leader.

async function handleAccept(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await loadKeypairArg(args.extra);
  if (!kp) {
    log.error('Specify the invitee keypair path as the third argument');
    log.info('  novus team accept <inviteeKeypair> --team-id <id> --slot <n> --inviter <leaderWallet>');
    return;
  }

  const teamIdFlag = getFlag(args.flags, '--team-id');
  if (teamIdFlag === undefined) {
    log.error('Specify --team-id <id>');
    return;
  }
  const teamId = parseInt(teamIdFlag, 10);

  const slotFlag = getFlag(args.flags, '--slot');
  if (slotFlag === undefined) {
    log.error('Specify --slot <index> (first free slot after the leader is 1)');
    return;
  }
  const slotIndex = parseInt(slotFlag, 10);

  const inviterFlag = getFlag(args.flags, '--inviter');
  if (!inviterFlag) {
    log.error('Specify --inviter <leader wallet> (invite-rent refund recipient)');
    return;
  }
  const inviterWallet = await resolveWallet(inviterFlag);
  if (!inviterWallet) {
    log.error(`Could not resolve --inviter: ${inviterFlag}`);
    return;
  }
  const [teamPda] = await deriveTeamPda(ctx.gameEngine, teamId);
  const [leaderPlayer] = await derivePlayerPda(ctx.gameEngine, inviterWallet);

  const ix = createTeamAcceptInviteInstruction({
    gameEngine: ctx.gameEngine,
    owner: kp.publicKey,
    team: teamPda,
    slotIndex,
    teamId,
    inviteRefund: inviterWallet,
    leaderPlayer,
  });

  await sendWithRetry(ctx, ix, [kp], { computeUnits: 40_000 });
  log.create(`${kp.publicKey.toBase58()} joined team #${teamId} (slot ${slotIndex})`);
}

// helpers shared by create/invite/accept

async function loadKeypairArg(extra: string): Promise<Keypair | null> {
  if (!extra) return null;
  try {
    return await loadKeypair(extra);
  } catch {
    return null;
  }
}

async function resolveWallet(s: string): Promise<PublicKey | null> {
  try {
    return new PublicKey(s);
  } catch {
    try {
      return (await loadKeypair(s)).publicKey;
    } catch {
      return null;
    }
  }
}

async function handleJoin(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const teamIdStr = getFlag(args.flags, '--team-id');
  const count = parseInt(getFlag(args.flags, '--count') || '1', 10);
  const startSlot = parseInt(getFlag(args.flags, '--start-slot') || '0', 10);
  const cityStr = getFlag(args.flags, '--city');
  const cityFilter = cityStr !== undefined ? parseInt(cityStr, 10) : undefined;

  if (!teamIdStr) {
    log.error('Specify --team-id <id>');
    return;
  }
  const teamId = BigInt(teamIdStr);

  const client = new NovusMundusClient({
    connection: ctx.connection,
    kingdomId: ctx.kingdomId,
    gameEngine: ctx.gameEngine,
  });

  const teamRes = await client.fetchTeam(Number(teamId));
  if (!teamRes.exists || !teamRes.account) {
    log.error(`Team ${teamId} not found`);
    return;
  }
  const team = teamRes.account;

  // The on-chain TeamAccount stays around after team_disband; every
  // subsequent join attempt errors with TeamDisbanded. Bail out here
  // so the operator gets one clear message instead of per-player
  // failure spam after each Keypair signing.
  if (team.disbanded) {
    log.error(`Team ${teamId} ("${team.name || '(unnamed)'}") is disbanded; cannot join.`);
    return;
  }

  // Open-join is only valid for PUBLIC teams (join.rs rejects others with
  // TeamNotPublic). Bail with one clear message instead of per-player spam.
  if ((team.settings & TeamSettings.PUBLIC) === 0) {
    log.error(
      `Team ${teamId} ("${team.name || '(unnamed)'}") is invite-only. The leader can make it public (team settings) for open join, or use invites.`,
    );
    return;
  }

  const [teamPda] = await deriveTeamPda(ctx.gameEngine, teamId);

  // The join instruction reads the leader's PlayerAccount to size team
  // capacity from the leader's subscription tier. team.leader already
  // stores that PlayerAccount PDA, so pass it straight through.
  const leaderPlayer = team.leader;

  log.info(
    `\nTeam "${team.name || '(unnamed)'}" — ${team.memberCount}/${team.maxMembers} members` +
      (cityFilter !== undefined ? ` (joining city ${cityFilter} only)` : ''),
  );

  const freeSlots: number[] = [];
  for (let s = startSlot; s < team.maxMembers; s++) {
    const [slotPda] = await deriveTeamSlotPda(teamPda, s);
    const info = await ctx.connection.getAccountInfo(slotPda);
    if (!info) freeSlots.push(s);
  }
  log.info(`Free slots (from ${startSlot}): ${freeSlots.join(', ') || '(none)'}\n`);

  if (freeSlots.length === 0) return;

  // Walk keypairs newest-first so the most recently created test players join.
  const keysDir = path.join(__dirname, '../../../keys/players');
  const files = fs.readdirSync(keysDir)
    .filter(f => /^player-\d+\.json$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)![0], 10);
      const nb = parseInt(b.match(/\d+/)![0], 10);
      return nb - na;
    });

  let joined = 0;
  for (const file of files) {
    if (joined >= count || freeSlots.length === 0) break;

    const secret = JSON.parse(fs.readFileSync(path.join(keysDir, file), 'utf8'));
    const kp = await Keypair.fromSecretKey(Uint8Array.from(secret));

    const [playerPda] = await derivePlayerPda(ctx.gameEngine, kp.publicKey);
    const info = await ctx.connection.getAccountInfo(playerPda);
    if (!info) continue;

    const player = deserializePlayer(info.data);
    if (player.team.toBase58() !== NULL_PUBKEY) continue;
    if (player.level < team.minLevelToJoin) continue;
    if (cityFilter !== undefined && player.currentCity !== cityFilter) continue;

    // Seed EXT_INVENTORY when missing — the join reverts with the inventory
    // prerequisite (0x1d7e) otherwise. A cheap gem-pack buy unlocks it.
    if ((player.extensions & ExtensionFlags.INVENTORY) === 0) {
      try {
        const buyIx = createPurchaseItemInstruction(
          {
            buyer: kp.publicKey,
            gameEngine: ctx.gameEngine,
            itemId: INVENTORY_UNLOCK_ITEM_ID,
            treasury: ctx.treasury.publicKey,
          },
          { quantity: 1 },
        );
        await sendWithRetry(ctx, buyIx, [kp]);
        log.info(`    ${file}: unlocked inventory (shop item ${INVENTORY_UNLOCK_ITEM_ID})`);
      } catch (e: any) {
        log.info(`  ! ${file}: inventory unlock failed — ${String(e?.message || e).split('\n')[0]}`);
        continue;
      }
    }

    const slot = freeSlots.shift()!;
    try {
      const ix = createTeamJoinInstruction({
        owner: kp.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId,
        slotIndex: slot,
        leaderPlayer,
      });
      await sendWithRetry(ctx, ix, [kp]);
      log.info(`  + ${file} → slot ${slot}  (${kp.publicKey.toBase58().slice(0, 8)}..)`);
      joined++;
    } catch (e: any) {
      const msg = String(e?.message || e).split('\n')[0];
      log.info(`  ! ${file}: slot ${slot} failed — ${msg}`);
      freeSlots.unshift(slot);
    }
  }

  log.info(`\nDone — ${joined} player(s) joined team ${teamId}.`);
}

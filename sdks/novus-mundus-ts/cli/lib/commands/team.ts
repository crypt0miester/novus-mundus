/**
 * team command — Manage team membership for test players
 *
 * Usage:
 *   novus team join --team-id <id> --count <n> [--start-slot <s>] [--city <id>]
 *
 * `--city <id>` only joins candidate players whose current city matches — handy
 * for seeding a team with same-city members. Open-join needs a PUBLIC team.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

import type { CLIContext, ParsedArgs } from '../context';
import { sendWithRetry, log } from '../helpers';

import {
  NovusMundusClient,
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
    case 'join':
      await handleJoin(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus team join --team-id <id> --count <n> [--start-slot <s>] [--city <id>]');
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

  const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

  log.info(
    `\nTeam "${team.name || '(unnamed)'}" — ${team.memberCount}/${team.maxMembers} members` +
      (cityFilter !== undefined ? ` (joining city ${cityFilter} only)` : ''),
  );

  const freeSlots: number[] = [];
  for (let s = startSlot; s < team.maxMembers; s++) {
    const [slotPda] = deriveTeamSlotPda(teamPda, s);
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
    const kp = Keypair.fromSecretKey(Uint8Array.from(secret));

    const [playerPda] = derivePlayerPda(ctx.gameEngine, kp.publicKey);
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

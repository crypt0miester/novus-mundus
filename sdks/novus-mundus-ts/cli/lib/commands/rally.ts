/**
 * rally command — Manage team rallies (group attacks)
 *
 * Usage:
 *   novus rally list
 *   novus rally create <keypair> --target <pubkey> --target-type <encounter|player|castle> --target-city <id>
 *                                [--gather <seconds>] [--units a,b,c] [--weapons m,r,s] [--rally-id <n>]
 *   novus rally join <keypair> [--rally <pubkey> | --creator <pk> --id <n>] [--units a,b,c] [--weapons m,r,s] [--all]
 *   novus rally speedup <keypair> [--creator <pk> --id <n>] --phase <gather|march|return> --tier <1|2> [--participant <wallet>] [--repeat <n>]
 *   novus rally prep [--team <id>]   (read-only readiness check for the encounter-rally flow)
 *   novus rally march [<rally-pubkey> | --rally <pubkey> | --creator <pk> --id <n>]
 *   novus rally process-return [<rally-pubkey> | --rally <pubkey> | --creator <pk> --id <n>] [--owner <pubkey> | --all]
 *
 * A rally has one creator and many participants from the same team. The
 * lifecycle is: create -> join -> march (execute combat at the target) ->
 * process-return (each participant collects loot + surviving units).
 *
 * `march` maps to the on-chain rally_execute instruction (there is no
 * separate march ix). Both `march` and `process-return` are permissionless,
 * so they sign with the DAO authority as fee payer; `create` and `join`
 * require the acting player's own keypair (passed as the keypair argument).
 */

import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

import type { CLIContext, ParsedArgs } from '../context';
import { loadKeypair } from '../context';
import { sendWithRetry, log } from '../helpers';
import { table, section, addr, formatNum, formatDate, formatDuration, dim, green, red, yellow, type Column } from '../format';
import { CITIES } from '../../data/cities';

import {
  createRallyCreateInstruction,
  createRallyJoinInstruction,
  createRallyExecuteInstruction,
  createRallyProcessReturnInstruction,
  createRallySpeedupInstruction,
  RallySpeedupType,
  derivePlayerPda,
  deriveEstatePda,
  deriveRallyPda,
  deriveTeamPda,
  deserializePlayer,
  NovusMundusClient,
} from '../../../src/index';
import { RallyStatus, RallyTargetType } from '../../../src/types/enums';

const SPEEDUP_PHASE_MAP: Record<string, RallySpeedupType> = {
  gather: RallySpeedupType.Gather,
  march: RallySpeedupType.March,
  return: RallySpeedupType.Return,
};

// Heuristic gem floor for `rally prep` readiness — enough for a few tier-2
// Gather speedups. Speedup gem cost scales with the time skipped, so this is
// only a rough "needs a top-up" flag, not an exact requirement.
const GEM_MIN_FOR_SPEEDUP = 3000;
import type { RallyAccount } from '../../../src/state/rally';

const NULL_PUBKEY = '11111111111111111111111111111111';

const STATUS_NAMES: Record<number, string> = {
  [RallyStatus.Gathering]: 'Gathering',
  [RallyStatus.Marching]: 'Marching',
  [RallyStatus.Combat]: 'Combat',
  [RallyStatus.Returning]: 'Returning',
  [RallyStatus.Completed]: 'Completed',
  [RallyStatus.Cancelled]: 'Cancelled',
};

const TARGET_TYPE_MAP: Record<string, RallyTargetType> = {
  player: RallyTargetType.Player,
  encounter: RallyTargetType.Encounter,
  castle: RallyTargetType.Castle,
};

function cityName(id: number): string {
  return CITIES.find((c) => c.id === id)?.name ?? `City ${id}`;
}

export async function handleRally(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'list':
    case '':
      await handleList(ctx);
      break;
    case 'create':
      await handleCreate(ctx, args);
      break;
    case 'join':
      await handleJoin(ctx, args);
      break;
    case 'speedup':
      await handleSpeedup(ctx, args);
      break;
    case 'march':
      await handleMarch(ctx, args);
      break;
    case 'process-return':
    case 'return':
      await handleProcessReturn(ctx, args);
      break;
    case 'participants':
    case 'roster':
      await handleParticipants(ctx);
      break;
    case 'prep':
    case 'plan':
      await handlePrep(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target}`);
      log.info('  Usage: novus rally <list|participants|prep|create|join|speedup|march|process-return> [options]');
  }
}

// list

async function handleList(ctx: CLIContext): Promise<void> {
  const client = newClient(ctx);
  const rallies = await client.fetchActiveRallies();

  // Anchor to the cluster clock: a local validator drifts from wall-clock, and
  // every on-chain timer (gather/march/return) is judged against
  // Clock::unix_timestamp — so a wall-clock countdown can disagree with the chain.
  const clockInfo = await client.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  const wallNow = Math.floor(Date.now() / 1000);
  const chainNow = clockInfo ? Number(Buffer.from(clockInfo.data).readBigInt64LE(32)) : wallNow;
  const drift = chainNow - wallNow;

  log.info(section(`Rallies — Kingdom ${ctx.kingdomId} (${rallies.length} total)`));
  log.info(
    dim(`  chain clock ${formatDate(chainNow)}  (${drift >= 0 ? '+' : ''}${drift}s vs this machine)`),
  );
  if (rallies.length === 0) {
    log.info(dim('  No active rallies.'));
    return;
  }

  // The return timer lives per-PARTICIPANT, not on the rally, so pull
  // participants for anything past the gather phase to show the soonest return.
  type Parts = Awaited<ReturnType<typeof client.fetchRallyParticipants>>;
  const partsByRally = new Map<string, Parts>();
  await Promise.all(
    rallies
      .filter(({ account: r }) => r.status >= RallyStatus.Returning)
      .map(async ({ pubkey, account }) => {
        try {
          partsByRally.set(pubkey.toBase58(), await client.fetchRallyParticipants(pubkey, account));
        } catch {
          /* fall back to rally.returnedCount below */
        }
      }),
  );

  const cols: Column[] = [
    { header: 'ID', align: 'right', width: 3 },
    { header: 'Creator' },
    { header: 'Target' },
    { header: 'Status', width: 9 },
    { header: 'Parts', align: 'right', width: 6 },
    { header: 'Result', width: 9 },
    { header: 'Window' },
  ];

  const rows = rallies.map(({ pubkey, account: r }) => {
    const result =
      r.status === RallyStatus.Returning || r.status === RallyStatus.Completed
        ? r.attackerWon
          ? green('Won')
          : red('Lost')
        : r.status === RallyStatus.Cancelled
          ? dim('cancelled')
          : dim('—');

    let window: string;
    switch (r.status) {
      case RallyStatus.Gathering: {
        const left = Number(r.gatherAt) - chainNow;
        window = left > 0 ? `gather ${formatDuration(left)}` : dim('gather closed');
        break;
      }
      case RallyStatus.Marching: {
        const left = Number(r.arriveAt) - chainNow;
        window = left > 0 ? `arrive ${formatDuration(left)}` : yellow('arriving');
        break;
      }
      case RallyStatus.Combat:
        window = yellow('in combat');
        break;
      default: {
        // Returning / Completed / Cancelled — return progress + soonest home.
        const parts = partsByRally.get(pubkey.toBase58());
        const home = parts ? parts.filter((p) => p.account.returned).length : r.returnedCount;
        let next = '';
        if (parts) {
          const remaining = parts
            .filter((p) => !p.account.returned && Number(p.account.returnStartedAt) > 0)
            .map((p) => Number(p.account.returnStartedAt) + p.account.returnDuration - chainNow);
          if (remaining.length > 0) {
            const min = Math.min(...remaining);
            next = min > 0 ? ` · next ${formatDuration(min)}` : ` · ${green('ready')}`;
          }
        }
        window = `${home}/${r.participantCount} home${next}`;
        break;
      }
    }

    return [
      r.id.toString(),
      addr(r.creator),
      `${cityName(r.targetCity)} ${addr(r.target)}`,
      STATUS_NAMES[r.status] ?? `${r.status}`,
      `${r.participantCount}/${r.maxParticipants}`,
      result,
      window,
    ];
  });

  log.info(table(cols, rows));
  log.info(
    dim(`\n  Use the creator + id with: novus rally process-return --creator <pk> --id <n>`),
  );
}

// participants — per-participant roster: who marched, casualties, and where
// each return stands. The return timer lives here (not on the rally), so this
// is the place to see why a return is stuck (e.g. return_started_at never set).

async function handleParticipants(ctx: CLIContext): Promise<void> {
  const client = newClient(ctx);
  const clockInfo = await client.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  const chainNow = clockInfo
    ? Number(Buffer.from(clockInfo.data).readBigInt64LE(32))
    : Math.floor(Date.now() / 1000);

  const rallies = await client.fetchActiveRallies();
  if (rallies.length === 0) {
    log.info(dim('  No active rallies.'));
    return;
  }

  for (const { pubkey, account: r } of rallies) {
    const fought = r.status >= RallyStatus.Returning && r.status !== RallyStatus.Cancelled;
    const result = fought ? (r.attackerWon ? green('Won') : red('Lost')) : dim('—');
    log.info(section(`Rally #${r.id.toString()} ${addr(pubkey)} — ${STATUS_NAMES[r.status]} · ${result}`));

    const parts = await client.fetchRallyParticipants(pubkey, r);
    if (parts.length === 0) {
      log.info(dim('  No participants.'));
      continue;
    }

    const cols: Column[] = [
      { header: 'Owner' },
      { header: 'Role', width: 7 },
      { header: 'Marched', width: 8 },
      { header: 'Committed', align: 'right', width: 10 },
      { header: 'Lost', align: 'right', width: 6 },
      { header: 'Return', width: 14 },
    ];
    const rows = parts.map(({ account: p }) => {
      const committed = toNum(p.unitsCommitted1) + toNum(p.unitsCommitted2) + toNum(p.unitsCommitted3);
      const lost = toNum(p.casualties1) + toNum(p.casualties2) + toNum(p.casualties3);
      const rs = Number(p.returnStartedAt);
      const ret = p.returned
        ? green('home')
        : rs > 0
          ? rs + p.returnDuration - chainNow > 0
            ? `in ${formatDuration(rs + p.returnDuration - chainNow)}`
            : green('ready')
          : red('not started');
      return [
        addr(p.participant),
        p.isLeader ? 'leader' : 'member',
        p.includedInMarch ? green('yes') : red('no'),
        committed.toLocaleString(),
        lost.toLocaleString(),
        ret,
      ];
    });
    log.info(table(cols, rows));
  }
}

// create

async function handleCreate(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the acting player keypair as the third argument');
    log.info('  novus rally create <keypair> --target <pubkey> --target-type <encounter|player|castle> --target-city <id>');
    return;
  }

  const targetFlag = getFlag(args.flags, '--target');
  if (!targetFlag) {
    log.error('Specify --target <pubkey> (the encounter/player/castle PDA to attack)');
    return;
  }
  let target: PublicKey;
  try {
    target = new PublicKey(targetFlag);
  } catch {
    log.error(`Invalid --target pubkey: ${targetFlag}`);
    return;
  }

  const targetTypeFlag = (getFlag(args.flags, '--target-type') || 'encounter').toLowerCase();
  const targetType = TARGET_TYPE_MAP[targetTypeFlag];
  if (targetType === undefined) {
    log.error(`Invalid --target-type. Options: ${Object.keys(TARGET_TYPE_MAP).join(', ')}`);
    return;
  }

  const targetCityFlag = getFlag(args.flags, '--target-city');
  if (targetCityFlag === undefined) {
    log.error('Specify --target-city <id> (the city the target sits in)');
    return;
  }
  const targetCityId = parseInt(targetCityFlag, 10);
  if (isNaN(targetCityId)) {
    log.error(`Invalid --target-city: ${targetCityFlag}`);
    return;
  }

  const client = newClient(ctx);
  const [playerPda] = await derivePlayerPda(ctx.gameEngine, kp.publicKey);
  const playerInfo = await ctx.connection.getAccountInfo(playerPda);
  if (!playerInfo) {
    log.error(`No player account for ${kp.publicKey.toBase58()}`);
    return;
  }
  const player = deserializePlayer(playerInfo.data);

  if (player.team.toBase58() === NULL_PUBKEY) {
    log.error('Player is not on a team — create or join a team first (rallies are team-based)');
    return;
  }

  // The creator gathers the rally in their current city.
  const rallyCityId = player.currentCity;

  // Resolve the numeric team id from the player's team PDA.
  const teamId = await resolveTeamId(client, player.team);
  if (teamId === null) {
    log.error(`Could not resolve team id for ${addr(player.team)}`);
    return;
  }

  // Commit amounts: explicit flags, else the player's full available stock.
  const units = parseTriple(getFlag(args.flags, '--units')) ?? [
    toNum(player.defensiveUnit1),
    toNum(player.defensiveUnit2),
    toNum(player.defensiveUnit3),
  ];
  const weapons = parseTriple(getFlag(args.flags, '--weapons')) ?? [
    toNum(player.meleeWeapons),
    toNum(player.rangedWeapons),
    toNum(player.siegeWeapons),
  ];
  if (units[0] + units[1] + units[2] <= 0) {
    log.error('Creator must commit at least one defensive unit (player has none)');
    return;
  }

  const gatherDuration = parseInt(getFlag(args.flags, '--gather') || '600', 10);

  // Pick the next free rally id for this creator (ids are unique per creator).
  const rallyIdFlag = getFlag(args.flags, '--rally-id');
  const rallyId =
    rallyIdFlag !== undefined ? parseInt(rallyIdFlag, 10) : await nextRallyId(ctx, kp.publicKey);

  const ix = createRallyCreateInstruction(
    {
      owner: kp.publicKey,
      gameEngine: ctx.gameEngine,
      rallyId,
      target,
      teamId,
      rallyCityId,
    },
    {
      targetType,
      gatherDuration,
      targetCityId,
      defensiveUnit1: units[0],
      defensiveUnit2: units[1],
      defensiveUnit3: units[2],
      meleeWeapons: weapons[0],
      rangedWeapons: weapons[1],
      siegeWeapons: weapons[2],
    },
  );

  await sendWithRetry(ctx, ix, [kp], { computeUnits: 60_000 });

  const [rallyPda] = await deriveRallyPda(ctx.gameEngine, kp.publicKey, rallyId);
  log.create(`Rally #${rallyId} ${addr(rallyPda)}`);
  log.info(`  Target: ${cityName(targetCityId)} ${addr(target)} (${targetTypeFlag})`);
  log.info(`  Gathers in: ${cityName(rallyCityId)}    Window: ${formatDuration(gatherDuration)}`);
  log.info(`  Committed: ${units.join('/')} units, ${weapons.join('/')} weapons`);
  log.info(dim(`  Teammates join with: novus rally join <keypair> --creator ${kp.publicKey.toBase58()} --id ${rallyId}`));
}

// join

async function handleJoin(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the joining player keypair as the third argument');
    log.info('  novus rally join <keypair> --creator <pk> --id <n>');
    return;
  }

  const client = newClient(ctx);
  const rally = await resolveRally(ctx, client, args);
  if (!rally) return;
  const { account: r } = rally;

  if (r.status !== RallyStatus.Gathering) {
    log.error(`Rally is ${STATUS_NAMES[r.status] ?? r.status}, not Gathering — cannot join`);
    return;
  }
  if (Number(r.gatherAt) <= Math.floor(Date.now() / 1000)) {
    log.error('Gather window has closed — cannot join');
    return;
  }
  if (r.participantCount >= r.maxParticipants) {
    log.error(`Rally is full (${r.participantCount}/${r.maxParticipants})`);
    return;
  }

  const [playerPda] = await derivePlayerPda(ctx.gameEngine, kp.publicKey);
  const playerInfo = await ctx.connection.getAccountInfo(playerPda);
  if (!playerInfo) {
    log.error(`No player account for ${kp.publicKey.toBase58()}`);
    return;
  }
  const player = deserializePlayer(playerInfo.data);

  if (player.team.toBase58() !== r.team.toBase58()) {
    log.error('Player is not on the same team as the rally');
    return;
  }

  const teamId = await resolveTeamId(client, r.team);
  if (teamId === null) {
    log.error(`Could not resolve team id for ${addr(r.team)}`);
    return;
  }

  // Default to committing the player's full available stock; --units / --weapons override.
  const units = parseTriple(getFlag(args.flags, '--units')) ?? [
    toNum(player.defensiveUnit1),
    toNum(player.defensiveUnit2),
    toNum(player.defensiveUnit3),
  ];
  const weapons = parseTriple(getFlag(args.flags, '--weapons')) ?? [
    toNum(player.meleeWeapons),
    toNum(player.rangedWeapons),
    toNum(player.siegeWeapons),
  ];
  if (units[0] + units[1] + units[2] <= 0) {
    log.error('Player has no defensive units to commit');
    return;
  }

  const ix = createRallyJoinInstruction(
    {
      owner: kp.publicKey,
      gameEngine: ctx.gameEngine,
      rally: rally.pubkey,
      rallyCreator: r.creator,
      rallyId: r.id,
      teamId,
      rallyCityId: r.rallyCity,
    },
    {
      defensiveUnit1: units[0],
      defensiveUnit2: units[1],
      defensiveUnit3: units[2],
      meleeWeapons: weapons[0],
      rangedWeapons: weapons[1],
      siegeWeapons: weapons[2],
    },
  );

  await sendWithRetry(ctx, ix, [kp], { computeUnits: 45_000 });
  log.create(`Joined rally #${r.id.toString()} (${addr(rally.pubkey)})`);
  log.info(`  Committed: ${units.join('/')} units, ${weapons.join('/')} weapons`);
  log.info(`  Participants: ${r.participantCount + 1}/${r.maxParticipants}`);
}

// speedup — spend gems to collapse a participant's gather/return travel (or the
// whole army's march). This is how members who join from another city "reach the
// spot in time": each Gather speedup tier-2 removes 75% of remaining travel.
// Anyone can pay (gems come from the signer's PlayerAccount), so a leader can
// also speed up teammates by passing --participant <their wallet>.

async function handleSpeedup(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the paying player keypair as the third argument');
    log.info('  novus rally speedup <keypair> [--creator <pk> --id <n> | --rally <pubkey>] --phase <gather|march|return> --tier <1|2> [--participant <wallet>] [--repeat <n>]');
    return;
  }

  const client = newClient(ctx);
  const rally = await resolveRally(ctx, client, args);
  if (!rally) return;
  const { account: r } = rally;

  const phaseFlag = (getFlag(args.flags, '--phase') || 'gather').toLowerCase();
  const speedupType = SPEEDUP_PHASE_MAP[phaseFlag];
  if (speedupType === undefined) {
    log.error(`Invalid --phase. Options: ${Object.keys(SPEEDUP_PHASE_MAP).join(', ')}`);
    return;
  }

  const tier = parseInt(getFlag(args.flags, '--tier') || '2', 10);
  if (tier !== 1 && tier !== 2) {
    log.error('Invalid --tier (use 1 or 2)');
    return;
  }

  // March ignores the participant; gather/return target a specific participant
  // wallet (defaults to the paying wallet's own participant record).
  const participantFlag = getFlag(args.flags, '--participant');
  let participant: PublicKey;
  if (participantFlag) {
    try {
      participant = new PublicKey(participantFlag);
    } catch {
      log.error(`Invalid --participant pubkey: ${participantFlag}`);
      return;
    }
  } else {
    participant = kp.publicKey;
  }

  // Repeat to drive a timer toward zero. The chain rejects a speedup once there
  // is nothing left to skip, so we stop on the first failure rather than spam.
  const repeat = Math.max(1, parseInt(getFlag(args.flags, '--repeat') || '1', 10));

  let applied = 0;
  for (let i = 0; i < repeat; i++) {
    const ix = createRallySpeedupInstruction(
      {
        owner: kp.publicKey,
        gameEngine: ctx.gameEngine,
        rally: rally.pubkey,
        rallyCreator: r.creator,
        rallyId: r.id,
        participant,
      },
      { speedupType, speedupTier: tier as 1 | 2 },
    );
    try {
      await sendWithRetry(ctx, ix, [kp], { computeUnits: 30_000 });
      applied++;
    } catch (e: any) {
      log.info(dim(`  speedup stopped after ${applied} (${String(e?.message || e).split('\n')[0]})`));
      break;
    }
  }

  log.create(`Applied ${applied}x ${phaseFlag} speedup (tier ${tier}) on ${addr(participant)} — rally #${r.id.toString()}`);
}

// march (execute)

async function handleMarch(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const client = newClient(ctx);
  const rally = await resolveRally(ctx, client, args);
  if (!rally) return;
  const { account: r } = rally;

  if (r.status !== RallyStatus.Gathering && r.status !== RallyStatus.Marching) {
    log.error(`Rally is ${STATUS_NAMES[r.status] ?? r.status} — already executed or closed`);
    return;
  }
  if (r.participantCount < 2) {
    log.error(`Rally has ${r.participantCount} participant(s); needs at least 2 to march`);
    return;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec < Number(r.executeAt)) {
    const wait = Number(r.executeAt) - nowSec;
    log.error(`Not ready to march for ${formatDuration(wait)} (execute at ${formatDate(r.executeAt)})`);
    log.info(dim('  Speed up the gather window or wait, then run march again.'));
    return;
  }

  const participants = await client.fetchRallyParticipants(rally.pubkey, r);
  if (participants.length === 0) {
    log.error('No participant accounts found for this rally');
    return;
  }

  const [creatorPlayer] = await derivePlayerPda(ctx.gameEngine, r.creator);
  const [leaderEstate] = await deriveEstatePda(creatorPlayer);

  const ix = createRallyExecuteInstruction({
    gameEngine: ctx.gameEngine,
    rally: rally.pubkey,
    target: r.target,
    leaderEstate,
    rallyParticipants: participants.map((p) => p.pubkey),
  });

  // Permissionless — DAO authority just pays the fee. CU scales with participants.
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], {
    computeUnits: 60_000 + participants.length * 25_000,
  });

  log.info(`\nMarched rally #${r.id.toString()} against ${cityName(r.targetCity)} ${addr(r.target)}`);

  const after = await client.fetchRally(r.creator, Number(r.id));
  if (after.account) {
    const a = after.account;
    log.info(section('Combat'));
    log.info(`  Status: ${STATUS_NAMES[a.status] ?? a.status}    Winner: ${a.attackerWon ? 'Attacker' : 'Defender'}`);
    log.info(`  Casualties: ${formatNum(a.totalCasualties)}    Damage dealt: ${formatNum(a.attackDamageDealt)}    received: ${formatNum(a.defenseDamageReceived)}`);
    log.info(`  Loot — Cash ${formatNum(a.totalLootCash)}  NOVI ${formatNum(a.totalLootLockedNovi)}  Weapons ${formatNum(a.totalLootMelee)}/${formatNum(a.totalLootRanged)}/${formatNum(a.totalLootSiege)}`);
    log.info(dim('  Each participant now collects with: novus rally process-return --creator <pk> --id <n> --all'));
  }
}

// process-return

async function handleProcessReturn(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const client = newClient(ctx);
  const rally = await resolveRally(ctx, client, args);
  if (!rally) return;
  const { account: r } = rally;

  const participants = await client.fetchRallyParticipants(rally.pubkey, r);
  if (participants.length === 0) {
    log.info(dim('  No participant accounts remain — nothing to process.'));
    return;
  }

  const ownerFlag = getFlag(args.flags, '--owner');
  const all = args.flags.includes('--all') || ownerFlag === undefined;

  let targets = participants;
  if (ownerFlag) {
    let owner: PublicKey;
    try {
      owner = new PublicKey(ownerFlag);
    } catch {
      log.error(`Invalid --owner pubkey: ${ownerFlag}`);
      return;
    }
    targets = participants.filter((p) => p.account.participant.equals(owner));
    if (targets.length === 0) {
      log.error(`No participant ${addr(owner)} in this rally`);
      return;
    }
  } else if (!all) {
    log.error('Specify --owner <pubkey> or --all');
    return;
  }

  let processed = 0;
  let skipped = 0;
  for (const { account: p } of targets) {
    // Hero return needs the hero mint + template id, which require an extra
    // NFT lookup; skip hero-committed participants here and report them.
    if (p.hero.toBase58() !== NULL_PUBKEY) {
      log.info(dim(`  - Skipped ${addr(p.participant)} (committed a hero, return it from the web client)`));
      skipped++;
      continue;
    }

    // process_return is NOT permissionless: the chain runs require_signer on
    // participant_owner, so the participant must sign their own return. We
    // resolve their saved keypair from keys/players and sign with it.
    const signer = await loadParticipantKeypair(p.participant);
    if (!signer) {
      log.info(dim(`  - Skipped ${addr(p.participant)} (no saved keypair to sign their return)`));
      skipped++;
      continue;
    }

    const ix = createRallyProcessReturnInstruction({
      gameEngine: ctx.gameEngine,
      rally: rally.pubkey,
      rallyCreator: r.creator,
      rallyId: r.id,
      participantOwner: p.participant,
      rallyCityId: r.rallyCity,
      homeCityId: p.homeCity,
    });

    try {
      await sendWithRetry(ctx, ix, [signer], { computeUnits: 60_000 });
      log.create(`Returned ${addr(p.participant)} (home ${cityName(p.homeCity)})`);
      processed++;
    } catch (e: any) {
      log.error(`Failed to return ${addr(p.participant)}: ${e.message}`);
    }
  }

  log.info(`\nDone, ${processed} returned${skipped > 0 ? `, ${skipped} skipped` : ""}.`);
}

// prep — read-only readiness check for running a team rally against an
// encounter. Resolves the team's members (player PDAs) to their owner wallets +
// saved keypairs, reports each member's gems/units/city, finds an encounter
// target in the leader's gather city, and prints the exact command sequence to
// run the flow. Sends NO transactions.

async function handlePrep(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const client = newClient(ctx);

  // Default to the sole active team if --team is omitted.
  const teamIdFlag = getFlag(args.flags, '--team');
  let teamId: number;
  if (teamIdFlag !== undefined) {
    teamId = parseInt(teamIdFlag, 10);
  } else {
    const teams = await client.fetchAllTeams();
    if (teams.length === 0) {
      log.error('No teams found — pass --team <id>');
      return;
    }
    teamId = Number(teams[0]!.account.id);
    if (teams.length > 1) {
      log.info(dim(`  ${teams.length} teams; defaulting to #${teamId}. Pass --team <id> to pick another.`));
    }
  }

  const teamRes = await client.fetchTeam(teamId);
  if (!teamRes.exists || !teamRes.account) {
    log.error(`Team ${teamId} not found`);
    return;
  }
  const team = teamRes.account;
  const [teamPda] = await deriveTeamPda(ctx.gameEngine, teamId);

  log.info(section(`Rally prep — Team ${team.name || '(unnamed)'} (#${teamId})  ${team.memberCount}/${team.maxMembers}`));

  // Index keys/players by owner wallet so we can resolve each member's keypair.
  const walletToFile = new Map<string, string>();
  const dir = path.join(__dirname, '../../../keys/players');
  try {
    for (const f of fs.readdirSync(dir).filter((x) => /^player-\d+\.json$/.test(x))) {
      try {
        const kp = await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
        walletToFile.set(kp.publicKey.toBase58(), f);
      } catch {}
    }
  } catch {
    log.error(`Could not read keys dir ${dir}`);
  }

  // The leader's PlayerAccount PDA is stored in team.leader; the rally gathers
  // in the leader's current city.
  const leaderPlayerPda = team.leader;
  const leaderPlayer = await loadPlayer(ctx, leaderPlayerPda);
  if (!leaderPlayer) {
    log.error(`Could not load leader player account ${addr(leaderPlayerPda)}`);
    return;
  }
  const gatherCity = leaderPlayer.currentCity;
  const leaderFile = walletToFile.get(leaderPlayer.owner.toBase58());

  const members = await client.fetchTeamMembers(teamPda);

  type Row = {
    role: string;
    playerPda: PublicKey;
    owner: PublicKey | null;
    file: string | undefined;
    city: number | null;
    gems: number;
    units: [number, number, number];
    sol: number;
  };

  const roster: Row[] = [];
  const seen = new Set<string>();

  const addRow = async (role: string, playerPda: PublicKey) => {
    const key = playerPda.toBase58();
    if (seen.has(key)) return;
    seen.add(key);
    const p = await loadPlayer(ctx, playerPda);
    if (!p) {
      roster.push({ role, playerPda, owner: null, file: undefined, city: null, gems: 0, units: [0, 0, 0], sol: 0 });
      return;
    }
    const file = walletToFile.get(p.owner.toBase58());
    const sol = await ctx.connection.getBalance(p.owner).catch(() => 0);
    roster.push({
      role,
      playerPda,
      owner: p.owner,
      file,
      city: p.currentCity,
      gems: toNum(p.gems),
      units: [toNum(p.defensiveUnit1), toNum(p.defensiveUnit2), toNum(p.defensiveUnit3)],
      sol: Number(sol) / 1e9,
    });
  };

  await addRow('leader', leaderPlayerPda);
  for (const { account: m } of members) {
    await addRow('member', m.player);
  }

  const cols: Column[] = [
    { header: 'Role', width: 7 },
    { header: 'Owner' },
    { header: 'Keyfile', width: 16 },
    { header: 'City', width: 16 },
    { header: 'Gems', align: 'right', width: 9 },
    { header: 'Def units', align: 'right', width: 12 },
    { header: 'SOL', align: 'right', width: 7 },
  ];
  const rows = roster.map((r) => [
    r.role,
    r.owner ? addr(r.owner) : red('(no account)'),
    r.file ?? red('MISSING'),
    r.city === null ? dim('?') : `${cityName(r.city)}${r.city === gatherCity ? green(' *') : ''}`,
    r.gems.toLocaleString(),
    r.units.join('/'),
    r.sol.toFixed(2),
  ]);
  log.info(table(cols, rows));
  log.info(dim(`  Gather city: ${cityName(gatherCity)} (city ${gatherCity}) — marked *. Members elsewhere must Gather-speedup to arrive in time.`));

  // Encounter target candidate in the gather city.
  try {
    const encs = await client.fetchEncountersInCity(gatherCity);
    const nowSec = Math.floor(Date.now() / 1000);
    const alive = encs.filter((e) => !(e.account.health === 0n) && Number(e.account.despawnAt) > nowSec);
    log.info(section(`Encounter targets in ${cityName(gatherCity)}: ${alive.length} alive (${encs.length} total)`));
    if (alive.length > 0) {
      const pick = alive[0]!;
      log.info(`  Target candidate: ${addr(pick.pubkey)}  (rarity ${pick.account.rarity})`);
      log.info(dim(`  full: ${pick.pubkey.toBase58()}`));
    } else {
      log.info(red('  No alive encounters — spawn one first:'));
      log.info(`    bun run cli/cli.ts encounters spawn --city ${gatherCity} --rarity common`);
      log.info(dim('    (or hit the cron route: POST /api/cron/encounters)'));
    }
  } catch (e: any) {
    log.error(`Could not fetch encounters in city ${gatherCity}: ${String(e?.message || e).split('\n')[0]}`);
  }

  // Readiness summary.
  const missingKeys = roster.filter((r) => !r.file);
  const offCity = roster.filter((r) => r.city !== null && r.city !== gatherCity);
  const lowGems = roster.filter((r) => r.gems < GEM_MIN_FOR_SPEEDUP);
  const noUnits = roster.filter((r) => r.units[0] + r.units[1] + r.units[2] <= 0);

  log.info(section('Readiness'));
  log.info(`  Saved keypair: ${roster.length - missingKeys.length}/${roster.length}` +
    (missingKeys.length ? red(`  (missing: ${missingKeys.map((r) => addr(r.playerPda)).join(', ')})`) : green('  OK')));
  log.info(`  Already in gather city: ${roster.length - offCity.length}/${roster.length}` +
    (offCity.length ? yellow(`  (need Gather-speedup: ${offCity.length})`) : green('  OK')));
  log.info(`  Gems >= ${GEM_MIN_FOR_SPEEDUP}: ${roster.length - lowGems.length}/${roster.length}` +
    (lowGems.length ? yellow(`  (need buy-gems: ${lowGems.length})`) : green('  OK')));
  log.info(`  Has defensive units: ${roster.length - noUnits.length}/${roster.length}` +
    (noUnits.length ? red(`  (cannot commit: ${noUnits.length})`) : green('  OK')));

  // Creator viability — CREATING a rally needs a Citadel (Estate L12+); JOINING
  // does not. A keyed member with units may still be unable to create (no estate
  // → IllegalOwner, or estate-without-citadel → CitadelRequired 0x1e2b). We find
  // the real creator by simulating rally_create (commits nothing) for each keyed
  // member with units, stopping at the first that passes. The target encounter
  // doesn't have to exist for create to simulate (create only stores the pubkey).
  let viableCreator: { file: string; wallet: PublicKey } | null = null;
  let lastCreateErr = '';
  const candidates = roster.filter((r) => r.file && r.owner && r.units[0] + r.units[1] + r.units[2] > 0);
  let blockhash = '';
  try {
    blockhash = (await ctx.connection.getLatestBlockhash()).blockhash;
  } catch {}
  for (const r of candidates) {
    let kp: Keypair;
    try {
      kp = await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(dir, r.file!), 'utf8'))));
    } catch {
      continue;
    }
    const ix = await createRallyCreateInstruction(
      { owner: kp.publicKey, gameEngine: ctx.gameEngine, rallyId: 0, target: kp.publicKey, teamId, rallyCityId: gatherCity },
      {
        targetType: RallyTargetType.Encounter, gatherDuration: 120, targetCityId: gatherCity,
        defensiveUnit1: 1, defensiveUnit2: 0, defensiveUnit3: 0,
        meleeWeapons: 0, rangedWeapons: 0, siegeWeapons: 0,
      },
    );
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }), ix);
    tx.feePayer = kp.publicKey;
    if (blockhash) tx.recentBlockhash = blockhash as typeof tx.recentBlockhash;
    try {
      const sim = await ctx.connection.simulateTransaction(tx, [kp]);
      if (!sim.value.err) {
        viableCreator = { file: r.file!, wallet: kp.publicKey };
        break;
      }
      lastCreateErr = JSON.stringify(sim.value.err);
    } catch (e: any) {
      lastCreateErr = String(e?.message || e).split('\n')[0];
    }
  }
  log.info(
    `  Viable rally creator (Citadel): ` +
      (viableCreator
        ? green(`${viableCreator.file} ${addr(viableCreator.wallet)}`)
        : red(`NONE of ${candidates.length} keyed members can create — need a Citadel (Estate L12+) owner${lastCreateErr ? ` [${lastCreateErr}]` : ''}`)),
  );

  // Concrete command sequence. Prefer a proven-viable creator; fall back to the
  // leader (which may lack a saved keypair).
  const creatorKp = viableCreator ? `keys/players/${viableCreator.file}` : (leaderFile ? `keys/players/${leaderFile}` : '<creator-keypair-with-Citadel>');
  const creatorWallet = (viableCreator ? viableCreator.wallet : leaderPlayer.owner).toBase58();
  const leaderKp = creatorKp;
  const leaderWallet = creatorWallet;
  log.info(section('Flow (run from sdks/novus-mundus-ts; not executed by prep)'));
  log.info(dim('  # 1. ensure a target encounter exists in the gather city'));
  log.info(`  bun run cli/cli.ts encounters spawn --city ${gatherCity} --rarity common`);
  log.info(dim('  # 2. leader creates the rally on that encounter (long gather window)'));
  log.info(`  bun run cli/cli.ts rally create ${leaderKp} --target <ENCOUNTER_PDA> --target-type encounter --target-city ${gatherCity} --gather 3600`);
  log.info(dim('  # 3. each member tops up gems, then joins'));
  log.info('  bun run cli/cli.ts player buy-gems keys/players/player-<N>.json --count 5');
  log.info(`  bun run cli/cli.ts rally join keys/players/player-<N>.json --creator ${leaderWallet} --id <ID>`);
  log.info(dim('  # 4. members away from the gather city collapse Gather travel to arrive before the window closes'));
  log.info(`  bun run cli/cli.ts rally speedup keys/players/player-<N>.json --creator ${leaderWallet} --id <ID> --phase gather --tier 2 --repeat 8`);
  log.info(dim('  # 5. once gathered + window elapsed: march, then everyone collects'));
  log.info(`  bun run cli/cli.ts rally march --creator ${leaderWallet} --id <ID>`);
  log.info(`  bun run cli/cli.ts rally process-return --creator ${leaderWallet} --id <ID> --all`);
}

// helpers

async function loadPlayer(ctx: CLIContext, playerPda: PublicKey) {
  const info = await ctx.connection.getAccountInfo(playerPda);
  if (!info) return null;
  try {
    return deserializePlayer(info.data);
  } catch {
    return null;
  }
}

function newClient(ctx: CLIContext): NovusMundusClient {
  return new NovusMundusClient({
    connection: ctx.connection,
    kingdomId: ctx.kingdomId,
    gameEngine: ctx.gameEngine,
  });
}

/** Resolve a rally from --rally <pubkey>, --creator <pk> --id <n>, a bare
 *  positional pubkey, or — if exactly one rally is active — that one. */
async function resolveRally(
  ctx: CLIContext,
  client: NovusMundusClient,
  args: ParsedArgs,
): Promise<{ pubkey: PublicKey; account: RallyAccount } | null> {
  const rallyFlag = getFlag(args.flags, '--rally') || (looksLikePubkey(args.extra) ? args.extra : undefined);
  if (rallyFlag) {
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(rallyFlag);
    } catch {
      log.error(`Invalid --rally pubkey: ${rallyFlag}`);
      return null;
    }
    const info = await ctx.connection.getAccountInfo(pubkey);
    if (!info) {
      log.error(`Rally ${addr(pubkey)} not found`);
      return null;
    }
    const all = await client.fetchActiveRallies();
    const hit = all.find((x) => x.pubkey.equals(pubkey));
    if (!hit) {
      log.error(`Rally ${addr(pubkey)} is not active`);
      return null;
    }
    return { pubkey: hit.pubkey, account: hit.account };
  }

  const creatorFlag = getFlag(args.flags, '--creator');
  const idFlag = getFlag(args.flags, '--id');
  if (creatorFlag && idFlag !== undefined) {
    let creator: PublicKey;
    try {
      creator = new PublicKey(creatorFlag);
    } catch {
      log.error(`Invalid --creator pubkey: ${creatorFlag}`);
      return null;
    }
    const id = parseInt(idFlag, 10);
    const res = await client.fetchRally(creator, id);
    if (!res.exists || !res.account) {
      log.error(`Rally not found (creator ${addr(creator)}, id ${id})`);
      return null;
    }
    return { pubkey: res.pubkey, account: res.account };
  }

  // Fall back to the sole active rally if there is exactly one.
  const active = await client.fetchActiveRallies();
  if (active.length === 1) {
    return { pubkey: active[0].pubkey, account: active[0].account };
  }
  if (active.length === 0) {
    log.error('No active rallies');
  } else {
    log.error(`${active.length} active rallies — specify --rally <pubkey> or --creator <pk> --id <n>`);
  }
  return null;
}

/** Match a team PDA to its numeric id by scanning all teams. */
async function resolveTeamId(client: NovusMundusClient, teamPda: PublicKey): Promise<number | null> {
  const teams = await client.fetchAllTeams();
  const hit = teams.find((t) => t.pubkey.equals(teamPda));
  return hit ? Number(hit.account.id) : null;
}

/** Lowest rally id not yet taken by this creator (ids are unique per creator). */
async function nextRallyId(ctx: CLIContext, creator: PublicKey): Promise<number> {
  for (let id = 0; id < 256; id++) {
    const [pda] = await deriveRallyPda(ctx.gameEngine, creator, id);
    const info = await ctx.connection.getAccountInfo(pda);
    if (!info) return id;
  }
  return 0;
}

async function resolveKeypair(extra: string) {
  if (!extra || looksLikePubkey(extra)) return null;
  try {
    return await loadKeypair(extra);
  } catch {
    return null;
  }
}

// Lazily index keys/players by wallet so process-return can sign as each
// participant. process_return runs require_signer(participant_owner) on chain,
// so the DAO authority cannot stand in for the returning player.
let participantKeyIndex: Map<string, Keypair> | null = null;
async function loadParticipantKeypair(wallet: PublicKey): Promise<Keypair | null> {
  if (!participantKeyIndex) {
    participantKeyIndex = new Map();
    const dir = path.join(__dirname, "../../../keys/players");
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /^player-\d+\.json$/.test(f));
    } catch {
      return null;
    }
    for (const f of files) {
      try {
        const kp = await Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))),
        );
        participantKeyIndex.set(kp.publicKey.toBase58(), kp);
      } catch {}
    }
  }
  return participantKeyIndex.get(wallet.toBase58()) ?? null;
}

function looksLikePubkey(s: string): boolean {
  if (!s) return false;
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

/** Parse "a,b,c" into a 3-tuple of non-negative ints, or null if unset. */
function parseTriple(v: string | undefined): [number, number, number] | null {
  if (v === undefined) return null;
  const parts = v.split(',').map((x) => parseInt(x.trim(), 10));
  const a = parts[0] || 0;
  const b = parts[1] || 0;
  const c = parts[2] || 0;
  return [Math.max(0, a), Math.max(0, b), Math.max(0, c)];
}

function toNum(v: number | bigint): number {
  return typeof v === 'number' ? v : Number(v);
}

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}

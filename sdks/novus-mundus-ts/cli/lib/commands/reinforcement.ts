/**
 * reinforcement command — Send defensive troops to a teammate
 *
 * Usage:
 *   novus reinforcement list <pubkey>
 *   novus reinforcement send <senderKeypair> --to <receiverWallet> --units a,b,c [--weapons m,r,s]
 *   novus reinforcement arrive --sender <pk> --to <pk>          (permissionless crank)
 *   novus reinforcement recall <senderKeypair> --to <receiverWallet>
 *   novus reinforcement relieve <receiverKeypair> --sender <senderWallet>
 *   novus reinforcement return --sender <pk> --to <pk>          (permissionless crank)
 *   novus reinforcement speedup <senderKeypair> --to <receiverWallet> [--tier <1|2>]
 *
 * Reinforcements send a sender's defensive units to a same-team teammate's city
 * to defend them. Lifecycle: send -> (process) arrive -> [recall by sender |
 * relieve by receiver] -> (process) return. Same-city transfers are instant
 * (travel_duration 0); cross-city take travel time that `speedup` can collapse
 * with gems. `arrive` and `return` are permissionless cranks (DAO pays the fee);
 * `send`/`recall`/`speedup` need the sender's keypair, `relieve` the receiver's.
 */

import { PublicKey } from '@solana/web3.js';

import type { CLIContext, ParsedArgs } from '../context';
import { loadKeypair } from '../context';
import { sendWithRetry, log } from '../helpers';
import { table, section, addr, formatNum, formatDate, dim, green, red, type Column } from '../format';
import { CITIES } from '../../data/cities';

import {
  createSendReinforcementInstruction,
  createProcessArrivalInstruction,
  createRecallReinforcementInstruction,
  createRelieveReinforcementInstruction,
  createProcessReturnInstruction,
  createReinforcementSpeedupInstruction,
  derivePlayerPda,
  deriveReinforcementPda,
  deriveEstatePda,
  deserializePlayer,
  NovusMundusClient,
} from '../../../src/index';
import { ReinforcementStatus } from '../../../src/types/enums';
import {
  getReinforcementTotalUnits,
  getReinforcementTotalWeapons,
} from '../../../src/state/reinforcement';

const NULL_PUBKEY = '11111111111111111111111111111111';

const STATUS_NAMES: Record<number, string> = {
  [ReinforcementStatus.Traveling]: 'Traveling',
  [ReinforcementStatus.Active]: 'Active',
  [ReinforcementStatus.Returning]: 'Returning',
  [ReinforcementStatus.Completed]: 'Completed',
};

function cityName(id: number): string {
  return CITIES.find((c) => c.id === id)?.name ?? `City ${id}`;
}

export async function handleReinforcement(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'list':
    case 'show':
      await handleList(ctx, args);
      break;
    case 'send':
      await handleSend(ctx, args);
      break;
    case 'arrive':
    case 'process-arrival':
      await handleArrive(ctx, args);
      break;
    case 'recall':
      await handleRecall(ctx, args);
      break;
    case 'relieve':
      await handleRelieve(ctx, args);
      break;
    case 'return':
    case 'process-return':
      await handleReturn(ctx, args);
      break;
    case 'speedup':
      await handleSpeedup(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus reinforcement <list|send|arrive|recall|relieve|return|speedup> [options]');
  }
}

// list

async function handleList(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  if (!args.extra) {
    log.error('Specify a player wallet: novus reinforcement list <pubkey>');
    return;
  }
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(args.extra);
  } catch {
    log.error(`Invalid pubkey: ${args.extra}`);
    return;
  }

  const client = newClient(ctx);
  const [sent, received] = await Promise.all([
    client.fetchReinforcementsSent(pubkey),
    client.fetchReinforcementsReceived(pubkey),
  ]);

  const total = sent.length + received.length;
  log.info(section(`Reinforcements for ${addr(pubkey)} (${total} total)`));
  if (total === 0) {
    log.info(dim('  None.'));
    return;
  }

  const cols: Column[] = [
    { header: 'Dir', width: 8 },
    { header: 'Counterpart' },
    { header: 'Units', align: 'right', width: 8 },
    { header: 'Weapons', align: 'right', width: 8 },
    { header: 'Status', width: 10 },
    { header: 'Sent', width: 16 },
  ];
  const rows = [
    ...sent.map(({ account: r }) => [
      'Sent',
      addr(r.destination),
      formatNum(getReinforcementTotalUnits(r)),
      formatNum(getReinforcementTotalWeapons(r)),
      STATUS_NAMES[r.status] ?? `${r.status}`,
      formatDate(r.sentAt),
    ]),
    ...received.map(({ account: r }) => [
      'Received',
      addr(r.sender),
      formatNum(getReinforcementTotalUnits(r)),
      formatNum(getReinforcementTotalWeapons(r)),
      STATUS_NAMES[r.status] ?? `${r.status}`,
      formatDate(r.sentAt),
    ]),
  ];
  log.info(table(cols, rows));
}

// send

async function handleSend(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the sender keypair as the third argument');
    log.info('  novus reinforcement send <senderKeypair> --to <receiverWallet> --units a,b,c [--weapons m,r,s]');
    return;
  }

  const toFlag = getFlag(args.flags, '--to');
  if (!toFlag) {
    log.error('Specify --to <receiver wallet>');
    return;
  }
  let receiver: PublicKey;
  try {
    receiver = new PublicKey(toFlag);
  } catch {
    log.error(`Invalid --to pubkey: ${toFlag}`);
    return;
  }
  if (receiver.equals(kp.publicKey)) {
    log.error('Cannot reinforce yourself — pick a teammate as --to');
    return;
  }

  const client = newClient(ctx);

  const sender = await loadPlayer(ctx, kp.publicKey);
  if (!sender) {
    log.error(`No player account for ${kp.publicKey.toBase58()}`);
    return;
  }
  if (sender.team.toBase58() === NULL_PUBKEY) {
    log.error('Sender is not on a team — reinforcements are team-only');
    return;
  }
  const dest = await loadPlayer(ctx, receiver);
  if (!dest) {
    log.error(`No player account for ${receiver.toBase58()}`);
    return;
  }
  if (sender.team.toBase58() !== dest.team.toBase58()) {
    log.error('Sender and receiver are not on the same team');
    return;
  }

  const teamId = await resolveTeamId(client, sender.team);
  if (teamId === null) {
    log.error(`Could not resolve team id for ${addr(sender.team)}`);
    return;
  }

  // Commit amounts: explicit flags, else 50 tier-1 units as a safe default.
  const units = parseTriple(getFlag(args.flags, '--units')) ?? [50, 0, 0];
  const weapons = parseTriple(getFlag(args.flags, '--weapons')) ?? [0, 0, 0];
  if (units[0] + units[1] + units[2] <= 0) {
    log.error('Must send at least one defensive unit (--units a,b,c)');
    return;
  }

  const ix = createSendReinforcementInstruction(
    {
      gameEngine: ctx.gameEngine,
      sender: kp.publicKey,
      destinationOwner: receiver,
      senderCityId: sender.currentCity,
      destinationCityId: dest.currentCity,
      teamId,
    },
    {
      defensiveUnit1: BigInt(units[0]),
      defensiveUnit2: BigInt(units[1]),
      defensiveUnit3: BigInt(units[2]),
      meleeWeapons: BigInt(weapons[0]),
      rangedWeapons: BigInt(weapons[1]),
      siegeWeapons: BigInt(weapons[2]),
      heroSlot: 255,
    },
  );

  await sendWithRetry(ctx, ix, [kp], { computeUnits: 40_000 });
  const [reinfPda] = await deriveReinforcementPda(ctx.gameEngine, kp.publicKey, receiver);
  const sameCity = sender.currentCity === dest.currentCity;
  log.create(`Reinforcement ${addr(reinfPda)} → ${addr(receiver)} (${cityName(dest.currentCity)})`);
  log.info(`  Committed: ${units.join('/')} units, ${weapons.join('/')} weapons`);
  log.info(
    sameCity
      ? dim('  Same city — arrives instantly. Process with: novus reinforcement arrive --sender ' + kp.publicKey.toBase58() + ' --to ' + receiver.toBase58())
      : dim('  Cross-city — speed up with: novus reinforcement speedup <senderKeypair> --to ' + receiver.toBase58() + ' --tier 2 --repeat N'),
  );
}

// arrive (process-arrival, permissionless crank)

async function handleArrive(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const pair = resolvePair(args);
  if (!pair) return;
  const { sender, receiver } = pair;

  const [reinforcement] = await deriveReinforcementPda(ctx.gameEngine, sender, receiver);
  const [destinationPlayer] = await derivePlayerPda(ctx.gameEngine, receiver);

  const ix = createProcessArrivalInstruction({ reinforcement, destinationPlayer });
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 20_000 });
  log.create(`Processed arrival for reinforcement ${addr(reinforcement)} (now Active)`);
}

// recall (sender sends their troops home)

async function handleRecall(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the sender keypair as the third argument');
    log.info('  novus reinforcement recall <senderKeypair> --to <receiverWallet>');
    return;
  }
  const toFlag = getFlag(args.flags, '--to');
  if (!toFlag) {
    log.error('Specify --to <receiver wallet>');
    return;
  }
  let receiver: PublicKey;
  try {
    receiver = new PublicKey(toFlag);
  } catch {
    log.error(`Invalid --to pubkey: ${toFlag}`);
    return;
  }

  const sender = await loadPlayer(ctx, kp.publicKey);
  const dest = await loadPlayer(ctx, receiver);
  if (!sender || !dest) {
    log.error('Sender or receiver player account not found');
    return;
  }

  const ix = createRecallReinforcementInstruction({
    gameEngine: ctx.gameEngine,
    sender: kp.publicKey,
    destinationOwner: receiver,
    senderCityId: sender.currentCity,
    destinationCityId: dest.currentCity,
  });
  await sendWithRetry(ctx, ix, [kp], { computeUnits: 30_000 });
  log.create(`Recalled reinforcement to ${addr(receiver)} (now Returning)`);
  log.info(dim('  Collect home with: novus reinforcement return --sender ' + kp.publicKey.toBase58() + ' --to ' + receiver.toBase58()));
}

// relieve (receiver sends the troops back)

async function handleRelieve(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the receiver keypair as the third argument');
    log.info('  novus reinforcement relieve <receiverKeypair> --sender <senderWallet>');
    return;
  }
  // NB: use --sender, not --from — the global CLI arg parser consumes --from
  // (init's resume-phase option) before it reaches this handler.
  const fromFlag = getFlag(args.flags, '--sender');
  if (!fromFlag) {
    log.error('Specify --sender <sender wallet> (whose troops you are sending back)');
    return;
  }
  let senderWallet: PublicKey;
  try {
    senderWallet = new PublicKey(fromFlag);
  } catch {
    log.error(`Invalid --sender pubkey: ${fromFlag}`);
    return;
  }

  const sender = await loadPlayer(ctx, senderWallet);
  const dest = await loadPlayer(ctx, kp.publicKey);
  if (!sender || !dest) {
    log.error('Sender or receiver player account not found');
    return;
  }

  const ix = createRelieveReinforcementInstruction({
    gameEngine: ctx.gameEngine,
    destinationOwner: kp.publicKey,
    senderOwner: senderWallet,
    senderCityId: sender.currentCity,
    destinationCityId: dest.currentCity,
  });
  await sendWithRetry(ctx, ix, [kp], { computeUnits: 30_000 });
  log.create(`Relieved reinforcement from ${addr(senderWallet)} (now Returning)`);
}

// return (process-return, permissionless crank)

async function handleReturn(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const pair = resolvePair(args);
  if (!pair) return;
  const { sender, receiver } = pair;

  const [reinforcement] = await deriveReinforcementPda(ctx.gameEngine, sender, receiver);
  const [senderPlayer] = await derivePlayerPda(ctx.gameEngine, sender);
  const [estateAccount] = await deriveEstatePda(senderPlayer);

  const ix = createProcessReturnInstruction({
    reinforcement,
    senderPlayer,
    senderOwner: sender,
    estateAccount,
  });
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 20_000 });
  log.create(`Processed return for reinforcement ${addr(reinforcement)} — units restored to ${addr(sender)}, account closed`);
}

// speedup (sender collapses outbound/return travel with gems)

async function handleSpeedup(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the sender keypair as the third argument');
    log.info('  novus reinforcement speedup <senderKeypair> --to <receiverWallet> [--tier <1|2>] [--repeat <n>]');
    return;
  }
  const toFlag = getFlag(args.flags, '--to');
  if (!toFlag) {
    log.error('Specify --to <receiver wallet>');
    return;
  }
  let receiver: PublicKey;
  try {
    receiver = new PublicKey(toFlag);
  } catch {
    log.error(`Invalid --to pubkey: ${toFlag}`);
    return;
  }

  const tier = parseInt(getFlag(args.flags, '--tier') || '2', 10);
  if (tier !== 1 && tier !== 2) {
    log.error('Invalid --tier (use 1 or 2)');
    return;
  }
  const repeat = Math.max(1, parseInt(getFlag(args.flags, '--repeat') || '1', 10));

  let applied = 0;
  for (let i = 0; i < repeat; i++) {
    const ix = createReinforcementSpeedupInstruction(
      { gameEngine: ctx.gameEngine, sender: kp.publicKey, destinationOwner: receiver },
      { speedupTier: tier as 1 | 2 },
    );
    try {
      await sendWithRetry(ctx, ix, [kp], { computeUnits: 20_000 });
      applied++;
    } catch (e: any) {
      log.info(dim(`  speedup stopped after ${applied} (${String(e?.message || e).split('\n')[0]})`));
      break;
    }
  }
  log.create(`Applied ${applied}x tier-${tier} speedup on reinforcement → ${addr(receiver)}`);
}

// helpers

function newClient(ctx: CLIContext): NovusMundusClient {
  return new NovusMundusClient({
    connection: ctx.connection,
    kingdomId: ctx.kingdomId,
    gameEngine: ctx.gameEngine,
  });
}

async function loadPlayer(ctx: CLIContext, wallet: PublicKey) {
  const [playerPda] = await derivePlayerPda(ctx.gameEngine, wallet);
  const info = await ctx.connection.getAccountInfo(playerPda);
  if (!info) return null;
  try {
    return deserializePlayer(info.data);
  } catch {
    return null;
  }
}

/** Resolve a sender/receiver wallet pair from --sender + --to. */
function resolvePair(args: ParsedArgs): { sender: PublicKey; receiver: PublicKey } | null {
  const senderFlag = getFlag(args.flags, '--sender');
  const toFlag = getFlag(args.flags, '--to');
  if (!senderFlag || !toFlag) {
    log.error('Specify --sender <wallet> --to <wallet>');
    return null;
  }
  try {
    return { sender: new PublicKey(senderFlag), receiver: new PublicKey(toFlag) };
  } catch {
    log.error('Invalid --sender / --to pubkey');
    return null;
  }
}

async function resolveTeamId(client: NovusMundusClient, teamPda: PublicKey): Promise<number | null> {
  const teams = await client.fetchAllTeams();
  const hit = teams.find((t) => t.pubkey.equals(teamPda));
  return hit ? Number(hit.account.id) : null;
}

async function resolveKeypair(extra: string) {
  if (!extra || looksLikePubkey(extra)) return null;
  try {
    return await loadKeypair(extra);
  } catch {
    return null;
  }
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

function parseTriple(v: string | undefined): [number, number, number] | null {
  if (v === undefined) return null;
  const parts = v.split(',').map((x) => parseInt(x.trim(), 10));
  return [Math.max(0, parts[0] || 0), Math.max(0, parts[1] || 0), Math.max(0, parts[2] || 0)];
}

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}

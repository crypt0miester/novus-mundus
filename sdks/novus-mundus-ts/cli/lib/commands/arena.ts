/**
 * arena command — Player-facing arena PvP operations
 *
 * Usage:
 *   novus arena show [--season <id>] [--player <wallet>]
 *   novus arena join <playerKeypair> [--season <id>]
 *   novus arena loadout <playerKeypair> [--units a,b,c] [--weapons m,r,s] [--armor n] [--hero <mint>]
 *   novus arena challenge <challengerKeypair> --defender <wallet> [--season <id>]
 *   novus arena claim-daily <playerWallet> [--season <id>]    (permissionless crank — DAO pays)
 *   novus arena claim-master <playerWallet> [--season <id>]   (permissionless crank — DAO pays)
 *   novus arena close [--season <id>] [--city <id>]           (permissionless crank — DAO pays)
 *
 * The arena is per-season PvP. `join` creates your participant + loadout accounts;
 * `loadout` configures combat strength (trusted values, validated at battle time);
 * `challenge` resolves a single-tx battle where the DAO co-signs as game_authority
 * for matchmaking. `claim-daily`/`claim-master` mint NOVI prizes and are
 * permissionless (DAO pays the fee). `close` reclaims rent once a season is past
 * its claim deadline. Default season is 1 (the one `init arena` creates).
 *
 * ADMIN/TEST TOOL — not the production player path. `challenge` here takes an
 * explicit --defender and co-signs with the DAO key (which is game_authority by
 * default), deliberately BYPASSING matchmaking so you can force specific matchups.
 * Real players go through the web cosign API (apps/web POST /api/cosign/arena/
 * challenge), which runs deterministic ELO matchmaking server-side and co-signs
 * with GAME_AUTHORITY_SECRET_KEY — a player never holds game_authority.
 */

import { PublicKey } from '@solana/web3.js';

import type { CLIContext, ParsedArgs } from '../context';
import { loadKeypair } from '../context';
import { sendWithRetry, log, accountExists } from '../helpers';
import {
  table, section, addr, formatNum, formatDate, dim, green, red, yellow, type Column,
} from '../format';
import { CITIES } from '../../data/cities';

import {
  createJoinSeasonInstruction,
  createUpdateLoadoutInstruction,
  createChallengePlayerInstruction,
  createClaimArenaDailyRewardInstruction,
  createClaimMasterRewardInstruction,
  createCloseSeasonInstruction,
  derivePlayerPda,
  deriveEstatePda,
  deriveArenaSeasonPda,
  deriveArenaParticipantPda,
  deriveArenaLoadoutPda,
  parseArenaSeason,
  parseArenaParticipant,
  parseArenaLoadout,
  type ArenaSeasonAccount,
  type ArenaParticipantAccount,
  type ArenaLoadoutAccount,
} from '../../../src/index';

const DEFAULT_SEASON_ID = 1;
const NULL_PUBKEY = '11111111111111111111111111111111';
const DEFAULT_PUBKEY = new PublicKey(NULL_PUBKEY);
const SEASON_STATUS = ['Pending', 'Active', 'Ended', 'Finalized'];

function cityName(id: number): string {
  return CITIES.find((c) => c.id === id)?.name ?? `City ${id}`;
}

export async function handleArena(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'show':
    case 'status':
      await handleShow(ctx, args);
      break;
    case 'join':
      await handleJoin(ctx, args);
      break;
    case 'loadout':
      await handleLoadout(ctx, args);
      break;
    case 'challenge':
      await handleChallenge(ctx, args);
      break;
    case 'claim-daily':
      await handleClaimDaily(ctx, args);
      break;
    case 'claim-master':
      await handleClaimMaster(ctx, args);
      break;
    case 'close':
      await handleClose(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus arena <show|join|loadout|challenge|claim-daily|claim-master|close> [options]');
  }
}

// show

async function handleShow(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const seasonId = resolveSeasonId(args);
  const season = await loadSeason(ctx, seasonId);
  if (!season) {
    log.error(`Arena season ${seasonId} not found — run 'novus init arena' first`);
    return;
  }

  log.info(section(`Arena Season ${season.seasonId} (${cityName(season.cityId)})`));
  log.info(table(
    [{ header: 'Field', width: 20 }, { header: 'Value' }],
    [
      ['Status',            SEASON_STATUS[season.status] ?? String(season.status)],
      ['Start',             formatDate(season.startTime)],
      ['End',               formatDate(season.endTime)],
      ['Claim Deadline',    formatDate(season.claimDeadline)],
      ['Min Level',         String(season.minLevelRequired)],
      ['Master Prize Pool', formatNum(season.masterPrizePool)],
      ['Daily Prize Pool',  formatNum(season.dailyPrizePool)],
      ['Daily Cap',         formatNum(season.dailyDistributionCap)],
      ['Distributed Today', formatNum(season.distributedToday)],
      ['Prize Remaining',   formatNum(season.prizeRemaining)],
      ['Total Battles',     formatNum(season.totalBattles)],
    ],
  ));

  // Leaderboard
  if (season.leaderboardCount > 0) {
    log.info(section('Leaderboard'));
    const rows: string[][] = [];
    for (let i = 0; i < season.leaderboardCount; i++) {
      const entry = season.leaderboard[i];
      if (!entry) continue;
      rows.push([
        String(i + 1),
        addr(entry.player),
        formatNum(entry.totalPoints),
        season.leaderboardClaimed?.[i] ? green('claimed') : dim('unclaimed'),
      ]);
    }
    log.info(table(
      [
        { header: '#', align: 'right', width: 3 },
        { header: 'Player' },
        { header: 'Points', align: 'right' },
        { header: 'Master Prize' },
      ],
      rows,
    ));
  } else {
    log.info(dim('  Leaderboard empty.'));
  }

  // Optional: a single player's standing
  const playerFlag = getFlag(args.flags, '--player');
  if (playerFlag) {
    let wallet: PublicKey;
    try {
      wallet = new PublicKey(playerFlag);
    } catch {
      log.error(`Invalid --player pubkey: ${playerFlag}`);
      return;
    }
    const [playerPda] = await derivePlayerPda(ctx.gameEngine, wallet);
    const part = await loadParticipant(ctx, seasonId, playerPda);
    const loadout = await loadLoadout(ctx, playerPda);

    log.info(section(`Standing — ${addr(wallet)}`));
    if (!part) {
      log.info(dim('  Not joined this season.'));
    } else {
      const battles = part.wins + part.losses;
      const winRate = battles > 0 ? Math.round((part.wins / battles) * 100) : 0;
      log.info(table(
        [{ header: 'Field', width: 20 }, { header: 'Value' }],
        [
          ['ELO',           String(part.eloRating)],
          ['Total Points',  formatNum(part.totalPoints)],
          ['Record',        `${green(String(part.wins))}-${red(String(part.losses))} (${winRate}% win)`],
          ['Last Match ID', formatNum(part.lastMatchId)],
          ['Master Claimed', part.masterRewardClaimed ? green('yes') : dim('no')],
        ],
      ));
    }
    if (loadout) {
      log.info(table(
        [{ header: 'Loadout', width: 20 }, { header: 'Value' }],
        [
          ['Hero',     loadout.arenaHero.equals(DEFAULT_PUBKEY) ? dim('none') : addr(loadout.arenaHero)],
          ['Units',    loadout.defensiveUnits.map((u) => formatNum(u)).join(' / ')],
          ['Weapons',  `${formatNum(loadout.meleeWeapons)} m / ${formatNum(loadout.rangedWeapons)} r / ${formatNum(loadout.siegeWeapons)} s`],
          ['Armor',    formatNum(loadout.armorPieces)],
        ],
      ));
    }
  }
}

// join

async function handleJoin(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the player keypair as the third argument');
    log.info('  novus arena join <playerKeypair> [--season <id>]');
    return;
  }
  const seasonId = resolveSeasonId(args);
  const season = await loadSeason(ctx, seasonId);
  if (!season) {
    log.error(`Arena season ${seasonId} not found — run 'novus init arena' first`);
    return;
  }

  const [playerPda] = await derivePlayerPda(ctx.gameEngine, kp.publicKey);
  if (!(await accountExists(ctx.connection, playerPda))) {
    log.error(`No player account for ${kp.publicKey.toBase58()} — init the player first`);
    return;
  }
  const [participant] = await deriveArenaParticipantPda(ctx.gameEngine, seasonId, playerPda);
  if (await accountExists(ctx.connection, participant)) {
    log.info(dim(`  Already joined season ${seasonId}.`));
    return;
  }

  const ix = createJoinSeasonInstruction({
    owner: kp.publicKey,
    gameEngine: ctx.gameEngine,
    seasonAuthority: season.authority,
    seasonId,
  });

  await sendWithRetry(ctx, ix, [kp], { computeUnits: 30_000 });
  log.create(`Joined arena season ${seasonId} — ${addr(kp.publicKey)}`);
  log.info(dim('  Set your loadout next: novus arena loadout <keypair> --units a,b,c --weapons m,r,s --armor n'));
}

// loadout

async function handleLoadout(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the player keypair as the third argument');
    log.info('  novus arena loadout <playerKeypair> [--units a,b,c] [--weapons m,r,s] [--armor n] [--hero <mint>]');
    return;
  }

  const [playerPda] = await derivePlayerPda(ctx.gameEngine, kp.publicKey);
  const [loadoutPda] = await deriveArenaLoadoutPda(ctx.gameEngine, playerPda);
  if (!(await accountExists(ctx.connection, loadoutPda))) {
    log.error('No loadout account — join a season first: novus arena join <keypair>');
    return;
  }

  // Defaults give a non-trivial power so a challenge resolves to something.
  const units = parseTriple(getFlag(args.flags, '--units')) ?? [100, 50, 25];
  const weapons = parseTriple(getFlag(args.flags, '--weapons')) ?? [10, 10, 5];
  const armor = parseCount(getFlag(args.flags, '--armor')) ?? 10;

  let hero = DEFAULT_PUBKEY;
  const heroFlag = getFlag(args.flags, '--hero');
  if (heroFlag) {
    try {
      hero = new PublicKey(heroFlag);
    } catch {
      log.error(`Invalid --hero mint: ${heroFlag}`);
      return;
    }
  }

  const ix = createUpdateLoadoutInstruction(
    { owner: kp.publicKey, gameEngine: ctx.gameEngine },
    {
      arenaHero: hero,
      defensiveUnits: [BigInt(units[0]), BigInt(units[1]), BigInt(units[2])],
      meleeWeapons: BigInt(weapons[0]),
      rangedWeapons: BigInt(weapons[1]),
      siegeWeapons: BigInt(weapons[2]),
      armorPieces: BigInt(armor),
    },
  );

  await sendWithRetry(ctx, ix, [kp], { computeUnits: 10_000 });
  log.update(`Loadout for ${addr(kp.publicKey)}`);
  log.info(`  Units ${units.join('/')} · Weapons ${weapons.join('/')} · Armor ${armor}${hero.equals(DEFAULT_PUBKEY) ? '' : ` · Hero ${addr(hero)}`}`);
}

// challenge

async function handleChallenge(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const kp = await resolveKeypair(args.extra);
  if (!kp) {
    log.error('Specify the challenger keypair as the third argument');
    log.info('  novus arena challenge <challengerKeypair> --defender <wallet> [--season <id>]');
    return;
  }
  const defenderFlag = getFlag(args.flags, '--defender');
  if (!defenderFlag) {
    log.error('Specify --defender <wallet>');
    return;
  }
  let defenderWallet: PublicKey;
  try {
    defenderWallet = new PublicKey(defenderFlag);
  } catch {
    log.error(`Invalid --defender pubkey: ${defenderFlag}`);
    return;
  }
  if (defenderWallet.equals(kp.publicKey)) {
    log.error('Cannot challenge yourself — pick another player as --defender');
    return;
  }

  const seasonId = resolveSeasonId(args);
  const season = await loadSeason(ctx, seasonId);
  if (!season) {
    log.error(`Arena season ${seasonId} not found`);
    return;
  }
  if (season.status !== 1 /* Active */) {
    log.error(`Season ${seasonId} is ${SEASON_STATUS[season.status] ?? season.status}, not Active`);
    return;
  }

  const [challengerPda] = await derivePlayerPda(ctx.gameEngine, kp.publicKey);
  const [defenderPda] = await derivePlayerPda(ctx.gameEngine, defenderWallet);

  // Both sides must have joined this season (participant + loadout created on join).
  const challengerPart = await loadParticipant(ctx, seasonId, challengerPda);
  if (!challengerPart) {
    log.error(`Challenger has not joined season ${seasonId} — novus arena join <keypair>`);
    return;
  }
  if (!(await loadParticipant(ctx, seasonId, defenderPda))) {
    log.error(`Defender has not joined season ${seasonId}`);
    return;
  }
  const challengerLoadout = await loadLoadout(ctx, challengerPda);
  const defenderLoadout = await loadLoadout(ctx, defenderPda);
  if (!challengerLoadout || !defenderLoadout) {
    log.error('Both players need a loadout set: novus arena loadout <keypair> ...');
    return;
  }

  // Hero accounts: pass the loadout's configured hero (default = no hero). The
  // chain only borrows the hero account when the loadout references one, and
  // rejects a mismatch — so the loadout key is the only correct value here.
  const challengerHero = challengerLoadout.arenaHero;
  const defenderHero = defenderLoadout.arenaHero;

  // Estate accounts contribute combat buffs when present; pass the PDA only if
  // it exists, else the default pubkey (chain skips it on owner mismatch).
  const challengerEstate = await estateOrDefault(ctx, challengerPda);
  const defenderEstate = await estateOrDefault(ctx, defenderPda);

  // Matchmaking is CLI-local here (no off-chain matchmaker): the DAO authority
  // is the game_authority, so it co-signs. match_id must strictly exceed the
  // challenger's last match; match_timestamp must be within the 5-minute window.
  // Backdate the timestamp 30s so a validator clock running slightly behind
  // wall-clock can't trip the "timestamp is in the future" guard.
  const now = Math.floor(Date.now() / 1000);
  const matchId = Math.max(now, Number(challengerPart.lastMatchId) + 1);
  const matchTimestamp = now - 30;

  const ix = createChallengePlayerInstruction(
    {
      challenger: kp.publicKey,
      gameEngine: ctx.gameEngine,
      gameAuthority: ctx.daoAuthority.publicKey,
      seasonAuthority: season.authority,
      seasonId,
      defenderAuthority: defenderWallet,
      challengerHero,
      challengerEstate,
      defenderHero,
      defenderEstate,
    },
    { matchId: BigInt(matchId), matchTimestamp: BigInt(matchTimestamp) },
  );

  await sendWithRetry(ctx, ix, [kp, ctx.daoAuthority], { computeUnits: 60_000 });

  // Re-read both participants to report the outcome.
  const after = await loadParticipant(ctx, seasonId, challengerPda);
  const wins = after?.wins ?? challengerPart.wins;
  const losses = after?.losses ?? challengerPart.losses;
  const outcome = after && after.wins > challengerPart.wins
    ? green('WON')
    : after && after.losses > challengerPart.losses
      ? red('LOST')
      : yellow('DREW');
  log.create(`Challenge resolved: ${addr(kp.publicKey)} vs ${addr(defenderWallet)} — ${outcome}`);
  log.info(`  Record now ${wins}-${losses} · ELO ${after?.eloRating ?? challengerPart.eloRating} · Points ${formatNum(after?.totalPoints ?? challengerPart.totalPoints)}`);
}

// claim-daily (permissionless — DAO pays)

async function handleClaimDaily(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const wallet = resolvePlayerWallet(args.extra);
  if (!wallet) {
    log.error('Specify the player wallet as the third argument');
    log.info('  novus arena claim-daily <playerWallet> [--season <id>]');
    return;
  }
  const seasonId = resolveSeasonId(args);
  const season = await loadSeason(ctx, seasonId);
  if (!season) {
    log.error(`Arena season ${seasonId} not found`);
    return;
  }

  const ix = createClaimArenaDailyRewardInstruction({
    playerOwner: wallet,
    gameEngine: ctx.gameEngine,
    seasonAuthority: season.authority,
    seasonId,
  });

  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 25_000 });
  log.create(`Claimed daily arena reward for ${addr(wallet)} (season ${seasonId})`);
}

// claim-master (permissionless — DAO pays)

async function handleClaimMaster(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const wallet = resolvePlayerWallet(args.extra);
  if (!wallet) {
    log.error('Specify the player wallet as the third argument');
    log.info('  novus arena claim-master <playerWallet> [--season <id>]');
    return;
  }
  const seasonId = resolveSeasonId(args);
  const season = await loadSeason(ctx, seasonId);
  if (!season) {
    log.error(`Arena season ${seasonId} not found`);
    return;
  }

  const ix = createClaimMasterRewardInstruction({
    playerOwner: wallet,
    gameEngine: ctx.gameEngine,
    seasonAuthority: season.authority,
    seasonId,
  });

  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 15_000 });
  log.create(`Claimed master arena reward for ${addr(wallet)} (season ${seasonId})`);
}

// close (permissionless — DAO pays)

async function handleClose(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const seasonId = resolveSeasonId(args);
  const season = await loadSeason(ctx, seasonId);
  if (!season) {
    log.error(`Arena season ${seasonId} not found`);
    return;
  }
  const cityFlag = parseCount(getFlag(args.flags, '--city'));
  const cityId = cityFlag ?? season.cityId;

  const ix = createCloseSeasonInstruction({
    seasonAuthority: season.authority,
    gameEngine: ctx.gameEngine,
    seasonId,
    cityId,
  });

  await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 10_000 });
  log.create(`Closed arena season ${seasonId} (city ${cityId}) — rent returned to ${addr(season.authority)}`);
}

// account loaders

async function loadSeason(ctx: CLIContext, seasonId: number): Promise<ArenaSeasonAccount | null> {
  const [pda] = await deriveArenaSeasonPda(ctx.gameEngine, seasonId);
  const info = await ctx.connection.getAccountInfo(pda);
  if (!info) return null;
  return parseArenaSeason(info);
}

async function loadParticipant(
  ctx: CLIContext,
  seasonId: number,
  playerPda: PublicKey,
): Promise<ArenaParticipantAccount | null> {
  const [pda] = await deriveArenaParticipantPda(ctx.gameEngine, seasonId, playerPda);
  const info = await ctx.connection.getAccountInfo(pda);
  if (!info) return null;
  return parseArenaParticipant(info);
}

async function loadLoadout(ctx: CLIContext, playerPda: PublicKey): Promise<ArenaLoadoutAccount | null> {
  const [pda] = await deriveArenaLoadoutPda(ctx.gameEngine, playerPda);
  const info = await ctx.connection.getAccountInfo(pda);
  if (!info) return null;
  return parseArenaLoadout(info);
}

async function estateOrDefault(ctx: CLIContext, playerPda: PublicKey): Promise<PublicKey> {
  const [estate] = await deriveEstatePda(playerPda);
  return (await accountExists(ctx.connection, estate)) ? estate : DEFAULT_PUBKEY;
}

// arg helpers

function resolveSeasonId(args: ParsedArgs): number {
  const flag = getFlag(args.flags, '--season');
  if (flag === undefined) return DEFAULT_SEASON_ID;
  const n = parseInt(flag, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SEASON_ID;
}

function resolvePlayerWallet(extra: string): PublicKey | null {
  if (!extra) return null;
  try {
    return new PublicKey(extra);
  } catch {
    return null;
  }
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

function parseCount(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}

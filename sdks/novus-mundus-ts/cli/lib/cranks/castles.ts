/**
 * Crank: Castles - status transitions + ownership-transition cleanup pipeline
 *
 * For each castle (enumerated + parsed via the SDK, not seed data):
 *   1. update_castle_status (Ix 289) - permissionless, no-op if not time
 *   2. if TRANSITIONING, run the cleanup pipeline so the new king can take over:
 *      a. garrison_cleanup   (Ix 282) - one per contributor
 *      b. court_cleanup      (Ix 283) - positions 0..4
 *      c. rewards_cleanup    (Ix 284) - one per TeamCastleReward
 *      d. finalize_transition(Ix 285) - once counts hit zero
 *
 * Prior version hand-typed `dataSize: 200/128` + `memcmp offset: 8` to find
 * garrison/reward accounts and read castle fields at guessed byte offsets. The
 * castle pubkey sits at offset 1 (1-byte account_key, not an 8-byte Anchor
 * discriminator) and the sizes were wrong, so those queries matched nothing and
 * the pipeline never ran. This version sizes/parses via the SDK and resolves the
 * member WALLET from each stored player PDA (garrison/court/reward/king all store
 * the PlayerAccount PDA; the cleanup ix needs the owner wallet as rent recipient).
 *
 * LIMITATION: a garrison that contributed a hero NFT needs extra hero accounts
 * on garrison_cleanup. We do not resolve those here; such cleanups fail and are
 * logged (handle them manually). All non-hero garrisons clean up fine.
 */

import { PublicKey } from '@solana/web3.js';
import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, crankSend, type PhaseStats } from '../helpers';
import {
  NovusMundusClient,
  deriveCourtPda,
  deserializePlayer,
  parseCastle,
  parseCourtPosition,
  parseAssetV1,
} from '../../../src/index';
import {
  createUpdateCastleStatusInstruction,
  createGarrisonCleanupInstruction,
  createCourtCleanupInstruction,
  createRewardsCleanupInstruction,
  createFinalizeTransitionInstruction,
} from '../../../src/instructions/castle';
import { CastleStatus } from '../../../src/types/enums';

const NULL_PUBKEY = '11111111111111111111111111111111';
const MAX_COURT_POSITIONS = 5;

// crankSend verb/budget presets for this pipeline's two send shapes.
const CLEANUP = { would: 'clean up', done: 'Cleaned up', computeUnits: 15_000 } as const;
const FINALIZE = { would: 'finalize', done: 'Finalized', computeUnits: 15_000 } as const;

export async function crankCastles(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const client = new NovusMundusClient({
    connection: ctx.connection,
    kingdomId: ctx.kingdomId,
    gameEngine: ctx.gameEngine,
  });

  const castles = await client.fetchAllCastles();
  log.info(`  Found ${castles.length} castles`);

  for (const { pubkey: castlePda, account: castle } of castles) {
    const cityId = castle.cityId;
    const castleId = castle.castleId;
    const label = `${castle.name || `castle ${castleId}`} (city ${cityId})`;

    // Step 1: nudge time-based status transitions (no-op if not due).
    const statusIx = createUpdateCastleStatusInstruction({
      caller: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
      cityId,
      castleId,
    });
    if (ctx.dryRun) {
      log.dryRun(`Would update status: ${label}`);
    } else {
      try {
        await sendWithRetry(ctx, statusIx, [ctx.daoAuthority], { computeUnits: 5_000 });
        if (ctx.verbose) log.update(`Status update: ${label}`);
      } catch {
        if (ctx.verbose) log.info(`  Status unchanged: ${label}`);
      }
    }

    if (castle.status !== CastleStatus.Transitioning) {
      stats.skipped++;
      continue;
    }

    log.info(`  ${label} is TRANSITIONING - running cleanup pipeline`);

    // Step 2a: garrison cleanup (one per contributor). When a hero was
    // contributed, garrison_cleanup needs the hero mint + its template (read
    // from the on-chain NFT attributes), else the asset stays stranded.
    const garrisons = await client.fetchGarrisonsForCastle(castlePda);
    for (const { account: g } of garrisons) {
      const wallet = await walletOf(ctx, g.contributor);
      if (!wallet) {
        log.error(`  garrison: could not resolve wallet for ${g.contributor.toBase58().slice(0, 8)}..`);
        stats.skipped++;
        continue;
      }

      let heroMint: PublicKey | undefined;
      let heroTemplateId: number | undefined;
      if (g.heroMint.toBase58() !== NULL_PUBKEY) {
        const tid = await heroTemplateIdOf(ctx, g.heroMint);
        if (tid === null) {
          log.error(`  garrison ${wallet.toBase58().slice(0, 8)}..: has hero ${g.heroMint.toBase58().slice(0, 8)}.. but could not resolve its template id - skipping`);
          stats.skipped++;
          continue;
        }
        heroMint = g.heroMint;
        heroTemplateId = tid;
      }

      const ix = createGarrisonCleanupInstruction({
        payer: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        cityId,
        castleId,
        garrisonMember: wallet,
        heroMint,
        heroTemplateId,
      });
      await crankSend(ctx, stats, ix, `garrison ${wallet.toBase58().slice(0, 8)}..${heroMint ? ' (+hero)' : ''}`, CLEANUP);
    }

    // Step 2b: court cleanup (positions 0..4).
    for (let position = 0; position < MAX_COURT_POSITIONS; position++) {
      const [courtPda] = await deriveCourtPda(castlePda, position);
      const info = await ctx.connection.getAccountInfo(courtPda);
      if (!info) continue;
      const court = parseCourtPosition(info);
      if (!court) continue;
      const wallet = await walletOf(ctx, court.holder);
      if (!wallet) {
        log.error(`  court ${position}: could not resolve holder wallet`);
        stats.skipped++;
        continue;
      }
      const ix = createCourtCleanupInstruction(
        { payer: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine, cityId, castleId, holder: wallet },
        { position },
      );
      await crankSend(ctx, stats, ix, `court position ${position}`, CLEANUP);
    }

    // Step 2c: rewards cleanup (one per TeamCastleReward).
    const rewards = await client.fetchTeamRewardsForCastle(castlePda);
    for (const { account: r } of rewards) {
      const wallet = await walletOf(ctx, r.member);
      if (!wallet) {
        log.error(`  reward: could not resolve member wallet for ${r.member.toBase58().slice(0, 8)}..`);
        stats.skipped++;
        continue;
      }
      const ix = createRewardsCleanupInstruction({
        payer: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        cityId,
        castleId,
        member: wallet,
      });
      await crankSend(ctx, stats, ix, `reward ${wallet.toBase58().slice(0, 8)}..`, CLEANUP);
    }

    // Step 2d: finalize once garrison + court counts hit zero. Re-read just this
    // castle (not the whole table) to see the post-cleanup counts.
    const freshInfo = await ctx.connection.getAccountInfo(castlePda);
    const updated = freshInfo ? parseCastle(freshInfo) : null;
    if (!updated) {
      stats.skipped++;
      continue;
    }
    if (updated.garrisonCount !== 0 || updated.courtCount !== 0) {
      log.info(`  Cleanup not complete yet (garrison=${updated.garrisonCount}, court=${updated.courtCount})`);
      stats.skipped++;
      continue;
    }

    const oldKing = updated.king.toBase58() === NULL_PUBKEY ? undefined : (await walletOf(ctx, updated.king)) ?? undefined;

    if (updated.transitionNewKing.toBase58() === NULL_PUBKEY) {
      // Vacant transition (e.g. force_remove_king): no new king; castle becomes
      // VACANT. newKing omitted -> builder passes inert placeholders.
      const finalizeIx = createFinalizeTransitionInstruction({
        payer: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        cityId,
        castleId,
        oldKing,
      });
      await crankSend(ctx, stats, finalizeIx, `${label} (vacant)`, FINALIZE);
      continue;
    }

    const newKing = await walletOf(ctx, updated.transitionNewKing);
    if (!newKing) {
      log.error(`  finalize: could not resolve new-king wallet`);
      stats.skipped++;
      continue;
    }

    const finalizeIx = createFinalizeTransitionInstruction({
      payer: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
      cityId,
      castleId,
      newKing,
      oldKing,
    });
    await crankSend(ctx, stats, finalizeIx, label, FINALIZE);
  }

  return stats;
}

/** Resolve a member's wallet from their PlayerAccount PDA (reads player.owner). */
async function walletOf(ctx: CLIContext, playerPda: PublicKey): Promise<PublicKey | null> {
  const info = await ctx.connection.getAccountInfo(playerPda);
  if (!info) return null;
  try {
    return deserializePlayer(info.data).owner;
  } catch {
    return null;
  }
}

/** Resolve a hero's template id from its NFT mint (MPL Core asset `Template`
 *  attribute). garrison_cleanup needs it to derive the hero-template account. */
async function heroTemplateIdOf(ctx: CLIContext, heroMint: PublicKey): Promise<number | null> {
  const info = await ctx.connection.getAccountInfo(heroMint);
  if (!info) return null;
  const asset = parseAssetV1(info.data);
  const tpl = asset?.attributes.Template;
  if (tpl === undefined) return null;
  const id = parseInt(tpl, 10);
  return Number.isFinite(id) ? id : null;
}

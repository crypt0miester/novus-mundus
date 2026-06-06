/**
 * Shared castle-transition crank logic, used by BOTH the CLI crank
 * (cli/lib/cranks/castles.ts) and the web cron (apps/web .../api/cron/castles).
 *
 * The ownership-transition pipeline is sequential — garrison/court/reward
 * cleanups must land before `finalize_transition` can run (it gates on
 * garrison_count == 0 && court_count == 0). So this exposes the two pure steps
 * and lets each caller send + count in its own way:
 *   1. collectCastleCleanups(client, crank, castle, castlePda) -> cleanup ixs
 *   2. (send them, wait for confirmation)
 *   3. buildCastleFinalize(client, crank, castlePda) -> finalize ix | null
 *
 * `crank` is the permissionless signer / fee payer (DAO authority for the CLI,
 * game_authority for the cron). Members whose wallet — or hero template — can't
 * be resolved are skipped (rare; missing player/NFT account).
 */

import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { NovusMundusClient } from '../client';
import { deriveCourtPda } from '../pda';
import { parseCastle, parseCourtPosition } from '../state/castle';
import type { CastleAccount } from '../state/castle';
import { deserializePlayer } from '../state/player';
import { parseAssetV1 } from '../external/asset';
import {
  createGarrisonCleanupInstruction,
  createCourtCleanupInstruction,
  createRewardsCleanupInstruction,
  createFinalizeTransitionInstruction,
} from '../instructions/castle';
import { CastleStatus } from '../types/enums';

const NULL_PUBKEY = '11111111111111111111111111111111';
const MAX_COURT_POSITIONS = 5;

export interface CastleCrankIx {
  ix: TransactionInstruction;
  label: string;
}

/** Resolve a member's wallet from their PlayerAccount PDA (reads player.owner). */
async function walletOf(connection: Connection, playerPda: PublicKey): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(playerPda);
  if (!info) return null;
  try {
    return deserializePlayer(info.data).owner;
  } catch {
    return null;
  }
}

/** Resolve a hero's template id from its NFT mint (MPL Core `Template` attribute). */
async function heroTemplateIdOf(connection: Connection, heroMint: PublicKey): Promise<number | null> {
  const info = await connection.getAccountInfo(heroMint);
  if (!info) return null;
  const tpl = parseAssetV1(info.data)?.attributes.Template;
  if (tpl === undefined) return null;
  const id = parseInt(tpl, 10);
  return Number.isFinite(id) ? id : null;
}

/**
 * Collect the garrison/court/reward cleanup instructions for a TRANSITIONING
 * castle. Garrison contributors who staked a hero get the hero mint + template
 * accounts resolved so the NFT is returned.
 */
export async function collectCastleCleanups(
  client: NovusMundusClient,
  crank: PublicKey,
  castle: CastleAccount,
  castlePda: PublicKey,
): Promise<CastleCrankIx[]> {
  const { connection, gameEngine } = client;
  const { cityId, castleId } = castle;
  const out: CastleCrankIx[] = [];

  // Garrison (one per contributor)
  const garrisons = await client.fetchGarrisonsForCastle(castlePda);
  for (const { account: g } of garrisons) {
    const wallet = await walletOf(connection, g.contributor);
    if (!wallet) continue;

    let heroMint: PublicKey | undefined;
    let heroTemplateId: number | undefined;
    if (g.heroMint.toBase58() !== NULL_PUBKEY) {
      const tid = await heroTemplateIdOf(connection, g.heroMint);
      if (tid === null) continue; // can't resolve the hero's template — leave for manual
      heroMint = g.heroMint;
      heroTemplateId = tid;
    }

    out.push({
      ix: await createGarrisonCleanupInstruction({
        payer: crank,
        gameEngine,
        cityId,
        castleId,
        garrisonMember: wallet,
        heroMint,
        heroTemplateId,
      }),
      label: `garrison ${wallet.toBase58().slice(0, 8)}..${heroMint ? ' (+hero)' : ''}`,
    });
  }

  // Court (positions 0..4)
  for (let position = 0; position < MAX_COURT_POSITIONS; position++) {
    const [courtPda] = await deriveCourtPda(castlePda, position);
    const info = await connection.getAccountInfo(courtPda);
    if (!info) continue;
    const court = parseCourtPosition(info);
    if (!court) continue;
    const wallet = await walletOf(connection, court.holder);
    if (!wallet) continue;
    out.push({
      ix: await createCourtCleanupInstruction(
        { payer: crank, gameEngine, cityId, castleId, holder: wallet },
        { position },
      ),
      label: `court position ${position}`,
    });
  }

  // Rewards (one per TeamCastleReward)
  const rewards = await client.fetchTeamRewardsForCastle(castlePda);
  for (const { account: r } of rewards) {
    const wallet = await walletOf(connection, r.member);
    if (!wallet) continue;
    out.push({
      ix: await createRewardsCleanupInstruction({ payer: crank, gameEngine, cityId, castleId, member: wallet }),
      label: `reward ${wallet.toBase58().slice(0, 8)}..`,
    });
  }

  return out;
}

/**
 * Build the finalize-transition instruction once a castle's garrison + court
 * counts have hit zero. **Re-reads the castle**, so call it AFTER the cleanup
 * txs confirm. Returns null if the castle isn't transitioning, cleanup isn't
 * complete, or the new-king wallet can't be resolved. Handles the vacant
 * transition (transition_new_king == NULL, e.g. after force_remove_king).
 */
export async function buildCastleFinalize(
  client: NovusMundusClient,
  crank: PublicKey,
  castlePda: PublicKey,
): Promise<CastleCrankIx | null> {
  const { connection, gameEngine } = client;
  const info = await connection.getAccountInfo(castlePda);
  const castle = info ? parseCastle(info) : null;
  if (!castle || castle.status !== CastleStatus.Transitioning) return null;
  if (castle.garrisonCount !== 0 || castle.courtCount !== 0) return null;

  const { cityId, castleId } = castle;
  const oldKing =
    castle.king.toBase58() === NULL_PUBKEY ? undefined : (await walletOf(connection, castle.king)) ?? undefined;

  if (castle.transitionNewKing.toBase58() === NULL_PUBKEY) {
    // Vacant transition: newKing omitted -> builder passes inert placeholders.
    return {
      ix: await createFinalizeTransitionInstruction({ payer: crank, gameEngine, cityId, castleId, oldKing }),
      label: `finalize castle ${castleId} (city ${cityId}) (vacant)`,
    };
  }

  const newKing = await walletOf(connection, castle.transitionNewKing);
  if (!newKing) return null;
  return {
    ix: await createFinalizeTransitionInstruction({ payer: crank, gameEngine, cityId, castleId, newKing, oldKing }),
    label: `finalize castle ${castleId} (city ${cityId})`,
  };
}

/**
 * Dungeon Test Helpers
 *
 * The program requires the game_authority co-signer on enter/resume — it
 * authenticates the backend-rolled first_room_type, so a client cannot freely
 * pick the opening room. Every entry/resume tx is therefore signed by both the
 * player and the game_engine's game_authority, which in the test fixture is
 * `ctx.daoAuthority`. These helpers wire that co-signer in one place.
 */

import { PublicKey, Transaction } from '@solana/web3.js';

import {
  createEnterDungeonInstruction,
  createResumeInstruction,
} from '../../src/index';

import { type TestContext } from './setup';
import { type TestPlayer } from './players';
import { sendTransaction } from '../utils/transactions';

export interface EnterDungeonParams {
  templateId: number;
  firstRoomType?: number;
  heroSpecialization?: number;
}

export interface ResumeDungeonParams {
  templateId: number;
  firstRoomType?: number;
}

/** Build an enter-dungeon ix with the game_authority co-signer wired in. */
export function enterDungeonIx(
  ctx: TestContext,
  owner: PublicKey,
  heroMint: PublicKey,
  params: EnterDungeonParams,
) {
  return createEnterDungeonInstruction(
    { gameEngine: ctx.gameEngine, owner, heroMint, gameAuthority: ctx.daoAuthority.publicKey },
    {
      templateId: params.templateId,
      firstRoomType: params.firstRoomType ?? 0,
      heroSpecialization: params.heroSpecialization ?? 0,
    },
  );
}

/** Build a resume ix with the game_authority co-signer wired in. */
export function resumeDungeonIx(
  ctx: TestContext,
  owner: PublicKey,
  params: ResumeDungeonParams,
) {
  return createResumeInstruction(
    { gameEngine: ctx.gameEngine, owner, gameAuthority: ctx.daoAuthority.publicKey },
    { templateId: params.templateId, firstRoomType: params.firstRoomType ?? 0 },
  );
}

/** Send an enter-dungeon tx, co-signed by the player + game_authority. */
export function enterDungeon(
  ctx: TestContext,
  player: TestPlayer,
  heroMint: PublicKey,
  params: EnterDungeonParams,
) {
  return sendTransaction(
    ctx.svm,
    new Transaction().add(enterDungeonIx(ctx, player.publicKey, heroMint, params)),
    [player.keypair, ctx.daoAuthority],
  );
}

/** Send a resume tx, co-signed by the player + game_authority. */
export function resumeDungeon(
  ctx: TestContext,
  player: TestPlayer,
  params: ResumeDungeonParams,
) {
  return sendTransaction(
    ctx.svm,
    new Transaction().add(resumeDungeonIx(ctx, player.publicKey, params)),
    [player.keypair, ctx.daoAuthority],
  );
}

// War Table instructions.
//
// Builds the single POST_WAR_TABLE_MESSAGE instruction (discriminator 323) and
// thin per-scope wrappers. The account order below is the canonical layout that
// the chain processor::war_table::post::process expects:
//
//   [0] thread        target thread PDA (no signer, no writable)
//   [1] sender_wallet  signer
//   [2] sender_player  PlayerAccount PDA
//   [3] gate_0         scope-specific (absent for Team and Encounter)
//   [4] gate_1         second PlayerAccount (DM only)
//
// Instruction data: discriminator(323 u16 LE) | scope(u8) | envelope bytes.

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS } from '../program';
import { createInstructionData } from '../utils/serialize';
import { WtScope } from '../crypto/wartable';
import {
  deriveRallyParticipantPda,
  deriveDmThreadPda,
} from '../pda';

export interface PostWarTableMessageAccounts {
  /** target thread PDA. */
  thread: PublicKey;
  /** signing wallet. */
  sender: PublicKey;
  /** sender's PlayerAccount PDA. */
  senderPlayer: PublicKey;
  /** scope-gate accounts in order (gate_0[, gate_1]); empty for Team/Encounter. */
  gateAccounts: PublicKey[];
}

export interface PostWarTableMessageParams {
  scope: WtScope;
  /** full wt1 envelope blob. */
  envelope: Uint8Array;
}

/** Build the raw POST_WAR_TABLE_MESSAGE instruction. */
export function createPostWarTableMessageInstruction(
  accounts: PostWarTableMessageAccounts,
  params: PostWarTableMessageParams,
): TransactionInstruction {
  const keys = [
    { pubkey: accounts.thread, isSigner: false, isWritable: false },
    { pubkey: accounts.sender, isSigner: true, isWritable: false },
    { pubkey: accounts.senderPlayer, isSigner: false, isWritable: false },
  ];
  for (const gate of accounts.gateAccounts) {
    keys.push({ pubkey: gate, isSigner: false, isWritable: false });
  }

  // data = [scope:u8, ...envelope]
  const inner = new Uint8Array(1 + params.envelope.length);
  inner[0] = params.scope & 0xff;
  inner.set(params.envelope, 1);

  const data = createInstructionData(DISCRIMINATORS.POST_WAR_TABLE_MESSAGE, inner);

  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}

/** Team scope: no gate accounts (predicate uses sender_player.team_address). */
export function createPostTeamMessageInstruction(
  teamPda: PublicKey,
  sender: PublicKey,
  senderPlayer: PublicKey,
  envelope: Uint8Array,
): TransactionInstruction {
  return createPostWarTableMessageInstruction(
    { thread: teamPda, sender, senderPlayer, gateAccounts: [] },
    { scope: WtScope.Team, envelope },
  );
}

/**
 * Rally scope: gate_0 = the sender's RallyParticipant PDA, which is keyed on
 * the WALLET, seeds [b"rally_participant", gameEngine, rallyCreator, rallyId, wallet].
 */
export async function createPostRallyMessageInstruction(
  gameEngine: PublicKey,
  rallyCreator: PublicKey,
  rallyId: number | bigint,
  rallyPda: PublicKey,
  sender: PublicKey,
  senderPlayer: PublicKey,
  envelope: Uint8Array,
): Promise<TransactionInstruction> {
  const [participant] = await deriveRallyParticipantPda(gameEngine, rallyCreator, rallyId, sender);
  return createPostWarTableMessageInstruction(
    { thread: rallyPda, sender, senderPlayer, gateAccounts: [participant] },
    { scope: WtScope.Rally, envelope },
  );
}

/**
 * Castle scope: gate_0 is either the GarrisonContribution PDA or a
 * CourtPosition PDA (the chain discriminates by the account's first byte).
 * Pass `undefined` for the king branch (no gate account, 3 accounts total).
 */
export function createPostCastleMessageInstruction(
  castlePda: PublicKey,
  sender: PublicKey,
  senderPlayer: PublicKey,
  garrisonOrCourtPda: PublicKey | undefined,
  envelope: Uint8Array,
): TransactionInstruction {
  const gateAccounts = garrisonOrCourtPda === undefined ? [] : [garrisonOrCourtPda];
  return createPostWarTableMessageInstruction(
    { thread: castlePda, sender, senderPlayer, gateAccounts },
    { scope: WtScope.Castle, envelope },
  );
}

/** Encounter scope: no gate accounts (predicate is is_in_kingdom). */
export function createPostEncounterMessageInstruction(
  encounterPda: PublicKey,
  sender: PublicKey,
  senderPlayer: PublicKey,
  envelope: Uint8Array,
): TransactionInstruction {
  return createPostWarTableMessageInstruction(
    { thread: encounterPda, sender, senderPlayer, gateAccounts: [] },
    { scope: WtScope.Encounter, envelope },
  );
}

/**
 * Public scope: no gate accounts (predicate is is_in_kingdom). The thread is
 * the kingdom's GameEngine PDA, the per-kingdom public channel.
 */
export function createPostPublicMessageInstruction(
  gameEnginePda: PublicKey,
  sender: PublicKey,
  senderPlayer: PublicKey,
  envelope: Uint8Array,
): TransactionInstruction {
  return createPostWarTableMessageInstruction(
    { thread: gameEnginePda, sender, senderPlayer, gateAccounts: [] },
    { scope: WtScope.Public, envelope },
  );
}

/**
 * DM scope: derives the pair thread PDA from the two PlayerAccount PDAs and
 * passes BOTH PlayerAccounts as gate_0/gate_1. The signer must own one of them.
 * The gate accounts include both players' PDAs so the recipient can discover
 * the thread via getSignaturesForAddress (open risk O8).
 */
export async function createPostDmMessageInstruction(
  playerPdaA: PublicKey,
  playerPdaB: PublicKey,
  sender: PublicKey,
  senderPlayer: PublicKey,
  envelope: Uint8Array,
): Promise<TransactionInstruction> {
  const [threadPda] = await deriveDmThreadPda(playerPdaA, playerPdaB);
  return createPostWarTableMessageInstruction(
    { thread: threadPda, sender, senderPlayer, gateAccounts: [playerPdaA, playerPdaB] },
    { scope: WtScope.Dm, envelope },
  );
}

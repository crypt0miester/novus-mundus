// Build the "I'm online" presence ping instruction.
//
// A KIND=Status, PLAINTEXT, empty-payload war-table message on the Public scope,
// whose thread is the kingdom's GameEngine PDA. Public is plaintext (no key
// derivation), so this is fully synchronous and can be appended inline to a
// transaction. See usePresence for how presence is read back (the player PDA
// rides this post as sender_player, so its latest blockTime marks them online).

import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  WtKind,
  WT_BODY_VERSION,
  WT_NONCE_LEN,
  WT_ID_ZERO,
  encodeBody,
  encodeEnvelope,
  createPostPublicMessageInstruction,
} from "novus-mundus-sdk";

export function buildPresencePingInstruction(
  gameEngine: PublicKey,
  sender: PublicKey,
  senderPlayer: PublicKey,
): TransactionInstruction {
  const body = encodeBody({
    version: WT_BODY_VERSION,
    kind: WtKind.Status,
    createdAt: BigInt(Math.floor(Date.now() / 1000)),
    parentId: WT_ID_ZERO,
    payload: new Uint8Array(0),
  });
  const envelope = encodeEnvelope({
    flags: 0,
    threadPda: gameEngine,
    senderWallet: sender,
    keyVersion: 0,
    bodyNonce: new Uint8Array(WT_NONCE_LEN),
    body,
  });
  return createPostPublicMessageInstruction(gameEngine, sender, senderPlayer, envelope);
}

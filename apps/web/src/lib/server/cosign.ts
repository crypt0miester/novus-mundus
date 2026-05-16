import "server-only";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { gameAuthorityKeypair, serverClient } from "./game-authority";

/**
 * Build a VersionedTransaction from the given instructions, partial-sign it
 * with the game_authority key, and return it base64-encoded.
 *
 * The compute-unit budget is sized by simulating the transaction first (actual
 * usage + 20% headroom). The transaction is left unsigned for the fee payer
 * (the player's wallet) — the client deserializes it, the wallet adds its
 * signature, and it is submitted via `useTransact`'s `versionedTx` path.
 */
export async function coSign(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
): Promise<string> {
  const client = serverClient();

  // Simulate once with a high ceiling to measure real compute usage.
  const txSimulate = await client.buildVersionedTransaction(instructions, feePayer, {
    computeUnits: 1_000_000,
  });
  const simulation = await client.simulateTransaction(txSimulate);
  if (simulation.error) {
    throw new Error(`Transaction simulation failed: ${simulation.error}`);
  }
  const computeUnits = simulation.unitsConsumed
    ? Math.ceil(simulation.unitsConsumed * 1.2)
    : 400_000;

  // Build the real transaction with the measured compute budget.
  const tx = await client.buildVersionedTransaction(instructions, feePayer, {
    computeUnits,
    computeUnitPrice: 10_000,
  });
  // VersionedTransaction.sign() fills only the slots whose pubkeys it holds —
  // i.e. a partial sign of the game_authority slot. The fee-payer slot stays
  // empty for the wallet to fill.
  tx.sign([gameAuthorityKeypair()]);
  return Buffer.from(tx.serialize()).toString("base64");
}

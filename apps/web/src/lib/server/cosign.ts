import "server-only";
import type { AddressLookupTableAccount, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { gameAuthorityKeypair, serverClient } from "./game-authority";

/**
 * Build a VersionedTransaction from the given instructions, partial-sign it
 * with the game_authority key, and return it base64-encoded.
 *
 * The compute-unit budget is sized by simulating the transaction first (actual
 * usage + 20% headroom). The transaction is left unsigned for the fee payer
 * (the player's wallet) — the client deserializes it, the wallet adds its
 * signature, and it is submitted via `useTransact`'s `versionedTx` path.
 *
 * `lookupTables` compresses the static account keys into Address Lookup Table
 * references — required for the bundled `[ed25519, crank, purchase]` flow,
 * which otherwise overflows the 1232-byte transaction limit.
 */
export async function coSign(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  lookupTables?: AddressLookupTableAccount[],
): Promise<string> {
  const client = serverClient();

  // Simulate once with a high ceiling to measure real compute usage.
  const txSimulate = await client.buildVersionedTransaction(instructions, feePayer, {
    computeUnits: 1_000_000,
    lookupTables,
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
    lookupTables,
  });
  // VersionedTransaction.sign() fills only the slots whose pubkeys it holds —
  // i.e. a partial sign of the game_authority slot. The fee-payer slot stays
  // empty for the wallet to fill. v3: both the keypair load and sign are async.
  const authority = await gameAuthorityKeypair();
  await tx.sign([authority]);
  return Buffer.from(tx.serialize()).toString("base64");
}

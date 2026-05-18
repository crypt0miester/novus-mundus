"use client";

import {
  PACKET_DATA_SIZE,
  type TransactionInstruction,
  type PublicKey,
} from "@solana/web3.js";
import type { NovusMundusClient } from "novus-mundus-sdk";

/**
 * Pack an ordered list of instructions into the fewest transactions that each
 * fit under the wire size limit (`PACKET_DATA_SIZE`, 1232 bytes).
 *
 * Use this instead of hard-coding "always N transactions": the actual count
 * depends on what work is needed. A brand-new wallet claiming for the first
 * time may need `init_user` + `init_player` + `create_estate`; an existing
 * user joining a *new kingdom* only needs `init_player` + `create_estate`,
 * which fits in a single transaction — so they should only sign once.
 *
 * Instruction order is preserved: dependent instructions stay in sequence,
 * and any that land in the same transaction still execute in order and see
 * each other's state.
 *
 * Greedy left-to-right — keep appending to the current transaction until the
 * next instruction would overflow it, then start a new one. A single
 * instruction that cannot fit on its own is still emitted in its own group
 * (nothing can be done — and it will fail loudly at send time).
 */
export async function packInstructions(
  instructions: TransactionInstruction[],
  client: NovusMundusClient,
  feePayer: PublicKey,
): Promise<TransactionInstruction[][]> {
  if (instructions.length === 0) return [];

  const fits = async (ixs: TransactionInstruction[]): Promise<boolean> => {
    try {
      // computeUnitPrice does not affect serialized length — use 0 for the
      // measurement; useTransact applies the real priority fee when sending.
      const tx = await client.buildVersionedTransaction(ixs, feePayer, {
        computeUnits: 400_000,
        computeUnitPrice: 0,
      });
      return tx.serialize().length <= PACKET_DATA_SIZE;
    } catch {
      // serialize() throws when the compiled message is over-long.
      return false;
    }
  };

  const groups: TransactionInstruction[][] = [];
  let current: TransactionInstruction[] = [];

  for (const ix of instructions) {
    if (current.length === 0) {
      current = [ix];
      continue;
    }
    if (await fits([...current, ix])) {
      current.push(ix);
    } else {
      groups.push(current);
      current = [ix];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups;
}

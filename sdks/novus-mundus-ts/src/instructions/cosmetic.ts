/**
 * Cosmetic Instructions
 *
 * Instructions for the on-chain CosmeticsSection:
 * - Equip a cosmetic the player owns (sets equipped_<kind> = id)
 *
 * Acquisition happens via the shop's `purchase_item` flow with the
 * cosmetic item_type ranges (see cosmetics-catalog.ts on the web side).
 * Once owned, this instruction sets which slot is active.
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS } from '../program';
import { ByteWriter, createInstructionData } from '../utils/serialize';
import { derivePlayerPda } from '../pda';

/** Matches the on-chain `equipped_<kind>` slot order. */
export enum CosmeticKind {
  AvatarFrame = 0,
  NameColor = 1,
  Title = 2,
  Badge = 3,
  AttackEffect = 4,
  VictoryPose = 5,
}

export interface EquipCosmeticAccounts {
  /** Owner wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA (used to derive the player PDA) */
  gameEngine: PublicKey;
}

export interface EquipCosmeticParams {
  kind: CosmeticKind;
  /** Catalog id; 0 = unequip (always allowed regardless of ownership) */
  id: number;
}

/**
 * Equip a cosmetic the player owns. Chain validates `(owned_<kind> >> id) & 1`
 * before setting `equipped_<kind> = id`. id=0 is the "unequip" sentinel and
 * bypasses the ownership check.
 *
 * Discriminator: 322
 */
export async function createEquipCosmeticInstruction(
  accounts: EquipCosmeticAccounts,
  params: EquipCosmeticParams,
): Promise<TransactionInstruction> {
  // NaN/non-integer slips both `< 0` and `>= 64` and would serialize to
  // u16 0 (writeU16 bit-ands), which equip.rs treats as the unequip
  // sentinel — silently clearing the slot the caller meant to set.
  // Reject explicitly so a malformed id surfaces as an error rather than
  // a destructive no-op.
  if (!Number.isInteger(params.id) || params.id < 0 || params.id >= 64) {
    throw new Error(`Cosmetic id ${params.id} out of range (0–63)`);
  }
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
  ];

  const writer = new ByteWriter(3);
  writer.writeU8(params.kind);
  writer.writeU16(params.id);

  const data = createInstructionData(DISCRIMINATORS.COSMETIC_EQUIP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Combat Instructions
 *
 * Instructions for combat:
 * - Attack player (PvP)
 * - Attack encounter (PvE)
 */

import {
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS } from '../program.ts';
import { BufferWriter, createInstructionData } from '../utils/serialize.ts';
import {
  derivePlayerPda,
  deriveCityPda,
  deriveEstatePda,
  deriveEventParticipationPda,
  deriveEventPda,
} from '../pda.ts';

// ============================================================
// Attack Player (PvP)
// ============================================================

export interface AttackPlayerAccounts {
  /** Attacker's wallet (signer) */
  attacker: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Defender's player account PDA */
  defenderPlayer: PublicKey;
  /** Defender's wallet (required if defenderEventId is provided) */
  defenderOwner?: PublicKey;
  /** Attacker's current city ID */
  attackerCityId: number;
  /** Defender's current city ID (usually same as attacker) */
  defenderCityId: number;
  /** Optional: Attacker's event ID for scoring */
  attackerEventId?: number;
  /** Optional: Defender's event ID for scoring (requires defenderOwner) */
  defenderEventId?: number;
}

export interface AttackPlayerParams {
  /** True for drive-by attack (requires 10k+ units, 25% damage penalty) */
  driveBy: boolean;
}

/**
 * Attack another player (PvP combat).
 *
 * Requirements:
 * - Must be in same location (cell) as defender
 * - Defender cannot be in new player protection
 * - Cannot attack teammates
 * - Cannot attack self
 * - Cannot attack while traveling
 * - Cannot attack while in active rally
 *
 * Combat mechanics:
 * - Operative units + weapons determine attack power
 * - Time-of-day affects combat (night = attacker bonus)
 * - Defender's units + weapons provide defense
 * - Armor reduces incoming damage
 * - Loot transferred directly on victory (cash, armor, produce, vehicles, weapons)
 */
export function createAttackPlayerInstruction(
  accounts: AttackPlayerAccounts,
  params: AttackPlayerParams
): TransactionInstruction {
  const [attackerPlayer] = derivePlayerPda(accounts.gameEngine, accounts.attacker);
  const [attackerCity] = deriveCityPda(accounts.gameEngine, accounts.attackerCityId);
  const [defenderCity] = deriveCityPda(accounts.gameEngine, accounts.defenderCityId);

  const keys = [
    { pubkey: attackerPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.defenderPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.attacker, isSigner: true, isWritable: false },
    { pubkey: attackerCity, isSigner: false, isWritable: false },
    { pubkey: defenderCity, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Optional attacker event accounts (must be paired)
  if (accounts.attackerEventId !== undefined) {
    const [attackerEvent] = deriveEventPda(accounts.gameEngine, accounts.attackerEventId);
    const [attackerEventParticipation] = deriveEventParticipationPda(accounts.gameEngine, accounts.attackerEventId, accounts.attacker);
    keys.push({ pubkey: attackerEventParticipation, isSigner: false, isWritable: true });
    keys.push({ pubkey: attackerEvent, isSigner: false, isWritable: true });
  }

  // Optional defender event accounts (must be paired, only if attacker events provided)
  if (accounts.defenderEventId !== undefined && accounts.attackerEventId !== undefined && accounts.defenderOwner) {
    const [defenderEvent] = deriveEventPda(accounts.gameEngine, accounts.defenderEventId);
    const [defenderEventParticipation] = deriveEventParticipationPda(accounts.gameEngine, accounts.defenderEventId, accounts.defenderOwner);
    keys.push({ pubkey: defenderEventParticipation, isSigner: false, isWritable: true });
    keys.push({ pubkey: defenderEvent, isSigner: false, isWritable: true });
  }

  // Instruction data: drive_by (bool, 1 byte)
  const writer = new BufferWriter(1);
  writer.writeBool(params.driveBy);

  const data = createInstructionData(DISCRIMINATORS.ATTACK_PLAYER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Attack Encounter (PvE)
// ============================================================

export interface AttackEncounterAccounts {
  /** Attacker's wallet (signer, pays rent for loot if encounter dies) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Encounter account to attack */
  encounter: PublicKey;
  /** Optional: Event ID for scoring */
  eventId?: number;
  /**
   * Optional: Loot account (required if encounter will die).
   * Derive using deriveLootPda(owner, lootId) where lootId = player.lootCounter
   */
  loot?: PublicKey;
  /**
   * Optional: Encounter's location account (required if encounter will die).
   * Derive using deriveLocationPda(cityId, gridLat, gridLong)
   */
  encounterLocation?: PublicKey;
  /**
   * Optional: Account to receive location rent refund (required if encounter will die).
   * Usually the GameEngine's crank authority.
   */
  locationCreatorRefund?: PublicKey;
}

export interface AttackEncounterParams {
  /** ID of the encounter to attack */
  encounterId: bigint | number;
}

/**
 * Attack an encounter (PvE combat).
 *
 * Encounters have:
 * - Rarity (Common to Legendary)
 * - Level (scales difficulty and rewards)
 * - Health that must be depleted
 *
 * Requirements:
 * - Must be within attack range (10 meters) of encounter
 * - Must have operative units
 * - Cannot attack while traveling
 * - Cannot attack while in active rally
 * - Player level must be within max_encounter_level_diff of encounter
 *
 * Rewards based on:
 * - Encounter rarity and level
 * - Time-of-day bonuses (night = better loot)
 * - Hero loot/synchrony bonuses
 * - Observatory building bonus (estate daily mini-game)
 *
 * Dual reward system:
 * - Instant cash reward proportional to damage dealt
 * - LootAccount created on kill with full rewards (claim separately)
 */
export function createAttackEncounterInstruction(
  accounts: AttackEncounterAccounts,
  params: AttackEncounterParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);

  // Base accounts (always required)
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.encounter, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // system_program placeholder
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Replace system_program placeholder with actual program ID
  keys[4] = { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false };

  // Optional event accounts (must be paired)
  const hasEvent = accounts.eventId !== undefined;
  if (hasEvent) {
    const [event] = deriveEventPda(accounts.gameEngine, accounts.eventId!);
    const [eventParticipation] = deriveEventParticipationPda(accounts.gameEngine, accounts.eventId!, accounts.owner);
    keys.push({ pubkey: eventParticipation, isSigner: false, isWritable: true });
    keys.push({ pubkey: event, isSigner: false, isWritable: true });
  }

  // Optional death accounts (all three must be present together)
  const hasDeathAccounts = accounts.loot && accounts.encounterLocation && accounts.locationCreatorRefund;
  if (hasDeathAccounts) {
    keys.push({ pubkey: accounts.loot!, isSigner: false, isWritable: true });
    keys.push({ pubkey: accounts.encounterLocation!, isSigner: false, isWritable: true });
    keys.push({ pubkey: accounts.locationCreatorRefund!, isSigner: false, isWritable: true });
  }

  // Instruction data: encounter_id (u64, 8 bytes)
  const writer = new BufferWriter(8);
  writer.writeU64(params.encounterId);

  const data = createInstructionData(DISCRIMINATORS.ATTACK_ENCOUNTER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Account Fetching & Deserialization Utilities
 *
 * Helpers for fetching and parsing on-chain account data in tests.
 */

import {
  Connection,
  PublicKey,
  type AccountInfo,
  type Commitment,
} from '@solana/web3.js';
import BN from 'bn.js';

import {
  // State types
  type PlayerAccount,
  type TeamAccount,
  type TeamMemberSlot,
  type TeamInviteAccount,
  type TreasuryRequest,
  type RallyAccount,
  type RallyParticipant,
  type ReinforcementAccount,
  type EncounterAccount,
  type ExpeditionAccount,
  type ArenaSeasonAccount,
  type ArenaParticipantAccount,
  type LootAccount,
  type EventAccount,
  type EventParticipation,
  type GameEngineAccount,
  type CityAccount,
  type ShopConfigAccount,
  type ShopItemAccount,

  // Deserializers
  deserializePlayer,
  deserializeTeam,
  deserializeTeamMemberSlot,
  deserializeTeamInvite,
  deserializeTreasuryRequest,
  deserializeRally,
  deserializeRallyParticipant,
  deserializeReinforcement,
  deserializeEncounter,
  deserializeExpedition,
  deserializeArenaSeason,
  deserializeArenaParticipant,
  deserializeLoot,
  deserializeEvent,
  deserializeEventParticipation,
  deserializeGameEngine,
  deserializeCity,
  deserializeShopConfig,
  deserializeShopItem,

  // PDAs
  derivePlayerPda,
  deriveTeamPda,
  deriveTeamSlotPda,
  deriveTeamInvitePda,
  deriveTreasuryRequestPda,
  deriveRallyPda,
  deriveRallyParticipantPda,
  deriveReinforcementPda,
  deriveEncounterPda,
  deriveExpeditionPda,
  deriveArenaSeasonPda,
  deriveArenaParticipantPda,
  deriveLootPda,
  deriveEventPda,
  deriveEventParticipationPda,
  deriveCastlePda,
  deriveDungeonRunPda,
  deriveGameEnginePda,
  deriveCityPda,
  deriveEstatePda,
  deriveShopConfigPda,
  deriveShopItemPda,
} from '../../src/index';

// ============================================================
// Types
// ============================================================

export interface AccountSnapshot<T> {
  pubkey: PublicKey;
  data: T;
  lamports: number;
  timestamp: number;
}

export interface AccountDiff<T> {
  before: AccountSnapshot<T>;
  after: AccountSnapshot<T>;
  changes: Partial<Record<keyof T, { before: any; after: any }>>;
}

// ============================================================
// Generic Account Fetching
// ============================================================

/**
 * Fetch raw account data.
 */
export async function fetchAccount(
  connection: Connection,
  pubkey: PublicKey,
  commitment: Commitment = 'confirmed'
): Promise<AccountInfo<Buffer> | null> {
  return await connection.getAccountInfo(pubkey, commitment);
}

/**
 * Fetch multiple accounts at once.
 */
export async function fetchAccounts(
  connection: Connection,
  pubkeys: PublicKey[],
  commitment: Commitment = 'confirmed'
): Promise<(AccountInfo<Buffer> | null)[]> {
  return await connection.getMultipleAccountsInfo(pubkeys, commitment);
}

/**
 * Check if an account exists.
 */
export async function accountExists(
  connection: Connection,
  pubkey: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(pubkey);
  return info !== null && info.data.length > 0;
}

// ============================================================
// Player Account
// ============================================================

export async function fetchPlayer(
  connection: Connection,
  playerPda: PublicKey
): Promise<PlayerAccount | null> {
  const info = await fetchAccount(connection, playerPda);
  if (!info || info.data.length === 0) return null;
  return deserializePlayer(info.data);
}

export async function fetchPlayerByOwner(
  connection: Connection,
  gameEngine: PublicKey,
  owner: PublicKey
): Promise<PlayerAccount | null> {
  const [playerPda] = derivePlayerPda(gameEngine, owner);
  return fetchPlayer(connection, playerPda);
}

export async function snapshotPlayer(
  connection: Connection,
  playerPda: PublicKey
): Promise<AccountSnapshot<PlayerAccount> | null> {
  const info = await fetchAccount(connection, playerPda);
  if (!info || info.data.length === 0) return null;

  return {
    pubkey: playerPda,
    data: deserializePlayer(info.data),
    lamports: info.lamports,
    timestamp: Date.now(),
  };
}

// ============================================================
// Team Accounts
// ============================================================

export async function fetchTeam(
  connection: Connection,
  teamPda: PublicKey
): Promise<TeamAccount | null> {
  const info = await fetchAccount(connection, teamPda);
  if (!info || info.data.length === 0) return null;
  return deserializeTeam(info.data);
}

export async function fetchTeamById(
  connection: Connection,
  gameEngine: PublicKey,
  teamId: number
): Promise<TeamAccount | null> {
  const [teamPda] = deriveTeamPda(gameEngine, teamId);
  return fetchTeam(connection, teamPda);
}

export async function fetchTeamMemberSlot(
  connection: Connection,
  team: PublicKey,
  slotIndex: number
): Promise<TeamMemberSlot | null> {
  const [slotPda] = deriveTeamSlotPda(team, slotIndex);
  const info = await fetchAccount(connection, slotPda);
  if (!info || info.data.length === 0) return null;
  return deserializeTeamMemberSlot(info.data);
}

export async function fetchTeamInvite(
  connection: Connection,
  team: PublicKey,
  invitee: PublicKey
): Promise<TeamInviteAccount | null> {
  const [invitePda] = deriveTeamInvitePda(team, invitee);
  const info = await fetchAccount(connection, invitePda);
  if (!info || info.data.length === 0) return null;
  return deserializeTeamInvite(info.data);
}

export async function fetchTreasuryRequest(
  connection: Connection,
  team: PublicKey,
  requester: PublicKey
): Promise<TreasuryRequest | null> {
  const [requestPda] = deriveTreasuryRequestPda(team, requester);
  const info = await fetchAccount(connection, requestPda);
  if (!info || info.data.length === 0) return null;
  return deserializeTreasuryRequest(info.data);
}

// ============================================================
// Rally Accounts
// ============================================================

export async function fetchRally(
  connection: Connection,
  rallyPda: PublicKey
): Promise<RallyAccount | null> {
  const info = await fetchAccount(connection, rallyPda);
  if (!info || info.data.length === 0) return null;
  return deserializeRally(info.data);
}

export async function fetchRallyByCreator(
  connection: Connection,
  gameEngine: PublicKey,
  creator: PublicKey,
  rallyId: number
): Promise<RallyAccount | null> {
  const [rallyPda] = deriveRallyPda(gameEngine, creator, rallyId);
  return fetchRally(connection, rallyPda);
}

export async function fetchRallyParticipant(
  connection: Connection,
  gameEngine: PublicKey,
  rallyCreator: PublicKey,
  rallyId: number | bigint,
  participant: PublicKey
): Promise<RallyParticipant | null> {
  const [participantPda] = deriveRallyParticipantPda(gameEngine, rallyCreator, rallyId, participant);
  const info = await fetchAccount(connection, participantPda);
  if (!info || info.data.length === 0) return null;
  return deserializeRallyParticipant(info.data);
}

// ============================================================
// Reinforcement Accounts
// ============================================================

export async function fetchReinforcement(
  connection: Connection,
  gameEngine: PublicKey,
  sender: PublicKey,
  receiver: PublicKey
): Promise<ReinforcementAccount | null> {
  const [reinforcementPda] = deriveReinforcementPda(gameEngine, sender, receiver);
  const info = await fetchAccount(connection, reinforcementPda);
  if (!info || info.data.length === 0) return null;
  return deserializeReinforcement(info.data);
}

// ============================================================
// Encounter Accounts
// ============================================================

export async function fetchEncounter(
  connection: Connection,
  encounterPda: PublicKey
): Promise<EncounterAccount | null> {
  const info = await fetchAccount(connection, encounterPda);
  if (!info || info.data.length === 0) return null;
  return deserializeEncounter(info.data);
}

export async function fetchEncounterByCity(
  connection: Connection,
  gameEngine: PublicKey,
  cityId: number,
  encounterId: number
): Promise<EncounterAccount | null> {
  const [encounterPda] = deriveEncounterPda(gameEngine, cityId, encounterId);
  return fetchEncounter(connection, encounterPda);
}

// ============================================================
// Expedition Accounts
// ============================================================

export async function fetchExpedition(
  connection: Connection,
  owner: PublicKey
): Promise<ExpeditionAccount | null> {
  const [expeditionPda] = deriveExpeditionPda(owner);
  const info = await fetchAccount(connection, expeditionPda);
  if (!info || info.data.length === 0) return null;
  return deserializeExpedition(info.data);
}

// ============================================================
// Arena Accounts
// ============================================================

export async function fetchArenaSeason(
  connection: Connection,
  gameEngine: PublicKey,
  seasonId: number
): Promise<ArenaSeasonAccount | null> {
  const [seasonPda] = deriveArenaSeasonPda(gameEngine, seasonId);
  const info = await fetchAccount(connection, seasonPda);
  if (!info || info.data.length === 0) return null;
  return deserializeArenaSeason(info.data);
}

export async function fetchArenaParticipant(
  connection: Connection,
  gameEngine: PublicKey,
  seasonId: number,
  ownerOrPlayerPda: PublicKey
): Promise<ArenaParticipantAccount | null> {
  // ownerOrPlayerPda should be the PlayerAccount PDA (participant PDA is keyed by player PDA)
  const [participantPda] = deriveArenaParticipantPda(gameEngine, seasonId, ownerOrPlayerPda);
  const info = await fetchAccount(connection, participantPda);
  if (!info || info.data.length === 0) return null;
  return deserializeArenaParticipant(info.data);
}

// ============================================================
// Loot Accounts
// ============================================================

export async function fetchLoot(
  connection: Connection,
  playerPda: PublicKey,
  lootId: number | bigint
): Promise<LootAccount | null> {
  const [lootPda] = deriveLootPda(playerPda, lootId);
  const info = await fetchAccount(connection, lootPda);
  if (!info || info.data.length === 0) return null;
  return deserializeLoot(info.data);
}

// ============================================================
// Event Accounts
// ============================================================

export async function fetchEvent(
  connection: Connection,
  gameEngine: PublicKey,
  eventId: number
): Promise<EventAccount | null> {
  const [eventPda] = deriveEventPda(gameEngine, eventId);
  const info = await fetchAccount(connection, eventPda);
  if (!info || info.data.length === 0) return null;
  return deserializeEvent(info.data);
}

export async function fetchEventParticipation(
  connection: Connection,
  gameEngine: PublicKey,
  eventId: number,
  playerOwner: PublicKey
): Promise<EventParticipation | null> {
  const [participationPda] = deriveEventParticipationPda(gameEngine, eventId, playerOwner);
  const info = await fetchAccount(connection, participationPda);
  if (!info || info.data.length === 0) return null;
  return deserializeEventParticipation(info.data);
}

// ============================================================
// Castle Accounts
// Note: Castle deserialization is not exported from SDK yet
// ============================================================

export async function fetchCastleRaw(
  connection: Connection,
  gameEngine: PublicKey,
  cityId: number,
  castleId: number
): Promise<AccountInfo<Buffer> | null> {
  const [castlePda] = deriveCastlePda(gameEngine, cityId, castleId);
  return fetchAccount(connection, castlePda);
}

// ============================================================
// Dungeon Accounts
// Note: Dungeon deserialization is not exported from SDK yet
// ============================================================

export async function fetchDungeonRunRaw(
  connection: Connection,
  player: PublicKey
): Promise<AccountInfo<Buffer> | null> {
  const [runPda] = deriveDungeonRunPda(player);
  return fetchAccount(connection, runPda);
}

// ============================================================
// Estate Accounts
// Note: Estate account type is not in SDK yet
// ============================================================

export async function fetchEstateRaw(
  connection: Connection,
  playerPda: PublicKey
): Promise<AccountInfo<Buffer> | null> {
  const [estatePda] = deriveEstatePda(playerPda);
  return fetchAccount(connection, estatePda);
}

// ============================================================
// Core Accounts
// ============================================================

export async function fetchGameEngine(
  connection: Connection,
  kingdomId: number
): Promise<GameEngineAccount | null> {
  const [gameEnginePda] = deriveGameEnginePda(kingdomId);
  const info = await fetchAccount(connection, gameEnginePda);
  if (!info || info.data.length === 0) return null;
  return deserializeGameEngine(info.data);
}

export async function fetchCity(
  connection: Connection,
  gameEngine: PublicKey,
  cityId: number
): Promise<CityAccount | null> {
  const [cityPda] = deriveCityPda(gameEngine, cityId);
  const info = await fetchAccount(connection, cityPda);
  if (!info || info.data.length === 0) return null;
  return deserializeCity(info.data);
}

export async function fetchShopConfig(
  connection: Connection,
  gameEngine: PublicKey
): Promise<ShopConfigAccount | null> {
  const [shopConfigPda] = deriveShopConfigPda(gameEngine);
  const info = await fetchAccount(connection, shopConfigPda);
  if (!info || info.data.length === 0) return null;
  return deserializeShopConfig(info.data);
}

export async function fetchShopItem(
  connection: Connection,
  gameEngine: PublicKey,
  itemId: number
): Promise<ShopItemAccount | null> {
  const [shopItemPda] = deriveShopItemPda(gameEngine, itemId);
  const info = await fetchAccount(connection, shopItemPda);
  if (!info || info.data.length === 0) return null;
  return deserializeShopItem(info.data);
}

// ============================================================
// Snapshot & Diff Utilities
// ============================================================

/**
 * Compare two player snapshots and return differences.
 */
export function diffPlayerSnapshots(
  before: AccountSnapshot<PlayerAccount>,
  after: AccountSnapshot<PlayerAccount>
): AccountDiff<PlayerAccount> {
  const changes: Partial<Record<keyof PlayerAccount, { before: any; after: any }>> = {};

  // Compare all fields
  const keysToCompare: (keyof PlayerAccount)[] = [
    'lockedNovi', 'cashOnHand', 'cashInVault',
    'defensiveUnit1', 'defensiveUnit2', 'defensiveUnit3',
    'operativeUnit1', 'operativeUnit2', 'operativeUnit3',
    'meleeWeapons', 'rangedWeapons', 'siegeWeapons', 'armorPieces', 'produce',
    'level', 'currentXp', 'reputation', 'networth',
    'encounterStamina', 'currentCity',
  ];

  for (const key of keysToCompare) {
    const beforeVal = before.data[key];
    const afterVal = after.data[key];

    if (beforeVal instanceof BN && afterVal instanceof BN) {
      if (!beforeVal.eq(afterVal)) {
        changes[key] = { before: beforeVal, after: afterVal };
      }
    } else if (beforeVal !== afterVal) {
      changes[key] = { before: beforeVal, after: afterVal };
    }
  }

  return { before, after, changes };
}

/**
 * Assert no unexpected changes in player state.
 */
export function assertNoUnexpectedChanges(
  diff: AccountDiff<PlayerAccount>,
  expectedChanges: (keyof PlayerAccount)[]
): void {
  const unexpectedChanges = Object.keys(diff.changes).filter(
    key => !expectedChanges.includes(key as keyof PlayerAccount)
  );

  if (unexpectedChanges.length > 0) {
    throw new Error(
      `Unexpected changes in player state: ${unexpectedChanges.join(', ')}`
    );
  }
}

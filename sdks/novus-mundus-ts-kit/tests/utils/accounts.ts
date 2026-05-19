/**
 * Account Fetching & Deserialization Utilities
 *
 * Helpers for fetching and parsing on-chain account data in tests.
 * Uses LiteSVM for in-process account reads.
 */

import { type Address } from '@solana/kit';

import { type LiteSVM } from '../fixtures/svm';

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

// Types

/** Raw account data fetched from LiteSVM. */
export interface RawAccount {
  data: Uint8Array;
  lamports: number;
}

export interface AccountSnapshot<T> {
  pubkey: Address;
  data: T;
  lamports: number;
  timestamp: number;
}

export interface AccountDiff<T> {
  before: AccountSnapshot<T>;
  after: AccountSnapshot<T>;
  changes: Partial<Record<keyof T, { before: any; after: any }>>;
}

// Generic Account Fetching

/**
 * Fetch raw account data.
 */
export async function fetchAccount(
  svm: LiteSVM,
  pubkey: Address,
): Promise<RawAccount | null> {
  const info = svm.getAccount(pubkey);
  if (!info.exists) return null;
  return { data: info.data, lamports: Number(info.lamports) };
}

/**
 * Fetch multiple accounts.
 */
export async function fetchAccounts(
  svm: LiteSVM,
  pubkeys: Address[],
): Promise<(RawAccount | null)[]> {
  return pubkeys.map((pk) => {
    const info = svm.getAccount(pk);
    return info.exists ? { data: info.data, lamports: Number(info.lamports) } : null;
  });
}

/**
 * Check if an account exists.
 */
export async function accountExists(
  svm: LiteSVM,
  pubkey: Address,
): Promise<boolean> {
  const info = svm.getAccount(pubkey);
  return info.exists && info.data.length > 0;
}

// Player Account

export async function fetchPlayer(
  svm: LiteSVM,
  playerPda: Address,
): Promise<PlayerAccount | null> {
  const info = await fetchAccount(svm, playerPda);
  if (!info || info.data.length === 0) return null;
  return deserializePlayer(info.data);
}

export async function fetchPlayerByOwner(
  svm: LiteSVM,
  gameEngine: Address,
  owner: Address,
): Promise<PlayerAccount | null> {
  const [playerPda] = await derivePlayerPda(gameEngine, owner);
  return fetchPlayer(svm, playerPda);
}

export async function snapshotPlayer(
  svm: LiteSVM,
  playerPda: Address,
): Promise<AccountSnapshot<PlayerAccount> | null> {
  const info = await fetchAccount(svm, playerPda);
  if (!info || info.data.length === 0) return null;

  return {
    pubkey: playerPda,
    data: deserializePlayer(info.data),
    lamports: info.lamports,
    timestamp: Date.now(),
  };
}

// Team Accounts

export async function fetchTeam(
  svm: LiteSVM,
  teamPda: Address,
): Promise<TeamAccount | null> {
  const info = await fetchAccount(svm, teamPda);
  if (!info || info.data.length === 0) return null;
  return deserializeTeam(info.data);
}

export async function fetchTeamById(
  svm: LiteSVM,
  gameEngine: Address,
  teamId: number,
): Promise<TeamAccount | null> {
  const [teamPda] = await deriveTeamPda(gameEngine, teamId);
  return fetchTeam(svm, teamPda);
}

export async function fetchTeamMemberSlot(
  svm: LiteSVM,
  team: Address,
  slotIndex: number,
): Promise<TeamMemberSlot | null> {
  const [slotPda] = await deriveTeamSlotPda(team, slotIndex);
  const info = await fetchAccount(svm, slotPda);
  if (!info || info.data.length === 0) return null;
  return deserializeTeamMemberSlot(info.data);
}

export async function fetchTeamInvite(
  svm: LiteSVM,
  team: Address,
  invitee: Address,
): Promise<TeamInviteAccount | null> {
  const [invitePda] = await deriveTeamInvitePda(team, invitee);
  const info = await fetchAccount(svm, invitePda);
  if (!info || info.data.length === 0) return null;
  return deserializeTeamInvite(info.data);
}

export async function fetchTreasuryRequest(
  svm: LiteSVM,
  team: Address,
  requester: Address,
): Promise<TreasuryRequest | null> {
  const [requestPda] = await deriveTreasuryRequestPda(team, requester);
  const info = await fetchAccount(svm, requestPda);
  if (!info || info.data.length === 0) return null;
  return deserializeTreasuryRequest(info.data);
}

// Rally Accounts

export async function fetchRally(
  svm: LiteSVM,
  rallyPda: Address,
): Promise<RallyAccount | null> {
  const info = await fetchAccount(svm, rallyPda);
  if (!info || info.data.length === 0) return null;
  return deserializeRally(info.data);
}

export async function fetchRallyByCreator(
  svm: LiteSVM,
  gameEngine: Address,
  creator: Address,
  rallyId: number,
): Promise<RallyAccount | null> {
  const [rallyPda] = await deriveRallyPda(gameEngine, creator, rallyId);
  return fetchRally(svm, rallyPda);
}

export async function fetchRallyParticipant(
  svm: LiteSVM,
  gameEngine: Address,
  rallyCreator: Address,
  rallyId: number | bigint,
  participant: Address,
): Promise<RallyParticipant | null> {
  const [participantPda] = await deriveRallyParticipantPda(gameEngine, rallyCreator, rallyId, participant);
  const info = await fetchAccount(svm, participantPda);
  if (!info || info.data.length === 0) return null;
  return deserializeRallyParticipant(info.data);
}

// Reinforcement Accounts

export async function fetchReinforcement(
  svm: LiteSVM,
  gameEngine: Address,
  sender: Address,
  receiver: Address,
): Promise<ReinforcementAccount | null> {
  const [reinforcementPda] = await deriveReinforcementPda(gameEngine, sender, receiver);
  const info = await fetchAccount(svm, reinforcementPda);
  if (!info || info.data.length === 0) return null;
  return deserializeReinforcement(info.data);
}

// Encounter Accounts

export async function fetchEncounter(
  svm: LiteSVM,
  encounterPda: Address,
): Promise<EncounterAccount | null> {
  const info = await fetchAccount(svm, encounterPda);
  if (!info || info.data.length === 0) return null;
  return deserializeEncounter(info.data);
}

export async function fetchEncounterByCity(
  svm: LiteSVM,
  gameEngine: Address,
  cityId: number,
  encounterId: number,
): Promise<EncounterAccount | null> {
  const [encounterPda] = await deriveEncounterPda(gameEngine, cityId, encounterId);
  return fetchEncounter(svm, encounterPda);
}

// Expedition Accounts

export async function fetchExpedition(
  svm: LiteSVM,
  owner: Address,
): Promise<ExpeditionAccount | null> {
  const [expeditionPda] = await deriveExpeditionPda(owner);
  const info = await fetchAccount(svm, expeditionPda);
  if (!info || info.data.length === 0) return null;
  return deserializeExpedition(info.data);
}

// Arena Accounts

export async function fetchArenaSeason(
  svm: LiteSVM,
  gameEngine: Address,
  seasonId: number,
): Promise<ArenaSeasonAccount | null> {
  const [seasonPda] = await deriveArenaSeasonPda(gameEngine, seasonId);
  const info = await fetchAccount(svm, seasonPda);
  if (!info || info.data.length === 0) return null;
  return deserializeArenaSeason(info.data);
}

export async function fetchArenaParticipant(
  svm: LiteSVM,
  gameEngine: Address,
  seasonId: number,
  ownerOrPlayerPda: Address,
): Promise<ArenaParticipantAccount | null> {
  const [participantPda] = await deriveArenaParticipantPda(gameEngine, seasonId, ownerOrPlayerPda);
  const info = await fetchAccount(svm, participantPda);
  if (!info || info.data.length === 0) return null;
  return deserializeArenaParticipant(info.data);
}

// Loot Accounts

export async function fetchLoot(
  svm: LiteSVM,
  playerPda: Address,
  lootId: number | bigint,
): Promise<LootAccount | null> {
  const [lootPda] = await deriveLootPda(playerPda, lootId);
  const info = await fetchAccount(svm, lootPda);
  if (!info || info.data.length === 0) return null;
  return deserializeLoot(info.data);
}

// Event Accounts

export async function fetchEvent(
  svm: LiteSVM,
  gameEngine: Address,
  eventId: number,
): Promise<EventAccount | null> {
  const [eventPda] = await deriveEventPda(gameEngine, eventId);
  const info = await fetchAccount(svm, eventPda);
  if (!info || info.data.length === 0) return null;
  return deserializeEvent(info.data);
}

export async function fetchEventParticipation(
  svm: LiteSVM,
  gameEngine: Address,
  eventId: number,
  playerOwner: Address,
): Promise<EventParticipation | null> {
  const [participationPda] = await deriveEventParticipationPda(gameEngine, eventId, playerOwner);
  const info = await fetchAccount(svm, participationPda);
  if (!info || info.data.length === 0) return null;
  return deserializeEventParticipation(info.data);
}

// Castle Accounts

export async function fetchCastleRaw(
  svm: LiteSVM,
  gameEngine: Address,
  cityId: number,
  castleId: number,
): Promise<RawAccount | null> {
  const [castlePda] = await deriveCastlePda(gameEngine, cityId, castleId);
  return fetchAccount(svm, castlePda);
}

// Dungeon Accounts

export async function fetchDungeonRunRaw(
  svm: LiteSVM,
  player: Address,
): Promise<RawAccount | null> {
  const [runPda] = await deriveDungeonRunPda(player);
  return fetchAccount(svm, runPda);
}

// Estate Accounts

export async function fetchEstateRaw(
  svm: LiteSVM,
  playerPda: Address,
): Promise<RawAccount | null> {
  const [estatePda] = await deriveEstatePda(playerPda);
  return fetchAccount(svm, estatePda);
}

// Core Accounts

export async function fetchGameEngine(
  svm: LiteSVM,
  kingdomId: number,
): Promise<GameEngineAccount | null> {
  const [gameEnginePda] = await deriveGameEnginePda(kingdomId);
  const info = await fetchAccount(svm, gameEnginePda);
  if (!info || info.data.length === 0) return null;
  return deserializeGameEngine(info.data);
}

export async function fetchCity(
  svm: LiteSVM,
  gameEngine: Address,
  cityId: number,
): Promise<CityAccount | null> {
  const [cityPda] = await deriveCityPda(gameEngine, cityId);
  const info = await fetchAccount(svm, cityPda);
  if (!info || info.data.length === 0) return null;
  return deserializeCity(info.data);
}

export async function fetchShopConfig(
  svm: LiteSVM,
  gameEngine: Address,
): Promise<ShopConfigAccount | null> {
  const [shopConfigPda] = await deriveShopConfigPda(gameEngine);
  const info = await fetchAccount(svm, shopConfigPda);
  if (!info || info.data.length === 0) return null;
  return deserializeShopConfig(info.data);
}

export async function fetchShopItem(
  svm: LiteSVM,
  gameEngine: Address,
  itemId: number,
): Promise<ShopItemAccount | null> {
  const [shopItemPda] = await deriveShopItemPda(gameEngine, itemId);
  const info = await fetchAccount(svm, shopItemPda);
  if (!info || info.data.length === 0) return null;
  return deserializeShopItem(info.data);
}

// Snapshot & Diff Utilities

/**
 * Compare two player snapshots and return differences.
 */
export function diffPlayerSnapshots(
  before: AccountSnapshot<PlayerAccount>,
  after: AccountSnapshot<PlayerAccount>,
): AccountDiff<PlayerAccount> {
  const changes: Partial<Record<keyof PlayerAccount, { before: any; after: any }>> = {};

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

    if (typeof beforeVal === 'bigint' && typeof afterVal === 'bigint') {
      if (beforeVal !== afterVal) {
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
  expectedChanges: (keyof PlayerAccount)[],
): void {
  const unexpectedChanges = Object.keys(diff.changes).filter(
    (key) => !expectedChanges.includes(key as keyof PlayerAccount),
  );

  if (unexpectedChanges.length > 0) {
    throw new Error(
      `Unexpected changes in player state: ${unexpectedChanges.join(', ')}`,
    );
  }
}

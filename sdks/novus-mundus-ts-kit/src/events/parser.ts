/**
 * Event Parser
 *
 * Parses on-chain events from transaction logs.
 * Events are emitted via sol_log_data and appear base64-encoded in logs.
 */

import { getBase64Encoder, getStructCodec, type Decoder } from '@solana/kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { u8, i8, u16, i16, u32, i32, u64, i64, bool, pubkey, bytes, array, fixedString } from '../utils/codec';
import type { NovusMundusEvent } from './types';

// Discriminator Computation

/**
 * Compute 8-byte discriminator from event name.
 * Uses SHA256 and takes first 8 bytes (Anchor-compatible).
 */
export function computeEventDiscriminator(eventName: string): Uint8Array {
  const hash = sha256(new TextEncoder().encode(`event:${eventName}`));
  return hash.slice(0, 8);
}

/**
 * Convert discriminator to hex string for comparison.
 */
export function discriminatorToHex(disc: Uint8Array): string {
  return Array.from(disc).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Event Discriminator Map

/** Helper to create a discriminator entry */
const d = (name: string): [string, string] => [discriminatorToHex(computeEventDiscriminator(name)), name];

/** All known event discriminators mapped to event names */
export const EVENT_DISCRIMINATORS: Map<string, string> = new Map([
  // Combat
  d('PlayerAttacked'),
  d('EncounterAttacked'),
  d('EncounterDefeated'),

  // Economy
  d('ResourcesCollected'),
  d('UnitsHired'),
  d('CashTransferred'),
  d('NoviLocked'),
  d('EquipmentPurchased'),
  d('StaminaPurchased'),
  d('VaultTransfer'),

  // Team
  d('TeamCreated'),
  d('TeamJoined'),
  d('TeamLeft'),
  d('MemberKicked'),
  d('LeadershipTransferred'),
  d('TeamDisbanded'),
  d('TreasuryDeposit'),
  d('TreasuryWithdraw'),
  d('MemberRankChanged'),
  d('InviteSent'),
  d('InviteAccepted'),
  d('InviteDeclined'),
  d('InviteCancelled'),
  d('MotdUpdated'),
  d('TeamSettingsUpdated'),
  d('TreasurySettingsUpdated'),
  d('TreasuryWithdrawRequested'),
  d('TreasuryRequestApproved'),
  d('TreasuryRequestRejected'),
  d('TreasuryRequestExecuted'),
  d('TreasuryRequestCancelled'),

  // Travel
  d('IntercityTravelStarted'),
  d('IntercityTravelCompleted'),
  d('PlayerTeleported'),
  d('IntracityTravelStarted'),
  d('IntracityTravelCompleted'),
  d('TravelCancelled'),
  d('TravelSpeedup'),

  // Rally
  d('RallyCreated'),
  d('RallyJoined'),
  d('RallyExecuted'),
  d('RallyCancelled'),
  d('RallyLeft'),
  d('RallyClosed'),
  d('RallySpeedup'),
  d('RallyParticipantReturned'),

  // Reinforcement
  d('ReinforcementSent'),
  d('ReinforcementArrived'),
  d('ReinforcementRecalled'),
  d('ReinforcementRelieved'),
  d('ReinforcementReturned'),
  d('ReinforcementSpeedup'),

  // Expedition
  d('ExpeditionStarted'),
  d('ExpeditionStrike'),
  d('ExpeditionClaimed'),
  d('ExpeditionAborted'),
  d('ExpeditionSpeedup'),

  // Loot
  d('LootClaimed'),
  d('EncounterSpawned'),

  // Progression
  d('DailyRewardClaimed'),
  d('SubscriptionPurchased'),
  d('XpGained'),
  d('PlayerLeveledUp'),
  d('EventPrizeClaimed'),
  d('SubscriptionTierUpdated'),
  d('SubscriptionExpired'),

  // Estate
  d('EstateCreated'),
  d('BuildingStarted'),
  d('BuildingCompleted'),
  d('BuildingUpgradeStarted'),
  d('PlotPurchased'),
  d('EstateDailyClaimed'),

  // Forge
  d('CraftStarted'),
  d('CraftStrike'),
  d('CraftCompleted'),
  d('CraftAbandoned'),
  d('ItemEquipped'),

  // Research
  d('ResearchStarted'),
  d('ResearchCompleted'),
  d('ResearchCancelled'),
  d('ResearchSpeedup'),
  d('ResearchAscended'),
  d('PlayerAscended'),

  // Sanctuary
  d('MeditationStarted'),
  d('MeditationClaimed'),

  // Hero
  d('HeroMinted'),
  d('HeroLocked'),
  d('HeroUnlocked'),
  d('HeroLeveledUp'),
  d('HeroAssignedDefensive'),
  d('HeroBurned'),
  d('SupplyCapUpdated'),

  // Shop
  d('ItemPurchased'),
  d('BundlePurchased'),
  d('FlashSalePurchased'),
  d('NoviPurchased'),

  // Initialization
  d('PlayerCreated'),
  d('UserCreated'),
  d('CityInitialized'),
  d('GameEngineInitialized'),

  // Name
  d('PlayerNameSet'),
  d('PlayerNameRemoved'),
  d('PlayerNameUpdated'),
  d('TeamNameSet'),
  d('TeamNameRemoved'),
  d('TeamNameUpdated'),

  // Token
  d('NoviReservedToLocked'),
  d('NoviWithdrawn'),

  // Dungeon
  d('DungeonEntered'),
  d('DungeonRoomCleared'),
  d('DungeonFloorCompleted'),
  d('DungeonRelicChosen'),
  d('DungeonBossFight'),
  d('DungeonFailed'),
  d('DungeonFled'),
  d('DungeonCompleted'),
  d('DungeonResumed'),
  d('DungeonLeaderboardPrizeClaimed'),

  // Castle
  d('CastleCreated'),
  d('CastleClaimed'),
  d('CastleConquered'),
  d('CastleDefended'),
  d('CourtAppointed'),
  d('CourtDismissed'),
  d('GarrisonJoined'),
  d('GarrisonLeft'),
  d('GarrisonLootClaimed'),
  d('CastleUpgradeStarted'),
  d('CastleUpgradeCompleted'),
  d('CastleUpgradeCancelled'),
  d('CastleRewardsClaimed'),
  d('CastleProtectionExpired'),
  d('KingForceRemoved'),
  d('CastleTransitionProgress'),
  d('CastleStatusChanged'),
  d('CastleAttacked'),

  // Game Event
  d('GameEventCreated'),
  d('GameEventJoined'),
  d('GameEventFinalized'),
  d('EventScoreUpdated'),

  // Kingdom
  d('KingdomCreated'),
  d('KingdomRegistrationClosed'),
  d('PlayerJoinedKingdom'),
  d('KingdomEventCreated'),
  d('KingdomArenaSeasonStarted'),
  d('KingdomDungeonLeaderboardCreated'),
  d('KingdomCitiesInitialized'),
]);

// Event Codecs

/**
 * Packed struct codec per event, keyed by event name. Decodes the
 * post-discriminator payload. Each `getStructCodec` infers a distinct field
 * shape, so the map is typed by the decoder surface used at the call site.
 */
const EVENT_CODECS = new Map<string, Decoder<Record<string, unknown>>>();

// ── Combat ──

EVENT_CODECS.set('PlayerAttacked', getStructCodec([
  ['attacker', pubkey.codec],
  ['attackerName', fixedString(48).codec],
  ['defender', pubkey.codec],
  ['defenderName', fixedString(48).codec],
  ['damageDealt', u64.codec],
  ['damageReceived', u64.codec],
  ['cashStolen', u64.codec],
  ['armorStolen', u64.codec],
  ['produceStolen', u64.codec],
  ['vehiclesStolen', u64.codec],
  ['attackerUnitsLost', array(u64, 3).codec],
  ['defenderUnitsLost', array(u64, 3).codec],
  ['attackerWon', bool.codec],
  ['driveBy', bool.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('EncounterAttacked', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['encounter', pubkey.codec],
  ['damageDealt', u64.codec],
  ['healthRemaining', u64.codec],
  ['staminaConsumed', u16.codec],
  ['noviConsumed', u64.codec],
  ['attackerCount', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('EncounterDefeated', getStructCodec([
  ['encounter', pubkey.codec],
  ['encounterType', u8.codec],
  ['level', u8.codec],
  ['totalAttackers', u8.codec],
  ['killingBlowBy', pubkey.codec],
  ['killingBlowName', fixedString(48).codec],
  ['lootCash', u64.codec],
  ['lootNovi', u64.codec],
  ['timestamp', i64.codec],
]));

// ── Economy ──

EVENT_CODECS.set('ResourcesCollected', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['collectionType', u8.codec],
  ['noviConsumed', u64.codec],
  ['baseOutput', u64.codec],
  ['finalOutput', u64.codec],
  ['gemsEarned', u64.codec],
  ['fragmentsEarned', u64.codec],
  ['xpGained', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('UnitsHired', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['unitType', u8.codec],
  ['baseQuantity', u64.codec],
  ['finalQuantity', u64.codec],
  ['noviBurned', u64.codec],
  ['timeBonusBps', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CashTransferred', getStructCodec([
  ['from', pubkey.codec],
  ['fromName', fixedString(48).codec],
  ['to', pubkey.codec],
  ['toName', fixedString(48).codec],
  ['amount', u64.codec],
  ['fee', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('NoviLocked', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['amount', u64.codec],
  ['totalLocked', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('EquipmentPurchased', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['slot', u8.codec],
  ['tier', u8.codec],
  ['noviBurned', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('StaminaPurchased', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['stamina', u64.codec],
  ['gemsSpent', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('VaultTransfer', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['amount', u64.codec],
  ['toVault', bool.codec],
  ['vaultBalance', u64.codec],
  ['timestamp', i64.codec],
]));

// ── Team ──

EVENT_CODECS.set('TeamCreated', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['founder', pubkey.codec],
  ['noviBurned', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TeamJoined', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['memberCount', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TeamLeft', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['memberCount', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('MemberKicked', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['kicked', pubkey.codec],
  ['kickedBy', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('LeadershipTransferred', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['oldLeader', pubkey.codec],
  ['newLeader', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TeamDisbanded', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['leader', pubkey.codec],
  ['treasuryDistributed', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TreasuryDeposit', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['depositor', pubkey.codec],
  ['amount', u64.codec],
  ['newBalance', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TreasuryWithdraw', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['withdrawer', pubkey.codec],
  ['amount', u64.codec],
  ['newBalance', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('MemberRankChanged', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['member', pubkey.codec],
  ['oldRank', u8.codec],
  ['newRank', u8.codec],
  ['changedBy', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('InviteSent', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['invitee', pubkey.codec],
  ['inviter', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('InviteAccepted', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['memberCount', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('InviteDeclined', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('InviteCancelled', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['invitee', pubkey.codec],
  ['cancelledBy', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('MotdUpdated', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['updatedBy', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TeamSettingsUpdated', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['updatedBy', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TreasurySettingsUpdated', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['updatedBy', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TreasuryWithdrawRequested', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['requester', pubkey.codec],
  ['amount', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TreasuryRequestApproved', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['approver', pubkey.codec],
  ['requester', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TreasuryRequestRejected', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['rejector', pubkey.codec],
  ['requester', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TreasuryRequestExecuted', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['executor', pubkey.codec],
  ['requester', pubkey.codec],
  ['amount', u64.codec],
  ['newBalance', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TreasuryRequestCancelled', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['requester', pubkey.codec],
  ['timestamp', i64.codec],
]));

// ── Travel ──

EVENT_CODECS.set('IntercityTravelStarted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['fromCity', pubkey.codec],
  ['toCity', pubkey.codec],
  ['arrivalAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('IntercityTravelCompleted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['city', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('PlayerTeleported', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['fromCity', pubkey.codec],
  ['toCity', pubkey.codec],
  ['gemsSpent', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('IntracityTravelStarted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['city', pubkey.codec],
  ['destX', i32.codec],
  ['destY', i32.codec],
  ['arrivalAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('IntracityTravelCompleted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['x', i32.codec],
  ['y', i32.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TravelCancelled', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['isIntercity', bool.codec],
  ['wasBumped', bool.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TravelSpeedup', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['isIntercity', bool.codec],
  ['speedupTier', u8.codec],
  ['gemsSpent', u64.codec],
  ['newEta', i64.codec],
  ['timestamp', i64.codec],
]));

// ── Rally ──

EVENT_CODECS.set('RallyCreated', getStructCodec([
  ['rally', pubkey.codec],
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['leader', pubkey.codec],
  ['target', pubkey.codec],
  ['gatherAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('RallyJoined', getStructCodec([
  ['rally', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['units', array(u64, 3).codec],
  ['participantCount', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('RallyExecuted', getStructCodec([
  ['rally', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['target', pubkey.codec],
  ['damageDealt', u64.codec],
  ['damageReceived', u64.codec],
  ['lootCaptured', u64.codec],
  ['participantCount', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('RallyCancelled', getStructCodec([
  ['rally', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['cancelledBy', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('RallyLeft', getStructCodec([
  ['rally', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['units', array(u64, 3).codec],
  ['participantCount', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('RallyClosed', getStructCodec([
  ['rally', pubkey.codec],
  ['rallyId', u64.codec],
  ['teamName', fixedString(32).codec],
  ['leader', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('RallySpeedup', getStructCodec([
  ['rally', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['payer', pubkey.codec],
  ['speedupType', u8.codec],
  ['gemsSpent', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('RallyParticipantReturned', getStructCodec([
  ['rally', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['participatedInCombat', bool.codec],
  ['unitsReturned', array(u64, 3).codec],
  ['lootReceived', u64.codec],
  ['timestamp', i64.codec],
]));

// ── Reinforcement ──

EVENT_CODECS.set('ReinforcementSent', getStructCodec([
  ['sender', pubkey.codec],
  ['senderName', fixedString(48).codec],
  ['receiver', pubkey.codec],
  ['receiverName', fixedString(48).codec],
  ['units', array(u64, 3).codec],
  ['arrivesAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ReinforcementArrived', getStructCodec([
  ['reinforcement', pubkey.codec],
  ['sender', pubkey.codec],
  ['senderName', fixedString(48).codec],
  ['receiver', pubkey.codec],
  ['receiverName', fixedString(48).codec],
  ['units', array(u64, 3).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ReinforcementRecalled', getStructCodec([
  ['reinforcement', pubkey.codec],
  ['sender', pubkey.codec],
  ['senderName', fixedString(48).codec],
  ['receiver', pubkey.codec],
  ['receiverName', fixedString(48).codec],
  ['units', array(u64, 3).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ReinforcementRelieved', getStructCodec([
  ['reinforcement', pubkey.codec],
  ['sender', pubkey.codec],
  ['senderName', fixedString(48).codec],
  ['receiver', pubkey.codec],
  ['receiverName', fixedString(48).codec],
  ['units', array(u64, 3).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ReinforcementReturned', getStructCodec([
  ['sender', pubkey.codec],
  ['senderName', fixedString(48).codec],
  ['units', array(u64, 3).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ReinforcementSpeedup', getStructCodec([
  ['reinforcement', pubkey.codec],
  ['sender', pubkey.codec],
  ['senderName', fixedString(48).codec],
  ['receiver', pubkey.codec],
  ['speedupType', u8.codec],
  ['gemsSpent', u64.codec],
  ['newEta', i64.codec],
  ['timestamp', i64.codec],
]));

// ── Expedition ──

EVENT_CODECS.set('ExpeditionStarted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['expeditionType', u8.codec],
  ['nodeId', u8.codec],
  ['duration', u32.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ExpeditionStrike', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['strikeNum', u8.codec],
  ['yieldAmount', u64.codec],
  ['quality', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ExpeditionClaimed', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['expeditionType', u8.codec],
  ['totalYield', u64.codec],
  ['bonusYield', u64.codec],
  ['xpEarned', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ExpeditionAborted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['expeditionType', u8.codec],
  ['partialYield', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ExpeditionSpeedup', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['speedupSeconds', u64.codec],
  ['gemsSpent', u64.codec],
  ['newEta', i64.codec],
  ['timestamp', i64.codec],
]));

// ── Loot ──

EVENT_CODECS.set('LootClaimed', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['cash', u64.codec],
  ['items', array(u16, 4).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('EncounterSpawned', getStructCodec([
  ['encounter', pubkey.codec],
  ['city', pubkey.codec],
  ['encounterType', u8.codec],
  ['level', u8.codec],
  ['x', i32.codec],
  ['y', i32.codec],
  ['timestamp', i64.codec],
]));

// ── Progression ──

EVENT_CODECS.set('DailyRewardClaimed', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['cash', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('SubscriptionPurchased', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['tier', u8.codec],
  ['durationDays', u16.codec],
  ['noviPaid', u64.codec],
  ['expiresAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('XpGained', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['amount', u64.codec],
  ['source', u8.codec],
  ['totalXp', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('PlayerLeveledUp', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['oldLevel', u16.codec],
  ['newLevel', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('EventPrizeClaimed', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['event', pubkey.codec],
  ['rank', u16.codec],
  ['prizeAmount', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('SubscriptionTierUpdated', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['oldTier', u8.codec],
  ['newTier', u8.codec],
  ['expiresAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('SubscriptionExpired', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['oldTier', u8.codec],
  ['timestamp', i64.codec],
]));

// ── Estate ──

EVENT_CODECS.set('EstateCreated', getStructCodec([
  ['estate', pubkey.codec],
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('BuildingStarted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['buildingType', u8.codec],
  ['plot', u8.codec],
  ['completesAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('BuildingCompleted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['buildingType', u8.codec],
  ['level', u8.codec],
  ['plot', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('BuildingUpgradeStarted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['buildingType', u8.codec],
  ['fromLevel', u8.codec],
  ['toLevel', u8.codec],
  ['completesAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('PlotPurchased', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['plot', u8.codec],
  ['cost', u64.codec],
  ['totalPlots', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('EstateDailyClaimed', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['materials', u64.codec],
  ['streak', u16.codec],
  ['timestamp', i64.codec],
]));

// ── Forge ──

EVENT_CODECS.set('CraftStarted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['itemType', u8.codec],
  ['qualityTier', u8.codec],
  ['materialsUsed', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CraftStrike', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['stage', u8.codec],
  ['quality', u8.codec],
  ['score', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CraftCompleted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['itemType', u8.codec],
  ['quality', u8.codec],
  ['score', u16.codec],
  ['inventorySlot', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CraftAbandoned', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['itemType', u8.codec],
  ['stageReached', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ItemEquipped', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['heroMint', pubkey.codec],
  ['heroName', fixedString(32).codec],
  ['slot', u8.codec],
  ['quality', u8.codec],
  ['fromInventory', u8.codec],
  ['timestamp', i64.codec],
]));

// ── Research ──

EVENT_CODECS.set('ResearchStarted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['researchId', u16.codec],
  ['level', u8.codec],
  ['completesAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ResearchCompleted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['researchId', u16.codec],
  ['level', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ResearchCancelled', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['researchId', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ResearchSpeedup', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['researchId', u16.codec],
  ['speedupSeconds', i64.codec],
  ['gemsSpent', u64.codec],
  ['newEta', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('ResearchAscended', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['researchTree', u16.codec],
  ['newAscensionLevel', u8.codec],
  ['masteryCost', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('PlayerAscended', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['ascensionLevel', u8.codec],
  ['masteryGained', u16.codec],
  ['timestamp', i64.codec],
]));

// ── Sanctuary ──

EVENT_CODECS.set('MeditationStarted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['heroMint', pubkey.codec],
  ['heroName', fixedString(32).codec],
  ['durationHours', u8.codec],
  ['completesAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('MeditationClaimed', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['heroMint', pubkey.codec],
  ['heroName', fixedString(32).codec],
  ['xpEarned', u32.codec],
  ['levelsGained', u8.codec],
  ['timestamp', i64.codec],
]));

// ── Hero ──

EVENT_CODECS.set('HeroMinted', getStructCodec([
  ['heroMint', pubkey.codec],
  ['heroName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['templateId', u16.codec],
  ['rarity', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('HeroLocked', getStructCodec([
  ['heroMint', pubkey.codec],
  ['heroName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['slot', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('HeroUnlocked', getStructCodec([
  ['heroMint', pubkey.codec],
  ['heroName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('HeroLeveledUp', getStructCodec([
  ['heroMint', pubkey.codec],
  ['heroName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['oldLevel', u32.codec],
  ['newLevel', u32.codec],
  ['xpSpent', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('HeroAssignedDefensive', getStructCodec([
  ['heroMint', pubkey.codec],
  ['heroName', fixedString(32).codec],
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['assigned', bool.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('HeroBurned', getStructCodec([
  ['heroMint', pubkey.codec],
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['templateId', u16.codec],
  ['heroLevel', u32.codec],
  ['tier', u8.codec],
  ['noviReward', u64.codec],
  ['newMintedCount', u32.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('SupplyCapUpdated', getStructCodec([
  ['templateId', u16.codec],
  ['oldSupplyCap', u32.codec],
  ['newSupplyCap', u32.codec],
  ['timestamp', i64.codec],
]));

// ── Shop ──

EVENT_CODECS.set('ItemPurchased', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['itemId', u32.codec],
  ['quantity', u16.codec],
  ['price', u64.codec],
  ['currency', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('BundlePurchased', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['bundleId', u32.codec],
  ['price', u64.codec],
  ['currency', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('FlashSalePurchased', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['saleId', u64.codec],
  ['originalPrice', u64.codec],
  ['pricePaid', u64.codec],
  ['currency', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('NoviPurchased', getStructCodec([
  ['buyer', pubkey.codec],
  ['user', pubkey.codec],
  ['packageIndex', u8.codec],
  ['baseAmount', u64.codec],
  ['bonusAmount', u64.codec],
  ['totalReceived', u64.codec],
  ['costLamports', u64.codec],
  ['streakDay', u16.codec],
  ['subscriptionTier', u8.codec],
  ['timestamp', i64.codec],
]));

// ── Initialization ──

EVENT_CODECS.set('PlayerCreated', getStructCodec([
  ['player', pubkey.codec],
  ['user', pubkey.codec],
  ['city', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('UserCreated', getStructCodec([
  ['user', pubkey.codec],
  ['wallet', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CityInitialized', getStructCodec([
  ['city', pubkey.codec],
  ['cityIndex', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('GameEngineInitialized', getStructCodec([
  ['gameEngine', pubkey.codec],
  ['authority', pubkey.codec],
  ['timestamp', i64.codec],
]));

// ── Name ──

EVENT_CODECS.set('PlayerNameSet', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['domainHash', bytes(32).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('PlayerNameRemoved', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('PlayerNameUpdated', getStructCodec([
  ['player', pubkey.codec],
  ['oldName', fixedString(48).codec],
  ['newName', fixedString(48).codec],
  ['newDomainHash', bytes(32).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TeamNameSet', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['domainHash', bytes(32).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TeamNameRemoved', getStructCodec([
  ['team', pubkey.codec],
  ['teamName', fixedString(32).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('TeamNameUpdated', getStructCodec([
  ['team', pubkey.codec],
  ['oldName', fixedString(32).codec],
  ['newName', fixedString(32).codec],
  ['newDomainHash', bytes(32).codec],
  ['timestamp', i64.codec],
]));

// ── Token ──

EVENT_CODECS.set('NoviReservedToLocked', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['amount', u64.codec],
  ['newLocked', u64.codec],
  ['remainingReserved', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('NoviWithdrawn', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['amount', u64.codec],
  ['remainingReserved', u64.codec],
  ['timestamp', i64.codec],
]));

// ── Dungeon ──

EVENT_CODECS.set('DungeonEntered', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['heroMint', pubkey.codec],
  ['heroName', fixedString(32).codec],
  ['staminaSpent', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('DungeonRoomCleared', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['floor', u8.codec],
  ['room', u8.codec],
  ['xpGained', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('DungeonFloorCompleted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['floor', u8.codec],
  ['noviGained', u64.codec],
  ['isCheckpoint', bool.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('DungeonRelicChosen', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['floor', u8.codec],
  ['relicId', u8.codec],
  ['totalRelics', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('DungeonBossFight', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['floor', u8.codec],
  ['bossPower', u32.codec],
  ['bossHealth', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('DungeonFailed', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['floor', u8.codec],
  ['room', u8.codec],
  ['enemiesKilled', u16.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('DungeonFled', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['floor', u8.codec],
  ['enemiesKilled', u16.codec],
  ['xpGained', u64.codec],
  ['noviGained', u64.codec],
  ['gemsGained', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('DungeonCompleted', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['victory', bool.codec],
  ['finalFloor', u8.codec],
  ['enemiesKilled', u16.codec],
  ['roomsCleared', u8.codec],
  ['relicsCollected', u8.codec],
  ['xpGained', u64.codec],
  ['noviGained', u64.codec],
  ['gemsGained', u64.codec],
  ['materialsGained', u32.codec],
  ['totalDamageDealt', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('DungeonResumed', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['checkpointFloor', u8.codec],
  ['resumeFloor', u8.codec],
  ['gemCost', u64.codec],
  ['resumeCount', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('DungeonLeaderboardPrizeClaimed', getStructCodec([
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['dungeonId', u16.codec],
  ['weekNumber', u16.codec],
  ['rank', u8.codec],
  ['score', u64.codec],
  ['prizeAmount', u64.codec],
  ['timestamp', i64.codec],
]));

// ── Castle ──

EVENT_CODECS.set('CastleCreated', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['cityId', u16.codec],
  ['castleId', u16.codec],
  ['tier', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleClaimed', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['king', pubkey.codec],
  ['kingName', fixedString(48).codec],
  ['team', pubkey.codec],
  ['tier', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleConquered', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['previousKing', pubkey.codec],
  ['newKing', pubkey.codec],
  ['newKingName', fixedString(48).codec],
  ['newTeam', pubkey.codec],
  ['rallyId', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleDefended', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['king', pubkey.codec],
  ['rallyId', u64.codec],
  ['damageDealt', u64.codec],
  ['weaponsCaptured', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CourtAppointed', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['appointee', pubkey.codec],
  ['appointeeName', fixedString(48).codec],
  ['positionType', u8.codec],
  ['appointedBy', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CourtDismissed', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['dismissed', pubkey.codec],
  ['dismissedName', fixedString(48).codec],
  ['positionType', u8.codec],
  ['dismissedBy', pubkey.codec],
  ['resigned', bool.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('GarrisonJoined', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['contributor', pubkey.codec],
  ['contributorName', fixedString(48).codec],
  ['units1', u64.codec],
  ['units2', u64.codec],
  ['units3', u64.codec],
  ['weapons', u64.codec],
  ['heroMint', pubkey.codec],
  ['garrisonCount', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('GarrisonLeft', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['contributor', pubkey.codec],
  ['contributorName', fixedString(48).codec],
  ['units1', u64.codec],
  ['units2', u64.codec],
  ['units3', u64.codec],
  ['weapons', u64.codec],
  ['heroMint', pubkey.codec],
  ['relieved', bool.codec],
  ['garrisonCount', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('GarrisonLootClaimed', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['claimer', pubkey.codec],
  ['claimerName', fixedString(48).codec],
  ['melee', u64.codec],
  ['ranged', u64.codec],
  ['siege', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleUpgradeStarted', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['king', pubkey.codec],
  ['upgradeType', u8.codec],
  ['currentLevel', u8.codec],
  ['targetLevel', u8.codec],
  ['noviCost', u64.codec],
  ['completesAt', i64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleUpgradeCompleted', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['upgradeType', u8.codec],
  ['newLevel', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleUpgradeCancelled', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['upgradeType', u8.codec],
  ['noviRefunded', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleRewardsClaimed', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['claimer', pubkey.codec],
  ['claimerName', fixedString(48).codec],
  ['role', u8.codec],
  ['days', u8.codec],
  ['novi', u64.codec],
  ['cash', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleProtectionExpired', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['king', pubkey.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('KingForceRemoved', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['removedKing', pubkey.codec],
  ['removedKingName', fixedString(48).codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleTransitionProgress', getStructCodec([
  ['castle', pubkey.codec],
  ['phase', u8.codec],
  ['cleanedCount', u8.codec],
  ['totalCount', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleStatusChanged', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['oldStatus', u8.codec],
  ['newStatus', u8.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('CastleAttacked', getStructCodec([
  ['castle', pubkey.codec],
  ['castleName', fixedString(32).codec],
  ['attacker', pubkey.codec],
  ['attackerName', fixedString(48).codec],
  ['king', pubkey.codec],
  ['damageDealt', u64.codec],
  ['damageReceived', u64.codec],
  ['attackerCasualties', u64.codec],
  ['garrisonCasualties', u64.codec],
  ['attackerWon', bool.codec],
  ['timestamp', i64.codec],
]));

// ── Game Event ──

EVENT_CODECS.set('GameEventCreated', getStructCodec([
  ['event', pubkey.codec],
  ['eventType', u8.codec],
  ['startTime', i64.codec],
  ['endTime', i64.codec],
  ['prizePool', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('GameEventJoined', getStructCodec([
  ['event', pubkey.codec],
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['entryFee', u64.codec],
  ['participantCount', u32.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('GameEventFinalized', getStructCodec([
  ['event', pubkey.codec],
  ['totalParticipants', u32.codec],
  ['totalPrizes', u64.codec],
  ['timestamp', i64.codec],
]));

EVENT_CODECS.set('EventScoreUpdated', getStructCodec([
  ['event', pubkey.codec],
  ['player', pubkey.codec],
  ['playerName', fixedString(48).codec],
  ['scoreDelta', i64.codec],
  ['newScore', u64.codec],
  ['timestamp', i64.codec],
]));

// ── Kingdom ──

EVENT_CODECS.set('KingdomCreated', getStructCodec([
  ['kingdomId', u16.codec],
  ['kingdomName', fixedString(32).codec],
  ['theme', u8.codec],
  ['startTime', i64.codec],
  ['registrationClosesAt', i64.codec],
  ['createdBy', pubkey.codec],
  ['createdAt', i64.codec],
]));

EVENT_CODECS.set('KingdomRegistrationClosed', getStructCodec([
  ['kingdomId', u16.codec],
  ['gameEngine', pubkey.codec],
  ['totalPlayers', u64.codec],
  ['closedAt', i64.codec],
]));

EVENT_CODECS.set('PlayerJoinedKingdom', getStructCodec([
  ['kingdomId', u16.codec],
  ['gameEngine', pubkey.codec],
  ['player', pubkey.codec],
  ['owner', pubkey.codec],
  ['joinedAt', i64.codec],
]));

EVENT_CODECS.set('KingdomEventCreated', getStructCodec([
  ['kingdomId', u16.codec],
  ['gameEngine', pubkey.codec],
  ['eventId', u64.codec],
  ['eventType', u8.codec],
  ['startTime', i64.codec],
  ['endTime', i64.codec],
  ['prizePool', u64.codec],
]));

EVENT_CODECS.set('KingdomArenaSeasonStarted', getStructCodec([
  ['kingdomId', u16.codec],
  ['gameEngine', pubkey.codec],
  ['seasonId', u32.codec],
  ['startTime', i64.codec],
  ['endTime', i64.codec],
  ['prizePool', u64.codec],
]));

EVENT_CODECS.set('KingdomDungeonLeaderboardCreated', getStructCodec([
  ['kingdomId', u16.codec],
  ['gameEngine', pubkey.codec],
  ['dungeonId', u16.codec],
  ['weekNumber', u16.codec],
  ['prizePool', u64.codec],
]));

EVENT_CODECS.set('KingdomCitiesInitialized', getStructCodec([
  ['kingdomId', u16.codec],
  ['gameEngine', pubkey.codec],
  ['startCityId', u16.codec],
  ['citiesCount', u8.codec],
  ['initializedAt', i64.codec],
]));

// Main Parser Functions

/**
 * Parse a single event from raw bytes.
 *
 * @param data - Raw event data (8-byte discriminator + payload)
 * @returns Parsed event or null if unknown discriminator
 */
export function parseNovusMundusEvent(data: Uint8Array): NovusMundusEvent | null {
  if (data.length < 8) {
    return null;
  }

  const discHex = discriminatorToHex(data.subarray(0, 8));

  const eventName = EVENT_DISCRIMINATORS.get(discHex);
  if (!eventName) {
    return null;
  }

  const codec = EVENT_CODECS.get(eventName);
  if (!codec) {
    return null;
  }

  const parsedData = codec.decode(data.subarray(8));

  return {
    name: eventName,
    data: parsedData,
  } as unknown as NovusMundusEvent;
}

/**
 * Parse events from base64-encoded log data.
 *
 * @param base64Data - Base64-encoded event data from transaction logs
 * @returns Parsed event or null
 */
export function parseEventFromBase64(base64Data: string): NovusMundusEvent | null {
  let buffer: Uint8Array;
  try {
    buffer = new Uint8Array(getBase64Encoder().encode(base64Data));
  } catch {
    return null;
  }
  return parseNovusMundusEvent(buffer);
}

/**
 * Parse all events from transaction logs.
 *
 * Looks for program log entries that contain base64 event data.
 *
 * @param logs - Array of log strings from transaction
 * @returns Array of parsed events
 */
export function parseEventsFromLogs(logs: string[]): NovusMundusEvent[] {
  const events: NovusMundusEvent[] = [];

  // Look for "Program data:" log entries which contain base64 event data
  for (const log of logs) {
    if (log.startsWith('Program data: ')) {
      const base64 = log.substring(14).trim();
      const event = parseEventFromBase64(base64);
      if (event) {
        events.push(event);
      }
    }
  }

  return events;
}

/**
 * Get the event name for a discriminator.
 *
 * @param discriminator - 8-byte discriminator
 * @returns Event name or undefined
 */
export function getEventName(discriminator: Uint8Array): string | undefined {
  const hex = discriminatorToHex(discriminator);
  return EVENT_DISCRIMINATORS.get(hex);
}

/**
 * Check if a discriminator matches a known event.
 *
 * @param discriminator - 8-byte discriminator
 * @param eventName - Expected event name
 * @returns true if discriminator matches event
 */
export function isEventType(discriminator: Uint8Array, eventName: string): boolean {
  return discriminatorToHex(discriminator) === discriminatorToHex(computeEventDiscriminator(eventName));
}

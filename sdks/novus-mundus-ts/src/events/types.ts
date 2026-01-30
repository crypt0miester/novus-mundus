/**
 * Event Types and Common Interfaces
 *
 * Type definitions shared across all event modules.
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// ============================================================
// Base Event Interface
// ============================================================

/** Base interface for all parsed events */
export interface ParsedEvent {
  /** Event name (e.g., "PlayerAttacked") */
  name: string;
  /** Raw discriminator bytes */
  discriminator: Uint8Array;
  /** Parsed event data */
  data: unknown;
}

// ============================================================
// Combat Events
// ============================================================

export interface PlayerAttackedEvent {
  name: 'PlayerAttacked';
  data: {
    attacker: PublicKey;
    attackerName: string;
    defender: PublicKey;
    defenderName: string;
    damageDealt: BN;
    damageReceived: BN;
    cashStolen: BN;
    armorStolen: BN;
    produceStolen: BN;
    vehiclesStolen: BN;
    attackerUnitsLost: [BN, BN, BN];
    defenderUnitsLost: [BN, BN, BN];
    attackerWon: boolean;
    driveBy: boolean;
    timestamp: BN;
  };
}

export interface EncounterAttackedEvent {
  name: 'EncounterAttacked';
  data: {
    player: PublicKey;
    playerName: string;
    encounter: PublicKey;
    damageDealt: BN;
    healthRemaining: BN;
    staminaConsumed: number;
    noviConsumed: BN;
    attackerCount: number;
    timestamp: BN;
  };
}

export interface EncounterDefeatedEvent {
  name: 'EncounterDefeated';
  data: {
    encounter: PublicKey;
    encounterType: number;
    level: number;
    totalAttackers: number;
    killingBlowBy: PublicKey;
    killingBlowName: string;
    lootCash: BN;
    lootNovi: BN;
    timestamp: BN;
  };
}

// ============================================================
// Economy Events
// ============================================================

export interface ResourcesCollectedEvent {
  name: 'ResourcesCollected';
  data: {
    player: PublicKey;
    playerName: string;
    cashCollected: BN;
    gemsCollected: BN;
    produceCollected: BN;
    timestamp: BN;
  };
}

export interface UnitsHiredEvent {
  name: 'UnitsHired';
  data: {
    player: PublicKey;
    playerName: string;
    unitType: number;
    quantity: BN;
    totalCost: BN;
    timestamp: BN;
  };
}

export interface CashTransferredEvent {
  name: 'CashTransferred';
  data: {
    sender: PublicKey;
    senderName: string;
    recipient: PublicKey;
    recipientName: string;
    amount: BN;
    timestamp: BN;
  };
}

export interface NoviMintedEvent {
  name: 'NoviMinted';
  data: {
    recipient: PublicKey;
    amount: BN;
    reason: number;
    timestamp: BN;
  };
}

export interface NoviBurnedEvent {
  name: 'NoviBurned';
  data: {
    from: PublicKey;
    amount: BN;
    reason: number;
    timestamp: BN;
  };
}

// ============================================================
// Team Events
// ============================================================

export interface TeamCreatedEvent {
  name: 'TeamCreated';
  data: {
    team: PublicKey;
    teamName: string;
    leader: PublicKey;
    leaderName: string;
    timestamp: BN;
  };
}

export interface TeamJoinedEvent {
  name: 'TeamJoined';
  data: {
    team: PublicKey;
    teamName: string;
    player: PublicKey;
    playerName: string;
    timestamp: BN;
  };
}

export interface TeamLeftEvent {
  name: 'TeamLeft';
  data: {
    team: PublicKey;
    teamName: string;
    player: PublicKey;
    playerName: string;
    timestamp: BN;
  };
}

export interface TeamDisbandedEvent {
  name: 'TeamDisbanded';
  data: {
    team: PublicKey;
    teamName: string;
    leader: PublicKey;
    timestamp: BN;
  };
}

export interface TeamMemberPromotedEvent {
  name: 'TeamMemberPromoted';
  data: {
    team: PublicKey;
    member: PublicKey;
    memberName: string;
    newRank: number;
    promotedBy: PublicKey;
    timestamp: BN;
  };
}

export interface TeamMemberDemotedEvent {
  name: 'TeamMemberDemoted';
  data: {
    team: PublicKey;
    member: PublicKey;
    memberName: string;
    newRank: number;
    demotedBy: PublicKey;
    timestamp: BN;
  };
}

export interface TeamMemberKickedEvent {
  name: 'TeamMemberKicked';
  data: {
    team: PublicKey;
    member: PublicKey;
    memberName: string;
    kickedBy: PublicKey;
    timestamp: BN;
  };
}

export interface TeamLeadershipTransferredEvent {
  name: 'TeamLeadershipTransferred';
  data: {
    team: PublicKey;
    oldLeader: PublicKey;
    newLeader: PublicKey;
    newLeaderName: string;
    timestamp: BN;
  };
}

export interface TeamInviteSentEvent {
  name: 'TeamInviteSent';
  data: {
    team: PublicKey;
    invitedPlayer: PublicKey;
    invitedBy: PublicKey;
    timestamp: BN;
  };
}

export interface TeamInviteAcceptedEvent {
  name: 'TeamInviteAccepted';
  data: {
    team: PublicKey;
    teamName: string;
    player: PublicKey;
    playerName: string;
    timestamp: BN;
  };
}

export interface TeamInviteDeclinedEvent {
  name: 'TeamInviteDeclined';
  data: {
    team: PublicKey;
    player: PublicKey;
    timestamp: BN;
  };
}

export interface TeamInviteCancelledEvent {
  name: 'TeamInviteCancelled';
  data: {
    team: PublicKey;
    invitedPlayer: PublicKey;
    timestamp: BN;
  };
}

export interface TeamTreasuryDepositedEvent {
  name: 'TeamTreasuryDeposited';
  data: {
    team: PublicKey;
    depositor: PublicKey;
    amount: BN;
    timestamp: BN;
  };
}

export interface TeamTreasuryWithdrawnEvent {
  name: 'TeamTreasuryWithdrawn';
  data: {
    team: PublicKey;
    recipient: PublicKey;
    amount: BN;
    timestamp: BN;
  };
}

// ============================================================
// Travel Events
// ============================================================

export interface TravelStartedEvent {
  name: 'TravelStarted';
  data: {
    player: PublicKey;
    playerName: string;
    fromCity: PublicKey;
    toCity: PublicKey;
    arrivalTime: BN;
    travelType: number;
    timestamp: BN;
  };
}

export interface TravelCompletedEvent {
  name: 'TravelCompleted';
  data: {
    player: PublicKey;
    playerName: string;
    city: PublicKey;
    travelType: number;
    timestamp: BN;
  };
}

export interface TravelCancelledEvent {
  name: 'TravelCancelled';
  data: {
    player: PublicKey;
    travelType: number;
    timestamp: BN;
  };
}

// ============================================================
// Rally Events
// ============================================================

export interface RallyCreatedEvent {
  name: 'RallyCreated';
  data: {
    rally: PublicKey;
    creator: PublicKey;
    creatorName: string;
    targetType: number;
    target: PublicKey;
    operatives: BN;
    maxParticipants: number;
    executeTime: BN;
    timestamp: BN;
  };
}

export interface RallyJoinedEvent {
  name: 'RallyJoined';
  data: {
    rally: PublicKey;
    player: PublicKey;
    playerName: string;
    operatives: BN;
    timestamp: BN;
  };
}

export interface RallyLeftEvent {
  name: 'RallyLeft';
  data: {
    rally: PublicKey;
    player: PublicKey;
    timestamp: BN;
  };
}

export interface RallyCancelledEvent {
  name: 'RallyCancelled';
  data: {
    rally: PublicKey;
    cancelledBy: PublicKey;
    timestamp: BN;
  };
}

export interface RallyExecutedEvent {
  name: 'RallyExecuted';
  data: {
    rally: PublicKey;
    targetType: number;
    target: PublicKey;
    success: boolean;
    totalDamage: BN;
    lootCash: BN;
    lootNovi: BN;
    timestamp: BN;
  };
}

export interface RallyReturnProcessedEvent {
  name: 'RallyReturnProcessed';
  data: {
    rally: PublicKey;
    player: PublicKey;
    cashReceived: BN;
    noviReceived: BN;
    timestamp: BN;
  };
}

// ============================================================
// Reinforcement Events
// ============================================================

export interface ReinforcementSentEvent {
  name: 'ReinforcementSent';
  data: {
    reinforcement: PublicKey;
    sender: PublicKey;
    senderName: string;
    recipient: PublicKey;
    recipientName: string;
    defensive1: BN;
    defensive2: BN;
    defensive3: BN;
    arrivalTime: BN;
    timestamp: BN;
  };
}

export interface ReinforcementArrivedEvent {
  name: 'ReinforcementArrived';
  data: {
    reinforcement: PublicKey;
    sender: PublicKey;
    recipient: PublicKey;
    timestamp: BN;
  };
}

export interface ReinforcementRecalledEvent {
  name: 'ReinforcementRecalled';
  data: {
    reinforcement: PublicKey;
    recalledBy: PublicKey;
    returnTime: BN;
    timestamp: BN;
  };
}

export interface ReinforcementRelievedEvent {
  name: 'ReinforcementRelieved';
  data: {
    reinforcement: PublicKey;
    relievedBy: PublicKey;
    timestamp: BN;
  };
}

export interface ReinforcementReturnedEvent {
  name: 'ReinforcementReturned';
  data: {
    reinforcement: PublicKey;
    sender: PublicKey;
    timestamp: BN;
  };
}

// ============================================================
// Expedition Events
// ============================================================

export interface ExpeditionStartedEvent {
  name: 'ExpeditionStarted';
  data: {
    expedition: PublicKey;
    player: PublicKey;
    playerName: string;
    expeditionType: number;
    tier: number;
    operatives: BN;
    endTime: BN;
    timestamp: BN;
  };
}

export interface ExpeditionStrikeEvent {
  name: 'ExpeditionStrike';
  data: {
    expedition: PublicKey;
    player: PublicKey;
    gemsCollected: BN;
    produceCollected: BN;
    fragmentsCollected: BN;
    timestamp: BN;
  };
}

export interface ExpeditionClaimedEvent {
  name: 'ExpeditionClaimed';
  data: {
    expedition: PublicKey;
    player: PublicKey;
    totalGems: BN;
    totalProduce: BN;
    totalFragments: BN;
    timestamp: BN;
  };
}

export interface ExpeditionAbortedEvent {
  name: 'ExpeditionAborted';
  data: {
    expedition: PublicKey;
    player: PublicKey;
    timestamp: BN;
  };
}

// ============================================================
// Loot Events
// ============================================================

export interface LootClaimedEvent {
  name: 'LootClaimed';
  data: {
    loot: PublicKey;
    player: PublicKey;
    playerName: string;
    cashClaimed: BN;
    noviClaimed: BN;
    gemsClaimed: BN;
    produceClaimed: BN;
    fragmentsClaimed: BN;
    timestamp: BN;
  };
}

// ============================================================
// Progression Events
// ============================================================

export interface DailyRewardClaimedEvent {
  name: 'DailyRewardClaimed';
  data: {
    player: PublicKey;
    playerName: string;
    day: number;
    cashReward: BN;
    noviReward: BN;
    gemsReward: BN;
    timestamp: BN;
  };
}

export interface PlayerLeveledUpEvent {
  name: 'PlayerLeveledUp';
  data: {
    player: PublicKey;
    playerName: string;
    newLevel: number;
    timestamp: BN;
  };
}

// ============================================================
// Estate Events
// ============================================================

export interface EstateCreatedEvent {
  name: 'EstateCreated';
  data: {
    player: PublicKey;
    estate: PublicKey;
    timestamp: BN;
  };
}

export interface BuildingConstructedEvent {
  name: 'BuildingConstructed';
  data: {
    player: PublicKey;
    estate: PublicKey;
    buildingType: number;
    level: number;
    timestamp: BN;
  };
}

export interface BuildingUpgradedEvent {
  name: 'BuildingUpgraded';
  data: {
    player: PublicKey;
    estate: PublicKey;
    buildingType: number;
    newLevel: number;
    timestamp: BN;
  };
}

export interface PlotPurchasedEvent {
  name: 'PlotPurchased';
  data: {
    player: PublicKey;
    estate: PublicKey;
    plotCount: number;
    cost: BN;
    timestamp: BN;
  };
}

// ============================================================
// Forge Events
// ============================================================

export interface CraftStartedEvent {
  name: 'CraftStarted';
  data: {
    player: PublicKey;
    equipmentType: number;
    qualityTier: number;
    totalStages: number;
    timestamp: BN;
  };
}

export interface CraftStrikeEvent {
  name: 'CraftStrike';
  data: {
    player: PublicKey;
    currentStage: number;
    totalStages: number;
    success: boolean;
    timestamp: BN;
  };
}

export interface CraftCompletedEvent {
  name: 'CraftCompleted';
  data: {
    player: PublicKey;
    equipmentType: number;
    qualityTier: number;
    timestamp: BN;
  };
}

export interface CraftAbandonedEvent {
  name: 'CraftAbandoned';
  data: {
    player: PublicKey;
    equipmentType: number;
    materialsRefunded: BN;
    timestamp: BN;
  };
}

export interface EquipmentEquippedEvent {
  name: 'EquipmentEquipped';
  data: {
    player: PublicKey;
    equipmentType: number;
    qualityTier: number;
    timestamp: BN;
  };
}

// ============================================================
// Research Events
// ============================================================

export interface ResearchStartedEvent {
  name: 'ResearchStarted';
  data: {
    player: PublicKey;
    researchId: number;
    level: number;
    completionTime: BN;
    timestamp: BN;
  };
}

export interface ResearchCompletedEvent {
  name: 'ResearchCompleted';
  data: {
    player: PublicKey;
    researchId: number;
    level: number;
    timestamp: BN;
  };
}

export interface ResearchCancelledEvent {
  name: 'ResearchCancelled';
  data: {
    player: PublicKey;
    researchId: number;
    timestamp: BN;
  };
}

export interface AscensionCompletedEvent {
  name: 'AscensionCompleted';
  data: {
    player: PublicKey;
    newTier: number;
    timestamp: BN;
  };
}

// ============================================================
// Sanctuary Events
// ============================================================

export interface MeditationStartedEvent {
  name: 'MeditationStarted';
  data: {
    player: PublicKey;
    heroMint: PublicKey;
    heroSlot: number;
    timestamp: BN;
  };
}

export interface MeditationClaimedEvent {
  name: 'MeditationClaimed';
  data: {
    player: PublicKey;
    heroMint: PublicKey;
    xpGained: BN;
    timestamp: BN;
  };
}

// ============================================================
// Hero Events
// ============================================================

export interface HeroMintedEvent {
  name: 'HeroMinted';
  data: {
    player: PublicKey;
    heroMint: PublicKey;
    templateId: number;
    timestamp: BN;
  };
}

export interface HeroLockedEvent {
  name: 'HeroLocked';
  data: {
    player: PublicKey;
    heroMint: PublicKey;
    slot: number;
    timestamp: BN;
  };
}

export interface HeroUnlockedEvent {
  name: 'HeroUnlocked';
  data: {
    player: PublicKey;
    heroMint: PublicKey;
    slot: number;
    timestamp: BN;
  };
}

export interface HeroLeveledUpEvent {
  name: 'HeroLeveledUp';
  data: {
    player: PublicKey;
    heroMint: PublicKey;
    newLevel: number;
    timestamp: BN;
  };
}

// ============================================================
// Shop Events
// ============================================================

export interface ItemPurchasedEvent {
  name: 'ItemPurchased';
  data: {
    player: PublicKey;
    itemId: number;
    quantity: number;
    totalPrice: BN;
    paymentType: number;
    timestamp: BN;
  };
}

export interface BundlePurchasedEvent {
  name: 'BundlePurchased';
  data: {
    player: PublicKey;
    bundleId: number;
    totalPrice: BN;
    timestamp: BN;
  };
}

export interface FlashSalePurchasedEvent {
  name: 'FlashSalePurchased';
  data: {
    player: PublicKey;
    flashSaleId: number;
    itemsReceived: number;
    price: BN;
    timestamp: BN;
  };
}

export interface NoviPurchasedEvent {
  name: 'NoviPurchased';
  data: {
    buyer: PublicKey;
    user: PublicKey;
    packageIndex: number;
    baseAmount: BN;
    bonusAmount: BN;
    totalReceived: BN;
    costLamports: BN;
    streakDay: number;
    subscriptionTier: number;
    timestamp: BN;
  };
}

// ============================================================
// Initialization Events
// ============================================================

export interface GameEngineInitializedEvent {
  name: 'GameEngineInitialized';
  data: {
    gameEngine: PublicKey;
    daoAuthority: PublicKey;
    timestamp: BN;
  };
}

export interface PlayerInitializedEvent {
  name: 'PlayerInitialized';
  data: {
    player: PublicKey;
    owner: PublicKey;
    city: PublicKey;
    timestamp: BN;
  };
}

export interface CityInitializedEvent {
  name: 'CityInitialized';
  data: {
    city: PublicKey;
    cityId: number;
    cityType: number;
    timestamp: BN;
  };
}

// ============================================================
// Name Events
// ============================================================

export interface PlayerNameSetEvent {
  name: 'PlayerNameSet';
  data: {
    player: PublicKey;
    name: string;
    timestamp: BN;
  };
}

export interface TeamNameSetEvent {
  name: 'TeamNameSet';
  data: {
    team: PublicKey;
    name: string;
    timestamp: BN;
  };
}

// ============================================================
// Token Events
// ============================================================

export interface LockedNoviUpdatedEvent {
  name: 'LockedNoviUpdated';
  data: {
    player: PublicKey;
    oldAmount: BN;
    newAmount: BN;
    timestamp: BN;
  };
}

export interface ReservedWithdrawnEvent {
  name: 'ReservedWithdrawn';
  data: {
    player: PublicKey;
    amount: BN;
    timestamp: BN;
  };
}

// ============================================================
// Arena Events
// ============================================================

export interface ArenaSeasonCreatedEvent {
  name: 'ArenaSeasonCreated';
  data: {
    season: PublicKey;
    seasonId: number;
    startTime: BN;
    endTime: BN;
    timestamp: BN;
  };
}

export interface ArenaJoinedEvent {
  name: 'ArenaJoined';
  data: {
    season: PublicKey;
    player: PublicKey;
    playerName: string;
    timestamp: BN;
  };
}

export interface ArenaChallengeEvent {
  name: 'ArenaChallenge';
  data: {
    season: PublicKey;
    challenger: PublicKey;
    challengerName: string;
    defender: PublicKey;
    defenderName: string;
    challengerWon: boolean;
    ratingChange: number;
    timestamp: BN;
  };
}

export interface ArenaSeasonClosedEvent {
  name: 'ArenaSeasonClosed';
  data: {
    season: PublicKey;
    seasonId: number;
    timestamp: BN;
  };
}

// ============================================================
// Game Event Events
// ============================================================

export interface GameEventCreatedEvent {
  name: 'GameEventCreated';
  data: {
    event: PublicKey;
    eventId: number;
    eventType: number;
    startTime: BN;
    endTime: BN;
    timestamp: BN;
  };
}

export interface GameEventJoinedEvent {
  name: 'GameEventJoined';
  data: {
    event: PublicKey;
    player: PublicKey;
    playerName: string;
    timestamp: BN;
  };
}

export interface GameEventFinalizedEvent {
  name: 'GameEventFinalized';
  data: {
    event: PublicKey;
    eventId: number;
    timestamp: BN;
  };
}

export interface GameEventPrizeClaimedEvent {
  name: 'GameEventPrizeClaimed';
  data: {
    event: PublicKey;
    player: PublicKey;
    rank: number;
    prizeAmount: BN;
    timestamp: BN;
  };
}

// ============================================================
// Dungeon Events
// ============================================================

export interface DungeonEnteredEvent {
  name: 'DungeonEntered';
  data: {
    player: PublicKey;
    dungeonRun: PublicKey;
    templateId: number;
    heroMint: PublicKey;
    entryCost: BN;
    timestamp: BN;
  };
}

export interface DungeonRoomClearedEvent {
  name: 'DungeonRoomCleared';
  data: {
    player: PublicKey;
    dungeonRun: PublicKey;
    floor: number;
    roomType: number;
    goldCollected: BN;
    timestamp: BN;
  };
}

export interface DungeonRelicChosenEvent {
  name: 'DungeonRelicChosen';
  data: {
    player: PublicKey;
    dungeonRun: PublicKey;
    relicId: number;
    timestamp: BN;
  };
}

export interface DungeonFloorCompletedEvent {
  name: 'DungeonFloorCompleted';
  data: {
    player: PublicKey;
    dungeonRun: PublicKey;
    floor: number;
    timestamp: BN;
  };
}

export interface DungeonCompletedEvent {
  name: 'DungeonCompleted';
  data: {
    player: PublicKey;
    dungeonRun: PublicKey;
    templateId: number;
    floorsCleared: number;
    totalGold: BN;
    totalRewards: BN;
    timestamp: BN;
  };
}

export interface DungeonFailedEvent {
  name: 'DungeonFailed';
  data: {
    player: PublicKey;
    dungeonRun: PublicKey;
    floor: number;
    timestamp: BN;
  };
}

export interface DungeonFledEvent {
  name: 'DungeonFled';
  data: {
    player: PublicKey;
    dungeonRun: PublicKey;
    floor: number;
    goldKept: BN;
    timestamp: BN;
  };
}

// ============================================================
// Castle Events
// ============================================================

export interface CastleCreatedEvent {
  name: 'CastleCreated';
  data: {
    castle: PublicKey;
    city: PublicKey;
    tier: number;
    timestamp: BN;
  };
}

export interface CastleClaimedEvent {
  name: 'CastleClaimed';
  data: {
    castle: PublicKey;
    king: PublicKey;
    kingName: string;
    timestamp: BN;
  };
}

export interface CastleUpgradeInitiatedEvent {
  name: 'CastleUpgradeInitiated';
  data: {
    castle: PublicKey;
    upgradeType: number;
    completionTime: BN;
    timestamp: BN;
  };
}

export interface CastleUpgradeCompletedEvent {
  name: 'CastleUpgradeCompleted';
  data: {
    castle: PublicKey;
    upgradeType: number;
    newLevel: number;
    timestamp: BN;
  };
}

export interface CourtAppointedEvent {
  name: 'CourtAppointed';
  data: {
    castle: PublicKey;
    appointee: PublicKey;
    appointeeName: string;
    position: number;
    timestamp: BN;
  };
}

export interface CourtDismissedEvent {
  name: 'CourtDismissed';
  data: {
    castle: PublicKey;
    member: PublicKey;
    position: number;
    timestamp: BN;
  };
}

export interface GarrisonJoinedEvent {
  name: 'GarrisonJoined';
  data: {
    castle: PublicKey;
    player: PublicKey;
    playerName: string;
    defensive1: BN;
    defensive2: BN;
    defensive3: BN;
    timestamp: BN;
  };
}

export interface GarrisonLeftEvent {
  name: 'GarrisonLeft';
  data: {
    castle: PublicKey;
    player: PublicKey;
    timestamp: BN;
  };
}

export interface CastleAttackedEvent {
  name: 'CastleAttacked';
  data: {
    castle: PublicKey;
    attacker: PublicKey;
    attackerName: string;
    damageDealt: BN;
    wallsRemaining: BN;
    success: boolean;
    timestamp: BN;
  };
}

export interface CastleConqueredEvent {
  name: 'CastleConquered';
  data: {
    castle: PublicKey;
    oldKing: PublicKey;
    newKing: PublicKey;
    newKingName: string;
    timestamp: BN;
  };
}

export interface CastleRewardsClaimedEvent {
  name: 'CastleRewardsClaimed';
  data: {
    castle: PublicKey;
    claimer: PublicKey;
    cashReceived: BN;
    noviReceived: BN;
    timestamp: BN;
  };
}

// ============================================================
// Kingdom Events
// ============================================================

export interface KingdomCreatedEvent {
  name: 'KingdomCreated';
  data: {
    kingdomId: number;
    kingdomName: string;
    theme: number;
    startTime: BN;
    registrationClosesAt: BN;
    createdBy: PublicKey;
    createdAt: BN;
  };
}

export interface KingdomRegistrationClosedEvent {
  name: 'KingdomRegistrationClosed';
  data: {
    kingdomId: number;
    gameEngine: PublicKey;
    totalPlayers: BN;
    closedAt: BN;
  };
}

export interface PlayerJoinedKingdomEvent {
  name: 'PlayerJoinedKingdom';
  data: {
    kingdomId: number;
    gameEngine: PublicKey;
    player: PublicKey;
    owner: PublicKey;
    joinedAt: BN;
  };
}

export interface KingdomEventCreatedEvent {
  name: 'KingdomEventCreated';
  data: {
    kingdomId: number;
    gameEngine: PublicKey;
    eventId: BN;
    eventType: number;
    startTime: BN;
    endTime: BN;
    prizePool: BN;
  };
}

export interface KingdomArenaSeasonStartedEvent {
  name: 'KingdomArenaSeasonStarted';
  data: {
    kingdomId: number;
    gameEngine: PublicKey;
    seasonId: number;
    startTime: BN;
    endTime: BN;
    prizePool: BN;
  };
}

export interface KingdomDungeonLeaderboardCreatedEvent {
  name: 'KingdomDungeonLeaderboardCreated';
  data: {
    kingdomId: number;
    gameEngine: PublicKey;
    dungeonId: number;
    weekNumber: number;
    prizePool: BN;
  };
}

export interface KingdomCitiesInitializedEvent {
  name: 'KingdomCitiesInitialized';
  data: {
    kingdomId: number;
    gameEngine: PublicKey;
    startCityId: number;
    citiesCount: number;
    initializedAt: BN;
  };
}

// ============================================================
// Union Type for All Events
// ============================================================

export type NovusMundusEvent =
  // Combat
  | PlayerAttackedEvent
  | EncounterAttackedEvent
  | EncounterDefeatedEvent
  // Economy
  | ResourcesCollectedEvent
  | UnitsHiredEvent
  | CashTransferredEvent
  | NoviMintedEvent
  | NoviBurnedEvent
  // Team
  | TeamCreatedEvent
  | TeamJoinedEvent
  | TeamLeftEvent
  | TeamDisbandedEvent
  | TeamMemberPromotedEvent
  | TeamMemberDemotedEvent
  | TeamMemberKickedEvent
  | TeamLeadershipTransferredEvent
  | TeamInviteSentEvent
  | TeamInviteAcceptedEvent
  | TeamInviteDeclinedEvent
  | TeamInviteCancelledEvent
  | TeamTreasuryDepositedEvent
  | TeamTreasuryWithdrawnEvent
  // Travel
  | TravelStartedEvent
  | TravelCompletedEvent
  | TravelCancelledEvent
  // Rally
  | RallyCreatedEvent
  | RallyJoinedEvent
  | RallyLeftEvent
  | RallyCancelledEvent
  | RallyExecutedEvent
  | RallyReturnProcessedEvent
  // Reinforcement
  | ReinforcementSentEvent
  | ReinforcementArrivedEvent
  | ReinforcementRecalledEvent
  | ReinforcementRelievedEvent
  | ReinforcementReturnedEvent
  // Expedition
  | ExpeditionStartedEvent
  | ExpeditionStrikeEvent
  | ExpeditionClaimedEvent
  | ExpeditionAbortedEvent
  // Loot
  | LootClaimedEvent
  // Progression
  | DailyRewardClaimedEvent
  | PlayerLeveledUpEvent
  // Estate
  | EstateCreatedEvent
  | BuildingConstructedEvent
  | BuildingUpgradedEvent
  | PlotPurchasedEvent
  // Forge
  | CraftStartedEvent
  | CraftStrikeEvent
  | CraftCompletedEvent
  | CraftAbandonedEvent
  | EquipmentEquippedEvent
  // Research
  | ResearchStartedEvent
  | ResearchCompletedEvent
  | ResearchCancelledEvent
  | AscensionCompletedEvent
  // Sanctuary
  | MeditationStartedEvent
  | MeditationClaimedEvent
  // Hero
  | HeroMintedEvent
  | HeroLockedEvent
  | HeroUnlockedEvent
  | HeroLeveledUpEvent
  // Shop
  | ItemPurchasedEvent
  | BundlePurchasedEvent
  | FlashSalePurchasedEvent
  | NoviPurchasedEvent
  // Initialization
  | GameEngineInitializedEvent
  | PlayerInitializedEvent
  | CityInitializedEvent
  // Name
  | PlayerNameSetEvent
  | TeamNameSetEvent
  // Token
  | LockedNoviUpdatedEvent
  | ReservedWithdrawnEvent
  // Arena
  | ArenaSeasonCreatedEvent
  | ArenaJoinedEvent
  | ArenaChallengeEvent
  | ArenaSeasonClosedEvent
  // Game Event
  | GameEventCreatedEvent
  | GameEventJoinedEvent
  | GameEventFinalizedEvent
  | GameEventPrizeClaimedEvent
  // Dungeon
  | DungeonEnteredEvent
  | DungeonRoomClearedEvent
  | DungeonRelicChosenEvent
  | DungeonFloorCompletedEvent
  | DungeonCompletedEvent
  | DungeonFailedEvent
  | DungeonFledEvent
  // Castle
  | CastleCreatedEvent
  | CastleClaimedEvent
  | CastleUpgradeInitiatedEvent
  | CastleUpgradeCompletedEvent
  | CourtAppointedEvent
  | CourtDismissedEvent
  | GarrisonJoinedEvent
  | GarrisonLeftEvent
  | CastleAttackedEvent
  | CastleConqueredEvent
  | CastleRewardsClaimedEvent
  // Kingdom
  | KingdomCreatedEvent
  | KingdomRegistrationClosedEvent
  | PlayerJoinedKingdomEvent
  | KingdomEventCreatedEvent
  | KingdomArenaSeasonStartedEvent
  | KingdomDungeonLeaderboardCreatedEvent
  | KingdomCitiesInitializedEvent;

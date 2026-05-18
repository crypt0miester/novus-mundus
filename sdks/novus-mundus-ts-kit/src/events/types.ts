/**
 * Event Types
 *
 * TypeScript interfaces for all on-chain events parsed by parser.ts.
 */

import type { Address } from '@solana/kit';
import BN from 'bn.js';

// Combat Events

export interface PlayerAttackedEvent {
  attacker: Address;
  attackerName: string;
  defender: Address;
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
}

export interface EncounterAttackedEvent {
  player: Address;
  playerName: string;
  encounter: Address;
  damageDealt: BN;
  healthRemaining: BN;
  staminaConsumed: number;
  noviConsumed: BN;
  attackerCount: number;
  timestamp: BN;
}

export interface EncounterDefeatedEvent {
  encounter: Address;
  encounterType: number;
  level: number;
  totalAttackers: number;
  killingBlowBy: Address;
  killingBlowName: string;
  lootCash: BN;
  lootNovi: BN;
  timestamp: BN;
}

// Economy Events

export interface ResourcesCollectedEvent {
  player: Address;
  playerName: string;
  collectionType: number;
  noviConsumed: BN;
  baseOutput: BN;
  finalOutput: BN;
  gemsEarned: BN;
  fragmentsEarned: BN;
  xpGained: BN;
  timestamp: BN;
}

export interface UnitsHiredEvent {
  player: Address;
  playerName: string;
  unitType: number;
  baseQuantity: BN;
  finalQuantity: BN;
  noviBurned: BN;
  timeBonusBps: number;
  timestamp: BN;
}

export interface CashTransferredEvent {
  from: Address;
  fromName: string;
  to: Address;
  toName: string;
  amount: BN;
  fee: BN;
  timestamp: BN;
}

export interface NoviLockedEvent {
  player: Address;
  playerName: string;
  amount: BN;
  totalLocked: BN;
  timestamp: BN;
}

export interface EquipmentPurchasedEvent {
  player: Address;
  playerName: string;
  slot: number;
  tier: number;
  noviBurned: BN;
  timestamp: BN;
}

export interface StaminaPurchasedEvent {
  player: Address;
  playerName: string;
  stamina: BN;
  gemsSpent: BN;
  timestamp: BN;
}

export interface VaultTransferEvent {
  player: Address;
  playerName: string;
  amount: BN;
  toVault: boolean;
  vaultBalance: BN;
  timestamp: BN;
}

// Team Events

export interface TeamCreatedEvent {
  team: Address;
  teamName: string;
  founder: Address;
  noviBurned: BN;
  timestamp: BN;
}

export interface TeamJoinedEvent {
  team: Address;
  teamName: string;
  player: Address;
  memberCount: number;
  timestamp: BN;
}

export interface TeamLeftEvent {
  team: Address;
  teamName: string;
  player: Address;
  memberCount: number;
  timestamp: BN;
}

export interface MemberKickedEvent {
  team: Address;
  teamName: string;
  kicked: Address;
  kickedBy: Address;
  timestamp: BN;
}

export interface LeadershipTransferredEvent {
  team: Address;
  teamName: string;
  oldLeader: Address;
  newLeader: Address;
  timestamp: BN;
}

export interface TeamDisbandedEvent {
  team: Address;
  teamName: string;
  leader: Address;
  treasuryDistributed: BN;
  timestamp: BN;
}

export interface TreasuryDepositEvent {
  team: Address;
  teamName: string;
  depositor: Address;
  amount: BN;
  newBalance: BN;
  timestamp: BN;
}

export interface TreasuryWithdrawEvent {
  team: Address;
  teamName: string;
  withdrawer: Address;
  amount: BN;
  newBalance: BN;
  timestamp: BN;
}

export interface MemberRankChangedEvent {
  team: Address;
  teamName: string;
  member: Address;
  oldRank: number;
  newRank: number;
  changedBy: Address;
  timestamp: BN;
}

export interface InviteSentEvent {
  team: Address;
  teamName: string;
  invitee: Address;
  inviter: Address;
  timestamp: BN;
}

export interface InviteAcceptedEvent {
  team: Address;
  teamName: string;
  player: Address;
  memberCount: number;
  timestamp: BN;
}

export interface InviteDeclinedEvent {
  team: Address;
  teamName: string;
  player: Address;
  timestamp: BN;
}

export interface InviteCancelledEvent {
  team: Address;
  teamName: string;
  invitee: Address;
  cancelledBy: Address;
  timestamp: BN;
}

export interface MotdUpdatedEvent {
  team: Address;
  teamName: string;
  updatedBy: Address;
  timestamp: BN;
}

export interface TeamSettingsUpdatedEvent {
  team: Address;
  teamName: string;
  updatedBy: Address;
  timestamp: BN;
}

export interface TreasurySettingsUpdatedEvent {
  team: Address;
  teamName: string;
  updatedBy: Address;
  timestamp: BN;
}

export interface TreasuryWithdrawRequestedEvent {
  team: Address;
  teamName: string;
  requester: Address;
  amount: BN;
  timestamp: BN;
}

export interface TreasuryRequestApprovedEvent {
  team: Address;
  teamName: string;
  approver: Address;
  requester: Address;
  timestamp: BN;
}

export interface TreasuryRequestRejectedEvent {
  team: Address;
  teamName: string;
  rejector: Address;
  requester: Address;
  timestamp: BN;
}

export interface TreasuryRequestExecutedEvent {
  team: Address;
  teamName: string;
  executor: Address;
  requester: Address;
  amount: BN;
  newBalance: BN;
  timestamp: BN;
}

export interface TreasuryRequestCancelledEvent {
  team: Address;
  teamName: string;
  requester: Address;
  timestamp: BN;
}

// Travel Events

export interface IntercityTravelStartedEvent {
  player: Address;
  playerName: string;
  fromCity: Address;
  toCity: Address;
  arrivalAt: BN;
  timestamp: BN;
}

export interface IntercityTravelCompletedEvent {
  player: Address;
  playerName: string;
  city: Address;
  timestamp: BN;
}

export interface PlayerTeleportedEvent {
  player: Address;
  playerName: string;
  fromCity: Address;
  toCity: Address;
  gemsSpent: BN;
  timestamp: BN;
}

export interface IntracityTravelStartedEvent {
  player: Address;
  playerName: string;
  city: Address;
  destX: number;
  destY: number;
  arrivalAt: BN;
  timestamp: BN;
}

export interface IntracityTravelCompletedEvent {
  player: Address;
  playerName: string;
  x: number;
  y: number;
  timestamp: BN;
}

export interface TravelCancelledEvent {
  player: Address;
  playerName: string;
  isIntercity: boolean;
  wasBumped: boolean;
  timestamp: BN;
}

export interface TravelSpeedupEvent {
  player: Address;
  playerName: string;
  isIntercity: boolean;
  speedupTier: number;
  gemsSpent: BN;
  newEta: BN;
  timestamp: BN;
}

// Rally Events

export interface RallyCreatedEvent {
  rally: Address;
  team: Address;
  teamName: string;
  leader: Address;
  target: Address;
  gatherAt: BN;
  timestamp: BN;
}

export interface RallyJoinedEvent {
  rally: Address;
  teamName: string;
  player: Address;
  units: [BN, BN, BN];
  participantCount: number;
  timestamp: BN;
}

export interface RallyExecutedEvent {
  rally: Address;
  teamName: string;
  target: Address;
  damageDealt: BN;
  damageReceived: BN;
  lootCaptured: BN;
  participantCount: number;
  timestamp: BN;
}

export interface RallyCancelledEvent {
  rally: Address;
  teamName: string;
  cancelledBy: Address;
  timestamp: BN;
}

export interface RallyLeftEvent {
  rally: Address;
  teamName: string;
  player: Address;
  units: [BN, BN, BN];
  participantCount: number;
  timestamp: BN;
}

export interface RallyClosedEvent {
  rally: Address;
  rallyId: BN;
  teamName: string;
  leader: Address;
  timestamp: BN;
}

export interface RallySpeedupEvent {
  rally: Address;
  teamName: string;
  payer: Address;
  speedupType: number;
  gemsSpent: BN;
  timestamp: BN;
}

export interface RallyParticipantReturnedEvent {
  rally: Address;
  teamName: string;
  player: Address;
  participatedInCombat: boolean;
  unitsReturned: [BN, BN, BN];
  lootReceived: BN;
  timestamp: BN;
}

// Reinforcement Events

export interface ReinforcementSentEvent {
  sender: Address;
  senderName: string;
  receiver: Address;
  receiverName: string;
  units: [BN, BN, BN];
  arrivesAt: BN;
  timestamp: BN;
}

export interface ReinforcementArrivedEvent {
  reinforcement: Address;
  sender: Address;
  senderName: string;
  receiver: Address;
  receiverName: string;
  units: [BN, BN, BN];
  timestamp: BN;
}

export interface ReinforcementRecalledEvent {
  reinforcement: Address;
  sender: Address;
  senderName: string;
  receiver: Address;
  receiverName: string;
  units: [BN, BN, BN];
  timestamp: BN;
}

export interface ReinforcementRelievedEvent {
  reinforcement: Address;
  sender: Address;
  senderName: string;
  receiver: Address;
  receiverName: string;
  units: [BN, BN, BN];
  timestamp: BN;
}

export interface ReinforcementReturnedEvent {
  sender: Address;
  senderName: string;
  units: [BN, BN, BN];
  timestamp: BN;
}

export interface ReinforcementSpeedupEvent {
  reinforcement: Address;
  sender: Address;
  senderName: string;
  receiver: Address;
  speedupType: number;
  gemsSpent: BN;
  newEta: BN;
  timestamp: BN;
}

// Expedition Events

export interface ExpeditionStartedEvent {
  player: Address;
  playerName: string;
  expeditionType: number;
  nodeId: number;
  duration: number;
  timestamp: BN;
}

export interface ExpeditionStrikeEvent {
  player: Address;
  playerName: string;
  strikeNum: number;
  yieldAmount: BN;
  quality: number;
  timestamp: BN;
}

export interface ExpeditionClaimedEvent {
  player: Address;
  playerName: string;
  expeditionType: number;
  totalYield: BN;
  bonusYield: BN;
  xpEarned: BN;
  timestamp: BN;
}

export interface ExpeditionAbortedEvent {
  player: Address;
  playerName: string;
  expeditionType: number;
  partialYield: BN;
  timestamp: BN;
}

export interface ExpeditionSpeedupEvent {
  player: Address;
  playerName: string;
  speedupSeconds: BN;
  gemsSpent: BN;
  newEta: BN;
  timestamp: BN;
}

// Loot Events

export interface LootClaimedEvent {
  player: Address;
  playerName: string;
  cash: BN;
  items: [number, number, number, number];
  timestamp: BN;
}

export interface EncounterSpawnedEvent {
  encounter: Address;
  city: Address;
  encounterType: number;
  level: number;
  x: number;
  y: number;
  timestamp: BN;
}

// Progression Events

export interface DailyRewardClaimedEvent {
  player: Address;
  playerName: string;
  cash: BN;
  timestamp: BN;
}

export interface SubscriptionPurchasedEvent {
  player: Address;
  playerName: string;
  tier: number;
  durationDays: number;
  noviPaid: BN;
  expiresAt: BN;
  timestamp: BN;
}

export interface XpGainedEvent {
  player: Address;
  playerName: string;
  amount: BN;
  source: number;
  totalXp: BN;
  timestamp: BN;
}

export interface PlayerLeveledUpEvent {
  player: Address;
  playerName: string;
  oldLevel: number;
  newLevel: number;
  timestamp: BN;
}

export interface EventPrizeClaimedEvent {
  player: Address;
  playerName: string;
  event: Address;
  rank: number;
  prizeAmount: BN;
  timestamp: BN;
}

export interface SubscriptionTierUpdatedEvent {
  player: Address;
  playerName: string;
  oldTier: number;
  newTier: number;
  expiresAt: BN;
  timestamp: BN;
}

export interface SubscriptionExpiredEvent {
  player: Address;
  playerName: string;
  oldTier: number;
  timestamp: BN;
}

// Estate Events

export interface EstateCreatedEvent {
  estate: Address;
  player: Address;
  playerName: string;
  timestamp: BN;
}

export interface BuildingStartedEvent {
  player: Address;
  playerName: string;
  buildingType: number;
  plot: number;
  completesAt: BN;
  timestamp: BN;
}

export interface BuildingCompletedEvent {
  player: Address;
  playerName: string;
  buildingType: number;
  level: number;
  plot: number;
  timestamp: BN;
}

export interface BuildingUpgradeStartedEvent {
  player: Address;
  playerName: string;
  buildingType: number;
  fromLevel: number;
  toLevel: number;
  completesAt: BN;
  timestamp: BN;
}

export interface PlotPurchasedEvent {
  player: Address;
  playerName: string;
  plot: number;
  cost: BN;
  totalPlots: number;
  timestamp: BN;
}

export interface EstateDailyClaimedEvent {
  player: Address;
  playerName: string;
  materials: BN;
  streak: number;
  timestamp: BN;
}

// Forge Events

export interface CraftStartedEvent {
  player: Address;
  playerName: string;
  itemType: number;
  qualityTier: number;
  materialsUsed: BN;
  timestamp: BN;
}

export interface CraftStrikeEvent {
  player: Address;
  playerName: string;
  stage: number;
  quality: number;
  score: number;
  timestamp: BN;
}

export interface CraftCompletedEvent {
  player: Address;
  playerName: string;
  itemType: number;
  quality: number;
  score: number;
  inventorySlot: number;
  timestamp: BN;
}

export interface CraftAbandonedEvent {
  player: Address;
  playerName: string;
  itemType: number;
  stageReached: number;
  timestamp: BN;
}

export interface ItemEquippedEvent {
  player: Address;
  playerName: string;
  heroMint: Address;
  heroName: string;
  slot: number;
  quality: number;
  fromInventory: number;
  timestamp: BN;
}

// Research Events

export interface ResearchStartedEvent {
  player: Address;
  playerName: string;
  researchId: number;
  level: number;
  completesAt: BN;
  timestamp: BN;
}

export interface ResearchCompletedEvent {
  player: Address;
  playerName: string;
  researchId: number;
  level: number;
  timestamp: BN;
}

export interface ResearchCancelledEvent {
  player: Address;
  playerName: string;
  researchId: number;
  timestamp: BN;
}

export interface ResearchSpeedupEvent {
  player: Address;
  playerName: string;
  researchId: number;
  speedupSeconds: BN;
  gemsSpent: BN;
  newEta: BN;
  timestamp: BN;
}

export interface ResearchAscendedEvent {
  player: Address;
  playerName: string;
  researchTree: number;
  newAscensionLevel: number;
  masteryCost: number;
  timestamp: BN;
}

export interface PlayerAscendedEvent {
  player: Address;
  playerName: string;
  ascensionLevel: number;
  masteryGained: number;
  timestamp: BN;
}

// Sanctuary Events

export interface MeditationStartedEvent {
  player: Address;
  playerName: string;
  heroMint: Address;
  heroName: string;
  durationHours: number;
  completesAt: BN;
  timestamp: BN;
}

export interface MeditationClaimedEvent {
  player: Address;
  playerName: string;
  heroMint: Address;
  heroName: string;
  xpEarned: number;
  levelsGained: number;
  timestamp: BN;
}

// Hero Events

export interface HeroMintedEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  templateId: number;
  rarity: number;
  timestamp: BN;
}

export interface HeroLockedEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  slot: number;
  timestamp: BN;
}

export interface HeroUnlockedEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  timestamp: BN;
}

export interface HeroLeveledUpEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  oldLevel: number;
  newLevel: number;
  xpSpent: BN;
  timestamp: BN;
}

export interface HeroAssignedDefensiveEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  assigned: boolean;
  timestamp: BN;
}

export interface HeroBurnedEvent {
  heroMint: Address;
  player: Address;
  playerName: string;
  templateId: number;
  heroLevel: number;
  tier: number;
  noviReward: BN;
  newMintedCount: number;
  timestamp: BN;
}

export interface SupplyCapUpdatedEvent {
  templateId: number;
  oldSupplyCap: number;
  newSupplyCap: number;
  timestamp: BN;
}

// Shop Events

export interface ItemPurchasedEvent {
  player: Address;
  playerName: string;
  itemId: number;
  quantity: number;
  price: BN;
  currency: number;
  timestamp: BN;
}

export interface BundlePurchasedEvent {
  player: Address;
  playerName: string;
  bundleId: number;
  price: BN;
  currency: number;
  timestamp: BN;
}

export interface FlashSalePurchasedEvent {
  player: Address;
  playerName: string;
  saleId: BN;
  originalPrice: BN;
  pricePaid: BN;
  currency: number;
  timestamp: BN;
}

export interface NoviPurchasedEvent {
  buyer: Address;
  user: Address;
  packageIndex: number;
  baseAmount: BN;
  bonusAmount: BN;
  totalReceived: BN;
  costLamports: BN;
  streakDay: number;
  subscriptionTier: number;
  timestamp: BN;
}

// Initialization Events

export interface PlayerCreatedEvent {
  player: Address;
  user: Address;
  city: Address;
  timestamp: BN;
}

export interface UserCreatedEvent {
  user: Address;
  wallet: Address;
  timestamp: BN;
}

export interface CityInitializedEvent {
  city: Address;
  cityIndex: number;
  timestamp: BN;
}

export interface GameEngineInitializedEvent {
  gameEngine: Address;
  authority: Address;
  timestamp: BN;
}

// Name Events

export interface PlayerNameSetEvent {
  player: Address;
  playerName: string;
  domainHash: Uint8Array;
  timestamp: BN;
}

export interface PlayerNameRemovedEvent {
  player: Address;
  playerName: string;
  timestamp: BN;
}

export interface PlayerNameUpdatedEvent {
  player: Address;
  oldName: string;
  newName: string;
  newDomainHash: Uint8Array;
  timestamp: BN;
}

export interface TeamNameSetEvent {
  team: Address;
  teamName: string;
  domainHash: Uint8Array;
  timestamp: BN;
}

export interface TeamNameRemovedEvent {
  team: Address;
  teamName: string;
  timestamp: BN;
}

export interface TeamNameUpdatedEvent {
  team: Address;
  oldName: string;
  newName: string;
  newDomainHash: Uint8Array;
  timestamp: BN;
}

// Token Events

export interface NoviReservedToLockedEvent {
  player: Address;
  playerName: string;
  amount: BN;
  newLocked: BN;
  remainingReserved: BN;
  timestamp: BN;
}

export interface NoviWithdrawnEvent {
  player: Address;
  playerName: string;
  amount: BN;
  remainingReserved: BN;
  timestamp: BN;
}

// Dungeon Events

export interface DungeonEnteredEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  heroMint: Address;
  heroName: string;
  staminaSpent: number;
  timestamp: BN;
}

export interface DungeonRoomClearedEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  room: number;
  xpGained: BN;
  timestamp: BN;
}

export interface DungeonFloorCompletedEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  noviGained: BN;
  isCheckpoint: boolean;
  timestamp: BN;
}

export interface DungeonRelicChosenEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  relicId: number;
  totalRelics: number;
  timestamp: BN;
}

export interface DungeonBossFightEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  bossPower: number;
  bossHealth: BN;
  timestamp: BN;
}

export interface DungeonFailedEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  room: number;
  enemiesKilled: number;
  timestamp: BN;
}

export interface DungeonFledEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  enemiesKilled: number;
  xpGained: BN;
  noviGained: BN;
  gemsGained: BN;
  timestamp: BN;
}

export interface DungeonCompletedEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  victory: boolean;
  finalFloor: number;
  enemiesKilled: number;
  roomsCleared: number;
  relicsCollected: number;
  xpGained: BN;
  noviGained: BN;
  gemsGained: BN;
  materialsGained: number;
  totalDamageDealt: BN;
  timestamp: BN;
}

export interface DungeonResumedEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  checkpointFloor: number;
  resumeFloor: number;
  gemCost: BN;
  resumeCount: number;
  timestamp: BN;
}

export interface DungeonLeaderboardPrizeClaimedEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  weekNumber: number;
  rank: number;
  score: BN;
  prizeAmount: BN;
  timestamp: BN;
}

// Castle Events

export interface CastleCreatedEvent {
  castle: Address;
  castleName: string;
  cityId: number;
  castleId: number;
  tier: number;
  timestamp: BN;
}

export interface CastleClaimedEvent {
  castle: Address;
  castleName: string;
  king: Address;
  kingName: string;
  team: Address;
  tier: number;
  timestamp: BN;
}

export interface CastleConqueredEvent {
  castle: Address;
  castleName: string;
  previousKing: Address;
  newKing: Address;
  newKingName: string;
  newTeam: Address;
  rallyId: BN;
  timestamp: BN;
}

export interface CastleDefendedEvent {
  castle: Address;
  castleName: string;
  king: Address;
  rallyId: BN;
  damageDealt: BN;
  weaponsCaptured: BN;
  timestamp: BN;
}

export interface CourtAppointedEvent {
  castle: Address;
  castleName: string;
  appointee: Address;
  appointeeName: string;
  positionType: number;
  appointedBy: Address;
  timestamp: BN;
}

export interface CourtDismissedEvent {
  castle: Address;
  castleName: string;
  dismissed: Address;
  dismissedName: string;
  positionType: number;
  dismissedBy: Address;
  resigned: boolean;
  timestamp: BN;
}

export interface GarrisonJoinedEvent {
  castle: Address;
  castleName: string;
  contributor: Address;
  contributorName: string;
  units1: BN;
  units2: BN;
  units3: BN;
  weapons: BN;
  heroMint: Address;
  garrisonCount: number;
  timestamp: BN;
}

export interface GarrisonLeftEvent {
  castle: Address;
  castleName: string;
  contributor: Address;
  contributorName: string;
  units1: BN;
  units2: BN;
  units3: BN;
  weapons: BN;
  heroMint: Address;
  relieved: boolean;
  garrisonCount: number;
  timestamp: BN;
}

export interface GarrisonLootClaimedEvent {
  castle: Address;
  castleName: string;
  claimer: Address;
  claimerName: string;
  melee: BN;
  ranged: BN;
  siege: BN;
  timestamp: BN;
}

export interface CastleUpgradeStartedEvent {
  castle: Address;
  castleName: string;
  king: Address;
  upgradeType: number;
  currentLevel: number;
  targetLevel: number;
  noviCost: BN;
  completesAt: BN;
  timestamp: BN;
}

export interface CastleUpgradeCompletedEvent {
  castle: Address;
  castleName: string;
  upgradeType: number;
  newLevel: number;
  timestamp: BN;
}

export interface CastleUpgradeCancelledEvent {
  castle: Address;
  castleName: string;
  upgradeType: number;
  noviRefunded: BN;
  timestamp: BN;
}

export interface CastleRewardsClaimedEvent {
  castle: Address;
  castleName: string;
  claimer: Address;
  claimerName: string;
  role: number;
  days: number;
  novi: BN;
  cash: BN;
  timestamp: BN;
}

export interface CastleProtectionExpiredEvent {
  castle: Address;
  castleName: string;
  king: Address;
  timestamp: BN;
}

export interface KingForceRemovedEvent {
  castle: Address;
  castleName: string;
  removedKing: Address;
  removedKingName: string;
  timestamp: BN;
}

export interface CastleTransitionProgressEvent {
  castle: Address;
  phase: number;
  cleanedCount: number;
  totalCount: number;
  timestamp: BN;
}

export interface CastleStatusChangedEvent {
  castle: Address;
  castleName: string;
  oldStatus: number;
  newStatus: number;
  timestamp: BN;
}

export interface CastleAttackedEvent {
  castle: Address;
  castleName: string;
  attacker: Address;
  attackerName: string;
  king: Address;
  damageDealt: BN;
  damageReceived: BN;
  attackerCasualties: BN;
  garrisonCasualties: BN;
  attackerWon: boolean;
  timestamp: BN;
}

// Game Event Events

export interface GameEventCreatedEvent {
  event: Address;
  eventType: number;
  startTime: BN;
  endTime: BN;
  prizePool: BN;
  timestamp: BN;
}

export interface GameEventJoinedEvent {
  event: Address;
  player: Address;
  playerName: string;
  entryFee: BN;
  participantCount: number;
  timestamp: BN;
}

export interface GameEventFinalizedEvent {
  event: Address;
  totalParticipants: number;
  totalPrizes: BN;
  timestamp: BN;
}

export interface EventScoreUpdatedEvent {
  event: Address;
  player: Address;
  playerName: string;
  scoreDelta: BN;
  newScore: BN;
  timestamp: BN;
}

// Kingdom Events

export interface KingdomCreatedEvent {
  kingdomId: number;
  kingdomName: string;
  theme: number;
  startTime: BN;
  registrationClosesAt: BN;
  createdBy: Address;
  createdAt: BN;
}

export interface KingdomRegistrationClosedEvent {
  kingdomId: number;
  gameEngine: Address;
  totalPlayers: BN;
  closedAt: BN;
}

export interface PlayerJoinedKingdomEvent {
  kingdomId: number;
  gameEngine: Address;
  player: Address;
  owner: Address;
  joinedAt: BN;
}

export interface KingdomEventCreatedEvent {
  kingdomId: number;
  gameEngine: Address;
  eventId: BN;
  eventType: number;
  startTime: BN;
  endTime: BN;
  prizePool: BN;
}

export interface KingdomArenaSeasonStartedEvent {
  kingdomId: number;
  gameEngine: Address;
  seasonId: number;
  startTime: BN;
  endTime: BN;
  prizePool: BN;
}

export interface KingdomDungeonLeaderboardCreatedEvent {
  kingdomId: number;
  gameEngine: Address;
  dungeonId: number;
  weekNumber: number;
  prizePool: BN;
}

export interface KingdomCitiesInitializedEvent {
  kingdomId: number;
  gameEngine: Address;
  startCityId: number;
  citiesCount: number;
  initializedAt: BN;
}

// Discriminated Union

export type NovusMundusEvent =
  // Combat
  | { name: 'PlayerAttacked'; data: PlayerAttackedEvent }
  | { name: 'EncounterAttacked'; data: EncounterAttackedEvent }
  | { name: 'EncounterDefeated'; data: EncounterDefeatedEvent }
  // Economy
  | { name: 'ResourcesCollected'; data: ResourcesCollectedEvent }
  | { name: 'UnitsHired'; data: UnitsHiredEvent }
  | { name: 'CashTransferred'; data: CashTransferredEvent }
  | { name: 'NoviLocked'; data: NoviLockedEvent }
  | { name: 'EquipmentPurchased'; data: EquipmentPurchasedEvent }
  | { name: 'StaminaPurchased'; data: StaminaPurchasedEvent }
  | { name: 'VaultTransfer'; data: VaultTransferEvent }
  // Team
  | { name: 'TeamCreated'; data: TeamCreatedEvent }
  | { name: 'TeamJoined'; data: TeamJoinedEvent }
  | { name: 'TeamLeft'; data: TeamLeftEvent }
  | { name: 'MemberKicked'; data: MemberKickedEvent }
  | { name: 'LeadershipTransferred'; data: LeadershipTransferredEvent }
  | { name: 'TeamDisbanded'; data: TeamDisbandedEvent }
  | { name: 'TreasuryDeposit'; data: TreasuryDepositEvent }
  | { name: 'TreasuryWithdraw'; data: TreasuryWithdrawEvent }
  | { name: 'MemberRankChanged'; data: MemberRankChangedEvent }
  | { name: 'InviteSent'; data: InviteSentEvent }
  | { name: 'InviteAccepted'; data: InviteAcceptedEvent }
  | { name: 'InviteDeclined'; data: InviteDeclinedEvent }
  | { name: 'InviteCancelled'; data: InviteCancelledEvent }
  | { name: 'MotdUpdated'; data: MotdUpdatedEvent }
  | { name: 'TeamSettingsUpdated'; data: TeamSettingsUpdatedEvent }
  | { name: 'TreasurySettingsUpdated'; data: TreasurySettingsUpdatedEvent }
  | { name: 'TreasuryWithdrawRequested'; data: TreasuryWithdrawRequestedEvent }
  | { name: 'TreasuryRequestApproved'; data: TreasuryRequestApprovedEvent }
  | { name: 'TreasuryRequestRejected'; data: TreasuryRequestRejectedEvent }
  | { name: 'TreasuryRequestExecuted'; data: TreasuryRequestExecutedEvent }
  | { name: 'TreasuryRequestCancelled'; data: TreasuryRequestCancelledEvent }
  // Travel
  | { name: 'IntercityTravelStarted'; data: IntercityTravelStartedEvent }
  | { name: 'IntercityTravelCompleted'; data: IntercityTravelCompletedEvent }
  | { name: 'PlayerTeleported'; data: PlayerTeleportedEvent }
  | { name: 'IntracityTravelStarted'; data: IntracityTravelStartedEvent }
  | { name: 'IntracityTravelCompleted'; data: IntracityTravelCompletedEvent }
  | { name: 'TravelCancelled'; data: TravelCancelledEvent }
  | { name: 'TravelSpeedup'; data: TravelSpeedupEvent }
  // Rally
  | { name: 'RallyCreated'; data: RallyCreatedEvent }
  | { name: 'RallyJoined'; data: RallyJoinedEvent }
  | { name: 'RallyExecuted'; data: RallyExecutedEvent }
  | { name: 'RallyCancelled'; data: RallyCancelledEvent }
  | { name: 'RallyLeft'; data: RallyLeftEvent }
  | { name: 'RallyClosed'; data: RallyClosedEvent }
  | { name: 'RallySpeedup'; data: RallySpeedupEvent }
  | { name: 'RallyParticipantReturned'; data: RallyParticipantReturnedEvent }
  // Reinforcement
  | { name: 'ReinforcementSent'; data: ReinforcementSentEvent }
  | { name: 'ReinforcementArrived'; data: ReinforcementArrivedEvent }
  | { name: 'ReinforcementRecalled'; data: ReinforcementRecalledEvent }
  | { name: 'ReinforcementRelieved'; data: ReinforcementRelievedEvent }
  | { name: 'ReinforcementReturned'; data: ReinforcementReturnedEvent }
  | { name: 'ReinforcementSpeedup'; data: ReinforcementSpeedupEvent }
  // Expedition
  | { name: 'ExpeditionStarted'; data: ExpeditionStartedEvent }
  | { name: 'ExpeditionStrike'; data: ExpeditionStrikeEvent }
  | { name: 'ExpeditionClaimed'; data: ExpeditionClaimedEvent }
  | { name: 'ExpeditionAborted'; data: ExpeditionAbortedEvent }
  | { name: 'ExpeditionSpeedup'; data: ExpeditionSpeedupEvent }
  // Loot
  | { name: 'LootClaimed'; data: LootClaimedEvent }
  | { name: 'EncounterSpawned'; data: EncounterSpawnedEvent }
  // Progression
  | { name: 'DailyRewardClaimed'; data: DailyRewardClaimedEvent }
  | { name: 'SubscriptionPurchased'; data: SubscriptionPurchasedEvent }
  | { name: 'XpGained'; data: XpGainedEvent }
  | { name: 'PlayerLeveledUp'; data: PlayerLeveledUpEvent }
  | { name: 'EventPrizeClaimed'; data: EventPrizeClaimedEvent }
  | { name: 'SubscriptionTierUpdated'; data: SubscriptionTierUpdatedEvent }
  | { name: 'SubscriptionExpired'; data: SubscriptionExpiredEvent }
  // Estate
  | { name: 'EstateCreated'; data: EstateCreatedEvent }
  | { name: 'BuildingStarted'; data: BuildingStartedEvent }
  | { name: 'BuildingCompleted'; data: BuildingCompletedEvent }
  | { name: 'BuildingUpgradeStarted'; data: BuildingUpgradeStartedEvent }
  | { name: 'PlotPurchased'; data: PlotPurchasedEvent }
  | { name: 'EstateDailyClaimed'; data: EstateDailyClaimedEvent }
  // Forge
  | { name: 'CraftStarted'; data: CraftStartedEvent }
  | { name: 'CraftStrike'; data: CraftStrikeEvent }
  | { name: 'CraftCompleted'; data: CraftCompletedEvent }
  | { name: 'CraftAbandoned'; data: CraftAbandonedEvent }
  | { name: 'ItemEquipped'; data: ItemEquippedEvent }
  // Research
  | { name: 'ResearchStarted'; data: ResearchStartedEvent }
  | { name: 'ResearchCompleted'; data: ResearchCompletedEvent }
  | { name: 'ResearchCancelled'; data: ResearchCancelledEvent }
  | { name: 'ResearchSpeedup'; data: ResearchSpeedupEvent }
  | { name: 'ResearchAscended'; data: ResearchAscendedEvent }
  | { name: 'PlayerAscended'; data: PlayerAscendedEvent }
  // Sanctuary
  | { name: 'MeditationStarted'; data: MeditationStartedEvent }
  | { name: 'MeditationClaimed'; data: MeditationClaimedEvent }
  // Hero
  | { name: 'HeroMinted'; data: HeroMintedEvent }
  | { name: 'HeroLocked'; data: HeroLockedEvent }
  | { name: 'HeroUnlocked'; data: HeroUnlockedEvent }
  | { name: 'HeroLeveledUp'; data: HeroLeveledUpEvent }
  | { name: 'HeroAssignedDefensive'; data: HeroAssignedDefensiveEvent }
  | { name: 'HeroBurned'; data: HeroBurnedEvent }
  | { name: 'SupplyCapUpdated'; data: SupplyCapUpdatedEvent }
  // Shop
  | { name: 'ItemPurchased'; data: ItemPurchasedEvent }
  | { name: 'BundlePurchased'; data: BundlePurchasedEvent }
  | { name: 'FlashSalePurchased'; data: FlashSalePurchasedEvent }
  | { name: 'NoviPurchased'; data: NoviPurchasedEvent }
  // Initialization
  | { name: 'PlayerCreated'; data: PlayerCreatedEvent }
  | { name: 'UserCreated'; data: UserCreatedEvent }
  | { name: 'CityInitialized'; data: CityInitializedEvent }
  | { name: 'GameEngineInitialized'; data: GameEngineInitializedEvent }
  // Name
  | { name: 'PlayerNameSet'; data: PlayerNameSetEvent }
  | { name: 'PlayerNameRemoved'; data: PlayerNameRemovedEvent }
  | { name: 'PlayerNameUpdated'; data: PlayerNameUpdatedEvent }
  | { name: 'TeamNameSet'; data: TeamNameSetEvent }
  | { name: 'TeamNameRemoved'; data: TeamNameRemovedEvent }
  | { name: 'TeamNameUpdated'; data: TeamNameUpdatedEvent }
  // Token
  | { name: 'NoviReservedToLocked'; data: NoviReservedToLockedEvent }
  | { name: 'NoviWithdrawn'; data: NoviWithdrawnEvent }
  // Dungeon
  | { name: 'DungeonEntered'; data: DungeonEnteredEvent }
  | { name: 'DungeonRoomCleared'; data: DungeonRoomClearedEvent }
  | { name: 'DungeonFloorCompleted'; data: DungeonFloorCompletedEvent }
  | { name: 'DungeonRelicChosen'; data: DungeonRelicChosenEvent }
  | { name: 'DungeonBossFight'; data: DungeonBossFightEvent }
  | { name: 'DungeonFailed'; data: DungeonFailedEvent }
  | { name: 'DungeonFled'; data: DungeonFledEvent }
  | { name: 'DungeonCompleted'; data: DungeonCompletedEvent }
  | { name: 'DungeonResumed'; data: DungeonResumedEvent }
  | { name: 'DungeonLeaderboardPrizeClaimed'; data: DungeonLeaderboardPrizeClaimedEvent }
  // Castle
  | { name: 'CastleCreated'; data: CastleCreatedEvent }
  | { name: 'CastleClaimed'; data: CastleClaimedEvent }
  | { name: 'CastleConquered'; data: CastleConqueredEvent }
  | { name: 'CastleDefended'; data: CastleDefendedEvent }
  | { name: 'CourtAppointed'; data: CourtAppointedEvent }
  | { name: 'CourtDismissed'; data: CourtDismissedEvent }
  | { name: 'GarrisonJoined'; data: GarrisonJoinedEvent }
  | { name: 'GarrisonLeft'; data: GarrisonLeftEvent }
  | { name: 'GarrisonLootClaimed'; data: GarrisonLootClaimedEvent }
  | { name: 'CastleUpgradeStarted'; data: CastleUpgradeStartedEvent }
  | { name: 'CastleUpgradeCompleted'; data: CastleUpgradeCompletedEvent }
  | { name: 'CastleUpgradeCancelled'; data: CastleUpgradeCancelledEvent }
  | { name: 'CastleRewardsClaimed'; data: CastleRewardsClaimedEvent }
  | { name: 'CastleProtectionExpired'; data: CastleProtectionExpiredEvent }
  | { name: 'KingForceRemoved'; data: KingForceRemovedEvent }
  | { name: 'CastleTransitionProgress'; data: CastleTransitionProgressEvent }
  | { name: 'CastleStatusChanged'; data: CastleStatusChangedEvent }
  | { name: 'CastleAttacked'; data: CastleAttackedEvent }
  // Game Event
  | { name: 'GameEventCreated'; data: GameEventCreatedEvent }
  | { name: 'GameEventJoined'; data: GameEventJoinedEvent }
  | { name: 'GameEventFinalized'; data: GameEventFinalizedEvent }
  | { name: 'EventScoreUpdated'; data: EventScoreUpdatedEvent }
  // Kingdom
  | { name: 'KingdomCreated'; data: KingdomCreatedEvent }
  | { name: 'KingdomRegistrationClosed'; data: KingdomRegistrationClosedEvent }
  | { name: 'PlayerJoinedKingdom'; data: PlayerJoinedKingdomEvent }
  | { name: 'KingdomEventCreated'; data: KingdomEventCreatedEvent }
  | { name: 'KingdomArenaSeasonStarted'; data: KingdomArenaSeasonStartedEvent }
  | { name: 'KingdomDungeonLeaderboardCreated'; data: KingdomDungeonLeaderboardCreatedEvent }
  | { name: 'KingdomCitiesInitialized'; data: KingdomCitiesInitializedEvent };

// Event Name Union

export type EventName = NovusMundusEvent['name'];

/**
 * Event Types
 *
 * TypeScript interfaces for all on-chain events parsed by parser.ts.
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Combat Events

export interface PlayerAttackedEvent {
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
}

export interface EncounterAttackedEvent {
  player: PublicKey;
  playerName: string;
  encounter: PublicKey;
  damageDealt: BN;
  healthRemaining: BN;
  staminaConsumed: number;
  noviConsumed: BN;
  attackerCount: number;
  timestamp: BN;
}

export interface EncounterDefeatedEvent {
  encounter: PublicKey;
  encounterType: number;
  level: number;
  totalAttackers: number;
  killingBlowBy: PublicKey;
  killingBlowName: string;
  /** Immediate kill-bounty cash already added to player.cash_on_hand. */
  lootCash: BN;
  /** LootAccount NOVI awaiting claim. */
  lootNovi: BN;
  /** LootAccount produce (rations). */
  lootProduce: BN;
  /** LootAccount vehicles (drays — transport). */
  lootVehicles: BN;
  /** LootAccount melee weapons (post-split share). */
  lootMelee: BN;
  /** LootAccount ranged weapons (post-split share). */
  lootRanged: BN;
  /** LootAccount siege weapons (post-split share). */
  lootSiege: BN;
  /** LootAccount crafting fragments. */
  lootFragments: BN;
  /** LootAccount raw gems. */
  lootGems: BN;
  timestamp: BN;
}

// Economy Events

export interface ResourcesCollectedEvent {
  player: PublicKey;
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
  player: PublicKey;
  playerName: string;
  unitType: number;
  baseQuantity: BN;
  finalQuantity: BN;
  noviBurned: BN;
  timeBonusBps: number;
  timestamp: BN;
}

export interface CashTransferredEvent {
  from: PublicKey;
  fromName: string;
  to: PublicKey;
  toName: string;
  amount: BN;
  fee: BN;
  timestamp: BN;
}

export interface NoviLockedEvent {
  player: PublicKey;
  playerName: string;
  amount: BN;
  totalLocked: BN;
  timestamp: BN;
}

export interface EquipmentPurchasedEvent {
  player: PublicKey;
  playerName: string;
  slot: number;
  tier: number;
  noviBurned: BN;
  timestamp: BN;
}

export interface StaminaPurchasedEvent {
  player: PublicKey;
  playerName: string;
  stamina: BN;
  gemsSpent: BN;
  timestamp: BN;
}

export interface VaultTransferEvent {
  player: PublicKey;
  playerName: string;
  amount: BN;
  toVault: boolean;
  vaultBalance: BN;
  timestamp: BN;
}

// Team Events

export interface TeamCreatedEvent {
  team: PublicKey;
  teamName: string;
  founder: PublicKey;
  noviBurned: BN;
  timestamp: BN;
}

export interface TeamJoinedEvent {
  team: PublicKey;
  teamName: string;
  player: PublicKey;
  memberCount: number;
  timestamp: BN;
}

export interface TeamLeftEvent {
  team: PublicKey;
  teamName: string;
  player: PublicKey;
  memberCount: number;
  timestamp: BN;
}

export interface MemberKickedEvent {
  team: PublicKey;
  teamName: string;
  kicked: PublicKey;
  kickedBy: PublicKey;
  timestamp: BN;
}

export interface LeadershipTransferredEvent {
  team: PublicKey;
  teamName: string;
  oldLeader: PublicKey;
  newLeader: PublicKey;
  timestamp: BN;
}

export interface TeamDisbandedEvent {
  team: PublicKey;
  teamName: string;
  leader: PublicKey;
  treasuryDistributed: BN;
  timestamp: BN;
}

export interface TreasuryDepositEvent {
  team: PublicKey;
  teamName: string;
  depositor: PublicKey;
  amount: BN;
  newBalance: BN;
  timestamp: BN;
}

export interface TreasuryWithdrawEvent {
  team: PublicKey;
  teamName: string;
  withdrawer: PublicKey;
  amount: BN;
  newBalance: BN;
  timestamp: BN;
}

export interface MemberRankChangedEvent {
  team: PublicKey;
  teamName: string;
  member: PublicKey;
  oldRank: number;
  newRank: number;
  changedBy: PublicKey;
  timestamp: BN;
}

export interface InviteSentEvent {
  team: PublicKey;
  teamName: string;
  invitee: PublicKey;
  inviter: PublicKey;
  timestamp: BN;
}

export interface InviteAcceptedEvent {
  team: PublicKey;
  teamName: string;
  player: PublicKey;
  memberCount: number;
  timestamp: BN;
}

export interface InviteDeclinedEvent {
  team: PublicKey;
  teamName: string;
  player: PublicKey;
  timestamp: BN;
}

export interface InviteCancelledEvent {
  team: PublicKey;
  teamName: string;
  invitee: PublicKey;
  cancelledBy: PublicKey;
  timestamp: BN;
}

export interface MotdUpdatedEvent {
  team: PublicKey;
  teamName: string;
  updatedBy: PublicKey;
  timestamp: BN;
}

export interface TeamSettingsUpdatedEvent {
  team: PublicKey;
  teamName: string;
  updatedBy: PublicKey;
  timestamp: BN;
}

export interface TreasurySettingsUpdatedEvent {
  team: PublicKey;
  teamName: string;
  updatedBy: PublicKey;
  timestamp: BN;
}

export interface TreasuryWithdrawRequestedEvent {
  team: PublicKey;
  teamName: string;
  requester: PublicKey;
  amount: BN;
  timestamp: BN;
}

export interface TreasuryRequestApprovedEvent {
  team: PublicKey;
  teamName: string;
  approver: PublicKey;
  requester: PublicKey;
  timestamp: BN;
}

export interface TreasuryRequestRejectedEvent {
  team: PublicKey;
  teamName: string;
  rejector: PublicKey;
  requester: PublicKey;
  timestamp: BN;
}

export interface TreasuryRequestExecutedEvent {
  team: PublicKey;
  teamName: string;
  executor: PublicKey;
  requester: PublicKey;
  amount: BN;
  newBalance: BN;
  timestamp: BN;
}

export interface TreasuryRequestCancelledEvent {
  team: PublicKey;
  teamName: string;
  requester: PublicKey;
  timestamp: BN;
}

// Travel Events

export interface IntercityTravelStartedEvent {
  player: PublicKey;
  playerName: string;
  fromCity: PublicKey;
  toCity: PublicKey;
  arrivalAt: BN;
  timestamp: BN;
}

export interface IntercityTravelCompletedEvent {
  player: PublicKey;
  playerName: string;
  city: PublicKey;
  timestamp: BN;
}

export interface PlayerTeleportedEvent {
  player: PublicKey;
  playerName: string;
  fromCity: PublicKey;
  toCity: PublicKey;
  gemsSpent: BN;
  timestamp: BN;
}

export interface IntracityTravelStartedEvent {
  player: PublicKey;
  playerName: string;
  city: PublicKey;
  destX: number;
  destY: number;
  arrivalAt: BN;
  timestamp: BN;
}

export interface IntracityTravelCompletedEvent {
  player: PublicKey;
  playerName: string;
  x: number;
  y: number;
  timestamp: BN;
}

export interface TravelCancelledEvent {
  player: PublicKey;
  playerName: string;
  isIntercity: boolean;
  wasBumped: boolean;
  timestamp: BN;
}

export interface TravelSpeedupEvent {
  player: PublicKey;
  playerName: string;
  isIntercity: boolean;
  speedupTier: number;
  gemsSpent: BN;
  newEta: BN;
  timestamp: BN;
}

// Rally Events

export interface RallyCreatedEvent {
  rally: PublicKey;
  team: PublicKey;
  teamName: string;
  leader: PublicKey;
  target: PublicKey;
  gatherAt: BN;
  timestamp: BN;
}

export interface RallyJoinedEvent {
  rally: PublicKey;
  teamName: string;
  player: PublicKey;
  units: [BN, BN, BN];
  participantCount: number;
  timestamp: BN;
}

export interface RallyExecutedEvent {
  rally: PublicKey;
  teamName: string;
  target: PublicKey;
  damageDealt: BN;
  damageReceived: BN;
  lootCaptured: BN;
  participantCount: number;
  timestamp: BN;
}

export interface RallyCancelledEvent {
  rally: PublicKey;
  teamName: string;
  cancelledBy: PublicKey;
  timestamp: BN;
}

export interface RallyLeftEvent {
  rally: PublicKey;
  teamName: string;
  player: PublicKey;
  units: [BN, BN, BN];
  participantCount: number;
  timestamp: BN;
}

export interface RallyClosedEvent {
  rally: PublicKey;
  rallyId: BN;
  teamName: string;
  leader: PublicKey;
  timestamp: BN;
}

export interface RallySpeedupEvent {
  rally: PublicKey;
  teamName: string;
  payer: PublicKey;
  speedupType: number;
  gemsSpent: BN;
  timestamp: BN;
}

export interface RallyParticipantReturnedEvent {
  rally: PublicKey;
  teamName: string;
  player: PublicKey;
  participatedInCombat: boolean;
  unitsReturned: [BN, BN, BN];
  lootReceived: BN;
  timestamp: BN;
}

// Reinforcement Events

export interface ReinforcementSentEvent {
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  receiverName: string;
  units: [BN, BN, BN];
  arrivesAt: BN;
  timestamp: BN;
}

export interface ReinforcementArrivedEvent {
  reinforcement: PublicKey;
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  receiverName: string;
  units: [BN, BN, BN];
  timestamp: BN;
}

export interface ReinforcementRecalledEvent {
  reinforcement: PublicKey;
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  receiverName: string;
  units: [BN, BN, BN];
  timestamp: BN;
}

export interface ReinforcementRelievedEvent {
  reinforcement: PublicKey;
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  receiverName: string;
  units: [BN, BN, BN];
  timestamp: BN;
}

export interface ReinforcementReturnedEvent {
  sender: PublicKey;
  senderName: string;
  units: [BN, BN, BN];
  timestamp: BN;
}

export interface ReinforcementSpeedupEvent {
  reinforcement: PublicKey;
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  speedupType: number;
  gemsSpent: BN;
  newEta: BN;
  timestamp: BN;
}

// Expedition Events

export interface ExpeditionStartedEvent {
  player: PublicKey;
  playerName: string;
  expeditionType: number;
  nodeId: number;
  duration: number;
  timestamp: BN;
}

export interface ExpeditionStrikeEvent {
  player: PublicKey;
  playerName: string;
  strikeNum: number;
  yieldAmount: BN;
  quality: number;
  timestamp: BN;
}

export interface ExpeditionClaimedEvent {
  player: PublicKey;
  playerName: string;
  expeditionType: number;
  totalYield: BN;
  bonusYield: BN;
  xpEarned: BN;
  timestamp: BN;
}

export interface ExpeditionAbortedEvent {
  player: PublicKey;
  playerName: string;
  expeditionType: number;
  partialYield: BN;
  timestamp: BN;
}

export interface ExpeditionSpeedupEvent {
  player: PublicKey;
  playerName: string;
  speedupSeconds: BN;
  gemsSpent: BN;
  newEta: BN;
  timestamp: BN;
}

// Loot Events

export interface LootClaimedEvent {
  player: PublicKey;
  playerName: string;
  cash: BN;
  items: [number, number, number, number];
  timestamp: BN;
}

export interface EncounterSpawnedEvent {
  encounter: PublicKey;
  city: PublicKey;
  encounterType: number;
  level: number;
  x: number;
  y: number;
  timestamp: BN;
}

// Progression Events

export interface DailyRewardClaimedEvent {
  player: PublicKey;
  playerName: string;
  cash: BN;
  timestamp: BN;
}

export interface SubscriptionPurchasedEvent {
  player: PublicKey;
  playerName: string;
  tier: number;
  durationDays: number;
  noviPaid: BN;
  expiresAt: BN;
  timestamp: BN;
}

export interface XpGainedEvent {
  player: PublicKey;
  playerName: string;
  amount: BN;
  source: number;
  totalXp: BN;
  timestamp: BN;
}

export interface PlayerLeveledUpEvent {
  player: PublicKey;
  playerName: string;
  oldLevel: number;
  newLevel: number;
  timestamp: BN;
}

export interface EventPrizeClaimedEvent {
  player: PublicKey;
  playerName: string;
  event: PublicKey;
  rank: number;
  prizeAmount: BN;
  timestamp: BN;
}

export interface SubscriptionTierUpdatedEvent {
  player: PublicKey;
  playerName: string;
  oldTier: number;
  newTier: number;
  expiresAt: BN;
  timestamp: BN;
}

export interface SubscriptionExpiredEvent {
  player: PublicKey;
  playerName: string;
  oldTier: number;
  timestamp: BN;
}

// Estate Events

export interface EstateCreatedEvent {
  estate: PublicKey;
  player: PublicKey;
  playerName: string;
  timestamp: BN;
}

export interface BuildingStartedEvent {
  player: PublicKey;
  playerName: string;
  buildingType: number;
  plot: number;
  completesAt: BN;
  timestamp: BN;
}

export interface BuildingCompletedEvent {
  player: PublicKey;
  playerName: string;
  buildingType: number;
  level: number;
  plot: number;
  timestamp: BN;
}

export interface BuildingUpgradeStartedEvent {
  player: PublicKey;
  playerName: string;
  buildingType: number;
  fromLevel: number;
  toLevel: number;
  completesAt: BN;
  timestamp: BN;
}

export interface PlotPurchasedEvent {
  player: PublicKey;
  playerName: string;
  plot: number;
  cost: BN;
  totalPlots: number;
  timestamp: BN;
}

export interface EstateDailyClaimedEvent {
  player: PublicKey;
  playerName: string;
  materials: BN;
  streak: number;
  timestamp: BN;
}

// Forge Events

export interface CraftStartedEvent {
  player: PublicKey;
  playerName: string;
  itemType: number;
  qualityTier: number;
  materialsUsed: BN;
  timestamp: BN;
}

export interface CraftStrikeEvent {
  player: PublicKey;
  playerName: string;
  stage: number;
  quality: number;
  score: number;
  timestamp: BN;
}

export interface CraftCompletedEvent {
  player: PublicKey;
  playerName: string;
  itemType: number;
  quality: number;
  score: number;
  inventorySlot: number;
  timestamp: BN;
}

export interface CraftAbandonedEvent {
  player: PublicKey;
  playerName: string;
  itemType: number;
  stageReached: number;
  timestamp: BN;
}

export interface ItemEquippedEvent {
  player: PublicKey;
  playerName: string;
  heroMint: PublicKey;
  heroName: string;
  slot: number;
  quality: number;
  fromInventory: number;
  timestamp: BN;
}

// Research Events

export interface ResearchStartedEvent {
  player: PublicKey;
  playerName: string;
  researchId: number;
  level: number;
  completesAt: BN;
  timestamp: BN;
}

export interface ResearchCompletedEvent {
  player: PublicKey;
  playerName: string;
  researchId: number;
  level: number;
  timestamp: BN;
}

export interface ResearchCancelledEvent {
  player: PublicKey;
  playerName: string;
  researchId: number;
  timestamp: BN;
}

export interface ResearchSpeedupEvent {
  player: PublicKey;
  playerName: string;
  researchId: number;
  speedupSeconds: BN;
  gemsSpent: BN;
  newEta: BN;
  timestamp: BN;
}

export interface ResearchAscendedEvent {
  player: PublicKey;
  playerName: string;
  researchTree: number;
  newAscensionLevel: number;
  masteryCost: number;
  timestamp: BN;
}

export interface PlayerAscendedEvent {
  player: PublicKey;
  playerName: string;
  ascensionLevel: number;
  masteryGained: number;
  timestamp: BN;
}

// Sanctuary Events

export interface MeditationStartedEvent {
  player: PublicKey;
  playerName: string;
  heroMint: PublicKey;
  heroName: string;
  durationHours: number;
  completesAt: BN;
  timestamp: BN;
}

export interface MeditationClaimedEvent {
  player: PublicKey;
  playerName: string;
  heroMint: PublicKey;
  heroName: string;
  xpEarned: number;
  levelsGained: number;
  timestamp: BN;
}

// Hero Events

export interface HeroMintedEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  templateId: number;
  rarity: number;
  timestamp: BN;
}

export interface HeroLockedEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  slot: number;
  timestamp: BN;
}

export interface HeroUnlockedEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  timestamp: BN;
}

export interface HeroLeveledUpEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  oldLevel: number;
  newLevel: number;
  xpSpent: BN;
  timestamp: BN;
}

export interface HeroAssignedDefensiveEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  assigned: boolean;
  timestamp: BN;
}

export interface HeroBurnedEvent {
  heroMint: PublicKey;
  player: PublicKey;
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
  player: PublicKey;
  playerName: string;
  itemId: number;
  quantity: number;
  price: BN;
  currency: number;
  timestamp: BN;
}

export interface BundlePurchasedEvent {
  player: PublicKey;
  playerName: string;
  bundleId: number;
  price: BN;
  currency: number;
  timestamp: BN;
}

export interface FlashSalePurchasedEvent {
  player: PublicKey;
  playerName: string;
  saleId: BN;
  originalPrice: BN;
  pricePaid: BN;
  currency: number;
  timestamp: BN;
}

export interface NoviPurchasedEvent {
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
}

// Initialization Events

export interface PlayerCreatedEvent {
  player: PublicKey;
  user: PublicKey;
  city: PublicKey;
  timestamp: BN;
}

export interface UserCreatedEvent {
  user: PublicKey;
  wallet: PublicKey;
  timestamp: BN;
}

export interface CityInitializedEvent {
  city: PublicKey;
  cityIndex: number;
  timestamp: BN;
}

export interface GameEngineInitializedEvent {
  gameEngine: PublicKey;
  authority: PublicKey;
  timestamp: BN;
}

// Name Events

export interface PlayerNameSetEvent {
  player: PublicKey;
  playerName: string;
  domainHash: Uint8Array;
  timestamp: BN;
}

export interface PlayerNameRemovedEvent {
  player: PublicKey;
  playerName: string;
  timestamp: BN;
}

export interface PlayerNameUpdatedEvent {
  player: PublicKey;
  oldName: string;
  newName: string;
  newDomainHash: Uint8Array;
  timestamp: BN;
}

export interface TeamNameSetEvent {
  team: PublicKey;
  teamName: string;
  domainHash: Uint8Array;
  timestamp: BN;
}

export interface TeamNameRemovedEvent {
  team: PublicKey;
  teamName: string;
  timestamp: BN;
}

export interface TeamNameUpdatedEvent {
  team: PublicKey;
  oldName: string;
  newName: string;
  newDomainHash: Uint8Array;
  timestamp: BN;
}

// Token Events

export interface NoviReservedToLockedEvent {
  player: PublicKey;
  playerName: string;
  amount: BN;
  newLocked: BN;
  remainingReserved: BN;
  timestamp: BN;
}

export interface NoviWithdrawnEvent {
  player: PublicKey;
  playerName: string;
  amount: BN;
  remainingReserved: BN;
  timestamp: BN;
}

// Dungeon Events

export interface DungeonEnteredEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  heroMint: PublicKey;
  heroName: string;
  staminaSpent: number;
  timestamp: BN;
}

export interface DungeonRoomClearedEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  room: number;
  xpGained: BN;
  timestamp: BN;
}

export interface DungeonFloorCompletedEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  noviGained: BN;
  isCheckpoint: boolean;
  timestamp: BN;
}

export interface DungeonRelicChosenEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  relicId: number;
  totalRelics: number;
  timestamp: BN;
}

export interface DungeonBossFightEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  bossPower: number;
  bossHealth: BN;
  timestamp: BN;
}

export interface DungeonFailedEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  room: number;
  enemiesKilled: number;
  timestamp: BN;
}

export interface DungeonFledEvent {
  player: PublicKey;
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
  player: PublicKey;
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
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  checkpointFloor: number;
  resumeFloor: number;
  gemCost: BN;
  resumeCount: number;
  timestamp: BN;
}

export interface DungeonLeaderboardPrizeClaimedEvent {
  player: PublicKey;
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
  castle: PublicKey;
  castleName: string;
  cityId: number;
  castleId: number;
  tier: number;
  timestamp: BN;
}

export interface CastleClaimedEvent {
  castle: PublicKey;
  castleName: string;
  king: PublicKey;
  kingName: string;
  team: PublicKey;
  tier: number;
  timestamp: BN;
}

export interface CastleConqueredEvent {
  castle: PublicKey;
  castleName: string;
  previousKing: PublicKey;
  newKing: PublicKey;
  newKingName: string;
  newTeam: PublicKey;
  rallyId: BN;
  timestamp: BN;
}

export interface CastleDefendedEvent {
  castle: PublicKey;
  castleName: string;
  king: PublicKey;
  rallyId: BN;
  damageDealt: BN;
  weaponsCaptured: BN;
  timestamp: BN;
}

export interface CourtAppointedEvent {
  castle: PublicKey;
  castleName: string;
  appointee: PublicKey;
  appointeeName: string;
  positionType: number;
  appointedBy: PublicKey;
  timestamp: BN;
}

export interface CourtDismissedEvent {
  castle: PublicKey;
  castleName: string;
  dismissed: PublicKey;
  dismissedName: string;
  positionType: number;
  dismissedBy: PublicKey;
  resigned: boolean;
  timestamp: BN;
}

export interface GarrisonJoinedEvent {
  castle: PublicKey;
  castleName: string;
  contributor: PublicKey;
  contributorName: string;
  units1: BN;
  units2: BN;
  units3: BN;
  weapons: BN;
  heroMint: PublicKey;
  garrisonCount: number;
  timestamp: BN;
}

export interface GarrisonLeftEvent {
  castle: PublicKey;
  castleName: string;
  contributor: PublicKey;
  contributorName: string;
  units1: BN;
  units2: BN;
  units3: BN;
  weapons: BN;
  heroMint: PublicKey;
  relieved: boolean;
  garrisonCount: number;
  timestamp: BN;
}

export interface GarrisonLootClaimedEvent {
  castle: PublicKey;
  castleName: string;
  claimer: PublicKey;
  claimerName: string;
  melee: BN;
  ranged: BN;
  siege: BN;
  timestamp: BN;
}

export interface CastleUpgradeStartedEvent {
  castle: PublicKey;
  castleName: string;
  king: PublicKey;
  upgradeType: number;
  currentLevel: number;
  targetLevel: number;
  noviCost: BN;
  completesAt: BN;
  timestamp: BN;
}

export interface CastleUpgradeCompletedEvent {
  castle: PublicKey;
  castleName: string;
  upgradeType: number;
  newLevel: number;
  timestamp: BN;
}

export interface CastleUpgradeCancelledEvent {
  castle: PublicKey;
  castleName: string;
  upgradeType: number;
  noviRefunded: BN;
  timestamp: BN;
}

export interface CastleRewardsClaimedEvent {
  castle: PublicKey;
  castleName: string;
  claimer: PublicKey;
  claimerName: string;
  role: number;
  days: number;
  novi: BN;
  cash: BN;
  timestamp: BN;
}

export interface CastleProtectionExpiredEvent {
  castle: PublicKey;
  castleName: string;
  king: PublicKey;
  timestamp: BN;
}

export interface KingForceRemovedEvent {
  castle: PublicKey;
  castleName: string;
  removedKing: PublicKey;
  removedKingName: string;
  timestamp: BN;
}

export interface CastleTransitionProgressEvent {
  castle: PublicKey;
  phase: number;
  cleanedCount: number;
  totalCount: number;
  timestamp: BN;
}

export interface CastleStatusChangedEvent {
  castle: PublicKey;
  castleName: string;
  oldStatus: number;
  newStatus: number;
  timestamp: BN;
}

export interface CastleAttackedEvent {
  castle: PublicKey;
  castleName: string;
  attacker: PublicKey;
  attackerName: string;
  king: PublicKey;
  damageDealt: BN;
  damageReceived: BN;
  attackerCasualties: BN;
  garrisonCasualties: BN;
  attackerWon: boolean;
  timestamp: BN;
}

// Game Event Events

export interface GameEventCreatedEvent {
  event: PublicKey;
  eventType: number;
  startTime: BN;
  endTime: BN;
  prizePool: BN;
  timestamp: BN;
}

export interface GameEventJoinedEvent {
  event: PublicKey;
  player: PublicKey;
  playerName: string;
  entryFee: BN;
  participantCount: number;
  timestamp: BN;
}

export interface GameEventFinalizedEvent {
  event: PublicKey;
  totalParticipants: number;
  totalPrizes: BN;
  timestamp: BN;
}

export interface EventScoreUpdatedEvent {
  event: PublicKey;
  player: PublicKey;
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
  createdBy: PublicKey;
  createdAt: BN;
}

export interface KingdomRegistrationClosedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  totalPlayers: BN;
  closedAt: BN;
}

export interface PlayerJoinedKingdomEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  player: PublicKey;
  owner: PublicKey;
  joinedAt: BN;
}

export interface KingdomEventCreatedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  eventId: BN;
  eventType: number;
  startTime: BN;
  endTime: BN;
  prizePool: BN;
}

export interface KingdomArenaSeasonStartedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  seasonId: number;
  startTime: BN;
  endTime: BN;
  prizePool: BN;
}

export interface KingdomDungeonLeaderboardCreatedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  dungeonId: number;
  weekNumber: number;
  prizePool: BN;
}

export interface KingdomCitiesInitializedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
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

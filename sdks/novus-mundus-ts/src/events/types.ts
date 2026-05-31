/**
 * Event Types
 *
 * TypeScript interfaces for all on-chain events parsed by parser.ts.
 */

import { PublicKey } from '@solana/web3.js';

// Combat Events

export interface PlayerAttackedEvent {
  attacker: PublicKey;
  attackerName: string;
  defender: PublicKey;
  defenderName: string;
  damageDealt: bigint;
  damageReceived: bigint;
  cashStolen: bigint;
  armorStolen: bigint;
  produceStolen: bigint;
  vehiclesStolen: bigint;
  attackerUnitsLost: [bigint, bigint, bigint];
  defenderUnitsLost: [bigint, bigint, bigint];
  attackerWon: boolean;
  driveBy: boolean;
  timestamp: bigint;
}

export interface EncounterAttackedEvent {
  player: PublicKey;
  playerName: string;
  encounter: PublicKey;
  damageDealt: bigint;
  healthRemaining: bigint;
  staminaConsumed: number;
  noviConsumed: bigint;
  attackerCount: number;
  timestamp: bigint;
}

export interface EncounterDefeatedEvent {
  encounter: PublicKey;
  encounterType: number;
  level: number;
  totalAttackers: number;
  killingBlowBy: PublicKey;
  killingBlowName: string;
  /** Immediate kill-bounty cash already added to player.cash_on_hand. */
  lootCash: bigint;
  /** LootAccount NOVI awaiting claim. */
  lootNovi: bigint;
  /** LootAccount produce (rations). */
  lootProduce: bigint;
  /** LootAccount vehicles (drays — transport). */
  lootVehicles: bigint;
  /** LootAccount melee weapons (post-split share). */
  lootMelee: bigint;
  /** LootAccount ranged weapons (post-split share). */
  lootRanged: bigint;
  /** LootAccount siege weapons (post-split share). */
  lootSiege: bigint;
  /** LootAccount crafting fragments. */
  lootFragments: bigint;
  /** LootAccount raw gems. */
  lootGems: bigint;
  timestamp: bigint;
}

// Economy Events

export interface ResourcesCollectedEvent {
  player: PublicKey;
  playerName: string;
  collectionType: number;
  noviConsumed: bigint;
  baseOutput: bigint;
  finalOutput: bigint;
  gemsEarned: bigint;
  fragmentsEarned: bigint;
  xpGained: bigint;
  timestamp: bigint;
}

export interface UnitsHiredEvent {
  player: PublicKey;
  playerName: string;
  unitType: number;
  baseQuantity: bigint;
  finalQuantity: bigint;
  noviBurned: bigint;
  timeBonusBps: number;
  timestamp: bigint;
}

export interface CashTransferredEvent {
  from: PublicKey;
  fromName: string;
  to: PublicKey;
  toName: string;
  amount: bigint;
  fee: bigint;
  timestamp: bigint;
}

export interface NoviLockedEvent {
  player: PublicKey;
  playerName: string;
  amount: bigint;
  totalLocked: bigint;
  timestamp: bigint;
}

export interface EquipmentPurchasedEvent {
  player: PublicKey;
  playerName: string;
  slot: number;
  tier: number;
  noviBurned: bigint;
  timestamp: bigint;
}

export interface StaminaPurchasedEvent {
  player: PublicKey;
  playerName: string;
  stamina: bigint;
  gemsSpent: bigint;
  timestamp: bigint;
}

export interface VaultTransferEvent {
  player: PublicKey;
  playerName: string;
  amount: bigint;
  toVault: boolean;
  vaultBalance: bigint;
  timestamp: bigint;
}

// Team Events

export interface TeamCreatedEvent {
  team: PublicKey;
  teamName: string;
  founder: PublicKey;
  noviBurned: bigint;
  timestamp: bigint;
}

export interface TeamJoinedEvent {
  team: PublicKey;
  teamName: string;
  player: PublicKey;
  memberCount: number;
  timestamp: bigint;
}

export interface TeamLeftEvent {
  team: PublicKey;
  teamName: string;
  player: PublicKey;
  memberCount: number;
  timestamp: bigint;
}

export interface MemberKickedEvent {
  team: PublicKey;
  teamName: string;
  kicked: PublicKey;
  kickedBy: PublicKey;
  timestamp: bigint;
}

export interface LeadershipTransferredEvent {
  team: PublicKey;
  teamName: string;
  oldLeader: PublicKey;
  newLeader: PublicKey;
  timestamp: bigint;
}

export interface TeamDisbandedEvent {
  team: PublicKey;
  teamName: string;
  leader: PublicKey;
  treasuryDistributed: bigint;
  timestamp: bigint;
}

export interface TreasuryDepositEvent {
  team: PublicKey;
  teamName: string;
  depositor: PublicKey;
  amount: bigint;
  newBalance: bigint;
  timestamp: bigint;
}

export interface TreasuryWithdrawEvent {
  team: PublicKey;
  teamName: string;
  withdrawer: PublicKey;
  amount: bigint;
  newBalance: bigint;
  timestamp: bigint;
}

export interface MemberRankChangedEvent {
  team: PublicKey;
  teamName: string;
  member: PublicKey;
  oldRank: number;
  newRank: number;
  changedBy: PublicKey;
  timestamp: bigint;
}

export interface InviteSentEvent {
  team: PublicKey;
  teamName: string;
  invitee: PublicKey;
  inviter: PublicKey;
  timestamp: bigint;
}

export interface InviteAcceptedEvent {
  team: PublicKey;
  teamName: string;
  player: PublicKey;
  memberCount: number;
  timestamp: bigint;
}

export interface InviteDeclinedEvent {
  team: PublicKey;
  teamName: string;
  player: PublicKey;
  timestamp: bigint;
}

export interface InviteCancelledEvent {
  team: PublicKey;
  teamName: string;
  invitee: PublicKey;
  cancelledBy: PublicKey;
  timestamp: bigint;
}

export interface MotdUpdatedEvent {
  team: PublicKey;
  teamName: string;
  updatedBy: PublicKey;
  timestamp: bigint;
}

export interface TeamSettingsUpdatedEvent {
  team: PublicKey;
  teamName: string;
  updatedBy: PublicKey;
  timestamp: bigint;
}

export interface TreasurySettingsUpdatedEvent {
  team: PublicKey;
  teamName: string;
  updatedBy: PublicKey;
  timestamp: bigint;
}

export interface TreasuryWithdrawRequestedEvent {
  team: PublicKey;
  teamName: string;
  requester: PublicKey;
  amount: bigint;
  timestamp: bigint;
}

export interface TreasuryRequestApprovedEvent {
  team: PublicKey;
  teamName: string;
  approver: PublicKey;
  requester: PublicKey;
  timestamp: bigint;
}

export interface TreasuryRequestRejectedEvent {
  team: PublicKey;
  teamName: string;
  rejector: PublicKey;
  requester: PublicKey;
  timestamp: bigint;
}

export interface TreasuryRequestExecutedEvent {
  team: PublicKey;
  teamName: string;
  executor: PublicKey;
  requester: PublicKey;
  amount: bigint;
  newBalance: bigint;
  timestamp: bigint;
}

export interface TreasuryRequestCancelledEvent {
  team: PublicKey;
  teamName: string;
  requester: PublicKey;
  timestamp: bigint;
}

// Travel Events

export interface IntercityTravelStartedEvent {
  player: PublicKey;
  playerName: string;
  fromCity: PublicKey;
  toCity: PublicKey;
  arrivalAt: bigint;
  timestamp: bigint;
}

export interface IntercityTravelCompletedEvent {
  player: PublicKey;
  playerName: string;
  city: PublicKey;
  timestamp: bigint;
}

export interface PlayerTeleportedEvent {
  player: PublicKey;
  playerName: string;
  fromCity: PublicKey;
  toCity: PublicKey;
  gemsSpent: bigint;
  timestamp: bigint;
}

export interface IntracityTravelStartedEvent {
  player: PublicKey;
  playerName: string;
  city: PublicKey;
  destX: number;
  destY: number;
  arrivalAt: bigint;
  timestamp: bigint;
}

export interface IntracityTravelCompletedEvent {
  player: PublicKey;
  playerName: string;
  x: number;
  y: number;
  timestamp: bigint;
}

export interface TravelCancelledEvent {
  player: PublicKey;
  playerName: string;
  isIntercity: boolean;
  wasBumped: boolean;
  timestamp: bigint;
}

export interface TravelSpeedupEvent {
  player: PublicKey;
  playerName: string;
  isIntercity: boolean;
  speedupTier: number;
  gemsSpent: bigint;
  newEta: bigint;
  timestamp: bigint;
}

// Rally Events

export interface RallyCreatedEvent {
  rally: PublicKey;
  team: PublicKey;
  teamName: string;
  leader: PublicKey;
  target: PublicKey;
  gatherAt: bigint;
  timestamp: bigint;
}

export interface RallyJoinedEvent {
  rally: PublicKey;
  teamName: string;
  player: PublicKey;
  units: [bigint, bigint, bigint];
  participantCount: number;
  timestamp: bigint;
}

export interface RallyExecutedEvent {
  rally: PublicKey;
  teamName: string;
  target: PublicKey;
  damageDealt: bigint;
  damageReceived: bigint;
  lootCaptured: bigint;
  participantCount: number;
  timestamp: bigint;
}

export interface RallyCancelledEvent {
  rally: PublicKey;
  teamName: string;
  cancelledBy: PublicKey;
  timestamp: bigint;
}

export interface RallyLeftEvent {
  rally: PublicKey;
  teamName: string;
  player: PublicKey;
  units: [bigint, bigint, bigint];
  participantCount: number;
  timestamp: bigint;
}

export interface RallyClosedEvent {
  rally: PublicKey;
  rallyId: bigint;
  teamName: string;
  leader: PublicKey;
  timestamp: bigint;
}

export interface RallySpeedupEvent {
  rally: PublicKey;
  teamName: string;
  payer: PublicKey;
  speedupType: number;
  gemsSpent: bigint;
  timestamp: bigint;
}

export interface RallyParticipantReturnedEvent {
  rally: PublicKey;
  teamName: string;
  player: PublicKey;
  participatedInCombat: boolean;
  unitsReturned: [bigint, bigint, bigint];
  lootReceived: bigint;
  timestamp: bigint;
}

// Reinforcement Events

export interface ReinforcementSentEvent {
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  receiverName: string;
  units: [bigint, bigint, bigint];
  arrivesAt: bigint;
  timestamp: bigint;
}

export interface ReinforcementArrivedEvent {
  reinforcement: PublicKey;
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  receiverName: string;
  units: [bigint, bigint, bigint];
  timestamp: bigint;
}

export interface ReinforcementRecalledEvent {
  reinforcement: PublicKey;
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  receiverName: string;
  units: [bigint, bigint, bigint];
  timestamp: bigint;
}

export interface ReinforcementRelievedEvent {
  reinforcement: PublicKey;
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  receiverName: string;
  units: [bigint, bigint, bigint];
  timestamp: bigint;
}

export interface ReinforcementReturnedEvent {
  sender: PublicKey;
  senderName: string;
  units: [bigint, bigint, bigint];
  timestamp: bigint;
}

export interface ReinforcementSpeedupEvent {
  reinforcement: PublicKey;
  sender: PublicKey;
  senderName: string;
  receiver: PublicKey;
  speedupType: number;
  gemsSpent: bigint;
  newEta: bigint;
  timestamp: bigint;
}

// Expedition Events

export interface ExpeditionStartedEvent {
  player: PublicKey;
  playerName: string;
  expeditionType: number;
  nodeId: number;
  duration: number;
  timestamp: bigint;
}

export interface ExpeditionStrikeEvent {
  player: PublicKey;
  playerName: string;
  strikeNum: number;
  yieldAmount: bigint;
  quality: number;
  timestamp: bigint;
}

export interface ExpeditionClaimedEvent {
  player: PublicKey;
  playerName: string;
  expeditionType: number;
  totalYield: bigint;
  bonusYield: bigint;
  xpEarned: bigint;
  timestamp: bigint;
}

export interface ExpeditionAbortedEvent {
  player: PublicKey;
  playerName: string;
  expeditionType: number;
  partialYield: bigint;
  timestamp: bigint;
}

export interface ExpeditionSpeedupEvent {
  player: PublicKey;
  playerName: string;
  speedupSeconds: bigint;
  gemsSpent: bigint;
  newEta: bigint;
  timestamp: bigint;
}

// Loot Events

export interface LootClaimedEvent {
  player: PublicKey;
  playerName: string;
  cash: bigint;
  items: [number, number, number, number];
  timestamp: bigint;
}

export interface EncounterSpawnedEvent {
  encounter: PublicKey;
  city: PublicKey;
  encounterType: number;
  level: number;
  x: number;
  y: number;
  timestamp: bigint;
}

// Progression Events

export interface DailyRewardClaimedEvent {
  player: PublicKey;
  playerName: string;
  cash: bigint;
  timestamp: bigint;
}

export interface SubscriptionPurchasedEvent {
  player: PublicKey;
  playerName: string;
  tier: number;
  durationDays: number;
  noviPaid: bigint;
  expiresAt: bigint;
  timestamp: bigint;
}

export interface XpGainedEvent {
  player: PublicKey;
  playerName: string;
  amount: bigint;
  source: number;
  totalXp: bigint;
  timestamp: bigint;
}

export interface PlayerLeveledUpEvent {
  player: PublicKey;
  playerName: string;
  oldLevel: number;
  newLevel: number;
  timestamp: bigint;
}

export interface EventPrizeClaimedEvent {
  player: PublicKey;
  playerName: string;
  event: PublicKey;
  rank: number;
  prizeAmount: bigint;
  timestamp: bigint;
}

export interface SubscriptionTierUpdatedEvent {
  player: PublicKey;
  playerName: string;
  oldTier: number;
  newTier: number;
  expiresAt: bigint;
  timestamp: bigint;
}

export interface SubscriptionExpiredEvent {
  player: PublicKey;
  playerName: string;
  oldTier: number;
  timestamp: bigint;
}

// Estate Events

export interface EstateCreatedEvent {
  estate: PublicKey;
  player: PublicKey;
  playerName: string;
  timestamp: bigint;
}

export interface BuildingStartedEvent {
  player: PublicKey;
  playerName: string;
  buildingType: number;
  plot: number;
  completesAt: bigint;
  timestamp: bigint;
}

export interface BuildingCompletedEvent {
  player: PublicKey;
  playerName: string;
  buildingType: number;
  level: number;
  plot: number;
  timestamp: bigint;
}

export interface BuildingUpgradeStartedEvent {
  player: PublicKey;
  playerName: string;
  buildingType: number;
  fromLevel: number;
  toLevel: number;
  completesAt: bigint;
  timestamp: bigint;
}

export interface PlotPurchasedEvent {
  player: PublicKey;
  playerName: string;
  plot: number;
  cost: bigint;
  totalPlots: number;
  timestamp: bigint;
}

export interface EstateDailyClaimedEvent {
  player: PublicKey;
  playerName: string;
  materials: bigint;
  streak: number;
  timestamp: bigint;
}

// Forge Events

export interface CraftStartedEvent {
  player: PublicKey;
  playerName: string;
  itemType: number;
  qualityTier: number;
  materialsUsed: bigint;
  timestamp: bigint;
}

export interface CraftStrikeEvent {
  player: PublicKey;
  playerName: string;
  stage: number;
  quality: number;
  score: number;
  timestamp: bigint;
}

export interface CraftCompletedEvent {
  player: PublicKey;
  playerName: string;
  itemType: number;
  quality: number;
  score: number;
  inventorySlot: number;
  timestamp: bigint;
}

export interface CraftAbandonedEvent {
  player: PublicKey;
  playerName: string;
  itemType: number;
  stageReached: number;
  timestamp: bigint;
}

export interface ItemEquippedEvent {
  player: PublicKey;
  playerName: string;
  heroMint: PublicKey;
  heroName: string;
  slot: number;
  quality: number;
  fromInventory: number;
  timestamp: bigint;
}

// Research Events

export interface ResearchStartedEvent {
  player: PublicKey;
  playerName: string;
  researchId: number;
  level: number;
  completesAt: bigint;
  timestamp: bigint;
}

export interface ResearchCompletedEvent {
  player: PublicKey;
  playerName: string;
  researchId: number;
  level: number;
  timestamp: bigint;
}

export interface ResearchCancelledEvent {
  player: PublicKey;
  playerName: string;
  researchId: number;
  timestamp: bigint;
}

export interface ResearchSpeedupEvent {
  player: PublicKey;
  playerName: string;
  researchId: number;
  speedupSeconds: bigint;
  gemsSpent: bigint;
  newEta: bigint;
  timestamp: bigint;
}

export interface ResearchAscendedEvent {
  player: PublicKey;
  playerName: string;
  researchTree: number;
  newAscensionLevel: number;
  masteryCost: number;
  timestamp: bigint;
}

export interface PlayerAscendedEvent {
  player: PublicKey;
  playerName: string;
  ascensionLevel: number;
  masteryGained: number;
  timestamp: bigint;
}

// Sanctuary Events

export interface MeditationStartedEvent {
  player: PublicKey;
  playerName: string;
  heroMint: PublicKey;
  heroName: string;
  durationHours: number;
  completesAt: bigint;
  timestamp: bigint;
}

export interface MeditationClaimedEvent {
  player: PublicKey;
  playerName: string;
  heroMint: PublicKey;
  heroName: string;
  xpEarned: number;
  levelsGained: number;
  timestamp: bigint;
}

// Hero Events

export interface HeroMintedEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  templateId: number;
  rarity: number;
  timestamp: bigint;
}

export interface HeroLockedEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  slot: number;
  timestamp: bigint;
}

export interface HeroUnlockedEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  timestamp: bigint;
}

export interface HeroLeveledUpEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  oldLevel: number;
  newLevel: number;
  xpSpent: bigint;
  timestamp: bigint;
}

export interface HeroAssignedDefensiveEvent {
  heroMint: PublicKey;
  heroName: string;
  player: PublicKey;
  playerName: string;
  assigned: boolean;
  timestamp: bigint;
}

export interface HeroBurnedEvent {
  heroMint: PublicKey;
  player: PublicKey;
  playerName: string;
  templateId: number;
  heroLevel: number;
  tier: number;
  noviReward: bigint;
  newMintedCount: number;
  timestamp: bigint;
}

export interface SupplyCapUpdatedEvent {
  templateId: number;
  oldSupplyCap: number;
  newSupplyCap: number;
  timestamp: bigint;
}

// Shop Events

export interface ItemPurchasedEvent {
  player: PublicKey;
  playerName: string;
  itemId: number;
  quantity: number;
  price: bigint;
  currency: number;
  timestamp: bigint;
}

export interface BundlePurchasedEvent {
  player: PublicKey;
  playerName: string;
  bundleId: number;
  price: bigint;
  currency: number;
  timestamp: bigint;
}

export interface FlashSalePurchasedEvent {
  player: PublicKey;
  playerName: string;
  saleId: bigint;
  originalPrice: bigint;
  pricePaid: bigint;
  currency: number;
  timestamp: bigint;
}

export interface NoviPurchasedEvent {
  buyer: PublicKey;
  user: PublicKey;
  packageIndex: number;
  baseAmount: bigint;
  bonusAmount: bigint;
  totalReceived: bigint;
  costLamports: bigint;
  streakDay: number;
  subscriptionTier: number;
  timestamp: bigint;
}

// Initialization Events

export interface PlayerCreatedEvent {
  player: PublicKey;
  user: PublicKey;
  city: PublicKey;
  timestamp: bigint;
}

export interface UserCreatedEvent {
  user: PublicKey;
  wallet: PublicKey;
  timestamp: bigint;
}

export interface CityInitializedEvent {
  city: PublicKey;
  cityIndex: number;
  timestamp: bigint;
}

export interface GameEngineInitializedEvent {
  gameEngine: PublicKey;
  authority: PublicKey;
  timestamp: bigint;
}

// Name Events

export interface PlayerNameSetEvent {
  player: PublicKey;
  playerName: string;
  domainHash: Uint8Array;
  timestamp: bigint;
}

export interface PlayerNameRemovedEvent {
  player: PublicKey;
  playerName: string;
  timestamp: bigint;
}

export interface PlayerNameUpdatedEvent {
  player: PublicKey;
  oldName: string;
  newName: string;
  newDomainHash: Uint8Array;
  timestamp: bigint;
}

export interface TeamNameSetEvent {
  team: PublicKey;
  teamName: string;
  domainHash: Uint8Array;
  timestamp: bigint;
}

export interface TeamNameRemovedEvent {
  team: PublicKey;
  teamName: string;
  timestamp: bigint;
}

export interface TeamNameUpdatedEvent {
  team: PublicKey;
  oldName: string;
  newName: string;
  newDomainHash: Uint8Array;
  timestamp: bigint;
}

// Token Events

export interface NoviReservedToLockedEvent {
  player: PublicKey;
  playerName: string;
  amount: bigint;
  newLocked: bigint;
  remainingReserved: bigint;
  timestamp: bigint;
}

export interface NoviWithdrawnEvent {
  player: PublicKey;
  playerName: string;
  amount: bigint;
  remainingReserved: bigint;
  timestamp: bigint;
}

// Dungeon Events

export interface DungeonEnteredEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  heroMint: PublicKey;
  heroName: string;
  staminaSpent: number;
  timestamp: bigint;
}

export interface DungeonRoomClearedEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  room: number;
  xpGained: bigint;
  timestamp: bigint;
}

export interface DungeonFloorCompletedEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  noviGained: bigint;
  isCheckpoint: boolean;
  timestamp: bigint;
}

export interface DungeonRelicChosenEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  relicId: number;
  totalRelics: number;
  timestamp: bigint;
}

export interface DungeonBossFightEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  bossPower: number;
  bossHealth: bigint;
  timestamp: bigint;
}

export interface DungeonFailedEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  room: number;
  enemiesKilled: number;
  timestamp: bigint;
}

export interface DungeonFledEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  floor: number;
  enemiesKilled: number;
  xpGained: bigint;
  noviGained: bigint;
  gemsGained: bigint;
  timestamp: bigint;
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
  xpGained: bigint;
  noviGained: bigint;
  gemsGained: bigint;
  materialsGained: number;
  totalDamageDealt: bigint;
  timestamp: bigint;
}

export interface DungeonResumedEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  checkpointFloor: number;
  resumeFloor: number;
  gemCost: bigint;
  resumeCount: number;
  timestamp: bigint;
}

export interface DungeonLeaderboardPrizeClaimedEvent {
  player: PublicKey;
  playerName: string;
  dungeonId: number;
  weekNumber: number;
  rank: number;
  score: bigint;
  prizeAmount: bigint;
  timestamp: bigint;
}

// Castle Events

export interface CastleCreatedEvent {
  castle: PublicKey;
  castleName: string;
  cityId: number;
  castleId: number;
  tier: number;
  timestamp: bigint;
}

export interface CastleClaimedEvent {
  castle: PublicKey;
  castleName: string;
  king: PublicKey;
  kingName: string;
  team: PublicKey;
  tier: number;
  timestamp: bigint;
}

export interface CastleConqueredEvent {
  castle: PublicKey;
  castleName: string;
  previousKing: PublicKey;
  newKing: PublicKey;
  newKingName: string;
  newTeam: PublicKey;
  rallyId: bigint;
  timestamp: bigint;
}

export interface CastleDefendedEvent {
  castle: PublicKey;
  castleName: string;
  king: PublicKey;
  rallyId: bigint;
  damageDealt: bigint;
  weaponsCaptured: bigint;
  timestamp: bigint;
}

export interface CourtAppointedEvent {
  castle: PublicKey;
  castleName: string;
  appointee: PublicKey;
  appointeeName: string;
  positionType: number;
  appointedBy: PublicKey;
  timestamp: bigint;
}

export interface CourtDismissedEvent {
  castle: PublicKey;
  castleName: string;
  dismissed: PublicKey;
  dismissedName: string;
  positionType: number;
  dismissedBy: PublicKey;
  resigned: boolean;
  timestamp: bigint;
}

export interface GarrisonJoinedEvent {
  castle: PublicKey;
  castleName: string;
  contributor: PublicKey;
  contributorName: string;
  units1: bigint;
  units2: bigint;
  units3: bigint;
  weapons: bigint;
  heroMint: PublicKey;
  garrisonCount: number;
  timestamp: bigint;
}

export interface GarrisonLeftEvent {
  castle: PublicKey;
  castleName: string;
  contributor: PublicKey;
  contributorName: string;
  units1: bigint;
  units2: bigint;
  units3: bigint;
  weapons: bigint;
  heroMint: PublicKey;
  relieved: boolean;
  garrisonCount: number;
  timestamp: bigint;
}

export interface GarrisonLootClaimedEvent {
  castle: PublicKey;
  castleName: string;
  claimer: PublicKey;
  claimerName: string;
  melee: bigint;
  ranged: bigint;
  siege: bigint;
  timestamp: bigint;
}

export interface CastleUpgradeStartedEvent {
  castle: PublicKey;
  castleName: string;
  king: PublicKey;
  upgradeType: number;
  currentLevel: number;
  targetLevel: number;
  noviCost: bigint;
  completesAt: bigint;
  timestamp: bigint;
}

export interface CastleUpgradeCompletedEvent {
  castle: PublicKey;
  castleName: string;
  upgradeType: number;
  newLevel: number;
  timestamp: bigint;
}

export interface CastleUpgradeCancelledEvent {
  castle: PublicKey;
  castleName: string;
  upgradeType: number;
  noviRefunded: bigint;
  timestamp: bigint;
}

export interface CastleRewardsClaimedEvent {
  castle: PublicKey;
  castleName: string;
  claimer: PublicKey;
  claimerName: string;
  role: number;
  days: number;
  novi: bigint;
  cash: bigint;
  timestamp: bigint;
}

export interface CastleProtectionExpiredEvent {
  castle: PublicKey;
  castleName: string;
  king: PublicKey;
  timestamp: bigint;
}

export interface KingForceRemovedEvent {
  castle: PublicKey;
  castleName: string;
  removedKing: PublicKey;
  removedKingName: string;
  timestamp: bigint;
}

export interface CastleTransitionProgressEvent {
  castle: PublicKey;
  phase: number;
  cleanedCount: number;
  totalCount: number;
  timestamp: bigint;
}

export interface CastleStatusChangedEvent {
  castle: PublicKey;
  castleName: string;
  oldStatus: number;
  newStatus: number;
  timestamp: bigint;
}

export interface CastleAttackedEvent {
  castle: PublicKey;
  castleName: string;
  attacker: PublicKey;
  attackerName: string;
  king: PublicKey;
  damageDealt: bigint;
  damageReceived: bigint;
  attackerCasualties: bigint;
  garrisonCasualties: bigint;
  attackerWon: boolean;
  timestamp: bigint;
}

// Game Event Events

export interface GameEventCreatedEvent {
  event: PublicKey;
  eventType: number;
  startTime: bigint;
  endTime: bigint;
  prizePool: bigint;
  timestamp: bigint;
}

export interface GameEventJoinedEvent {
  event: PublicKey;
  player: PublicKey;
  playerName: string;
  entryFee: bigint;
  participantCount: number;
  timestamp: bigint;
}

export interface GameEventFinalizedEvent {
  event: PublicKey;
  totalParticipants: number;
  totalPrizes: bigint;
  timestamp: bigint;
}

export interface EventScoreUpdatedEvent {
  event: PublicKey;
  player: PublicKey;
  playerName: string;
  scoreDelta: bigint;
  newScore: bigint;
  timestamp: bigint;
}

// Kingdom Events

export interface KingdomCreatedEvent {
  kingdomId: number;
  kingdomName: string;
  theme: number;
  startTime: bigint;
  registrationClosesAt: bigint;
  createdBy: PublicKey;
  createdAt: bigint;
}

export interface KingdomRegistrationClosedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  totalPlayers: bigint;
  closedAt: bigint;
}

export interface PlayerJoinedKingdomEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  player: PublicKey;
  owner: PublicKey;
  joinedAt: bigint;
}

export interface KingdomEventCreatedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  eventId: bigint;
  eventType: number;
  startTime: bigint;
  endTime: bigint;
  prizePool: bigint;
}

export interface KingdomArenaSeasonStartedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  seasonId: number;
  startTime: bigint;
  endTime: bigint;
  prizePool: bigint;
}

export interface KingdomDungeonLeaderboardCreatedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  dungeonId: number;
  weekNumber: number;
  prizePool: bigint;
}

export interface KingdomCitiesInitializedEvent {
  kingdomId: number;
  gameEngine: PublicKey;
  startCityId: number;
  citiesCount: number;
  initializedAt: bigint;
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

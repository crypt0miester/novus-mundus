/**
 * Event Types
 *
 * TypeScript interfaces for all on-chain events parsed by parser.ts.
 */

import type { Address } from '@solana/kit';

// Combat Events

export interface PlayerAttackedEvent {
  attacker: Address;
  attackerName: string;
  defender: Address;
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
  player: Address;
  playerName: string;
  encounter: Address;
  damageDealt: bigint;
  healthRemaining: bigint;
  staminaConsumed: number;
  noviConsumed: bigint;
  attackerCount: number;
  timestamp: bigint;
}

export interface EncounterDefeatedEvent {
  encounter: Address;
  encounterType: number;
  level: number;
  totalAttackers: number;
  killingBlowBy: Address;
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
  player: Address;
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
  player: Address;
  playerName: string;
  unitType: number;
  baseQuantity: bigint;
  finalQuantity: bigint;
  noviBurned: bigint;
  timeBonusBps: number;
  timestamp: bigint;
}

export interface CashTransferredEvent {
  from: Address;
  fromName: string;
  to: Address;
  toName: string;
  amount: bigint;
  fee: bigint;
  timestamp: bigint;
}

export interface NoviLockedEvent {
  player: Address;
  playerName: string;
  amount: bigint;
  totalLocked: bigint;
  timestamp: bigint;
}

export interface EquipmentPurchasedEvent {
  player: Address;
  playerName: string;
  slot: number;
  tier: number;
  noviBurned: bigint;
  timestamp: bigint;
}

export interface StaminaPurchasedEvent {
  player: Address;
  playerName: string;
  stamina: bigint;
  gemsSpent: bigint;
  timestamp: bigint;
}

export interface VaultTransferEvent {
  player: Address;
  playerName: string;
  amount: bigint;
  toVault: boolean;
  vaultBalance: bigint;
  timestamp: bigint;
}

// Team Events

export interface TeamCreatedEvent {
  team: Address;
  teamName: string;
  founder: Address;
  noviBurned: bigint;
  timestamp: bigint;
}

export interface TeamJoinedEvent {
  team: Address;
  teamName: string;
  player: Address;
  memberCount: number;
  timestamp: bigint;
}

export interface TeamLeftEvent {
  team: Address;
  teamName: string;
  player: Address;
  memberCount: number;
  timestamp: bigint;
}

export interface MemberKickedEvent {
  team: Address;
  teamName: string;
  kicked: Address;
  kickedBy: Address;
  timestamp: bigint;
}

export interface LeadershipTransferredEvent {
  team: Address;
  teamName: string;
  oldLeader: Address;
  newLeader: Address;
  timestamp: bigint;
}

export interface TeamDisbandedEvent {
  team: Address;
  teamName: string;
  leader: Address;
  treasuryDistributed: bigint;
  timestamp: bigint;
}

export interface TreasuryDepositEvent {
  team: Address;
  teamName: string;
  depositor: Address;
  amount: bigint;
  newBalance: bigint;
  timestamp: bigint;
}

export interface TreasuryWithdrawEvent {
  team: Address;
  teamName: string;
  withdrawer: Address;
  amount: bigint;
  newBalance: bigint;
  timestamp: bigint;
}

export interface MemberRankChangedEvent {
  team: Address;
  teamName: string;
  member: Address;
  oldRank: number;
  newRank: number;
  changedBy: Address;
  timestamp: bigint;
}

export interface InviteSentEvent {
  team: Address;
  teamName: string;
  invitee: Address;
  inviter: Address;
  timestamp: bigint;
}

export interface InviteAcceptedEvent {
  team: Address;
  teamName: string;
  player: Address;
  memberCount: number;
  timestamp: bigint;
}

export interface InviteDeclinedEvent {
  team: Address;
  teamName: string;
  player: Address;
  timestamp: bigint;
}

export interface InviteCancelledEvent {
  team: Address;
  teamName: string;
  invitee: Address;
  cancelledBy: Address;
  timestamp: bigint;
}

export interface MotdUpdatedEvent {
  team: Address;
  teamName: string;
  updatedBy: Address;
  timestamp: bigint;
}

export interface TeamSettingsUpdatedEvent {
  team: Address;
  teamName: string;
  updatedBy: Address;
  timestamp: bigint;
}

export interface TreasurySettingsUpdatedEvent {
  team: Address;
  teamName: string;
  updatedBy: Address;
  timestamp: bigint;
}

export interface TreasuryWithdrawRequestedEvent {
  team: Address;
  teamName: string;
  requester: Address;
  amount: bigint;
  timestamp: bigint;
}

export interface TreasuryRequestApprovedEvent {
  team: Address;
  teamName: string;
  approver: Address;
  requester: Address;
  timestamp: bigint;
}

export interface TreasuryRequestRejectedEvent {
  team: Address;
  teamName: string;
  rejector: Address;
  requester: Address;
  timestamp: bigint;
}

export interface TreasuryRequestExecutedEvent {
  team: Address;
  teamName: string;
  executor: Address;
  requester: Address;
  amount: bigint;
  newBalance: bigint;
  timestamp: bigint;
}

export interface TreasuryRequestCancelledEvent {
  team: Address;
  teamName: string;
  requester: Address;
  timestamp: bigint;
}

// Travel Events

export interface IntercityTravelStartedEvent {
  player: Address;
  playerName: string;
  fromCity: Address;
  toCity: Address;
  arrivalAt: bigint;
  timestamp: bigint;
}

export interface IntercityTravelCompletedEvent {
  player: Address;
  playerName: string;
  city: Address;
  timestamp: bigint;
}

export interface PlayerTeleportedEvent {
  player: Address;
  playerName: string;
  fromCity: Address;
  toCity: Address;
  gemsSpent: bigint;
  timestamp: bigint;
}

export interface IntracityTravelStartedEvent {
  player: Address;
  playerName: string;
  city: Address;
  destX: number;
  destY: number;
  arrivalAt: bigint;
  timestamp: bigint;
}

export interface IntracityTravelCompletedEvent {
  player: Address;
  playerName: string;
  x: number;
  y: number;
  timestamp: bigint;
}

export interface TravelCancelledEvent {
  player: Address;
  playerName: string;
  isIntercity: boolean;
  wasBumped: boolean;
  timestamp: bigint;
}

export interface TravelSpeedupEvent {
  player: Address;
  playerName: string;
  isIntercity: boolean;
  speedupTier: number;
  gemsSpent: bigint;
  newEta: bigint;
  timestamp: bigint;
}

// Rally Events

export interface RallyCreatedEvent {
  rally: Address;
  team: Address;
  teamName: string;
  leader: Address;
  target: Address;
  gatherAt: bigint;
  timestamp: bigint;
}

export interface RallyJoinedEvent {
  rally: Address;
  teamName: string;
  player: Address;
  units: [bigint, bigint, bigint];
  participantCount: number;
  timestamp: bigint;
}

export interface RallyExecutedEvent {
  rally: Address;
  teamName: string;
  target: Address;
  damageDealt: bigint;
  damageReceived: bigint;
  lootCaptured: bigint;
  participantCount: number;
  timestamp: bigint;
}

export interface RallyCancelledEvent {
  rally: Address;
  teamName: string;
  cancelledBy: Address;
  timestamp: bigint;
}

export interface RallyLeftEvent {
  rally: Address;
  teamName: string;
  player: Address;
  units: [bigint, bigint, bigint];
  participantCount: number;
  timestamp: bigint;
}

export interface RallyClosedEvent {
  rally: Address;
  rallyId: bigint;
  teamName: string;
  leader: Address;
  timestamp: bigint;
}

export interface RallySpeedupEvent {
  rally: Address;
  teamName: string;
  payer: Address;
  speedupType: number;
  gemsSpent: bigint;
  timestamp: bigint;
}

export interface RallyParticipantReturnedEvent {
  rally: Address;
  teamName: string;
  player: Address;
  participatedInCombat: boolean;
  unitsReturned: [bigint, bigint, bigint];
  lootReceived: bigint;
  timestamp: bigint;
}

// Reinforcement Events

export interface ReinforcementSentEvent {
  sender: Address;
  senderName: string;
  receiver: Address;
  receiverName: string;
  units: [bigint, bigint, bigint];
  arrivesAt: bigint;
  timestamp: bigint;
}

export interface ReinforcementArrivedEvent {
  reinforcement: Address;
  sender: Address;
  senderName: string;
  receiver: Address;
  receiverName: string;
  units: [bigint, bigint, bigint];
  timestamp: bigint;
}

export interface ReinforcementRecalledEvent {
  reinforcement: Address;
  sender: Address;
  senderName: string;
  receiver: Address;
  receiverName: string;
  units: [bigint, bigint, bigint];
  timestamp: bigint;
}

export interface ReinforcementRelievedEvent {
  reinforcement: Address;
  sender: Address;
  senderName: string;
  receiver: Address;
  receiverName: string;
  units: [bigint, bigint, bigint];
  timestamp: bigint;
}

export interface ReinforcementReturnedEvent {
  sender: Address;
  senderName: string;
  units: [bigint, bigint, bigint];
  timestamp: bigint;
}

export interface ReinforcementSpeedupEvent {
  reinforcement: Address;
  sender: Address;
  senderName: string;
  receiver: Address;
  speedupType: number;
  gemsSpent: bigint;
  newEta: bigint;
  timestamp: bigint;
}

// Expedition Events

export interface ExpeditionStartedEvent {
  player: Address;
  playerName: string;
  expeditionType: number;
  nodeId: number;
  duration: number;
  timestamp: bigint;
}

export interface ExpeditionStrikeEvent {
  player: Address;
  playerName: string;
  strikeNum: number;
  yieldAmount: bigint;
  quality: number;
  timestamp: bigint;
}

export interface ExpeditionClaimedEvent {
  player: Address;
  playerName: string;
  expeditionType: number;
  totalYield: bigint;
  bonusYield: bigint;
  xpEarned: bigint;
  timestamp: bigint;
}

export interface ExpeditionAbortedEvent {
  player: Address;
  playerName: string;
  expeditionType: number;
  partialYield: bigint;
  timestamp: bigint;
}

export interface ExpeditionSpeedupEvent {
  player: Address;
  playerName: string;
  speedupSeconds: bigint;
  gemsSpent: bigint;
  newEta: bigint;
  timestamp: bigint;
}

// Loot Events

export interface LootClaimedEvent {
  player: Address;
  playerName: string;
  cash: bigint;
  items: [number, number, number, number];
  timestamp: bigint;
}

export interface EncounterSpawnedEvent {
  encounter: Address;
  city: Address;
  encounterType: number;
  level: number;
  x: number;
  y: number;
  timestamp: bigint;
}

// Progression Events

export interface DailyRewardClaimedEvent {
  player: Address;
  playerName: string;
  cash: bigint;
  timestamp: bigint;
}

export interface SubscriptionPurchasedEvent {
  player: Address;
  playerName: string;
  tier: number;
  durationDays: number;
  noviPaid: bigint;
  expiresAt: bigint;
  timestamp: bigint;
}

export interface XpGainedEvent {
  player: Address;
  playerName: string;
  amount: bigint;
  source: number;
  totalXp: bigint;
  timestamp: bigint;
}

export interface PlayerLeveledUpEvent {
  player: Address;
  playerName: string;
  oldLevel: number;
  newLevel: number;
  timestamp: bigint;
}

export interface EventPrizeClaimedEvent {
  player: Address;
  playerName: string;
  event: Address;
  rank: number;
  prizeAmount: bigint;
  timestamp: bigint;
}

export interface SubscriptionTierUpdatedEvent {
  player: Address;
  playerName: string;
  oldTier: number;
  newTier: number;
  expiresAt: bigint;
  timestamp: bigint;
}

export interface SubscriptionExpiredEvent {
  player: Address;
  playerName: string;
  oldTier: number;
  timestamp: bigint;
}

// Estate Events

export interface EstateCreatedEvent {
  estate: Address;
  player: Address;
  playerName: string;
  timestamp: bigint;
}

export interface BuildingStartedEvent {
  player: Address;
  playerName: string;
  buildingType: number;
  plot: number;
  completesAt: bigint;
  timestamp: bigint;
}

export interface BuildingCompletedEvent {
  player: Address;
  playerName: string;
  buildingType: number;
  level: number;
  plot: number;
  timestamp: bigint;
}

export interface BuildingUpgradeStartedEvent {
  player: Address;
  playerName: string;
  buildingType: number;
  fromLevel: number;
  toLevel: number;
  completesAt: bigint;
  timestamp: bigint;
}

export interface PlotPurchasedEvent {
  player: Address;
  playerName: string;
  plot: number;
  cost: bigint;
  totalPlots: number;
  timestamp: bigint;
}

export interface EstateDailyClaimedEvent {
  player: Address;
  playerName: string;
  materials: bigint;
  streak: number;
  timestamp: bigint;
}

// Forge Events

export interface CraftStartedEvent {
  player: Address;
  playerName: string;
  itemType: number;
  qualityTier: number;
  materialsUsed: bigint;
  timestamp: bigint;
}

export interface CraftStrikeEvent {
  player: Address;
  playerName: string;
  stage: number;
  quality: number;
  score: number;
  timestamp: bigint;
}

export interface CraftCompletedEvent {
  player: Address;
  playerName: string;
  itemType: number;
  quality: number;
  score: number;
  inventorySlot: number;
  timestamp: bigint;
}

export interface CraftAbandonedEvent {
  player: Address;
  playerName: string;
  itemType: number;
  stageReached: number;
  timestamp: bigint;
}

export interface ItemEquippedEvent {
  player: Address;
  playerName: string;
  heroMint: Address;
  heroName: string;
  slot: number;
  quality: number;
  fromInventory: number;
  timestamp: bigint;
}

// Research Events

export interface ResearchStartedEvent {
  player: Address;
  playerName: string;
  researchId: number;
  level: number;
  completesAt: bigint;
  timestamp: bigint;
}

export interface ResearchCompletedEvent {
  player: Address;
  playerName: string;
  researchId: number;
  level: number;
  timestamp: bigint;
}

export interface ResearchCancelledEvent {
  player: Address;
  playerName: string;
  researchId: number;
  timestamp: bigint;
}

export interface ResearchSpeedupEvent {
  player: Address;
  playerName: string;
  researchId: number;
  speedupSeconds: bigint;
  gemsSpent: bigint;
  newEta: bigint;
  timestamp: bigint;
}

export interface ResearchAscendedEvent {
  player: Address;
  playerName: string;
  researchTree: number;
  newAscensionLevel: number;
  masteryCost: number;
  timestamp: bigint;
}

export interface PlayerAscendedEvent {
  player: Address;
  playerName: string;
  ascensionLevel: number;
  masteryGained: number;
  timestamp: bigint;
}

// Sanctuary Events

export interface MeditationStartedEvent {
  player: Address;
  playerName: string;
  heroMint: Address;
  heroName: string;
  durationHours: number;
  completesAt: bigint;
  timestamp: bigint;
}

export interface MeditationClaimedEvent {
  player: Address;
  playerName: string;
  heroMint: Address;
  heroName: string;
  xpEarned: number;
  levelsGained: number;
  timestamp: bigint;
}

// Hero Events

export interface HeroMintedEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  templateId: number;
  rarity: number;
  timestamp: bigint;
}

export interface HeroLockedEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  slot: number;
  timestamp: bigint;
}

export interface HeroUnlockedEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  timestamp: bigint;
}

export interface HeroLeveledUpEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  oldLevel: number;
  newLevel: number;
  xpSpent: bigint;
  timestamp: bigint;
}

export interface HeroAssignedDefensiveEvent {
  heroMint: Address;
  heroName: string;
  player: Address;
  playerName: string;
  assigned: boolean;
  timestamp: bigint;
}

export interface HeroBurnedEvent {
  heroMint: Address;
  player: Address;
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
  player: Address;
  playerName: string;
  itemId: number;
  quantity: number;
  price: bigint;
  currency: number;
  timestamp: bigint;
}

export interface BundlePurchasedEvent {
  player: Address;
  playerName: string;
  bundleId: number;
  price: bigint;
  currency: number;
  timestamp: bigint;
}

export interface FlashSalePurchasedEvent {
  player: Address;
  playerName: string;
  saleId: bigint;
  originalPrice: bigint;
  pricePaid: bigint;
  currency: number;
  timestamp: bigint;
}

export interface NoviPurchasedEvent {
  buyer: Address;
  user: Address;
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
  player: Address;
  user: Address;
  city: Address;
  timestamp: bigint;
}

export interface UserCreatedEvent {
  user: Address;
  wallet: Address;
  timestamp: bigint;
}

export interface CityInitializedEvent {
  city: Address;
  cityIndex: number;
  timestamp: bigint;
}

export interface GameEngineInitializedEvent {
  gameEngine: Address;
  authority: Address;
  timestamp: bigint;
}

// Name Events

export interface PlayerNameSetEvent {
  player: Address;
  playerName: string;
  domainHash: Uint8Array;
  timestamp: bigint;
}

export interface PlayerNameRemovedEvent {
  player: Address;
  playerName: string;
  timestamp: bigint;
}

export interface PlayerNameUpdatedEvent {
  player: Address;
  oldName: string;
  newName: string;
  newDomainHash: Uint8Array;
  timestamp: bigint;
}

export interface TeamNameSetEvent {
  team: Address;
  teamName: string;
  domainHash: Uint8Array;
  timestamp: bigint;
}

export interface TeamNameRemovedEvent {
  team: Address;
  teamName: string;
  timestamp: bigint;
}

export interface TeamNameUpdatedEvent {
  team: Address;
  oldName: string;
  newName: string;
  newDomainHash: Uint8Array;
  timestamp: bigint;
}

// Token Events

export interface NoviReservedToLockedEvent {
  player: Address;
  playerName: string;
  amount: bigint;
  newLocked: bigint;
  remainingReserved: bigint;
  timestamp: bigint;
}

export interface NoviWithdrawnEvent {
  player: Address;
  playerName: string;
  amount: bigint;
  remainingReserved: bigint;
  timestamp: bigint;
}

// Dungeon Events

export interface DungeonEnteredEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  heroMint: Address;
  heroName: string;
  staminaSpent: number;
  timestamp: bigint;
}

export interface DungeonRoomClearedEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  room: number;
  xpGained: bigint;
  timestamp: bigint;
}

export interface DungeonFloorCompletedEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  noviGained: bigint;
  isCheckpoint: boolean;
  timestamp: bigint;
}

export interface DungeonRelicChosenEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  relicId: number;
  totalRelics: number;
  timestamp: bigint;
}

export interface DungeonBossFightEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  bossPower: number;
  bossHealth: bigint;
  timestamp: bigint;
}

export interface DungeonFailedEvent {
  player: Address;
  playerName: string;
  dungeonId: number;
  floor: number;
  room: number;
  enemiesKilled: number;
  timestamp: bigint;
}

export interface DungeonFledEvent {
  player: Address;
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
  player: Address;
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
  player: Address;
  playerName: string;
  dungeonId: number;
  checkpointFloor: number;
  resumeFloor: number;
  gemCost: bigint;
  resumeCount: number;
  timestamp: bigint;
}

export interface DungeonLeaderboardPrizeClaimedEvent {
  player: Address;
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
  castle: Address;
  castleName: string;
  cityId: number;
  castleId: number;
  tier: number;
  timestamp: bigint;
}

export interface CastleClaimedEvent {
  castle: Address;
  castleName: string;
  king: Address;
  kingName: string;
  team: Address;
  tier: number;
  timestamp: bigint;
}

export interface CastleConqueredEvent {
  castle: Address;
  castleName: string;
  previousKing: Address;
  newKing: Address;
  newKingName: string;
  newTeam: Address;
  rallyId: bigint;
  timestamp: bigint;
}

export interface CastleDefendedEvent {
  castle: Address;
  castleName: string;
  king: Address;
  rallyId: bigint;
  damageDealt: bigint;
  weaponsCaptured: bigint;
  timestamp: bigint;
}

export interface CourtAppointedEvent {
  castle: Address;
  castleName: string;
  appointee: Address;
  appointeeName: string;
  positionType: number;
  appointedBy: Address;
  timestamp: bigint;
}

export interface CourtDismissedEvent {
  castle: Address;
  castleName: string;
  dismissed: Address;
  dismissedName: string;
  positionType: number;
  dismissedBy: Address;
  resigned: boolean;
  timestamp: bigint;
}

export interface GarrisonJoinedEvent {
  castle: Address;
  castleName: string;
  contributor: Address;
  contributorName: string;
  units1: bigint;
  units2: bigint;
  units3: bigint;
  weapons: bigint;
  heroMint: Address;
  garrisonCount: number;
  timestamp: bigint;
}

export interface GarrisonLeftEvent {
  castle: Address;
  castleName: string;
  contributor: Address;
  contributorName: string;
  units1: bigint;
  units2: bigint;
  units3: bigint;
  weapons: bigint;
  heroMint: Address;
  relieved: boolean;
  garrisonCount: number;
  timestamp: bigint;
}

export interface GarrisonLootClaimedEvent {
  castle: Address;
  castleName: string;
  claimer: Address;
  claimerName: string;
  melee: bigint;
  ranged: bigint;
  siege: bigint;
  timestamp: bigint;
}

export interface CastleUpgradeStartedEvent {
  castle: Address;
  castleName: string;
  king: Address;
  upgradeType: number;
  currentLevel: number;
  targetLevel: number;
  noviCost: bigint;
  completesAt: bigint;
  timestamp: bigint;
}

export interface CastleUpgradeCompletedEvent {
  castle: Address;
  castleName: string;
  upgradeType: number;
  newLevel: number;
  timestamp: bigint;
}

export interface CastleUpgradeCancelledEvent {
  castle: Address;
  castleName: string;
  upgradeType: number;
  noviRefunded: bigint;
  timestamp: bigint;
}

export interface CastleRewardsClaimedEvent {
  castle: Address;
  castleName: string;
  claimer: Address;
  claimerName: string;
  role: number;
  days: number;
  novi: bigint;
  cash: bigint;
  timestamp: bigint;
}

export interface CastleProtectionExpiredEvent {
  castle: Address;
  castleName: string;
  king: Address;
  timestamp: bigint;
}

export interface KingForceRemovedEvent {
  castle: Address;
  castleName: string;
  removedKing: Address;
  removedKingName: string;
  timestamp: bigint;
}

export interface CastleTransitionProgressEvent {
  castle: Address;
  phase: number;
  cleanedCount: number;
  totalCount: number;
  timestamp: bigint;
}

export interface CastleStatusChangedEvent {
  castle: Address;
  castleName: string;
  oldStatus: number;
  newStatus: number;
  timestamp: bigint;
}

export interface CastleAttackedEvent {
  castle: Address;
  castleName: string;
  attacker: Address;
  attackerName: string;
  king: Address;
  damageDealt: bigint;
  damageReceived: bigint;
  attackerCasualties: bigint;
  garrisonCasualties: bigint;
  attackerWon: boolean;
  timestamp: bigint;
}

// Game Event Events

export interface GameEventCreatedEvent {
  event: Address;
  eventType: number;
  startTime: bigint;
  endTime: bigint;
  prizePool: bigint;
  timestamp: bigint;
}

export interface GameEventJoinedEvent {
  event: Address;
  player: Address;
  playerName: string;
  entryFee: bigint;
  participantCount: number;
  timestamp: bigint;
}

export interface GameEventFinalizedEvent {
  event: Address;
  totalParticipants: number;
  totalPrizes: bigint;
  timestamp: bigint;
}

export interface EventScoreUpdatedEvent {
  event: Address;
  player: Address;
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
  createdBy: Address;
  createdAt: bigint;
}

export interface KingdomRegistrationClosedEvent {
  kingdomId: number;
  gameEngine: Address;
  totalPlayers: bigint;
  closedAt: bigint;
}

export interface PlayerJoinedKingdomEvent {
  kingdomId: number;
  gameEngine: Address;
  player: Address;
  owner: Address;
  joinedAt: bigint;
}

export interface KingdomEventCreatedEvent {
  kingdomId: number;
  gameEngine: Address;
  eventId: bigint;
  eventType: number;
  startTime: bigint;
  endTime: bigint;
  prizePool: bigint;
}

export interface KingdomArenaSeasonStartedEvent {
  kingdomId: number;
  gameEngine: Address;
  seasonId: number;
  startTime: bigint;
  endTime: bigint;
  prizePool: bigint;
}

export interface KingdomDungeonLeaderboardCreatedEvent {
  kingdomId: number;
  gameEngine: Address;
  dungeonId: number;
  weekNumber: number;
  prizePool: bigint;
}

export interface KingdomCitiesInitializedEvent {
  kingdomId: number;
  gameEngine: Address;
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

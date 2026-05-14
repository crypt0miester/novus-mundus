/**
 * Novus Mundus Enumerations
 *
 * All enum types used throughout the game.
 */

// Account Key Discriminator
// Every on-chain account stores this as byte 0 so that a single
// `onProgramAccountChange` subscription can route raw bytes to
// the correct deserializer without knowing the PDA seeds.
// Must match the Rust AccountKey enum in state/mod.rs exactly.

export enum AccountKey {
  GameEngine = 1,
  Player = 2,
  User = 3,
  City = 4,
  Team = 5,
  TeamMemberSlot = 6,
  TeamInvite = 7,
  TreasuryRequest = 8,
  Location = 9,
  Encounter = 10,
  Loot = 11,
  Rally = 12,
  RallyParticipant = 13,
  Reinforcement = 14,
  Event = 15,
  EventParticipation = 16,
  ResearchTemplate = 17,
  ResearchProgress = 18,
  HeroTemplate = 19,
  HeroCollection = 20,
  HeroMintReceipt = 21,
  ShopConfig = 22,
  ShopItem = 23,
  ShopBundle = 24,
  FlashSale = 25,
  DailyDeal = 26,
  WeeklySale = 27,
  SeasonalSale = 28,
  DaoPromotion = 29,
  AllowedToken = 30,
  PlayerPurchase = 31,
  Estate = 32,
  Expedition = 33,
  ArenaSeason = 34,
  ArenaParticipant = 35,
  ArenaLoadout = 36,
  DungeonRun = 37,
  DungeonTemplate = 38,
  DungeonLeaderboard = 39,
  Castle = 40,
  CastleGarrison = 41,
  KingRegistry = 42,
  CourtPosition = 43,
  TeamCastleReward = 44,
  ForgeConfig = 45,
  ForgeSession = 46,
  NameRecord = 47,
  SanctuaryMeditation = 48,
}

// Subscription Tiers

export enum SubscriptionTier {
  Rookie = 0,
  Expert = 1,
  Epic = 2,
  Legendary = 3,
}

// Encounter Types

export enum EncounterType {
  Common = 0,
  Uncommon = 1,
  Rare = 2,
  Epic = 3,
  Legendary = 4,
  WorldEvent = 5,
}

// City Types

export enum CityType {
  Capital = 0,
  Trade = 1,
  Combat = 2,
  Resource = 3,
}

// Rally Status

export enum RallyStatus {
  Gathering = 0,
  Marching = 1,
  Combat = 2,
  Returning = 3,
  Completed = 4,
  Cancelled = 5,
}

// Rally Target Type

export enum RallyTargetType {
  Player = 0,
  Encounter = 1,
  Castle = 2,
}

// Reinforcement Status

export enum ReinforcementStatus {
  Traveling = 0,
  Active = 1,
  Returning = 2,
  Completed = 3,
}

// Expedition Types

export enum ExpeditionType {
  None = 0,
  Mining = 1,
  Fishing = 2,
}

// Castle Tier

export enum CastleTier {
  Outpost = 0,
  Keep = 1,
  Stronghold = 2,
  Fortress = 3,
  Citadel = 4,
}

// Castle Status

export enum CastleStatus {
  Vacant = 0,
  Contest = 1,
  Protected = 2,
  Vulnerable = 3,
  Transitioning = 4,
}

// Castle Upgrade Type

export enum CastleUpgradeType {
  None = 0,
  Fortification = 1,
  Treasury = 2,
  Chambers = 3,
  Watchtower = 4,
  Armory = 5,
}

// Court Position

export enum CourtPosition {
  Advisor = 0,
  Scholar = 1,
  Guardian = 2,
  Treasurer = 3,
  Marshal = 4,
}

// Dungeon Room Type

export enum DungeonRoomType {
  Combat = 0,
  Rest = 1,
  Treasure = 2,
  Trap = 3,
  Boss = 4,
  Relic = 5,
  Exit = 6,
}

// Dungeon Run Status

export enum DungeonRunStatus {
  Active = 0,
  Completed = 1,
  Failed = 2,
  Fled = 3,
}

// Arena Season Status

export enum ArenaSeasonStatus {
  Pending = 0,
  Active = 1,
  Ended = 2,
  Finalized = 3,
}

// Team Member Rank

export enum TeamMemberRank {
  Member = 0,
  Officer = 1,
  CoLeader = 2,
  Leader = 3,
}

// Building Types (Estate)

export enum BuildingType {
  Mansion = 0,
  Barracks = 1,
  Workshop = 2,
  Vault = 3,
  Dock = 4,
  Forge = 5,
  Market = 6,
  Academy = 7,
  Arena = 8,
  MeditationChamber = 9,
  Observatory = 10,
  Treasury = 11,
  Citadel = 12,
  Camp = 13,
  Mine = 14,
  DungeonEntry = 15,
  Farm = 16,
  TransportBay = 17,
  Infirmary = 18,
}

// Equipment Slot / Craftable Equipment

export enum EquipmentSlot {
  MeleeWeapon = 0,
  RangedWeapon = 1,
  SiegeWeapon = 2,
  Armor = 3,
}

/** Alias for EquipmentSlot - used in forge system */
export const CraftableEquipment = EquipmentSlot;
export type CraftableEquipment = EquipmentSlot;

// Quality Tier

export enum QualityTier {
  Common = 0,
  Uncommon = 1,
  Rare = 2,
  Epic = 3,
  Legendary = 4,
}

// Synergy Tags (Dungeon Relics)

export enum SynergyTag {
  Offense = 0,
  Defense = 1,
  Crit = 2,
  Sustain = 3,
  Darkness = 4,
  Loot = 5,
  Boss = 6,
  Hero = 7,
  Meta = 8,
  None = 255,
}

// Payment Type (Shop)

export enum PaymentType {
  Novi = 0,
  Cash = 1,
  Gems = 2,
  Usd = 3,
  Token = 4,
}

// Shop Item Type

export enum ShopItemType {
  Consumable = 0,
  Subscription = 1,
  Cosmetic = 2,
  Boost = 3,
  Currency = 4,
}

// Travel Type

export enum TravelType {
  None = 0,
  Intracity = 1,
  Intercity = 2,
}

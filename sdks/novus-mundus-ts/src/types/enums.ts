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
  BuildingTemplate = 49,
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
  Resource = 1,
  Combat = 2,
  Trade = 3,
}

export const CITY_TYPE_NAMES: Record<number, string> = {
  [CityType.Capital]: "Capital",
  [CityType.Resource]: "Resource",
  [CityType.Combat]: "Combat",
  [CityType.Trade]: "Trade",
};

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

// Hero Type / Category / Tier
//
// Mirror the on-chain enums in programs/novus_mundus/src/state/hero.rs.

export enum HeroType {
  Offensive = 0,
  Defensive = 1,
  Economic = 2,
  Hybrid = 3,
}

export const HERO_TYPE_NAMES: Record<number, string> = {
  [HeroType.Offensive]: "Offensive",
  [HeroType.Defensive]: "Defensive",
  [HeroType.Economic]: "Economic",
  [HeroType.Hybrid]: "Hybrid",
};

export enum HeroCategory {
  Historical = 0,
  Mythological = 1,
  CryptoIcons = 2,
  Gaming = 3,
  Original = 4,
}

export const HERO_CATEGORY_NAMES: Record<number, string> = {
  [HeroCategory.Historical]: "Historical",
  [HeroCategory.Mythological]: "Mythological",
  [HeroCategory.CryptoIcons]: "Crypto Icons",
  [HeroCategory.Gaming]: "Gaming",
  [HeroCategory.Original]: "Original",
};

/** Hero rarity tier — drives the home-city location bonus (2% per tier step). */
export enum HeroTier {
  Common = 0,
  Rare = 1,
  Epic = 2,
  Legendary = 3,
  Mythic = 4,
}

export const HERO_TIER_NAMES: Record<number, string> = {
  [HeroTier.Common]: "Common",
  [HeroTier.Rare]: "Rare",
  [HeroTier.Epic]: "Epic",
  [HeroTier.Legendary]: "Legendary",
  [HeroTier.Mythic]: "Mythic",
};

// Hero Buff Stats
//
// Mirrors the on-chain `BuffStat` enum in programs/novus_mundus/src/state/hero.rs.
// This is the single source of truth for buff labels across the app — the CLI,
// the web UI, and any tooling should resolve buff names through BUFF_STATS
// rather than maintaining their own lookup tables.

export enum BuffStat {
  None = 0,
  AttackPower = 1,
  DefensePower = 2,
  CashCollectionRate = 3,
  XpGain = 4,
  TrainingCostReduction = 5,
  RallyCapacity = 6,
  CriticalHitChance = 7,
  SynchronyBonus = 8,
  ResourceCapacity = 9,
  WeaponEfficiency = 10,
  StaminaRegen = 11,
  ProduceGeneration = 12,
  UnitCapacity = 13,
  EncounterDamage = 14,
  LootBonus = 15,
  ArmorEfficiency = 16,
  MiningAffinity = 17,
  FishingAffinity = 18,
}

export interface BuffStatMeta {
  /** Numeric BuffStat value — matches the on-chain enum. */
  stat: BuffStat;
  /**
   * NFT metadata attribute key. MUST match the keys in the Rust
   * `key_to_buff_stat` parser (helpers/nft_parser.rs) — hero NFTs store buffs
   * under these attribute names.
   */
  attrKey: string;
  /** Short abbreviation for compact UI (chips, badges). */
  abbr: string;
  /** Full human-readable name. */
  name: string;
  /** One-line description of the effect. */
  description: string;
}

/** Canonical metadata for every hero buff, keyed by BuffStat value. */
export const BUFF_STATS: Record<number, BuffStatMeta> = {
  [BuffStat.AttackPower]: { stat: BuffStat.AttackPower, attrKey: "Attack", abbr: "ATK", name: "Attack Power", description: "Increases damage dealt in combat." },
  [BuffStat.DefensePower]: { stat: BuffStat.DefensePower, attrKey: "Defense", abbr: "DEF", name: "Defense Power", description: "Reduces damage taken in combat." },
  [BuffStat.CashCollectionRate]: { stat: BuffStat.CashCollectionRate, attrKey: "Economy", abbr: "ECO", name: "Cash Collection", description: "Increases cash collected from resources." },
  [BuffStat.XpGain]: { stat: BuffStat.XpGain, attrKey: "XP", abbr: "XP", name: "XP Gain", description: "Increases experience earned." },
  [BuffStat.TrainingCostReduction]: { stat: BuffStat.TrainingCostReduction, attrKey: "Training", abbr: "TRN", name: "Training Cost", description: "Reduces the cost of training units." },
  [BuffStat.RallyCapacity]: { stat: BuffStat.RallyCapacity, attrKey: "Rally", abbr: "RLY", name: "Rally Capacity", description: "Increases troop capacity in rallies." },
  [BuffStat.CriticalHitChance]: { stat: BuffStat.CriticalHitChance, attrKey: "Crit", abbr: "CRT", name: "Critical Hit", description: "Increases critical hit chance in combat." },
  [BuffStat.SynchronyBonus]: { stat: BuffStat.SynchronyBonus, attrKey: "Synchrony", abbr: "SYN", name: "Synchrony", description: "Bonus that scales with your active hero lineup." },
  [BuffStat.ResourceCapacity]: { stat: BuffStat.ResourceCapacity, attrKey: "Storage", abbr: "STO", name: "Resource Storage", description: "Increases warehouse storage capacity." },
  [BuffStat.WeaponEfficiency]: { stat: BuffStat.WeaponEfficiency, attrKey: "Weapon", abbr: "WPN", name: "Weapon Efficiency", description: "Improves weapon effectiveness." },
  [BuffStat.StaminaRegen]: { stat: BuffStat.StaminaRegen, attrKey: "Stamina", abbr: "STA", name: "Stamina Regen", description: "Increases stamina regeneration rate." },
  [BuffStat.ProduceGeneration]: { stat: BuffStat.ProduceGeneration, attrKey: "Produce", abbr: "PRD", name: "Produce Generation", description: "Increases produce output." },
  [BuffStat.UnitCapacity]: { stat: BuffStat.UnitCapacity, attrKey: "Units", abbr: "UNT", name: "Unit Capacity", description: "Increases maximum army size." },
  [BuffStat.EncounterDamage]: { stat: BuffStat.EncounterDamage, attrKey: "Encounter", abbr: "ENC", name: "Encounter Damage", description: "Increases damage against wild encounters." },
  [BuffStat.LootBonus]: { stat: BuffStat.LootBonus, attrKey: "Loot", abbr: "LT", name: "Loot Bonus", description: "Increases loot from encounters and dungeons." },
  [BuffStat.ArmorEfficiency]: { stat: BuffStat.ArmorEfficiency, attrKey: "Armor", abbr: "ARM", name: "Armor Efficiency", description: "Improves armor effectiveness." },
  [BuffStat.MiningAffinity]: { stat: BuffStat.MiningAffinity, attrKey: "Mining", abbr: "MIN", name: "Mining Affinity", description: "Bonus yield from mining expeditions." },
  [BuffStat.FishingAffinity]: { stat: BuffStat.FishingAffinity, attrKey: "Fishing", abbr: "FSH", name: "Fishing Affinity", description: "Bonus yield from fishing expeditions." },
};

const BUFF_STATS_BY_ATTR: Record<string, BuffStatMeta> = Object.fromEntries(
  Object.values(BUFF_STATS).map((m) => [m.attrKey, m]),
);

/** Look up buff metadata by numeric BuffStat value. */
export function getBuffStatMeta(stat: number): BuffStatMeta | undefined {
  return BUFF_STATS[stat];
}

/** Look up buff metadata by NFT attribute key (e.g. "Attack", "Mining"). */
export function getBuffStatByAttrKey(key: string): BuffStatMeta | undefined {
  return BUFF_STATS_BY_ATTR[key];
}

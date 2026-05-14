use pinocchio::error::ProgramError;
use crate::error::GameError;

#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum UnitType {
    DefensiveUnit1 = 0,
    DefensiveUnit2 = 1,
    DefensiveUnit3 = 2,
    OperativeUnit1 = 3,
    OperativeUnit2 = 4,
    OperativeUnit3 = 5,
}

impl TryFrom<u8> for UnitType {
    type Error = ProgramError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::DefensiveUnit1),
            1 => Ok(Self::DefensiveUnit2),
            2 => Ok(Self::DefensiveUnit3),
            3 => Ok(Self::OperativeUnit1),
            4 => Ok(Self::OperativeUnit2),
            5 => Ok(Self::OperativeUnit3),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
pub enum Theme {
    #[default]
    Medieval = 0,
    Cyberpunk = 1,
    SciFi = 2,
    Modern = 3,
    PostApocalyptic = 4,
}

impl Theme {
    /// Convert from u8 value
    pub fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Medieval,
            1 => Self::Cyberpunk,
            2 => Self::SciFi,
            3 => Self::Modern,
            4 => Self::PostApocalyptic,
            _ => Self::Medieval, // Default to Medieval for invalid values
        }
    }
}

impl TryFrom<u8> for Theme {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Medieval),
            1 => Ok(Self::Cyberpunk),
            2 => Ok(Self::SciFi),
            3 => Ok(Self::Modern),
            4 => Ok(Self::PostApocalyptic),
            _ => Err(GameError::InvalidParameter),
        }
    }
}

/// Travel type distinguishes between intercity and intracity movement
///
/// - Intercity: Slow travel between cities, theme-dependent speed
/// - Intracity: Fast travel within same city, walking speed (~5 km/h)
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum TravelType {
    None = 0,        // Not currently traveling
    Intracity = 1,   // Moving within same city (fast, ~1-5 min)
    Intercity = 2,   // Moving between cities (slow, ~10 min - 2 hours)
}

impl TryFrom<u8> for TravelType {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::None),
            1 => Ok(Self::Intracity),
            2 => Ok(Self::Intercity),
            _ => Err(GameError::InvalidParameter),
        }
    }
}

impl Default for TravelType {
    fn default() -> Self {
        Self::None
    }
}

/// Encounter rarity types
///
/// Determines difficulty, rewards, and stamina cost.
/// Order matches the rarity field in EncounterAccount (u8).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum EncounterType {
    Common = 0,
    Uncommon = 1,
    Rare = 2,
    Epic = 3,
    Legendary = 4,
    WorldEvent = 5,
}

impl EncounterType {
    /// Convert from rarity u8 (from EncounterAccount)
    pub fn from_rarity(rarity: u8) -> Option<Self> {
        match rarity {
            0 => Some(Self::Common),
            1 => Some(Self::Uncommon),
            2 => Some(Self::Rare),
            3 => Some(Self::Epic),
            4 => Some(Self::Legendary),
            5 => Some(Self::WorldEvent),
            _ => None,
        }
    }

    /// Get base health for this encounter type
    pub fn base_health(self) -> u64 {
        match self {
            Self::Common => 1_000,
            Self::Uncommon => 5_000,
            Self::Rare => 25_000,
            Self::Epic => 100_000,
            Self::Legendary => 500_000,
            Self::WorldEvent => 5_000_000,
        }
    }

    /// Get despawn duration in seconds
    pub fn despawn_duration(self) -> i64 {
        match self {
            Self::Common => 3_600,        // 1 hour
            Self::Uncommon => 7_200,      // 2 hours
            Self::Rare => 14_400,         // 4 hours
            Self::Epic => 43_200,         // 12 hours
            Self::Legendary => 86_400,    // 24 hours
            Self::WorldEvent => 604_800,  // 7 days
        }
    }

    /// Check if players can spawn this type (Common/Uncommon/Rare)
    /// Epic+ requires DAO
    pub fn is_player_spawnable(self) -> bool {
        matches!(self, Self::Common | Self::Uncommon | Self::Rare)
    }

    /// Get spawn cost in Novi
    pub fn spawn_cost(self) -> u64 {
        match self {
            Self::Common => 1_000,
            Self::Uncommon => 5_000,
            Self::Rare => 25_000,
            Self::Epic => 0,          // DAO only (no cost)
            Self::Legendary => 0,     // DAO only (no cost)
            Self::WorldEvent => 0,    // DAO only (no cost)
        }
    }
}

impl TryFrom<u8> for EncounterType {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::from_rarity(value).ok_or(GameError::InvalidParameter)
    }
}

/// Event scoring types
///
/// Determines what actions contribute to the event score.
/// Two categories:
/// - Accumulative: Score increases over time (sum of actions)
/// - Snapshot: Score is current max value
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum EventType {
    TotalDamageDealt = 0,        // Accumulative: sum all damage
    MostAttacksWonPvP = 1,       // Accumulative: count PvP wins
    MostAttacksWonPvE = 2,       // Accumulative: count PvE wins
    HighestCash = 3,             // Snapshot: max cash_on_hand
    MostXPGained = 4,            // Accumulative: sum XP deltas
    MostEncountersDefeated = 5,  // Accumulative: count defeats
    MostResourcesCollected = 6,  // Accumulative: sum resources
    MostNoviConsumed = 7,        // Accumulative: sum novi burned/spent
}

impl EventType {
    /// Check if this is an accumulative type (add to score) or snapshot (replace if higher)
    pub fn is_accumulative(self) -> bool {
        !matches!(self, Self::HighestCash)
    }

    /// Get from u8
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::TotalDamageDealt),
            1 => Some(Self::MostAttacksWonPvP),
            2 => Some(Self::MostAttacksWonPvE),
            3 => Some(Self::HighestCash),
            4 => Some(Self::MostXPGained),
            5 => Some(Self::MostEncountersDefeated),
            6 => Some(Self::MostResourcesCollected),
            7 => Some(Self::MostNoviConsumed),
            _ => None,
        }
    }
}

impl TryFrom<u8> for EventType {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::from_u8(value).ok_or(GameError::InvalidParameter)
    }
}

/// Prize types for events
///
/// Determines where the prize is transferred when claimed.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PrizeType {
    LockedNovi = 0,  // → player.locked_novi
    Gems = 1,        // → player.gems
    Cash = 2,        // → player.cash_on_hand
    SPLToken = 3,    // CPI transfer from event vault to player token account
}

impl PrizeType {
    /// Get from u8
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::LockedNovi),
            1 => Some(Self::Gems),
            2 => Some(Self::Cash),
            3 => Some(Self::SPLToken),
            _ => None,
        }
    }
}

impl TryFrom<u8> for PrizeType {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::from_u8(value).ok_or(GameError::InvalidParameter)
    }
}

/// Collection type for resource gathering
///
/// Different collection methods unlocked via research:
/// - Cash: Default collection, generates reserved novi
/// - Mining: Unlocked via research, generates gems + chance for fragments
/// - Fishing: Unlocked via research, generates produce + chance for fragments
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CollectionType {
    Cash = 0,    // Default cash generation
    Mining = 1,  // Mining for gems (research unlocked)
    Fishing = 2, // Fishing for produce (research unlocked)
    Farming = 3, // Farming for produce (Farm building, uses defensive units)
}

impl TryFrom<u8> for CollectionType {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Cash),
            1 => Ok(Self::Mining),
            2 => Ok(Self::Fishing),
            3 => Ok(Self::Farming),
            _ => Err(GameError::InvalidParameter),
        }
    }
}

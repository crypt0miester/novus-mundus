pub mod game_engine;
pub mod player;
pub mod city;
pub mod team;
pub mod location;
pub mod rally;
pub mod reinforcement;
pub mod encounter;
pub mod event;
pub mod progression;
pub mod loot;
pub mod research;
pub mod hero;
pub mod shop;
pub mod inventory;
pub mod estate;
pub mod expedition;
pub mod arena;
pub mod dungeon;
pub mod castle;

use pinocchio::account_info::{Ref, RefMut};
use pinocchio::program_error::ProgramError;

// ============================================================
// ACCOUNT KEY DISCRIMINATOR
// ============================================================
// Every on-chain account stores this as byte 0 so that a single
// `onProgramAccountChange` subscription can route raw bytes to
// the correct deserializer without knowing the PDA seeds.
// ============================================================

#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum AccountKey {
    // Core accounts
    GameEngine = 1,
    Player = 2,
    User = 3,
    City = 4,

    // Team system
    Team = 5,
    TeamMemberSlot = 6,
    TeamInvite = 7,
    TreasuryRequest = 8,

    // Location & encounters
    Location = 9,
    Encounter = 10,
    Loot = 11,

    // Rally system
    Rally = 12,
    RallyParticipant = 13,

    // Reinforcement
    Reinforcement = 14,

    // Events
    Event = 15,
    EventParticipation = 16,

    // Research
    ResearchTemplate = 17,
    ResearchProgress = 18,

    // Hero system
    HeroTemplate = 19,
    HeroCollection = 20,
    HeroMintReceipt = 21,

    // Shop system
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

    // Estate
    Estate = 32,

    // Expedition
    Expedition = 33,

    // Arena PvP
    ArenaSeason = 34,
    ArenaParticipant = 35,
    ArenaLoadout = 36,

    // Dungeon
    DungeonRun = 37,
    DungeonTemplate = 38,
    DungeonLeaderboard = 39,

    // Castle
    Castle = 40,
    CastleGarrison = 41,
    KingRegistry = 42,
    CourtPosition = 43,
    TeamCastleReward = 44,

    // Forge
    ForgeConfig = 45,
    ForgeSession = 46,

    // Name system
    NameRecord = 47,

    // Sanctuary
    SanctuaryMeditation = 48,
}

impl AccountKey {
    /// Validate that the first byte of account data matches the expected key.
    pub fn validate(data: &[u8], expected: AccountKey) -> Result<(), ProgramError> {
        if data.is_empty() || data[0] != expected as u8 {
            return Err(crate::error::GameError::InvalidAccountKey.into());
        }
        Ok(())
    }

    /// Read the account key from the first byte of account data.
    pub fn from_data(data: &[u8]) -> Option<Self> {
        if data.is_empty() {
            return None;
        }
        Self::from_u8(data[0])
    }

    /// Convert a u8 to an AccountKey variant.
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            1 => Some(Self::GameEngine),
            2 => Some(Self::Player),
            3 => Some(Self::User),
            4 => Some(Self::City),
            5 => Some(Self::Team),
            6 => Some(Self::TeamMemberSlot),
            7 => Some(Self::TeamInvite),
            8 => Some(Self::TreasuryRequest),
            9 => Some(Self::Location),
            10 => Some(Self::Encounter),
            11 => Some(Self::Loot),
            12 => Some(Self::Rally),
            13 => Some(Self::RallyParticipant),
            14 => Some(Self::Reinforcement),
            15 => Some(Self::Event),
            16 => Some(Self::EventParticipation),
            17 => Some(Self::ResearchTemplate),
            18 => Some(Self::ResearchProgress),
            19 => Some(Self::HeroTemplate),
            20 => Some(Self::HeroCollection),
            21 => Some(Self::HeroMintReceipt),
            22 => Some(Self::ShopConfig),
            23 => Some(Self::ShopItem),
            24 => Some(Self::ShopBundle),
            25 => Some(Self::FlashSale),
            26 => Some(Self::DailyDeal),
            27 => Some(Self::WeeklySale),
            28 => Some(Self::SeasonalSale),
            29 => Some(Self::DaoPromotion),
            30 => Some(Self::AllowedToken),
            31 => Some(Self::PlayerPurchase),
            32 => Some(Self::Estate),
            33 => Some(Self::Expedition),
            34 => Some(Self::ArenaSeason),
            35 => Some(Self::ArenaParticipant),
            36 => Some(Self::ArenaLoadout),
            37 => Some(Self::DungeonRun),
            38 => Some(Self::DungeonTemplate),
            39 => Some(Self::DungeonLeaderboard),
            40 => Some(Self::Castle),
            41 => Some(Self::CastleGarrison),
            42 => Some(Self::KingRegistry),
            43 => Some(Self::CourtPosition),
            44 => Some(Self::TeamCastleReward),
            45 => Some(Self::ForgeConfig),
            46 => Some(Self::ForgeSession),
            47 => Some(Self::NameRecord),
            48 => Some(Self::SanctuaryMeditation),
            _ => None,
        }
    }
}

/// Wrapper for immutably loaded account data with lifetime management.
/// Implements Deref for transparent access to the underlying account.
pub struct Loaded<'a, T> {
    _guard: Ref<'a, [u8]>,
    data: *const T,
}

impl<'a, T> Loaded<'a, T> {
    /// Create a new Loaded wrapper
    ///
    /// # Safety
    /// The caller must ensure the data pointer is valid for the lifetime of the guard
    pub unsafe fn new(guard: Ref<'a, [u8]>, data: *const T) -> Self {
        Self { _guard: guard, data }
    }
}

impl<T> core::ops::Deref for Loaded<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        unsafe { &*self.data }
    }
}

/// Wrapper for mutably loaded account data with lifetime management.
/// Implements Deref and DerefMut for transparent access to the underlying account.
pub struct LoadedMut<'a, T> {
    _guard: RefMut<'a, [u8]>,
    data: *mut T,
}

impl<'a, T> LoadedMut<'a, T> {
    /// Create a new LoadedMut wrapper
    ///
    /// # Safety
    /// The caller must ensure the data pointer is valid for the lifetime of the guard
    pub unsafe fn new(guard: RefMut<'a, [u8]>, data: *mut T) -> Self {
        Self { _guard: guard, data }
    }
}

impl<T> core::ops::Deref for LoadedMut<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        unsafe { &*self.data }
    }
}

impl<T> core::ops::DerefMut for LoadedMut<'_, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        unsafe { &mut *self.data }
    }
}

pub use game_engine::*;
pub use player::*;
pub use city::*;
pub use team::*;
pub use location::*;
pub use rally::*;
pub use reinforcement::*;
pub use encounter::*;
pub use event::*;
pub use progression::*;
pub use loot::*;
pub use research::*;
pub use hero::*;
pub use shop::*;
pub use inventory::*;
pub use estate::*;
pub use expedition::*;
pub use arena::*;
pub use dungeon::*;
pub use castle::*;

pub mod arena;
pub mod building_template;
pub mod castle;
pub mod city;
pub mod dungeon;
pub mod encounter;
pub mod estate;
pub mod event;
pub mod expedition;
pub mod game_engine;
pub mod hero;
pub mod inventory;
pub mod location;
pub mod loot;
pub mod oracle_quote;
pub mod player;
pub mod progression;
pub mod rally;
pub mod reinforcement;
pub mod research;
pub mod shop;
pub mod team;

use crate::utils::Pk;
use pinocchio::{error::ProgramError, AccountView};

// ACCOUNT KEY DISCRIMINATOR
// Every on-chain account stores this as byte 0 so that a single
// `onProgramAccountChange` subscription can route raw bytes to
// the correct deserializer without knowing the PDA seeds.

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

    // Estate building config
    BuildingTemplate = 49,
}

impl AccountKey {
    /// Validate that the first byte of account data matches the expected key.
    pub fn validate(data: &[u8], expected: AccountKey) -> Result<(), ProgramError> {
        if data.is_empty() || data[0] != expected as u8 {
            return Err(crate::error::GameError::InvalidAccountKey.into());
        }
        Ok(())
    }

    /// Cast an account's data buffer to `&T` after verifying byte 0 (the
    /// discriminator) matches `expected`. Logs the struct name + offending
    /// account on failure so tx logs identify which loader rejected the input.
    ///
    /// # Safety
    ///
    /// Caller must ensure:
    /// - No other code mutates the account data while the returned reference
    ///   is alive (Solana on-chain aliasing convention).
    /// - Any field reads through the returned reference fall within the
    ///   account's allocated `data_len()`. For variable-size accounts
    ///   (e.g. `PlayerAccount` with optional extensions) the caller is
    ///   responsible for not reading unallocated tail sections.
    /// - `T` is `repr(C)` with `account_key: u8` as its first field.
    #[inline(always)]
    pub unsafe fn cast<'a, T>(
        account: &'a AccountView,
        expected: AccountKey,
        type_name: &str,
    ) -> Result<&'a T, ProgramError> {
        if account.data_len() == 0 {
            pinocchio_log::log!(
                "{}: empty account data ({})",
                type_name,
                Pk(account.address().as_array()),
            );
            return Err(crate::error::GameError::InvalidAccountKey.into());
        }
        let actual = *account.data_ptr();
        if actual != expected as u8 {
            pinocchio_log::log!(
                "{}: discriminator mismatch — got {}, expected {} ({})",
                type_name,
                actual as u64,
                expected as u64,
                Pk(account.address().as_array()),
            );
            return Err(crate::error::GameError::InvalidAccountKey.into());
        }
        Ok(&*(account.data_ptr() as *const T))
    }

    /// Mutable variant of [`AccountKey::cast`].
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn cast_mut<'a, T>(
        account: &'a AccountView,
        expected: AccountKey,
        type_name: &str,
    ) -> Result<&'a mut T, ProgramError> {
        if account.data_len() == 0 {
            pinocchio_log::log!(
                "{}: empty account data ({})",
                type_name,
                Pk(account.address().as_array()),
            );
            return Err(crate::error::GameError::InvalidAccountKey.into());
        }
        let actual = *account.data_ptr();
        if actual != expected as u8 {
            pinocchio_log::log!(
                "{}: discriminator mismatch — got {}, expected {} ({})",
                type_name,
                actual as u64,
                expected as u64,
                Pk(account.address().as_array()),
            );
            return Err(crate::error::GameError::InvalidAccountKey.into());
        }
        Ok(&mut *(account.data_ptr() as *mut T))
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
            49 => Some(Self::BuildingTemplate),
            _ => None,
        }
    }
}

pub use arena::*;
pub use building_template::*;
pub use castle::*;
pub use city::*;
pub use dungeon::*;
pub use encounter::*;
pub use estate::*;
pub use event::*;
pub use expedition::*;
pub use game_engine::*;
pub use hero::*;
pub use inventory::*;
pub use location::*;
pub use loot::*;
pub use oracle_quote::*;
pub use player::*;
pub use progression::*;
pub use rally::*;
pub use reinforcement::*;
pub use research::*;
pub use shop::*;
pub use team::*;

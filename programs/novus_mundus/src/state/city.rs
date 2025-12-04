use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    ProgramResult,
};

use crate::constants::CITY_SEED;

/// Fixed city locations where players gather and travel between
///
/// Cities are the macro-level positioning system - players must be in the same
/// city to attack each other, but also need matching coordinates within the city.
///
/// PDA: seeds = [b"city", city_id.to_le_bytes()]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CityAccount {
    /// Unique city identifier (0-65535 cities possible)
    pub city_id: u16,                       // 2 bytes

    /// City name (UTF-8 encoded, padded with zeros)
    /// Examples: "New York", "Neo Tokyo", "London"
    pub name: [u8; 32],                     // 32 bytes

    /// Geographic center point (latitude in degrees)
    /// Range: -90.0 to 90.0
    pub latitude: f64,                      // 8 bytes

    /// Geographic center point (longitude in degrees)
    /// Range: -180.0 to 180.0
    pub longitude: f64,                     // 8 bytes

    /// City radius in kilometers for boundary validation
    /// Players claiming to be in this city must have coordinates within this radius
    pub radius_km: f32,                     // 4 bytes

    /// Type of city (Capital, Resource, Combat, etc.)
    /// Affects available bonuses and modifiers
    pub city_type: u8,                      // 1 byte

    /// Current number of players present in this city
    /// Incremented on arrival, decremented on departure
    pub players_present: u32,               // 4 bytes

    /// Total PvP attacks initiated in this city (all-time)
    pub active_encounters: u64,            // 8 bytes

    /// Total PvE encounters spawned in this city (all-time)
    pub total_encounters_spawned: u64,      // 8 bytes

    /// Unix timestamp when city was founded
    pub founded_at: i64,                    // 8 bytes

    /// Encounter level range for this city
    /// Beginner cities: 1-20, Mid-level: 21-60, End-game: 61-100
    pub min_encounter_level: u8,            // 1 byte
    pub max_encounter_level: u8,            // 1 byte

    /// PDA bump seed
    pub bump: u8,                           // 1 byte

    /// Padding to align to 8 bytes
    pub _padding: [u8; 5],                  // 5 bytes (was 3, now 5 to maintain alignment)
}

impl CityAccount {
    /// Total size in bytes: 2 + 32 + 8 + 8 + 4 + 1 + 4 + 8 + 8 + 8 + 1 + 1 + 1 + 5 = 91 bytes
    pub const SIZE: usize = 91;

    /// Load city account with read-only access
    ///
    /// # Safety
    /// Caller must ensure the account data is properly initialized as a CityAccount
    pub unsafe fn load(account: &AccountInfo) -> Result<&Self, ProgramError> {
        if account.data_len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        Ok(&*(account.data_ptr() as *const CityAccount))
    }

    /// Load city account with mutable access
    ///
    /// # Safety
    /// Caller must ensure the account data is properly initialized as a CityAccount
    pub unsafe fn load_mut(account: &AccountInfo) -> Result<&mut Self, ProgramError> {
        if account.data_len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        Ok(&mut *(account.data_ptr() as *mut CityAccount))
    }

    /// Derive the PDA for a city account (finds bump - slower)
    /// Use this only during account creation
    pub fn derive_pda(city_id: u16) -> (pinocchio::pubkey::Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[CITY_SEED, &city_id.to_le_bytes()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump (fast validation)
    /// Use this for validation when bump is already stored
    pub fn create_pda(city_id: u16, bump: u8) -> Result<pinocchio::pubkey::Pubkey, ProgramError> {
        let city_id_bytes = city_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[CITY_SEED, &city_id_bytes, &bump_seed],
            &crate::ID,
        )
    }

    /// Validate city account PDA using stored bump (fast)
    pub fn validate_pda(
        account: &AccountInfo,
        city_data: &CityAccount,
    ) -> ProgramResult {
        let expected_address = Self::create_pda(city_data.city_id, city_data.bump)?;
        if account.key() != &expected_address {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }

    /// Calculate max encounters based on current population
    ///
    /// Formula: BASE_ENCOUNTERS_PER_CITY + (players_present / ENCOUNTERS_PER_PLAYER_COUNT)
    /// Capped at MAX_ENCOUNTERS_PER_CITY (hard limit)
    ///
    /// # Examples
    /// - 0 players: 3 encounters (base)
    /// - 50 players: 3 + (50/10) = 8 encounters
    /// - 200 players: 3 + (200/10) = 23 encounters
    /// - 1000 players: capped at 50 encounters
    pub fn calculate_max_encounters(&self) -> u64 {
        use crate::constants::{
            BASE_ENCOUNTERS_PER_CITY,
            ENCOUNTERS_PER_PLAYER_COUNT,
            MAX_ENCOUNTERS_PER_CITY,
        };

        let base = BASE_ENCOUNTERS_PER_CITY as u64;
        let bonus = (self.players_present / ENCOUNTERS_PER_PLAYER_COUNT) as u64;
        let total = base.saturating_add(bonus);
        total.min(MAX_ENCOUNTERS_PER_CITY as u64)
    }

    /// Check if city can accept more encounters
    ///
    /// Returns true if active_encounters < dynamic limit
    #[inline]
    pub fn can_spawn_encounter(&self) -> bool {
        self.active_encounters < self.calculate_max_encounters()
    }
}

/// City type classification
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum CityType {
    /// Capital cities - major hubs, balanced bonuses
    Capital = 0,

    /// Resource-focused cities - collection bonuses
    Resource = 1,

    /// Combat-focused cities - attack/defense bonuses
    Combat = 2,

    /// Trading cities - economic bonuses
    Trade = 3,
}

impl CityType {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(CityType::Capital),
            1 => Some(CityType::Resource),
            2 => Some(CityType::Combat),
            3 => Some(CityType::Trade),
            _ => None,
        }
    }
}

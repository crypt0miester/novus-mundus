use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::constants::CITY_SEED;
use crate::logic::terrain::{self, Anchor, CityTerrain};

/// Fixed city locations where players gather and travel between
///
/// Cities are the macro-level positioning system - players must be in the same
/// city to attack each other, but also need matching coordinates within the city.
///
/// Cities are KINGDOM-SCOPED - each kingdom has its own set of cities with
/// theme-appropriate names and configurations.
///
/// PDA: seeds = [b"city", game_engine, city_id.to_le_bytes()]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CityAccount {
    /// Account discriminator (AccountKey::City)
    pub account_key: u8,                    // 1 byte

    /// Reference to the game engine (kingdom) this city belongs to
    pub game_engine: Pubkey,                // 32 bytes

    /// Unique city identifier within this kingdom (0-65535 cities possible)
    pub city_id: u16,                       // 2 bytes

    /// City name (UTF-8 encoded, padded with zeros)
    /// Names are theme-specific: "King's Landing" (Medieval), "Neo Tokyo" (Cyberpunk)
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

    /// Total PvE attacks initiated in this city (all-time)
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

    /// Padding for alignment
    pub _padding1: [u8; 1],                 // 1 byte

    /// Arena PvP - current season ID for this city (incremented on create_season)
    /// Seasons 4+ behind this can be auto-finalized
    pub arena_season_id: u32,               // 4 bytes

    // ─── Terrain System ──────────────────────────────────────────
    // Variable-length anchor data follows the fixed struct in account data.
    // Total account size = CityAccount::SIZE + anchor_count * ANCHOR_SIZE

    /// Deterministic seed for terrain noise
    pub terrain_seed: u32,                  // 4 bytes

    /// Elevation at or below this value is water (impassable)
    pub water_line: u8,                     // 1 byte

    /// Elevation at or above this value is mountain (impassable)
    pub peak_line: u8,                      // 1 byte

    /// Number of terrain anchors stored after the fixed struct
    pub anchor_count: u16,                  // 2 bytes

    /// Terrain data format version (currently 1)
    pub terrain_version: u8,                // 1 byte

    /// Reserved for future terrain features
    pub _terrain_reserved: [u8; 7],         // 7 bytes
}

/// Compile-time assertion: ensure SIZE matches actual struct layout
const _CITY_SIZE_CHECK: [(); core::mem::size_of::<CityAccount>()] = [(); CityAccount::SIZE];

impl CityAccount {
    /// Total size in bytes - must match core::mem::size_of::<CityAccount>()
    /// With #[repr(C)] alignment, the compiler may insert padding.
    pub const SIZE: usize = core::mem::size_of::<CityAccount>();

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
    /// Seeds: ["city", game_engine, city_id]
    pub fn derive_pda(game_engine: &Pubkey, city_id: u16) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[CITY_SEED, game_engine.as_ref(), &city_id.to_le_bytes()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump (fast validation)
    /// Use this for validation when bump is already stored
    pub fn create_pda(game_engine: &Pubkey, city_id: u16, bump: u8) -> Result<Pubkey, ProgramError> {
        let city_id_bytes = city_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[CITY_SEED, game_engine.as_ref(), &city_id_bytes, &bump_seed],
            &crate::ID,
        )
    }

    /// Validate city account PDA using stored bump (fast)
    pub fn validate_pda(
        account: &AccountInfo,
        city_data: &CityAccount,
    ) -> ProgramResult {
        let expected_address = Self::create_pda(&city_data.game_engine, city_data.city_id, city_data.bump)?;
        if account.key() != &expected_address {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }

    /// Check if city belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Pubkey) -> bool {
        &self.game_engine == game_engine
    }

    /// Calculate max encounters based on current population using game engine config.
    ///
    /// Formula: base + (players_present / per_player_count), capped at max.
    pub fn calculate_max_encounters(&self, base: u8, per_player_count: u32, max: u8) -> u64 {
        let base = base as u64;
        let bonus = if per_player_count > 0 {
            (self.players_present / per_player_count) as u64
        } else {
            0
        };
        let total = base.saturating_add(bonus);
        total.min(max as u64)
    }

    /// Check if city can accept more encounters using game engine config values.
    #[inline]
    pub fn can_spawn_encounter(&self, base: u8, per_player_count: u32, max: u8) -> bool {
        self.active_encounters < self.calculate_max_encounters(base, per_player_count, max)
    }

    // ─── Terrain Helpers ─────────────────────────────────────────

    /// Total account size for a city with N anchors.
    pub fn account_size(anchor_count: u16) -> usize {
        Self::SIZE + anchor_count as usize * terrain::ANCHOR_SIZE
    }

    /// Build a read-only terrain view from the city's account data.
    ///
    /// # Safety
    /// Caller must ensure account data extends at least
    /// `SIZE + anchor_count * ANCHOR_SIZE` bytes.
    pub unsafe fn terrain_from_account<'a>(account: &'a AccountInfo) -> CityTerrain<'a> {
        let city = &*(account.data_ptr() as *const CityAccount);
        let count = city.anchor_count as usize;
        let anchors = if count > 0 {
            let ptr = account.data_ptr().add(Self::SIZE) as *const Anchor;
            core::slice::from_raw_parts(ptr, count)
        } else {
            &[]
        };
        CityTerrain {
            seed: city.terrain_seed,
            water_line: city.water_line,
            peak_line: city.peak_line,
            anchors,
        }
    }

    /// Check if a coordinate offset from city center is passable terrain.
    /// Returns true if no terrain is configured (anchor_count == 0).
    pub fn is_terrain_passable(&self, account: &AccountInfo, ox: i32, oy: i32) -> bool {
        if self.anchor_count == 0 {
            return true;
        }
        let t = unsafe { Self::terrain_from_account(account) };
        terrain::is_passable(&t, ox, oy)
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

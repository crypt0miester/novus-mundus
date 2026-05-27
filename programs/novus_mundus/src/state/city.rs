use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

use crate::constants::CITY_SEED;
use crate::error::GameError;
use crate::logic::{biome, terrain};
use crate::state::AccountKey;

/// Current on-chain layout version. Bumped at the flat-strategy cut so
/// pre-cut variable-length accounts are rejected at load time rather
/// than silently misparsed when the program is upgraded in place.
pub const CITY_LAYOUT_VERSION: u8 = 2;

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
    pub account_key: u8, // 1 byte

    /// Reference to the game engine (kingdom) this city belongs to
    pub game_engine: Address, // 32 bytes

    /// Unique city identifier within this kingdom (0-65535 cities possible)
    pub city_id: u16, // 2 bytes

    /// City name (UTF-8 encoded, padded with zeros)
    /// Names are theme-specific: "King's Landing" (Medieval), "Neo Tokyo" (Cyberpunk)
    pub name: [u8; 32], // 32 bytes

    /// Geographic center point (latitude in degrees)
    /// Range: -90.0 to 90.0
    pub latitude: f64, // 8 bytes

    /// Geographic center point (longitude in degrees)
    /// Range: -180.0 to 180.0
    pub longitude: f64, // 8 bytes

    /// Type of city (Capital, Resource, Combat, etc.)
    /// Affects available bonuses and modifiers
    pub city_type: u8, // 1 byte

    /// Current number of players present in this city
    /// Incremented on arrival, decremented on departure
    pub players_present: u32, // 4 bytes

    /// Total PvE attacks initiated in this city (all-time)
    pub active_encounters: u64, // 8 bytes

    /// Total PvE encounters spawned in this city (all-time)
    pub total_encounters_spawned: u64, // 8 bytes

    /// Unix timestamp when city was founded
    pub founded_at: i64, // 8 bytes

    /// Encounter level range for this city
    /// Beginner cities: 1-20, Mid-level: 21-60, End-game: 61-100
    pub min_encounter_level: u8, // 1 byte
    pub max_encounter_level: u8, // 1 byte

    /// PDA bump seed
    pub bump: u8, // 1 byte

    /// Padding for alignment
    pub _padding1: [u8; 1], // 1 byte

    /// Arena PvP - current season ID for this city (incremented on create_season)
    /// Seasons 4+ behind this can be auto-finalized
    pub arena_season_id: u32, // 4 bytes

    // Biome layout.
    // No trailing variable-length data — the city's biome is a pure
    // function of (biome_seed, ox, oy, knobs) sampled at the point of
    // use (see logic::biome::biome_at). One compile-time-constant size
    // for the whole account.
    /// Deterministic seed for the biome noise channels.
    pub biome_seed: u32, // 4 bytes

    /// Square plot extent on the X (longitude) axis, in grid units
    /// (0.0001° each — ~11 m). Bounds checks use a centred AABB:
    /// `|ox| <= width_grid / 2`.
    pub width_grid: u16, // 2 bytes

    /// Square plot extent on the Y (latitude) axis, in grid units.
    pub height_grid: u16, // 2 bytes

    /// Layout discriminator — bumped to 2 at the flat-strategy cut so
    /// pre-cut accounts (which lacked this field, were variable-length,
    /// and carried `radius_km` + terrain anchors) can be rejected at
    /// load time rather than silently misparsed. Always 2 for fresh
    /// post-cut inits. Adding the BiomeKnobs fields below did NOT bump
    /// this — the bytes were already zero-initialized in v2 inits and
    /// zero defaults match the pre-knobs procedural behaviour
    /// bit-for-bit, so pre-knobs v2 accounts read as procedural.
    pub layout_version: u8, // 1 byte

    // Biome knobs — five bytes that bias the procedural sampler per
    // city. All-zero = procedural identical to pre-knobs behaviour.
    // See `logic::biome::BiomeKnobs` for the semantics.
    /// Signed delta added to the global WATER_THRESHOLD (96). +127 =
    /// no water at all (Cairo / Moscow); -96 = all water.
    pub water_level_delta: i8, // 1 byte
    /// Signed shift on the temperature noise channel. Positive = hotter
    /// Whittaker bucket; negative = colder.
    pub temp_bias: i8, // 1 byte
    /// Signed shift on the moisture noise channel. Positive = wetter;
    /// negative = drier.
    pub moisture_bias: i8, // 1 byte
    /// Coastal gradient bearing. 0 = none; 1..=8 = direction the sea
    /// lies in (N/NE/E/SE/S/SW/W/NW). Produces an irregular natural
    /// coastline along the bearing.
    pub coast: u8, // 1 byte
    /// Landmass mask seed. 0 = no mask; >0 carves organic island /
    /// archipelago shapes via a coarse second noise channel. The right
    /// answer for Tokyo Bay, Stockholm, Singapore (an island is not
    /// always a radius).
    pub landmass_seed: u8, // 1 byte

    /// Reserved for future biome / world-shape knobs.
    pub _biome_reserved: [u8; 2], // 2 bytes
}

/// Compile-time assertion: ensure SIZE matches actual struct layout
const _CITY_SIZE_CHECK: [(); core::mem::size_of::<CityAccount>()] = [(); CityAccount::SIZE];

impl CityAccount {
    /// Total size in bytes - must match core::mem::size_of::<CityAccount>()
    /// With #[repr(C)] alignment, the compiler may insert padding.
    pub const SIZE: usize = core::mem::size_of::<CityAccount>();

    /// Load city account with read-only access.
    ///
    /// Enforces — when the account is already initialized (byte 0 != 0)
    /// — that the discriminator matches AccountKey::City and that
    /// layout_version == CITY_LAYOUT_VERSION. Fresh accounts (byte 0
    /// == 0) bypass these checks so the init flow can write the
    /// discriminator and version after the first load_mut.
    ///
    /// Callers that read a city from an attacker-controlled context
    /// (combat, travel, encounter spawn, etc.) MUST also call
    /// `require_owner(account, program_id)` separately — load does not
    /// know the program_id.
    ///
    /// # Safety
    /// Caller must ensure the account data is properly initialized as a CityAccount
    pub unsafe fn load(account: &AccountView) -> Result<&Self, ProgramError> {
        if account.data_len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        let first_byte = *account.data_ptr();
        if first_byte != 0 && first_byte != AccountKey::City as u8 {
            return Err(GameError::InvalidAccountKey.into());
        }
        let cast: &CityAccount = &*(account.data_ptr() as *const CityAccount);
        if first_byte != 0 && cast.layout_version != CITY_LAYOUT_VERSION {
            return Err(GameError::InvalidAccountKey.into());
        }
        Ok(cast)
    }

    /// Load city account with mutable access. Same invariants as
    /// [`CityAccount::load`].
    ///
    /// # Safety
    /// Caller must ensure the account data is properly initialized as a CityAccount
    pub unsafe fn load_mut(account: &AccountView) -> Result<&mut Self, ProgramError> {
        if account.data_len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        let first_byte = *account.data_ptr();
        if first_byte != 0 && first_byte != AccountKey::City as u8 {
            return Err(GameError::InvalidAccountKey.into());
        }
        let cast: &mut CityAccount = &mut *(account.data_ptr() as *mut CityAccount);
        if first_byte != 0 && cast.layout_version != CITY_LAYOUT_VERSION {
            return Err(GameError::InvalidAccountKey.into());
        }
        Ok(cast)
    }

    /// Derive the PDA for a city account (finds bump - slower)
    /// Use this only during account creation
    /// Seeds: ["city", game_engine, city_id]
    pub fn derive_pda(game_engine: &Address, city_id: u16) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[CITY_SEED, game_engine.as_ref(), &city_id.to_le_bytes()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump (fast validation)
    /// Use this for validation when bump is already stored
    pub fn create_pda(
        game_engine: &Address,
        city_id: u16,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let city_id_bytes = city_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[CITY_SEED, game_engine.as_ref(), &city_id_bytes, &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Validate city account PDA using stored bump (fast)
    pub fn validate_pda(account: &AccountView, city_data: &CityAccount) -> ProgramResult {
        let expected_address =
            Self::create_pda(&city_data.game_engine, city_data.city_id, city_data.bump)?;
        if account.address() != &expected_address {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }

    /// Check if city belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Address) -> bool {
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

    // Biome helpers.

    /// Compute centre-relative grid offsets for a (lat, long) inside
    /// this city. Pure helper around `terrain::city_offset` plus the
    /// existing `LocationAccount::to_grid` quantization.
    #[inline]
    pub fn offset_for(&self, lat: f64, long: f64) -> (i32, i32) {
        terrain::city_offset(
            super::LocationAccount::to_grid(lat),
            super::LocationAccount::to_grid(long),
            self.latitude,
            self.longitude,
        )
    }

    /// Build the per-city biome knob tuple consumed by the sampler.
    /// Pure projection of the five knob bytes onto the
    /// `logic::biome::BiomeKnobs` struct — see that module for the
    /// semantic meaning of each field.
    #[inline]
    pub fn biome_knobs(&self) -> biome::BiomeKnobs {
        biome::BiomeKnobs {
            water_level_delta: self.water_level_delta,
            temp_bias: self.temp_bias,
            moisture_bias: self.moisture_bias,
            coast: self.coast,
            landmass_seed: self.landmass_seed,
        }
    }

    /// Sample the biome at a coordinate inside this city.
    #[inline]
    pub fn biome_at(&self, lat: f64, long: f64) -> u8 {
        let (ox, oy) = self.offset_for(lat, long);
        biome::biome_at(self.biome_seed, ox, oy, &self.biome_knobs())
    }

    /// Sample the biome at a centre-relative `(ox, oy)` offset. Useful
    /// for callers that already computed the offset (e.g. the castle
    /// footprint loop iterating over `(dlat, dlong)`).
    #[inline]
    pub fn biome_at_offset(&self, ox: i32, oy: i32) -> u8 {
        biome::biome_at(self.biome_seed, ox, oy, &self.biome_knobs())
    }

    /// Reject if the cell at `(lat, long)` lands on an impassable
    /// biome (water). Replaces the elevation-noise gate that used to
    /// reject water + peaks; under flat-strategy water is the only
    /// impassable biome, shore is walkable by design. The five
    /// processors that gate movement on terrain (init_player,
    /// encounter spawn, intracity/intercity start, intercity teleport)
    /// share this preamble — call this helper instead of inlining it.
    ///
    /// AccountView is no longer needed (no trailing anchor data to
    /// borrow), but the signature keeps a leading `_account` param
    /// commented in the call sites so the migration diff stays small;
    /// the parameter itself is gone.
    pub fn require_passable_at(&self, lat: f64, long: f64) -> ProgramResult {
        if !biome::is_passable_biome(self.biome_at(lat, long)) {
            return Err(crate::error::GameError::TerrainImpassable.into());
        }
        Ok(())
    }

    /// AABB bounds check for a (lat, long) inside this city's square
    /// plot. Replaces the Haversine `is_within_city_bounds(radius_km)`
    /// check — one comparison per axis, no sqrt, no cos.
    #[inline]
    pub fn contains_coord(&self, lat: f64, long: f64) -> bool {
        let (ox, oy) = self.offset_for(lat, long);
        crate::logic::location::is_within_city_grid(ox, oy, self.width_grid, self.height_grid)
    }

    /// Search outward in expanding square rings from the city centre
    /// for the nearest passable cell, up to `max_radius` rings (i.e.
    /// at most `(2 * max_radius + 1)²` samples in the worst case).
    /// Returns `(ox, oy)` in grid offsets relative to the city centre.
    ///
    /// Biome is a pure noise function post-flat-strategy — the centre
    /// cell `(0, 0)` is not guaranteed to be land. Callers that need a
    /// deterministic landing cell at city centre (e.g. intercity
    /// teleport) use this helper to snap to the nearest passable
    /// neighbour instead of failing the whole instruction.
    ///
    /// Returns `None` if no passable cell exists within `max_radius` —
    /// the caller decides whether that's an error or a soft fallback.
    pub fn find_passable_near_center(&self, max_radius: i32) -> Option<(i32, i32)> {
        let knobs = self.biome_knobs();
        if biome::is_passable_biome(biome::biome_at(self.biome_seed, 0, 0, &knobs)) {
            return Some((0, 0));
        }
        for ring in 1..=max_radius {
            // Walk the ring's perimeter: top & bottom rows (inclusive
            // of corners), then left & right columns (excluding the
            // corners already covered). First passable cell wins.
            for dx in -ring..=ring {
                for dy in [-ring, ring] {
                    if crate::logic::location::is_within_city_grid(
                        dx,
                        dy,
                        self.width_grid,
                        self.height_grid,
                    ) && biome::is_passable_biome(biome::biome_at(
                        self.biome_seed,
                        dx,
                        dy,
                        &knobs,
                    )) {
                        return Some((dx, dy));
                    }
                }
            }
            for dy in (-ring + 1)..ring {
                for dx in [-ring, ring] {
                    if crate::logic::location::is_within_city_grid(
                        dx,
                        dy,
                        self.width_grid,
                        self.height_grid,
                    ) && biome::is_passable_biome(biome::biome_at(
                        self.biome_seed,
                        dx,
                        dy,
                        &knobs,
                    )) {
                        return Some((dx, dy));
                    }
                }
            }
        }
        None
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

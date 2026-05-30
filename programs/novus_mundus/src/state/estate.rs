use crate::constants::ESTATE_SEED;
use pinocchio::{error::ProgramError, Address};

// Building Types (19 buildings across 3 tiers)

/// Building types available in the Estate System
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum BuildingType {
    Mansion = 0,
    Barracks = 1,
    Workshop = 2,
    Vault = 3,
    Dock = 4, // Fishing expeditions (parallel to Workshop for mining)

    Forge = 5,
    Market = 6,
    Academy = 7,
    Arena = 8,

    MeditationChamber = 9,
    Observatory = 10,
    Treasury = 11,
    Citadel = 12,

    Camp = 13, // Operative unit hiring
    Mine = 14, // Mining expeditions
    DungeonEntry = 15, // Dungeon access
    Farm = 16, // Produce collection
    TransportBay = 17, // Travel gating
    Infirmary = 18, // Unit recovery in combat
}

impl BuildingType {
    pub const COUNT: usize = 19;

    /// Get the estate level required to unlock this building type
    ///
    /// Story-based progression: buildings unlock one by one as player grows.
    /// Early game focuses on basics, mid-game opens heroes/rallies, late-game
    /// adds crafting mastery and competitive features.
    pub const fn required_estate_level(self) -> u8 {
        match self {
            // Chapter 1: Foundation - all buildable from start
            // Estate level = sum of building levels, grows naturally
            BuildingType::Mansion => 0, // Your home base - first building
            BuildingType::Barracks => 0, // Recruit your first units
            BuildingType::Workshop => 0, // Mining expeditions
            BuildingType::Dock => 0,    // Fishing expeditions
            BuildingType::Vault => 0,   // Secure your wealth

            // Chapter 2: Expansion (Levels 5-10)
            // NOTE: All set to 0 during SDK development for testability
            BuildingType::MeditationChamber => 0, // Recruit your first hero!
            BuildingType::Market => 0,            // Trade with others
            BuildingType::Citadel => 0,           // Lead your first rally!
            BuildingType::Academy => 0,           // Begin research

            // Chapter 3: Mastery (Levels 10-16)
            BuildingType::Forge => 0,       // Craft quality equipment
            BuildingType::Arena => 0,       // Prove yourself in PvP
            BuildingType::Observatory => 0, // Enhance your loot
            BuildingType::Treasury => 0,    // Maximize your prizes

            // Expansion buildings (all 0 during development for testability)
            BuildingType::Camp => 0,         // Operative unit hiring
            BuildingType::Mine => 0,         // Mining expeditions
            BuildingType::DungeonEntry => 0, // Dungeon access
            BuildingType::Farm => 0,         // Produce collection
            BuildingType::TransportBay => 0, // Travel gating
            BuildingType::Infirmary => 0,    // Unit recovery
        }
    }

    /// Get the tier (1, 2, or 3) for this building
    /// Tier determines base cost and construction time
    pub const fn tier(self) -> u8 {
        match self {
            // Chapter 1: Foundation - Tier 1 (10k NOVI, 4h)
            BuildingType::Mansion
            | BuildingType::Barracks
            | BuildingType::Workshop
            | BuildingType::Vault
            | BuildingType::Dock
            | BuildingType::Camp
            | BuildingType::Farm => 1,

            // Chapter 2: Expansion - Tier 2 (50k NOVI, 12h)
            BuildingType::MeditationChamber
            | BuildingType::Market
            | BuildingType::Citadel
            | BuildingType::Academy
            | BuildingType::Mine
            | BuildingType::TransportBay => 2,

            // Chapter 3: Mastery - Tier 3 (200k NOVI, 24h)
            BuildingType::Forge
            | BuildingType::Arena
            | BuildingType::Observatory
            | BuildingType::Treasury
            | BuildingType::DungeonEntry
            | BuildingType::Infirmary => 3,
        }
    }

    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Mansion),
            1 => Some(Self::Barracks),
            2 => Some(Self::Workshop),
            3 => Some(Self::Vault),
            4 => Some(Self::Dock),
            5 => Some(Self::Forge),
            6 => Some(Self::Market),
            7 => Some(Self::Academy),
            8 => Some(Self::Arena),
            9 => Some(Self::MeditationChamber),
            10 => Some(Self::Observatory),
            11 => Some(Self::Treasury),
            12 => Some(Self::Citadel),
            13 => Some(Self::Camp),
            14 => Some(Self::Mine),
            15 => Some(Self::DungeonEntry),
            16 => Some(Self::Farm),
            17 => Some(Self::TransportBay),
            18 => Some(Self::Infirmary),
            _ => None,
        }
    }
}

// Building Status

/// Status of a building
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum BuildingStatus {
    Empty = 0,     // Slot has no building
    Building = 1,  // Under initial construction
    Active = 2,    // Fully operational
    Upgrading = 3, // Being upgraded (still provides buffs at current level)
}

impl BuildingStatus {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Empty),
            1 => Some(Self::Building),
            2 => Some(Self::Active),
            3 => Some(Self::Upgrading),
            _ => None,
        }
    }
}

// Quality Tier System (8 tiers)

/// Equipment quality tiers (8 tiers with φ² scaling)
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum QualityTier {
    Common = 0,  // Shop-bought baseline
    Refined = 1, // First craftable tier
    Superior = 2,
    Elite = 3,
    Masterwork = 4,
    Legendary = 5,
    Mythic = 6,
    Divine = 7, // Ultimate tier
}

impl QualityTier {
    pub const COUNT: usize = 8;

    /// Buff per item at this quality tier (basis points)
    pub const fn buff_bps(self) -> u16 {
        match self {
            QualityTier::Common => 0,
            QualityTier::Refined => 4,
            QualityTier::Superior => 9,
            QualityTier::Elite => 15,
            QualityTier::Masterwork => 24,
            QualityTier::Legendary => 38,
            QualityTier::Mythic => 62,
            QualityTier::Divine => 100,
        }
    }

    /// NOVI cost to craft at this tier
    pub const fn novi_cost(self) -> u64 {
        match self {
            QualityTier::Common => 0,
            QualityTier::Refined => 1_000,
            QualityTier::Superior => 2_618,
            QualityTier::Elite => 6_854,
            QualityTier::Masterwork => 17_944,
            QualityTier::Legendary => 46_979,
            QualityTier::Mythic => 122_991,
            QualityTier::Divine => 322_069,
        }
    }

    /// Base craft time in seconds
    pub const fn craft_time_seconds(self) -> i64 {
        match self {
            QualityTier::Common => 0,
            QualityTier::Refined => 4 * 3600,     // 4h
            QualityTier::Superior => 8 * 3600,    // 8h
            QualityTier::Elite => 16 * 3600,      // 16h
            QualityTier::Masterwork => 24 * 3600, // 24h
            QualityTier::Legendary => 48 * 3600,  // 48h
            QualityTier::Mythic => 72 * 3600,     // 72h
            QualityTier::Divine => 168 * 3600,    // 7 days
        }
    }

    /// Base success rate (basis points, 10000 = 100%)
    pub const fn success_rate_bps(self) -> u16 {
        match self {
            QualityTier::Common => 10000,
            QualityTier::Refined => 10000,   // 100%
            QualityTier::Superior => 9500,   // 95%
            QualityTier::Elite => 8500,      // 85%
            QualityTier::Masterwork => 7000, // 70%
            QualityTier::Legendary => 5000,  // 50%
            QualityTier::Mythic => 3000,     // 30%
            QualityTier::Divine => 1500,     // 15%
        }
    }

    /// Required Forge level to craft this tier
    pub const fn required_forge_level(self) -> u8 {
        match self {
            QualityTier::Common => 0,
            QualityTier::Refined => 1,
            QualityTier::Superior => 5,
            QualityTier::Elite => 8,
            QualityTier::Masterwork => 12,
            QualityTier::Legendary => 16,
            QualityTier::Mythic => 18,
            QualityTier::Divine => 20,
        }
    }

    /// Required Mastery level to craft this tier
    pub const fn required_mastery_level(self) -> u8 {
        match self {
            QualityTier::Common => 0,
            QualityTier::Refined => 1,
            QualityTier::Superior => 5,
            QualityTier::Elite => 15,
            QualityTier::Masterwork => 30,
            QualityTier::Legendary => 50,
            QualityTier::Mythic => 75,
            QualityTier::Divine => 100,
        }
    }

    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Common),
            1 => Some(Self::Refined),
            2 => Some(Self::Superior),
            3 => Some(Self::Elite),
            4 => Some(Self::Masterwork),
            5 => Some(Self::Legendary),
            6 => Some(Self::Mythic),
            7 => Some(Self::Divine),
            _ => None,
        }
    }

    /// Material cost to craft at this tier
    /// Returns (common, uncommon, rare, epic, legendary)
    ///
    /// Design: Lower tiers use common materials, higher tiers use rarer materials.
    /// Materials transition progressively - you graduate from one material type to the next.
    pub const fn material_cost(self) -> (u64, u64, u64, u64, u64) {
        match self {
            // Common cannot be crafted
            QualityTier::Common => (0, 0, 0, 0, 0),
            // Tier 1: Entry level - just common materials
            QualityTier::Refined => (50, 0, 0, 0, 0),
            // Tier 2: Transitioning to uncommon
            QualityTier::Superior => (100, 25, 0, 0, 0),
            // Tier 3: Moved to uncommon + rare
            QualityTier::Elite => (0, 100, 25, 0, 0),
            // Tier 4: Moved to rare + epic
            QualityTier::Masterwork => (0, 0, 100, 25, 0),
            // Tier 5: Moved to epic + legendary
            QualityTier::Legendary => (0, 0, 0, 100, 25),
            // Tier 6: Pure legendary
            QualityTier::Mythic => (0, 0, 0, 0, 200),
            // Tier 7: Massive legendary investment
            QualityTier::Divine => (0, 0, 0, 0, 400),
        }
    }

    // Staged Tempering System

    /// Stages required for this tier - Fibonacci-inspired progression
    /// More stages = more skill required to complete the craft
    pub const fn stages_required(&self) -> u8 {
        match self {
            Self::Common => 0,     // Cannot craft Common
            Self::Refined => 1,    // Single strike - anyone can do it
            Self::Superior => 2,   // Basic tempering
            Self::Elite => 3,      // Journeyman work
            Self::Masterwork => 5, // Serious dedication
            Self::Legendary => 8,  // Master craftsman
            Self::Mythic => 11,    // Approaching perfection
            Self::Divine => 13,    // Absolute perfection
        }
    }

    /// Time between stages in seconds
    /// Higher tiers = faster rhythm required (more intense focus)
    pub const fn stage_interval_secs(&self) -> i64 {
        match self {
            Self::Common => 0,
            Self::Refined => 60, // 1 minute - relaxed
            Self::Superior => 50,
            Self::Elite => 40,
            Self::Masterwork => 30,
            Self::Legendary => 25,
            Self::Mythic => 20,
            Self::Divine => 15, // 15 seconds - intense focus
        }
    }

    /// Base window duration in seconds (when the player can strike)
    /// Higher tiers = tighter windows (requires more precise timing)
    pub const fn base_window_duration_secs(&self) -> i64 {
        match self {
            Self::Common => 0,
            Self::Refined => 3600,   // 1 hour - very forgiving
            Self::Superior => 1800,  // 30 min
            Self::Elite => 900,      // 15 min
            Self::Masterwork => 300, // 5 min
            Self::Legendary => 120,  // 2 min
            Self::Mythic => 90,      // 1.5 min
            Self::Divine => 60,      // 1 min - razor sharp timing
        }
    }
}

// Building Slot (stored in EstateAccount)

/// A single building slot in the estate
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BuildingSlot {
    pub building_type: u8,         // BuildingType enum
    pub status: u8,                // BuildingStatus enum
    pub level: u8,                 // Current level (1-20)
    pub mastery_level: u8,         // Building-specific mastery (1-100)
    pub mastery_xp: u32,           // XP towards next mastery level
    pub construction_started: i64, // When construction/upgrade started
    pub construction_ends: i64,    // When construction/upgrade completes
    pub total_novi_invested: u64,  // Lifetime NOVI spent on this building
    pub _padding: [u8; 4],
}

impl BuildingSlot {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub const EMPTY: Self = Self {
        building_type: 0,
        status: BuildingStatus::Empty as u8,
        level: 0,
        mastery_level: 0,
        mastery_xp: 0,
        construction_started: 0,
        construction_ends: 0,
        total_novi_invested: 0,
        _padding: [0; 4],
    };

    /// Check if this slot is empty
    pub fn is_empty(&self) -> bool {
        self.status == BuildingStatus::Empty as u8
    }

    /// Check if building is active (can be used)
    pub fn is_active(&self) -> bool {
        self.status == BuildingStatus::Active as u8
            || self.status == BuildingStatus::Upgrading as u8
    }

    /// Check if construction/upgrade is complete
    pub fn is_construction_complete(&self, now: i64) -> bool {
        (self.status == BuildingStatus::Building as u8
            || self.status == BuildingStatus::Upgrading as u8)
            && now >= self.construction_ends
    }

    // Build/upgrade cost and time are read from the on-chain BuildingTemplate
    // config account (see state/building_template.rs), not derived here.

    /// Calculate mastery XP needed for next level
    pub fn mastery_xp_for_next_level(&self) -> u32 {
        // XP = 100 × level² (quadratic growth)
        let next = (self.mastery_level + 1) as u32;
        100 * next * next
    }
}

// Estate Account (Main PDA)

/// Maximum building slots per estate (5 plots × 4 buildings)
pub const MAX_BUILDING_SLOTS: usize = 20;

/// Initial building slots (1 plot × 4 buildings)
pub const INITIAL_BUILDING_SLOTS: usize = 4;

/// Building slots per plot
pub const SLOTS_PER_PLOT: usize = 4;

/// Estate Account - Player's personal estate containing all buildings
///
/// # Slot Management
/// - `current_slots`: Soft cap on usable slots (unlocked via plots)
/// - `plots_owned`: Number of land plots (1-5), each unlocks 4 slots
/// - `total_buildings`: Count of non-empty building slots
///
/// The `buildings` array is fixed at MAX_BUILDING_SLOTS (20) but players
/// can only use slots up to `min(current_slots, plots_owned * 4)`.
/// Buying more plots increases both `plots_owned` and `current_slots`.
///
/// # Future Expansion
/// The `buildings` array is at the END of this struct. To support more than
/// 20 buildings in the future, increase MAX_BUILDING_SLOTS and reallocate
/// accounts to the new size.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct EstateAccount {
    /// Account discriminator
    pub account_key: u8,
    // Identity (35 bytes)
    pub owner: Address, // Player who owns this estate
    pub city_id: u16,   // City where estate is located
    pub bump: u8,

    // Progression (4 bytes)
    pub estate_level: u8,    // Sum of all building levels
    pub plots_owned: u8,     // Number of land plots (1-5)
    pub total_buildings: u8, // Number of non-empty slots
    pub current_slots: u8,   // Allocated slot capacity (for expansion)

    // Cached buffs (28 bytes - updated when buildings change)
    pub attack_bps: u16,
    pub defense_bps: u16,
    pub resource_gen_bps: u16,
    pub xp_gain_bps: u16,
    pub storage_bps: u16,
    pub training_speed_bps: u16,
    pub research_speed_bps: u16,
    pub craft_success_bps: u16,
    pub trade_discount_bps: u16,
    pub novi_cap_bonus_bps: u16,
    pub loot_bonus_bps: u16,
    pub prize_bonus_bps: u16,
    pub rally_capacity_bonus_bps: u16,
    pub pvp_damage_bps: u16,

    // Daily activity tracking (23 bytes)
    pub last_login_date: u16,      // Days since epoch
    pub login_streak: u16,         // Current consecutive days
    pub longest_login_streak: u16, // Best ever
    pub permanent_bonus_bps: u16,  // From 180-day milestone (+5%)
    pub daily_date: u16,           // Current day for mini-games
    pub dawn_timestamp: i64,       // When player started today
    pub windows_completed: u8,     // Bitflags: 0b00000DML
    pub dawn_buildings: u16,       // Bitflags for completed dawn activities
    pub midday_buildings: u16,     // Bitflags for completed midday activities
    pub dusk_buildings: u16,       // Bitflags for completed dusk activities

    // Active daily buffs (43 bytes)
    pub unit_effectiveness_bps: u16, // From Barracks mini-game
    pub mastery_bonus_bps: u16,      // From Forge mini-game
    pub arena_damage_bps: u16,       // From Arena mini-game
    pub daily_loot_bonus_bps: u16,   // From Observatory mini-game
    pub market_discount_bps: u16,    // From Market mini-game
    pub blessed_hero: Address,       // From MeditationChamber mini-game
    pub citadel_stance: u8,          // From Citadel mini-game

    // Timestamps (16 bytes)
    pub created_at: i64,
    pub last_activity: i64,

    // Daily buffs from expansion buildings (7 bytes, carved from _reserved)
    pub camp_discount_bps: u16,            // From Camp mini-game
    pub stables_speed_bps: u16,            // From TransportBay mini-game (legacy field name)
    pub infirmary_recovery_daily_bps: u16, // From Infirmary mini-game
    pub expansion_daily: u8,               // Bitflags for buildings 16+ daily completion

    // Wounded units (from Infirmary tracking) (24 bytes)
    // Stored as [u8; 4] to avoid alignment padding in #[repr(C)] after u8 field above
    pub wounded_def_1: [u8; 4],
    pub wounded_def_2: [u8; 4],
    pub wounded_def_3: [u8; 4],
    pub wounded_op_1: [u8; 4],
    pub wounded_op_2: [u8; 4],
    pub wounded_op_3: [u8; 4],

    // Reserved for future fixed fields (1 byte)
    pub _reserved: [u8; 1],

    // MUST BE LAST: Building slots (expandable)
    // Current: 20 slots (5 plots × 4 buildings each)
    // Each BuildingSlot is 36 bytes, so 20 × 36 = 720 bytes
    // To expand: reallocate account with more slots
    pub buildings: [BuildingSlot; MAX_BUILDING_SLOTS],
}

impl EstateAccount {
    /// Total size with default MAX_BUILDING_SLOTS
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Size of all fixed fields before the buildings array
    /// This is: LEN - (MAX_BUILDING_SLOTS * BuildingSlot::LEN)
    pub const HEADER_SIZE: usize = Self::LEN - (MAX_BUILDING_SLOTS * BuildingSlot::LEN);

    /// Initial account size (1 plot = 4 slots)
    pub const INITIAL_LEN: usize = Self::HEADER_SIZE + (INITIAL_BUILDING_SLOTS * BuildingSlot::LEN);

    // --- Wounded field accessors (stored as [u8; 4] for alignment) ---
    #[inline]
    pub fn get_wounded_def_1(&self) -> u32 {
        u32::from_le_bytes(self.wounded_def_1)
    }
    #[inline]
    pub fn get_wounded_def_2(&self) -> u32 {
        u32::from_le_bytes(self.wounded_def_2)
    }
    #[inline]
    pub fn get_wounded_def_3(&self) -> u32 {
        u32::from_le_bytes(self.wounded_def_3)
    }
    #[inline]
    pub fn get_wounded_op_1(&self) -> u32 {
        u32::from_le_bytes(self.wounded_op_1)
    }
    #[inline]
    pub fn get_wounded_op_2(&self) -> u32 {
        u32::from_le_bytes(self.wounded_op_2)
    }
    #[inline]
    pub fn get_wounded_op_3(&self) -> u32 {
        u32::from_le_bytes(self.wounded_op_3)
    }

    #[inline]
    pub fn set_wounded_def_1(&mut self, v: u32) {
        self.wounded_def_1 = v.to_le_bytes();
    }
    #[inline]
    pub fn set_wounded_def_2(&mut self, v: u32) {
        self.wounded_def_2 = v.to_le_bytes();
    }
    #[inline]
    pub fn set_wounded_def_3(&mut self, v: u32) {
        self.wounded_def_3 = v.to_le_bytes();
    }
    #[inline]
    pub fn set_wounded_op_1(&mut self, v: u32) {
        self.wounded_op_1 = v.to_le_bytes();
    }
    #[inline]
    pub fn set_wounded_op_2(&mut self, v: u32) {
        self.wounded_op_2 = v.to_le_bytes();
    }
    #[inline]
    pub fn set_wounded_op_3(&mut self, v: u32) {
        self.wounded_op_3 = v.to_le_bytes();
    }

    /// Calculate required account size for a given number of slots
    #[inline]
    pub const fn size_for_slots(num_slots: usize) -> usize {
        Self::HEADER_SIZE + (num_slots * BuildingSlot::LEN)
    }

    /// Calculate how many slots can fit in a given data length
    #[inline]
    pub const fn slots_for_size(data_len: usize) -> usize {
        if data_len <= Self::HEADER_SIZE {
            0
        } else {
            (data_len - Self::HEADER_SIZE) / BuildingSlot::LEN
        }
    }

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Update current_slots after account reallocation
    /// Call this after successfully reallocating the account to a larger size
    /// Returns the new slot count, or None if data is too small
    pub fn expand_slots(&mut self, new_data_len: usize) -> Option<u8> {
        let new_slots = Self::slots_for_size(new_data_len);
        if new_slots == 0 {
            return None;
        }

        let old_slots = self.current_slots as usize;

        // Initialize any new slots to EMPTY
        for i in old_slots..new_slots.min(255) {
            if i < MAX_BUILDING_SLOTS {
                self.buildings[i] = BuildingSlot::EMPTY;
            }
        }

        self.current_slots = new_slots.min(255) as u8;
        Some(self.current_slots)
    }

    /// Check if account needs reallocation for more slots
    pub fn needs_expansion(&self, desired_slots: usize) -> bool {
        desired_slots > self.current_slots as usize
    }

    /// Get the data length required to support desired_slots
    pub fn required_size(&self, desired_slots: usize) -> usize {
        Self::size_for_slots(desired_slots)
    }

    /// Buy an additional plot (unlocks 4 more slots)
    /// Returns new plots_owned count, or None if max plots reached
    pub fn buy_plot(&mut self) -> Option<u8> {
        const MAX_PLOTS: u8 = 5;

        if self.plots_owned >= MAX_PLOTS {
            return None; // Max plots reached
        }

        self.plots_owned = self.plots_owned.saturating_add(1);

        // Unlock 4 more slots (capped by array size)
        let new_slots = (self.plots_owned as usize) * SLOTS_PER_PLOT;
        self.current_slots = new_slots.min(MAX_BUILDING_SLOTS) as u8;

        Some(self.plots_owned)
    }

    /// Get cost for next plot (φ² scaling)
    pub fn next_plot_cost(&self) -> Option<u64> {
        // NOVI has 1 decimal on-chain (mint decimals=1), so display NOVI × 10
        // = raw token-units. 100k NOVI display = 1_000_000 raw.
        const BASE_PLOT_COST: u64 = 1_000_000; // 100k NOVI for plot 2 (with 1 decimal)

        match self.plots_owned {
            1 => Some(BASE_PLOT_COST),                // Plot 2: 100k
            2 => Some(BASE_PLOT_COST * 2618 / 1000),  // Plot 3: ~262k
            3 => Some(BASE_PLOT_COST * 6854 / 1000),  // Plot 4: ~685k
            4 => Some(BASE_PLOT_COST * 17944 / 1000), // Plot 5: ~1.79M
            _ => None,                                // Max plots owned
        }
    }

    /// Initialize a new estate
    pub fn init(owner: Address, city_id: u16, now: i64, bump: u8) -> Self {
        Self {
            account_key: crate::state::AccountKey::Estate as u8,
            // Identity
            owner,
            city_id,
            bump,

            // Progression: sum of all building levels, starts at 0
            estate_level: 0,
            plots_owned: 1, // Start with 1 plot
            total_buildings: 0,
            current_slots: 4, // 1 plot = 4 slots initially

            // Buffs start at 0
            attack_bps: 0,
            defense_bps: 0,
            resource_gen_bps: 0,
            xp_gain_bps: 0,
            storage_bps: 0,
            training_speed_bps: 0,
            research_speed_bps: 0,
            craft_success_bps: 0,
            trade_discount_bps: 0,
            novi_cap_bonus_bps: 0,
            loot_bonus_bps: 0,
            prize_bonus_bps: 0,
            rally_capacity_bonus_bps: 0,
            pvp_damage_bps: 0,

            // Daily tracking
            last_login_date: 0,
            login_streak: 0,
            longest_login_streak: 0,
            permanent_bonus_bps: 0,
            daily_date: 0,
            dawn_timestamp: 0,
            windows_completed: 0,
            dawn_buildings: 0,
            midday_buildings: 0,
            dusk_buildings: 0,

            // Daily buffs
            unit_effectiveness_bps: 0,
            mastery_bonus_bps: 0,
            arena_damage_bps: 0,
            daily_loot_bonus_bps: 0,
            market_discount_bps: 0,
            blessed_hero: Address::default(),
            citadel_stance: 0,
            camp_discount_bps: 0,
            stables_speed_bps: 0,
            infirmary_recovery_daily_bps: 0,
            expansion_daily: 0,

            // Timestamps
            created_at: now,
            last_activity: now,

            // Wounded units (Infirmary tracking)
            wounded_def_1: [0; 4],
            wounded_def_2: [0; 4],
            wounded_def_3: [0; 4],
            wounded_op_1: [0; 4],
            wounded_op_2: [0; 4],
            wounded_op_3: [0; 4],

            // Reserved
            _reserved: [0; 1],

            // Buildings (MUST BE LAST for expansion)
            buildings: [BuildingSlot::EMPTY; MAX_BUILDING_SLOTS],
        }
    }

    /// Get maximum building slots available (4 per plot)
    pub fn max_slots(&self) -> usize {
        (self.plots_owned as usize) * 4
    }

    /// Find first empty slot index
    pub fn find_empty_slot(&self) -> Option<usize> {
        let max = self.max_slots();
        for i in 0..max {
            if self.buildings[i].is_empty() {
                return Some(i);
            }
        }
        None
    }

    /// Find building by type
    pub fn find_building(&self, building_type: BuildingType) -> Option<&BuildingSlot> {
        self.buildings
            .iter()
            .take(self.max_slots())
            .find(|b| b.building_type == building_type as u8 && !b.is_empty())
    }

    /// Find building by type (mutable)
    pub fn find_building_mut(&mut self, building_type: BuildingType) -> Option<&mut BuildingSlot> {
        let max = self.max_slots();
        self.buildings
            .iter_mut()
            .take(max)
            .find(|b| b.building_type == building_type as u8 && !b.is_empty())
    }

    /// Check if player has a building at minimum level
    pub fn has_building_at_level(&self, building_type: BuildingType, min_level: u8) -> bool {
        self.find_building(building_type)
            .map(|b| b.is_active() && b.level >= min_level)
            .unwrap_or(false)
    }

    // Building Slot Access (index-based)

    /// Get allocated capacity (for expansion tracking)
    #[inline]
    pub fn capacity(&self) -> usize {
        self.current_slots as usize
    }

    /// Get usable slots (based on plots owned, capped by capacity)
    #[inline]
    pub fn usable_slots(&self) -> usize {
        let plot_slots = (self.plots_owned as usize) * 4;
        plot_slots.min(self.capacity())
    }

    /// Get building at index (read-only)
    /// Returns None if index is out of bounds
    #[inline]
    pub fn get_building(&self, index: usize) -> Option<&BuildingSlot> {
        if index < self.capacity() {
            Some(&self.buildings[index])
        } else {
            None
        }
    }

    /// Get building at index (mutable)
    /// Returns None if index is out of bounds
    #[inline]
    pub fn get_building_mut(&mut self, index: usize) -> Option<&mut BuildingSlot> {
        if index < self.capacity() {
            Some(&mut self.buildings[index])
        } else {
            None
        }
    }

    /// Insert/set a building at a specific slot index
    /// Returns false if index is out of usable range
    pub fn set_building(&mut self, index: usize, slot: BuildingSlot) -> bool {
        if index >= self.usable_slots() {
            return false;
        }

        let was_empty = self.buildings[index].is_empty();
        let is_empty = slot.is_empty();

        self.buildings[index] = slot;

        // Update total_buildings count
        if was_empty && !is_empty {
            self.total_buildings = self.total_buildings.saturating_add(1);
        } else if !was_empty && is_empty {
            self.total_buildings = self.total_buildings.saturating_sub(1);
        }

        true
    }

    /// Clear a building slot (remove building)
    /// Returns the removed building, or None if index invalid or already empty
    pub fn remove_building(&mut self, index: usize) -> Option<BuildingSlot> {
        if index >= self.usable_slots() {
            return None;
        }

        let slot = &mut self.buildings[index];
        if slot.is_empty() {
            return None;
        }

        let removed = *slot;
        *slot = BuildingSlot::EMPTY;
        self.total_buildings = self.total_buildings.saturating_sub(1);

        Some(removed)
    }

    /// Insert a new building into the first available empty slot
    /// Returns the index where it was inserted, or None if no space
    pub fn insert_building(&mut self, building_type: BuildingType, now: i64) -> Option<usize> {
        // Check if this building type already exists
        if self.find_building(building_type).is_some() {
            return None; // Building type already exists
        }

        // Find empty slot
        let index = self.find_empty_slot()?;

        // Initialize the building slot
        self.buildings[index] = BuildingSlot {
            building_type: building_type as u8,
            status: BuildingStatus::Building as u8,
            level: 0, // Will become 1 when construction completes
            mastery_level: 0,
            mastery_xp: 0,
            construction_started: now,
            construction_ends: 0, // Caller should set this
            total_novi_invested: 0,
            _padding: [0; 4],
        };

        self.total_buildings = self.total_buildings.saturating_add(1);
        Some(index)
    }

    /// Iterate over all non-empty buildings
    pub fn iter_buildings(&self) -> impl Iterator<Item = (usize, &BuildingSlot)> {
        self.buildings[..self.usable_slots()]
            .iter()
            .enumerate()
            .filter(|(_, b)| !b.is_empty())
    }

    /// Iterate over all non-empty buildings (mutable)
    pub fn iter_buildings_mut(&mut self) -> impl Iterator<Item = (usize, &mut BuildingSlot)> {
        let usable = self.usable_slots();
        self.buildings[..usable]
            .iter_mut()
            .enumerate()
            .filter(|(_, b)| !b.is_empty())
    }

    /// Count active (usable) buildings
    pub fn count_active_buildings(&self) -> usize {
        self.buildings[..self.usable_slots()]
            .iter()
            .filter(|b| b.is_active())
            .count()
    }

    // Recalculation Methods

    /// Recalculate estate level (sum of all building levels)
    pub fn recalculate_estate_level(&mut self) {
        let mut total: u16 = 0;
        for i in 0..self.max_slots() {
            if !self.buildings[i].is_empty() {
                total = total.saturating_add(self.buildings[i].level as u16);
            }
        }
        self.estate_level = total.min(255) as u8;
    }

    /// Recalculate all building buffs
    pub fn recalculate_buffs(&mut self) {
        // Reset all
        self.attack_bps = 0;
        self.defense_bps = 0;
        self.resource_gen_bps = 0;
        self.xp_gain_bps = 0;
        self.storage_bps = 0;
        self.training_speed_bps = 0;
        self.research_speed_bps = 0;
        self.craft_success_bps = 0;
        self.trade_discount_bps = 0;
        self.novi_cap_bonus_bps = 0;
        self.loot_bonus_bps = 0;
        self.prize_bonus_bps = 0;
        self.rally_capacity_bonus_bps = 0;
        self.pvp_damage_bps = 0;

        for i in 0..self.max_slots() {
            let building = &self.buildings[i];
            if !building.is_active() {
                continue;
            }

            let level = building.level as u16;
            let buff_per_level: u16 = 50; // 0.5% per level base

            match BuildingType::from_u8(building.building_type) {
                Some(BuildingType::Mansion) => {
                    // Mansion: XP and daily reward bonuses
                    self.xp_gain_bps = self.xp_gain_bps.saturating_add(level * buff_per_level);
                }
                Some(BuildingType::Barracks) => {
                    // Barracks: Attack and training speed
                    self.attack_bps = self.attack_bps.saturating_add(level * buff_per_level);
                    self.training_speed_bps = self
                        .training_speed_bps
                        .saturating_add(level * buff_per_level / 2);
                }
                Some(BuildingType::Workshop) => {
                    // Workshop: Mining bonus calculated dynamically via workshop_mining_bonus_bps()
                }
                Some(BuildingType::Dock) => {
                    // Dock: Fishing bonus calculated dynamically via dock_fishing_bonus_bps()
                }
                Some(BuildingType::Vault) => {
                    // Vault: Storage and NOVI cap
                    self.storage_bps = self.storage_bps.saturating_add(level * buff_per_level);
                    self.novi_cap_bonus_bps = self.novi_cap_bonus_bps.saturating_add(level * 250);
                    // 2.5% per level
                }
                Some(BuildingType::Forge) => {
                    // Forge: Craft success rate
                    self.craft_success_bps = self
                        .craft_success_bps
                        .saturating_add(level * buff_per_level * 3); // 1.5% per level
                }
                Some(BuildingType::Market) => {
                    // Market: Trade discount
                    self.trade_discount_bps = self.trade_discount_bps.saturating_add(level * 100);
                    // 1% per level
                }
                Some(BuildingType::Academy) => {
                    // Academy: Research speed
                    self.research_speed_bps = self
                        .research_speed_bps
                        .saturating_add(level * buff_per_level * 3); // 1.5% per level
                }
                Some(BuildingType::Arena) => {
                    // Arena: PvP damage
                    self.pvp_damage_bps =
                        self.pvp_damage_bps.saturating_add(level * buff_per_level);
                }
                Some(BuildingType::MeditationChamber) => {
                    // MeditationChamber: No direct buff, enables hero slots
                }
                Some(BuildingType::Observatory) => {
                    // Observatory: Loot bonus
                    self.loot_bonus_bps = self
                        .loot_bonus_bps
                        .saturating_add(level * buff_per_level * 2); // 1% per level
                }
                Some(BuildingType::Treasury) => {
                    // Treasury: Prize bonus
                    self.prize_bonus_bps = self.prize_bonus_bps.saturating_add(level * 250);
                    // 2.5% per level
                }
                Some(BuildingType::Citadel) => {
                    // Citadel: Defense and rally capacity
                    self.defense_bps = self.defense_bps.saturating_add(level * buff_per_level);
                    self.rally_capacity_bonus_bps =
                        self.rally_capacity_bonus_bps.saturating_add(level * 500);
                    // 5% per level
                }
                Some(BuildingType::Camp) => {
                    // Camp: Operative training speed (shares field with Barracks)
                    self.training_speed_bps = self
                        .training_speed_bps
                        .saturating_add(level * buff_per_level / 2);
                }
                Some(BuildingType::Mine) => {
                    // Mine: Resource generation bonus (mining)
                    self.resource_gen_bps =
                        self.resource_gen_bps.saturating_add(level * buff_per_level);
                }
                Some(BuildingType::DungeonEntry) => {
                    // DungeonEntry: Loot bonus (dungeon loot, additive with Observatory)
                    self.loot_bonus_bps =
                        self.loot_bonus_bps.saturating_add(level * buff_per_level);
                }
                Some(BuildingType::Farm) => {
                    // Farm: Resource generation bonus (farming, additive with Mine)
                    self.resource_gen_bps =
                        self.resource_gen_bps.saturating_add(level * buff_per_level);
                }
                Some(BuildingType::TransportBay) => {
                    // TransportBay: No cached buff (computed dynamically via stables_travel_reduction_bps)
                }
                Some(BuildingType::Infirmary) => {
                    // Infirmary: No cached buff (computed dynamically via infirmary_recovery_bps)
                }
                None => {}
            }
        }
    }

    /// Check if login streak should be reset (new day)
    pub fn check_login_streak(&mut self, now: i64) -> bool {
        let current_day = (now / 86400) as u16;

        if current_day == self.last_login_date {
            // Same day, no change
            return false;
        }

        if current_day == self.last_login_date + 1 {
            // Consecutive day - increment streak
            self.login_streak = self.login_streak.saturating_add(1);
            if self.login_streak > self.longest_login_streak {
                self.longest_login_streak = self.login_streak;
            }

            // Check 180-day milestone for permanent bonus
            if self.login_streak >= 180 && self.permanent_bonus_bps == 0 {
                self.permanent_bonus_bps = 500; // +5% permanent bonus
            }
        } else {
            // Missed day(s) - reset streak
            self.login_streak = 1;
        }

        self.last_login_date = current_day;
        true // New day
    }

    /// Get streak multiplier (basis points)
    pub fn get_streak_multiplier_bps(&self) -> u16 {
        match self.login_streak {
            0..=6 => 10000,   // 1.0x
            7..=13 => 12500,  // 1.25x
            14..=29 => 15000, // 1.5x
            30..=59 => 20000, // 2.0x
            60..=89 => 25000, // 2.5x
            _ => 30000,       // 3.0x (90+ days)
        }
    }

    /// Derive the PDA for an estate account (scoped to player PDA)
    pub fn derive_pda(player_pda: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(&[ESTATE_SEED, player_pda.as_ref()], &crate::ID)
    }

    /// Create PDA from known bump
    pub fn create_pda(player_pda: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[ESTATE_SEED, player_pda.as_ref(), &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify an EstateAccount immutably.
    /// Checks: program ownership, PDA derivation (via player_pda), owner field, bump field.
    pub fn load_checked<'a>(
        account: &'a pinocchio::AccountView,
        player_pda: &Address,
        expected_owner: &Address,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(player_pda);
        crate::validation::require_pda_eq(account, &expected_pda, "EstateAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::Estate, "EstateAccount")?
        };
        crate::validation::require_stored_owner(
            &loaded.owner,
            expected_owner,
            "EstateAccount",
            account,
        )?;
        crate::validation::require_bump_eq(loaded.bump, bump, "EstateAccount", account)?;
        Ok(loaded)
    }

    /// Load and verify an EstateAccount mutably.
    /// Checks: program ownership, PDA derivation (via player_pda), owner field, bump field.
    pub fn load_checked_mut<'a>(
        account: &'a pinocchio::AccountView,
        player_pda: &Address,
        expected_owner: &Address,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(player_pda);
        crate::validation::require_pda_eq(account, &expected_pda, "EstateAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::Estate,
                "EstateAccount",
            )?
        };
        crate::validation::require_stored_owner(
            &loaded.owner,
            expected_owner,
            "EstateAccount",
            account,
        )?;
        crate::validation::require_bump_eq(loaded.bump, bump, "EstateAccount", account)?;
        Ok(loaded)
    }
}

// Crafted Equipment (Quality tracking per equipment type)

/// Equipment types that can be crafted
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CraftableEquipment {
    MeleeWeapons = 0,
    RangedWeapons = 1,
    SiegeWeapons = 2,
    Armor = 3,
}

impl CraftableEquipment {
    pub const COUNT: usize = 4;

    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::MeleeWeapons),
            1 => Some(Self::RangedWeapons),
            2 => Some(Self::SiegeWeapons),
            3 => Some(Self::Armor),
            _ => None,
        }
    }
}

/// Quality counts per equipment type (8 tiers)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct QualityCounts {
    pub counts: [u32; QualityTier::COUNT], // Count of items at each quality tier
}

impl QualityCounts {
    pub const EMPTY: Self = Self {
        counts: [0; QualityTier::COUNT],
    };

    /// Get total items across all tiers
    pub fn total(&self) -> u64 {
        self.counts.iter().map(|&c| c as u64).sum()
    }

    /// Calculate total buff in basis points
    pub fn total_buff_bps(&self) -> u64 {
        let mut total: u64 = 0;
        for (tier, &count) in self.counts.iter().enumerate() {
            if let Some(qt) = QualityTier::from_u8(tier as u8) {
                total = total.saturating_add((count as u64) * (qt.buff_bps() as u64));
            }
        }
        total
    }
}

/// Crafted Equipment Account - Tracks quality distribution per player
///
/// Uses the Staged Tempering system for crafting:
/// - Each quality tier requires multiple "tempering stages"
/// - Each stage has a time window when the player must "strike"
/// - Missing a window = craft failure (deterministic, skill-based)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CraftedEquipmentAccount {
    pub owner: Address,

    // Quality counts per equipment type
    pub melee_weapons: QualityCounts,
    pub ranged_weapons: QualityCounts,
    pub siege_weapons: QualityCounts,
    pub armor: QualityCounts,

    // Staged Tempering State
    /// Equipment being crafted (CraftableEquipment enum, 255 = none)
    pub active_craft_equipment: u8,
    /// Target quality tier (QualityTier enum)
    pub target_tier: u8,
    /// Total stages required for this craft (calculated at start)
    pub stages_required: u8,
    /// Current stage waiting for (1-indexed, 0 = not started)
    pub current_stage: u8,
    /// Number of stages successfully completed
    pub stages_completed: u8,
    /// When current stage window opens (unix timestamp)
    pub window_opens_at: i64,
    /// When current stage window closes (unix timestamp)
    pub window_closes_at: i64,
    /// When the craft was initiated
    pub craft_started_at: i64,
    /// Accumulated precision score (0-10000 per stage average)
    pub precision_score: u16,

    // Stats
    pub total_crafts: u32,
    pub successful_crafts: u32,
    pub failed_crafts: u32,
    pub total_novi_spent: u64,

    // Equipped Tiers (per-type slots)
    /// Active melee weapon tier (0=none, 1-7=QualityTier)
    pub active_melee_tier: u8,
    /// Active ranged weapon tier (0=none, 1-7=QualityTier)
    pub active_ranged_tier: u8,
    /// Active siege weapon tier (0=none, 1-7=QualityTier)
    pub active_siege_tier: u8,
    /// Active armor tier (0=none, 1-7=QualityTier)
    pub active_armor_tier: u8,

    pub bump: u8,
    pub _padding: [u8; 3],
}

impl CraftedEquipmentAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn init(owner: Address, bump: u8) -> Self {
        Self {
            owner,
            melee_weapons: QualityCounts::EMPTY,
            ranged_weapons: QualityCounts::EMPTY,
            siege_weapons: QualityCounts::EMPTY,
            armor: QualityCounts::EMPTY,
            // Staged tempering state
            active_craft_equipment: 255,
            target_tier: 0,
            stages_required: 0,
            current_stage: 0,
            stages_completed: 0,
            window_opens_at: 0,
            window_closes_at: 0,
            craft_started_at: 0,
            precision_score: 0,
            // Stats
            total_crafts: 0,
            successful_crafts: 0,
            failed_crafts: 0,
            total_novi_spent: 0,
            // Equipped tiers
            active_melee_tier: 0,
            active_ranged_tier: 0,
            active_siege_tier: 0,
            active_armor_tier: 0,
            bump,
            _padding: [0; 3],
        }
    }

    /// Convert quality tier to bonus basis points
    /// Refined=2.5%, Superior=5%, Elite=10%, Masterwork=15%,
    /// Legendary=25%, Mythic=40%, Divine=60%
    pub fn tier_to_bonus_bps(tier: u8) -> u16 {
        match tier {
            0 => 0,    // None/unequipped
            1 => 250,  // Refined: +2.5%
            2 => 500,  // Superior: +5%
            3 => 1000, // Elite: +10%
            4 => 1500, // Masterwork: +15%
            5 => 2500, // Legendary: +25%
            6 => 4000, // Mythic: +40%
            7 => 6000, // Divine: +60%
            _ => 0,
        }
    }

    /// Calculate total equipped weapon bonus (sum of all weapon types)
    pub fn calculate_weapon_bonus_bps(&self) -> u16 {
        Self::tier_to_bonus_bps(self.active_melee_tier)
            .saturating_add(Self::tier_to_bonus_bps(self.active_ranged_tier))
            .saturating_add(Self::tier_to_bonus_bps(self.active_siege_tier))
    }

    /// Calculate equipped armor bonus
    pub fn calculate_armor_bonus_bps(&self) -> u16 {
        Self::tier_to_bonus_bps(self.active_armor_tier)
    }

    /// Check if player has crafted item of given type and tier
    pub fn has_crafted_item(&self, equipment_type: CraftableEquipment, tier: u8) -> bool {
        if tier == 0 || tier > 7 {
            return false;
        }
        let tier_index = tier as usize; // matches strike storage: counts[quality_tier as usize]
        let counts = match equipment_type {
            CraftableEquipment::MeleeWeapons => &self.melee_weapons,
            CraftableEquipment::RangedWeapons => &self.ranged_weapons,
            CraftableEquipment::SiegeWeapons => &self.siege_weapons,
            CraftableEquipment::Armor => &self.armor,
        };
        counts.counts[tier_index] > 0
    }

    /// Check if currently in a staged craft
    pub fn is_crafting(&self) -> bool {
        self.active_craft_equipment != 255
    }

    /// Check if current stage window is open
    pub fn is_window_open(&self, now: i64) -> bool {
        self.is_crafting() && now >= self.window_opens_at && now <= self.window_closes_at
    }

    /// Check if current stage window was missed (too late)
    pub fn is_window_missed(&self, now: i64) -> bool {
        self.is_crafting() && now > self.window_closes_at
    }

    /// Check if we're waiting for window to open (too early)
    pub fn is_waiting_for_window(&self, now: i64) -> bool {
        self.is_crafting() && now < self.window_opens_at
    }

    /// Clear craft state (on success or failure)
    pub fn clear_craft(&mut self) {
        self.active_craft_equipment = 255;
        self.target_tier = 0;
        self.stages_required = 0;
        self.current_stage = 0;
        self.stages_completed = 0;
        self.window_opens_at = 0;
        self.window_closes_at = 0;
        self.craft_started_at = 0;
        self.precision_score = 0;
    }

    /// Calculate strike precision (how centered within the window)
    /// Returns 0-10000 where 10000 = perfect center
    pub fn calculate_precision(&self, now: i64) -> u16 {
        if !self.is_window_open(now) {
            return 0;
        }

        let window_duration = self.window_closes_at - self.window_opens_at;
        if window_duration <= 0 {
            return 10000; // Edge case: instant window = perfect
        }

        let window_center = self.window_opens_at + (window_duration / 2);
        let distance_from_center = (now - window_center).abs();
        let max_distance = window_duration / 2;

        if max_distance == 0 {
            return 10000;
        }

        // Perfect center = 10000, edge of window = 0
        let precision = 10000i64 - ((distance_from_center * 10000) / max_distance);
        precision.max(0) as u16
    }

    /// Get quality counts for equipment type
    pub fn get_quality_counts(&self, equipment: CraftableEquipment) -> &QualityCounts {
        match equipment {
            CraftableEquipment::MeleeWeapons => &self.melee_weapons,
            CraftableEquipment::RangedWeapons => &self.ranged_weapons,
            CraftableEquipment::SiegeWeapons => &self.siege_weapons,
            CraftableEquipment::Armor => &self.armor,
        }
    }

    /// Get mutable quality counts for equipment type
    pub fn get_quality_counts_mut(&mut self, equipment: CraftableEquipment) -> &mut QualityCounts {
        match equipment {
            CraftableEquipment::MeleeWeapons => &mut self.melee_weapons,
            CraftableEquipment::RangedWeapons => &mut self.ranged_weapons,
            CraftableEquipment::SiegeWeapons => &mut self.siege_weapons,
            CraftableEquipment::Armor => &mut self.armor,
        }
    }

    /// Calculate total weapon quality buff (melee + ranged + siege)
    pub fn total_weapon_buff_bps(&self) -> u64 {
        self.melee_weapons
            .total_buff_bps()
            .saturating_add(self.ranged_weapons.total_buff_bps())
            .saturating_add(self.siege_weapons.total_buff_bps())
    }

    /// Calculate total armor quality buff
    pub fn total_armor_buff_bps(&self) -> u64 {
        self.armor.total_buff_bps()
    }

    /// Derive the PDA
    pub fn derive_pda(owner: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[b"crafted_equipment", owner.as_ref()],
            &crate::ID,
        )
    }

    pub fn create_pda(owner: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[b"crafted_equipment", owner.as_ref(), &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
}

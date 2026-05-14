use pinocchio::{
    Address,
    error::ProgramError,
};
use crate::constants::{RESEARCH_SEED, RESEARCH_TEMPLATE_SEED};
use crate::logic::safe_math::exp_growth;

/// Maximum number of research nodes
pub const MAX_RESEARCH_NODES: usize = 31;

/// Research categories
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ResearchCategory {
    Battle = 0,
    Economy = 1,
    Growth = 2,
}

/// Buff types that research can provide
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ResearchBuffType {
    // Battle buffs
    AttackPower = 0,
    DefensePower = 1,
    UnitCapacity = 2,
    CriticalHitChance = 3,
    CriticalHitDamage = 4,
    RallyCapacity = 5,
    EncounterSuccess = 6,
    LootBonus = 7,
    UnitTrainingSpeed = 8,
    AmbushDamage = 9,

    // Economy buffs
    ProductionEfficiency = 10,
    ResourceCapacity = 11,
    MarketTaxReduction = 12,
    TradeSpeed = 13,
    MiningOutput = 14,
    CashGeneration = 15,
    ConstructionSpeed = 16,
    UpkeepReduction = 17,
    BlackMarketAccess = 18,
    TaxCollection = 19,

    // Growth buffs
    DailyRewardsSystem = 20,
    MiningOperations = 21,
    FishingIndustry = 22,
    LootMagnetism = 23,
    ReputationMastery = 24,
    StaminaVitality = 25,
    SynchronyyStreak = 26,
    FragmentDiscovery = 27,
    GemProspecting = 28,
    CollectionMastery = 29,
    TravelSpeed = 30,           // Faster intercity and intracity travel
}

/// Research Template - DAO controlled configuration for each research node
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ResearchTemplate {
    /// Account discriminator (AccountKey::ResearchTemplate)
    pub account_key: u8,

    pub research_type: u8,           // 0-29 (30 research nodes)
    pub category: u8,                // ResearchCategory
    pub max_level: u8,               // 5-25 depending on node
    pub base_time_seconds: u32,      // Base research time for level 1
    pub base_novi_cost: u64,         // NOVI cost for level 1
    pub buff_type: u8,               // ResearchBuffType
    pub buff_per_level_bps: u16,     // Basis points per level (e.g., 200 = 2%)
    pub prerequisite_research: u8,   // 255 = no prereq, else research_type
    pub prerequisite_level: u8,      // Required level of prerequisite
    pub gem_cost_per_minute: u16,    // Gems per minute for speed-up
    pub is_active: bool,             // DAO can disable nodes
    pub _padding: [u8; 5],
}

impl ResearchTemplate {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive the PDA for a research template account
    pub fn derive_pda(research_type: u8) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[RESEARCH_TEMPLATE_SEED, &[research_type]],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(research_type: u8, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[RESEARCH_TEMPLATE_SEED, &[research_type], &bump_seed],
            &crate::ID,
        ).map_err(|e| e.into())
    }

    /// Calculate NOVI cost for a specific level (no u128!)
    pub fn calculate_novi_cost(&self, level: u8) -> u64 {
        // Cost = base_cost * (1.8 ^ level)
        // Using exp_growth with interleaved multiply/divide to stay in u64
        // 1.8 = 18/10
        exp_growth(self.base_novi_cost, 18, 10, level as u32).unwrap_or(u64::MAX)
    }

    /// Calculate time in seconds for a specific level (no i128!)
    pub fn calculate_time_seconds(&self, level: u8) -> i64 {
        // Time = base_time * (1.5 ^ level)
        // Using exp_growth with interleaved multiply/divide to stay in u64
        // 1.5 = 3/2, then cast to i64 (always positive)
        let time = exp_growth(self.base_time_seconds as u64, 3, 2, level as u32)
            .unwrap_or(i64::MAX as u64);
        time.min(i64::MAX as u64) as i64
    }

    /// Calculate gem cost to speed up remaining time
    pub fn calculate_gem_cost(&self, remaining_seconds: i64, level: u8) -> u64 {
        // Gem cost scales by level
        let gem_per_minute = match level {
            1..=5 => 1,
            6..=10 => 2,
            11..=15 => 5,
            16..=20 => 10,
            21..=25 => 20,
            _ => 20, // Cap at 20 for levels above 25
        };

        let minutes = (remaining_seconds + 59) / 60; // Round up
        (minutes as u64) * gem_per_minute
    }
}

/// Research Progress - Per-player research state
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ResearchProgress {
    /// Account discriminator (AccountKey::ResearchProgress)
    pub account_key: u8,

    pub player: Address,                    // Owner
    pub current_research: u8,              // Active research type (255 = none)
    pub current_level: u8,                 // Current level being researched
    pub started_at: i64,                   // Unix timestamp research started
    pub completes_at: i64,                 // Unix timestamp research completes
    pub completed_levels: [u8; 30],        // Current level of each research node (0-25)
    pub total_gems_spent: u64,             // Total gems spent on speed-ups
    pub total_novi_spent: u64,             // Total NOVI spent on research
    pub buff_cache_version: u32,           // Increments on research completion

    // Economy Research Buffs (stored in PDA, not PlayerAccount)
    pub production_efficiency_bps: u16,
    pub resource_capacity_bps: u16,
    pub market_tax_reduction_bps: u16,
    pub trade_speed_bps: u16,
    pub mining_output_bps: u16,
    pub cash_generation_bps: u16,
    pub construction_speed_bps: u16,
    pub upkeep_reduction_bps: u16,
    pub black_market_level: u16,
    pub tax_collection_bps: u16,

    // Additional Growth buffs
    pub fishing_efficiency_bps: u16,
    pub fragment_drop_rate_bps: u16,
    pub gem_drop_rate_bps: u16,

    // Ascension System (endgame)
    // Bitfield: bit N = research node N is ascended (max 30 nodes)
    // Ascended nodes get +25% buff effectiveness
    pub ascended_nodes: u32,
    pub total_ascensions: u8,              // Count of ascended nodes

    pub bump: u8,
    pub _padding: [u8; 1],
}

impl ResearchProgress {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Initialize with default values
    pub fn init(player: Address, bump: u8) -> Self {
        Self {
            account_key: crate::state::AccountKey::ResearchProgress as u8,
            player,
            current_research: 255, // No active research
            current_level: 0,
            started_at: 0,
            completes_at: 0,
            completed_levels: [0; 30],
            total_gems_spent: 0,
            total_novi_spent: 0,
            buff_cache_version: 0,

            // All buffs start at 0
            production_efficiency_bps: 0,
            resource_capacity_bps: 0,
            market_tax_reduction_bps: 0,
            trade_speed_bps: 0,
            mining_output_bps: 0,
            cash_generation_bps: 0,
            construction_speed_bps: 0,
            upkeep_reduction_bps: 0,
            black_market_level: 0,
            tax_collection_bps: 0,
            fishing_efficiency_bps: 0,
            fragment_drop_rate_bps: 0,
            gem_drop_rate_bps: 0,

            // Ascension
            ascended_nodes: 0,
            total_ascensions: 0,

            bump,
            _padding: [0; 1],
        }
    }

    /// Check if currently researching
    pub fn is_researching(&self) -> bool {
        self.current_research != 255
    }

    /// Check if research is complete and ready to claim
    pub fn is_complete(&self, now: i64) -> bool {
        self.is_researching() && now >= self.completes_at
    }

    /// Get level of a specific research
    pub fn get_level(&self, research_type: u8) -> u8 {
        if research_type < 30 {
            self.completed_levels[research_type as usize]
        } else {
            0
        }
    }

    /// Check if prerequisites are met
    pub fn check_prerequisites(&self, template: &ResearchTemplate) -> bool {
        if template.prerequisite_research == 255 {
            return true; // No prerequisites
        }

        let prereq_level = self.get_level(template.prerequisite_research);
        prereq_level >= template.prerequisite_level
    }

    // Ascension System

    /// Check if a research node is ascended
    pub fn is_ascended(&self, research_type: u8) -> bool {
        if research_type >= 30 {
            return false;
        }
        (self.ascended_nodes & (1u32 << research_type)) != 0
    }

    /// Check if a research node can be ascended (at max level)
    pub fn can_ascend(&self, research_type: u8, max_level: u8) -> bool {
        if research_type >= 30 {
            return false;
        }
        // Must be at max level and not already ascended
        self.get_level(research_type) >= max_level && !self.is_ascended(research_type)
    }

    /// Ascend a research node (mark as ascended)
    /// Returns true if successful, false if already ascended or invalid
    pub fn ascend(&mut self, research_type: u8) -> bool {
        if research_type >= 30 || self.is_ascended(research_type) {
            return false;
        }
        self.ascended_nodes |= 1u32 << research_type;
        self.total_ascensions = self.total_ascensions.saturating_add(1);
        true
    }

    /// Get ascension bonus multiplier for a research node (basis points)
    /// Ascended nodes get +25% (2500 bps) bonus to their buff
    pub fn ascension_bonus_bps(&self, research_type: u8) -> u16 {
        if self.is_ascended(research_type) {
            2500 // +25%
        } else {
            0
        }
    }

    /// Recalculate all buffs based on completed research
    pub fn recalculate_buffs(&mut self, templates: &[ResearchTemplate]) {
        // Reset all buffs
        self.production_efficiency_bps = 0;
        self.resource_capacity_bps = 0;
        self.market_tax_reduction_bps = 0;
        self.trade_speed_bps = 0;
        self.mining_output_bps = 0;
        self.cash_generation_bps = 0;
        self.construction_speed_bps = 0;
        self.upkeep_reduction_bps = 0;
        self.black_market_level = 0;
        self.tax_collection_bps = 0;
        self.fishing_efficiency_bps = 0;
        self.fragment_drop_rate_bps = 0;
        self.gem_drop_rate_bps = 0;

        // Calculate buffs from each completed research
        for (i, template) in templates.iter().enumerate() {
            let level = self.completed_levels[i];
            if level == 0 {
                continue;
            }

            // Base buff from levels
            let base_buff = template.buff_per_level_bps as u32 * level as u32;

            // Apply ascension bonus (+25% if ascended)
            let ascension_bonus = self.ascension_bonus_bps(i as u8) as u32;
            let total_buff = if ascension_bonus > 0 {
                // buff × (10000 + 2500) / 10000 = buff × 1.25
                (base_buff * (10000 + ascension_bonus) / 10000) as u16
            } else {
                base_buff as u16
            };

            // Apply to appropriate buff field based on buff_type
            match template.buff_type {
                10 => self.production_efficiency_bps = total_buff,
                11 => self.resource_capacity_bps = total_buff,
                12 => self.market_tax_reduction_bps = total_buff,
                13 => self.trade_speed_bps = total_buff,
                14 => self.mining_output_bps = total_buff,
                15 => self.cash_generation_bps = total_buff,
                16 => self.construction_speed_bps = total_buff,
                17 => self.upkeep_reduction_bps = total_buff,
                18 => self.black_market_level = total_buff,
                19 => self.tax_collection_bps = total_buff,
                22 => self.fishing_efficiency_bps = total_buff,
                27 => self.fragment_drop_rate_bps = total_buff,
                28 => self.gem_drop_rate_bps = total_buff,
                _ => {} // Battle and other Growth buffs are stored in PlayerAccount
            }
        }

        self.buff_cache_version = self.buff_cache_version.wrapping_add(1);
    }

    /// Derive the PDA for a research progress account
    pub fn derive_pda(player: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[RESEARCH_SEED, player.as_ref()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(player: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[RESEARCH_SEED, player.as_ref(), &bump_seed],
            &crate::ID,
        ).map_err(|e| e.into())
    }
}
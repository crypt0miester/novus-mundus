use pinocchio::{
    pubkey::Pubkey,
    program_error::ProgramError,
};
use crate::constants::HERO_TEMPLATE_SEED;
use crate::logic::safe_math::exp_growth;

/// Hero type categories
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum HeroType {
    Offensive = 0,
    Defensive = 1,
    Economic = 2,
    Hybrid = 3,
}

/// Hero category for thematic organization
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum HeroCategory {
    Historical = 0,
    Mythological = 1,
    CryptoIcons = 2,
    Gaming = 3,
    Original = 4,
}

/// Buff statistics that heroes can provide
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum BuffStat {
    None = 0,                          // Unused slot
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
    MiningAffinity = 17,               // Bonus yield from mining expeditions
    FishingAffinity = 18,              // Bonus yield from fishing expeditions
}

impl BuffStat {
    /// Convert from u8 to BuffStat
    #[inline]
    pub const fn from_u8(val: u8) -> Self {
        match val {
            1 => Self::AttackPower,
            2 => Self::DefensePower,
            3 => Self::CashCollectionRate,
            4 => Self::XpGain,
            5 => Self::TrainingCostReduction,
            6 => Self::RallyCapacity,
            7 => Self::CriticalHitChance,
            8 => Self::SynchronyBonus,
            9 => Self::ResourceCapacity,
            10 => Self::WeaponEfficiency,
            11 => Self::StaminaRegen,
            12 => Self::ProduceGeneration,
            13 => Self::UnitCapacity,
            14 => Self::EncounterDamage,
            15 => Self::LootBonus,
            16 => Self::ArmorEfficiency,
            17 => Self::MiningAffinity,
            18 => Self::FishingAffinity,
            _ => Self::None,
        }
    }
}

/// Buff configuration for a hero template (Deterministic System)
///
/// Each buff scales deterministically with hero level using golden root (√φ).
/// Formula: buff_value = base_bps × (√φ)^level
///
/// No randomness - players know exactly what they'll get at each level.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BuffConfig {
    pub stat: u8,                      // BuffStat enum (0 = None/unused)
    pub base_bps: u16,                 // Base buff at level 1 (basis points)
    pub _reserved: [u8; 2],            // Reserved for future use (maintains 5-byte alignment)
}

impl BuffConfig {
    pub const NONE: Self = Self {
        stat: 0,
        base_bps: 0,
        _reserved: [0; 2],
    };

    /// Calculate buff value at a specific level using golden root scaling
    ///
    /// Formula: base_bps × (√φ)^level
    #[inline]
    pub fn value_at_level(&self, level: u32) -> u64 {
        if self.stat == 0 || self.base_bps == 0 {
            return 0;
        }
        crate::logic::calculate_buff_at_level(self.base_bps as u64, level)
    }
}

/// Hero Template - DAO controlled configuration for each hero type (Deterministic System)
///
/// Heroes provide buffs that scale deterministically with level using golden root (√φ).
/// No random weights or ranges - pure mathematical progression.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct HeroTemplate {
    /// Account discriminator
    pub account_key: u8,
    // Identity
    pub template_id: u16,              // Unique ID (0-65535)
    pub name: [u8; 32],                // "Alexander the Great"
    pub hero_type: u8,                 // HeroType enum
    pub category: u8,                  // HeroCategory enum

    // Minting config
    pub mint_cost_sol: u64,            // Lamports (e.g., 50_000_000 = 0.05 SOL)
    pub supply_cap: u32,               // 0 = unlimited
    pub minted_count: u32,             // Current supply
    pub enabled: bool,                 // Can be minted?
    pub event_exclusive: bool,         // Only during events?
    pub required_player_level: u8,     // Min player level

    // Meditation requirements
    // 0 = can meditate anywhere, non-zero = MUST be in specific city
    // Links heroes to their origin/sacred cities for thematic immersion
    pub meditation_city_id: u16,       // City ID required for meditation

    // Buff configuration (up to 4 buffs)
    // Each buff scales as: base_bps × (√φ)^level
    pub buffs: [BuffConfig; 4],

    pub bump: u8,
    pub _padding: [u8; 3],             // Reduced from 6 to 3 (added 2 bytes for city_id, 1 for alignment)
}

impl HeroTemplate {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive the PDA for a hero template account
    pub fn derive_pda(template_id: u16) -> (Pubkey, u8) {
        let template_id_bytes = template_id.to_le_bytes();
        pinocchio::pubkey::find_program_address(
            &[HERO_TEMPLATE_SEED, &template_id_bytes],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(template_id: u16, bump: u8) -> Result<Pubkey, ProgramError> {
        let template_id_bytes = template_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[HERO_TEMPLATE_SEED, &template_id_bytes, &bump_seed],
            &crate::ID,
        )
    }
}

/// Calculate fragment cost for leveling to a specific level (no u128!)
/// Cost = 10 * (1.5 ^ level)
pub fn calculate_fragment_cost(current_level: u32) -> u64 {
    const BASE_COST: u64 = 10;

    // For level 0→1, cost is BASE_COST
    if current_level == 0 {
        return BASE_COST;
    }

    // Use exp_growth: 1.5 = 3/2, interleaves multiply/divide to stay in u64
    exp_growth(BASE_COST, 3, 2, current_level).unwrap_or(u64::MAX)
}

/// Power Weighting System
///
/// Power represents the total strategic value of a hero across all dimensions.
/// Different buff types are weighted based on their economic/competitive value.
///
/// # Weight Tiers (in basis points, 10000 = 100%)
///
/// **TIER 1 (10000 = 100%): Combat - Direct competitive power**
/// - AttackPower (1), DefensePower (2), EncounterDamage (14)
/// - Can't substitute economy for combat when under attack
/// - Direct PvP/PvE power that determines winners
///
/// **TIER 2 (7500 = 75%): Strategic - Force multipliers**
/// - CriticalHitChance (7), RallyCapacity (6)
/// - High impact but situational/coordinated
/// - Crits are probabilistic, rallies require coordination
///
/// **TIER 3 (6000 = 60%): Economic - Resource generation**
/// - CashCollectionRate (3), ProduceGeneration (12), LootBonus (15)
/// - High long-term value but time-gated
/// - Can't use economy to win a fight NOW, but enables future growth
///
/// **TIER 4 (4500 = 45%): Progression - Advancement speed**
/// - XpGain (4), TrainingCostReduction (5)
/// - Saves time/resources but doesn't directly generate or win fights
/// - Indirect benefits for hardcore players
///
/// **TIER 5 (3000 = 30%): Utility - Convenience & capacity**
/// - UnitCapacity (13), ResourceCapacity (9), WeaponEfficiency (10), ArmorEfficiency (16)
/// - StaminaRegen (11), SynchronyBonus (8)
/// - Quality of life improvements, doesn't change fundamental power
///
/// # Formula
/// ```
/// Power = Σ(buff_value_bps × weight) / 10000
/// ```
///
/// # Example
/// Hero with 500 Attack + 300 Defense + 200 Economy:
/// ```
/// = (500 × 10000 + 300 × 10000 + 200 × 6000) / 10000
/// = (5000000 + 3000000 + 1200000) / 10000
/// = 920 total power
/// ```
pub const fn get_power_weight(stat: u8) -> u32 {
    match stat {
        // Tier 1: Combat (100%)
        1 | 2 | 14 => 10000,
        // Tier 2: Strategic (75%)
        7 | 6 => 7500,
        // Tier 3: Economic (60%)
        3 | 12 | 15 => 6000,
        // Tier 4: Progression (45%)
        4 | 5 => 4500,
        // Tier 5: Utility (30%)
        8 | 9 | 10 | 11 | 13 | 16 => 3000,
        // Unknown/None
        _ => 0,
    }
}

/// Get display name for buff stat (for NFT attributes)
pub const fn get_buff_stat_name(stat: u8) -> &'static str {
    match stat {
        1 => "Attack",
        2 => "Defense",
        3 => "Economy",
        4 => "XPGain",
        5 => "Training",
        6 => "Rally",
        7 => "Crit",
        8 => "Synchrony",
        9 => "Storage",
        10 => "Weapon",
        11 => "Stamina",
        12 => "Produce",
        13 => "Units",
        14 => "Encounter",
        15 => "Loot",
        16 => "Armor",
        _ => "Unknown",
    }
}

/// Calculate weighted power using tier-based weights (Deterministic System)
///
/// Buff values are calculated deterministically: base_bps × (√φ)^level
/// Then weighted by buff stat tier importance.
///
/// Uses checked arithmetic to prevent overflow:
/// - Each buff_value is u64 to handle intermediate calculations
/// - Weight multiplication checked before division
/// - Final result saturates to u32::MAX if overflow
pub fn calculate_weighted_power_for_level(level: u32, template: &HeroTemplate) -> u32 {
    let mut total: u64 = 0;

    for buff_config in template.buffs.iter() {
        if buff_config.stat == 0 { continue; }

        // Calculate buff value deterministically: base × (√φ)^level
        let buff_value = buff_config.value_at_level(level);

        // Apply weight: (buff_value * weight) / 10000
        let weight = get_power_weight(buff_config.stat) as u64;

        // Checked multiplication
        if let Some(weighted) = buff_value.checked_mul(weight) {
            let contribution = weighted / 10000;
            total = total.saturating_add(contribution);
        } else {
            // Overflow in multiplication, saturate this buff contribution
            total = total.saturating_add(u64::MAX / 10000);
        }
    }

    // Saturate to u32 range
    if total > u32::MAX as u64 {
        u32::MAX
    } else {
        total as u32
    }
}

// ============================================================
// Location Synergy System
// ============================================================

/// Hero tier for location bonus calculation
/// Determines the percentage bonus (2-10%) when hero is in their home city
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum HeroTier {
    Common = 0,      // 2% location bonus
    Rare = 1,        // 4% location bonus
    Epic = 2,        // 6% location bonus
    Legendary = 3,   // 8% location bonus
    Mythic = 4,      // 10% location bonus
}

impl HeroTier {
    /// Convert from u8 to HeroTier
    #[inline]
    pub const fn from_u8(val: u8) -> Self {
        match val {
            0 => Self::Common,
            1 => Self::Rare,
            2 => Self::Epic,
            3 => Self::Legendary,
            4 => Self::Mythic,
            _ => Self::Common, // Default to common for invalid values
        }
    }

    /// Get location bonus in basis points for this tier
    #[inline]
    pub const fn location_bonus_bps(self) -> u16 {
        match self {
            Self::Common => 200,      // 2%
            Self::Rare => 400,        // 4%
            Self::Epic => 600,        // 6%
            Self::Legendary => 800,   // 8%
            Self::Mythic => 1000,     // 10%
        }
    }
}

/// Get location bonus in basis points for a tier value
///
/// # Arguments
/// * `tier` - Hero tier (0=Common, 1=Rare, 2=Epic, 3=Legendary, 4=Mythic)
///
/// # Returns
/// Bonus in basis points (200-1000, i.e., 2%-10%)
#[inline]
pub const fn location_bonus_for_tier(tier: u8) -> u16 {
    match tier {
        0 => 200,   // Common: 2%
        1 => 400,   // Rare: 4%
        2 => 600,   // Epic: 6%
        3 => 800,   // Legendary: 8%
        4 => 1000,  // Mythic: 10%
        _ => 0,     // Invalid tier
    }
}

/// Check if a hero is "at home" (in their meditation city)
///
/// # Arguments
/// * `hero_city` - Hero's meditation_city_id (0 = everywhere/crypto icons)
/// * `player_city` - Player's current city
///
/// # Returns
/// true if hero gets location bonus in this city
#[inline]
pub const fn is_hero_at_home(hero_city: u16, player_city: u16) -> bool {
    // City 0 means "everywhere" - crypto icons are always at home
    hero_city == 0 || hero_city == player_city
}

/// Derive tier from mint cost (in lamports)
///
/// Used during mint to determine hero tier from template's mint_cost_sol.
/// 5-tier system: Common(0), Rare(1), Epic(2), Legendary(3), Mythic(4)
#[inline]
pub const fn tier_from_mint_cost(mint_cost_lamports: u64) -> u8 {
    // Thresholds based on HERO_GALLERY.md tier pricing:
    // Common: 0.10 SOL = 100_000_000 lamports
    // Rare: 0.25 SOL = 250_000_000 lamports
    // Epic: 1.0 SOL = 1_000_000_000 lamports
    // Legendary: 5.0 SOL = 5_000_000_000 lamports
    // Mythic: 10.0 SOL = 10_000_000_000 lamports
    if mint_cost_lamports >= 10_000_000_000 {
        4 // Mythic
    } else if mint_cost_lamports >= 5_000_000_000 {
        3 // Legendary
    } else if mint_cost_lamports >= 1_000_000_000 {
        2 // Epic
    } else if mint_cost_lamports >= 250_000_000 {
        1 // Rare
    } else {
        0 // Common
    }
}

/// Calculate NOVI reward for burning a hero
///
/// Formula: tier_base × level² (checked arithmetic)
/// Returns locked NOVI amount (with 1 decimal, so values are ×10)
///
/// Tier base values (×10 for 1 decimal):
/// - Common(0): 500 (50 NOVI)
/// - Rare(1): 5,000 (500 NOVI)
/// - Epic(2): 20,000 (2,000 NOVI)
/// - Legendary(3): 100,000 (10,000 NOVI)
/// - Mythic(4): 250,000 (25,000 NOVI)
pub fn calculate_burn_reward(level: u32, tier: u8) -> Result<u64, ProgramError> {
    let tier_base: u64 = match tier {
        0 => 500,       // Common: 50 NOVI
        1 => 5_000,     // Rare: 500 NOVI
        2 => 20_000,    // Epic: 2,000 NOVI
        3 => 100_000,   // Legendary: 10,000 NOVI
        4 => 250_000,   // Mythic: 25,000 NOVI
        _ => 500,       // Default to Common
    };
    let lvl = level.max(1) as u64;
    let lvl_squared = lvl.checked_mul(lvl)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    tier_base.checked_mul(lvl_squared)
        .ok_or(ProgramError::ArithmeticOverflow)
}

/// Calculate sanctuary mint bonus (locked NOVI)
///
/// Bonus tiers based on sanctuary level:
/// - Level 5+:  5% of mint cost (in NOVI equivalent)
/// - Level 10+: 10% of mint cost
/// - Level 15+: 15% of mint cost
/// - Level 20+: 20% of mint cost
///
/// Conversion: 1 SOL ≈ 10,000 NOVI (with 1 decimal = 100,000)
/// mint_cost_lamports / 1_000_000_000 × 100_000 = mint_cost_lamports / 10_000
pub fn calculate_mint_bonus(mint_cost_lamports: u64, sanctuary_level: u8) -> Result<u64, ProgramError> {
    let bonus_bps: u64 = match sanctuary_level {
        0..=4 => return Ok(0),
        5..=9 => 500,    // 5%
        10..=14 => 1000, // 10%
        15..=19 => 1500, // 15%
        _ => 2000,       // 20%
    };
    // Convert mint cost (lamports) to NOVI equivalent (1 decimal)
    // 1 SOL = 1_000_000_000 lamports = 100_000 NOVI (with decimal)
    // novi_equiv = mint_cost_lamports / 10_000
    let novi_equivalent = mint_cost_lamports / 10_000;
    novi_equivalent.checked_mul(bonus_bps)
        .ok_or(ProgramError::ArithmeticOverflow)
        .map(|v| v / 10_000)
}

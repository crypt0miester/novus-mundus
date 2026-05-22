/// Estate System Helper Functions
///
/// Provides building requirement validation and estate operations.
/// Hard gates ensure players must build specific buildings to access features.

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
};

use crate::{
    error::GameError,
    state::{
        EstateAccount, BuildingType, BuildingSlot,
        PlayerAccount,
    },
};

// Building Requirement Validation

/// Load and validate a building requirement
///
/// Returns the building slot if:
/// 1. Estate exists
/// 2. Building exists in estate
/// 3. Building is Active or Upgrading
/// 4. Building level >= min_level
pub fn require_building<'a>(
    estate: &'a EstateAccount,
    building_type: BuildingType,
    min_level: u8,
) -> Result<&'a BuildingSlot, ProgramError> {
    // Find building in estate
    let building = estate.find_building(building_type);

    match building {
        None => Err(building_type_to_error(building_type).into()),
        Some(b) if !b.is_active() => {
            Err(GameError::BuildingNotActive.into())
        }
        Some(b) if b.level < min_level => {
            Err(GameError::BuildingLevelInsufficient.into())
        }
        Some(b) => Ok(b),
    }
}

/// Check if building exists (any level, must be active)
pub fn has_building(estate: &EstateAccount, building_type: BuildingType) -> bool {
    estate.find_building(building_type)
        .map(|b| b.is_active())
        .unwrap_or(false)
}

/// Check if building meets minimum level
pub fn has_building_at_level(estate: &EstateAccount, building_type: BuildingType, min_level: u8) -> bool {
    estate.find_building(building_type)
        .map(|b| b.is_active() && b.level >= min_level)
        .unwrap_or(false)
}

/// Convert building type to its specific error code
fn building_type_to_error(building_type: BuildingType) -> GameError {
    match building_type {
        BuildingType::Mansion => GameError::MansionRequired,
        BuildingType::Barracks => GameError::BarracksRequired,
        BuildingType::Workshop => GameError::WorkshopRequired,
        BuildingType::Vault => GameError::VaultRequired,
        BuildingType::Dock => GameError::DockRequired,
        BuildingType::Forge => GameError::ForgeRequired,
        BuildingType::Market => GameError::MarketRequired,
        BuildingType::Academy => GameError::AcademyRequired,
        BuildingType::Arena => GameError::ArenaRequired,
        BuildingType::MeditationChamber => GameError::MeditationChamberRequired,
        BuildingType::Observatory => GameError::ObservatoryRequired,
        BuildingType::Treasury => GameError::TreasuryRequired,
        BuildingType::Citadel => GameError::CitadelRequired,
        BuildingType::Camp => GameError::CampRequired,
        BuildingType::Mine => GameError::MineRequired,
        BuildingType::DungeonEntry => GameError::DungeonEntryRequired,
        BuildingType::Farm => GameError::FarmRequired,
        BuildingType::TransportBay => GameError::TransportBayRequired,
        BuildingType::Infirmary => GameError::InfirmaryRequired,
    }
}

// Specific Building Requirement Helpers

/// Require Mansion at minimum level
#[inline]
pub fn require_mansion(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Mansion, min_level)
}

/// Require Barracks at minimum level
#[inline]
#[allow(dead_code)]
pub fn require_barracks(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Barracks, min_level)
}

/// Require Workshop at minimum level
#[inline]
pub fn require_workshop(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Workshop, min_level)
}

/// Require Vault at minimum level
#[inline]
pub fn require_vault(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Vault, min_level)
}

/// Require Dock at minimum level (for fishing expeditions)
#[inline]
pub fn require_dock(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Dock, min_level)
}

/// Require Forge at minimum level
#[inline]
pub fn require_forge(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Forge, min_level)
}

/// Require Market at minimum level
#[inline]
pub fn require_market(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Market, min_level)
}

/// Require Academy at minimum level
#[inline]
pub fn require_academy(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Academy, min_level)
}

/// Require MeditationChamber at minimum level
#[inline]
pub fn require_sanctuary(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::MeditationChamber, min_level)
}

/// Require Citadel at minimum level
#[inline]
pub fn require_citadel(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Citadel, min_level)
}

/// Require Camp at minimum level (operative unit hiring)
#[inline]
#[allow(dead_code)]
pub fn require_camp(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Camp, min_level)
}

/// Require Mine at minimum level (mining expeditions)
#[inline]
pub fn require_mine(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Mine, min_level)
}

/// Require DungeonEntry at minimum level (dungeon access)
#[inline]
#[allow(dead_code)]
pub fn require_catacombs(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::DungeonEntry, min_level)
}

/// Require Farm at minimum level (produce collection)
#[inline]
pub fn require_farm(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Farm, min_level)
}

/// Require TransportBay at minimum level (travel gating)
#[inline]
pub fn require_stables(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::TransportBay, min_level)
}

/// Require Infirmary at minimum level (unit recovery)
#[inline]
pub fn require_infirmary(estate: &EstateAccount, min_level: u8) -> Result<&BuildingSlot, ProgramError> {
    require_building(estate, BuildingType::Infirmary, min_level)
}

// Unit Hiring Requirements (Barracks/Camp levels)

use crate::types::UnitType;

/// Get the required building type for a unit type
/// Defensive units (0-2) → Barracks, Operative units (3-5) → Camp
pub const fn required_building_for_unit(unit_type: UnitType) -> BuildingType {
    match unit_type {
        UnitType::DefensiveUnit1 | UnitType::DefensiveUnit2 | UnitType::DefensiveUnit3 => BuildingType::Barracks,
        UnitType::OperativeUnit1 | UnitType::OperativeUnit2 | UnitType::OperativeUnit3 => BuildingType::Camp,
    }
}

/// Get required building level for a unit type
pub const fn required_level_for_unit(unit_type: UnitType) -> u8 {
    match unit_type {
        UnitType::DefensiveUnit1 => 1,
        UnitType::DefensiveUnit2 => 1,
        UnitType::DefensiveUnit3 => 1,
        UnitType::OperativeUnit1 => 1,
        UnitType::OperativeUnit2 => 1,
        UnitType::OperativeUnit3 => 1,
    }
}

/// Get required Barracks level for a unit type (legacy, kept for compatibility)
#[allow(dead_code)]
pub const fn required_barracks_level_for_unit(unit_type: UnitType) -> u8 {
    required_level_for_unit(unit_type)
}


// Research Category Requirements (Academy levels)

use crate::state::research::ResearchCategory;

/// Get required Academy level for a research category
pub const fn required_academy_level_for_research(category: ResearchCategory) -> u8 {
    match category {
        ResearchCategory::Battle => 1,
        ResearchCategory::Economy => 2,
        ResearchCategory::Growth => 3,
    }
}


// Hero Management Requirements (Sanctuary levels)

/// Get maximum heroes that can be locked based on Sanctuary level
pub const fn max_locked_heroes_for_sanctuary_level(level: u8) -> u8 {
    match level {
        0 => 0,
        1..=4 => 1,
        5..=9 => 2,
        10..=14 => 3,
        15..=19 => 4,
        _ => 5, // Level 20+
    }
}

/// Check if MeditationChamber allows locking another hero
pub fn can_lock_hero(estate: &EstateAccount, current_locked_count: u8) -> bool {
    if let Some(sanctuary) = estate.find_building(BuildingType::MeditationChamber) {
        if sanctuary.is_active() {
            let max = max_locked_heroes_for_sanctuary_level(sanctuary.level);
            return current_locked_count < max;
        }
    }
    false
}

/// Get max hero level based on Sanctuary building level
///
/// Sanctuary Level → Max Hero Level:
/// - Lv 1-4:  Hero Lv 10
/// - Lv 5-9:  Hero Lv 25
/// - Lv 10-14: Hero Lv 50
/// - Lv 15+:  Hero Lv 100 (max)
pub const fn max_hero_level_for_sanctuary(sanctuary_level: u8) -> u8 {
    match sanctuary_level {
        0 => 0,
        1..=4 => 10,
        5..=9 => 25,
        10..=14 => 50,
        _ => 100, // Level 15+
    }
}

/// Get the hero level cap for this estate's MeditationChamber
/// Returns 0 if no MeditationChamber
pub fn hero_level_cap(estate: &EstateAccount) -> u8 {
    if let Some(sanctuary) = estate.find_building(BuildingType::MeditationChamber) {
        if sanctuary.is_active() {
            return max_hero_level_for_sanctuary(sanctuary.level);
        }
    }
    0
}

// Sanctuary Meditation System (φ-based)
//
// Meditation is extremely slow passive leveling for heroes:
// - XP accumulates over time → converts to levels
// - φ-based level cap per Sanctuary level
// - Once at cap, must use fragments (level_up.rs) for further leveling
//
// This creates a two-phase progression:
// - Phase 1 (Meditation): Free but extremely slow, early game
// - Phase 2 (Fragments): Costs resources, faster, mid/late game

// φ (golden ratio) constants for integer math
// φ ≈ 1.618, we use 1618/1000 for precision
const SANCTUARY_PHI_NUM: u64 = 1618;
const SANCTUARY_PHI_DENOM: u64 = 1000;

/// Base XP for level 20 (1 week at 8h/day, Sanctuary Lv 10)
/// 7 days × 8h × 200 XP/hr = 11,200 XP
const MEDITATION_XP_WEEK: u64 = 11_200;

/// Calculate XP required to level from `from_level` to `from_level + 1`
///
/// Two-tier system:
/// - Levels 1-19: Linear scaling (200 × level) - fast early/mid game
/// - Levels 20+: Weekly base with 10% compound growth per level
///
/// At Sanctuary Lv 10 (200 XP/hr), assuming 8h/day play:
/// - Level 1:  200 XP → 1.5 hours
/// - Level 5:  1,000 XP → 7.5 hours
/// - Level 10: 2,000 XP → 1.25 days
/// - Level 15: 3,000 XP → 1.9 days
/// - Level 19: 3,800 XP → 2.4 days
/// - Total 1-19: 38,000 XP → ~24 days
/// - Level 20: 11,200 XP → 1 week
/// - Level 21: 12,320 XP → 1.1 weeks
/// - Level 26: ~18,000 XP → 1.6 weeks
/// - Total 20-26: ~9 weeks
///
/// Grand total to cap (26) at 8h/day: ~3.5 months
pub fn meditation_xp_for_level(from_level: u32) -> u32 {
    if from_level == 0 {
        return 200; // Level 0→1: minimal
    }

    if from_level < 20 {
        // Linear: 200 × level
        // Fast early game, ~24 days total for levels 1-19 at 8h/day
        200 * from_level
    } else {
        // 1 week base at level 20, +10% per level after
        // Formula: 11,200 × 1.1^(level-20)
        let mut xp: u64 = MEDITATION_XP_WEEK;
        for _ in 0..(from_level - 20) {
            xp = xp * 11 / 10; // ×1.1 per level
        }
        xp.min(u32::MAX as u64) as u32
    }
}

/// Maximum meditation duration in hours based on Sanctuary level
/// Formula: 24 + (level - 1) × 3, capped at 48h
pub const fn sanctuary_meditation_max_hours(sanctuary_level: u8) -> u8 {
    if sanctuary_level == 0 {
        return 0;
    }
    let hours = 24u16 + (sanctuary_level.saturating_sub(1) as u16) * 3;
    if hours > 48 { 48 } else { hours as u8 }
}

/// Maximum meditation duration in seconds
pub const fn sanctuary_meditation_max_seconds(sanctuary_level: u8) -> i64 {
    sanctuary_meditation_max_hours(sanctuary_level) as i64 * 3600
}

/// Calculate meditation XP earned per hour
/// Formula: sanctuary_level × 20
///
/// Simple linear scaling - higher Sanctuary = faster XP gain
/// The slowness comes from the high XP_PER_LEVEL requirement
///
/// Examples:
/// - Sanctuary Lv 5:  100 XP/hour → 50 hours per level
/// - Sanctuary Lv 10: 200 XP/hour → 25 hours per level
/// - Sanctuary Lv 20: 400 XP/hour → 12.5 hours per level
pub const fn sanctuary_meditation_xp_per_hour(sanctuary_level: u8) -> u32 {
    (sanctuary_level as u32) * 20
}

/// Calculate total XP from meditation session
pub fn sanctuary_meditation_total_xp(sanctuary_level: u8, elapsed_seconds: i64) -> u32 {
    if elapsed_seconds <= 0 || sanctuary_level == 0 {
        return 0;
    }

    let xp_per_hour = sanctuary_meditation_xp_per_hour(sanctuary_level) as u64;

    // XP = (xp_per_hour × elapsed_seconds) / 3600
    let total = xp_per_hour
        .saturating_mul(elapsed_seconds as u64)
        .saturating_div(3600);

    total.min(u32::MAX as u64) as u32
}

/// Calculate meditation level cap based on Sanctuary level (φ-based)
/// Formula: floor(10 × φ^(sanctuary_level / 5))
///
/// This creates a φ-based progression:
/// - Sanctuary Lv 5:  cap = 10 × φ¹ ≈ 16
/// - Sanctuary Lv 10: cap = 10 × φ² ≈ 26
/// - Sanctuary Lv 15: cap = 10 × φ³ ≈ 42
/// - Sanctuary Lv 20: cap = 10 × φ⁴ ≈ 69
///
/// Once hero.level >= cap, cannot meditate further - must use fragments
pub fn meditation_level_cap(sanctuary_level: u8) -> u32 {
    if sanctuary_level == 0 {
        return 0;
    }

    // φ^(level/5) using repeated multiplication
    // We compute: 10 × φ^n where n = sanctuary_level / 5
    let exponent = sanctuary_level / 5;

    // Start with base 10, multiply by φ for each exponent
    let mut result: u64 = 10 * SANCTUARY_PHI_DENOM; // 10000 (scaled)

    for _ in 0..exponent {
        result = result * SANCTUARY_PHI_NUM / SANCTUARY_PHI_DENOM;
    }

    // For partial exponents (e.g., level 7 = 1.4 exponents), add linear interpolation
    let remainder = sanctuary_level % 5;
    if remainder > 0 {
        // Linear interpolation: add (φ - 1) × remainder / 5 × current
        // (φ - 1) = 0.618, so we use 618/1000
        let partial = result * 618 * (remainder as u64) / (5 * 1000);
        result = result + partial;
    }

    // Unscale and return
    (result / SANCTUARY_PHI_DENOM).min(u32::MAX as u64) as u32
}

/// Calculate how many levels can be gained from accumulated XP
/// Takes current hero level to use level-appropriate XP requirements
/// Returns (levels_gained, remaining_xp)
pub fn meditation_levels_from_xp(current_level: u32, current_xp: u32) -> (u32, u32) {
    let mut level = current_level;
    let mut xp = current_xp;
    let mut levels_gained = 0u32;

    loop {
        let required = meditation_xp_for_level(level);
        if xp < required {
            break;
        }
        xp -= required;
        level += 1;
        levels_gained += 1;

        // Safety: prevent infinite loops at very high levels
        if levels_gained >= 100 {
            break;
        }
    }

    (levels_gained, xp)
}

/// Get MeditationChamber building level from estate (0 if not found/not active)
pub fn get_sanctuary_level(estate: &EstateAccount) -> u8 {
    if let Some(sanctuary) = estate.find_building(BuildingType::MeditationChamber) {
        if sanctuary.is_active() {
            return sanctuary.level;
        }
    }
    0
}

/// Check if estate has an active MeditationChamber for meditation
pub fn can_meditate(estate: &EstateAccount) -> bool {
    if let Some(sanctuary) = estate.find_building(BuildingType::MeditationChamber) {
        return sanctuary.is_active() && sanctuary.level >= 1;
    }
    false
}

// Vault Bonuses

/// Get NOVI cap bonus from Vault level (basis points)
pub fn vault_novi_cap_bonus_bps(estate: &EstateAccount) -> u16 {
    if let Some(vault) = estate.find_building(BuildingType::Vault) {
        if vault.is_active() {
            return match vault.level {
                0 => 0,
                1..=4 => 0,
                5..=9 => 5000,   // +50%
                10..=14 => 10000, // +100%
                15..=19 => 15000, // +150%
                _ => 20000,       // +200%
            };
        }
    }
    0
}

/// Get transfer limit bonus from Vault level (basis points)
pub fn vault_transfer_bonus_bps(estate: &EstateAccount) -> u16 {
    if let Some(vault) = estate.find_building(BuildingType::Vault) {
        if vault.is_active() {
            return match vault.level {
                0..=4 => 0,
                5..=9 => 0,
                10..=14 => 10000, // +100%
                15..=19 => 25000, // +250%
                _ => u16::MAX,    // Unlimited (Lv.20)
            };
        }
    }
    0
}

// Market Discount

/// Get shop discount from Market level (basis points)
pub fn market_discount_bps(estate: &EstateAccount) -> u16 {
    if let Some(market) = estate.find_building(BuildingType::Market) {
        if market.is_active() {
            // 1% per level, max 20%
            return (market.level as u16 * 100).min(2000);
        }
    }
    0
}

// Forge Crafting Requirements

use crate::state::estate::QualityTier;

/// Check if Forge level allows crafting at this quality tier
pub fn can_craft_quality_tier(estate: &EstateAccount, tier: QualityTier) -> bool {
    let required = tier.required_forge_level();
    has_building_at_level(estate, BuildingType::Forge, required)
}

// Staged Tempering Helpers (Forge bonuses)

/// Calculate window duration with Forge level bonus
///
/// Forge level extends the strike window, making timing more forgiving.
/// Each level adds 5% to base window duration (max +100% at Lv.20).
///
/// Example: Divine tier base = 60s
/// - Lv.0:  60s window
/// - Lv.10: 90s window (+50%)
/// - Lv.20: 120s window (+100%)
pub fn calculate_window_duration(tier: QualityTier, forge_level: u8) -> i64 {
    let base = tier.base_window_duration_secs();
    if base == 0 {
        return 0;
    }

    // 5% per level, capped at 100% bonus (level 20)
    let bonus_percent = (forge_level as i64 * 5).min(100);
    base + (base * bonus_percent / 100)
}

/// Calculate stages required with Forge level reduction
///
/// Higher Forge levels reduce the number of stages required (master's efficiency).
/// Every 5 levels reduces one stage, minimum 1 stage.
///
/// Example: Divine tier base = 13 stages
/// - Lv.0:  13 stages
/// - Lv.5:  12 stages
/// - Lv.10: 11 stages
/// - Lv.20: 9 stages
pub fn calculate_stages_required(tier: QualityTier, forge_level: u8) -> u8 {
    let base = tier.stages_required();
    if base == 0 {
        return 0;
    }

    // Every 5 forge levels reduces one stage (min 1)
    let reduction = forge_level / 5;
    base.saturating_sub(reduction).max(1)
}

/// Get the Forge building level from estate (0 if not found/not active)
pub fn get_forge_level(estate: &EstateAccount) -> u8 {
    if let Some(forge) = estate.find_building(BuildingType::Forge) {
        if forge.is_active() {
            return forge.level;
        }
    }
    0
}

// Workshop Mining Bonus

/// Get mining output bonus from Workshop level (basis points)
/// Formula: 0.5% per level (50 bps per level)
#[allow(dead_code)]
pub fn workshop_mining_bonus_bps(estate: &EstateAccount) -> u16 {
    if let Some(workshop) = estate.find_building(BuildingType::Workshop) {
        if workshop.is_active() {
            return workshop.level as u16 * 50;
        }
    }
    0
}

// Dock Fishing Bonus

/// Get fishing output bonus from Dock level (basis points)
/// Formula: 0.5% per level (50 bps per level)
pub fn dock_fishing_bonus_bps(estate: &EstateAccount) -> u16 {
    if let Some(dock) = estate.find_building(BuildingType::Dock) {
        if dock.is_active() {
            return dock.level as u16 * 50;
        }
    }
    0
}


// Mine Mining Bonus

/// Get mining output bonus from Mine level (basis points)
/// Formula: 0.5% per level (50 bps per level)
pub fn mine_mining_bonus_bps(estate: &EstateAccount) -> u16 {
    if let Some(mine) = estate.find_building(BuildingType::Mine) {
        if mine.is_active() {
            return mine.level as u16 * 50;
        }
    }
    0
}

// Farm Produce Bonus

/// Get produce output bonus from Farm level (basis points)
/// Formula: 0.5% per level (50 bps per level)
pub fn farm_produce_bonus_bps(estate: &EstateAccount) -> u16 {
    if let Some(farm) = estate.find_building(BuildingType::Farm) {
        if farm.is_active() {
            return farm.level as u16 * 50;
        }
    }
    0
}

// Camp Operative Speed Bonus

/// Get operative training speed bonus from Camp level (basis points)
/// Formula: 0.5% per level (50 bps per level)
#[allow(dead_code)]
pub fn camp_operative_speed_bps(estate: &EstateAccount) -> u16 {
    if let Some(camp) = estate.find_building(BuildingType::Camp) {
        if camp.is_active() {
            return camp.level as u16 * 50;
        }
    }
    0
}

// TransportBay Travel Reduction

/// Get travel time reduction from TransportBay level (basis points)
/// Formula: 0.5% per level (50 bps per level)
pub fn stables_travel_reduction_bps(estate: &EstateAccount) -> u16 {
    if let Some(stables) = estate.find_building(BuildingType::TransportBay) {
        if stables.is_active() {
            return stables.level as u16 * 50;
        }
    }
    0
}

// Infirmary Recovery

/// Get unit recovery rate from Infirmary level (basis points)
/// Formula: 0.25% per level (25 bps per level, max 5% at lv20)
pub fn infirmary_recovery_bps(estate: &EstateAccount) -> u16 {
    if let Some(infirmary) = estate.find_building(BuildingType::Infirmary) {
        if infirmary.is_active() {
            return infirmary.level as u16 * 25;
        }
    }
    0
}

// DungeonEntry Dungeon Bonus

/// Get dungeon bonus from DungeonEntry level (basis points)
/// Formula: 0.5% per level (50 bps per level)
#[allow(dead_code)]
pub fn catacombs_dungeon_bonus_bps(estate: &EstateAccount) -> u16 {
    if let Some(catacombs) = estate.find_building(BuildingType::DungeonEntry) {
        if catacombs.is_active() {
            return catacombs.level as u16 * 50;
        }
    }
    0
}

// Treasury Prize Bonuses

/// Get prize bonus from Treasury level (basis points)
pub fn treasury_prize_bonus_bps(estate: &EstateAccount) -> u16 {
    if let Some(treasury) = estate.find_building(BuildingType::Treasury) {
        if treasury.is_active() {
            return match treasury.level {
                0 => 0,
                1..=4 => 0,
                5..=9 => 1000,   // +10%
                10..=14 => 2500, // +25%
                15..=19 => 4000, // +40%
                _ => 5000,       // +50%
            };
        }
    }
    0
}

// Citadel Rally Bonuses

/// Get rally capacity bonus from Citadel level (basis points)
pub fn citadel_rally_capacity_bps(estate: &EstateAccount) -> u16 {
    if let Some(citadel) = estate.find_building(BuildingType::Citadel) {
        if citadel.is_active() {
            // 5% per level
            return citadel.level as u16 * 500;
        }
    }
    0
}

/// Get rally damage bonus from Citadel level (basis points)
pub fn citadel_rally_damage_bps(estate: &EstateAccount) -> u16 {
    if let Some(citadel) = estate.find_building(BuildingType::Citadel) {
        if citadel.is_active() {
            // 0.5% per level
            return citadel.level as u16 * 50;
        }
    }
    0
}

// Observatory Loot Bonuses

/// Get loot bonus from Observatory level (basis points)
pub fn observatory_loot_bonus_bps(estate: &EstateAccount) -> u16 {
    if let Some(obs) = estate.find_building(BuildingType::Observatory) {
        if obs.is_active() {
            return match obs.level {
                0 => 0,
                1..=4 => 0,
                5..=9 => 1000,   // +10%
                10..=14 => 2500, // +25%
                15..=19 => 4000, // +40%
                _ => 6000,       // +60%
            };
        }
    }
    0
}

// Academy Research Speed & Mastery System

// φ (golden ratio) constants for integer math
// φ ≈ 1.618, we use 1618/1000 for precision
const PHI_NUM: u64 = 1618;
const PHI_DENOM: u64 = 1000;

/// Get research speed bonus from Academy level (basis points)
/// DEPRECATED: Use academy_mastery_speed_bonus_bps for mastery-based bonus
pub fn academy_research_speed_bps(estate: &EstateAccount) -> u16 {
    if let Some(academy) = estate.find_building(BuildingType::Academy) {
        if academy.is_active() {
            return match academy.level {
                0 => 0,
                1..=4 => 0,
                5..=9 => 1000,   // +10%
                10..=14 => 2500, // +25%
                15..=19 => 4000, // +40%
                _ => 6000,       // +60%
            };
        }
    }
    0
}

/// Get Academy mastery level (0-100)
pub fn get_academy_mastery(estate: &EstateAccount) -> u8 {
    if let Some(academy) = estate.find_building(BuildingType::Academy) {
        if academy.is_active() {
            return academy.mastery_level;
        }
    }
    0
}

/// Calculate research speed bonus from Academy mastery (basis points)
/// Formula: speed_bonus_bps = mastery² / φ ≈ mastery² × 0.618
///
/// Examples:
/// - Mastery 25:  386 bps (3.86%)
/// - Mastery 50:  1545 bps (15.45%)
/// - Mastery 100: 6180 bps (61.8%)
pub fn academy_mastery_speed_bonus_bps(mastery: u8) -> u16 {
    let m = mastery as u64;
    // m² × 1000 / 1618 = m² / φ
    let bonus = m.saturating_mul(m).saturating_mul(PHI_DENOM) / PHI_NUM;
    bonus.min(u16::MAX as u64) as u16
}

/// Calculate research cost discount from Academy mastery (basis points)
/// Formula: discount_bps = mastery × φ × 10 ≈ mastery × 16.18
///
/// Examples:
/// - Mastery 25:  404 bps (4.04% off)
/// - Mastery 50:  809 bps (8.09% off)
/// - Mastery 100: 1618 bps (16.18% off)
pub fn academy_mastery_cost_discount_bps(mastery: u8) -> u16 {
    let m = mastery as u64;
    // m × 1618 / 100 = m × φ × 10
    let discount = m.saturating_mul(PHI_NUM) / 100;
    discount.min(u16::MAX as u64) as u16
}

/// Calculate research time reduction from daily activity (seconds)
/// Formula: time_reduction = score × (10 + mastery / 10) × building_level / 2
///
/// Examples (Academy Lv 10):
/// - Score 50, Mastery 0:   50 × 10 × 5 = 2,500s (41 min)
/// - Score 100, Mastery 50: 100 × 15 × 5 = 7,500s (2h 5min)
/// - Score 100, Mastery 100: 100 × 20 × 5 = 10,000s (2h 46min)
pub fn academy_daily_time_reduction(score: u8, mastery: u8, building_level: u8) -> i64 {
    let s = score as i64;
    let m = mastery as i64;
    let lvl = building_level as i64;

    // score × (10 + mastery / 10) × building_level / 2
    s * (10 + m / 10) * lvl / 2
}

/// Calculate mastery cost to ascend Nth research node
/// Formula: cost = 5 × φ^(ascension_count) using Fibonacci approximation
///
/// Returns mastery points required (consumed when ascending)
/// - 1st ascension: 5
/// - 2nd: 8
/// - 3rd: 13
/// - 4th: 21
/// - 5th: 34
/// - 6th: 55
pub fn ascension_mastery_cost(ascension_count: u8) -> u8 {
    // Fibonacci-like progression: 5, 8, 13, 21, 34, 55, 89...
    // F(n) = round(5 × φ^n)
    match ascension_count {
        0 => 5,
        1 => 8,
        2 => 13,
        3 => 21,
        4 => 34,
        5 => 55,
        6 => 89,
        _ => 100, // Cap at 100 for safety
    }
}

// Estate Loading Helper

/// Load estate account from account info and verify ownership
pub fn load_estate_for_player<'a>(
    estate_account: &'a AccountView,
    player: &PlayerAccount,
    program_id: &Address,
) -> Result<&'a EstateAccount, ProgramError> {
    // Verify estate account is owned by this program
    if unsafe { estate_account.owner() } != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    // Load estate data
    let estate_data = estate_account.try_borrow()?;
    let estate = unsafe { EstateAccount::load(&estate_data) };

    // Verify ownership matches player
    if estate.owner != player.owner {
        return Err(GameError::Unauthorized.into());
    }

    // Return immutable reference (caller must re-borrow if needed)
    // Note: This is safe because we're returning a reference to stack-allocated
    // data that will be valid for 'a lifetime
    Ok(unsafe { &*(estate as *const EstateAccount) })
}

/// Load estate account mutably from account info and verify ownership
pub fn load_estate_for_player_mut<'a>(
    estate_account: &'a AccountView,
    player: &PlayerAccount,
    program_id: &Address,
) -> Result<&'a mut EstateAccount, ProgramError> {
    // Verify estate account is owned by this program
    if unsafe { estate_account.owner() } != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    // Load estate data mutably
    let mut estate_data = estate_account.try_borrow_mut()?;
    let estate = unsafe { EstateAccount::load_mut(&mut estate_data) };

    // Verify ownership matches player
    if estate.owner != player.owner {
        return Err(GameError::Unauthorized.into());
    }

    Ok(unsafe { &mut *(estate as *mut EstateAccount) })
}

/// Check if estate has an Infirmary building (any level)
pub fn has_infirmary(estate: &EstateAccount) -> bool {
    estate.find_building(BuildingType::Infirmary)
        .map(|slot| slot.level > 0)
        .unwrap_or(false)
}


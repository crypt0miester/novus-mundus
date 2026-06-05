//! Dungeon System Helpers
//!
//! Helper functions for dungeon combat, relics, darkness, and rewards.

use crate::constants::{
    DARKNESS_CRIT_PENALTY_PER_FLOOR_BPS, DARKNESS_CRIT_PENALTY_START_FLOOR,
    DARKNESS_DAMAGE_PENALTY_PER_FLOOR_BPS, DARKNESS_DEFENSE_PENALTY_PER_FLOOR_BPS,
    DARKNESS_DEFENSE_PENALTY_START_FLOOR, DARKNESS_ENEMY_BUFF_PER_FLOOR_BPS,
    DARKNESS_ENEMY_BUFF_START_FLOOR, DUNGEON_FLEE_PENALTY_BPS, DUNGEON_FLOOR_MULTIPLIERS,
    DUNGEON_UNIT_HEALTH, DUNGEON_UNIT_POWER, RELIC_EFFECTS, SYNERGY_2_BONUS_BPS,
    SYNERGY_3_BONUS_BPS, SYNERGY_BOSS, SYNERGY_CRIT, SYNERGY_DARKNESS, SYNERGY_DEFENSE,
    SYNERGY_HERO, SYNERGY_LOOT, SYNERGY_OFFENSE, SYNERGY_SUSTAIN,
};
use crate::logic::safe_math::apply_bp;
use crate::logic::time_cycle::TimeOfDay;
use crate::state::DungeonRun;

// RELIC EFFECT CALCULATIONS

/// Apply Tactician specialization bonus to relic effects (+30%)
fn apply_tactician_mult(run: &DungeonRun, value: u16) -> u16 {
    use crate::state::HeroSpecialization;
    let spec = run.get_specialization();
    if spec == HeroSpecialization::Tactician {
        // +30% to relic effects
        apply_bp(value as u64, 13000u64).unwrap_or(value as u64) as u16
    } else {
        value
    }
}

/// Calculate total attack bonus from relics (basis points)
pub fn calculate_relic_attack_bonus(run: &DungeonRun) -> u16 {
    let mut bonus = 0u16;

    // Relic 0: +15% attack
    if run.has_relic(0) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[0]);
    }

    // Relic 12: +30% attack (+15% damage taken handled in defense calc)
    if run.has_relic(12) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[12]);
    }

    // Relic 14 (15% double-attack): counted in crit/hit calculation
    // Relic 17: +50% attack (-30% defense handled in defense calc)
    if run.has_relic(17) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[17]);
    }

    // Relic 18: +40% attack when below 50% units
    if run.has_relic(18) {
        // Check if units are below 50% (need original units to compare)
        // This is handled in the combat processor with context
    }

    // Apply Tactician bonus (+30% to all relic effects)
    apply_tactician_mult(run, bonus)
}

/// Calculate total defense bonus from relics (basis points)
pub fn calculate_relic_defense_bonus(run: &DungeonRun) -> u16 {
    let mut bonus = 0u16;

    // Relic 1: +10% damage reduction
    if run.has_relic(1) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[1]);
    }

    // Relic 8: +15% unit survival
    if run.has_relic(8) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[8]);
    }

    // Relic 17: -30% defense (negative tradeoff for +50% attack)
    if run.has_relic(17) {
        bonus = bonus.saturating_sub(3000);
    }

    // Relic 12: +15% damage taken (negative tradeoff for +30% attack)
    if run.has_relic(12) {
        bonus = bonus.saturating_sub(1500);
    }

    // Apply Tactician bonus (+30% to all relic effects)
    // Note: For defense, we only boost the positive portion
    apply_tactician_mult(run, bonus)
}

/// Calculate crit chance bonus from relics (basis points)
pub fn calculate_relic_crit_chance(run: &DungeonRun) -> u16 {
    let mut bonus = 0u16;

    // Relic 2: +20% crit chance
    if run.has_relic(2) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[2]);
    }

    // Apply Tactician bonus (+30% to all relic effects)
    apply_tactician_mult(run, bonus)
}

/// Calculate crit damage bonus from relics (basis points)
pub fn calculate_relic_crit_damage(run: &DungeonRun) -> u16 {
    let mut bonus = 0u16;

    // Relic 3: +30% crit damage
    if run.has_relic(3) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[3]);
    }

    // Apply Tactician bonus (+30% to all relic effects)
    apply_tactician_mult(run, bonus)
}

/// Calculate lifesteal from relics (basis points)
pub fn calculate_relic_lifesteal(run: &DungeonRun) -> u16 {
    let mut bonus = 0u16;

    // Relic 4: 5% lifesteal
    if run.has_relic(4) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[4]);
    }

    // Apply Tactician bonus (+30% to all relic effects)
    apply_tactician_mult(run, bonus)
}

/// Calculate darkness reduction from relics (basis points)
pub fn calculate_relic_darkness_reduction(run: &DungeonRun) -> u16 {
    let mut bonus = 0u16;

    // Relic 5: -30% darkness
    if run.has_relic(5) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[5]);
    }

    // Apply Tactician bonus (+30% to all relic effects)
    apply_tactician_mult(run, bonus)
}

/// Calculate loot bonus from relics (basis points)
pub fn calculate_relic_loot_bonus(run: &DungeonRun) -> u16 {
    let mut bonus = 0u16;

    // Relic 6: +25% loot
    if run.has_relic(6) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[6]);
    }

    // Apply Tactician bonus (+30% to all relic effects)
    apply_tactician_mult(run, bonus)
}

/// Calculate boss power reduction from relics (basis points)
pub fn calculate_relic_boss_reduction(run: &DungeonRun) -> u16 {
    let mut bonus = 0u16;

    // Relic 7: -15% boss power
    if run.has_relic(7) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[7]);
    }

    // Apply Tactician bonus (+30% to all relic effects)
    apply_tactician_mult(run, bonus)
}

/// Calculate hero effectiveness bonus from relics (basis points)
pub fn calculate_relic_hero_bonus(run: &DungeonRun) -> u16 {
    let mut bonus = 0u16;

    // Relic 9: +25% hero effectiveness
    if run.has_relic(9) {
        bonus = bonus.saturating_add(RELIC_EFFECTS[9]);
    }

    // Apply Tactician bonus (+30% to all relic effects)
    apply_tactician_mult(run, bonus)
}

/// Check if player has the guaranteed-rare-drop relic (id 10)
pub fn has_guaranteed_rare_drop_relic(run: &DungeonRun) -> bool {
    run.has_relic(10)
}

/// Check if player has the one-time resurrection relic (id 11)
pub fn has_resurrection_relic(run: &DungeonRun) -> bool {
    run.has_relic(11)
}

/// Check if player has the one-shot immunity relic (id 13: min 1 unit survives)
pub fn has_one_shot_immunity_relic(run: &DungeonRun) -> bool {
    run.has_relic(13)
}

/// Double-attack chance from relic id 14 (basis points)
pub fn double_attack_chance(run: &DungeonRun) -> u16 {
    if run.has_relic(14) {
        // Apply Tactician bonus (+30% to all relic effects)
        apply_tactician_mult(run, RELIC_EFFECTS[14]) // 15% = 1500 bps (or 19.5% with Tactician)
    } else {
        0
    }
}

/// Check if player has the double-NOVI relic (id 15)
pub fn has_double_novi_relic(run: &DungeonRun) -> bool {
    run.has_relic(15)
}

/// Check if player has the darkness-crit-penalty immunity relic (id 16)
pub fn has_darkness_crit_immunity_relic(run: &DungeonRun) -> bool {
    run.has_relic(16)
}

// SYNERGY CALCULATIONS

/// Calculate synergy bonuses for a run
/// Returns (attack_bps, defense_bps, crit_bps, lifesteal_bps, darkness_reduction_bps, loot_bps, boss_reduction_bps, hero_bps)
pub fn calculate_synergy_bonuses(run: &DungeonRun) -> SynergyBonuses {
    let mut bonuses = SynergyBonuses::default();

    // Check each synergy tag
    for tag in 0..=8u8 {
        let count = run.count_relics_with_tag(tag);
        if count < 2 {
            continue;
        }

        let bonus_2 = SYNERGY_2_BONUS_BPS.get(tag as usize).copied().unwrap_or(0);
        let bonus_3 = if count >= 3 {
            SYNERGY_3_BONUS_BPS.get(tag as usize).copied().unwrap_or(0)
        } else {
            0
        };

        let total_bonus = bonus_2.saturating_add(bonus_3);

        match tag {
            SYNERGY_OFFENSE => bonuses.attack_bps = bonuses.attack_bps.saturating_add(total_bonus),
            SYNERGY_DEFENSE => {
                bonuses.defense_bps = bonuses.defense_bps.saturating_add(total_bonus)
            }
            SYNERGY_CRIT => {
                bonuses.crit_damage_bps = bonuses.crit_damage_bps.saturating_add(total_bonus)
            }
            SYNERGY_SUSTAIN => {
                bonuses.lifesteal_bps = bonuses.lifesteal_bps.saturating_add(total_bonus)
            }
            SYNERGY_DARKNESS => {
                bonuses.darkness_reduction_bps =
                    bonuses.darkness_reduction_bps.saturating_add(total_bonus)
            }
            SYNERGY_LOOT => bonuses.loot_bps = bonuses.loot_bps.saturating_add(total_bonus),
            SYNERGY_BOSS => {
                bonuses.boss_reduction_bps = bonuses.boss_reduction_bps.saturating_add(total_bonus)
            }
            SYNERGY_HERO => bonuses.hero_bps = bonuses.hero_bps.saturating_add(total_bonus),
            _ => {}
        }

        // 3-piece special effects
        if count >= 3 {
            match tag {
                SYNERGY_OFFENSE => {
                    bonuses.crit_chance_bps = bonuses.crit_chance_bps.saturating_add(1000)
                } // +10% crit
                SYNERGY_DEFENSE => {
                    bonuses.unit_health_bps = bonuses.unit_health_bps.saturating_add(1000)
                } // +10% unit HP
                SYNERGY_CRIT => bonuses.crit_heal_bps = 200, // crits heal 2%
                SYNERGY_SUSTAIN => bonuses.heal_effectiveness_bps = 2000, // +20% heal
                SYNERGY_LOOT => bonuses.extra_boss_drop = true,
                SYNERGY_BOSS => bonuses.boss_damage_bps = 1500, // +15% damage to boss
                _ => {}
            }
        }
    }

    bonuses
}

/// Synergy bonus container
#[derive(Default, Copy, Clone)]
pub struct SynergyBonuses {
    pub attack_bps: u16,
    pub defense_bps: u16,
    pub crit_chance_bps: u16,
    pub crit_damage_bps: u16,
    pub lifesteal_bps: u16,
    pub darkness_reduction_bps: u16,
    pub loot_bps: u16,
    pub boss_reduction_bps: u16,
    pub hero_bps: u16,
    pub unit_health_bps: u16,
    pub crit_heal_bps: u16,
    pub heal_effectiveness_bps: u16,
    pub boss_damage_bps: u16,
    pub extra_boss_drop: bool,
}

// DARKNESS CALCULATIONS

/// Calculate darkness damage penalty for a floor (basis points)
pub fn calculate_darkness_damage_penalty(floor: u8, mitigation_bps: u16) -> u16 {
    let base_penalty = (floor as u16).saturating_mul(DARKNESS_DAMAGE_PENALTY_PER_FLOOR_BPS);

    // Apply mitigation
    if mitigation_bps >= 10000 {
        0 // Fully immune
    } else {
        let reduction = apply_bp(base_penalty as u64, mitigation_bps as u64).unwrap_or(0) as u16;
        base_penalty.saturating_sub(reduction)
    }
}

/// Calculate darkness crit penalty for a floor (basis points)
pub fn calculate_darkness_crit_penalty(
    floor: u8,
    mitigation_bps: u16,
    has_crit_immunity: bool,
) -> u16 {
    if has_crit_immunity || floor < DARKNESS_CRIT_PENALTY_START_FLOOR {
        return 0;
    }

    let floors_affected = floor.saturating_sub(DARKNESS_CRIT_PENALTY_START_FLOOR - 1);
    let base_penalty = (floors_affected as u16).saturating_mul(DARKNESS_CRIT_PENALTY_PER_FLOOR_BPS);

    // Apply mitigation
    if mitigation_bps >= 10000 {
        0
    } else {
        let reduction = apply_bp(base_penalty as u64, mitigation_bps as u64).unwrap_or(0) as u16;
        base_penalty.saturating_sub(reduction)
    }
}

/// Calculate darkness defense penalty for a floor (basis points)
pub fn calculate_darkness_defense_penalty(floor: u8, mitigation_bps: u16) -> u16 {
    if floor < DARKNESS_DEFENSE_PENALTY_START_FLOOR {
        return 0;
    }

    let floors_affected = floor.saturating_sub(DARKNESS_DEFENSE_PENALTY_START_FLOOR - 1);
    let base_penalty =
        (floors_affected as u16).saturating_mul(DARKNESS_DEFENSE_PENALTY_PER_FLOOR_BPS);

    if mitigation_bps >= 10000 {
        0
    } else {
        let reduction = apply_bp(base_penalty as u64, mitigation_bps as u64).unwrap_or(0) as u16;
        base_penalty.saturating_sub(reduction)
    }
}

/// Calculate darkness enemy buff for a floor (basis points)
pub fn calculate_darkness_enemy_buff(floor: u8, mitigation_bps: u16) -> u16 {
    if floor < DARKNESS_ENEMY_BUFF_START_FLOOR {
        return 0;
    }

    let floors_affected = floor.saturating_sub(DARKNESS_ENEMY_BUFF_START_FLOOR - 1);
    let base_buff = (floors_affected as u16).saturating_mul(DARKNESS_ENEMY_BUFF_PER_FLOOR_BPS);

    if mitigation_bps >= 10000 {
        0
    } else {
        let reduction = apply_bp(base_buff as u64, mitigation_bps as u64).unwrap_or(0) as u16;
        base_buff.saturating_sub(reduction)
    }
}

/// Calculate total darkness mitigation from relics and synergies.
/// Takes the caller's already-computed `SynergyBonuses` so it doesn't re-run the
/// 9×20 synergy scan (the caller needs `synergies` anyway).
pub fn calculate_total_darkness_mitigation(
    run: &DungeonRun,
    synergy_bonuses: &SynergyBonuses,
) -> u16 {
    let relic_mitigation = calculate_relic_darkness_reduction(run);
    // Scout specialization: -25% darkness effects
    let scout_mitigation = get_scout_darkness_reduction(run.get_specialization());

    relic_mitigation
        .saturating_add(synergy_bonuses.darkness_reduction_bps)
        .saturating_add(scout_mitigation)
}

// COMBAT CALCULATIONS

/// Calculate player's combat power from remaining units
pub fn calculate_unit_power(remaining_units: &[u64; 3]) -> u64 {
    let mut power = 0u64;
    for tier in 0..3 {
        power =
            power.saturating_add(remaining_units[tier].saturating_mul(DUNGEON_UNIT_POWER[tier]));
    }
    power
}

/// Calculate total unit HP
pub fn calculate_total_unit_hp(remaining_units: &[u64; 3]) -> u64 {
    let mut hp = 0u64;
    for tier in 0..3 {
        hp = hp.saturating_add(remaining_units[tier].saturating_mul(DUNGEON_UNIT_HEALTH[tier]));
    }
    hp
}

/// Calculate damage dealt to enemy
/// Returns (base_damage, final_damage_after_buffs)
pub fn calculate_dungeon_damage(
    run: &DungeonRun,
    base_unit_power: u64,
    hero_attack_bps: u16,
    weapon_power: u64,
    is_boss: bool,
    synergies: &SynergyBonuses,
    darkness_mitigation: u16,
) -> u64 {
    // Start with unit power + weapon power
    let mut damage = base_unit_power.saturating_add(weapon_power);

    // Apply hero attack buff
    if hero_attack_bps > 0 {
        damage = apply_bp(damage, 10000u64.saturating_add(hero_attack_bps as u64)).unwrap_or(damage);
    }

    // Apply relic attack bonus
    let relic_attack = calculate_relic_attack_bonus(run);
    if relic_attack > 0 {
        damage = apply_bp(damage, 10000u64.saturating_add(relic_attack as u64)).unwrap_or(damage);
    }

    // Apply synergy bonuses (precomputed by caller)
    if synergies.attack_bps > 0 {
        damage = apply_bp(damage, 10000u64.saturating_add(synergies.attack_bps as u64)).unwrap_or(damage);
    }

    // Apply darkness penalty (scaled by time of day)
    let base_darkness_penalty =
        calculate_darkness_damage_penalty(run.current_floor, darkness_mitigation);
    // Apply time-based darkness modifier (Day -50%, Night +50%)
    let time_period = TimePeriod::from_u8(run.time_period).unwrap_or(TimePeriod::Day);
    let darkness_penalty = calculate_darkness_with_time(base_darkness_penalty, time_period, false);
    if darkness_penalty > 0 {
        let reduction = apply_bp(damage, darkness_penalty as u64).unwrap_or(0);
        damage = damage.saturating_sub(reduction);
    }

    // Apply boss-specific bonuses/reductions
    if is_boss {
        // Boss reduction from relics and synergies increases effective damage
        let boss_reduction = calculate_relic_boss_reduction(run);
        let synergy_boss_reduction = synergies.boss_reduction_bps;
        let total_boss_reduction = boss_reduction.saturating_add(synergy_boss_reduction);

        // Apply boss reduction as damage bonus (equivalent to reducing boss defense)
        if total_boss_reduction > 0 {
            damage = apply_bp(damage, 10000u64.saturating_add(total_boss_reduction as u64)).unwrap_or(damage);
        }

        // Additional boss damage from 3-piece BOSS synergy
        if synergies.boss_damage_bps > 0 {
            damage =
                apply_bp(damage, 10000u64.saturating_add(synergies.boss_damage_bps as u64)).unwrap_or(damage);
        }
    }

    // Apply camp buff if active (from found supplies)
    if run.camp_bonus_bps > 0 && run.current_floor <= run.camp_expires_floor {
        damage = apply_bp(damage, 10000u64.saturating_add(run.camp_bonus_bps as u64)).unwrap_or(damage);
    }

    damage
}

/// Calculate enemy counterattack damage
pub fn calculate_enemy_damage(
    run: &DungeonRun,
    enemy_power: u32,
    is_boss: bool,
    synergies: &SynergyBonuses,
    darkness_mitigation: u16,
) -> u64 {
    let mut damage = enemy_power as u64;

    // Apply darkness enemy buff (scaled by time of day)
    let base_enemy_buff = calculate_darkness_enemy_buff(run.current_floor, darkness_mitigation);
    // Apply time-based darkness modifier (Day -50%, Night +50%)
    let time_period = TimePeriod::from_u8(run.time_period).unwrap_or(TimePeriod::Day);
    let enemy_buff = calculate_darkness_with_time(base_enemy_buff, time_period, false);
    if enemy_buff > 0 {
        damage = apply_bp(damage, 10000u64.saturating_add(enemy_buff as u64)).unwrap_or(damage);
    }

    // Boss gets power reduction from relics/synergies
    if is_boss {
        let boss_reduction = calculate_relic_boss_reduction(run);
        let total_reduction = boss_reduction.saturating_add(synergies.boss_reduction_bps);

        if total_reduction > 0 {
            let reduction = apply_bp(damage, total_reduction as u64).unwrap_or(0);
            damage = damage.saturating_sub(reduction);
        }
    }

    damage
}

/// Calculate damage taken by player units after defense
pub fn calculate_damage_taken(
    run: &DungeonRun,
    incoming_damage: u64,
    player_defense_bps: u16,
    synergies: &SynergyBonuses,
    darkness_mitigation: u16,
) -> u64 {
    let mut damage = incoming_damage;

    // Apply player defense
    if player_defense_bps > 0 {
        let reduction = apply_bp(damage, player_defense_bps as u64).unwrap_or(0);
        damage = damage.saturating_sub(reduction);
    }

    // Apply relic defense bonus
    let relic_defense = calculate_relic_defense_bonus(run);
    if relic_defense > 0 {
        let reduction = apply_bp(damage, relic_defense as u64).unwrap_or(0);
        damage = damage.saturating_sub(reduction);
    }

    // Apply synergy defense bonus (precomputed by caller)
    if synergies.defense_bps > 0 {
        let reduction = apply_bp(damage, synergies.defense_bps as u64).unwrap_or(0);
        damage = damage.saturating_sub(reduction);
    }

    // Apply darkness defense penalty (increases damage taken, scaled by time of day)
    let base_defense_penalty =
        calculate_darkness_defense_penalty(run.current_floor, darkness_mitigation);
    // Apply time-based darkness modifier (Day -50%, Night +50%)
    let time_period = TimePeriod::from_u8(run.time_period).unwrap_or(TimePeriod::Day);
    let defense_penalty = calculate_darkness_with_time(base_defense_penalty, time_period, false);
    if defense_penalty > 0 {
        damage = apply_bp(damage, 10000u64.saturating_add(defense_penalty as u64)).unwrap_or(damage);
    }

    damage
}

// REWARD CALCULATIONS

/// Get floor reward multiplier (×10000 precision)
pub fn get_floor_multiplier(floor: u8) -> u32 {
    if floor == 0 || floor > 10 {
        return DUNGEON_FLOOR_MULTIPLIERS[0];
    }
    DUNGEON_FLOOR_MULTIPLIERS[(floor - 1) as usize]
}

/// Calculate XP reward for a room
pub fn calculate_room_xp(base_xp: u64, floor: u8) -> u64 {
    let multiplier = get_floor_multiplier(floor);
    base_xp.saturating_mul(multiplier as u64) / 10000
}

/// Calculate NOVI reward for a floor
pub fn calculate_floor_novi(base_novi: u64, floor: u8, has_double_novi: bool) -> u64 {
    let multiplier = get_floor_multiplier(floor);
    let mut novi = base_novi.saturating_mul(multiplier as u64) / 10000;

    if has_double_novi {
        novi = novi.saturating_mul(2);
    }

    novi
}

/// Calculate flee penalty based on current floor
pub fn get_flee_penalty_bps(floor: u8) -> u16 {
    let range = if floor <= 3 {
        0
    } else if floor <= 6 {
        1
    } else if floor <= 9 {
        2
    } else {
        3
    };

    DUNGEON_FLEE_PENALTY_BPS[range]
}

/// Apply penalty to accumulated rewards
pub fn apply_reward_penalty(run: &DungeonRun, penalty_bps: u16) -> (u64, u64, u64) {
    let xp = apply_bp(run.pending_xp, penalty_bps as u64).unwrap_or(0);
    let novi = apply_bp(run.pending_novi, penalty_bps as u64).unwrap_or(0);
    let gems = apply_bp(run.pending_gems, penalty_bps as u64).unwrap_or(0);

    (xp, novi, gems)
}

/// Calculate loot with bonuses
pub fn calculate_loot_with_bonuses(
    base_loot: u64,
    run: &DungeonRun,
    building_bonus_bps: u16,
) -> u64 {
    let mut loot = base_loot;

    // Apply relic loot bonus
    let relic_bonus = calculate_relic_loot_bonus(run);
    if relic_bonus > 0 {
        loot = apply_bp(loot, 10000u64.saturating_add(relic_bonus as u64)).unwrap_or(loot);
    }

    // Apply synergy loot bonus
    let synergies = calculate_synergy_bonuses(run);
    if synergies.loot_bps > 0 {
        loot = apply_bp(loot, 10000u64.saturating_add(synergies.loot_bps as u64)).unwrap_or(loot);
    }

    // Apply building (Observatory/Treasury/Catacombs) bonus
    if building_bonus_bps > 0 {
        loot = apply_bp(loot, 10000u64.saturating_add(building_bonus_bps as u64)).unwrap_or(loot);
    }

    loot
}

// DUNGEON TIME PERIODS - Simplified from TimeOfDay

/// Simplified time periods for dungeon mechanics (4 periods vs 7 in TimeOfDay)
/// Maps from the comprehensive TimeOfDay system in logic/time_cycle.rs
///
/// Dawn: Light rises, undead weaken
/// Day: Full light, safe runs
/// Dusk: Shadows lengthen, beasts hunt
/// Night: Darkness reigns, high risk/reward
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TimePeriod {
    Dawn = 0,
    Day = 1,
    Dusk = 2,
    Night = 3,
}

impl TimePeriod {
    /// Convert from the comprehensive TimeOfDay system
    /// Maps 7 periods to 4 dungeon-relevant periods
    pub fn from_time_of_day(time: TimeOfDay) -> Self {
        match time {
            TimeOfDay::Dawn => TimePeriod::Dawn,
            TimeOfDay::Morning | TimeOfDay::Midday | TimeOfDay::Afternoon => TimePeriod::Day,
            TimeOfDay::Dusk => TimePeriod::Dusk,
            TimeOfDay::Evening | TimeOfDay::DeepNight => TimePeriod::Night,
        }
    }

    /// Get time period from stored u8
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(TimePeriod::Dawn),
            1 => Some(TimePeriod::Day),
            2 => Some(TimePeriod::Dusk),
            3 => Some(TimePeriod::Night),
            _ => None,
        }
    }

    /// Check if currently in Witching Hour (DeepNight in TimeOfDay)
    /// Used for special Witching Hour mechanics (rare encounters, bonus rewards)
    #[allow(dead_code)]
    pub fn is_witching_hour(time: TimeOfDay) -> bool {
        matches!(time, TimeOfDay::DeepNight)
    }

    /// Check if currently in High Noon (Midday in TimeOfDay)
    /// Used for High Noon mechanics (nullifies darkness)
    #[allow(dead_code)]
    pub fn is_high_noon(time: TimeOfDay) -> bool {
        matches!(time, TimeOfDay::Midday)
    }

    /// Check if currently in First Light (early Dawn in TimeOfDay)
    /// Note: For precise first light timing, use timestamp directly
    pub fn is_first_light(timestamp: i64) -> bool {
        let seconds_in_day = timestamp % 86400;
        seconds_in_day >= 21600 && seconds_in_day < 23400 // 6:00-6:30 UTC
    }
}

/// Time-based modifiers for dungeon mechanics
/// Note: Some fields are used by backend/off-chain systems for relic selection
/// and shrine mechanics, not directly in on-chain code.
#[allow(dead_code)]
pub struct TimeModifiers {
    /// Darkness effect multiplier (bps, 10000 = 100%)
    pub darkness_mult_bps: u16,
    /// Enemy power multiplier (bps)
    pub enemy_power_mult_bps: u16,
    /// XP bonus (bps)
    pub xp_bonus_bps: u16,
    /// NOVI bonus (bps)
    pub novi_bonus_bps: u16,
    /// Loot bonus (bps) - used by backend for loot calculations
    pub loot_bonus_bps: u16,
    /// Extra relic choices (for Dawn) - used by backend for relic selection
    pub extra_relic_choices: u8,
    /// Shrine buff duration in floors (for Day) - used by backend
    pub shrine_buff_floors: u8,
    /// Gem multiplier for treasure rooms (bps, for Dusk)
    pub treasure_gem_mult_bps: u16,
}

/// Get time-based modifiers for a given period
pub fn get_time_modifiers(period: TimePeriod) -> TimeModifiers {
    match period {
        TimePeriod::Dawn => TimeModifiers {
            darkness_mult_bps: 7500,    // -25% darkness
            enemy_power_mult_bps: 9000, // -10% enemy power
            xp_bonus_bps: 1500,         // +15% XP
            novi_bonus_bps: 0,
            loot_bonus_bps: 0,
            extra_relic_choices: 1, // First relic has 4 choices
            shrine_buff_floors: 1,
            treasure_gem_mult_bps: 10000,
        },
        TimePeriod::Day => TimeModifiers {
            darkness_mult_bps: 5000,     // -50% darkness
            enemy_power_mult_bps: 10000, // Normal
            xp_bonus_bps: 0,
            novi_bonus_bps: 0,
            loot_bonus_bps: 0,
            extra_relic_choices: 0,
            shrine_buff_floors: 2, // Shrine buffs last 2 floors
            treasure_gem_mult_bps: 10000,
        },
        TimePeriod::Dusk => TimeModifiers {
            darkness_mult_bps: 10000,    // Normal darkness
            enemy_power_mult_bps: 11000, // +10% enemy power
            xp_bonus_bps: 0,
            novi_bonus_bps: 0,
            loot_bonus_bps: 2000, // +20% loot
            extra_relic_choices: 0,
            shrine_buff_floors: 1,
            treasure_gem_mult_bps: 20000, // 2x gems in treasure rooms
        },
        TimePeriod::Night => TimeModifiers {
            darkness_mult_bps: 15000,    // +50% darkness
            enemy_power_mult_bps: 11500, // +15% enemy power
            xp_bonus_bps: 0,
            novi_bonus_bps: 2500, // +25% NOVI
            loot_bonus_bps: 0,
            extra_relic_choices: 0, // Rare relics 2x more likely (handled in backend)
            shrine_buff_floors: 1,
            treasure_gem_mult_bps: 10000,
        },
    }
}

/// Dungeon mechanical category for time interactions.
/// Theme-flavored display names are mapped by the SDK; on-chain code only
/// uses the abstract enemy archetype.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DungeonTheme {
    /// Enemies weakened by radiant/light effects — strong at night, weak by day
    RadiantWeakness = 0,
    /// Fast enemies — strong at dusk, weak at dawn
    FastMobs = 1,
    /// Enemies amplified by darkness — strong at night, weak at dawn
    DarknessVulnerable = 2,
    /// Heavily armored enemies — immune to time-of-day effects
    ArmoredMobs = 3,
}

impl DungeonTheme {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(DungeonTheme::RadiantWeakness),
            1 => Some(DungeonTheme::FastMobs),
            2 => Some(DungeonTheme::DarknessVulnerable),
            3 => Some(DungeonTheme::ArmoredMobs),
            _ => None,
        }
    }
}

/// Get theme-specific enemy power modifier based on time
/// Returns basis points adjustment (positive = stronger, negative = weaker)
pub fn get_theme_time_modifier(theme: DungeonTheme, period: TimePeriod) -> i16 {
    match theme {
        DungeonTheme::RadiantWeakness => match period {
            TimePeriod::Night => 2000, // +20% at night
            TimePeriod::Day => -2000,  // -20% during day
            _ => 0,
        },
        DungeonTheme::FastMobs => match period {
            TimePeriod::Dusk => 1500,  // +15% at dusk
            TimePeriod::Dawn => -1500, // -15% at dawn
            _ => 0,
        },
        DungeonTheme::DarknessVulnerable => match period {
            TimePeriod::Night => 2500, // +25% at night
            TimePeriod::Dawn => -2500, // -25% at dawn
            _ => 0,
        },
        DungeonTheme::ArmoredMobs => 0, // Immune to time-of-day effects
    }
}

/// Calculate final enemy power with time modifiers
pub fn calculate_enemy_power_with_time(
    base_power: u32,
    period: TimePeriod,
    theme: DungeonTheme,
) -> u32 {
    let time_mods = get_time_modifiers(period);
    let theme_mod = get_theme_time_modifier(theme, period);

    // Apply time period modifier
    let mut power = apply_bp(base_power as u64, time_mods.enemy_power_mult_bps as u64)
        .unwrap_or(base_power as u64);

    // Apply theme modifier (can be positive or negative)
    if theme_mod > 0 {
        power = apply_bp(power, 10000u64.saturating_add(theme_mod as u64)).unwrap_or(power);
    } else if theme_mod < 0 {
        let reduction = apply_bp(power, (-theme_mod) as u64).unwrap_or(0);
        power = power.saturating_sub(reduction);
    }

    power as u32
}

/// Calculate darkness with time modifiers
pub fn calculate_darkness_with_time(
    base_darkness_bps: u16,
    period: TimePeriod,
    is_high_noon: bool,
) -> u16 {
    // High Noon completely nullifies darkness
    if is_high_noon {
        return 0;
    }

    let time_mods = get_time_modifiers(period);
    apply_bp(base_darkness_bps as u64, time_mods.darkness_mult_bps as u64)
        .unwrap_or(base_darkness_bps as u64) as u16
}

/// Calculate XP with time modifiers
pub fn calculate_xp_with_time(base_xp: u64, period: TimePeriod, is_first_light: bool) -> u64 {
    let time_mods = get_time_modifiers(period);
    let mut xp = base_xp;

    // Apply time period XP bonus
    if time_mods.xp_bonus_bps > 0 {
        xp = apply_bp(xp, 10000u64.saturating_add(time_mods.xp_bonus_bps as u64)).unwrap_or(xp);
    }

    // First Light bonus (+50% for 30 minutes)
    if is_first_light {
        xp = apply_bp(xp, 15000u64).unwrap_or(xp); // +50%
    }

    xp
}

/// Calculate NOVI with time modifiers
pub fn calculate_novi_with_time(base_novi: u64, period: TimePeriod) -> u64 {
    let time_mods = get_time_modifiers(period);

    if time_mods.novi_bonus_bps > 0 {
        apply_bp(base_novi, 10000u64.saturating_add(time_mods.novi_bonus_bps as u64)).unwrap_or(base_novi)
    } else {
        base_novi
    }
}

/// Calculate treasure room gems with time modifiers
pub fn calculate_treasure_gems_with_time(base_gems: u64, period: TimePeriod) -> u64 {
    let time_mods = get_time_modifiers(period);
    apply_bp(base_gems, time_mods.treasure_gem_mult_bps as u64).unwrap_or(base_gems)
}

// BOSS WRATH SYSTEM - Multi-Phase Boss Mechanics

/// Boss wrath thresholds
pub const WRATH_FIRST_BLOOD: u8 = 25; // +15% damage
pub const WRATH_AWAKENED: u8 = 50; // Theme ability activates
pub const WRATH_DESPERATE: u8 = 75; // Attacks twice, +30% damage, -20% defense
pub const WRATH_DEATH_THROES: u8 = 90; // +50% damage, attacks twice, -50% defense

/// Calculate boss wrath from damage taken
pub fn calculate_boss_wrath(damage_taken: u64, max_hp: u64) -> u8 {
    if max_hp == 0 {
        return 0;
    }
    let wrath = damage_taken.saturating_mul(100) / max_hp;
    wrath.min(100) as u8
}

/// Get boss damage multiplier based on wrath level
/// Returns (damage_mult_bps, attacks_per_turn)
pub fn get_boss_wrath_damage(wrath: u8, synergies: &SynergyBonuses) -> (u16, u8) {
    let has_defense_3 = synergies.defense_bps >= 3000; // 3-piece DEFENSE

    // Base damage multiplier and attacks
    let (base_mult, base_attacks): (u16, u8) = if wrath >= WRATH_DEATH_THROES {
        (15000, 2u8) // +50% damage, 2 attacks
    } else if wrath >= WRATH_DESPERATE {
        (13000, 2u8) // +30% damage, 2 attacks
    } else if wrath >= WRATH_FIRST_BLOOD {
        (11500, 1u8) // +15% damage, 1 attack
    } else {
        (10000, 1u8) // Normal
    };

    // DEFENSE 3-piece halves wrath damage bonuses
    let final_mult = if has_defense_3 && base_mult > 10000 {
        let bonus = base_mult.saturating_sub(10000);
        10000u16.saturating_add(bonus / 2)
    } else {
        base_mult
    };

    (final_mult, base_attacks)
}

/// Get boss defense modifier based on wrath level
/// Returns defense multiplier in basis points (lower = takes more damage)
pub fn get_boss_wrath_defense(wrath: u8) -> u16 {
    if wrath >= WRATH_DEATH_THROES {
        5000 // -50% defense (takes 2x damage)
    } else if wrath >= WRATH_DESPERATE {
        8000 // -20% defense
    } else {
        10000 // Normal
    }
}

/// Check if boss ability should trigger (at 50 wrath)
pub fn should_trigger_boss_ability(old_wrath: u8, new_wrath: u8) -> bool {
    old_wrath < WRATH_AWAKENED && new_wrath >= WRATH_AWAKENED
}

/// Boss ability effects by theme
/// Note: Fields are populated by get_boss_ability() and consumed by
/// the combat processor's boss attack logic, which may be in backend
/// or in attack.rs depending on implementation phase.
#[allow(dead_code)]
pub struct BossAbility {
    /// Ability is active
    pub active: bool,
    /// Soul Harvest: Boss heals this % of damage dealt
    pub lifesteal_bps: u16,
    /// Blood Frenzy: Attacks ignore this much defense (bps)
    pub defense_pierce_bps: u16,
    /// Abyssal Rift: Darkness multiplier
    pub darkness_mult: u8,
    /// Iron Shell: Shield HP remaining
    pub shield_hp: u64,
    /// Remaining attacks for limited-duration abilities
    pub remaining_attacks: u8,
}

// HERO SPECIALIZATION HELPERS

use crate::state::HeroSpecialization;

/// Apply Warrior attack bonus (+20% attack)
pub fn apply_warrior_attack_bonus(damage: u64, spec: HeroSpecialization) -> u64 {
    let bonus = spec.attack_bonus_bps();
    if bonus > 0 {
        apply_bp(damage, 10000u64.saturating_add(bonus as u64)).unwrap_or(damage)
    } else if bonus < 0 {
        let reduction = apply_bp(damage, (-bonus) as u64).unwrap_or(0);
        damage.saturating_sub(reduction)
    } else {
        damage
    }
}

/// Apply Guardian survival bonus (+25% damage reduction)
pub fn apply_guardian_survival(damage: u64, spec: HeroSpecialization) -> u64 {
    let bonus = spec.survival_bonus_bps();
    if bonus > 0 {
        let reduction = apply_bp(damage, bonus as u64).unwrap_or(0);
        damage.saturating_sub(reduction)
    } else {
        damage
    }
}

/// Apply Scout darkness reduction (-25% darkness effects)
pub fn get_scout_darkness_reduction(spec: HeroSpecialization) -> u16 {
    spec.darkness_reduction_bps()
}

/// Apply Scout loot bonus (+15% loot)
pub fn apply_scout_loot_bonus(loot: u64, spec: HeroSpecialization) -> u64 {
    let bonus = spec.loot_bonus_bps();
    if bonus > 0 {
        apply_bp(loot, 10000u64.saturating_add(bonus as u64)).unwrap_or(loot)
    } else {
        loot
    }
}

/// Apply Tactician relic effect multiplier (+30% relic effects)
/// Note: This function is available for external use, but most internal relic
/// calculations already apply Tactician bonus via apply_tactician_mult().
#[allow(dead_code)]
pub fn apply_tactician_relic_bonus(effect_bps: u16, spec: HeroSpecialization) -> u16 {
    let mult = spec.relic_effect_mult_bps();
    if mult > 10000 {
        apply_bp(effect_bps as u64, mult as u64).unwrap_or(effect_bps as u64) as u16
    } else {
        effect_bps
    }
}

/// Apply Warrior healing penalty (-10% healing)
pub fn apply_healing_modifier(heal_amount: u64, spec: HeroSpecialization) -> u64 {
    let modifier = spec.healing_modifier_bps();
    if modifier < 0 {
        let reduction = apply_bp(heal_amount, (-modifier) as u64).unwrap_or(0);
        heal_amount.saturating_sub(reduction)
    } else if modifier > 0 {
        apply_bp(heal_amount, 10000u64.saturating_add(modifier as u64)).unwrap_or(heal_amount)
    } else {
        heal_amount
    }
}

/// Get boss ability for a theme
pub fn get_boss_ability(theme: DungeonTheme, boss_max_hp: u64, run: &DungeonRun) -> BossAbility {
    let synergies = calculate_synergy_bonuses(run);
    let has_boss_3 = synergies.boss_reduction_bps >= 2500; // 3-piece BOSS

    // BOSS 3-piece completely negates ability
    if has_boss_3 {
        return BossAbility {
            active: false,
            lifesteal_bps: 0,
            defense_pierce_bps: 0,
            darkness_mult: 1,
            shield_hp: 0,
            remaining_attacks: 0,
        };
    }

    let has_boss_2 = synergies.boss_reduction_bps >= 1000; // 2-piece BOSS
    let duration_mult = if has_boss_2 { 1 } else { 2 }; // Half duration with 2-piece

    match theme {
        DungeonTheme::RadiantWeakness => BossAbility {
            active: true,
            lifesteal_bps: 2000, // Heals 20% of damage dealt
            defense_pierce_bps: 0,
            darkness_mult: 1,
            shield_hp: 0,
            remaining_attacks: 255, // Permanent until killed
        },
        DungeonTheme::FastMobs => BossAbility {
            active: true,
            lifesteal_bps: 0,
            defense_pierce_bps: 10000, // Ignores all defense
            darkness_mult: 1,
            shield_hp: 0,
            remaining_attacks: 3u8.saturating_mul(duration_mult), // 3 attacks (or 6 without counter)
        },
        DungeonTheme::DarknessVulnerable => BossAbility {
            active: true,
            lifesteal_bps: 0,
            defense_pierce_bps: 0,
            darkness_mult: 3, // Darkness effects x3
            shield_hp: 0,
            remaining_attacks: 255, // Permanent until killed
        },
        DungeonTheme::ArmoredMobs => BossAbility {
            active: true,
            lifesteal_bps: 0,
            defense_pierce_bps: 0,
            darkness_mult: 1,
            shield_hp: boss_max_hp.saturating_mul(30) / 100, // 30% max HP shield
            remaining_attacks: 255,            // Until shield broken
        },
    }
}

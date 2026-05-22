use crate::logic::safe_math::{apply_bp, apply_bp_bonus, chain_bp, mul_div};
use crate::constants::{
    WEAPON_LOOT_RATE_BPS,
    ARMORY_RAID_WITH_OPERATIVES_BPS, ARMORY_RAID_UNDEFENDED_BPS,
    DAMAGE_PER_SIEGE_WEAPON, SIEGE_CAPTURE_RATE_BPS,
    DEFENSIVE_UNIT_HEALTH,
};

// Weapon Set - Tracks melee, ranged, siege weapons

/// A set of weapons (melee, ranged, siege)
/// Used for tracking weapon commitment, drops, loot, and returns
#[derive(Copy, Clone, Default, Debug)]
pub struct WeaponSet {
    pub melee: u64,
    pub ranged: u64,
    pub siege: u64,
}

impl WeaponSet {
    /// Create a new weapon set
    pub const fn new(melee: u64, ranged: u64, siege: u64) -> Self {
        Self { melee, ranged, siege }
    }

    /// Total weapons across all types
    pub fn total(&self) -> u64 {
        self.melee
            .saturating_add(self.ranged)
            .saturating_add(self.siege)
    }

    /// Apply a basis point rate to all weapon types
    /// Returns: weapons × rate / 10000
    pub fn apply_rate_bps(&self, rate_bps: u16) -> Self {
        Self {
            melee: mul_div(self.melee, rate_bps as u64, 10000).unwrap_or(0),
            ranged: mul_div(self.ranged, rate_bps as u64, 10000).unwrap_or(0),
            siege: mul_div(self.siege, rate_bps as u64, 10000).unwrap_or(0),
        }
    }

}

// Combat Weapon Result - Outcome of weapon combat resolution

/// Result of weapon combat resolution
#[derive(Copy, Clone, Default, Debug)]
pub struct CombatWeaponResult {
    /// Weapons the attacker carries home (surviving troops' weapons)
    pub attacker_weapons_returned: WeaponSet,
    /// Weapons the attacker looted from dead defenders
    pub attacker_weapons_looted: WeaponSet,
    /// Weapons the defender looted from dead attackers (if defender won)
    pub defender_weapons_looted: WeaponSet,
    /// Whether the attacker won the battle
    pub attacker_won: bool,
}

// Combat Weapon Resolution Functions

/// Resolve weapon outcomes from combat
///
/// This function determines what happens to weapons after a battle:
/// - Winner loots weapons from dead enemy troops (60%)
/// - Winner recovers own dropped weapons (80%)
/// - Loser loses all dropped weapons (can't recover)
/// - Siege weapons are consumed based on damage dealt
/// - Fallback mode: attacker raids armory directly
///
/// # Arguments
/// * `attacker_troops` - Total troops committed by attacker
/// * `attacker_casualties` - Troops the attacker lost
/// * `attacker_weapons` - Weapons committed by attacker
/// * `attacker_damage_dealt` - Damage the attacker dealt (for siege consumption)
/// * `defender_troops` - Total garrison troops (0 if fallback mode)
/// * `defender_casualties` - Troops the defender lost
/// * `defender_equipped_weapons` - Weapons equipped by defender's garrison
/// * `defender_stored_weapons` - Weapons in defender's storage (for armory raid)
/// * `has_operatives` - Whether defender has operatives (affects raid rate)
///
/// # Returns
/// CombatWeaponResult with all weapon distributions
pub fn resolve_weapon_combat(
    attacker_troops: u64,
    attacker_casualties: u64,
    attacker_weapons: WeaponSet,
    attacker_damage_dealt: u64,
    defender_troops: u64,
    defender_casualties: u64,
    defender_equipped_weapons: WeaponSet,
    defender_stored_weapons: WeaponSet,
    has_operatives: bool,
) -> CombatWeaponResult {
    // Handle edge case: no attacker troops
    if attacker_troops == 0 {
        return CombatWeaponResult::default();
    }

    // Determine winner
    let attacker_wiped = attacker_casualties >= attacker_troops;
    let defender_wiped = defender_casualties >= defender_troops || defender_troops == 0;

    // Attacker wins if:
    // 1. Defender is wiped out, OR
    // 2. Attacker not wiped AND took fewer casualties (proportionally)
    let attacker_won = defender_wiped || (!attacker_wiped && !defender_wiped &&
        mul_div(attacker_casualties, 10000, attacker_troops).unwrap_or(10000) <
        mul_div(defender_casualties, 10000, defender_troops.max(1)).unwrap_or(0));

    // Calculate casualty ratios in basis points
    let attacker_casualty_ratio_bps = if attacker_troops > 0 {
        (mul_div(attacker_casualties, 10000, attacker_troops).unwrap_or(0) as u16).min(10000)
    } else {
        10000
    };

    let defender_casualty_ratio_bps = if defender_troops > 0 {
        (mul_div(defender_casualties, 10000, defender_troops).unwrap_or(0) as u16).min(10000)
    } else {
        10000 // All "virtual" troops considered wiped
    };

    // Calculate siege consumption (based on damage dealt, not casualties)
    let siege_consumed = attacker_weapons.siege.min(
        attacker_damage_dealt / DAMAGE_PER_SIEGE_WEAPON.max(1)
    );
    let attacker_siege_after_firing = attacker_weapons.siege.saturating_sub(siege_consumed);

    // Calculate weapon drops from attacker casualties
    // Note: siege drops are from remaining siege after firing
    let attacker_dropped = WeaponSet {
        melee: mul_div(attacker_weapons.melee, attacker_casualty_ratio_bps as u64, 10000).unwrap_or(0),
        ranged: mul_div(attacker_weapons.ranged, attacker_casualty_ratio_bps as u64, 10000).unwrap_or(0),
        siege: mul_div(attacker_siege_after_firing, attacker_casualty_ratio_bps as u64, 10000).unwrap_or(0),
    };

    // Calculate weapon drops from defender casualties
    let defender_dropped = if defender_troops > 0 {
        defender_equipped_weapons.apply_rate_bps(defender_casualty_ratio_bps)
    } else {
        WeaponSet::default() // No troops = no weapon drops
    };

    if attacker_won {
        // ATTACKER WON

        // Attacker loots from defender
        let looted_from_defender = if defender_troops > 0 {
            // Loot from dead garrison troops (60%)
            defender_dropped.apply_rate_bps(WEAPON_LOOT_RATE_BPS)
        } else {
            // Fallback mode: raid armory directly
            let raid_rate = if has_operatives {
                ARMORY_RAID_WITH_OPERATIVES_BPS // 25%
            } else {
                ARMORY_RAID_UNDEFENDED_BPS // 50%
            };
            defender_stored_weapons.apply_rate_bps(raid_rate)
        };

        // Siege capture from storage if defender fully defeated
        let siege_captured = if defender_wiped {
            mul_div(defender_stored_weapons.siege, SIEGE_CAPTURE_RATE_BPS as u64, 10000).unwrap_or(0)
        } else {
            0
        };

        // Attacker's surviving weapons (what they carry home)
        let attacker_surviving = WeaponSet {
            melee: attacker_weapons.melee.saturating_sub(attacker_dropped.melee),
            ranged: attacker_weapons.ranged.saturating_sub(attacker_dropped.ranged),
            siege: attacker_siege_after_firing.saturating_sub(attacker_dropped.siege),
        };

        // Total looted by attacker (including captured siege)
        let attacker_looted = WeaponSet {
            melee: looted_from_defender.melee,
            ranged: looted_from_defender.ranged,
            siege: looted_from_defender.siege.saturating_add(siege_captured),
        };

        CombatWeaponResult {
            attacker_weapons_returned: attacker_surviving,
            attacker_weapons_looted: attacker_looted,
            defender_weapons_looted: WeaponSet::default(), // Lost
            attacker_won: true,
        }
    } else {
        // DEFENDER WON (Attacker repelled)

        // Defender loots from dead attackers (60%)
        let looted_from_attacker = attacker_dropped.apply_rate_bps(WEAPON_LOOT_RATE_BPS);

        // Attacker keeps only surviving troops' weapons (if any survivors)
        let attacker_surviving = if attacker_wiped {
            WeaponSet::default() // Total wipeout - nothing survives
        } else {
            WeaponSet {
                melee: attacker_weapons.melee.saturating_sub(attacker_dropped.melee),
                ranged: attacker_weapons.ranged.saturating_sub(attacker_dropped.ranged),
                siege: attacker_siege_after_firing.saturating_sub(attacker_dropped.siege),
            }
        };

        CombatWeaponResult {
            attacker_weapons_returned: attacker_surviving,
            attacker_weapons_looted: WeaponSet::default(), // Lost - no loot for loser
            defender_weapons_looted: looted_from_attacker,
            attacker_won: false,
        }
    }
}

/// Calculate unit abandonment based on happiness (Deterministic System)
/// Returns number of units that will abandon
///
/// # Deterministic Formula
/// No randomness - uses exact config rates based on happiness tier.
///
/// # Arguments
/// * `sum_of_units` - Total units that could abandon
/// * `happiness` - Happiness level (0.0-1.0)
/// * `gameplay_config` - GameEngine gameplay configuration with abandonment rates
pub fn calculate_abandonment(
    sum_of_units: u64,
    happiness: f32,
    gameplay_config: &crate::state::GameplayConfig,
) -> u64 {
    // Get base abandonment rate from config based on happiness level (in basis points)
    let base_rate = if happiness >= 0.75 {
        gameplay_config.abandon_rate_happy
    } else if happiness >= 0.5 {
        gameplay_config.abandon_rate_content
    } else if happiness >= 0.25 {
        gameplay_config.abandon_rate_unhappy
    } else {
        gameplay_config.abandon_rate_miserable
    };

    // Calculate abandonment deterministically (no u128!)
    // Formula: (sum_of_units * base_rate) / 10000
    apply_bp(sum_of_units, base_rate as u64).unwrap_or(0)
}

/// Update happiness for defensive units
/// Based on weapon, produce, and armor availability
///
/// # Armor Effect
/// Armor improves morale - troops feel protected
/// Armor bonus: +10% happiness per armor coverage point (armor/units)
/// Example: 500 armor / 500 units = 1.0 coverage = +10% happiness boost
pub fn update_happiness_defensive(
    sum_of_units: u64,
    weapon: u64,
    produce: u64,
    armor: u64,
) -> f32 {
    if sum_of_units == 0 {
        return 0.0;
    }

    let weapon_coeff = (weapon / sum_of_units) as f32;
    let food_coeff = (produce / sum_of_units) as f32;
    let armor_coeff = (armor / sum_of_units) as f32;

    // Base happiness from weapons and food
    let base_coeff = weapon_coeff * food_coeff;

    // Armor provides a morale boost (+10% per coverage point, up to 50% bonus)
    let armor_bonus = f32::min(0.5, armor_coeff * 0.1);
    let total_coeff = base_coeff * (1.0 + armor_bonus);

    f32::min(1.0, libm::roundf(total_coeff))
}

/// Update happiness for operative units
/// Based on produce availability
pub fn update_happiness_operative(
    sum_of_units: u64,
    produce: u64,
) -> f32 {
    if sum_of_units == 0 {
        return 0.0;
    }

    if produce >= sum_of_units { 1.0 } else { 0.0 }
}

/// Consume produce based on unit count
/// Returns amount of produce consumed
pub fn consume_produce(
    sum_of_units: u64,
    produce: u64,
) -> u64 {
    if produce == 0 {
        return 0;
    }
    (sum_of_units / produce) * produce
}

/// Calculate total damage output (Deterministic System)
///
/// Fully deterministic - no randomness whatsoever!
/// - Drive-by bonus uses √φ (1.272x) from config
/// - Normal attacks use base effectiveness (1.0x) from config
/// - Time-of-day variance applied at processor layer
/// - Crits are skill-based (threshold), not probabilistic
///
/// # Buff Stacking Order (multiplicative after base):
/// 1. Base coefficient (drive-by or normal)
/// 2. + Research buff (additive to base)
/// 3. × Hero attack buff (multiplicative)
/// 4. × Hero weapon efficiency buff (multiplicative)
/// 5. × Equipped weapon bonus (multiplicative)
/// 6. × Critical hit multiplier (if threshold reached)
///
/// # Arguments
/// * `sum_of_units` - Total attacking units
/// * `weapon` - Total weapons available
/// * `drive_by` - Whether this is a drive-by attack (requires 10k+ units for bonus)
/// * `gameplay_config` - GameEngine gameplay configuration
/// * `research_buff_bps` - Research attack/defense buff in basis points (0-65535)
/// * `research_crit_chance_bps` - Research critical hit chance in basis points (threshold-based, not random!)
/// * `research_crit_damage_bps` - Research critical damage multiplier in basis points (applied if crit_chance > threshold)
/// * `hero_attack_bps` - Hero attack power buff in basis points (0-65535)
/// * `hero_weapon_efficiency_bps` - Hero weapon efficiency buff in basis points (0-65535)
/// * `hero_crit_chance_bps` - Hero critical hit chance buff in basis points (0-65535)
/// * `equipped_weapon_bonus_bps` - Equipped weapon item bonus in basis points (0-65535)
pub fn calculate_damage_output(
    sum_of_units: u64,
    weapon: u64,
    drive_by: bool,
    gameplay_config: &crate::state::GameplayConfig,
    research_buff_bps: u16,
    research_crit_chance_bps: u16,
    research_crit_damage_bps: u16,
    hero_attack_bps: u16,
    hero_weapon_efficiency_bps: u16,
    hero_crit_chance_bps: u16,
    equipped_weapon_bonus_bps: u16,
) -> u64 {
    if sum_of_units == 0 {
        return 0;
    }

    // Weapon coverage: 10000 (100%) if fully armed, proportional if not (in basis points)
    let weapon_coeff = if weapon >= sum_of_units {
        10000u32
    } else {
        // No u128 needed - mul_div handles overflow protection
        mul_div(weapon, 10000, sum_of_units).unwrap_or(0) as u32
    };

    // Combat effectiveness coefficient (DETERMINISTIC - no min/max randomness!)
    let mut coeff: u32 = if drive_by && sum_of_units >= 10000 {
        // Drive-by attack bonus: √φ = 1.272x from config
        // Night drive-bys get additional φ bonus via time multiplier at processor layer
        gameplay_config.drive_by_bonus_base
    } else {
        // Normal attack: full effectiveness from config (1.0x = 10000 bp)
        // Time-of-day provides variance (night attacks stronger via φ multiplier)
        gameplay_config.attack_base_effectiveness
    };

    // Apply research buff (additive to base coefficient)
    coeff = coeff.saturating_add(research_buff_bps as u32);

    // Apply hero attack buff (multiplicative, no u128!)
    // Formula: coeff × (10000 + hero_attack_bps) / 10000
    if hero_attack_bps > 0 {
        coeff = apply_bp_bonus(coeff as u64, hero_attack_bps).unwrap_or(coeff as u64) as u32;
    }

    // Apply hero weapon efficiency buff (multiplicative - improves weapon damage)
    // Formula: coeff × (10000 + hero_weapon_efficiency_bps) / 10000
    if hero_weapon_efficiency_bps > 0 {
        coeff = apply_bp_bonus(coeff as u64, hero_weapon_efficiency_bps).unwrap_or(coeff as u64) as u32;
    }

    // Apply equipped weapon bonus (multiplicative)
    // Formula: coeff × (10000 + equipped_weapon_bonus_bps) / 10000
    if equipped_weapon_bonus_bps > 0 {
        coeff = apply_bp_bonus(coeff as u64, equipped_weapon_bonus_bps).unwrap_or(coeff as u64) as u32;
    }

    // Deterministic critical hit: if combined crit_chance >= 5000 bp (50%), always crit
    // This is SKILL-BASED (research + hero investment), not probabilistic!
    // Research crit + hero crit are additive
    let total_crit_chance = (research_crit_chance_bps as u32).saturating_add(hero_crit_chance_bps as u32);
    if total_crit_chance >= 5000 {
        // Critical hit! Apply critical damage multiplier (no u128!)
        coeff = apply_bp_bonus(coeff as u64, research_crit_damage_bps).unwrap_or(coeff as u64) as u32;
    }

    // Calculate damage using interleaved multiply/divide (no u128!)
    // Formula: units × weapon_coeff / 10000 × coeff / 10000
    chain_bp(sum_of_units, &[weapon_coeff as u64, coeff as u64]).unwrap_or(0)
}

/// Inflict damage on units with armor damage reduction.
/// Returns (remaining_unit_1, remaining_unit_2, remaining_unit_3).
///
/// # Per-tier HP (overworld combat)
/// Each defensive unit absorbs `DEFENSIVE_UNIT_HEALTH[tier]` HP of damage before
/// dying (tier 1 = 2, tier 2 = 5, tier 3 = 12). Prior to this change every unit
/// died at 1 HP, which made a 14k-damage starter attack one-shot all tier 2 and
/// tier 3 units of another starter in a single swing — the user's "instant kill"
/// complaint. The dungeon system already uses the same per-tier HP model.
///
/// # Overkill redistribution
/// When a tier's allocated damage exceeds the HP of its surviving units, the
/// surplus ("overkill") used to be wasted. It now redistributes once, weighted
/// by `damage_unit_N_percent` across the tiers that still have survivors,
/// keeping power-gap fights destructive without throwing away damage.
///
/// # Armor mechanics
/// - Armor coverage = armor_pieces × 10000 / total_defensive_units (basis points).
/// - Hero armor efficiency and equipped armor multiply coverage.
/// - `reduction_bp = coverage_bp × armor_damage_reduction_bps / 10000`, capped at
///   `armor_damage_reduction_cap_bps`. With the post-fix `2000` rate, 50%
///   coverage yields 10% reduction (was 2.5%) and the 50% cap is reachable.
///
/// # Arguments
/// * `unit_1`, `unit_2`, `unit_3` — Current tier populations.
/// * `armor_pieces` — Total armor protecting the defender.
/// * `total_damage` — Damage to distribute (post buffs, pre armor).
/// * `gameplay_config` — Live config (distribution %, armor rates, caps).
/// * `hero_armor_efficiency_bps`, `equipped_armor_bonus_bps` — Multiplicative
///   buffs to armor coverage.
pub fn inflict_damage(
    unit_1: u64,
    unit_2: u64,
    unit_3: u64,
    armor_pieces: u64,
    total_damage: f64,
    gameplay_config: &crate::state::GameplayConfig,
    hero_armor_efficiency_bps: u16,
    equipped_armor_bonus_bps: u16,
) -> (u64, u64, u64) {
    let total_units = unit_1.saturating_add(unit_2).saturating_add(unit_3);
    if total_units == 0 || total_damage <= 0.0 {
        return (unit_1, unit_2, unit_3);
    }

    // Armor reduction.
    let effective_damage = if armor_pieces > 0 {
        let mut armor_coverage_bp = mul_div(armor_pieces, 10000, total_units).unwrap_or(0) as u32;
        if hero_armor_efficiency_bps > 0 {
            armor_coverage_bp = apply_bp_bonus(armor_coverage_bp as u64, hero_armor_efficiency_bps)
                .unwrap_or(armor_coverage_bp as u64) as u32;
        }
        if equipped_armor_bonus_bps > 0 {
            armor_coverage_bp = apply_bp_bonus(armor_coverage_bp as u64, equipped_armor_bonus_bps)
                .unwrap_or(armor_coverage_bp as u64) as u32;
        }
        let reduction_bp = apply_bp(armor_coverage_bp as u64, gameplay_config.armor_damage_reduction_bps as u64)
            .unwrap_or(0) as u32;
        let capped_reduction_bp = reduction_bp.min(gameplay_config.armor_damage_reduction_cap_bps);
        total_damage * (10000 - capped_reduction_bp) as f64 / 10000.0
    } else {
        total_damage
    };

    // Damage share per tier (preserves the existing config-driven redistribution
    // for missing tiers — no behaviour change here).
    let pct_1 = gameplay_config.damage_unit_1_percent as f64 / 10000.0;
    let pct_2 = gameplay_config.damage_unit_2_percent as f64 / 10000.0;
    let pct_3 = gameplay_config.damage_unit_3_percent as f64 / 10000.0;

    let redis_u1_to_u2 = gameplay_config.damage_redistrib_unit1_to_unit2 as f64 / 10000.0;
    let redis_u1_to_u3 = gameplay_config.damage_redistrib_unit1_to_unit3 as f64 / 10000.0;
    let redis_u3_to_u1 = gameplay_config.damage_redistrib_unit3_to_unit1 as f64 / 10000.0;
    let redis_u3_to_u2 = gameplay_config.damage_redistrib_unit3_to_unit2 as f64 / 10000.0;

    let mut damage_1 = if unit_1 > 0 { effective_damage * pct_1 } else { 0.0 };
    let mut damage_2 = if unit_2 > 0 { effective_damage * pct_2 } else { 0.0 };
    let mut damage_3 = if unit_3 > 0 { effective_damage * pct_3 } else { 0.0 };

    if unit_1 == 0 {
        damage_2 += effective_damage * pct_1 * redis_u1_to_u2;
        damage_3 += effective_damage * pct_1 * redis_u1_to_u3;
    }
    if unit_1 == 0 && unit_2 == 0 {
        damage_3 += effective_damage;
    }
    if unit_2 == 0 && unit_3 == 0 {
        damage_1 += effective_damage;
    }
    if unit_3 == 0 {
        damage_1 += effective_damage * pct_3 * redis_u3_to_u1;
        damage_2 += effective_damage * pct_3 * redis_u3_to_u2;
    }

    // Convert damage → casualties via per-tier HP. `_raw` is uncapped so we can
    // measure overkill before clipping to live populations.
    let hp_1 = DEFENSIVE_UNIT_HEALTH[0].max(1) as f64;
    let hp_2 = DEFENSIVE_UNIT_HEALTH[1].max(1) as f64;
    let hp_3 = DEFENSIVE_UNIT_HEALTH[2].max(1) as f64;

    let kills_1_raw = (damage_1 / hp_1) as u64;
    let kills_2_raw = (damage_2 / hp_2) as u64;
    let kills_3_raw = (damage_3 / hp_3) as u64;

    let kills_1 = kills_1_raw.min(unit_1);
    let kills_2 = kills_2_raw.min(unit_2);
    let kills_3 = kills_3_raw.min(unit_3);

    // Overkill damage that would have killed already-dead units. Redistribute
    // once across surviving tiers, weighted by the same damage % the config
    // uses for the base allocation.
    let overkill_dmg = ((kills_1_raw - kills_1) as f64) * hp_1
        + ((kills_2_raw - kills_2) as f64) * hp_2
        + ((kills_3_raw - kills_3) as f64) * hp_3;

    let mut rem_1 = unit_1 - kills_1;
    let mut rem_2 = unit_2 - kills_2;
    let mut rem_3 = unit_3 - kills_3;

    if overkill_dmg > 0.0 {
        let mut weight_sum = 0.0;
        if rem_1 > 0 { weight_sum += pct_1; }
        if rem_2 > 0 { weight_sum += pct_2; }
        if rem_3 > 0 { weight_sum += pct_3; }

        if weight_sum > 0.0 {
            let extra_1 = if rem_1 > 0 { ((overkill_dmg * pct_1 / weight_sum) / hp_1) as u64 } else { 0 };
            let extra_2 = if rem_2 > 0 { ((overkill_dmg * pct_2 / weight_sum) / hp_2) as u64 } else { 0 };
            let extra_3 = if rem_3 > 0 { ((overkill_dmg * pct_3 / weight_sum) / hp_3) as u64 } else { 0 };

            rem_1 = rem_1.saturating_sub(extra_1);
            rem_2 = rem_2.saturating_sub(extra_2);
            rem_3 = rem_3.saturating_sub(extra_3);
        }
    }

    (rem_1, rem_2, rem_3)
}


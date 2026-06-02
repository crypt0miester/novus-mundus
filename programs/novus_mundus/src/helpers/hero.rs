use crate::logic::calculate_buff_at_level;
use crate::state::{get_buff_stat_name, BuffConfig, BuffStat, HeroTemplate, PlayerAccount};

// // ========================================================// ========================================================// ========================================================// ========================================================// ========================================================// ========================================================
// Formatting Utilities
// // ========================================================// ========================================================// ========================================================// ========================================================// ========================================================// ========================================================

/// Convert u32 to byte slice for NFT attributes
///
/// Returns a slice into the provided buffer containing the ASCII representation.
/// Buffer must be at least 10 bytes (max u32 is 4,294,967,295 = 10 digits).
#[inline]
pub fn format_u32_to_bytes(value: u32, buf: &mut [u8; 10]) -> &[u8] {
    let mut n = value;
    let mut pos = 10;

    if n == 0 {
        buf[9] = b'0';
        return &buf[9..10];
    }

    while n > 0 {
        pos -= 1;
        buf[pos] = b'0' + (n % 10) as u8;
        n /= 10;
    }

    &buf[pos..10]
}

/// Convert i64 to byte slice for NFT attributes (unix timestamps).
/// Buffer must be at least 20 bytes (max i64 = 19 digits + optional sign).
/// Negative values write a leading '-'.
#[inline]
pub fn format_i64_to_bytes(value: i64, buf: &mut [u8; 20]) -> &[u8] {
    if value == 0 {
        buf[19] = b'0';
        return &buf[19..20];
    }

    let negative = value < 0;
    // Use absolute value via wrapping; handles i64::MIN safely.
    let mut n: u64 = if negative {
        value.unsigned_abs()
    } else {
        value as u64
    };
    let mut pos = 20;

    while n > 0 {
        pos -= 1;
        buf[pos] = b'0' + (n % 10) as u8;
        n /= 10;
    }

    if negative {
        pos -= 1;
        buf[pos] = b'-';
    }

    &buf[pos..20]
}

// Location Synergy - Buff Operations with Location Bonus

/// Add one hero's buffs to player's cached totals with location bonus applied
///
/// NFT-Only System: Level comes from parsed NFT attributes.
/// If the hero is "at home", buffs are boosted by 1-10% based on tier.
///
/// # Arguments
/// * `player` - Player account to update
/// * `level` - Hero level (from parsed NFT)
/// * `template` - Hero's template
/// * `location_bonus_bps` - Location bonus in basis points (0 if not at home, 100-1000 if at home)
#[inline]
pub fn add_hero_buffs_to_player_with_location(
    player: &mut PlayerAccount,
    level: u32,
    template: &HeroTemplate,
    location_bonus_bps: u16,
) {
    for buff_config in template.buffs.iter() {
        let stat = BuffStat::from_u8(buff_config.stat);
        if matches!(stat, BuffStat::None) {
            continue;
        }

        // Calculate base buff value deterministically: base × (√φ)^level
        let base_value = calculate_buff_at_level(buff_config.base_bps as u64, level);

        // Apply location bonus: value × (10000 + bonus) / 10000. Buffs cache as
        // u16, so clamp (not truncate) — a high-level hero's base_value can well
        // exceed u16::MAX, and a plain `*` would wrap before the cast.
        let boosted_value = if location_bonus_bps > 0 {
            (base_value.saturating_mul(10000u64.saturating_add(location_bonus_bps as u64)) / 10000)
                .min(u16::MAX as u64) as u16
        } else {
            base_value.min(u16::MAX as u64) as u16
        };

        apply_buff_to_player(player, stat, boosted_value, true);
    }
}

/// Subtract one hero's buffs from player's cached totals with location bonus applied
///
/// NFT-Only System: Level comes from parsed NFT attributes.
/// Must use the same location bonus that was applied during lock.
///
/// # Arguments
/// * `player` - Player account to update
/// * `level` - Hero level (from parsed NFT)
/// * `template` - Hero's template
/// * `location_bonus_bps` - Location bonus that was applied during lock
#[inline]
pub fn subtract_hero_buffs_from_player_with_location(
    player: &mut PlayerAccount,
    level: u32,
    template: &HeroTemplate,
    location_bonus_bps: u16,
) {
    for buff_config in template.buffs.iter() {
        let stat = BuffStat::from_u8(buff_config.stat);
        if matches!(stat, BuffStat::None) {
            continue;
        }

        // Calculate base buff value deterministically: base × (√φ)^level
        let base_value = calculate_buff_at_level(buff_config.base_bps as u64, level);

        // Apply same location bonus that was used during lock. Clamp to u16
        // identically to the add path so lock/unlock stay symmetric and the
        // cached totals can't desync on a wrapped/truncated value.
        let boosted_value = if location_bonus_bps > 0 {
            (base_value.saturating_mul(10000u64.saturating_add(location_bonus_bps as u64)) / 10000)
                .min(u16::MAX as u64) as u16
        } else {
            base_value.min(u16::MAX as u64) as u16
        };

        apply_buff_to_player(player, stat, boosted_value, false);
    }
}

/// Clear all hero buff fields on player (used before recalculation)
#[inline]
pub fn clear_hero_buffs(player: &mut PlayerAccount) {
    let Some(heroes) = player.heroes_mut() else {
        return;
    };
    heroes.hero_attack_bps = 0;
    heroes.hero_defense_bps = 0;
    heroes.hero_economy_bps = 0;
    heroes.hero_xp_gain_bps = 0;
    heroes.hero_training_cost_reduction_bps = 0;
    heroes.hero_rally_capacity_bps = 0;
    heroes.hero_crit_chance_bps = 0;
    heroes.hero_synchrony_bonus_bps = 0;
    heroes.hero_weapon_efficiency_bps = 0;
    heroes.hero_stamina_regen_bps = 0;
    heroes.hero_produce_generation_bps = 0;
    heroes.hero_encounter_damage_bps = 0;
    heroes.hero_loot_bonus_bps = 0;
    heroes.hero_armor_efficiency_bps = 0;
    heroes.hero_resource_capacity_bps = 0;
    heroes.hero_unit_capacity_bps = 0;
    heroes.slot_location_bonus = [0; 3];
}

/// Add buff deltas from level-up to player's cached totals
///
/// Used when leveling up a locked hero. Calculates the deterministic
/// difference between old level and new level buff values.
#[inline]
pub fn add_buff_delta_to_player(
    player: &mut PlayerAccount,
    template: &HeroTemplate,
    old_level: u32,
    new_level: u32,
) {
    for buff_config in template.buffs.iter() {
        let stat = BuffStat::from_u8(buff_config.stat);
        if matches!(stat, BuffStat::None) {
            continue;
        }

        // Calculate delta between levels deterministically
        let old_value = calculate_buff_at_level(buff_config.base_bps as u64, old_level);
        let new_value = calculate_buff_at_level(buff_config.base_bps as u64, new_level);
        let delta = new_value.saturating_sub(old_value);

        if delta == 0 {
            continue;
        }

        // Clamp the narrowing cast: a high-level delta can exceed u16::MAX,
        // and a bare `as u16` would wrap. Mirrors the add/subtract paths above.
        apply_buff_to_player(player, stat, delta.min(u16::MAX as u64) as u16, true);
    }
}

/// Internal: Apply a single buff value to the appropriate player stat
#[inline]
fn apply_buff_to_player(player: &mut PlayerAccount, stat: BuffStat, value: u16, add: bool) {
    let Some(heroes) = player.heroes_mut() else {
        return;
    };
    let target = match stat {
        BuffStat::AttackPower => &mut heroes.hero_attack_bps,
        BuffStat::DefensePower => &mut heroes.hero_defense_bps,
        BuffStat::CashCollectionRate => &mut heroes.hero_economy_bps,
        BuffStat::XpGain => &mut heroes.hero_xp_gain_bps,
        BuffStat::TrainingCostReduction => &mut heroes.hero_training_cost_reduction_bps,
        BuffStat::RallyCapacity => &mut heroes.hero_rally_capacity_bps,
        BuffStat::CriticalHitChance => &mut heroes.hero_crit_chance_bps,
        BuffStat::SynchronyBonus => &mut heroes.hero_synchrony_bonus_bps,
        BuffStat::WeaponEfficiency => &mut heroes.hero_weapon_efficiency_bps,
        BuffStat::StaminaRegen => &mut heroes.hero_stamina_regen_bps,
        BuffStat::ProduceGeneration => &mut heroes.hero_produce_generation_bps,
        BuffStat::EncounterDamage => &mut heroes.hero_encounter_damage_bps,
        BuffStat::LootBonus => &mut heroes.hero_loot_bonus_bps,
        BuffStat::ArmorEfficiency => &mut heroes.hero_armor_efficiency_bps,
        BuffStat::ResourceCapacity => &mut heroes.hero_resource_capacity_bps,
        BuffStat::UnitCapacity => &mut heroes.hero_unit_capacity_bps,
        // Expedition-specific buffs - not cached on player, applied at expedition time
        BuffStat::MiningAffinity | BuffStat::FishingAffinity => return,
        BuffStat::None => return,
    };

    if add {
        *target = target.saturating_add(value);
    } else {
        *target = target.saturating_sub(value);
    }
}

// NFT Attribute Building

/// Captured hero data for NFT attribute updates (Deterministic System)
///
/// Captures all computed values from hero+template in one pass,
/// allowing account borrows to be dropped before attribute building.
/// All buff values are calculated deterministically: base × (√φ)^level
///
/// NFT-Only System: All hero state is stored in NFT attributes.
///
/// # Attributes (9 max, within MPL Core limit of 10)
/// - Level, XP (mutable state)
/// - Template, Serial, Origin (immutable identity)
/// - Up to 4 buff values
///
/// Note: Tier is NOT stored - derived from template.mint_cost_sol when needed.
#[derive(Clone)]
pub struct HeroNftContext {
    // Mutable state (updated during gameplay)
    pub level: u32,
    pub meditation_xp: u32,

    // Immutable identity (set at mint, never changes)
    pub template_id: u16,
    pub serial_number: u32,
    pub origin_city: u16,

    // Buff configuration and values
    pub buff_values: [u64; 4],
    pub buff_configs: [BuffConfig; 4],

    // Last ability cooldown stamp (mirrored to/from PlayerAccount slot
    // on lock/unlock so the unlock+relock exploit is closed).
    pub last_ability_used_at: i64,
}

impl HeroNftContext {
    /// Create for newly minted hero (level 1)
    ///
    /// NFT-Only System: All hero state comes from template at mint time.
    #[inline]
    pub fn new_mint(template: &HeroTemplate, serial_number: u32) -> Self {
        Self {
            // Mutable state - initial values
            level: 1,
            meditation_xp: 0,

            // Immutable identity - from template
            template_id: template.template_id,
            serial_number,
            origin_city: template.meditation_city_id,

            // Buff configuration and values at level 1
            buff_values: compute_buff_values(1, template),
            buff_configs: template.buffs,

            last_ability_used_at: 0,
        }
    }

    /// Create from parsed NFT data for updates
    ///
    /// NFT-Only System: Used when updating an existing hero's NFT.
    /// Reads current state from NFT, applies changes, writes back.
    #[inline]
    pub fn from_parsed(parsed: &super::nft_parser::ParsedHeroNft, template: &HeroTemplate) -> Self {
        Self {
            level: parsed.level,
            meditation_xp: parsed.meditation_xp,

            template_id: parsed.template_id,
            serial_number: parsed.serial_number,
            origin_city: parsed.origin_city,

            buff_values: compute_buff_values(parsed.level, template),
            buff_configs: template.buffs,

            last_ability_used_at: parsed.last_ability_used_at,
        }
    }

    /// Create with updated level (for level-up)
    #[inline]
    pub fn with_new_level(&self, new_level: u32, template: &HeroTemplate) -> Self {
        Self {
            level: new_level,
            meditation_xp: self.meditation_xp,
            template_id: self.template_id,
            serial_number: self.serial_number,
            origin_city: self.origin_city,
            buff_values: compute_buff_values(new_level, template),
            buff_configs: template.buffs,
            last_ability_used_at: self.last_ability_used_at,
        }
    }

    /// Create with updated meditation XP and optionally level
    #[inline]
    pub fn with_meditation_update(
        &self,
        new_xp: u32,
        new_level: Option<u32>,
        template: &HeroTemplate,
    ) -> Self {
        let level = new_level.unwrap_or(self.level);
        Self {
            level,
            meditation_xp: new_xp,
            template_id: self.template_id,
            serial_number: self.serial_number,
            origin_city: self.origin_city,
            buff_values: compute_buff_values(level, template),
            buff_configs: template.buffs,
            last_ability_used_at: self.last_ability_used_at,
        }
    }

    /// Create with updated ability cooldown (for unlock_hero persistence)
    #[inline]
    pub fn with_ability_cooldown(&self, last_used_at: i64) -> Self {
        Self {
            level: self.level,
            meditation_xp: self.meditation_xp,
            template_id: self.template_id,
            serial_number: self.serial_number,
            origin_city: self.origin_city,
            buff_values: self.buff_values,
            buff_configs: self.buff_configs,
            last_ability_used_at: last_used_at,
        }
    }
}

/// Pre-allocated buffers for building NFT attributes
///
/// Create on the stack, pass to `build_hero_nft_attributes`.
/// Buffers must outlive the p-core CPI call.
///
/// NFT-Only System: Buffers for all 10 possible attributes.
/// (Level, XP, Template, Serial, Origin, AbCD, + up to 4 buffs)
pub struct HeroNftBuffers {
    // Mutable state
    pub level: [u8; 10],
    pub xp: [u8; 10],

    // Immutable identity
    pub template: [u8; 10],
    pub serial: [u8; 10],
    pub origin: [u8; 10],

    // Ability cooldown stamp (i64 → up to 20 ASCII bytes including '-')
    pub ab_cd: [u8; 20],

    // Buff values
    pub buff0: [u8; 10],
    pub buff1: [u8; 10],
    pub buff2: [u8; 10],
    pub buff3: [u8; 10],
}

impl HeroNftBuffers {
    #[inline]
    pub const fn new() -> Self {
        Self {
            level: [0u8; 10],
            xp: [0u8; 10],
            template: [0u8; 10],
            serial: [0u8; 10],
            origin: [0u8; 10],
            ab_cd: [0u8; 20],
            buff0: [0u8; 10],
            buff1: [0u8; 10],
            buff2: [0u8; 10],
            buff3: [0u8; 10],
        }
    }
}

/// Build hero NFT attributes for p-core UpdatePluginV1/AddPluginV1
///
/// NFT-Only System: All hero state is stored as NFT attributes.
/// Returns the number of attributes written to the array (max 10).
///
/// # Attributes (10 max — at MPL Core's per-asset cap)
/// - Level, XP (mutable state)
/// - Template, Serial, Origin (immutable identity)
/// - AbCD (ability cooldown unix timestamp; "0" if never used)
/// - Up to 4 buff values (e.g., "Defense": "500")
///
/// # Arguments
/// - `buffers`: Pre-allocated buffers (must outlive CPI call)
/// - `attributes`: Output array to fill (size 10)
/// - `ctx`: Captured hero data from `HeroNftContext`
pub fn build_hero_nft_attributes<'a>(
    buffers: &'a mut HeroNftBuffers,
    attributes: &mut [(&'a [u8], &'a [u8]); 10],
    ctx: &HeroNftContext,
) -> usize {
    let mut idx = 0;

    // Mutable state
    let level_str = format_u32_to_bytes(ctx.level, &mut buffers.level);
    attributes[idx] = (b"Level", level_str);
    idx += 1;

    let xp_str = format_u32_to_bytes(ctx.meditation_xp, &mut buffers.xp);
    attributes[idx] = (b"XP", xp_str);
    idx += 1;

    // Immutable identity
    let template_str = format_u32_to_bytes(ctx.template_id as u32, &mut buffers.template);
    attributes[idx] = (b"Template", template_str);
    idx += 1;

    let serial_str = format_u32_to_bytes(ctx.serial_number, &mut buffers.serial);
    attributes[idx] = (b"Serial", serial_str);
    idx += 1;

    let origin_str = format_u32_to_bytes(ctx.origin_city as u32, &mut buffers.origin);
    attributes[idx] = (b"Origin", origin_str);
    idx += 1;

    // Ability cooldown stamp (always written so parser finds it; "0" if unused)
    let ab_cd_str = format_i64_to_bytes(ctx.last_ability_used_at, &mut buffers.ab_cd);
    attributes[idx] = (b"AbCD", ab_cd_str);
    idx += 1;

    // Buff values - unrolled to satisfy borrow checker
    // Values are capped to u32::MAX for display (high-level heroes may exceed)
    if ctx.buff_configs[0].stat != 0 {
        let name = get_buff_stat_name(ctx.buff_configs[0].stat).as_bytes();
        let value = ctx.buff_values[0].min(u32::MAX as u64) as u32;
        let value_str = format_u32_to_bytes(value, &mut buffers.buff0);
        attributes[idx] = (name, value_str);
        idx += 1;
    }

    if ctx.buff_configs[1].stat != 0 {
        let name = get_buff_stat_name(ctx.buff_configs[1].stat).as_bytes();
        let value = ctx.buff_values[1].min(u32::MAX as u64) as u32;
        let value_str = format_u32_to_bytes(value, &mut buffers.buff1);
        attributes[idx] = (name, value_str);
        idx += 1;
    }

    if ctx.buff_configs[2].stat != 0 {
        let name = get_buff_stat_name(ctx.buff_configs[2].stat).as_bytes();
        let value = ctx.buff_values[2].min(u32::MAX as u64) as u32;
        let value_str = format_u32_to_bytes(value, &mut buffers.buff2);
        attributes[idx] = (name, value_str);
        idx += 1;
    }

    if ctx.buff_configs[3].stat != 0 {
        let name = get_buff_stat_name(ctx.buff_configs[3].stat).as_bytes();
        let value = ctx.buff_values[3].min(u32::MAX as u64) as u32;
        let value_str = format_u32_to_bytes(value, &mut buffers.buff3);
        attributes[idx] = (name, value_str);
        idx += 1;
    }

    idx
}

/// Compute buff values array deterministically from level and template
///
/// Formula for each buff: base_bps × (√φ)^level
#[inline]
pub fn compute_buff_values(level: u32, template: &HeroTemplate) -> [u64; 4] {
    [
        calculate_buff_at_level(template.buffs[0].base_bps as u64, level),
        calculate_buff_at_level(template.buffs[1].base_bps as u64, level),
        calculate_buff_at_level(template.buffs[2].base_bps as u64, level),
        calculate_buff_at_level(template.buffs[3].base_bps as u64, level),
    ]
}

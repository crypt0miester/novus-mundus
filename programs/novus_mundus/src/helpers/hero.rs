use crate::state::{PlayerAccount, HeroAccount, HeroTemplate, BuffConfig, BuffStat, get_buff_stat_name, calculate_weighted_power};
use crate::logic::calculate_buff_at_level;

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

// ========================================================
// Buff Delta Operations (Deterministic System)
// ========================================================

/// Add one hero's buffs to player's cached totals
///
/// Used when locking a hero. Buff values are calculated deterministically
/// from level and template using golden root (√φ) scaling.
#[inline]
pub fn add_hero_buffs_to_player(
    player: &mut PlayerAccount,
    hero: &HeroAccount,
    template: &HeroTemplate,
) {
    for buff_config in template.buffs.iter() {
        let stat = BuffStat::from_u8(buff_config.stat);
        if matches!(stat, BuffStat::None) { continue; }

        // Calculate buff value deterministically: base × (√φ)^level
        let buff_value = calculate_buff_at_level(buff_config.base_bps as u64, hero.level);
        apply_buff_to_player(player, stat, buff_value as u16, true);
    }
}

/// Subtract one hero's buffs from player's cached totals
///
/// Used when unlocking a hero. Buff values are calculated deterministically
/// from level and template using golden root (√φ) scaling.
#[inline]
pub fn subtract_hero_buffs_from_player(
    player: &mut PlayerAccount,
    hero: &HeroAccount,
    template: &HeroTemplate,
) {
    for buff_config in template.buffs.iter() {
        let stat = BuffStat::from_u8(buff_config.stat);
        if matches!(stat, BuffStat::None) { continue; }

        // Calculate buff value deterministically: base × (√φ)^level
        let buff_value = calculate_buff_at_level(buff_config.base_bps as u64, hero.level);
        apply_buff_to_player(player, stat, buff_value as u16, false);
    }
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
        if matches!(stat, BuffStat::None) { continue; }

        // Calculate delta between levels deterministically
        let old_value = calculate_buff_at_level(buff_config.base_bps as u64, old_level);
        let new_value = calculate_buff_at_level(buff_config.base_bps as u64, new_level);
        let delta = new_value.saturating_sub(old_value);

        if delta == 0 { continue; }

        apply_buff_to_player(player, stat, delta as u16, true);
    }
}

/// Internal: Apply a single buff value to the appropriate player stat
#[inline]
fn apply_buff_to_player(player: &mut PlayerAccount, stat: BuffStat, value: u16, add: bool) {
    let target = match stat {
        BuffStat::AttackPower => &mut player.hero_attack_bps,
        BuffStat::DefensePower => &mut player.hero_defense_bps,
        BuffStat::CashCollectionRate => &mut player.hero_economy_bps,
        BuffStat::XpGain => &mut player.hero_xp_gain_bps,
        BuffStat::TrainingCostReduction => &mut player.hero_training_cost_reduction_bps,
        BuffStat::RallyCapacity => &mut player.hero_rally_capacity_bps,
        BuffStat::CriticalHitChance => &mut player.hero_crit_chance_bps,
        BuffStat::LuckBonus => &mut player.hero_luck_bonus_bps,
        BuffStat::WeaponEfficiency => &mut player.hero_weapon_efficiency_bps,
        BuffStat::StaminaRegen => &mut player.hero_stamina_regen_bps,
        BuffStat::ProduceGeneration => &mut player.hero_produce_generation_bps,
        BuffStat::EncounterDamage => &mut player.hero_encounter_damage_bps,
        BuffStat::LootBonus => &mut player.hero_loot_bonus_bps,
        BuffStat::ArmorEfficiency => &mut player.hero_armor_efficiency_bps,
        // ResourceCapacity and UnitCapacity not currently tracked (no caps in system)
        BuffStat::ResourceCapacity | BuffStat::UnitCapacity | BuffStat::None => return,
    };

    if add {
        *target = target.saturating_add(value);
    } else {
        *target = target.saturating_sub(value);
    }
}

// ========================================================
// Level-Up (Deterministic System)
// ========================================================

/// Update hero's cached power after level-up
///
/// In the deterministic system, buff values are calculated on-demand from
/// level + template. This function just updates the cached total_buff_power
/// for NFT metadata display.
///
/// No RNG - buff values are: base × (√φ)^level
#[inline]
pub fn update_hero_power_on_level_up(
    hero: &mut HeroAccount,
    template: &HeroTemplate,
) {
    hero.total_buff_power = calculate_weighted_power(hero, template);
}

// ========================================================
// NFT Attribute Building
// ========================================================

/// Captured hero data for NFT attribute updates (Deterministic System)
///
/// Captures all computed values from hero+template in one pass,
/// allowing account borrows to be dropped before attribute building.
/// All buff values are calculated deterministically: base × (√φ)^level
#[derive(Clone)]
pub struct HeroNftContext {
    pub level: u32,
    pub power: u32,
    pub buff_values: [u64; 4],
    pub buff_configs: [BuffConfig; 4],
    pub is_locked: bool,
}

impl HeroNftContext {
    /// Create from loaded hero and template
    ///
    /// Buff values are calculated deterministically: base × (√φ)^level
    #[inline]
    pub fn new(hero: &HeroAccount, template: &HeroTemplate, is_locked: bool) -> Self {
        Self {
            level: hero.level,
            power: calculate_weighted_power(hero, template),
            buff_values: compute_buff_values(hero.level, template),
            buff_configs: template.buffs,
            is_locked,
        }
    }

    /// Create for newly minted hero (level 1)
    #[inline]
    pub fn new_mint(template: &HeroTemplate, initial_power: u32) -> Self {
        Self {
            level: 1,
            power: initial_power,
            buff_values: compute_buff_values(1, template),
            buff_configs: template.buffs,
            is_locked: false,
        }
    }
}

/// Pre-allocated buffers for building NFT attributes
///
/// Create on the stack, pass to `build_hero_nft_attributes`.
/// Buffers must outlive the p-core CPI call.
pub struct HeroNftBuffers {
    pub level: [u8; 10],
    pub power: [u8; 10],
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
            power: [0u8; 10],
            buff0: [0u8; 10],
            buff1: [0u8; 10],
            buff2: [0u8; 10],
            buff3: [0u8; 10],
        }
    }
}

/// Build hero NFT attributes for p-core UpdatePluginV1/AddPluginV1
///
/// Returns the number of attributes written to the array.
///
/// # Arguments
/// - `buffers`: Pre-allocated buffers (must outlive CPI call)
/// - `attributes`: Output array to fill
/// - `ctx`: Captured hero data from `HeroNftContext::new()`
///
/// # Example
/// ```ignore
/// // Load once, capture context
/// let hero_data = hero_account.try_borrow_data()?;
/// let hero = unsafe { HeroAccount::load(&hero_data) };
/// let template_data = hero_template.try_borrow_data()?;
/// let template = unsafe { HeroTemplate::load(&template_data) };
/// let ctx = HeroNftContext::new(hero, template, is_locked);
/// drop(hero_data);
/// drop(template_data);
///
/// // Build attributes without re-loading
/// let mut buffers = HeroNftBuffers::new();
/// let mut attributes: [(&[u8], &[u8]); 7] = [(b"", b""); 7];
/// let count = build_hero_nft_attributes(&mut buffers, &mut attributes, &ctx);
/// ```
pub fn build_hero_nft_attributes<'a>(
    buffers: &'a mut HeroNftBuffers,
    attributes: &mut [(&'a [u8], &'a [u8]); 7],
    ctx: &HeroNftContext,
) -> usize {
    let mut idx = 0;

    // Level
    let level_str = format_u32_to_bytes(ctx.level, &mut buffers.level);
    attributes[idx] = (b"Level", level_str);
    idx += 1;

    // Power
    let power_str = format_u32_to_bytes(ctx.power, &mut buffers.power);
    attributes[idx] = (b"Power", power_str);
    idx += 1;

    // Individual buffs - unrolled to satisfy borrow checker
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

    // Locked status
    attributes[idx] = (b"Locked", if ctx.is_locked { b"true" } else { b"false" });
    idx += 1;

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

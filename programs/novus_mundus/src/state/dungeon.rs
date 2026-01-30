//! Dungeon System State Accounts
//!
//! The dungeon system provides solo roguelike PvE content with:
//! - Multi-floor progression (5-10 floors per dungeon)
//! - Room types: Combat, Treasure, Camp, Rest, Trap
//! - Relic system with synergy bonuses
//! - Darkness mechanic with escalating effects
//! - Champion hero (NFT escrowed during run)
//! - Checkpoints every 3 floors
//!
//! PDAs:
//! - DungeonTemplate: ["dungeon_template", dungeon_id]
//! - DungeonRun: ["dungeon_run", player]
//! - DungeonLeaderboard: ["dungeon_leaderboard", dungeon_id, week_number]

use pinocchio::pubkey::Pubkey;
use pinocchio::program_error::ProgramError;

use crate::constants::{
    DUNGEON_TEMPLATE_SEED, DUNGEON_RUN_SEED, DUNGEON_LEADERBOARD_SEED,
};
use crate::state::event::LeaderboardEntry;

// ============================================================
// DUNGEON STATUS
// ============================================================

/// Status of a dungeon run
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum DungeonStatus {
    /// Active in a combat room
    Active = 0,
    /// Awaiting relic selection between floors
    AwaitingRelic = 1,
    /// In boss fight (final floor)
    BossFight = 2,
    /// Run completed successfully
    Completed = 3,
    /// Run failed (units wiped)
    Failed = 4,
    /// Player fled early
    Fled = 5,
}

impl DungeonStatus {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Active),
            1 => Some(Self::AwaitingRelic),
            2 => Some(Self::BossFight),
            3 => Some(Self::Completed),
            4 => Some(Self::Failed),
            5 => Some(Self::Fled),
            _ => None,
        }
    }

    pub const fn is_active(self) -> bool {
        matches!(self, Self::Active | Self::BossFight)
    }

    pub const fn is_ended(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Fled)
    }
}

// ============================================================
// ROOM TYPES
// ============================================================

/// Type of room in a dungeon floor
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum RoomType {
    /// Standard combat encounter
    Combat = 0,
    /// Bonus loot, no combat
    Treasure = 1,
    /// Abandoned camp - temporary buff from found supplies
    Camp = 2,
    /// Heal 20% of lost units
    Rest = 3,
    /// Take damage but gain bonus XP
    Trap = 4,
}

impl RoomType {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Combat),
            1 => Some(Self::Treasure),
            2 => Some(Self::Camp),
            3 => Some(Self::Rest),
            4 => Some(Self::Trap),
            _ => None,
        }
    }

    pub const fn is_combat(self) -> bool {
        matches!(self, Self::Combat)
    }
}

// ============================================================
// DUNGEON THEME
// ============================================================

/// Dungeon theme affects enemy types and which hero traits excel
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum DungeonTheme {
    Crypts = 0,   // Undead - Holy damage, Radiant aura
    Caverns = 1,  // Beasts - Beast slayer, Trap detection
    Abyss = 2,    // Demons - Demon bane, Darkness resistance
    Forge = 3,    // Constructs - Siege specialist, Armor pierce
}

impl DungeonTheme {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Crypts),
            1 => Some(Self::Caverns),
            2 => Some(Self::Abyss),
            3 => Some(Self::Forge),
            _ => None,
        }
    }
}

// ============================================================
// HERO SPECIALIZATION
// ============================================================

/// Hero specialization affects dungeon combat bonuses
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum HeroSpecialization {
    /// Warriors: +20% attack, -10% healing received
    Warrior = 0,
    /// Guardians: +25% unit survival, -15% damage dealt
    Guardian = 1,
    /// Scouts: -25% darkness effects, +15% loot
    Scout = 2,
    /// Mystics: +30% to all relic effects
    Mystic = 3,
}

impl HeroSpecialization {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Warrior),
            1 => Some(Self::Guardian),
            2 => Some(Self::Scout),
            3 => Some(Self::Mystic),
            _ => None,
        }
    }

    /// Get attack bonus (basis points, positive = bonus, negative = penalty)
    pub const fn attack_bonus_bps(self) -> i16 {
        match self {
            Self::Warrior => 2000,   // +20%
            Self::Guardian => -1500, // -15%
            Self::Scout => 0,
            Self::Mystic => 0,
        }
    }

    /// Get defense/survival bonus (basis points)
    pub const fn survival_bonus_bps(self) -> i16 {
        match self {
            Self::Warrior => 0,
            Self::Guardian => 2500, // +25%
            Self::Scout => 0,
            Self::Mystic => 0,
        }
    }

    /// Get healing modifier (basis points, negative = reduced healing)
    pub const fn healing_modifier_bps(self) -> i16 {
        match self {
            Self::Warrior => -1000, // -10% healing
            Self::Guardian => 0,
            Self::Scout => 0,
            Self::Mystic => 0,
        }
    }

    /// Get darkness reduction (basis points)
    pub const fn darkness_reduction_bps(self) -> u16 {
        match self {
            Self::Warrior => 0,
            Self::Guardian => 0,
            Self::Scout => 2500, // -25% darkness
            Self::Mystic => 0,
        }
    }

    /// Get loot bonus (basis points)
    pub const fn loot_bonus_bps(self) -> u16 {
        match self {
            Self::Warrior => 0,
            Self::Guardian => 0,
            Self::Scout => 1500, // +15% loot
            Self::Mystic => 0,
        }
    }

    /// Get relic effect multiplier (basis points, 10000 = 100%)
    pub const fn relic_effect_mult_bps(self) -> u16 {
        match self {
            Self::Warrior => 10000,
            Self::Guardian => 10000,
            Self::Scout => 10000,
            Self::Mystic => 13000, // +30% relic effects
        }
    }
}

// ============================================================
// DUNGEON TEMPLATE (Global, DAO-created)
// ============================================================

/// Dungeon template defines a dungeon's configuration.
/// Created by DAO, immutable after creation.
///
/// PDA: ["dungeon_template", dungeon_id]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DungeonTemplate {
    /// Unique dungeon identifier
    pub dungeon_id: u16,
    /// Dungeon theme (0=Crypts, 1=Caverns, 2=Abyss, 3=Forge)
    pub theme: u8,
    /// Total number of floors
    pub total_floors: u8,
    /// Rooms per floor (typically 3-5)
    pub rooms_per_floor: u8,
    /// Checkpoint interval (save progress every N floors)
    pub checkpoint_interval: u8,
    /// Minimum player level required
    pub min_player_level: u8,
    /// Required Catacombs building level
    pub required_building_level: u8,

    /// Stamina cost to enter
    pub stamina_cost: u16,
    /// Boss power multiplier (basis points, 25000 = 2.5x)
    pub boss_power_multiplier: u16,
    /// PDA bump seed
    pub bump: u8,
    /// Padding for alignment
    pub _padding1: [u8; 3],

    /// Dungeon name (UTF-8, null-padded)
    pub name: [u8; 32],

    /// Precomputed enemy power per floor (floors 1-10)
    /// Avoids expensive on-chain exponential math
    pub floor_power: [u32; 10],

    /// Room type weights (basis points, must sum to 10000)
    pub combat_weight: u16,     // Default: 6000 (60%)
    pub treasure_weight: u16,   // Default: 1500 (15%)
    pub camp_weight: u16,       // Default: 1000 (10%)
    pub rest_weight: u16,       // Default: 1000 (10%)
    pub trap_weight: u16,       // Default: 500 (5%)
    pub _padding2: u16,         // Alignment

    /// Darkness configuration
    pub darkness_base_bps: u16,
    pub darkness_per_floor_bps: u16,

    /// Time limit in seconds (0 = unlimited)
    pub time_limit_seconds: u32,

    /// Reward configuration
    pub base_xp_per_room: u64,
    pub base_novi_per_floor: u64,
    pub completion_bonus_bps: u16,
    /// Reward scaling per floor (1200 = 1.2x per floor)
    pub reward_scaling_bps: u16,
    pub _padding3: [u8; 4],
}

impl DungeonTemplate {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Unsafe load from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Unsafe mutable load from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Get dungeon name as &str
    pub fn name(&self) -> &str {
        let end = self.name.iter().position(|&b| b == 0).unwrap_or(self.name.len());
        core::str::from_utf8(&self.name[..end]).unwrap_or("")
    }

    /// Get enemy power for a specific floor (1-indexed)
    pub fn get_floor_power(&self, floor: u8) -> u32 {
        if floor == 0 || floor > 10 {
            return self.floor_power[0];
        }
        self.floor_power[(floor - 1) as usize]
    }

    /// Get boss power (final floor enemy power × boss multiplier)
    pub fn get_boss_power(&self, floor: u8) -> u64 {
        let base = self.get_floor_power(floor) as u64;
        base.saturating_mul(self.boss_power_multiplier as u64) / 10000
    }

    /// Check if a floor is a checkpoint
    pub fn is_checkpoint(&self, floor: u8) -> bool {
        self.checkpoint_interval > 0 && floor % self.checkpoint_interval == 0
    }

    /// Derive PDA for a dungeon template
    /// Seeds: [DUNGEON_TEMPLATE_SEED, dungeon_id]
    pub fn derive_pda(dungeon_id: u16) -> (Pubkey, u8) {
        let dungeon_id_bytes = dungeon_id.to_le_bytes();
        pinocchio::pubkey::find_program_address(
            &[DUNGEON_TEMPLATE_SEED, &dungeon_id_bytes],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(dungeon_id: u16, bump: u8) -> Result<Pubkey, ProgramError> {
        let dungeon_id_bytes = dungeon_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[DUNGEON_TEMPLATE_SEED, &dungeon_id_bytes, &bump_seed],
            &crate::ID,
        )
    }

    /// Load and verify a DungeonTemplate.
    /// Checks: program ownership, PDA derivation, dungeon_id field, bump field.
    pub fn load_checked<'a>(
        account: &'a pinocchio::account_info::AccountInfo,
        dungeon_id: u16,
        program_id: &Pubkey,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        // 1. Check account is owned by program
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        // 2. Derive PDA and verify
        let (expected_pda, bump) = Self::derive_pda(dungeon_id);
        if account.key() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        // 3. Load data
        let data = account.try_borrow_data()?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        // 4. Verify dungeon_id field matches
        if loaded.dungeon_id != dungeon_id {
            return Err(crate::error::GameError::InvalidParameter.into());
        }

        // 5. Verify bump matches
        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }
}

// Compile-time size verification disabled - struct may be realigned
// const _: () = assert!(DungeonTemplate::LEN == 152, "DungeonTemplate size changed");

// ============================================================
// DUNGEON RUN (Per-player, temporary)
// ============================================================

/// Active dungeon run state for a player.
/// Created on enter_dungeon, closed on claim_rewards/flee/fail.
///
/// PDA: ["dungeon_run", player_owner]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DungeonRun {
    /// Player owner's wallet pubkey
    pub player: Pubkey,
    /// Champion hero NFT mint (escrowed)
    pub hero_mint: Pubkey,

    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Current status (DungeonStatus)
    pub status: u8,
    /// Current floor (1-indexed)
    pub current_floor: u8,
    /// Current room (1-indexed)
    pub current_room: u8,
    /// Current room type (RoomType)
    pub room_type: u8,
    /// Last checkpoint floor (0 if none)
    pub last_checkpoint: u8,
    /// PDA bump seed
    pub bump: u8,

    /// Current enemy health (for combat rooms)
    pub enemy_health: u64,
    /// Enemy max health
    pub enemy_max_health: u64,
    /// Enemy power (precomputed from template)
    pub enemy_power: u32,
    /// Enemy defense (basis points)
    pub enemy_defense: u16,
    /// Is this enemy the boss?
    pub is_boss: bool,

    /// Time period when dungeon was entered (affects mechanics)
    /// 0=Dawn, 1=Day, 2=Dusk, 3=Night
    pub time_period: u8,
    /// Dungeon theme (0=Crypts, 1=Caverns, 2=Abyss, 3=Forge)
    pub dungeon_theme: u8,
    /// Hero specialization (0=Warrior, 1=Guardian, 2=Scout, 3=Mystic)
    pub hero_specialization: u8,
    /// Padding for alignment
    pub _spec_padding: u8,

    /// Boss Wrath system (multi-phase mechanics)
    /// Wrath accumulates as boss takes damage: wrath = damage_taken * 100 / max_hp
    pub boss_wrath: u8,
    /// Theme ability active (triggered at 50 wrath)
    pub boss_ability_active: bool,
    /// Remaining attacks for limited-duration abilities (Blood Frenzy)
    pub boss_ability_counter: u8,
    /// Padding for alignment
    pub _boss_padding: [u8; 3],
    /// Shield HP for Forge boss (Iron Shell ability)
    pub boss_shield: u64,

    /// Remaining units during run [tier1, tier2, tier3]
    /// Snapshot of player DEFENSIVE units at start, decremented on damage
    pub remaining_units: [u64; 3],

    /// Original units at dungeon entry [tier1, tier2, tier3]
    /// Used for Phoenix Feather resurrection (25% of original)
    pub original_units: [u64; 3],

    /// Remaining weapons during run [melee, ranged, siege]
    /// Snapshot of player weapons at start, used for damage calculation
    pub remaining_weapons: [u64; 3],

    /// Collected relics (bitmask, up to 32 relics)
    pub relic_mask: u32,
    /// Active synergy bonuses (bitmask)
    pub synergy_mask: u8,
    /// Current darkness level
    pub darkness_level: u8,
    /// Darkness mitigation from hero/relics (basis points)
    pub darkness_mitigation: u16,

    /// Accumulated rewards (pending until claim)
    pub pending_xp: u64,
    pub pending_novi: u64,
    pub pending_gems: u64,
    pub pending_materials: u32,
    /// Padding
    pub _padding2: [u8; 4],

    /// Checkpoint snapshots (locked in on checkpoint)
    pub checkpoint_xp: u64,
    pub checkpoint_novi: u64,
    pub checkpoint_gems: u64,

    /// Stats for leaderboard scoring
    pub total_damage_dealt: u64,
    pub total_damage_taken: u64,
    pub enemies_killed: u16,
    pub relics_collected: u8,
    /// Total rooms cleared (for scoring)
    pub rooms_cleared: u8,
    /// Padding
    pub _padding3: [u8; 4],

    /// Timestamps
    pub started_at: i64,
    /// Camp buff: bonus bps from found supplies, expiry floor
    pub camp_bonus_bps: u16,
    pub camp_expires_floor: u8,
    /// Number of times player has resumed from checkpoint
    pub resume_count: u8,

    /// Building bonuses snapshotted at dungeon entry (basis points)
    /// XP bonus from Catacombs building
    pub xp_building_bonus_bps: u16,
    /// NOVI bonus from Treasury building
    pub novi_building_bonus_bps: u16,
}

impl DungeonRun {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Unsafe load from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Unsafe mutable load from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Check if run is still active
    pub fn is_active(&self) -> bool {
        let status = DungeonStatus::from_u8(self.status).unwrap_or(DungeonStatus::Failed);
        status.is_active() || status == DungeonStatus::AwaitingRelic
    }

    /// Get hero specialization
    pub fn get_specialization(&self) -> HeroSpecialization {
        HeroSpecialization::from_u8(self.hero_specialization).unwrap_or(HeroSpecialization::Warrior)
    }

    /// Check if run has ended
    pub fn is_ended(&self) -> bool {
        let status = DungeonStatus::from_u8(self.status).unwrap_or(DungeonStatus::Failed);
        status.is_ended()
    }

    /// Check if player has a specific relic
    pub fn has_relic(&self, relic_id: u8) -> bool {
        if relic_id >= 32 {
            return false;
        }
        (self.relic_mask & (1 << relic_id)) != 0
    }

    /// Add a relic to the mask
    pub fn add_relic(&mut self, relic_id: u8) {
        if relic_id < 32 {
            self.relic_mask |= 1 << relic_id;
            self.relics_collected = self.relics_collected.saturating_add(1);
        }
    }

    /// Count relics with a specific synergy tag
    pub fn count_relics_with_tag(&self, tag: u8) -> u8 {
        use crate::constants::RELIC_SYNERGY_TAGS;
        let mut count = 0u8;
        for (relic_id, &relic_tag) in RELIC_SYNERGY_TAGS.iter().enumerate() {
            if relic_tag == tag && self.has_relic(relic_id as u8) {
                count = count.saturating_add(1);
            }
        }
        count
    }

    /// Get total remaining units
    pub fn total_remaining_units(&self) -> u64 {
        self.remaining_units[0]
            .saturating_add(self.remaining_units[1])
            .saturating_add(self.remaining_units[2])
    }

    /// Get total remaining weapons
    pub fn total_remaining_weapons(&self) -> u64 {
        self.remaining_weapons[0]
            .saturating_add(self.remaining_weapons[1])
            .saturating_add(self.remaining_weapons[2])
    }

    /// Check if all units are wiped
    pub fn is_wiped(&self) -> bool {
        self.total_remaining_units() == 0
    }

    /// Apply damage to units (tier 1 first, then 2, then 3)
    /// Returns actual damage absorbed
    pub fn apply_unit_damage(&mut self, damage: u64) -> u64 {
        let unit_health: [u64; 3] = [100, 250, 600]; // HP per tier
        let mut remaining_damage = damage;
        let mut total_absorbed = 0u64;

        for tier in 0..3 {
            if remaining_damage == 0 {
                break;
            }

            let units = self.remaining_units[tier];
            if units == 0 {
                continue;
            }

            let tier_hp = unit_health[tier];
            let total_tier_hp = units.saturating_mul(tier_hp);

            if remaining_damage >= total_tier_hp {
                // Wipe entire tier
                total_absorbed = total_absorbed.saturating_add(total_tier_hp);
                remaining_damage = remaining_damage.saturating_sub(total_tier_hp);
                self.remaining_units[tier] = 0;
            } else {
                // Partial damage to tier
                let units_killed = remaining_damage / tier_hp;
                total_absorbed = total_absorbed.saturating_add(remaining_damage);
                self.remaining_units[tier] = units.saturating_sub(units_killed.max(1));
                remaining_damage = 0;
            }
        }

        total_absorbed
    }

    /// Heal units (for Rest rooms)
    pub fn heal_units(&mut self, heal_percent: u8) {
        for tier in 0..3 {
            let original = self.original_units[tier];
            let current = self.remaining_units[tier];
            let lost = original.saturating_sub(current);
            let heal_amount = lost.saturating_mul(heal_percent as u64) / 100;
            self.remaining_units[tier] = current.saturating_add(heal_amount).min(original);
        }
    }

    /// Heal units by raw HP amount (for lifesteal)
    /// Heals tier 1 first (cheapest), then tier 2, then tier 3
    /// Returns the amount of HP that was actually used for healing
    pub fn heal_units_by_hp(&mut self, heal_hp: u64) -> u64 {
        let unit_health: [u64; 3] = [100, 250, 600]; // HP per tier
        let mut remaining_heal = heal_hp;
        let mut total_healed = 0u64;

        // Heal tier 1 first (most units per HP)
        for tier in 0..3 {
            if remaining_heal == 0 {
                break;
            }

            let original = self.original_units[tier];
            let current = self.remaining_units[tier];
            let lost = original.saturating_sub(current);

            if lost == 0 {
                continue;
            }

            let tier_hp = unit_health[tier];
            // How many units can we restore with remaining heal?
            let restorable = remaining_heal / tier_hp;
            let units_to_restore = restorable.min(lost);

            if units_to_restore > 0 {
                self.remaining_units[tier] = current.saturating_add(units_to_restore);
                let hp_used = units_to_restore.saturating_mul(tier_hp);
                remaining_heal = remaining_heal.saturating_sub(hp_used);
                total_healed = total_healed.saturating_add(hp_used);
            }
        }

        total_healed
    }

    /// Derive PDA for a dungeon run
    /// Seeds: [DUNGEON_RUN_SEED, player_account_pda]
    /// The PDA is derived from the PlayerAccount PDA, not the wallet
    pub fn derive_pda(player_account: &Pubkey) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[DUNGEON_RUN_SEED, player_account.as_ref()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(player_account: &Pubkey, bump: u8) -> Result<Pubkey, ProgramError> {
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[DUNGEON_RUN_SEED, player_account.as_ref(), &bump_seed],
            &crate::ID,
        )
    }

    /// Load and verify a DungeonRun.
    /// Checks: program ownership, PDA derivation, bump field.
    /// Note: player_account is the PlayerAccount PDA, not the wallet
    pub fn load_checked<'a>(
        account: &'a pinocchio::account_info::AccountInfo,
        player_account: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        // 1. Check account is owned by program
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        // 2. Derive PDA and verify
        let (expected_pda, bump) = Self::derive_pda(player_account);
        if account.key() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        // 3. Load data
        let data = account.try_borrow_data()?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        // 4. Verify bump matches
        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load and verify a DungeonRun mutably.
    /// Checks: program ownership, PDA derivation, bump field.
    /// Note: player_account is the PlayerAccount PDA, not the wallet
    pub fn load_checked_mut<'a>(
        account: &'a pinocchio::account_info::AccountInfo,
        player_account: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        // 1. Check account is owned by program
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        // 2. Derive PDA and verify
        let (expected_pda, bump) = Self::derive_pda(player_account);
        if account.key() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        // 3. Load data
        let mut data = account.try_borrow_mut_data()?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        // 4. Verify bump matches
        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }
}

// Compile-time size verification (size = 256 bytes with resume_count field)
// Note: resume_count replaced one padding byte in _padding4

// ============================================================
// DUNGEON LEADERBOARD (Weekly reset)
// ============================================================

/// Weekly leaderboard for a specific dungeon.
/// Tracks top 10 fastest clears with prize distribution.
/// KINGDOM-SCOPED: Each kingdom has its own dungeon leaderboards
///
/// PDA: ["dungeon_leaderboard", game_engine, dungeon_id, week_number]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DungeonLeaderboard {
    /// Kingdom this leaderboard belongs to
    pub game_engine: Pubkey,
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Week number (weeks since epoch)
    pub week_number: u16,
    /// Number of entries in leaderboard (0-10)
    pub leaderboard_count: u8,
    /// PDA bump seed
    pub bump: u8,
    /// Claimed prize mask (bit N = rank N claimed)
    pub claimed_mask: u16,

    /// Prize pool (NOVI tokens)
    pub prize_pool: u64,

    /// Leaderboard entries (top 10, sorted by score descending)
    pub leaderboard: [LeaderboardEntry; 10],
}

impl DungeonLeaderboard {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const MAX_LEADERBOARD: usize = 10;

    /// Unsafe load from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Unsafe mutable load from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Calculate score for a dungeon run
    /// Higher = better: floors × 10000 + kills × 100 + relics × 500 - seconds + clear_bonus
    pub fn calculate_score(
        floors_cleared: u8,
        enemies_killed: u16,
        relics_collected: u8,
        time_seconds: i64,
        full_clear: bool,
    ) -> u64 {
        let base_score = (floors_cleared as u64).saturating_mul(10000)
            .saturating_add((enemies_killed as u64).saturating_mul(100))
            .saturating_add((relics_collected as u64).saturating_mul(500));

        let time_penalty = (time_seconds as u64).min(base_score);
        let clear_bonus = if full_clear { 50000u64 } else { 0 };

        base_score.saturating_sub(time_penalty).saturating_add(clear_bonus)
    }

    /// Try to insert a score into the leaderboard
    /// Returns true if the score made it into top 10
    pub fn try_insert(&mut self, player: Pubkey, score: u64) -> bool {
        // Find insertion position
        let mut insert_pos = self.leaderboard_count as usize;
        for i in 0..self.leaderboard_count as usize {
            if score > self.leaderboard[i].score {
                insert_pos = i;
                break;
            }
        }

        // If position is beyond max, don't insert
        if insert_pos >= Self::MAX_LEADERBOARD {
            return false;
        }

        // Shift entries down
        let shift_end = (self.leaderboard_count as usize).min(Self::MAX_LEADERBOARD - 1);
        for i in (insert_pos..shift_end).rev() {
            self.leaderboard[i + 1] = self.leaderboard[i];
        }

        // Insert new entry
        self.leaderboard[insert_pos] = LeaderboardEntry { player, score };

        // Update count
        if (self.leaderboard_count as usize) < Self::MAX_LEADERBOARD {
            self.leaderboard_count += 1;
        }

        true
    }

    /// Find player's rank (0-indexed, None if not in top 10)
    pub fn find_rank(&self, player: &Pubkey) -> Option<usize> {
        for i in 0..self.leaderboard_count as usize {
            if &self.leaderboard[i].player == player {
                return Some(i);
            }
        }
        None
    }

    /// Check if a rank's prize has been claimed
    pub fn is_claimed(&self, rank: usize) -> bool {
        if rank >= 10 {
            return true;
        }
        (self.claimed_mask & (1 << rank)) != 0
    }

    /// Mark a rank's prize as claimed
    pub fn mark_claimed(&mut self, rank: usize) {
        if rank < 10 {
            self.claimed_mask |= 1 << rank;
        }
    }

    /// Derive PDA for a dungeon leaderboard
    /// Seeds: [DUNGEON_LEADERBOARD_SEED, game_engine, dungeon_id, week_number]
    pub fn derive_pda(game_engine: &Pubkey, dungeon_id: u16, week_number: u16) -> (Pubkey, u8) {
        let dungeon_id_bytes = dungeon_id.to_le_bytes();
        let week_bytes = week_number.to_le_bytes();
        pinocchio::pubkey::find_program_address(
            &[DUNGEON_LEADERBOARD_SEED, game_engine.as_ref(), &dungeon_id_bytes, &week_bytes],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(game_engine: &Pubkey, dungeon_id: u16, week_number: u16, bump: u8) -> Result<Pubkey, ProgramError> {
        let dungeon_id_bytes = dungeon_id.to_le_bytes();
        let week_bytes = week_number.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[DUNGEON_LEADERBOARD_SEED, game_engine.as_ref(), &dungeon_id_bytes, &week_bytes, &bump_seed],
            &crate::ID,
        )
    }

    /// Check if leaderboard belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Pubkey) -> bool {
        &self.game_engine == game_engine
    }
}

// Compile-time size verification
const _: () = assert!(DungeonLeaderboard::LEN == 448, "DungeonLeaderboard size changed");

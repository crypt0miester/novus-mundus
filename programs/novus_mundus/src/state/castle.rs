//! King's Castle System State Accounts
//!
//! The castle system provides persistent territorial control where players compete to
//! claim, defend, and upgrade strategic locations. Castles generate passive rewards
//! for the ruling team and provide combat bonuses to garrisoned players.
//!
//! PDAs:
//! - CastleAccount: ["castle", city_id, castle_id]
//! - KingRegistryAccount: ["king_registry", king_pubkey]
//! - CourtPositionAccount: ["court", castle_pubkey, position_type]
//! - GarrisonContributionAccount: ["garrison", castle_pubkey, contributor_pubkey]
//! - TeamCastleRewardAccount: ["team_castle_reward", castle_pubkey, member_pubkey]

use pinocchio::error::ProgramError;
use pinocchio::Address;

use super::player::NULL_PUBKEY;
use crate::constants::{
    CASTLE_SEED, CASTLE_STATUS_CONTEST, CASTLE_STATUS_PROTECTED, CASTLE_STATUS_TRANSITIONING,
    CASTLE_STATUS_VULNERABLE, COURT_SEED, GARRISON_SEED, KING_REGISTRY_SEED,
    TEAM_CASTLE_REWARD_SEED,
};

// CASTLE TIER ENUM

/// Castle tier affects reward multiplier and available features
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CastleTier {
    /// Small strategic point - 0.25x rewards, no court, no garrison
    Outpost = 0,
    /// Minor fortification - 0.5x rewards, 1 court position
    Keep = 1,
    /// Standard castle - 1.0x rewards, 1-3 court positions
    Stronghold = 2,
    /// Major military installation - 1.5x rewards, 1-3 court positions
    Fortress = 3,
    /// Legendary stronghold - 2.0x rewards, 1-3 court positions
    Citadel = 4,
}

impl CastleTier {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Outpost),
            1 => Some(Self::Keep),
            2 => Some(Self::Stronghold),
            3 => Some(Self::Fortress),
            4 => Some(Self::Citadel),
            _ => None,
        }
    }

    /// Get the reward multiplier in basis points
    pub const fn multiplier_bps(self) -> u16 {
        match self {
            Self::Outpost => 2500,     // 0.25x
            Self::Keep => 5000,        // 0.5x
            Self::Stronghold => 10000, // 1.0x
            Self::Fortress => 15000,   // 1.5x
            Self::Citadel => 20000,    // 2.0x
        }
    }

    /// Check if this tier can have a king (individual ownership)
    /// Only Citadel has king system with transitions, protection, etc.
    pub const fn has_king(self) -> bool {
        matches!(self, Self::Citadel)
    }

    /// Check if this tier has court positions
    /// Only Citadel has court advisors
    pub const fn has_court(self) -> bool {
        matches!(self, Self::Citadel)
    }

    /// Check if this tier has garrison
    /// Citadel, Fortress, and Stronghold have garrison for defense
    pub const fn has_garrison(self) -> bool {
        matches!(self, Self::Citadel | Self::Fortress | Self::Stronghold)
    }

    /// Check if this tier is team-controlled (no individual king)
    /// Outpost, Keep, Stronghold, Fortress are team objectives
    pub const fn is_team_controlled(self) -> bool {
        !matches!(self, Self::Citadel)
    }
}

// CASTLE STATUS ENUM

/// Castle ownership status
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CastleStatus {
    /// No king, can be claimed
    Vacant = 0,
    /// In 2-hour contest period, can be attacked
    Contest = 1,
    /// In protection period, cannot be attacked
    Protected = 2,
    /// Protection expired, can be attacked
    Vulnerable = 3,
    /// Ownership change in progress (multi-phase cleanup)
    Transitioning = 4,
}

impl CastleStatus {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Vacant),
            1 => Some(Self::Contest),
            2 => Some(Self::Protected),
            3 => Some(Self::Vulnerable),
            4 => Some(Self::Transitioning),
            _ => None,
        }
    }

    pub const fn is_attackable(self) -> bool {
        matches!(self, Self::Contest | Self::Vulnerable)
    }
}

// COURT POSITION ENUM

/// Court position types with their associated buffs
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CourtPosition {
    /// +15% attack, +40 melee weapons/day
    Advisor = 0,
    /// +20% research speed, +10,000 XP/day
    Scholar = 1,
    /// +15% defense, +50 units/day
    Guardian = 2,
    /// +10% economy output, +25 gems/day
    Treasurer = 3,
    /// +10% rally capacity, +5 rally slots
    Marshal = 4,
}

impl CourtPosition {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Advisor),
            1 => Some(Self::Scholar),
            2 => Some(Self::Guardian),
            3 => Some(Self::Treasurer),
            4 => Some(Self::Marshal),
            _ => None,
        }
    }

    /// Get attack buff in basis points
    pub const fn attack_bps(self) -> u16 {
        match self {
            Self::Advisor => 1500, // +15%
            _ => 0,
        }
    }

    /// Get research speed buff in basis points
    pub const fn research_speed_bps(self) -> u16 {
        match self {
            Self::Scholar => 2000, // +20%
            _ => 0,
        }
    }

    /// Get defense buff in basis points
    pub const fn defense_bps(self) -> u16 {
        match self {
            Self::Guardian => 1500, // +15%
            _ => 0,
        }
    }

    /// Get economy buff in basis points
    pub const fn economy_bps(self) -> u16 {
        match self {
            Self::Treasurer => 1000, // +10%
            _ => 0,
        }
    }
}

// CASTLE ACCOUNT

/// CastleAccount - Primary account storing castle state and configuration
/// KINGDOM-SCOPED: Castles exist within a kingdom (via game_engine)
///
/// PDA Seeds: [CASTLE_SEED, game_engine, city_id (u16 LE), castle_id (u16 LE)]
/// Size: ~600 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CastleAccount {
    /// Account discriminator (AccountKey::Castle)
    pub account_key: u8,
    // Kingdom Reference (32 bytes)
    pub game_engine: Address,

    // Identity (8 bytes)
    pub castle_id: u16,
    pub city_id: u16,
    pub tier: u8,
    pub status: u8,
    pub bump: u8,
    pub _padding1: u8,

    // Name (36 bytes)
    pub name: [u8; 32],
    pub name_len: u8,
    pub _padding2: [u8; 3],

    // Location (16 bytes)
    pub latitude: i32,  // Fixed-point (×1,000,000)
    pub longitude: i32, // Fixed-point (×1,000,000)
    pub _padding_loc: [u8; 8],

    // Ruler Info (80 bytes)
    pub king: Address,
    pub team: Address,
    pub claimed_at: i64,
    pub contest_end_at: i64,

    // Garrison Tracking (4 bytes)
    pub garrison_count: u8,
    pub max_garrison: u8,
    pub _padding3: [u8; 2],

    // Court Tracking (4 bytes)
    pub court_count: u8,
    pub max_court: u8,
    pub court_appointment_cooldown: u16,

    // Upgrade Levels (8 bytes) - persist across ownership changes
    pub fortification_level: u8,
    pub treasury_level: u8,
    pub chambers_level: u8,
    pub watchtower_level: u8,
    pub armory_level: u8,
    pub _padding4: [u8; 3],

    // Upgrade In Progress (16 bytes)
    pub upgrade_type: u8,
    pub upgrade_target_level: u8,
    pub _padding5: [u8; 6],
    pub upgrade_end_at: i64,

    // DAO Configuration - Eligibility (16 bytes)
    pub min_level: u8,
    pub min_networth_millions: u8,
    pub min_troops_thousands: u8,
    pub _padding6: [u8; 5],
    pub protection_duration: i64,

    // DAO Configuration - Reward Rates (48 bytes)
    pub tier_multiplier_bps: u16,
    pub king_loot_cut_bps: u16,
    pub _padding7: [u8; 4],
    pub king_novi_per_day: u64,
    pub king_cash_per_day: u64,
    pub court_novi_per_day: u64,
    pub court_cash_per_day: u64,
    pub member_novi_per_day: u64,
    pub member_cash_per_day: u64,

    // Statistics (24 bytes)
    pub times_claimed: u32,
    pub successful_defenses: u32,
    pub failed_defenses: u32,
    pub _padding8: [u8; 4],
    pub total_rewards_distributed: u64,

    // Transition Progress (48 bytes)
    pub transition_garrison_cleaned: u8,
    pub transition_court_cleaned: bool,
    pub transition_rewards_cleaned: u8,
    pub _transition_padding: [u8; 5],
    pub transition_new_king: Address,
    pub _transition_reserved: [u8; 8],

    // Activation (16 bytes) - Castle is dormant until activates_at
    pub activates_at: i64,
    pub _activation_padding: [u8; 8],

    // Reserved (16 bytes)
    pub _reserved: [u8; 16],
}

impl CastleAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Unsafe load from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Unsafe mutable load from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Check if castle is active (past activation time)
    /// Castles are dormant until activates_at timestamp
    pub fn is_active(&self, now: i64) -> bool {
        now >= self.activates_at
    }

    /// Check if castle is in contest period
    pub fn is_in_contest(&self, now: i64) -> bool {
        self.status == CASTLE_STATUS_CONTEST && now < self.contest_end_at
    }

    /// Check if castle is protected
    /// Uses effective_protection_duration which includes watchtower bonus
    pub fn is_protected(&self, now: i64) -> bool {
        self.status == CASTLE_STATUS_PROTECTED
            && now < self.contest_end_at + self.effective_protection_duration()
    }

    /// Check if castle is vacant
    pub fn is_vacant(&self) -> bool {
        self.king == NULL_PUBKEY
    }

    /// Get the castle tier enum
    pub fn get_tier(&self) -> Option<CastleTier> {
        CastleTier::from_u8(self.tier)
    }

    /// Check if this castle can have a king (Citadel only)
    pub fn can_have_king(&self) -> bool {
        self.get_tier().map_or(false, |t| t.has_king())
    }

    /// Check if this castle can have court (Citadel only)
    pub fn can_have_court(&self) -> bool {
        self.get_tier().map_or(false, |t| t.has_court())
    }

    /// Check if castle can have court appointed
    pub fn can_appoint_court(&self, now: i64) -> bool {
        self.can_have_court()
            && self.status != CASTLE_STATUS_CONTEST
            && self.status != CASTLE_STATUS_TRANSITIONING
            && now >= self.contest_end_at
    }

    /// Check if castle can be attacked
    /// Must be active (past activates_at) and in attackable status
    /// - CONTEST: attackable during the 2-hour contest window
    /// - VULNERABLE: always attackable (protection expired)
    /// - PROTECTED: attackable after effective_protection_duration expires (includes watchtower bonus)
    /// - TRANSITIONING: attackable during 2-hour window to contest ownership
    pub fn can_be_attacked(&self, now: i64) -> bool {
        // Must be active first
        if !self.is_active(now) {
            return false;
        }

        match self.status {
            CASTLE_STATUS_CONTEST => now < self.contest_end_at,
            CASTLE_STATUS_VULNERABLE => true,
            CASTLE_STATUS_PROTECTED => {
                now >= self.contest_end_at + self.effective_protection_duration()
            }
            CASTLE_STATUS_TRANSITIONING => now < self.contest_end_at,
            _ => false,
        }
    }

    /// Get castle name as &str
    pub fn name(&self) -> &str {
        let end = (self.name_len as usize).min(self.name.len());
        core::str::from_utf8(&self.name[..end]).unwrap_or("")
    }

    // Upgrade Bonus Calculations
    // Using u32 for uncapped stats to avoid overflow (255 * 500 = 127,500 > u16::MAX)

    /// Calculate fortification defense bonus in basis points
    /// +500 bps (5%) per level, uncapped
    /// Returns u32 to handle high levels safely
    pub fn fortification_bonus_bps(&self) -> u32 {
        (self.fortification_level as u32) * 500
    }

    /// Calculate treasury reward bonus in basis points
    /// +1000 bps (10%) per level, capped at level 20 (200%)
    pub fn treasury_bonus_bps(&self) -> u16 {
        (self.treasury_level as u16) * 1000
    }

    /// Calculate watchtower early warning bonus in basis points
    /// +1000 bps (10%) per level, capped at level 15 (150%)
    pub fn watchtower_bonus_bps(&self) -> u16 {
        (self.watchtower_level as u16) * 1000
    }

    /// Calculate armory defense quality bonus in basis points
    /// +300 bps (3%) per level, uncapped
    /// Returns u32 to handle high levels safely
    pub fn armory_bonus_bps(&self) -> u32 {
        (self.armory_level as u32) * 300
    }

    /// Get max court slots from chambers level
    /// +1 slot per level, capped at level 5
    pub fn max_court_slots(&self) -> u8 {
        self.chambers_level
    }

    /// Calculate total defense multiplier combining fortification and armory
    /// Returns basis points as u32 (10000 = 1.0x, 20000 = 2.0x, etc.)
    pub fn total_defense_bonus_bps(&self) -> u32 {
        self.fortification_bonus_bps()
            .saturating_add(self.armory_bonus_bps())
    }

    /// Calculate effective protection duration with watchtower bonus
    /// Watchtower extends protection: +10% per level (max +150% at level 15)
    /// This is the "time shield" - higher watchtower = longer safety periods
    pub fn effective_protection_duration(&self) -> i64 {
        let watchtower_bonus = self.watchtower_bonus_bps() as i64;
        // protection_duration * (10000 + watchtower_bonus) / 10000
        self.protection_duration
            .saturating_mul(10000 + watchtower_bonus)
            / 10000
    }

    /// Derive PDA for a castle account
    /// Seeds: [CASTLE_SEED, city_id, castle_id]
    pub fn derive_pda(game_engine: &Address, city_id: u16, castle_id: u16) -> (Address, u8) {
        let city_id_bytes = city_id.to_le_bytes();
        let castle_id_bytes = castle_id.to_le_bytes();
        pinocchio::Address::find_program_address(
            &[
                CASTLE_SEED,
                game_engine.as_ref(),
                &city_id_bytes,
                &castle_id_bytes,
            ],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(
        game_engine: &Address,
        city_id: u16,
        castle_id: u16,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let city_id_bytes = city_id.to_le_bytes();
        let castle_id_bytes = castle_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                CASTLE_SEED,
                game_engine.as_ref(),
                &city_id_bytes,
                &castle_id_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify a CastleAccount
    pub fn load_checked<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        city_id: u16,
        castle_id: u16,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine, city_id, castle_id);
        crate::validation::require_pda_eq(account, &expected_pda, "CastleAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::Castle, "CastleAccount")?
        };
        if loaded.castle_id != castle_id || loaded.city_id != city_id {
            return Err(crate::error::GameError::InvalidParameter.into());
        }
        crate::validation::require_stored_game_engine(
            &loaded.game_engine,
            game_engine,
            "CastleAccount",
            account,
        )?;
        crate::validation::require_bump_eq(loaded.bump, bump, "CastleAccount", account)?;
        Ok(loaded)
    }

    /// Check if castle belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Address) -> bool {
        &self.game_engine == game_engine
    }

    /// Load and verify a CastleAccount mutably
    pub fn load_checked_mut<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        city_id: u16,
        castle_id: u16,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine, city_id, castle_id);
        crate::validation::require_pda_eq(account, &expected_pda, "CastleAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::Castle,
                "CastleAccount",
            )?
        };
        if loaded.castle_id != castle_id || loaded.city_id != city_id {
            return Err(crate::error::GameError::InvalidParameter.into());
        }
        crate::validation::require_stored_game_engine(
            &loaded.game_engine,
            game_engine,
            "CastleAccount",
            account,
        )?;
        crate::validation::require_bump_eq(loaded.bump, bump, "CastleAccount", account)?;
        Ok(loaded)
    }

    /// Load without explicit game_engine - re-derives PDA from stored data
    /// Use when game_engine account is not available but you have the castle account
    pub fn load_checked_by_key<'a>(
        account: &'a pinocchio::AccountView,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::Castle, "CastleAccount")?
        };
        let (expected_pda, bump) =
            Self::derive_pda(&loaded.game_engine, loaded.city_id, loaded.castle_id);
        crate::validation::require_pda_eq(account, &expected_pda, "CastleAccount")?;
        crate::validation::require_bump_eq(loaded.bump, bump, "CastleAccount", account)?;
        Ok(loaded)
    }

    /// Load mutably without explicit game_engine - re-derives PDA from stored data
    pub fn load_checked_mut_by_key<'a>(
        account: &'a pinocchio::AccountView,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::Castle,
                "CastleAccount",
            )?
        };
        let (expected_pda, bump) =
            Self::derive_pda(&loaded.game_engine, loaded.city_id, loaded.castle_id);
        crate::validation::require_pda_eq(account, &expected_pda, "CastleAccount")?;
        crate::validation::require_bump_eq(loaded.bump, bump, "CastleAccount", account)?;
        Ok(loaded)
    }
}

// KING REGISTRY ACCOUNT

/// Reference to a castle ruled by a king
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CastleReference {
    pub city_id: u16,
    pub castle_id: u16,
    pub claimed_at: i64,
    pub tier: u8,
    pub _padding: [u8; 19], // Align to 32 bytes
}

impl Default for CastleReference {
    fn default() -> Self {
        Self {
            city_id: 0,
            castle_id: 0,
            claimed_at: 0,
            tier: 0,
            _padding: [0; 19],
        }
    }
}

/// KingRegistryAccount - Tracks castles ruled by a single king
///
/// PDA Seeds: [KING_REGISTRY_SEED, king_pubkey]
/// Size: ~200 bytes
/// Never closes - persists permanently
#[repr(C)]
#[derive(Copy, Clone)]
pub struct KingRegistryAccount {
    /// Account discriminator (AccountKey::KingRegistry)
    pub account_key: u8,
    // Identity (40 bytes)
    pub king: Address,
    pub bump: u8,
    pub castle_count: u8,
    pub max_castles: u8,
    pub _padding1: [u8; 5],

    // Castle References (160 bytes) - up to 5 castles max
    pub castles: [CastleReference; 5],
}

impl KingRegistryAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Unsafe load from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Unsafe mutable load from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Check if king can claim another castle
    pub fn can_claim_castle(&self) -> bool {
        self.castle_count < self.max_castles
    }

    /// Add a castle to the registry
    pub fn add_castle(&mut self, city_id: u16, castle_id: u16, tier: u8, now: i64) -> bool {
        if self.castle_count >= self.max_castles {
            return false;
        }

        let slot = self.castle_count as usize;
        self.castles[slot] = CastleReference {
            city_id,
            castle_id,
            claimed_at: now,
            tier,
            _padding: [0; 19],
        };
        self.castle_count += 1;
        true
    }

    /// Remove a castle from the registry
    pub fn remove_castle(&mut self, city_id: u16, castle_id: u16) -> bool {
        for i in 0..self.castle_count as usize {
            if self.castles[i].city_id == city_id && self.castles[i].castle_id == castle_id {
                // Shift remaining entries
                for j in i..self.castle_count as usize - 1 {
                    self.castles[j] = self.castles[j + 1];
                }
                // Clear last slot
                self.castles[self.castle_count as usize - 1] = CastleReference::default();
                self.castle_count -= 1;
                return true;
            }
        }
        false
    }

    /// Derive PDA for a king registry account
    /// Seeds: [KING_REGISTRY_SEED, king_pubkey]
    pub fn derive_pda(king: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(&[KING_REGISTRY_SEED, king.as_ref()], &crate::ID)
    }

    /// Create PDA from known bump
    pub fn create_pda(king: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[KING_REGISTRY_SEED, king.as_ref(), &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify a KingRegistryAccount
    pub fn load_checked<'a>(
        account: &'a pinocchio::AccountView,
        king: &Address,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(king);
        crate::validation::require_pda_eq(account, &expected_pda, "KingRegistryAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(
                account,
                super::AccountKey::KingRegistry,
                "KingRegistryAccount",
            )?
        };
        if loaded.king != *king {
            return Err(crate::error::GameError::InvalidParameter.into());
        }
        crate::validation::require_bump_eq(loaded.bump, bump, "KingRegistryAccount", account)?;
        Ok(loaded)
    }

    /// Load and verify a KingRegistryAccount mutably
    pub fn load_checked_mut<'a>(
        account: &'a pinocchio::AccountView,
        king: &Address,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(king);
        crate::validation::require_pda_eq(account, &expected_pda, "KingRegistryAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::KingRegistry,
                "KingRegistryAccount",
            )?
        };
        if loaded.king != *king {
            return Err(crate::error::GameError::InvalidParameter.into());
        }
        crate::validation::require_bump_eq(loaded.bump, bump, "KingRegistryAccount", account)?;
        Ok(loaded)
    }
}

// COURT POSITION ACCOUNT

/// CourtPositionAccount - Created when a position is filled, closed when vacated
///
/// PDA Seeds: [COURT_SEED, castle_pubkey, position_type (u8)]
/// Size: ~80 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CourtPositionAccount {
    /// Account discriminator (AccountKey::CourtPosition)
    pub account_key: u8,
    // Identity (40 bytes)
    pub castle: Address,
    pub position_type: u8,
    pub bump: u8,
    pub _padding1: [u8; 6],

    // Holder Info (40 bytes)
    pub holder: Address,
    pub appointed_at: i64,
}

impl CourtPositionAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Unsafe load from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Unsafe mutable load from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Get the court position enum
    pub fn get_position(&self) -> Option<CourtPosition> {
        CourtPosition::from_u8(self.position_type)
    }

    /// Derive PDA for a court position account
    /// Seeds: [COURT_SEED, castle_pubkey, position_type]
    pub fn derive_pda(castle: &Address, position_type: u8) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[COURT_SEED, castle.as_ref(), &[position_type]],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(
        castle: &Address,
        position_type: u8,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[COURT_SEED, castle.as_ref(), &[position_type], &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
}

// GARRISON CONTRIBUTION ACCOUNT

/// GarrisonContributionAccount - Tracks individual player contributions to garrison
///
/// PDA Seeds: [GARRISON_SEED, castle_pubkey, contributor_pubkey]
/// Size: ~200 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct GarrisonContributionAccount {
    /// Account discriminator (AccountKey::CastleGarrison)
    pub account_key: u8,
    // Identity (72 bytes)
    pub castle: Address,
    pub contributor: Address,
    pub bump: u8,
    pub is_king: bool,
    pub _padding1: [u8; 6],

    // Contribution Timestamp (8 bytes)
    pub contributed_at: i64,

    // Units Committed (24 bytes)
    pub units_1: u64,
    pub units_2: u64,
    pub units_3: u64,

    // Weapons Committed (24 bytes)
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,

    // Hero (40 bytes)
    pub hero_mint: Address,
    pub hero_defense_bps: u16,
    pub hero_weapon_eff_bps: u16,
    pub _padding2: [u8; 4],

    // Combat Loot (24 bytes) - weapons captured from attackers
    pub loot_melee: u64,
    pub loot_ranged: u64,
    pub loot_siege: u64,

    // Flags (8 bytes)
    pub loot_claimed: bool,
    pub _padding3: [u8; 7],
}

impl GarrisonContributionAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Unsafe load from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Unsafe mutable load from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Get total units committed
    pub fn total_units(&self) -> u64 {
        self.units_1
            .saturating_add(self.units_2)
            .saturating_add(self.units_3)
    }

    /// Get total weapons committed
    pub fn total_weapons(&self) -> u64 {
        self.melee_weapons
            .saturating_add(self.ranged_weapons)
            .saturating_add(self.siege_weapons)
    }

    /// Get total loot
    pub fn total_loot(&self) -> u64 {
        self.loot_melee
            .saturating_add(self.loot_ranged)
            .saturating_add(self.loot_siege)
    }

    /// Check if has hero committed
    pub fn has_hero(&self) -> bool {
        self.hero_mint != NULL_PUBKEY
    }

    /// Calculate power contribution for loot distribution
    pub fn calculate_power(&self) -> u64 {
        // Unit power: tier1=10, tier2=25, tier3=60 (matching combat constants)
        let unit_power = self
            .units_1
            .saturating_mul(10)
            .saturating_add(self.units_2.saturating_mul(25))
            .saturating_add(self.units_3.saturating_mul(60));

        // Weapon power: 5 per weapon
        let weapon_power = self.total_weapons().saturating_mul(5);

        // Hero bonus: defense_bps as flat power bonus
        let hero_power = self.hero_defense_bps as u64;

        unit_power
            .saturating_add(weapon_power)
            .saturating_add(hero_power)
    }

    /// Derive PDA for a garrison contribution account
    /// Seeds: [GARRISON_SEED, castle_pubkey, contributor_pubkey]
    pub fn derive_pda(castle: &Address, contributor: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[GARRISON_SEED, castle.as_ref(), contributor.as_ref()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(
        castle: &Address,
        contributor: &Address,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                GARRISON_SEED,
                castle.as_ref(),
                contributor.as_ref(),
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
}

// TEAM CASTLE REWARD ACCOUNT

/// TeamCastleRewardAccount - Tracks time-based reward accumulation for team members
///
/// PDA Seeds: [TEAM_CASTLE_REWARD_SEED, castle_pubkey, member_pubkey]
/// Size: ~80 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamCastleRewardAccount {
    /// Account discriminator (AccountKey::TeamCastleReward)
    pub account_key: u8,
    // Identity (72 bytes)
    pub castle: Address,
    pub member: Address,
    pub bump: u8,
    pub _padding1: [u8; 7],

    // Claim Tracking (16 bytes)
    pub last_claim_at: i64,
    pub total_claimed_novi: u64,
}

impl TeamCastleRewardAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Unsafe load from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Unsafe mutable load from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Calculate elapsed days since last claim
    pub fn elapsed_days(&self, now: i64) -> u64 {
        if now <= self.last_claim_at {
            return 0;
        }
        ((now - self.last_claim_at) / crate::constants::SECONDS_PER_DAY) as u64
    }

    /// Check if can claim (at least 1 day elapsed)
    pub fn can_claim(&self, now: i64) -> bool {
        self.elapsed_days(now) >= 1
    }

    /// Derive PDA for a team castle reward account
    /// Seeds: [TEAM_CASTLE_REWARD_SEED, castle_pubkey, member_pubkey]
    pub fn derive_pda(castle: &Address, member: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[TEAM_CASTLE_REWARD_SEED, castle.as_ref(), member.as_ref()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(
        castle: &Address,
        member: &Address,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                TEAM_CASTLE_REWARD_SEED,
                castle.as_ref(),
                member.as_ref(),
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
}

// HELPER FUNCTIONS

/// Calculate reward with tier multiplier and treasury bonus
pub fn calculate_reward(base_rate: u64, tier_mult_bps: u16, treasury_level: u8, days: u64) -> u64 {
    if days == 0 {
        return 0;
    }

    // Treasury bonus: +10% per level
    let treasury_bonus_bps = treasury_level as u64 * 1000;

    // Apply tier multiplier first
    let tier_adjusted = base_rate
        .saturating_mul(tier_mult_bps as u64)
        .saturating_div(10000);

    // Apply treasury bonus
    let with_treasury = tier_adjusted
        .saturating_mul(10000 + treasury_bonus_bps)
        .saturating_div(10000);

    // Multiply by days
    with_treasury.saturating_mul(days)
}

// Note: EXT_COURT is defined in player.rs as the canonical source

//! Arena PvP System State Accounts
//!
//! The Arena is a non-lethal competitive PvP mode where players battle for glory
//! and rewards without losing their troops. Players accumulate points throughout
//! a weekly season, with top performers earning rewards.
//!
//! Key Design Principles:
//! - Stateless combat resolution (no battle accounts stored)
//! - Off-chain matchmaking with game_authority signature
//! - Rolling 24-hour battle limits
//! - Season cumulative win rate for daily rewards

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    constants::{ARENA_SEASON_SEED, ARENA_PARTICIPANT_SEED, ARENA_LOADOUT_SEED},
    error::GameError,
    state::{Loaded, LoadedMut},
};

// ============================================================
// Arena Season Account
// ============================================================

/// Size of ArenaSeasonAccount in bytes (with repr(C) alignment padding)
pub const ARENA_SEASON_ACCOUNT_SIZE: usize = 608;

/// Arena season status
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArenaStatus {
    Pending = 0,
    Active = 1,
    Finalized = 2,
    RewardsDistributed = 3,
}

impl TryFrom<u8> for ArenaStatus {
    type Error = ProgramError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Pending),
            1 => Ok(Self::Active),
            2 => Ok(Self::Finalized),
            3 => Ok(Self::RewardsDistributed),
            _ => Err(ProgramError::InvalidAccountData),
        }
    }
}

/// Leaderboard entry for top 10 players
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ArenaLeaderboardEntry {
    pub player: Pubkey,          // 32 bytes
    pub total_points: u64,       // 8 bytes
}                                // Total: 40 bytes

impl Default for ArenaLeaderboardEntry {
    fn default() -> Self {
        Self {
            player: Pubkey::default(),
            total_points: 0,
        }
    }
}

/// Arena Season Account - tracks season state and global leaderboard
/// KINGDOM-SCOPED: Each kingdom has its own arena seasons and leaderboards
///
/// PDA Seeds: ["arena_season", game_engine, season_id]
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ArenaSeasonAccount {
    /// Account discriminator (AccountKey::ArenaSeason)
    pub account_key: u8,

    // ===== Kingdom & Identity (70 bytes) =====
    pub game_engine: Pubkey,                     // 32 - Kingdom this season belongs to
    pub season_id: u32,                          // 4 - Incrementing season number
    pub city_id: u16,                            // 2 - City this arena belongs to (0 = kingdom-wide)
    pub authority: Pubkey,                       // 32 - Who can finalize/admin

    // ===== Timing (25 bytes) =====
    pub start_time: i64,                         // 8 - Unix timestamp
    pub end_time: i64,                           // 8 - start_time + 7 days
    pub claim_deadline: i64,                     // 8 - end_time + 30 days
    pub status: u8,                              // 1 - ArenaStatus enum

    // ===== Leaderboard - Top 10 Only (411 bytes) =====
    pub leaderboard: [ArenaLeaderboardEntry; 10], // 400 (10 x 40)
    pub leaderboard_count: u8,                   // 1
    pub leaderboard_claimed: [bool; 10],         // 10 - Track who claimed master reward

    // ===== Prize Pool (52 bytes) =====
    pub master_prize_pool: u64,                  // 8 - Total NOVI for top 10
    pub daily_prize_pool: u64,                   // 8 - Total NOVI for daily rewards
    pub daily_distribution_cap: u64,             // 8 - Max distributed per day
    pub distributed_today: u64,                  // 8 - Tracks today's distributions
    pub last_distribution_day: u32,              // 4 - Day number for reset
    pub _padding1: [u8; 4],                      // 4 - Alignment padding
    pub prize_remaining: u64,                    // 8 - Unclaimed prizes

    // ===== Thresholds (26 bytes) =====
    pub min_level_required: u8,                  // 1 - Minimum player level to join
    pub _padding2: [u8; 7],                      // 7 - Alignment padding
    pub min_points_for_leaderboard: u64,         // 8 - Prevents sybil attacks (default: 500)
    pub total_battles: u64,                      // 8 - Counter for stats
    pub bump: u8,                                // 1 - PDA bump
    pub _reserved: [u8; 7],                      // 7 - Future use
}

impl ArenaSeasonAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Derive the PDA for an arena season
    /// Seeds: ["arena_season", game_engine, season_id]
    pub fn derive_pda(game_engine: &Pubkey, season_id: u32) -> (Pubkey, u8) {
        let season_id_bytes = season_id.to_le_bytes();
        pinocchio::pubkey::find_program_address(
            &[ARENA_SEASON_SEED, game_engine.as_ref(), &season_id_bytes],
            &crate::ID,
        )
    }

    /// Load and validate arena season account (immutable)
    pub fn load_checked<'a>(
        account: &'a AccountInfo,
        game_engine: &Pubkey,
        season_id: u32,
        program_id: &Pubkey,
    ) -> Result<Loaded<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(game_engine, season_id);
        if account.key() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let data = account.try_borrow_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let loaded = data.as_ptr() as *const Self;
        let account_ref = unsafe { &*loaded };

        if account_ref.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        if &account_ref.game_engine != game_engine {
            return Err(GameError::KingdomMismatch.into());
        }

        Ok(unsafe { Loaded::new(data, loaded) })
    }

    /// Load and validate arena season account (mutable)
    pub fn load_checked_mut<'a>(
        account: &'a AccountInfo,
        game_engine: &Pubkey,
        season_id: u32,
        program_id: &Pubkey,
    ) -> Result<LoadedMut<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(game_engine, season_id);
        if account.key() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let data = account.try_borrow_mut_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let loaded = data.as_ptr() as *mut Self;
        let account_ref = unsafe { &*loaded };

        if account_ref.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        if &account_ref.game_engine != game_engine {
            return Err(GameError::KingdomMismatch.into());
        }

        Ok(unsafe { LoadedMut::new(data, loaded) })
    }

    /// Check if season belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Pubkey) -> bool {
        &self.game_engine == game_engine
    }

    /// Load without full validation (for initialization)
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Update leaderboard with a player's score
    /// Returns true if player made it onto the leaderboard
    pub fn update_leaderboard(&mut self, player: Pubkey, total_points: u64) -> bool {
        // Must meet minimum points threshold
        if total_points < self.min_points_for_leaderboard {
            return false;
        }

        // Check if player already on leaderboard
        let mut existing_index: Option<usize> = None;
        for i in 0..self.leaderboard_count as usize {
            if self.leaderboard[i].player == player {
                existing_index = Some(i);
                break;
            }
        }

        if let Some(idx) = existing_index {
            // Update existing entry
            self.leaderboard[idx].total_points = total_points;

            // Re-sort: bubble up if score increased
            let mut i = idx;
            while i > 0 && self.leaderboard[i].total_points > self.leaderboard[i - 1].total_points {
                self.leaderboard.swap(i, i - 1);
                // Also swap claimed status
                self.leaderboard_claimed.swap(i, i - 1);
                i -= 1;
            }
            // Bubble down if score decreased (shouldn't happen in arena, but handle it)
            while i < (self.leaderboard_count as usize - 1)
                && self.leaderboard[i].total_points < self.leaderboard[i + 1].total_points
            {
                self.leaderboard.swap(i, i + 1);
                self.leaderboard_claimed.swap(i, i + 1);
                i += 1;
            }
            return true;
        }

        // Not on leaderboard yet - check if qualifies
        if self.leaderboard_count < 10 {
            // Space available, add and sort
            let idx = self.leaderboard_count as usize;
            self.leaderboard[idx] = ArenaLeaderboardEntry { player, total_points };
            self.leaderboard_claimed[idx] = false;
            self.leaderboard_count += 1;

            // Bubble up to correct position
            let mut i = idx;
            while i > 0 && self.leaderboard[i].total_points > self.leaderboard[i - 1].total_points {
                self.leaderboard.swap(i, i - 1);
                self.leaderboard_claimed.swap(i, i - 1);
                i -= 1;
            }
            return true;
        }

        // Leaderboard full - check if beats lowest
        let lowest_idx = 9;
        if total_points > self.leaderboard[lowest_idx].total_points {
            // Replace lowest
            self.leaderboard[lowest_idx] = ArenaLeaderboardEntry { player, total_points };
            self.leaderboard_claimed[lowest_idx] = false;

            // Bubble up to correct position
            let mut i = lowest_idx;
            while i > 0 && self.leaderboard[i].total_points > self.leaderboard[i - 1].total_points {
                self.leaderboard.swap(i, i - 1);
                self.leaderboard_claimed.swap(i, i - 1);
                i -= 1;
            }
            return true;
        }

        false
    }

    /// Get player's rank on leaderboard (1-indexed), or None if not on it
    pub fn get_player_rank(&self, player: &Pubkey) -> Option<u8> {
        for i in 0..self.leaderboard_count as usize {
            if &self.leaderboard[i].player == player {
                return Some((i + 1) as u8);
            }
        }
        None
    }

    /// Check if it's a new day and reset daily distribution counter
    pub fn check_and_reset_daily(&mut self, current_day: u32) {
        if self.last_distribution_day != current_day {
            self.distributed_today = 0;
            self.last_distribution_day = current_day;
        }
    }
}

// ============================================================
// Arena Participant Account
// ============================================================

/// Size of ArenaParticipantAccount in bytes (with repr(C) alignment padding)
/// Packed fields total 520 but repr(C) adds padding for i64 alignment = 536
pub const ARENA_PARTICIPANT_ACCOUNT_SIZE: usize = 536;

/// Arena Participant Account - per-player, per-season state tracking
///
/// PDA Seeds: ["arena_participant", game_engine, season_id, player]
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ArenaParticipantAccount {
    /// Account discriminator (AccountKey::ArenaParticipant)
    pub account_key: u8,

    // ===== Identity (68 bytes) =====
    pub game_engine: Pubkey,                     // 32 - Kingdom reference
    pub player: Pubkey,                          // 32
    pub season_id: u32,                          // 4

    // ===== Daily Battle Tracking - Rolling Window (401 bytes) =====
    pub battle_timestamps: [i64; 10],            // 80 - Circular buffer of last 10 battle times
    pub battle_opponents: [Pubkey; 10],          // 320 - Who we fought (for diversity + cooldown checks)
    pub battle_index: u8,                        // 1 - Current index in circular buffer

    // ===== Matchmaking (12 bytes) =====
    pub last_match_id: u64,                      // 8 - Prevents match replay attacks
    pub daily_reward_claimed_day: u32,           // 4 - Which day was last claim

    // ===== Skill Rating (4 bytes) =====
    pub elo_rating: u32,                         // 4 - Starts at 1000

    // ===== Season Statistics (16 bytes) =====
    pub total_points: u64,                       // 8 - Can never go below 0
    pub wins: u32,                               // 4 - Season cumulative wins
    pub losses: u32,                             // 4 - Season cumulative losses

    // ===== Claim Tracking (2 bytes) =====
    pub master_reward_claimed: bool,             // 1
    pub bump: u8,                                // 1 - PDA bump

    // ===== Reserved (17 bytes) =====
    pub _reserved: [u8; 17],
}

impl ArenaParticipantAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Starting ELO rating for new participants
    pub const STARTING_ELO: u32 = 1000;

    /// Derive the PDA for an arena participant
    /// Seeds: ["arena_participant", game_engine, season_id, player]
    pub fn derive_pda(game_engine: &Pubkey, season_id: u32, player: &Pubkey) -> (Pubkey, u8) {
        let season_id_bytes = season_id.to_le_bytes();
        pinocchio::pubkey::find_program_address(
            &[
                ARENA_PARTICIPANT_SEED,
                game_engine.as_ref(),
                &season_id_bytes,
                player.as_ref(),
            ],
            &crate::ID,
        )
    }

    /// Load and validate arena participant account (immutable)
    pub fn load_checked<'a>(
        account: &'a AccountInfo,
        game_engine: &Pubkey,
        season_id: u32,
        player: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<Loaded<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(game_engine, season_id, player);
        if account.key() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let data = account.try_borrow_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let loaded = data.as_ptr() as *const Self;
        let account_ref = unsafe { &*loaded };

        if account_ref.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { Loaded::new(data, loaded) })
    }

    /// Load and validate arena participant account (mutable)
    pub fn load_checked_mut<'a>(
        account: &'a AccountInfo,
        game_engine: &Pubkey,
        season_id: u32,
        player: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<LoadedMut<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(game_engine, season_id, player);
        if account.key() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let data = account.try_borrow_mut_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let loaded = data.as_ptr() as *mut Self;
        let account_ref = unsafe { &*loaded };

        if account_ref.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { LoadedMut::new(data, loaded) })
    }

    /// Load without full validation (for initialization)
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Record a battle in the circular buffer
    pub fn record_battle(&mut self, opponent: Pubkey, timestamp: i64) {
        self.battle_timestamps[self.battle_index as usize] = timestamp;
        self.battle_opponents[self.battle_index as usize] = opponent;
        self.battle_index = (self.battle_index + 1) % 10;
    }

    /// Count battles within a time window
    pub fn count_battles_in_window(&self, now: i64, window_seconds: i64) -> u8 {
        let cutoff = now - window_seconds;
        let mut count = 0u8;
        for i in 0..10 {
            if self.battle_timestamps[i] > cutoff {
                count += 1;
            }
        }
        count
    }

    /// Count battles against a specific opponent within a time window
    pub fn count_opponent_in_window(&self, opponent: &Pubkey, now: i64, window_seconds: i64) -> u8 {
        let cutoff = now - window_seconds;
        let mut count = 0u8;
        for i in 0..10 {
            if self.battle_timestamps[i] > cutoff && &self.battle_opponents[i] == opponent {
                count += 1;
            }
        }
        count
    }

    /// Count unique opponents within a time window
    pub fn count_unique_opponents_in_window(&self, now: i64, window_seconds: i64) -> u8 {
        let cutoff = now - window_seconds;
        let mut unique: [Pubkey; 10] = [Pubkey::default(); 10];
        let mut unique_count: u8 = 0;

        for i in 0..10 {
            if self.battle_timestamps[i] > cutoff && self.battle_opponents[i] != Pubkey::default() {
                // Check if already in unique array
                let mut found = false;
                for j in 0..unique_count as usize {
                    if unique[j] == self.battle_opponents[i] {
                        found = true;
                        break;
                    }
                }
                if !found {
                    unique[unique_count as usize] = self.battle_opponents[i];
                    unique_count += 1;
                }
            }
        }
        unique_count
    }
}

// ============================================================
// Arena Loadout Account
// ============================================================

/// Size of ArenaLoadoutAccount in bytes (with repr(C) alignment padding)
/// Packed fields total 160 but repr(C) adds padding for u64 alignment = 168
pub const ARENA_LOADOUT_ACCOUNT_SIZE: usize = 168;

/// Arena Loadout Account - player's configured arena loadout (reusable across seasons)
/// KINGDOM-SCOPED: Loadouts are per-kingdom since player units differ per kingdom
///
/// PDA Seeds: ["arena_loadout", game_engine, player]
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ArenaLoadoutAccount {
    /// Account discriminator (AccountKey::ArenaLoadout)
    pub account_key: u8,

    // ===== Identity (65 bytes) =====
    pub game_engine: Pubkey,                     // 32 - Kingdom reference
    pub player: Pubkey,                          // 32
    pub bump: u8,                                // 1

    // ===== Hero Selection (32 bytes) =====
    pub arena_hero: Pubkey,                      // 32 - Hero mint for arena (default = use active heroes)

    // ===== Unit Loadout (24 bytes) =====
    pub defensive_units: [u64; 3],               // 24 - Tier 1, 2, 3 defensive units

    // ===== Equipment Loadout (32 bytes) =====
    pub melee_weapons: u64,                      // 8
    pub ranged_weapons: u64,                     // 8
    pub siege_weapons: u64,                      // 8
    pub armor_pieces: u64,                       // 8

    // ===== Reserved (7 bytes) =====
    pub _reserved: [u8; 7],
}

impl ArenaLoadoutAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Derive the PDA for an arena loadout
    /// Seeds: ["arena_loadout", game_engine, player]
    pub fn derive_pda(game_engine: &Pubkey, player: &Pubkey) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[ARENA_LOADOUT_SEED, game_engine.as_ref(), player.as_ref()],
            &crate::ID,
        )
    }

    /// Load and validate arena loadout account (immutable)
    pub fn load_checked<'a>(
        account: &'a AccountInfo,
        game_engine: &Pubkey,
        player: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<Loaded<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(game_engine, player);
        if account.key() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let data = account.try_borrow_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let loaded = data.as_ptr() as *const Self;
        let account_ref = unsafe { &*loaded };

        if account_ref.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { Loaded::new(data, loaded) })
    }

    /// Load and validate arena loadout account (mutable)
    pub fn load_checked_mut<'a>(
        account: &'a AccountInfo,
        game_engine: &Pubkey,
        player: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<LoadedMut<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(game_engine, player);
        if account.key() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let data = account.try_borrow_mut_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let loaded = data.as_ptr() as *mut Self;
        let account_ref = unsafe { &*loaded };

        if account_ref.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { LoadedMut::new(data, loaded) })
    }

    /// Load and verify by key immutably.
    /// Uses stored game_engine and player to re-derive and validate PDA.
    pub fn load_checked_by_key<'a>(
        account: &'a AccountInfo,
        program_id: &Pubkey,
    ) -> Result<Loaded<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let data = account.try_borrow_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        // Re-derive and validate PDA using stored values
        let (expected_pda, bump) = Self::derive_pda(&loaded.game_engine, &loaded.player);
        if account.key() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { Loaded::new(data, ptr) })
    }

    /// Load and verify by key mutably.
    /// Uses stored game_engine and player to re-derive and validate PDA.
    pub fn load_checked_mut_by_key<'a>(
        account: &'a AccountInfo,
        program_id: &Pubkey,
    ) -> Result<LoadedMut<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let mut data = account.try_borrow_mut_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }

        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        // Re-derive and validate PDA using stored values
        let (expected_pda, bump) = Self::derive_pda(&loaded.game_engine, &loaded.player);
        if account.key() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { LoadedMut::new(data, ptr) })
    }

    /// Load without full validation (for initialization)
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Get total unit count
    pub fn total_units(&self) -> u64 {
        self.defensive_units[0]
            .saturating_add(self.defensive_units[1])
            .saturating_add(self.defensive_units[2])
    }

    /// Get total weapon count
    pub fn total_weapons(&self) -> u64 {
        self.melee_weapons
            .saturating_add(self.ranged_weapons)
            .saturating_add(self.siege_weapons)
    }
}

// Compile-time size assertions
const _: () = assert!(core::mem::size_of::<ArenaParticipantAccount>() == ARENA_PARTICIPANT_ACCOUNT_SIZE);
const _: () = assert!(core::mem::size_of::<ArenaLoadoutAccount>() == ARENA_LOADOUT_ACCOUNT_SIZE);
const _: () = assert!(core::mem::size_of::<ArenaSeasonAccount>() == ARENA_SEASON_ACCOUNT_SIZE);

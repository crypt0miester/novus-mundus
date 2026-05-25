//! Expedition Account State
//!
//! ExpeditionAccount is a temporary PDA that exists only while a player
//! has an active mining or fishing expedition. It is created when an
//! expedition starts and closed (rent refunded) when claimed.
//!
//! Seeds: ["expedition", player_pubkey]

use pinocchio::error::ProgramError;
use pinocchio::Address;

use crate::constants::{
    EXPEDITION_FISHING, EXPEDITION_MINING, EXPEDITION_SEED, FISHING_DURATION_HOURS,
    MINING_DURATION_HOURS, SECONDS_PER_HOUR,
};

use super::player::NULL_PUBKEY;

/// Expedition types
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ExpeditionType {
    None = 0,
    Mining = 1,
    Fishing = 2,
}

impl ExpeditionType {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::None),
            1 => Some(Self::Mining),
            2 => Some(Self::Fishing),
            _ => None,
        }
    }

    pub const fn is_mining(self) -> bool {
        matches!(self, Self::Mining)
    }

    pub const fn is_fishing(self) -> bool {
        matches!(self, Self::Fishing)
    }
}

/// Mining tier names for display
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum MiningTier {
    Surface = 0,
    Shallow = 1,
    Deep = 2,
    Volcanic = 3,
    Abyssal = 4,
}

impl MiningTier {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Surface),
            1 => Some(Self::Shallow),
            2 => Some(Self::Deep),
            3 => Some(Self::Volcanic),
            4 => Some(Self::Abyssal),
            _ => None,
        }
    }
}

/// Fishing tier names for display
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum FishingTier {
    Shore = 0,
    River = 1,
    Lake = 2,
    DeepSea = 3,
    Abyss = 4,
}

impl FishingTier {
    pub const fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(Self::Shore),
            1 => Some(Self::River),
            2 => Some(Self::Lake),
            3 => Some(Self::DeepSea),
            4 => Some(Self::Abyss),
            _ => None,
        }
    }
}

// EXPEDITION ACCOUNT (104 bytes)

/// Temporary account that exists only during an active expedition.
/// Created on start_expedition, closed on claim_expedition (rent refunded).
///
/// Operatives are LOCKED (deducted from player) when expedition starts
/// and RETURNED to player when expedition is claimed.
///
/// Hero NFT can optionally be sent with the expedition for bonus yield.
/// The NFT is transferred to the expedition's token account (escrow) on start
/// and returned to the player on claim/abort.
///
/// Seeds: ["expedition", player_pubkey]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ExpeditionAccount {
    /// Account discriminator (AccountKey::Expedition)
    pub account_key: u8,

    /// Player who owns this expedition (32 bytes)
    pub player: Address,

    /// Hero NFT mint address (32 bytes)
    /// If [0; 32], no hero is assigned to this expedition
    pub hero_mint: Address,

    /// Type of expedition: Mining (1) or Fishing (2)
    pub expedition_type: u8,

    /// Tier of the expedition (0-4)
    /// Mining: Surface, Shallow, Deep, Volcanic, Abyssal
    /// Fishing: Shore, River, Lake, DeepSea, Abyss
    pub tier: u8,

    /// Number of strikes/casts performed (Phase 2 feature)
    pub strikes: u8,

    /// PDA bump seed
    pub bump: u8,

    /// Total score from strikes (Phase 2 feature)
    /// Higher score = better bonus rewards
    pub score: u16,

    /// City where expedition takes place (for origin city bonus)
    /// Stored at start, used on claim to check hero origin match
    pub city_id: u16,

    /// Unix timestamp when expedition started
    pub start_time: i64,

    /// Operative unit type 1 locked in this expedition
    pub operative_unit_1: u64,

    /// Operative unit type 2 locked in this expedition
    pub operative_unit_2: u64,

    /// Operative unit type 3 locked in this expedition
    pub operative_unit_3: u64,
}

impl ExpeditionAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // 112 bytes (with account_key)

    /// Initialize a new expedition account
    pub fn init(
        player: Address,
        hero_mint: Address,
        expedition_type: u8,
        tier: u8,
        bump: u8,
        city_id: u16,
        start_time: i64,
        operative_unit_1: u64,
        operative_unit_2: u64,
        operative_unit_3: u64,
    ) -> Self {
        Self {
            account_key: crate::state::AccountKey::Expedition as u8,
            player,
            hero_mint,
            expedition_type,
            tier,
            strikes: 0,
            bump,
            score: 0,
            city_id,
            start_time,
            operative_unit_1,
            operative_unit_2,
            operative_unit_3,
        }
    }

    /// Check if a hero is assigned to this expedition
    pub fn has_hero(&self) -> bool {
        self.hero_mint != NULL_PUBKEY
    }

    /// Get total operatives locked in this expedition
    pub fn total_operatives(&self) -> u64 {
        self.operative_unit_1
            .saturating_add(self.operative_unit_2)
            .saturating_add(self.operative_unit_3)
    }

    /// Get the duration of this expedition in seconds
    pub fn duration_seconds(&self) -> i64 {
        let hours = if self.expedition_type == EXPEDITION_MINING {
            MINING_DURATION_HOURS
                .get(self.tier as usize)
                .copied()
                .unwrap_or(1)
        } else {
            FISHING_DURATION_HOURS
                .get(self.tier as usize)
                .copied()
                .unwrap_or(1)
        };
        hours as i64 * SECONDS_PER_HOUR
    }

    /// Get the expected end time of this expedition
    pub fn end_time(&self) -> i64 {
        self.start_time.saturating_add(self.duration_seconds())
    }

    /// Check if the expedition is complete (duration elapsed)
    pub fn is_complete(&self, now: i64) -> bool {
        now >= self.end_time()
    }

    /// Get the maximum number of strikes allowed for this expedition
    /// (1 strike per hour of expedition duration)
    pub fn max_strikes(&self) -> u8 {
        if self.expedition_type == EXPEDITION_MINING {
            MINING_DURATION_HOURS
                .get(self.tier as usize)
                .copied()
                .unwrap_or(1)
        } else {
            FISHING_DURATION_HOURS
                .get(self.tier as usize)
                .copied()
                .unwrap_or(1)
        }
    }

    /// Check if another strike can be performed
    pub fn can_strike(&self) -> bool {
        self.strikes < self.max_strikes()
    }

    /// Get the next strike window time (1 strike per hour)
    pub fn next_strike_time(&self) -> i64 {
        self.start_time
            .saturating_add(self.strikes as i64 * SECONDS_PER_HOUR)
    }

    /// Check if a strike is ready to be performed
    pub fn is_strike_ready(&self, now: i64) -> bool {
        self.can_strike() && now >= self.next_strike_time()
    }

    /// Record a strike with the given score (0-100)
    pub fn record_strike(&mut self, score: u8) {
        self.strikes = self.strikes.saturating_add(1);
        self.score = self.score.saturating_add(score.min(100) as u16);
    }

    /// Get average score (for bonus calculation)
    pub fn average_score(&self) -> u8 {
        if self.strikes == 0 {
            0
        } else {
            (self.score / self.strikes as u16).min(100) as u8
        }
    }

    /// Check if this is a mining expedition
    pub fn is_mining(&self) -> bool {
        self.expedition_type == EXPEDITION_MINING
    }

    /// Check if this is a fishing expedition
    pub fn is_fishing(&self) -> bool {
        self.expedition_type == EXPEDITION_FISHING
    }

    /// Unsafe load from account data (assumes valid data)
    ///
    /// # Safety
    /// Caller must ensure the data is valid ExpeditionAccount data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Unsafe mutable load from account data
    ///
    /// # Safety
    /// Caller must ensure the data is valid ExpeditionAccount data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive PDA for an expedition account
    /// Seeds: [EXPEDITION_SEED, player]
    pub fn derive_pda(player: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(&[EXPEDITION_SEED, player.as_ref()], &crate::ID)
    }

    /// Create PDA from known bump
    pub fn create_pda(player: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[EXPEDITION_SEED, player.as_ref(), &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
}

// Compile-time size verification
const _: () = assert!(
    ExpeditionAccount::LEN == 112,
    "ExpeditionAccount size changed"
);
